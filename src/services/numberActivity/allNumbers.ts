import mongoose from "mongoose";
import { z } from "zod";
import { getCallInteractionModel } from "../../models/CallInteraction";
import { getCallLeadModel } from "../../models/CallLead";
import { getContactNumberModel, resolveCreatedVia } from "../../models/ContactNumber";
import { getFormLeadModel } from "../../models/FormLead";
import { leadPhoneMatchClauses } from "../../models/leadContactPhoneIndexes";
import { getSalesOutreachSubjectModel } from "../../models/salesOutreach";
import {
  allNumbersPageDtoSchema,
  leadSearchDtoSchema,
  numberDetailDtoSchema,
  type AllNumbersQuery,
  type LeadRefDto,
  type NumberDetailDto,
  type NumberLeadCommand,
  type NumberRowDto,
} from "../../validation/v1/allNumbers";
import { csiDateSchema, csiIdSchema } from "../../validation/v1/salesIntelligence";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import { CsiError, type CsiActor } from "../salesIntelligence/auth";
import { appendCsiAudit, executeCsiCommand, payloadHash } from "../salesIntelligence/transactions";
import { callResult, summaryCallFilter } from "./callSummary";
import { agentNameAt, callUserParty, loadRepLinksForExtensions, type RepLinkLean } from "./callRep";
import {
  LEAD_LINK_PROJECTION,
  leadSnapshot,
  loadLeadRow,
  newestFirst,
  normalizeStoredLink,
  recomputeLeadLink,
  sameLead,
  type LeadModel,
  type LeadRow,
  type NumberLeadSnapshot,
  type StoredLeadLink,
} from "./leadLink";
import { escapeRegex, parseSearchTerm } from "./search";

/**
 * All Numbers reads and the Owner's link command (all-numbers CONTRACT §4.1–§4.4). Reads never
 * mutate. Every number read is one `contact_numbers` page plus batched reads for the page's desk
 * subjects and Rep Identity Links, whatever the page size.
 */
const iso = (value: Date | string) => new Date(value).toISOString();
const oid = (value: unknown) => new mongoose.Types.ObjectId(String(value));

/** "(555) 123-4567" for a US number, else the E.164 itself. */
export function displayPhone(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164;
}

export type StoredNumberV2 = {
  _id: mongoose.Types.ObjectId;
  revision: number;
  e164: string;
  provider_names?: string[] | null;
  created_via?: string | null;
  first_observed_at: Date;
  last_activity_at: Date;
  lead?: NumberLeadSnapshot | null;
  other_leads?: NumberLeadSnapshot[] | null;
  lead_link?: StoredLeadLink | null;
  last_call?: {
    at: Date;
    direction: "inbound" | "outbound";
    result: "answered" | "missed" | "voicemail";
    duration_seconds?: number | null;
    rc_extension_id?: string | null;
  } | null;
  calls?: { inbound?: number; outbound?: number; missed?: number } | null;
  waiting_since?: Date | null;
};
const ROW_PROJECTION = {
  revision: 1, e164: 1, provider_names: 1, created_via: 1, first_observed_at: 1, last_activity_at: 1,
  lead: 1, other_leads: 1, lead_link: 1, last_call: 1, calls: 1, waiting_since: 1,
} as const;

export type RowContext = { subjects: ReadonlyMap<string, string>; links: readonly RepLinkLean[] };
const subjectKey = (lead: { model: string; id: unknown }) => `${lead.model}:${String(lead.id)}`;

export function toLeadRef(lead: NumberLeadSnapshot, subjects: ReadonlyMap<string, string>): LeadRefDto {
  return {
    model: lead.model,
    id: String(lead.id),
    name: lead.name ?? null,
    job_no: lead.job_no ?? null,
    rep_name: lead.receiver_agent_name ?? null,
    received_at: iso(lead.received_at),
    state: lead.state,
    desk_subject_id: subjects.get(subjectKey(lead)) ?? null,
  };
}

/** Pure mapper for one All Numbers row (§4.1). A number the v2 migration has not reached reads as zero calls. */
export function toNumberRow(row: StoredNumberV2, context: RowContext): NumberRowDto {
  const names = row.provider_names ?? [];
  const last = row.last_call ?? null;
  return {
    id: String(row._id),
    revision: row.revision,
    e164: row.e164,
    display: displayPhone(row.e164) ?? row.e164,
    caller_name: names.at(-1)?.trim() || null,
    source: resolveCreatedVia(row.created_via),
    lead: row.lead ? toLeadRef(row.lead, context.subjects) : null,
    lead_link: row.lead_link?.source === "owner" ? "owner" : "automatic",
    last_call: last
      ? { at: iso(last.at), direction: last.direction, result: last.result, duration_seconds: last.duration_seconds ?? null,
        agent_name: agentNameAt(context.links, last.rc_extension_id ?? null, new Date(last.at)) }
      : null,
    calls: { inbound: row.calls?.inbound ?? 0, outbound: row.calls?.outbound ?? 0, missed: row.calls?.missed ?? 0 },
    waiting_since: row.waiting_since ? iso(row.waiting_since) : null,
    first_seen_at: iso(row.first_observed_at),
    last_activity_at: iso(row.last_activity_at),
  };
}

/** The desk subject id of each Lead that has one (`sod_subject_lead_unique`). */
export async function loadDeskSubjectIds(leads: ReadonlyArray<{ model: string; id: unknown }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const or = (["FormLead", "CallLead"] as const).flatMap((model) => {
    const ids = [...new Set(leads.filter((lead) => lead.model === model).map((lead) => String(lead.id)))].map(oid);
    return ids.length ? [{ lead_model: model, lead_id: { $in: ids } }] : [];
  });
  if (!or.length) return out;
  const rows = (await getSalesOutreachSubjectModel().find({ $or: or }, { lead_model: 1, lead_id: 1 }).lean()) as unknown as Array<{ _id: unknown; lead_model: string; lead_id: unknown }>;
  for (const row of rows) out.set(`${row.lead_model}:${String(row.lead_id)}`, String(row._id));
  return out;
}

async function rowContext(rows: readonly StoredNumberV2[], extraLeads: ReadonlyArray<{ model: string; id: unknown }> = [], extraExtensions: readonly (string | null)[] = []): Promise<RowContext> {
  const leads = [...rows.flatMap((row) => (row.lead ? [row.lead] : [])), ...extraLeads];
  const [subjects, links] = [await loadDeskSubjectIds(leads),
    await loadRepLinksForExtensions([...rows.map((row) => row.last_call?.rc_extension_id ?? null), ...extraExtensions])];
  return { subjects, links };
}

// ── §4.1 GET /numbers ──────────────────────────────────────────────────────

type AllNumbersCursor = { view: "all" | "waiting"; at: string; id: string };
const cursorSchema = z.object({ view: z.enum(["all", "waiting"]), at: csiDateSchema, id: csiIdSchema }).strict();
export function encodeAllNumbersCursor(cursor: AllNumbersCursor): string {
  return Buffer.from(JSON.stringify(cursorSchema.parse(cursor))).toString("base64url");
}
/** Throws `CURSOR_EXPIRED` (409) on anything that is not this view's cursor: the client restarts from page one. */
export function decodeAllNumbersCursor(encoded: string, view: AllNumbersCursor["view"]): AllNumbersCursor {
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    if (cursor.view !== view) throw new Error("view");
    return cursor;
  } catch {
    throw new CsiError("CURSOR_EXPIRED", [{ path: "cursor", code: "invalid_cursor" }]);
  }
}

/**
 * Pure filter and sort. `all`: `(last_activity_at desc, _id desc)`; `waiting`: numbers with a
 * `waiting_since`, longest wait first `(waiting_since asc, _id asc)`. `q` is today's Numbers search:
 * ≥ 10 digits = exact E.164 or suffix, 3–9 digits = suffix, else an anchored prefix of a caller
 * name, Lead name, Job Number or rep (`search_terms`).
 */
export function allNumbersFilter(query: Pick<AllNumbersQuery, "view" | "q">, cursor: AllNumbersCursor | null) {
  const filter: Record<string, unknown> = { purged_at: null };
  const and: Array<Record<string, unknown>> = [];
  if (query.view === "waiting") filter.waiting_since = { $type: "date" };
  const term = parseSearchTerm(query.q);
  if (term.kind === "e164") and.push({ $or: [{ e164: term.e164 }, { digits_reversed: { $regex: `^${term.reversed}` } }] });
  else if (term.kind === "suffix") filter.digits_reversed = { $regex: `^${term.reversed}` };
  else if (term.kind === "term") filter.search_terms = { $regex: `^${escapeRegex(term.term)}` };
  if (cursor) {
    const at = new Date(cursor.at), id = oid(cursor.id);
    const field = query.view === "waiting" ? "waiting_since" : "last_activity_at";
    const beyond = query.view === "waiting" ? "$gt" : "$lt";
    and.push({ $or: [{ [field]: { [beyond]: at } }, { [field]: at, _id: { [beyond]: id } }] });
  }
  if (and.length) filter.$and = and;
  const sort: Record<string, 1 | -1> = query.view === "waiting" ? { waiting_since: 1, _id: 1 } : { last_activity_at: -1, _id: -1 };
  return { filter, sort };
}

export async function listAllNumbers(query: AllNumbersQuery, deps: { now?: () => Date } = {}) {
  const asOf = (deps.now ?? (() => new Date()))();
  const cursor = query.cursor ? decodeAllNumbersCursor(query.cursor, query.view) : null;
  const { filter, sort } = allNumbersFilter(query, cursor);
  const ContactNumber = getContactNumberModel();
  const rows = (await ContactNumber.find(filter, ROW_PROJECTION).sort(sort).limit(query.limit + 1).lean()) as unknown as StoredNumberV2[];
  const page = rows.slice(0, query.limit);
  const [all, waiting, context] = [
    await ContactNumber.countDocuments({ purged_at: null }),
    await ContactNumber.countDocuments({ purged_at: null, waiting_since: { $type: "date" } }),
    await rowContext(page),
  ];
  const last = page.at(-1);
  const next = rows.length > query.limit && last
    ? encodeAllNumbersCursor({ view: query.view, at: iso(query.view === "waiting" ? last.waiting_since! : last.last_activity_at), id: String(last._id) })
    : null;
  return {
    as_of: asOf.toISOString(),
    data: allNumbersPageDtoSchema.parse({ items: page.map((row) => toNumberRow(row, context)), cursor: next, counts: { all, waiting } }),
  };
}

// ── §4.2 GET /numbers/:id ──────────────────────────────────────────────────

export const NUMBER_DETAIL_CALLS = 100;
type CallLean = {
  _id: unknown;
  provider_account_id: string;
  direction: string;
  started_at: Date;
  provider_connected?: boolean;
  contact_type?: string;
  provider_result?: string | null;
  duration_seconds?: number | null;
  company_e164?: string | null;
  recordings?: unknown[];
  parties?: Array<{ role: string; connected?: boolean; extension_id?: string | null }>;
};

/** Lead refs for stored link entries; an excluded Lead whose row is gone is left out. */
async function excludedLeadSnapshots(excluded: StoredLeadLink["excluded"]): Promise<NumberLeadSnapshot[]> {
  const out: NumberLeadSnapshot[] = [];
  for (const ref of excluded) {
    const row = await loadLeadRow(ref);
    if (row) out.push(leadSnapshot(ref.model, row));
  }
  return out.sort(newestFirst);
}

export async function readNumberDetail(numberId: string, deps: { now?: () => Date } = {}): Promise<{ as_of: string; data: NumberDetailDto } | null> {
  if (!csiIdSchema.safeParse(numberId).success) return null;
  const asOf = (deps.now ?? (() => new Date()))();
  const row = (await getContactNumberModel().findOne({ _id: oid(numberId), purged_at: null }, ROW_PROJECTION).lean()) as unknown as StoredNumberV2 | null;
  if (!row) return null;
  const calls = (await getCallInteractionModel()
    .find(summaryCallFilter(row._id), { provider_account_id: 1, direction: 1, started_at: 1, provider_connected: 1, contact_type: 1, provider_result: 1,
      duration_seconds: 1, company_e164: 1, recordings: 1, "parties.role": 1, "parties.connected": 1, "parties.extension_id": 1 })
    .sort({ started_at: -1, _id: -1 })
    .limit(NUMBER_DETAIL_CALLS + 1)
    .lean()) as unknown as CallLean[];
  const shown = calls.slice(0, NUMBER_DETAIL_CALLS);
  const link = normalizeStoredLink(row.lead_link);
  const excluded = await excludedLeadSnapshots(link?.excluded ?? []);
  const others = row.other_leads ?? [];
  const context = await rowContext([row], [...others, ...excluded], shown.map((call) => callUserParty(call)?.extension_id ?? null));
  return {
    as_of: asOf.toISOString(),
    data: numberDetailDtoSchema.parse({
      number: toNumberRow(row, context),
      other_leads: others.map((lead) => toLeadRef(lead, context.subjects)),
      excluded_leads: excluded.map((lead) => toLeadRef(lead, context.subjects)),
      calls: shown.map((call) => ({
        id: String(call._id),
        at: iso(call.started_at),
        direction: call.direction === "Inbound" ? "inbound" : "outbound",
        result: callResult(call),
        duration_seconds: typeof call.duration_seconds === "number" ? call.duration_seconds : null,
        agent_name: agentNameAt(context.links, callUserParty(call)?.extension_id ?? null, call.started_at),
        our_number: displayPhone(call.company_e164 ?? null),
        recordings: call.recordings?.length ?? 0,
      })),
      more_calls: calls.length > NUMBER_DETAIL_CALLS,
    }),
  };
}

// ── §4.4 GET /numbers/lead-search ──────────────────────────────────────────

export const LEAD_SEARCH_LIMIT = 20;

/**
 * The "Link to a lead" picker: Leads whose name, Job Number or phone matches `q`, Duplicates
 * excluded, newest first, at most 20. Digits (≥ 3) match a Job Number prefix and a phone: ten digits
 * exactly on the indexed phone paths, fewer anywhere in the live phone. Text matches a Job Number
 * prefix and anywhere in the name, case-insensitively.
 */
export function leadSearchFilters(q: string): Partial<Record<LeadModel, Record<string, unknown>>> {
  const trimmed = q.trim();
  const digits = trimmed.replace(/[\s().+-]/g, "");
  const job = normalizeJobNo(trimmed);
  const or = (model: LeadModel): Array<Record<string, unknown>> => {
    const clauses: Array<Record<string, unknown>> = [];
    if (job) clauses.push({ normalized_job_no: { $regex: `^${escapeRegex(job)}` } });
    if (/^\d{3,}$/.test(digits)) {
      const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
      if (ten.length === 10) clauses.push(...leadPhoneMatchClauses(model, [ten]));
      else clauses.push({ normalized_phone_number: { $regex: escapeRegex(digits) } });
    } else {
      clauses.push({ name: { $regex: escapeRegex(trimmed), $options: "i" } });
    }
    return clauses;
  };
  return {
    FormLead: { $or: or("FormLead"), duplicate: { $ne: true } },
    CallLead: { $or: or("CallLead"), duplicate: { $ne: true } },
  };
}

export async function searchLeadsForLink(q: string, deps: { now?: () => Date } = {}) {
  const asOf = (deps.now ?? (() => new Date()))();
  const filters = leadSearchFilters(q);
  const found: Array<{ snapshot: NumberLeadSnapshot; phone: string | null }> = [];
  for (const model of ["FormLead", "CallLead"] as const) {
    const filter = filters[model]!;
    const rows = (model === "FormLead"
      ? await getFormLeadModel().find(filter, LEAD_LINK_PROJECTION).sort({ timestamp: -1, _id: -1 }).limit(LEAD_SEARCH_LIMIT).lean()
      : await getCallLeadModel().find(filter, LEAD_LINK_PROJECTION).sort({ timestamp: -1, _id: -1 }).limit(LEAD_SEARCH_LIMIT).lean()) as unknown as LeadRow[];
    for (const row of rows) {
      const ten = row.normalized_phone_number?.trim();
      found.push({ snapshot: leadSnapshot(model, row), phone: ten ? displayPhone(/^\d{10}$/.test(ten) ? `+1${ten}` : ten) : null });
    }
  }
  const items = found.sort((a, b) => newestFirst(a.snapshot, b.snapshot)).slice(0, LEAD_SEARCH_LIMIT);
  const subjects = await loadDeskSubjectIds(items.map((item) => item.snapshot));
  return {
    as_of: asOf.toISOString(),
    data: leadSearchDtoSchema.parse({ items: items.map((item) => ({ ...toLeadRef(item.snapshot, subjects), phone: item.phone })) }),
  };
}

// ── §4.3 POST /numbers/:id/lead ────────────────────────────────────────────

export const NUMBER_LEAD_COMMAND = "number_lead_link";

/**
 * The Owner's pin or unlink, through the CSI command ledger (replay returns the committed result).
 * - `lead`: pin that Lead (`source: owner`), any non-duplicate Lead; it leaves `excluded`.
 * - `unlink`: exclude that Lead; when it was the number's Lead the link turns automatic. Then recompute.
 * A stale `revision` is `REVISION_CONFLICT`. Returns null when the number does not exist.
 */
export async function commandNumberLead(input: { actor: CsiActor; number_id: string; body: NumberLeadCommand; idempotency_key?: string }) {
  if (!csiIdSchema.safeParse(input.number_id).success) return null;
  const exists = await getContactNumberModel().exists({ _id: oid(input.number_id), purged_at: null });
  if (!exists) return null;
  const { scope: _scope, ...body } = input.body;
  const idempotency_key = input.idempotency_key ?? `numbers-lead:${input.number_id}:${body.revision}:${payloadHash(body).slice(0, 32)}`;
  const { response } = await executeCsiCommand({
    actor: input.actor,
    command: NUMBER_LEAD_COMMAND,
    idempotency_key,
    payload: { number_id: input.number_id, ...body },
    operation: async (context) => {
      const { session, now, actor } = context;
      const number = (await getContactNumberModel().findById(oid(input.number_id), { revision: 1, lead: 1, lead_link: 1, purged_at: 1 })
        .session(session).lean()) as unknown as { revision: number; lead?: NumberLeadSnapshot | null; lead_link?: StoredLeadLink | null; purged_at?: Date | null } | null;
      if (!number || number.purged_at) throw new CsiError("INVALID_INPUT", [{ path: "number", code: "not_found" }]);
      if (number.revision !== body.revision) throw new CsiError("REVISION_CONFLICT");
      const stored = normalizeStoredLink(number.lead_link) ?? { source: "automatic" as const, set_at: null, set_by: null, excluded: [] };
      let link: StoredLeadLink;
      let pin: NumberLeadSnapshot | undefined;
      if (body.lead) {
        const target = body.lead;
        const row = await loadLeadRow(target, session);
        if (!row) throw new CsiError("INVALID_INPUT", [{ path: "lead", code: "lead_not_found" }]);
        if (row.duplicate === true) throw new CsiError("INVALID_INPUT", [{ path: "lead", code: "lead_duplicate" }]);
        pin = leadSnapshot(target.model, row);
        link = { source: "owner", set_at: now, set_by: actor.id, excluded: stored.excluded.filter((e) => !sameLead(e, target)) };
      } else {
        const target = body.unlink!;
        const excluded = stored.excluded.some((e) => sameLead(e, target)) ? stored.excluded : [...stored.excluded, { model: target.model, id: oid(target.id) }];
        const wasLead = sameLead(number.lead, target);
        link = wasLead || stored.source !== "owner" ? { source: "automatic", set_at: stored.set_at, set_by: null, excluded } : { ...stored, excluded };
      }
      const change = await recomputeLeadLink(input.number_id, session, { now, link, pin, expected_revision: body.revision });
      if (!change) throw new CsiError("INVALID_INPUT", [{ path: "number", code: "not_found" }]);
      const lead = (key: { model: string; id: string } | null) => (key ? { model: key.model, id: key.id } : null);
      await appendCsiAudit(context, {
        kind: "number", target_id: input.number_id, subject_key: `number:${input.number_id}`, revision: change.revision,
        event_kind: body.lead ? "number_lead_pinned" : "number_lead_unlinked",
        prior: { revision: number.revision, lead: lead(change.before.lead), source: stored.source },
        current: { revision: change.revision, lead: lead(change.after.lead), source: link.source, changed: change.changed,
          ...(body.unlink ? { unlinked: { model: body.unlink.model, id: body.unlink.id } } : {}) },
      });
      return { number_id: input.number_id, revision: change.revision, changed: change.changed };
    },
  });
  return response;
}
