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
import { outreachDtoSchema, reviewItemDtoSchema, restrictionDtoSchema, type CoverageDto } from "../dto";
import { resolvePolicy } from "../policy";
import { certaintyLabel } from "../attachment/suggest";
import { derive, attentionDue } from "./derive";
import { stateWithActions } from "./transitions";
import { subjectKey, type RecordRow, type FollowupRow } from "./types";
import { nudgeHistoryPage } from "../nudges/reads";

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

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

type LeadLite = { _id: unknown; name?: string | null; job_no?: string | null; source_company_label_snapshot?: string | null };
type BookingLite = { _id: unknown };
type CancelLite = { _id: unknown };
type LatestLite = { _id: unknown; started_at: Date; direction: string; provider_result?: string | null; contact_type: string };
export type OutreachSideData = {
  agentNames: Map<string, string>;
  leads: Map<string, LeadLite>;
  bookings: Map<string, BookingLite[]>;
  cancellations: Map<string, CancelLite[]>;
  latestCalls: Map<string, LatestLite>;
};
const leadKey = (model: string, id: unknown) => `${model}:${String(id)}`;

/**
 * Agent names, Lead display, bookings, cancellations, and the latest call for
 * a whole page. Attention publish used to pay these five reads once per desk
 * row, which never finished inside the cron budget at production volume.
 */
export async function loadOutreachSideData(records: readonly RecordRow[], inputs: ReadonlyMap<string, OutreachInputs>): Promise<OutreachSideData> {
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
  const agentIds = [...new Map(records.flatMap(record => {
    const actions = inputs.get(String(record._id))?.actions ?? [];
    return [record.responsible_agent_id, ...actions.flatMap(action => [action.responsible_agent_id, action.promised_by_agent_id])];
  }).filter((id): id is mongoose.Types.ObjectId => Boolean(id)).map(id => [String(id), id] as const)).values()];
  const formIds = records.flatMap(record => record.subject.kind === "lead" && record.subject.model === "FormLead" && record.subject.id ? [record.subject.id] : []);
  const callIds = records.flatMap(record => record.subject.kind === "lead" && record.subject.model === "CallLead" && record.subject.id ? [record.subject.id] : []);
  const leadRefs = records.flatMap(record => record.subject.kind === "lead" && record.subject.model && record.subject.id ? [{ model: record.subject.model, id: record.subject.id }] : []);
  const numberIds = [...new Map(records.flatMap(record => record.primary_contact_number_id ? [[String(record.primary_contact_number_id), record.primary_contact_number_id] as const] : [])).values()];
  const [agentDocs, formDocs, callDocs, bookingDocs, latestDocs] = await Promise.all([
    agentIds.length ? db.collection("agents").find({ _id: { $in: agentIds } }, { projection: { name: 1 } }).toArray() : [],
    formIds.length ? db.collection("form_leads").find({ _id: { $in: formIds } }, { projection: { name: 1, job_no: 1, source_company_label_snapshot: 1 } }).toArray() : [],
    callIds.length ? db.collection("call_leads").find({ _id: { $in: callIds } }, { projection: { name: 1, job_no: 1, source_company_label_snapshot: 1 } }).toArray() : [],
    leadRefs.length ? db.collection("booked_leads").find({ $or: leadRefs.map(ref => ({ lead_model: ref.model, lead_ref: ref.id })) }, { projection: { _id: 1, lead_model: 1, lead_ref: 1 } }).toArray() : [],
    numberIds.length ? getCallInteractionModel().aggregate<{ _id: unknown; id: unknown; started_at: Date; direction: string; provider_result?: string | null; contact_type: string }>([
      { $match: { contact_number_id: { $in: numberIds }, merged_into_id: null } },
      { $sort: { contact_number_id: 1, started_at: -1, _id: -1 } },
      { $group: { _id: "$contact_number_id", id: { $first: "$_id" }, started_at: { $first: "$started_at" }, direction: { $first: "$direction" }, provider_result: { $first: "$provider_result" }, contact_type: { $first: "$contact_type" } } },
    ]) : [],
  ]);
  const bookingIds = bookingDocs.map(booking => booking._id);
  const cancelDocs = bookingIds.length ? await db.collection("cancelled_leads").find({ booked_lead: { $in: bookingIds } }, { projection: { _id: 1, booked_lead: 1 } }).toArray() : [];
  const bookings = new Map<string, BookingLite[]>();
  for (const booking of bookingDocs) {
    const key = leadKey(String(booking.lead_model), booking.lead_ref);
    const bucket = bookings.get(key);
    const lite = { _id: booking._id };
    if (bucket) bucket.push(lite); else bookings.set(key, [lite]);
  }
  const cancellations = new Map<string, CancelLite[]>();
  for (const cancellation of cancelDocs) {
    const key = String(cancellation.booked_lead);
    const bucket = cancellations.get(key);
    const lite = { _id: cancellation._id };
    if (bucket) bucket.push(lite); else cancellations.set(key, [lite]);
  }
  return {
    agentNames: new Map(agentDocs.map(agent => [String(agent._id), typeof agent.name === "string" && agent.name ? agent.name : "Unknown Agent"])),
    leads: new Map([...formDocs.map(lead => [leadKey("FormLead", lead._id), lead] as const), ...callDocs.map(lead => [leadKey("CallLead", lead._id), lead] as const)]),
    bookings,
    cancellations,
    latestCalls: new Map(latestDocs.map(call => [String(call._id), { _id: call.id, started_at: call.started_at, direction: call.direction, provider_result: call.provider_result ?? null, contact_type: call.contact_type }])),
  };
}

export async function toOutreachDto(record: RecordRow, now = new Date(), coverage?: CoverageDto,
  prefetched: { policy?: CsiPolicy; inputs?: OutreachInputs; side?: OutreachSideData } = {}) {
  const policy = prefetched.policy ?? await resolvePolicy();
  const inputs = prefetched.inputs ?? await loadOutreachInputs(record, now);
  const { actions, restrictions, number } = inputs;
  const activeRestrictions = restrictions.filter(r => r.state === "active" && (!r.until || r.until > now));
  const side = prefetched.side ?? await loadOutreachSideData([record], new Map([[String(record._id), inputs]]));
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
    allowed_actions: (["patch_followup", "complete_followup", "cancel_followup", "snooze_followup"] as const).map(action => availability(action, a)) }));
  const { actions: actionFacts, ...derived } = facts;
  const lead = record.subject.kind === "lead" && record.subject.model && record.subject.id ? side.leads.get(leadKey(record.subject.model, record.subject.id)) ?? null : null;
  const bookings = record.subject.kind === "lead" && record.subject.model && record.subject.id ? side.bookings.get(leadKey(record.subject.model, record.subject.id)) ?? [] : [];
  const cancellations = bookings.flatMap(booking => side.cancellations.get(String(booking._id)) ?? []);
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
  const callAvailability = [
    { action: "start_call" as const, enabled: record.state !== "closed" && !callInProgress && !callRestricted,
      blocker_codes: [...(record.state === "closed" || callInProgress ? ["ILLEGAL_TRANSITION" as const] : []), ...(callRestricted ? ["CONTACT_RESTRICTED" as const] : [])] },
    { action: "end_call" as const, enabled: record.state !== "closed" && callInProgress,
      blocker_codes: record.state !== "closed" && callInProgress ? [] : ["ILLEGAL_TRANSITION" as const] },
  ].map(a => ({ ...a, target_id: String(record._id), expected_revision: record.revision }));
  return outreachDtoSchema.parse({ id: String(record._id), revision: record.revision,
    lead_attachment: mirror ? { attachment_id: String(mirror.attachment_id), lead_ref: { model: mirror.lead_ref.model, id: String(mirror.lead_ref.id) },
      state: mirror.state, certainty: mirror.certainty, certainty_label: certaintyLabel(mirror.certainty), decided_by: mirror.decided_by,
      decided_at: iso(mirror.decided_at), confidence: mirror.confidence ?? null, observed_at: iso(mirror.observed_at),
      lead_display: lead && String(lead._id) === String(mirror.lead_ref.id) ? { name: lead.name ?? null, job_no: lead.job_no ?? null } : null } : null,
    call_progress: record.call_progress ? { state: record.call_progress.state, started_at: iso(record.call_progress.started_at),
      started_by: record.call_progress.started_by, ended_at: iso(record.call_progress.ended_at), ended_by: record.call_progress.ended_by,
      note: record.call_progress.note } : null,
    lead_display: lead ? { name: lead.name ?? null, job_no: lead.job_no ?? null, source_company: lead.source_company_label_snapshot ?? null } : null,
    latest_number_call: latest ? { id: String(latest._id), happened_at: iso(latest.started_at), direction: latest.direction, provider_result: latest.provider_result ?? null, contact_type: latest.contact_type } : null,
    primary_number: number ? { id: String(number._id), e164: number.e164 } : null,
    subject: record.subject.kind === "lead" ? { kind: "lead", model: record.subject.model, id: String(record.subject.id) } : { kind: "number_review", contact_number_id: String(record.subject.contact_number_id) },
    state: projectedState, reason: record.closed_reason, assignment: assignment(record), followups, followups_cursor: null,
    trigger_at: iso(record.trigger_at), first_action_due_at: iso(record.first_action_due_at), first_attributable_outbound_at: iso(record.first_attributable_outbound_at),
    next_action: followups.find(a => a.id === String(record.next_action?.followup_id)) ?? null, first_human_conversation_at: iso(record.first_human_conversation_at),
    last_meaningful_contact_at: iso(record.last_meaningful_contact_at), related_record_links: related,
    derived: { ...derived, action_facts: actionFacts, call_state: record.call_progress?.state ?? "not_started", provenance_state: provenanceState(mirror) },
    allowed_actions: [...(["mark_worked", "assign", "set_waiting", "add_note", "close", "reopen", "create_followup"] as const).map(action => ({ action, target_id: String(record._id), expected_revision: record.revision,
      enabled: action === "add_note" || (action === "reopen" ? record.state === "closed" && record.closure_origin !== "official" && number?.contact_eligibility.state !== "suppressed" : record.state !== "closed"), blocker_codes: [] })), ...callAvailability] });
}
export async function readOutreach(id: string) {
  const record = await getOutreachRecordModel().findOne({ _id: id, purged_at: null }).lean();
  if (!record) return null;
  const now = new Date(), [coverage, policy, instructions, inputs, nudges] = await Promise.all([
    readCaptureCoverage(), resolvePolicy(),
    getSalesIntelligenceOwnerInstructionModel().find({ subject_key: subjectKey(record.subject) }).sort({ happened_at: 1 }).lean(),
    loadOutreachInputs(record, now), nudgeHistoryPage({ outreach_record_id: id, limit: 20 })]);
  const side = await loadOutreachSideData([record], new Map([[String(record._id), inputs]]));
  return { as_of: now.toISOString(), coverage, data: { outreach: await toOutreachDto(record, now, coverage, { policy, inputs, side }),
    owner_instructions: instructions, nudges } };
}
export async function readOutreachByLead(model: "FormLead" | "CallLead", id: string) {
  const row = await getOutreachRecordModel().findOne({ "subject.model": model, "subject.id": id, purged_at: null }).lean();
  return row ? readOutreach(String(row._id)) : null;
}
export async function readNumberOutreach(numberId: string) {
  const [edges, restrictions] = await Promise.all([
    getNumberLeadAttachmentModel().find({ contact_number_id: numberId }).lean(),
    getSalesIntelligenceContactRestrictionModel().find({ contact_number_id: numberId }).lean()]);
  const [records, conversations] = await Promise.all([
    getOutreachRecordModel().find({ purged_at: null, $or: [{ primary_contact_number_id: numberId }, { "subject.contact_number_id": numberId },
      ...edges.map(e => ({ "subject.model": e.lead_ref.model, "subject.id": e.lead_ref.id }))] }).lean(),
    getLeadConversationModel().find({ contact_number_id: numberId }).select({ _id: 1 }).lean()]);
  const reviewItems = await getSalesIntelligenceReviewItemModel().find({ subject_key: { $in: [`number:${numberId}`, ...records.map(r => subjectKey(r.subject)), ...conversations.map(c => `conversation:${c._id}`)] } }).lean();
  // Policy and Coverage are invariants of the read, not of each record.
  const now = new Date(), [coverage, policy, inputs] = await Promise.all([readCaptureCoverage(), resolvePolicy(), loadOutreachInputsBatch(records, now)]);
  const side = await loadOutreachSideData(records, inputs);
  return { outreach_records: await Promise.all(records.map(r => toOutreachDto(r, now, coverage, { policy, inputs: inputs.get(String(r._id)), side }))), restrictions: restrictions.map(r => restrictionDtoSchema.parse({ id: String(r._id), revision: r.revision,
    contact_number_id: String(r.contact_number_id), channels: r.channels, until: iso(r.until), origin: r.origin, state: r.state, run_id: r.run_id ? String(r.run_id) : null,
    finding_id: r.finding_id ? String(r.finding_id) : null, allowed_actions: [{ action: "resolve_restriction", target_id: String(r._id), expected_revision: r.revision, enabled: r.state === "active", blocker_codes: [] }] })), review_items: reviewItems.map(toReviewDto) };
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
