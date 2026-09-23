/**
 * H5 sole-match identity (Lead progress spec §5.1, §13.3 H5; policy `sole-match-v1`).
 *
 * `completeNormalizedMatchSet` answers one question for one Contact Number, inside the
 * caller's transaction: which non-duplicate Form Leads and Call Leads currently carry this
 * number on an indexed normalized phone path, and is that answer complete? It searches both
 * Lead models together, across every Source Company, including Leads that have no
 * attachment edge yet. It never reads names, suffixes or a single call's source.
 *
 * Unknown (never a match): no lookup digits, a model page over `MATCH_SET_PAGE`, or a
 * current match that only an unindexed raw Granot `phone_number`/`phone` carries (found
 * through that Lead's existing edge evidence; see `leadContactPhoneIndexes.ts`). A raw-only
 * Granot Lead that has never been through `persistLeadAttachments` has no edge, so this
 * lookup cannot see it; that is a documented limitation, not a corpus scan.
 *
 * `planSoleMatch` is the pure decision over that set and the number's current edges.
 */
import type { ClientSession } from "mongoose";
import { getFormLeadModel } from "../../../models/FormLead";
import { getCallLeadModel } from "../../../models/CallLead";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import {
  CALL_LEAD_ATTACHMENT_PHONE_PATHS,
  FORM_LEAD_ATTACHMENT_PHONE_PATHS,
  leadPhoneMatchClauses,
} from "../../../models/leadContactPhoneIndexes";
import { toE164 } from "../../numberActivity/phone";
import type { LeadRef } from "./suggest";

export const SOLE_MATCH_POLICY_VERSION = "sole-match-v1";
export const SOLE_MATCH_REASON = "sole_non_duplicate_match";
export const AUTO_ATTACH_CONTESTED_REASON = "auto_attach_contested";
export const AUTO_ATTACH_WITHDRAWN_REASON = "auto_attach_withdrawn";
/** Per-model lookup page. Reaching it makes the set Unknown, never a match. */
export const MATCH_SET_PAGE = 250;
export const UNINDEXED_GRANOT_FIELDS = ["granot_contact_snapshot.phone_number", "granot_contact_snapshot.phone"] as const;

export type MatchCandidate = {
  lead_ref: LeadRef; duplicate: boolean; bad_lead: boolean; no_sync: boolean; booked: boolean; cancelled: boolean;
  source_company: string | null; sources: string[]; timestamp: Date;
};
export type MatchSetResult = {
  status: "complete" | "unknown";
  reason?: "unindexed_evidence" | "page_exceeded" | "no_digits";
  /** Non-duplicate only; duplicates are neither targets nor competitors. */
  candidates: MatchCandidate[];
  /** The sole eligible target when complete, exactly one candidate, and not Bad Lead/No-Sync. */
  target: LeadRef | null;
};

type Snapshot = { normalized_phone_number?: string | null; phone_number?: string | null; phone?: string | null } | null | undefined;
export type MatchLeadRow = {
  _id: { toString(): string }; timestamp?: Date | null; duplicate?: boolean | null; bad_lead?: unknown; no_sync?: boolean | null;
  booked?: unknown; cancelled?: unknown; source_company?: string | null;
  normalized_phone_number?: string | null; ingested_contact_snapshot?: Snapshot; granot_contact_snapshot?: Snapshot;
  ringcentral?: { original_caller?: Snapshot } | null;
};

/**
 * The join key for a number, as the Lead collections store it: the ten-digit NANP form
 * (`contact_numbers.national_ten`), else the E.164 digit string (14 §3).
 */
export function numberLookupDigits(number: { national_ten?: string | null; e164?: string | null }): string[] {
  const ten = number.national_ten?.trim();
  if (ten) return [ten];
  const digits = number.e164?.replace(/\D/g, "") ?? "";
  return digits ? [digits] : [];
}

function valueAt(row: MatchLeadRow, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), row);
}
/** Which indexed normalized paths on this Lead carry one of the lookup digits. */
export function matchedSources(model: LeadRef["model"], row: MatchLeadRow, digits: readonly string[]): string[] {
  const paths = model === "FormLead" ? FORM_LEAD_ATTACHMENT_PHONE_PATHS : CALL_LEAD_ATTACHMENT_PHONE_PATHS;
  return paths.filter(path => { const value = valueAt(row, path); return typeof value === "string" && digits.includes(value.trim()); });
}

/** Pure: build the result from looked-up rows. Deduplicates by `{model,id}`, drops duplicates. */
export function decideMatchSet(input: {
  digits: readonly string[]; rows: ReadonlyArray<{ model: LeadRef["model"]; row: MatchLeadRow }>;
  pageExceeded?: boolean; unindexed?: boolean;
}): MatchSetResult {
  const byRef = new Map<string, MatchCandidate>();
  for (const { model, row } of input.rows) {
    if (row.duplicate === true) continue;
    const key = `${model}:${String(row._id)}`;
    const sources = matchedSources(model, row, input.digits);
    const prior = byRef.get(key);
    if (prior) { prior.sources = [...new Set([...prior.sources, ...sources])]; continue; }
    byRef.set(key, { lead_ref: { model, id: String(row._id) }, duplicate: false, bad_lead: Boolean(row.bad_lead),
      no_sync: row.no_sync === true, booked: Boolean(row.booked), cancelled: Boolean(row.cancelled),
      source_company: row.source_company ?? null, sources, timestamp: row.timestamp ?? new Date(0) });
  }
  const candidates = [...byRef.values()].sort((a, b) =>
    a.lead_ref.model.localeCompare(b.lead_ref.model) || a.lead_ref.id.localeCompare(b.lead_ref.id));
  const reason = !input.digits.length ? "no_digits" as const : input.pageExceeded ? "page_exceeded" as const
    : input.unindexed ? "unindexed_evidence" as const : undefined;
  if (reason) return { status: "unknown", reason, candidates, target: null };
  const sole = candidates.length === 1 ? candidates[0]! : null;
  return { status: "complete", candidates, target: sole && !sole.bad_lead && !sole.no_sync ? sole.lead_ref : null };
}

const PROJECTION = {
  _id: 1, timestamp: 1, duplicate: 1, bad_lead: 1, no_sync: 1, booked: 1, cancelled: 1, source_company: 1,
  normalized_phone_number: 1, "ingested_contact_snapshot.normalized_phone_number": 1,
  "granot_contact_snapshot.normalized_phone_number": 1, "ringcentral.original_caller.normalized_phone_number": 1,
} as const;

/**
 * A current match the indexed lookup cannot see: an edge on this number whose evidence came
 * from a raw Granot field, for a non-duplicate Lead outside the indexed set whose current
 * Granot snapshot still has no normalized phone and whose raw phone still equals this number.
 */
async function unindexedGranotMatch(number: { _id: unknown; e164?: string | null }, seen: ReadonlySet<string>, session: ClientSession) {
  const edges = await getNumberLeadAttachmentModel().find({ contact_number_id: String(number._id),
    "evidence.field_path": { $in: [...UNINDEXED_GRANOT_FIELDS] } }, { lead_ref: 1 }).session(session).lean();
  for (const edge of edges) {
    const model = edge.lead_ref.model, id = String(edge.lead_ref.id);
    if (seen.has(`${model}:${id}`)) continue;
    const projection = { duplicate: 1, granot_contact_snapshot: 1 };
    const lead = model === "FormLead" ? await getFormLeadModel().findById(id, projection).session(session).lean()
      : await getCallLeadModel().findById(id, projection).session(session).lean();
    const snapshot = lead?.granot_contact_snapshot as Snapshot;
    if (!lead || lead.duplicate === true || !snapshot || snapshot.normalized_phone_number) continue;
    const raw = toE164(snapshot.phone_number ?? snapshot.phone ?? null);
    if (raw && number.e164 && raw === number.e164) return true;
  }
  return false;
}

/** Complete normalized match set for one Contact Number, read in the caller's transaction. */
export async function completeNormalizedMatchSet(
  number: { _id: unknown; national_ten?: string | null; e164?: string | null },
  session: ClientSession,
): Promise<MatchSetResult> {
  const digits = numberLookupDigits(number);
  if (!digits.length) return decideMatchSet({ digits, rows: [] });
  const rows: Array<{ model: LeadRef["model"]; row: MatchLeadRow }> = [];
  let pageExceeded = false;
  for (const model of ["FormLead", "CallLead"] as const) {
    const filter = { $or: leadPhoneMatchClauses(model, digits), duplicate: { $ne: true } };
    const found: MatchLeadRow[] = model === "FormLead"
      ? await getFormLeadModel().find(filter, PROJECTION).sort({ _id: 1 }).limit(MATCH_SET_PAGE + 1).session(session).lean()
      : await getCallLeadModel().find(filter, PROJECTION).sort({ _id: 1 }).limit(MATCH_SET_PAGE + 1).session(session).lean();
    if (found.length > MATCH_SET_PAGE) pageExceeded = true;
    for (const row of found.slice(0, MATCH_SET_PAGE)) rows.push({ model, row });
  }
  const seen = new Set(rows.map(r => `${r.model}:${String(r.row._id)}`));
  const unindexed = !pageExceeded && await unindexedGranotMatch(number, seen, session);
  return decideMatchSet({ digits, rows, pageExceeded, unindexed });
}

export type PlanEdge = {
  id: string; lead_ref: LeadRef; state: "candidate" | "ambiguous" | "attached" | "rejected";
  certainty: "exact" | "likely" | "unsure" | "owner_confirmed" | "rejected";
  decided_at?: Date | null; automatic: boolean; has_phone_evidence: boolean;
};
export type SoleMatchPlan = {
  /** Automatic edges a known non-duplicate competitor contests: demote to Ambiguous, open identity review. */
  contest: string[];
  /** Automatic edges whose Lead left a complete set (phone moved, became duplicate): demote to Candidate. */
  withdraw: string[];
  /** The edge to write Attached/Likely, if any. */
  attach: string | null;
  blocked: null | "unknown" | "no_candidate" | "competing_candidates" | "ineligible_target" | "target_edge_missing"
    | "owner_decision" | "already_attached" | "no_phone_evidence" | "competing_attached";
};
const sameLead = (a: LeadRef, b: LeadRef) => a.model === b.model && a.id === b.id;
/** An automatic decision: attached, Likely, never Owner-decided, with an automatic record. */
export const isAutomaticEdge = (edge: Pick<PlanEdge, "state" | "certainty" | "decided_at" | "automatic">) =>
  edge.state === "attached" && edge.certainty === "likely" && !edge.decided_at && edge.automatic;

/**
 * Pure sole-match decision. Owner-decided (`decided_at`), rejected, Exact and Owner-confirmed
 * edges are never changed. A competitor is known when the set holds two or more non-duplicate
 * Leads, or a page overflowed (which only happens with more than the page of non-duplicates).
 */
export function planSoleMatch(set: MatchSetResult, edges: readonly PlanEdge[]): SoleMatchPlan {
  const inSet = (ref: LeadRef) => set.candidates.some(c => sameLead(c.lead_ref, ref));
  const competition = set.candidates.length >= 2 || set.reason === "page_exceeded";
  const contest: string[] = [], withdraw: string[] = [];
  for (const edge of edges.filter(isAutomaticEdge)) {
    if (competition && (inSet(edge.lead_ref) || set.reason === "page_exceeded")) contest.push(edge.id);
    else if (set.status === "complete" && !inSet(edge.lead_ref)) withdraw.push(edge.id);
  }
  const plan = (blocked: SoleMatchPlan["blocked"], attach: string | null = null): SoleMatchPlan => ({ contest, withdraw, attach, blocked });
  if (set.status !== "complete") return plan("unknown");
  if (!set.candidates.length) return plan("no_candidate");
  if (set.candidates.length > 1) return plan("competing_candidates");
  if (!set.target) return plan("ineligible_target");
  const target = edges.find(e => sameLead(e.lead_ref, set.target!));
  if (!target) return plan("target_edge_missing");
  if (target.state === "rejected" || target.decided_at) return plan("owner_decision");
  if (target.state === "attached") return plan("already_attached");
  if (!target.has_phone_evidence) return plan("no_phone_evidence");
  const moved = new Set([...contest, ...withdraw]);
  if (edges.some(e => e.state === "attached" && !moved.has(e.id) && !sameLead(e.lead_ref, set.target!))) return plan("competing_attached");
  return plan(null, target.id);
}
