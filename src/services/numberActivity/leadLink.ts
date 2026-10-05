import mongoose, { type ClientSession } from "mongoose";
import { getCallInteractionModel } from "../../models/CallInteraction";
import { getCallLeadModel } from "../../models/CallLead";
import { getContactNumberModel } from "../../models/ContactNumber";
import { getFormLeadModel } from "../../models/FormLead";
import { leadPhoneMatchClauses } from "../../models/leadContactPhoneIndexes";

import { CsiError } from "../salesIntelligence/auth";
import { enqueueDeskWakeForLeadLink } from "../salesOutreach/capture/leadLinkWake";
import { stableJson } from "./callSummary";
import { toE164 } from "./phone";
import { boundSearchTerms, leadLinkSearchTerms } from "./searchTerms";

/**
 * All Numbers lead link (all-numbers CONTRACT §2–§3): which Lead a Contact Number is.
 *
 * - **Candidates** are the Leads whose phone is exactly this number — the indexed normalized phone
 *   paths of Form and Call Leads (`leadContactPhoneIndexes.ts`) and the RingCentral telephony session of
 *   a Call Lead created from a call on this number — minus Duplicates, Bad Leads and the Leads the
 *   Owner unlinked (`lead_link.excluded`). The set is always computed from the number's side, so every
 *   trigger (capture, a Lead change, an Owner command, the migration) converges on the same answer.
 * - **Automatic**: `lead` is the newest candidate by `received_at`; `other_leads` holds the rest
 *   (newest first, at most 10).
 * - **Owner pin**: `lead` stays the Owner's choice until a candidate is received after
 *   `lead_link.set_at`; then the link reverts to automatic and the newest candidate wins.
 * - **Snapshots** (`name`, `job_no`, `receiver_agent_*`, `state`) are copied from the Lead on every
 *   recompute; a Lead change re-runs the recompute (`leadLinkJobs.ts`), so the copy stays fresh.
 *
 * Every write runs in the caller's transaction and bumps `revision` (the Owner's `POST /numbers/:id/lead`
 * fence) only when the link changed; a change also wakes the Sales Outreach Desk in the same transaction
 * (`salesOutreach/capture/leadLinkWake.ts`). Reads on the session run one at a time (a session never runs
 * two operations concurrently).
 */
export type LeadModel = "FormLead" | "CallLead";
export type LeadKey = { model: LeadModel; id: string };
export type NumberLeadState = "open" | "booked" | "cancelled";
export type NumberLeadSnapshot = {
  model: LeadModel;
  id: mongoose.Types.ObjectId;
  name: string | null;
  job_no: string | null;
  receiver_agent_id: mongoose.Types.ObjectId | null;
  receiver_agent_name: string | null;
  received_at: Date;
  state: NumberLeadState;
};
export type StoredLeadLink = {
  source: "automatic" | "owner";
  set_at: Date | null;
  set_by: string | null;
  excluded: Array<{ model: LeadModel; id: mongoose.Types.ObjectId }>;
};
export type LeadLinkFields = {
  lead: NumberLeadSnapshot | null;
  other_leads: NumberLeadSnapshot[];
  lead_link: StoredLeadLink;
};

export const OTHER_LEADS_MAX = 10;
/** Per model and lookup. A number matching more Leads keeps the newest ones. */
export const CANDIDATE_PAGE = 100;
/** Telephony sessions read from a number's newest calls to find the Call Leads those calls created. */
const SESSION_PAGE = 200;

export type LeadRow = {
  _id: unknown;
  timestamp?: Date | null;
  createdAt?: Date | null;
  name?: string | null;
  job_no?: string | null;
  receiver_agent?: unknown;
  receiver_agent_name_snapshot?: string | null;
  booked?: unknown;
  cancelled?: unknown;
  duplicate?: boolean | null;
  bad_lead?: unknown;
  normalized_phone_number?: string | null;
  ingested_contact_snapshot?: { normalized_phone_number?: string | null } | null;
  granot_contact_snapshot?: { normalized_phone_number?: string | null } | null;
  ringcentral?: { telephony_session_id?: string | null; original_caller?: { normalized_phone_number?: string | null } | null } | null;
};

export const LEAD_LINK_PROJECTION = {
  _id: 1, timestamp: 1, createdAt: 1, name: 1, job_no: 1, receiver_agent: 1, receiver_agent_name_snapshot: 1,
  booked: 1, cancelled: 1, duplicate: 1, bad_lead: 1, normalized_phone_number: 1,
  "ingested_contact_snapshot.normalized_phone_number": 1, "granot_contact_snapshot.normalized_phone_number": 1,
  "ringcentral.telephony_session_id": 1, "ringcentral.original_caller.normalized_phone_number": 1,
} as const;

const oid = (value: unknown) => new mongoose.Types.ObjectId(String(value));
export const sameLead = (a: { model: string; id: unknown } | null | undefined, b: { model: string; id: unknown } | null | undefined) =>
  Boolean(a && b && a.model === b.model && String(a.id) === String(b.id));

/** `cancelled` and `booked` are the source Lead's own stamps (cancellation mirror, booking chain). */
export function leadState(row: Pick<LeadRow, "booked" | "cancelled">): NumberLeadState {
  return row.cancelled ? "cancelled" : row.booked ? "booked" : "open";
}

export function leadSnapshot(model: LeadModel, row: LeadRow): NumberLeadSnapshot {
  return {
    model,
    id: oid(row._id),
    name: row.name?.trim() || null,
    job_no: row.job_no?.trim() || null,
    receiver_agent_id: row.receiver_agent ? oid(row.receiver_agent) : null,
    receiver_agent_name: row.receiver_agent_name_snapshot?.trim() || null,
    received_at: row.timestamp ?? row.createdAt ?? new Date(0),
    state: leadState(row),
  };
}

/** Newest received first; the id breaks ties so the order is total. */
export function newestFirst(a: Pick<NumberLeadSnapshot, "received_at" | "id">, b: Pick<NumberLeadSnapshot, "received_at" | "id">): number {
  return +b.received_at - +a.received_at || String(b.id).localeCompare(String(a.id));
}

/**
 * Pure §3 decision. `candidates` are already filtered (no Duplicate, Bad Lead or excluded Lead);
 * `pinned` is a fresh snapshot of the Owner's pinned Lead, or null when the link is automatic or the
 * pinned Lead is gone or became a Duplicate (both end the pin).
 */
export function planLeadLink(input: {
  candidates: readonly NumberLeadSnapshot[];
  current: { lead: { model: string; id: unknown } | null; lead_link: StoredLeadLink | null };
  pinned: NumberLeadSnapshot | null;
  now: Date;
}): LeadLinkFields {
  const sorted = [...input.candidates].sort(newestFirst);
  const link = input.current.lead_link;
  const excluded = link?.excluded ?? [];
  if (link?.source === "owner" && input.pinned) {
    const pinned = input.pinned;
    const setAt = +(link.set_at ?? 0);
    const newer = sorted.some((c) => !sameLead(c, pinned) && +c.received_at > setAt);
    if (!newer) {
      return {
        lead: pinned,
        other_leads: sorted.filter((c) => !sameLead(c, pinned)).slice(0, OTHER_LEADS_MAX),
        lead_link: { source: "owner", set_at: link.set_at, set_by: link.set_by, excluded },
      };
    }
  }
  const lead = sorted[0] ?? null;
  const unchanged = link?.source === "automatic" && (lead ? sameLead(lead, input.current.lead) : !input.current.lead);
  return {
    lead,
    other_leads: sorted.slice(1, 1 + OTHER_LEADS_MAX),
    lead_link: { source: "automatic", set_at: unchanged ? link!.set_at : input.now, set_by: null, excluded },
  };
}

/**
 * The join key for a number, as the Lead collections store it: the ten-digit NANP form
 * (`contact_numbers.national_ten`), else the E.164 digit string.
 */
export function numberLookupDigits(number: { national_ten?: string | null; e164?: string | null }): string[] {
  const ten = number.national_ten?.trim();
  if (ten) return [ten];
  const digits = number.e164?.replace(/\D/g, "") ?? "";
  return digits ? [digits] : [];
}

const isEligible = (row: LeadRow) => row.duplicate !== true && !row.bad_lead;
const isExcluded = (excluded: StoredLeadLink["excluded"], model: LeadModel, id: unknown) => excluded.some((e) => sameLead(e, { model, id }));

/** The number's candidate Leads (§3), read in the caller's session. */
export async function loadLeadCandidates(
  number: { _id: unknown; national_ten?: string | null; e164?: string | null },
  excluded: StoredLeadLink["excluded"],
  session?: ClientSession | null,
): Promise<NumberLeadSnapshot[]> {
  const digits = numberLookupDigits(number);
  const sessions = (await getCallInteractionModel()
    .find({ contact_number_id: oid(number._id), merged_into_id: null, telephony_session_id: { $ne: null } }, { telephony_session_id: 1 })
    .sort({ started_at: -1, _id: -1 })
    .limit(SESSION_PAGE)
    .session(session ?? null)
    .lean())
    .map((row) => row.telephony_session_id)
    .filter((value): value is string => Boolean(value));
  const out: NumberLeadSnapshot[] = [];
  for (const model of ["FormLead", "CallLead"] as const) {
    const or: Array<Record<string, unknown>> = leadPhoneMatchClauses(model, digits);
    if (model === "CallLead" && sessions.length) or.push({ "ringcentral.telephony_session_id": { $in: [...new Set(sessions)] } });
    if (!or.length) continue;
    const filter = { $or: or, duplicate: { $ne: true } };
    const rows = (model === "FormLead"
      ? await getFormLeadModel().find(filter, LEAD_LINK_PROJECTION).sort({ timestamp: -1, _id: -1 }).limit(CANDIDATE_PAGE).session(session ?? null).lean()
      : await getCallLeadModel().find(filter, LEAD_LINK_PROJECTION).sort({ timestamp: -1, _id: -1 }).limit(CANDIDATE_PAGE).session(session ?? null).lean()) as unknown as LeadRow[];
    for (const row of rows) if (isEligible(row) && !isExcluded(excluded, model, row._id)) out.push(leadSnapshot(model, row));
  }
  return out;
}

export async function loadLeadRow(ref: { model: LeadModel; id: unknown }, session?: ClientSession | null): Promise<LeadRow | null> {
  if (!mongoose.isValidObjectId(String(ref.id))) return null;
  const id = oid(ref.id);
  return (ref.model === "FormLead"
    ? await getFormLeadModel().findById(id, LEAD_LINK_PROJECTION).session(session ?? null).lean()
    : await getCallLeadModel().findById(id, LEAD_LINK_PROJECTION).session(session ?? null).lean()) as unknown as LeadRow | null;
}

type StoredNumber = {
  _id: mongoose.Types.ObjectId;
  revision: number;
  e164: string;
  national_ten?: string | null;
  purged_at?: Date | null;
  provider_names?: string[];
  search_terms?: string[];
  lead?: NumberLeadSnapshot | null;
  other_leads?: NumberLeadSnapshot[];
  lead_link?: StoredLeadLink | null;
};
const NUMBER_PROJECTION = { revision: 1, e164: 1, national_ten: 1, purged_at: 1, provider_names: 1, search_terms: 1, lead: 1, other_leads: 1, lead_link: 1 } as const;

export function normalizeStoredLink(link: StoredLeadLink | null | undefined): StoredLeadLink | null {
  if (!link) return null;
  return { source: link.source === "owner" ? "owner" : "automatic", set_at: link.set_at ?? null, set_by: link.set_by ?? null,
    excluded: (link.excluded ?? []).map((e) => ({ model: e.model, id: oid(e.id) })) };
}

export type LeadLinkChange = {
  number_id: string;
  changed: boolean;
  revision: number;
  before: { lead: LeadKey | null; leads: LeadKey[] };
  after: { lead: LeadKey | null; leads: LeadKey[] };
  /** The planned fields (written unless `dry_run`). */
  next: LeadLinkFields;
};
const keyOf = (lead: { model: LeadModel; id: unknown }): LeadKey => ({ model: lead.model, id: String(lead.id) });
function linkKeys(fields: { lead?: NumberLeadSnapshot | null; other_leads?: NumberLeadSnapshot[] | null }) {
  const lead = fields.lead ? keyOf(fields.lead) : null;
  return { lead, leads: [...(lead ? [lead] : []), ...(fields.other_leads ?? []).map(keyOf)] };
}

export type RecomputeOptions = {
  now?: Date;
  /** Replace the stored link before planning (an Owner pin or unlink); the plan then runs as usual. */
  link?: StoredLeadLink;
  /** Owner pin: the Lead to hold (any non-duplicate Lead, not only a candidate). */
  pin?: NumberLeadSnapshot;
  /** Fences the write on this revision (the Owner's displayed revision). */
  expected_revision?: number;
  /** Plan only: read, decide and report, write nothing (the v2 migration's dry run). */
  dry_run?: boolean;
};

/**
 * Recomputes and stores one number's lead link and its search terms, in the caller's transaction.
 * Returns what changed (the Lead keys before and after) so callers can wake the desk.
 */
export async function recomputeLeadLink(numberId: mongoose.Types.ObjectId | string, session: ClientSession | null, options: RecomputeOptions = {}): Promise<LeadLinkChange | null> {
  const now = options.now ?? new Date();
  const ContactNumber = getContactNumberModel();
  const number = (await ContactNumber.findById(oid(numberId), NUMBER_PROJECTION).session(session).lean()) as unknown as StoredNumber | null;
  if (!number || number.purged_at) return null;
  if (options.expected_revision !== undefined && number.revision !== options.expected_revision) throw new CsiError("REVISION_CONFLICT");
  const storedLink = normalizeStoredLink(number.lead_link);
  const link = options.link ?? storedLink;
  const candidates = await loadLeadCandidates(number, link?.excluded ?? [], session);
  let pinned: NumberLeadSnapshot | null = options.pin ?? null;
  if (!pinned && link?.source === "owner" && number.lead) {
    const row = await loadLeadRow(number.lead, session);
    pinned = row && row.duplicate !== true ? leadSnapshot(number.lead.model, row) : null;
  }
  const next = planLeadLink({ candidates, current: { lead: number.lead ?? null, lead_link: link }, pinned, now });
  const terms = boundSearchTerms([
    ...(number.provider_names ?? []).map((name) => name.toLowerCase()),
    ...leadLinkSearchTerms(next),
  ]);
  const before = linkKeys(number);
  const after = linkKeys(next);
  const same = stableJson({ lead: number.lead ?? null, other_leads: number.other_leads ?? [], lead_link: storedLink }) === stableJson(next)
    && stableJson([...(number.search_terms ?? [])].sort()) === stableJson([...terms].sort());
  if (same) return { number_id: String(number._id), changed: false, revision: number.revision, before, after, next };
  if (options.dry_run) return { number_id: String(number._id), changed: true, revision: number.revision, before, after, next };
  const result = await ContactNumber.updateOne(
    { _id: number._id, revision: number.revision },
    { $set: { lead: next.lead, other_leads: next.other_leads, lead_link: next.lead_link, search_terms: terms }, $inc: { revision: 1 } },
    { session: session ?? undefined, runValidators: true },
  );
  if (result.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
  const change = { number_id: String(number._id), changed: true, revision: number.revision + 1, before, after, next };
  // The desk credits calls to `lead` and scopes subjects by `lead`/`other_leads`: wake it in this transaction.
  if (session) await enqueueDeskWakeForLeadLink(change, session, now);
  return change;
}

/** The E.164 numbers a Lead's phone paths carry (live, ingested, Granot, RingCentral original caller). */
export function leadPhoneE164s(row: LeadRow): string[] {
  const values = [row.normalized_phone_number, row.ingested_contact_snapshot?.normalized_phone_number,
    row.granot_contact_snapshot?.normalized_phone_number, row.ringcentral?.original_caller?.normalized_phone_number];
  return [...new Set(values.map((value) => toE164(value ?? "")).filter((value): value is string => Boolean(value)))];
}

/** Bound on the numbers one Lead change recomputes. */
export const LEAD_NUMBERS_MAX = 50;

/**
 * Every number whose link one Lead can enter or leave: the numbers of its phones, the numbers of
 * the call that created a Call Lead, and the numbers that list it now (to drop it after a phone
 * change, a Duplicate or Bad Lead mark). Read in the caller's session.
 */
export async function numbersForLead(ref: { model: LeadModel; id: string }, row: LeadRow | null, session?: ClientSession | null): Promise<string[]> {
  const ids = new Set<string>();
  const ContactNumber = getContactNumberModel();
  const e164s = row ? leadPhoneE164s(row) : [];
  if (e164s.length) {
    for (const number of await ContactNumber.find({ e164: { $in: e164s }, purged_at: null }, { _id: 1 }).session(session ?? null).lean())
      ids.add(String(number._id));
  }
  const telephonySession = ref.model === "CallLead" ? row?.ringcentral?.telephony_session_id : null;
  if (telephonySession) {
    const calls = await getCallInteractionModel()
      .find({ provider: "ringcentral", telephony_session_id: telephonySession, merged_into_id: null, contact_number_id: { $ne: null } }, { contact_number_id: 1 })
      .limit(10)
      .session(session ?? null)
      .lean();
    for (const call of calls) if (call.contact_number_id) ids.add(String(call.contact_number_id));
  }
  const id = oid(ref.id);
  for (const number of await ContactNumber.find({ $or: [{ "lead.id": id }, { "other_leads.id": id }] }, { _id: 1 })
    .limit(LEAD_NUMBERS_MAX)
    .session(session ?? null)
    .lean())
    ids.add(String(number._id));
  return [...ids].sort().slice(0, LEAD_NUMBERS_MAX);
}
