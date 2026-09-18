import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getSalesIntelligenceContactRestrictionModel } from "../../../models/SalesIntelligenceContactRestriction";
import { getSalesIntelligenceReviewItemModel } from "../../../models/SalesIntelligenceReviewItem";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { getSalesIntelligenceAuditEventModel } from "../../../models/SalesIntelligenceAuditEvent";
import mongoose, { type InferSchemaType } from "mongoose";
import type { SalesIntelligenceReviewItemSchema } from "../../../models/SalesIntelligenceReviewItem";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { ownerRead, readCaptureCoverage } from "../../numberActivity/coverage";
import { outreachDtoSchema, reviewItemDtoSchema, restrictionDtoSchema, type CoverageDto } from "../dto";
import { resolvePolicy } from "../policy";
import { derive, attentionDue } from "./derive";
import { stateWithActions } from "./transitions";
import { subjectKey, type RecordRow, type FollowupRow } from "./types";

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
export async function toOutreachDto(record: RecordRow, now = new Date(), coverage?: CoverageDto) {
  const key = subjectKey(record.subject), policy = await resolvePolicy();
  const [actions, restrictions, reviewItems, number, attempts] = await Promise.all([
    getOutreachFollowupModel().find({ outreach_record_id: record._id }).sort({ _id: 1 }).lean(),
    getSalesIntelligenceContactRestrictionModel().find({ contact_number_id: record.primary_contact_number_id }).lean(),
    getSalesIntelligenceReviewItemModel().find({ subject_key: { $in: [key, `number:${record.primary_contact_number_id}`] } }).lean(),
    getContactNumberModel().findById(record.primary_contact_number_id).lean(),
    getSalesIntelligenceAuditEventModel().find({ subject_key: key, event_kind: "outreach_call_applied", "current.outboundAttempt": true,
      "current.human": false, "current.happened_at": { $gt: new Date(+now - 86_400_000).toISOString() } }).lean(),
  ]);
  const activeRestrictions = restrictions.filter(r => r.state === "active" && (!r.until || r.until > now));
  const agentIds = [record.responsible_agent_id, ...actions.flatMap(a => [a.responsible_agent_id, a.promised_by_agent_id])].filter((v): v is mongoose.Types.ObjectId => Boolean(v));
  const agents = await mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).collection("agents").find({ _id: { $in: agentIds } }, { projection: { name: 1 } }).toArray();
  const agent = (id: unknown) => id ? { id: String(id), name: agents.find(a => String(a._id) === String(id))?.name ?? "Unknown Agent" } : null;
  const assignment = (row: Pick<FollowupRow, "responsible_agent_id" | "assignment">) => ({ agent: agent(row.responsible_agent_id), origin: row.assignment?.origin ?? null,
    assigned_at: iso(row.assignment?.assigned_at), evidence_ref: row.assignment?.evidence_id ? String(row.assignment.evidence_id) : null, owner_instruction_id: row.assignment?.instruction_id ? String(row.assignment.instruction_id) : null });
  const projected = { ...record, state: stateWithActions(record, actions, now) };
  const facts = derive(projected, { now, policy, staffing: policy, followups: actions, restrictions, reviewItems, coverage: coverage ?? await readCaptureCoverage(),
    suppressed: number?.contact_eligibility.state === "suppressed", unsuccessfulAttempts: [...new Map(attempts.map(a => [String(a.current.interaction_id), new Date(String(a.current.happened_at))])).values()] });
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
  return outreachDtoSchema.parse({ id: String(record._id), revision: record.revision,
    subject: record.subject.kind === "lead" ? { kind: "lead", model: record.subject.model, id: String(record.subject.id) } : { kind: "number_review", contact_number_id: String(record.subject.contact_number_id) },
    state: projected.state, reason: record.closed_reason, assignment: assignment(record), followups, followups_cursor: null,
    trigger_at: iso(record.trigger_at), first_action_due_at: iso(record.first_action_due_at), first_attributable_outbound_at: iso(record.first_attributable_outbound_at),
    next_action: followups.find(a => a.id === String(record.next_action?.followup_id)) ?? null, first_human_conversation_at: iso(record.first_human_conversation_at),
    last_meaningful_contact_at: iso(record.last_meaningful_contact_at), derived: { ...derived, action_facts: actionFacts }, related_record_links: [],
    allowed_actions: (["mark_worked", "assign", "set_waiting", "add_note", "close", "reopen"] as const).map(action => ({ action, target_id: String(record._id), expected_revision: record.revision,
      enabled: action === "add_note" || (action === "reopen" ? record.state === "closed" && record.closure_origin !== "official" && number?.contact_eligibility.state !== "suppressed" : record.state !== "closed"), blocker_codes: [] })) });
}
export async function readOutreach(id: string) {
  const record = await getOutreachRecordModel().findById(id).lean();
  if (!record) return null;
  const now = new Date(), coverage = await readCaptureCoverage();
  const instructions = await getSalesIntelligenceOwnerInstructionModel().find({ subject_key: subjectKey(record.subject) }).sort({ happened_at: 1 }).lean();
  return { as_of: now.toISOString(), coverage, data: { outreach: await toOutreachDto(record, now, coverage), owner_instructions: instructions } };
}
export async function readOutreachByLead(model: "FormLead" | "CallLead", id: string) {
  const row = await getOutreachRecordModel().findOne({ "subject.model": model, "subject.id": id }).lean();
  return row ? readOutreach(String(row._id)) : null;
}
export async function readNumberOutreach(numberId: string) {
  const edges = await getNumberLeadAttachmentModel().find({ contact_number_id: numberId }).lean();
  const records = await getOutreachRecordModel().find({ $or: [{ primary_contact_number_id: numberId }, { "subject.contact_number_id": numberId },
    ...edges.map(e => ({ "subject.model": e.lead_ref.model, "subject.id": e.lead_ref.id }))] }).lean();
  const restrictions = await getSalesIntelligenceContactRestrictionModel().find({ contact_number_id: numberId }).lean();
  const reviewItems = await getSalesIntelligenceReviewItemModel().find({ subject_key: { $in: [`number:${numberId}`, ...records.map(r => subjectKey(r.subject))] } }).lean();
  return { outreach_records: await Promise.all(records.map(r => toOutreachDto(r))), restrictions: restrictions.map(r => restrictionDtoSchema.parse({ id: String(r._id), revision: r.revision,
    contact_number_id: String(r.contact_number_id), channels: r.channels, until: iso(r.until), origin: r.origin, state: r.state, run_id: r.run_id ? String(r.run_id) : null,
    finding_id: r.finding_id ? String(r.finding_id) : null, allowed_actions: [] })), review_items: reviewItems.map(toReviewDto) };
}
export function toReviewDto(r: InferSchemaType<typeof SalesIntelligenceReviewItemSchema> & { _id: mongoose.Types.ObjectId; updatedAt: Date }) {
  return reviewItemDtoSchema.parse({ id: String(r._id), revision: r.revision, subject_key: r.subject_key, cause_kind: r.cause_kind, cause_key: r.cause_key, state: r.state,
    evidence_refs: r.evidence_ids.map(String), opened_at: iso(r.opened_at), updated_at: iso(r.updatedAt), resolved_at: iso(r.resolved_at), resolution_reason: r.resolution_reason, allowed_actions: [] });
}
export async function listReviewItems(query: { cursor?: string; limit: number }) {
  const rows = await getSalesIntelligenceReviewItemModel().find(query.cursor ? { _id: { $gt: query.cursor } } : {}).sort({ _id: 1 }).limit(query.limit + 1).lean();
  return ownerRead({ items: rows.slice(0, query.limit).map(toReviewDto), cursor: rows.length > query.limit ? String(rows[query.limit - 1]!._id) : null });
}
