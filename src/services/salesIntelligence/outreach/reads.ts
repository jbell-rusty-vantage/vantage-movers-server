import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { z } from "zod";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getSalesIntelligenceContactRestrictionModel } from "../../../models/SalesIntelligenceContactRestriction";
import { getSalesIntelligenceReviewItemModel } from "../../../models/SalesIntelligenceReviewItem";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { getSalesIntelligenceAuditEventModel } from "../../../models/SalesIntelligenceAuditEvent";
import mongoose, { type InferSchemaType } from "mongoose";
import type { SalesIntelligenceReviewItemSchema } from "../../../models/SalesIntelligenceReviewItem";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import type { CsiPolicy } from "../../../validation/v1/salesIntelligence";
import { ownerRead, readCaptureCoverage } from "../../numberActivity/coverage";
import { attachedLeadProgressDtoSchema, leadProgressDtoSchema, outreachDtoSchema, reviewItemDtoSchema, restrictionDtoSchema, LIVE_CALL_WINDOW_MS, type AttachedLeadProgressDto, type CoverageDto, type LeadProgressDto, type LiveCallDto } from "../dto";
import { CALL_PROJECTION, readVantageSideContext, repClause, toCaseCall } from "../casefile/vantageSide";
import { resolvePolicy } from "../policy";
import { certaintyLabel } from "../attachment/suggest";
import { csiFlag } from "../../../config/domain/salesIntelligence";
import { getNumberLeadAttachmentModel as attachmentModel } from "../../../models/NumberLeadAttachment";
import { derive, attentionDue } from "./derive";
import { stateWithActions } from "./transitions";
import { subjectKey, type RecordRow, type FollowupRow } from "./types";
import { SUPERSEDED_BY_SPECIFIC_PLAN } from "./store";
import { CONTACT_FACT_FIELDS } from "./types";
import { nudgeHistoryPage } from "../nudges/reads";
import { basisLabel, dispositionLabel, isTerminal, priorityLabel, progressExplanation, CRM_CLOSURE_REASONS, type LeadProgressRow } from "./leadProgress";
import { moveAssessmentProjectionDto } from "../assessment/presentation";
import type { LeadMoveSource } from "../assessment/views";
import { outreachFacts } from "./facts";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { latestSummaryFromRun, officialStatus, outreachDetailDtoSchema } from "./detailDto";
import { EMPTY_SUGGESTION_SIDE, loadSuggestionSide, suggestedNextStep, type SuggestionSide } from "./suggestion";

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

/** §7: the stored projection as the Owner reads it. Labels are server words; nothing is derived in Admin. */
export function leadProgressDto(record: Pick<RecordRow, "subject" | "lead_progress" | "closed_reason" | "closed_at" | "closure_origin" | "first_attributable_outbound_at" | "first_human_conversation_at">): LeadProgressDto | null {
  const row = record.lead_progress as LeadProgressRow | null | undefined;
  if (!row || record.subject.kind !== "lead" || !record.subject.model || !record.subject.id) return null;
  const closed = record.closure_origin === "crm_disposition" && (CRM_CLOSURE_REASONS as readonly string[]).includes(record.closed_reason ?? "");
  return leadProgressDtoSchema.parse({
    lead_ref: { model: record.subject.model, id: String(record.subject.id) },
    granot_priority: row.granot_priority, priority_label: priorityLabel(row.granot_priority), quoted: row.quoted,
    disposition: row.disposition, disposition_label: dispositionLabel(row.disposition),
    work_observed: row.work_observed, basis: row.basis, basis_label: basisLabel(row.basis), provenance: row.provenance,
    source_origin: row.source_origin, source_applied_at: iso(row.source_applied_at), last_progress_at: iso(row.last_progress_at),
    first_work_observed_at: iso(row.first_work_observed_at),
    closure: closed ? { basis: record.closed_reason, closed_at: iso(record.closed_at) } : null,
    override: row.override ? { reason: row.override.reason, decided_at: iso(row.override.decided_at), decided_by: row.override.decided_by, disposition_revision: row.override.disposition_revision } : null,
    reopen_review_id: row.reopen_review_id ? String(row.reopen_review_id) : null,
    disposition_revision: row.disposition_revision,
    explanation: progressExplanation(row),
    no_call_observed: row.work_observed && !record.first_attributable_outbound_at && !record.first_human_conversation_at,
    projected_at: iso(row.projected_at),
  });
}

/**
 * Number list/detail helper (§7, §11.3): the Lead progress and Booking of the one
 * Lead a Number resolves to, or an explicit `multiple` / `none`. Batched for a
 * page: one edges query, one Outreach query, the side-data reads, and one
 * pending-assessment `distinct`. Reads only; never merges facts from different Leads.
 * V15 / D5: only `resolved` carries `move_assessment` and `lead_status`.
 */
export async function loadAttachedLeadProgressForNumbers(numberIds: readonly string[], now: Date): Promise<Map<string, AttachedLeadProgressDto>> {
  void now;
  const out = new Map<string, AttachedLeadProgressDto>();
  if (!numberIds.length) return out;
  const ids = numberIds.map(id => new mongoose.Types.ObjectId(id));
  const edges = await attachmentModel().find({ contact_number_id: { $in: ids }, state: { $ne: "rejected" } }).lean();
  const byNumber = new Map<string, typeof edges>();
  for (const edge of edges) { const key = String(edge.contact_number_id); byNumber.set(key, [...(byNumber.get(key) ?? []), edge]); }
  const resolved = new Map<string, AttachedLeadRef>();
  for (const id of numberIds) {
    const pick = resolveAttachedLead(byNumber.get(id) ?? []);
    if (pick.status === "resolved") resolved.set(id, pick.ref); else out.set(id, { status: pick.status });
  }
  const refs = [...resolved.values()];
  if (!refs.length) return out;
  const records = await getOutreachRecordModel().find({ purged_at: null, $or: refs.map(ref => ({ "subject.model": ref.model, "subject.id": ref.id })) }).lean();
  const recordByLead = new Map(records.map(record => [leadKey(String(record.subject.model), record.subject.id), record] as const));
  const [side, pending] = await Promise.all([loadOutreachSideData(records, new Map(), { suggestions: false, liveCalls: false }), pendingAssessmentKeys(records.map(r => subjectKey(r.subject)))]);
  for (const [numberId, ref] of resolved) out.set(numberId, attachedProgressForLead(ref, recordByLead, side, pending, now));
  return out;
}

type AttachedLeadRef = { model: "FormLead" | "CallLead"; id: string };
/**
 * The one Lead a Number resolves to (§7, D5): exactly one `attached` edge. Several attached edges are
 * `multiple`; candidates, ambiguous and rejected edges never lend a Lead to the Number (`none`).
 * Shared by the Numbers row and the Number detail header so they cannot disagree.
 */
export function resolveAttachedLead(edges: readonly { state: string; lead_ref: { model: "FormLead" | "CallLead"; id: unknown } }[]):
  { status: "resolved"; ref: AttachedLeadRef } | { status: "multiple" | "none" } {
  const attached = edges.filter(e => e.state === "attached");
  if (attached.length > 1) return { status: "multiple" };
  if (attached.length === 0) return { status: "none" };
  return { status: "resolved", ref: { model: attached[0]!.lead_ref.model, id: String(attached[0]!.lead_ref.id) } };
}

/**
 * The `resolved` item for one Lead from data a read already holds: its Outreach record (keyed by
 * `FormLead:<id>`), the page's side data and pending-assessment set. Pure; the row and the header use it.
 * V15: the projection follows the Outreach DTO's pending and `move_date_passed` rules at `now`.
 */
export function attachedProgressForLead(ref: AttachedLeadRef, recordByLead: ReadonlyMap<string, RecordRow>, side: Pick<OutreachSideData, "bookings" | "cancellations" | "leads">,
  pending: ReadonlySet<string>, now: Date): AttachedLeadProgressDto {
  const key = leadKey(ref.model, ref.id);
  const record = recordByLead.get(key) ?? null;
  const bookings = side.bookings.get(key) ?? [];
  const cancellations = bookings.flatMap(b => side.cancellations.get(String(b._id)) ?? []);
  const booking = bookings[0] ? { id: String(bookings[0]._id), cancelled: (side.cancellations.get(String(bookings[0]._id)) ?? []).length > 0 } : null;
  const lead = side.leads.get(key) ?? null;
  const moveDatePassed = record ? outreachFacts({ record, followups: [], number: null, lead, bookings, cancellations, now }).facts.move_date_passed : false;
  return attachedLeadProgressDtoSchema.parse({ status: "resolved", lead_ref: ref, lead_progress: record ? leadProgressDto(record) : null, booking,
    outreach_state: record ? stateWithActions(record, [], now) : null, lead_display: lead ? { name: lead.name ?? null, job_no: lead.job_no ?? null } : null,
    lead_status: leadStatusWord(record, lead, bookings, side.cancellations),
    move_assessment: record ? moveAssessmentProjectionDto(record, pending.has(subjectKey(record.subject)), { moveDatePassed }) : null });
}

/**
 * Final spec §9.1 line 2 (`Open | Booked | Booked, then cancelled | Not booked`) as a server word:
 * the official status (`officialStatus`: Lead flags, then the exact Booking and Cancellation rows),
 * then a CRM-disposition or official closure of the Lead's Outreach as `not_booked`. An Owner close
 * of the Outreach is Outreach state (line 5), not a Lead status. Null when the Lead row is gone.
 */
export function leadStatusWord(record: Pick<RecordRow, "state" | "closure_origin" | "closed_reason"> | null, lead: LeadLite | null,
  bookings: readonly BookingLite[], cancellations: ReadonlyMap<string, readonly CancelLite[]>): "open" | "booked" | "booked_then_cancelled" | "not_booked" | null {
  const official = officialStatus(lead, bookings, new Set(bookings.filter(b => (cancellations.get(String(b._id)) ?? []).length > 0).map(b => String(b._id))));
  if (!official) return null;
  if (official.status === "booked") return "booked";
  if (official.status === "cancelled") return "booked_then_cancelled";
  if (official.status !== "open_lead") return "not_booked";
  const closedByLead = record?.state === "closed" && (record.closure_origin === "crm_disposition" || record.closure_origin === "official");
  if (!closedByLead) return "open";
  return record.closed_reason === "booked" ? "booked" : record.closed_reason === "cancelled" ? "booked_then_cancelled" : "not_booked";
}

/** Owner-facing reading of the stored attachment mirror. Derived on read, never stored. */
export function provenanceState(mirror: RecordRow["lead_attachment"]) {
  if (!mirror || mirror.state === "rejected") return "needs_a_lead" as const;
  if (mirror.state === "ambiguous") return "ambiguous" as const;
  if (mirror.state !== "attached") return "needs_a_lead" as const;
  if (mirror.certainty === "owner_confirmed") return "attached_by_you" as const;
  return mirror.decided_by === "automatic" ? "attached_automatically" as const : "attached_from_evidence" as const;
}

const ATTEMPT_WINDOW_MS = 86_400_000;
const reviewKeys = (record: RecordRow) => [subjectKey(record.subject), `number:${record.primary_contact_number_id}`];
const attemptsSince = (now: Date) => new Date(+now - ATTEMPT_WINDOW_MS).toISOString();

/**
 * Everything `derive()` needs for one Outreach Record, loaded in five reads.
 * Split out so a caller that must decide band membership for thousands of
 * records can load a whole page with five `$in` queries instead of paying the
 * twelve round trips a full Owner detail DTO costs (14 §2).
 */
export async function loadOutreachInputs(record: RecordRow, now: Date) {
  const [actions, restrictions, reviewItems, number, attempts] = await Promise.all([
    getOutreachFollowupModel().find({ outreach_record_id: record._id }).sort({ _id: 1 }).lean(),
    getSalesIntelligenceContactRestrictionModel().find({ contact_number_id: record.primary_contact_number_id }).lean(),
    getSalesIntelligenceReviewItemModel().find({ subject_key: { $in: reviewKeys(record) } }).lean(),
    getContactNumberModel().findById(record.primary_contact_number_id).lean(),
    getSalesIntelligenceAuditEventModel().find({ subject_key: subjectKey(record.subject), event_kind: "outreach_call_applied", "current.outboundAttempt": true,
      "current.human": false, "current.happened_at": { $gt: attemptsSince(now) } }).lean(),
  ]);
  return { actions, restrictions, reviewItems, number, attempts };
}
export type OutreachInputs = Awaited<ReturnType<typeof loadOutreachInputs>>;

/** The same five reads for a whole page of records, keyed by record id. */
export async function loadOutreachInputsBatch(records: readonly RecordRow[], now: Date): Promise<Map<string, OutreachInputs>> {
  const out = new Map<string, OutreachInputs>();
  if (!records.length) return out;
  const recordIds = records.map(r => r._id);
  const numberIds = [...new Map(records.flatMap(r => r.primary_contact_number_id ? [[String(r.primary_contact_number_id), r.primary_contact_number_id]] as const : [])).values()];
  const keys = [...new Set(records.flatMap(reviewKeys))];
  const [actions, restrictions, reviewItems, numbers, attempts] = await Promise.all([
    getOutreachFollowupModel().find({ outreach_record_id: { $in: recordIds } }).sort({ _id: 1 }).lean(),
    numberIds.length ? getSalesIntelligenceContactRestrictionModel().find({ contact_number_id: { $in: numberIds } }).lean() : Promise.resolve([]),
    getSalesIntelligenceReviewItemModel().find({ subject_key: { $in: keys } }).lean(),
    numberIds.length ? getContactNumberModel().find({ _id: { $in: numberIds } }).lean() : Promise.resolve([]),
    getSalesIntelligenceAuditEventModel().find({ subject_key: { $in: records.map(r => subjectKey(r.subject)) }, event_kind: "outreach_call_applied",
      "current.outboundAttempt": true, "current.human": false, "current.happened_at": { $gt: attemptsSince(now) } }).lean(),
  ]);
  const group = <T>(rows: readonly T[], keyOf: (row: T) => string) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const key = keyOf(row);
      const bucket = map.get(key);
      if (bucket) bucket.push(row); else map.set(key, [row]);
    }
    return map;
  };
  const byRecord = group(actions, a => String(a.outreach_record_id));
  const byNumber = group(restrictions, r => String(r.contact_number_id));
  const byKey = group(reviewItems, r => r.subject_key);
  const byAttemptKey = group(attempts, a => a.subject_key);
  const numberById = new Map(numbers.map(n => [String(n._id), n]));
  for (const record of records) {
    const numberId = record.primary_contact_number_id ? String(record.primary_contact_number_id) : null;
    out.set(String(record._id), {
      actions: byRecord.get(String(record._id)) ?? [],
      restrictions: numberId ? byNumber.get(numberId) ?? [] : [],
      reviewItems: [...new Map(reviewKeys(record).flatMap(key => (byKey.get(key) ?? []).map(row => [String(row._id), row] as const))).values()],
      number: numberId ? numberById.get(numberId) ?? null : null,
      attempts: byAttemptKey.get(subjectKey(record.subject)) ?? [],
    });
  }
  return out;
}

/**
 * Band and badge membership for one record. Pure over `inputs`, so a publish
 * can decide what belongs on the desk before building any Owner detail DTO.
 */
export function deriveOutreachFacts(record: RecordRow, inputs: OutreachInputs, context: { now: Date; policy: CsiPolicy; coverage: CoverageDto }) {
  const projected = { ...record, state: stateWithActions(record, inputs.actions, context.now) };
  return derive(projected, { now: context.now, policy: context.policy, staffing: context.policy, followups: inputs.actions,
    restrictions: inputs.restrictions, reviewItems: inputs.reviewItems, coverage: context.coverage,
    suppressed: inputs.number?.contact_eligibility.state === "suppressed",
    unsuccessfulAttempts: [...new Map(inputs.attempts.map(a => [String(a.current.interaction_id), new Date(String(a.current.happened_at))])).values()] });
}

type LeadLite = LeadMoveSource & { _id: unknown; name?: string | null; job_no?: string | null; source_company_label_snapshot?: string | null;
  timestamp?: Date | null; booked?: unknown; cancelled?: unknown; duplicate?: boolean | null; bad_lead?: unknown; no_sync?: boolean | null;
  granot_priority?: unknown; quoted?: boolean | null; receiver_agent_name_snapshot?: string | null };
type BookingLite = { _id: unknown; book_date?: Date | null; total_binder_amount?: number | null; job_no?: string | null; agent?: unknown };
type CancelLite = { _id: unknown; cancel_date?: Date | null; reason?: string | null };
/**
 * Data spec §3.2: one projection per Lead collection, wide enough for `facts.route`
 * (`moveViewsForLead`), the official status, the Priority filter key and S2's closed
 * outcome. Form Leads carry `destination_zip`, Call Leads `delivery_zip`.
 */
const LEAD_COMMON_PROJECTION = { name: 1, job_no: 1, source_company_label_snapshot: 1, timestamp: 1, pickup_city: 1, pickup_state: 1, pickup_zip: 1,
  delivery_city: 1, delivery_state: 1, move_date: 1, move_size: 1, granot_move_size: 1, cubic_feet: 1, current_move_provenance: 1,
  booked: 1, cancelled: 1, duplicate: 1, bad_lead: 1, no_sync: 1, granot_priority: 1, quoted: 1, receiver_agent_name_snapshot: 1 } as const;
const FORM_LEAD_PROJECTION = { ...LEAD_COMMON_PROJECTION, destination_zip: 1 } as const;
const CALL_LEAD_PROJECTION = { ...LEAD_COMMON_PROJECTION, delivery_zip: 1 } as const;
type LatestLite = { _id: unknown; started_at: Date; direction: string; provider_result?: string | null; contact_type: string };
export type OutreachSideData = {
  /** Lead keys with at least one attached Contact Number that is suppressed (override/reopen must stay closed). */
  suppressedLeads: Set<string>;
  agentNames: Map<string, string>;
  leads: Map<string, LeadLite>;
  bookings: Map<string, BookingLite[]>;
  cancellations: Map<string, CancelLite[]>;
  latestCalls: Map<string, LatestLite>;
  /** S1-SUGGEST: case-2 inputs for card line 6 (final spec §5.5), batched per page (`suggestion.ts`). */
  suggestions: SuggestionSide;
  /** S5c-LIVE (G3): the newest live call per primary Number at the page's `now`; absent when the caller built no side data. */
  liveCalls?: Map<string, LiveCallDto>;
};

type LiveCallRow = Parameters<typeof toCaseCall>[0] & { contact_number_id: unknown };
/**
 * S5c-LIVE (G3): one `$in` read per page over the page's primary Numbers (index
 * `contact_number_id + started_at`), plus the rep-identity context only when a page has a live call.
 * A call is live when telephony still reports it (`terminal: false`), it isn't a monitoring leg, an
 * Internal call or a merged duplicate, and it started in the last 4 h.
 */
async function loadLiveCalls(numberIds: readonly mongoose.Types.ObjectId[], now: Date): Promise<Map<string, LiveCallDto>> {
  if (!numberIds.length) return new Map();
  const rows = await getCallInteractionModel().find({ contact_number_id: { $in: numberIds }, started_at: { $gte: new Date(+now - LIVE_CALL_WINDOW_MS), $lte: now },
    terminal: false, merged_into_id: null, monitoring: { $ne: true }, direction: { $ne: "Internal" } })
    .select(`${CALL_PROJECTION} contact_number_id`).sort({ started_at: -1, _id: -1 }).lean() as unknown as LiveCallRow[];
  if (!rows.length) return new Map();
  const calls = rows.map(row => ({ numberId: String(row.contact_number_id), call: toCaseCall(row) }));
  const ctx = await readVantageSideContext(calls.map(c => c.call), []);
  const out = new Map<string, LiveCallDto>();
  for (const { numberId, call } of calls) {
    if (out.has(numberId)) continue;
    const rep = repClause(call, ctx);
    out.set(numberId, { interaction_id: call.id, direction: call.direction, started_at: call.started_at,
      rep: { kind: rep.kind, agent_id: rep.agent_id, name: rep.name, extension: rep.extension, text: rep.text } });
  }
  return out;
}
const leadKey = (model: string, id: unknown) => `${model}:${String(id)}`;

/**
 * Agent names, Lead display, bookings, cancellations, and the latest call for
 * a whole page. Attention publish used to pay these five reads once per desk
 * row, which never finished inside the cron budget at production volume.
 */
export async function loadOutreachSideData(records: readonly RecordRow[], inputs: ReadonlyMap<string, OutreachInputs>,
  options: { suggestions?: boolean; now?: Date; liveCalls?: boolean } = {}): Promise<OutreachSideData> {
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
  const agentIds = [...new Map(records.flatMap(record => {
    const actions = inputs.get(String(record._id))?.actions ?? [];
    return [record.responsible_agent_id, ...actions.flatMap(action => [action.responsible_agent_id, action.promised_by_agent_id])];
  }).filter((id): id is mongoose.Types.ObjectId => Boolean(id)).map(id => [String(id), id] as const)).values()];
  const formIds = records.flatMap(record => record.subject.kind === "lead" && record.subject.model === "FormLead" && record.subject.id ? [record.subject.id] : []);
  const callIds = records.flatMap(record => record.subject.kind === "lead" && record.subject.model === "CallLead" && record.subject.id ? [record.subject.id] : []);
  const leadRefs = records.flatMap(record => record.subject.kind === "lead" && record.subject.model && record.subject.id ? [{ model: record.subject.model, id: record.subject.id }] : []);
  const numberIds = [...new Map(records.flatMap(record => record.primary_contact_number_id ? [[String(record.primary_contact_number_id), record.primary_contact_number_id] as const] : [])).values()];
  // S1-SUGGEST: needs each record's follow-ups; a caller without `inputs` (the Numbers list) opts out.
  const suggestionsLoad = options.suggestions === false ? Promise.resolve(EMPTY_SUGGESTION_SIDE)
    : loadSuggestionSide(records, record => inputs.get(String(record._id))?.actions ?? []);
  const [formDocs, callDocs, bookingDocs, latestDocs, suggestions, liveCalls] = await Promise.all([
    formIds.length ? db.collection("form_leads").find({ _id: { $in: formIds } }, { projection: FORM_LEAD_PROJECTION }).toArray() : [],
    callIds.length ? db.collection("call_leads").find({ _id: { $in: callIds } }, { projection: CALL_LEAD_PROJECTION }).toArray() : [],
    leadRefs.length ? db.collection("booked_leads").find({ $or: leadRefs.map(ref => ({ lead_model: ref.model, lead_ref: ref.id })) },
      { projection: { _id: 1, lead_model: 1, lead_ref: 1, book_date: 1, total_binder_amount: 1, job_no: 1, agent: 1 } }).toArray() : [],
    // Data spec D1 (deferred): `facts.last_call_at` reads the Number rollups; this aggregation stays
    // only while the production admin still reads `latest_number_call`.
    numberIds.length ? getCallInteractionModel().aggregate<{ _id: unknown; id: unknown; started_at: Date; direction: string; provider_result?: string | null; contact_type: string }>([
      { $match: { contact_number_id: { $in: numberIds }, merged_into_id: null } },
      { $sort: { contact_number_id: 1, started_at: -1, _id: -1 } },
      { $group: { _id: "$contact_number_id", id: { $first: "$_id" }, started_at: { $first: "$started_at" }, direction: { $first: "$direction" }, provider_result: { $first: "$provider_result" }, contact_type: { $first: "$contact_type" } } },
    ]) : [],
    suggestionsLoad,
    // The Numbers list resolves only the display Lead's progress: it never shows `live_call`.
    options.liveCalls === false ? Promise.resolve(new Map<string, LiveCallDto>()) : loadLiveCalls(numberIds, options.now ?? new Date()),
  ]);
  // `Booked · {agent}` (§3.2): the booking agents join the one agents `$in`, so it runs after the bookings.
  const bookingAgentIds = bookingDocs.flatMap(booking => booking.agent instanceof mongoose.Types.ObjectId ? [booking.agent] : []);
  const allAgentIds = [...new Map([...agentIds, ...bookingAgentIds].map(id => [String(id), id] as const)).values()];
  const bookingIds = bookingDocs.map(booking => booking._id);
  const [agentDocs, cancelDocs, attachedEdges] = await Promise.all([
    allAgentIds.length ? db.collection("agents").find({ _id: { $in: allAgentIds } }, { projection: { name: 1 } }).toArray() : [],
    bookingIds.length ? db.collection("cancelled_leads").find({ booked_lead: { $in: bookingIds } }, { projection: { _id: 1, booked_lead: 1, cancel_date: 1, reason: 1 } }).toArray() : [],
    leadRefs.length ? attachmentModel().find({ state: "attached", $or: leadRefs.map(ref => ({ "lead_ref.model": ref.model, "lead_ref.id": ref.id })) }).select({ contact_number_id: 1, lead_ref: 1 }).lean() : [],
  ]);
  const suppressedNumberIds = attachedEdges.length ? new Set((await getContactNumberModel().find({ _id: { $in: attachedEdges.map(e => e.contact_number_id) }, "contact_eligibility.state": "suppressed" }).select({ _id: 1 }).lean()).map(n => String(n._id))) : new Set<string>();
  const suppressedLeads = new Set(attachedEdges.filter(e => suppressedNumberIds.has(String(e.contact_number_id))).map(e => leadKey(e.lead_ref.model, e.lead_ref.id)));
  const bookings = new Map<string, BookingLite[]>();
  for (const booking of bookingDocs) {
    const key = leadKey(String(booking.lead_model), booking.lead_ref);
    const bucket = bookings.get(key);
    const lite: BookingLite = { _id: booking._id, book_date: booking.book_date ?? null, total_binder_amount: booking.total_binder_amount ?? null,
      job_no: booking.job_no ?? null, agent: booking.agent ?? null };
    if (bucket) bucket.push(lite); else bookings.set(key, [lite]);
  }
  const cancellations = new Map<string, CancelLite[]>();
  for (const cancellation of cancelDocs) {
    const key = String(cancellation.booked_lead);
    const bucket = cancellations.get(key);
    const lite: CancelLite = { _id: cancellation._id, cancel_date: cancellation.cancel_date ?? null, reason: cancellation.reason ?? null };
    if (bucket) bucket.push(lite); else cancellations.set(key, [lite]);
  }
  return {
    suppressedLeads,
    agentNames: new Map(agentDocs.map(agent => [String(agent._id), typeof agent.name === "string" && agent.name ? agent.name : "Unknown Agent"])),
    leads: new Map([...formDocs.map(lead => [leadKey("FormLead", lead._id), lead] as const), ...callDocs.map(lead => [leadKey("CallLead", lead._id), lead] as const)]),
    bookings,
    cancellations,
    latestCalls: new Map(latestDocs.map(call => [String(call._id), { _id: call.id, started_at: call.started_at, direction: call.direction, provider_result: call.provider_result ?? null, contact_type: call.contact_type }])),
    suggestions,
    liveCalls,
  };
}

export async function toOutreachDto(record: RecordRow, now = new Date(), coverage?: CoverageDto,
  prefetched: { policy?: CsiPolicy; inputs?: OutreachInputs; side?: OutreachSideData; assessmentPending?: boolean } = {}) {
  const policy = prefetched.policy ?? await resolvePolicy();
  // MA-04: the projection rides on every Outreach read. Attention publish passes the queued set it
  // already loaded; detail reads answer one bounded `exists` for the Pending label.
  const assessmentPending = prefetched.assessmentPending ?? Boolean(await getSalesIntelligenceJobModel().exists({ ...csiDataset(),
    stage: "move_assessment", subject_key: subjectKey(record.subject), status: { $in: ["pending", "leased", "retry"] } }));
  const inputs = prefetched.inputs ?? await loadOutreachInputs(record, now);
  const { actions, restrictions, number } = inputs;
  const activeRestrictions = restrictions.filter(r => r.state === "active" && (!r.until || r.until > now));
  const side = prefetched.side ?? await loadOutreachSideData([record], new Map([[String(record._id), inputs]]), { now });
  const agent = (id: unknown) => id ? { id: String(id), name: side.agentNames.get(String(id)) ?? "Unknown Agent" } : null;
  const assignment = (row: Pick<FollowupRow, "responsible_agent_id" | "assignment">) => ({ agent: agent(row.responsible_agent_id), origin: row.assignment?.origin ?? null,
    assigned_at: iso(row.assignment?.assigned_at), evidence_ref: row.assignment?.evidence_id ? String(row.assignment.evidence_id) : null, owner_instruction_id: row.assignment?.instruction_id ? String(row.assignment.instruction_id) : null });
  const projectedState = stateWithActions(record, actions, now);
  const facts = deriveOutreachFacts(record, inputs, { now, policy, coverage: coverage ?? await readCaptureCoverage() });
  const availability = (action: "patch_followup" | "complete_followup" | "cancel_followup" | "snooze_followup", row: FollowupRow) => ({ action, target_id: String(row._id), expected_revision: row.revision,
    enabled: row.status === "open" && record.state !== "closed" && (action !== "snooze_followup" || Boolean(row.due_at)), blocker_codes: [] });
  const followups = actions.map(a => ({ id: String(a._id), revision: a.revision, kind: a.kind, description: a.description, status: a.status, due_at: iso(a.due_at),
    base_attention_due_at: iso(a.base_attention_due_at), attention_due_at: iso(attentionDue(a)), snoozed_until: iso(a.snoozed_until),
    wait_expired_at: iso(a.wait_expired_at ?? (a.kind === "wait" && a.due_at && a.due_at <= now ? a.due_at : null)), date_text: a.date_text,
    date_resolution: a.date_resolution ? { ...a.date_resolution, anchor: iso(a.date_resolution.anchor) } : null,
    assignment: assignment(a), promised_by: agent(a.promised_by_agent_id), origin: a.origin,
    provenance_refs: [...a.source_finding_ids, ...a.owner_instruction_ids].map(String), disposition: a.disposition, completion_basis: a.completion_basis,
    paused_channels: [...new Set(activeRestrictions.flatMap(r => r.channels))], overdue: a.status === "open" && Boolean(a.due_at && a.due_at < now),
    allowed_actions: (["patch_followup", "complete_followup", "cancel_followup", "snooze_followup"] as const).map(action => availability(action, a)),
    // Team 4 §9: only rows the flag wrote carry these, so a flag-off read is byte-identical.
    ...(a.promise_chain ? { promise_chain: { root_id: String(a.promise_chain.root_id), root_origin: a.promise_chain.root_origin, attempt: a.promise_chain.attempt } } : {}),
    ...(a.default_kind ? { default_kind: a.default_kind } : {}),
    ...(a.supersedes_id ? { supersedes_id: String(a.supersedes_id) } : {}),
    ...(a.cancel_reason === SUPERSEDED_BY_SPECIFIC_PLAN || a.cancel_reason === "reached_on_classification" ? { cancel_reason: a.cancel_reason } : {}) }));
  const { actions: actionFacts, ...derived } = facts;
  const lead = record.subject.kind === "lead" && record.subject.model && record.subject.id ? side.leads.get(leadKey(record.subject.model, record.subject.id)) ?? null : null;
  const bookings = record.subject.kind === "lead" && record.subject.model && record.subject.id ? side.bookings.get(leadKey(record.subject.model, record.subject.id)) ?? [] : [];
  const cancellations = bookings.flatMap(booking => side.cancellations.get(String(booking._id)) ?? []);
  // Data spec §3.3 / §3.8: card facts at this read's `now` (publish time for the snapshot, request time for the detail).
  const card = outreachFacts({ record, followups: actions, number, lead, bookings, cancellations, now });
  const related = [
    ...(lead ? [{ model: record.subject.model!, id: String(lead._id), href: `/${record.subject.model === "FormLead" ? "form-leads" : "call-leads"}?record=${lead._id}&database_scope=production`, certainty: "exact" as const }] : []),
    ...bookings.map(b => ({ model: "BookedLead" as const, id: String(b._id), href: `/bookings?record=${b._id}&database_scope=production`, certainty: "exact" as const })),
    ...cancellations.map(c => ({ model: "CancelledLead" as const, id: String(c._id), href: `/cancellations?record=${c._id}&database_scope=production`, certainty: "exact" as const })),
  ];
  const latest = record.primary_contact_number_id ? side.latestCalls.get(String(record.primary_contact_number_id)) ?? null : null;
  const mirror = record.lead_attachment;
  const callInProgress = record.call_progress?.state === "in_progress";
  const callRestricted = derived.call_blockers.includes("restriction");
  // Same blockers the command enforces: a closed record, a call already in progress, and the
  // active call restriction. Closed and in-flight are both ILLEGAL_TRANSITION on the command.
  // LP-01 guards mirrored from `applyOwnerCommandInTransaction`: an un-overridden terminal disposition
  // and an open disposition review block new sales execution on an open record.
  const progressRow = record.lead_progress as import("./leadProgress").LeadProgressRow | null;
  const dispositionBlocked = Boolean(progressRow && isTerminal(progressRow.disposition) && progressRow.provenance === "accepted" && !progressRow.override) && record.state !== "closed";
  const underDispositionReview = derived.call_blockers.includes("disposition_review") && record.state !== "closed";
  const dispositionBlockers = [...(dispositionBlocked ? ["CRM_DISPOSITION_CLOSED" as const] : []), ...(underDispositionReview ? ["DISPOSITION_REVIEW" as const] : [])];
  const callAvailability = [
    { action: "start_call" as const, enabled: record.state !== "closed" && !callInProgress && !callRestricted && !dispositionBlockers.length,
      blocker_codes: [...(record.state === "closed" || callInProgress ? ["ILLEGAL_TRANSITION" as const] : []), ...(callRestricted ? ["CONTACT_RESTRICTED" as const] : []), ...dispositionBlockers] },
    { action: "end_call" as const, enabled: record.state !== "closed" && callInProgress,
      blocker_codes: record.state !== "closed" && callInProgress ? [] : ["ILLEGAL_TRANSITION" as const] },
  ].map(a => ({ ...a, target_id: String(record._id), expected_revision: record.revision }));
  const progress = leadProgressDto(record);
  const crmClosed = record.state === "closed" && record.closure_origin === "crm_disposition";
  const terminalNow = Boolean(progress && isTerminal(progress.disposition) && progress.provenance === "accepted" && !progress.override);
  // Reopen after a CRM closure needs the disposition to have moved on (a reopen review), else the Owner overrides explicitly.
  const reopenBlockedByCrm = crmClosed && terminalNow && !progress?.reopen_review_id;
  const leadSuppressed = record.subject.kind === "lead" && side.suppressedLeads.has(leadKey(String(record.subject.model), record.subject.id));
  const overrideEnabled = csiFlag("LEAD_PROGRESS") && Boolean(progress) && terminalNow && (crmClosed || record.state !== "closed") && number?.contact_eligibility.state !== "suppressed" && !leadSuppressed;
  return outreachDtoSchema.parse({ id: String(record._id), revision: record.revision,
    lead_progress: progress,
    // RD2 / S3-PRES contract: the assessment's `move_date_passed` staleness is derived on read from the same facts.
    move_assessment: moveAssessmentProjectionDto(record, assessmentPending, { moveDatePassed: card.facts.move_date_passed }),
    facts: card.facts,
    // S1-SUGGEST: card line 6 case 2 at this read's `now`; Apply carries the same guards as `create_followup` above.
    suggested_next_step: suggestedNextStep({ record: { ...record, state: projectedState }, followups: actions, side: side.suggestions ?? EMPTY_SUGGESTION_SIDE, dispositionBlockers }),
    lead_attachment: mirror ? { attachment_id: String(mirror.attachment_id), lead_ref: { model: mirror.lead_ref.model, id: String(mirror.lead_ref.id) },
      state: mirror.state, certainty: mirror.certainty, certainty_label: certaintyLabel(mirror.certainty), decided_by: mirror.decided_by,
      decided_at: iso(mirror.decided_at), confidence: mirror.confidence ?? null, observed_at: iso(mirror.observed_at),
      lead_display: lead && String(lead._id) === String(mirror.lead_ref.id) ? { name: lead.name ?? null, job_no: lead.job_no ?? null } : null } : null,
    call_progress: record.call_progress ? { state: record.call_progress.state, started_at: iso(record.call_progress.started_at),
      started_by: record.call_progress.started_by, ended_at: iso(record.call_progress.ended_at), ended_by: record.call_progress.ended_by,
      note: record.call_progress.note } : null,
    live_call: record.primary_contact_number_id ? side.liveCalls?.get(String(record.primary_contact_number_id)) ?? null : null,
    lead_display: lead ? { name: lead.name ?? null, job_no: lead.job_no ?? null, source_company: lead.source_company_label_snapshot ?? null } : null,
    latest_number_call: latest ? { id: String(latest._id), happened_at: iso(latest.started_at), direction: latest.direction, provider_result: latest.provider_result ?? null, contact_type: latest.contact_type } : null,
    primary_number: number ? { id: String(number._id), e164: number.e164 } : null,
    subject: record.subject.kind === "lead" ? { kind: "lead", model: record.subject.model, id: String(record.subject.id) } : { kind: "number_review", contact_number_id: String(record.subject.contact_number_id) },
    state: projectedState, reason: record.closed_reason, assignment: assignment(record), followups, followups_cursor: null,
    trigger_at: iso(record.trigger_at), first_action_due_at: iso(record.first_action_due_at), first_attributable_outbound_at: iso(record.first_attributable_outbound_at),
    next_action: followups.find(a => a.id === String(record.next_action?.followup_id)) ?? null, first_human_conversation_at: iso(record.first_human_conversation_at),
    last_meaningful_contact_at: iso(record.last_meaningful_contact_at), related_record_links: related,
    // Team 4 §5.4/§7.3: present once the flag computed them for this record (absent on flag-off rows).
    ...Object.fromEntries(CONTACT_FACT_FIELDS.filter(field => record[field] !== undefined).map(field => [field, iso(record[field])])),
    derived: { ...derived, action_facts: actionFacts, call_state: record.call_progress?.state ?? "not_started", provenance_state: provenanceState(mirror) },
    allowed_actions: [...(["mark_worked", "assign", "set_waiting", "add_note", "close", "reopen", "create_followup"] as const).map(action => {
      const guarded = (action === "mark_worked" && dispositionBlocked) || ((action === "set_waiting" || action === "create_followup") && dispositionBlockers.length > 0);
      return { action, target_id: String(record._id), expected_revision: record.revision,
        enabled: action === "add_note" || (action === "reopen" ? record.state === "closed" && record.closure_origin !== "official" && number?.contact_eligibility.state !== "suppressed" && !reopenBlockedByCrm : record.state !== "closed" && !guarded),
        blocker_codes: action === "reopen" && reopenBlockedByCrm ? ["CRM_DISPOSITION_CLOSED" as const] : guarded ? (action === "mark_worked" ? ["CRM_DISPOSITION_CLOSED" as const] : dispositionBlockers) : [] };
    }),
      { action: "override_disposition" as const, target_id: String(record._id), expected_revision: record.revision, enabled: overrideEnabled,
        blocker_codes: overrideEnabled ? [] : !csiFlag("LEAD_PROGRESS") ? ["FEATURE_DISABLED" as const] : ["ILLEGAL_TRANSITION" as const] },
      ...callAvailability] });
}
/**
 * Data spec §4.1 / V21: the newest completed, unpurged run of the Number, newest by
 * `createdAt` then `_id` on `csi_run_number`. One read serves `newest_run_id` and
 * `latest_summary`; only the overview and the summary ids are projected.
 */
function newestCompletedRun(numberId: unknown) {
  if (!numberId) return Promise.resolve(null);
  return getIntelligenceRunModel().findOne({ contact_number_id: numberId, status: "completed", ...csiDataset(), output: { $ne: null }, purged_at: null, purge_started_at: null })
    .select({ _id: 1, conversation_id: 1, completed_at: 1, "output.summary.overview": 1, "step_artifacts.summaries": 1 })
    .sort({ createdAt: -1, _id: -1 }).lean();
}

/** The §4.1 additions from reads `readOutreach` already made plus the one run read. Pure. */
export function outreachDetailAdditions(record: RecordRow, side: OutreachSideData, number: OutreachInputs["number"], run: Parameters<typeof latestSummaryFromRun>[0]) {
  // A Number whose content purge is pending shows no model text (the run read's own guard, `readOwnerRun`).
  const usable = run && !number?.content_purge_pending ? run : null;
  const ref = record.subject.kind === "lead" && record.subject.model && record.subject.id ? leadKey(record.subject.model, record.subject.id) : null;
  const bookings = ref ? side.bookings.get(ref) ?? [] : [];
  const cancelled = new Set(bookings.filter(b => (side.cancellations.get(String(b._id)) ?? []).length > 0).map(b => String(b._id)));
  return { newest_run_id: usable ? String(usable._id) : null, latest_summary: latestSummaryFromRun(usable),
    official: officialStatus(ref ? side.leads.get(ref) ?? null : null, bookings, cancelled) };
}

export async function readOutreach(id: string) {
  const record = await getOutreachRecordModel().findOne({ _id: id, purged_at: null }).lean();
  if (!record) return null;
  const numberId = record.primary_contact_number_id ?? (record.subject.kind === "number_review" ? record.subject.contact_number_id : null);
  const now = new Date(), [coverage, policy, instructions, inputs, nudges, run] = await Promise.all([
    readCaptureCoverage(), resolvePolicy(),
    getSalesIntelligenceOwnerInstructionModel().find({ subject_key: subjectKey(record.subject) }).sort({ happened_at: 1 }).lean(),
    loadOutreachInputs(record, now), nudgeHistoryPage({ outreach_record_id: id, limit: 20 }), newestCompletedRun(numberId)]);
  const side = await loadOutreachSideData([record], new Map([[String(record._id), inputs]]), { now });
  const outreach = outreachDetailDtoSchema.parse({ ...await toOutreachDto(record, now, coverage, { policy, inputs, side }),
    ...outreachDetailAdditions(record, side, inputs.number, run) });
  return { as_of: now.toISOString(), coverage, data: { outreach, owner_instructions: instructions, nudges } };
}
export async function readOutreachByLead(model: "FormLead" | "CallLead", id: string) {
  const row = await getOutreachRecordModel().findOne({ "subject.model": model, "subject.id": id, purged_at: null }).lean();
  return row ? readOutreach(String(row._id)) : null;
}
/** Data spec §7 D2: the one pending-assessment read for a set of subjects (the publish's queued-set rule, scoped by `csiDataset()`). */
async function pendingAssessmentKeys(keys: readonly string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const rows = await getSalesIntelligenceJobModel().distinct("subject_key", { ...csiDataset(), stage: "move_assessment",
    status: { $in: ["pending", "leased", "retry"] }, subject_key: { $in: [...new Set(keys)] } });
  return new Set(rows.map(String));
}

type NumberOutreachEdge = { state: string; lead_ref: { model: "FormLead" | "CallLead"; id: mongoose.Types.ObjectId } };
/**
 * `GET /numbers/:id` Outreach part. Data spec §7 D2: the caller hands over the Number and its
 * attachment edges it already read; restrictions, review items, follow-ups, recent attempts and the
 * pending-assessment set are each read once for every record together, and the Number is read again
 * only for a record whose primary Number is a different phone (one batched `$in`). The read count is
 * therefore independent of the number of Outreach records.
 */
export async function readNumberOutreach(numberId: string, prefetched: { edges?: readonly NumberOutreachEdge[]; number?: unknown; now?: Date; coverage?: CoverageDto } = {}) {
  const edges = prefetched.edges ?? await getNumberLeadAttachmentModel().find({ contact_number_id: numberId }).lean();
  const [records, conversations] = await Promise.all([
    getOutreachRecordModel().find({ purged_at: null, $or: [{ primary_contact_number_id: numberId }, { "subject.contact_number_id": numberId },
      ...edges.map(e => ({ "subject.model": e.lead_ref.model, "subject.id": e.lead_ref.id }))] }).lean(),
    getLeadConversationModel().find({ contact_number_id: numberId }).select({ _id: 1 }).lean()]);
  const now = prefetched.now ?? new Date();
  // The response's review items keep their historical key set; each record's `derive()` inputs also need its primary-number key.
  const responseKeys = new Set([`number:${numberId}`, ...records.map(r => subjectKey(r.subject)), ...conversations.map(c => `conversation:${c._id}`)]);
  const primaryIds = [...new Map(records.flatMap(r => r.primary_contact_number_id ? [[String(r.primary_contact_number_id), r.primary_contact_number_id] as const] : [])).values()];
  const otherIds = primaryIds.filter(id => String(id) !== numberId || !prefetched.number);
  const [coverage, policy, restrictions, reviewItems, otherNumbers, actions, attempts, pending] = await Promise.all([
    prefetched.coverage ?? readCaptureCoverage(), resolvePolicy(),
    getSalesIntelligenceContactRestrictionModel().find({ contact_number_id: { $in: [...new Map([[numberId, new mongoose.Types.ObjectId(numberId)], ...primaryIds.map(id => [String(id), id] as const)]).values()] } }).lean(),
    getSalesIntelligenceReviewItemModel().find({ subject_key: { $in: [...new Set([...responseKeys, ...records.flatMap(reviewKeys)])] } }).lean(),
    otherIds.length ? getContactNumberModel().find({ _id: { $in: otherIds } }).lean() : Promise.resolve([]),
    records.length ? getOutreachFollowupModel().find({ outreach_record_id: { $in: records.map(r => r._id) } }).sort({ _id: 1 }).lean() : Promise.resolve([]),
    records.length ? getSalesIntelligenceAuditEventModel().find({ subject_key: { $in: records.map(r => subjectKey(r.subject)) }, event_kind: "outreach_call_applied",
      "current.outboundAttempt": true, "current.human": false, "current.happened_at": { $gt: attemptsSince(now) } }).lean() : Promise.resolve([]),
    pendingAssessmentKeys(records.map(r => subjectKey(r.subject)))]);
  type Inputs = OutreachInputs;
  const numberById = new Map<string, Inputs["number"]>(otherNumbers.map(n => [String(n._id), n] as const));
  if (prefetched.number) numberById.set(numberId, prefetched.number as Inputs["number"]);
  const inputs = new Map<string, Inputs>();
  for (const record of records) {
    const primary = record.primary_contact_number_id ? String(record.primary_contact_number_id) : null;
    const keys = new Set(reviewKeys(record));
    inputs.set(String(record._id), {
      actions: actions.filter(a => String(a.outreach_record_id) === String(record._id)),
      restrictions: primary ? restrictions.filter(r => String(r.contact_number_id) === primary) : [],
      reviewItems: reviewItems.filter(r => keys.has(r.subject_key)),
      number: primary ? numberById.get(primary) ?? null : null,
      attempts: attempts.filter(a => a.subject_key === subjectKey(record.subject)),
    });
  }
  const side = await loadOutreachSideData(records, inputs, { now });
  // §9.3 header = the Numbers row: the same resolver and mapper over the edges, records, side data and pending set already held.
  const pick = resolveAttachedLead(edges);
  const leadRecords = new Map(records.flatMap(r => r.subject.kind === "lead" ? [[leadKey(String(r.subject.model), r.subject.id), r] as const] : []));
  const attached_lead_progress: AttachedLeadProgressDto = pick.status === "resolved" ? attachedProgressForLead(pick.ref, leadRecords, side, pending, now) : { status: pick.status };
  return { attached_lead_progress, outreach_records: await Promise.all(records.map(r => toOutreachDto(r, now, coverage, { policy, inputs: inputs.get(String(r._id)), side, assessmentPending: pending.has(subjectKey(r.subject)) }))),
    restrictions: restrictions.filter(r => String(r.contact_number_id) === numberId).map(r => restrictionDtoSchema.parse({ id: String(r._id), revision: r.revision,
    contact_number_id: String(r.contact_number_id), channels: r.channels, until: iso(r.until), origin: r.origin, state: r.state, run_id: r.run_id ? String(r.run_id) : null,
    finding_id: r.finding_id ? String(r.finding_id) : null, allowed_actions: [{ action: "resolve_restriction", target_id: String(r._id), expected_revision: r.revision, enabled: r.state === "active", blocker_codes: [] }] })),
    review_items: reviewItems.filter(r => responseKeys.has(r.subject_key)).map(toReviewDto) };
}
export function toReviewDto(r: InferSchemaType<typeof SalesIntelligenceReviewItemSchema> & { _id: mongoose.Types.ObjectId; updatedAt: Date }) {
  return reviewItemDtoSchema.parse({ id: String(r._id), revision: r.revision, subject_key: r.subject_key, cause_kind: r.cause_kind, cause_key: r.cause_key, state: r.state,
    evidence_refs: r.evidence_ids.map(String), opened_at: iso(r.opened_at), updated_at: iso(r.updatedAt), resolved_at: iso(r.resolved_at), resolution_reason: r.resolution_reason,
    allowed_actions: [{ action: "resolve_review", target_id: String(r._id), expected_revision: r.revision, enabled: r.state === "open", blocker_codes: [] }] });
}
export const reviewItemsQuerySchema = z.object({ scope: z.literal("production").optional(), cursor: z.string().regex(/^[a-f\d]{24}$/i).optional(), limit: z.coerce.number().int().min(1).max(200).default(50),
  subject_key: z.string().regex(/^(number:[a-f\d]{24}|lead:(FormLead|CallLead):[a-f\d]{24})$/i).optional(), state: z.enum(["open", "resolved", "dismissed"]).optional(), cause_kind: reviewItemDtoSchema.shape.cause_kind.optional() }).strict();
export async function listReviewItems(query: z.infer<typeof reviewItemsQuerySchema>) {
  const rows = await getSalesIntelligenceReviewItemModel().find({ ...(query.cursor ? { _id: { $gt: query.cursor } } : {}),
    ...(query.subject_key ? { subject_key: query.subject_key } : {}), ...(query.state ? { state: query.state } : {}), ...(query.cause_kind ? { cause_kind: query.cause_kind } : {}) }).sort({ _id: 1 }).limit(query.limit + 1).lean();
  return ownerRead({ items: rows.slice(0, query.limit).map(toReviewDto), cursor: rows.length > query.limit ? String(rows[query.limit - 1]!._id) : null });
}
