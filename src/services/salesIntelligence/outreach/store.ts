import mongoose from "mongoose";
import { z } from "zod";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { CsiError } from "../auth";
import { appendCsiAudit, payloadHash, type CsiTransactionContext } from "../transactions";
import { enqueueCsiJob } from "../jobs";
import { attentionDue } from "./derive";
import { stateWithActions } from "./transitions";
import { attentionEvolutionEnabled, subjectKey, type RecordRow, type FollowupRow } from "./types";

export type JsonValue = z.infer<ReturnType<typeof z.json>>;
export const jsonValue = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value ?? { value: null }));
export async function recordForUpdate(id: string, context: CsiTransactionContext, expected?: number) {
  const row = await getOutreachRecordModel().findById(id).session(context.session);
  if (!row) throw new CsiError("INVALID_INPUT");
  if (expected !== undefined && row.revision !== expected) throw new CsiError("REVISION_CONFLICT");
  // Every action/worker mutation writes the aggregate, serializing Owner versus worker.
  return row;
}
export async function auditChange(context: CsiTransactionContext, kind: "outreach" | "followup" | "restriction" | "interaction", key: string,
  row: { _id: unknown; revision: number }, prior: unknown, current: unknown, event: string, happened_at?: Date) {
  await appendCsiAudit(context, { kind, subject_key: key, target_id: String(row._id), revision: row.revision, event_kind: event, prior: jsonValue(prior), current: jsonValue(current), happened_at });
}
export async function ownerInstruction(context: CsiTransactionContext, record: RecordRow, field: "assignment" | "due_at" | "description" | "kind" | "status" | "contact_type" | "restriction" | "closure", prior: unknown, current: unknown, followup_id?: string) {
  const instruction_id = new mongoose.Types.ObjectId();
  await getSalesIntelligenceOwnerInstructionModel().create([{ instruction_id, subject_key: subjectKey(record.subject), followup_id,
    field, prior: jsonValue(prior), current: jsonValue(current), actor: context.actor, happened_at: context.now, state: "active" }], { session: context.session });
  return instruction_id;
}
export async function saveFollowup(action: import("mongoose").HydratedDocument<FollowupRow>, prior: unknown, context: CsiTransactionContext, key: string, event: string) {
  if (!action.isNew) action.revision++;
  action.attention_due_at = attentionDue(action);
  await action.save({ session: context.session });
  const eventTime = ["intelligence_followup_created", "missed_call_episode"].includes(event) ? action.date_resolution?.anchor : ["call_fulfilled_action", "historical_missed_fulfilled"].includes(event) ? action.completed_at : null;
  await auditChange(context, "followup", key, action, prior, action.toObject(), event, eventTime ?? undefined);
}
export async function refreshRecord(record: Awaited<ReturnType<typeof recordForUpdate>>, context: CsiTransactionContext, event: string, prior: unknown, details: Record<string, JsonValue> = {}) {
  const beforeRefresh = payloadHash(jsonValue(record.toObject()));
  let actionChanged = false;
  const actions = await getOutreachFollowupModel().find({ outreach_record_id: record._id, status: "open" }).session(context.session);
  for (const a of actions) if (a.kind === "wait" && a.due_at && a.due_at <= context.now && !a.wait_expired_at) {
    const before = a.toObject(); a.wait_expired_at = a.due_at;
    await saveFollowup(a, before, context, subjectKey(record.subject), "wait_expired");
    actionChanged = true;
  }
  record.state = stateWithActions(record, actions, context.now);
  const next = [...actions].sort((a, b) => +(attentionDue(a) ?? new Date(8640000000000000)) - +(attentionDue(b) ?? new Date(8640000000000000)) || String(a._id).localeCompare(String(b._id)))[0];
  record.next_action = next ? { followup_id: next._id, kind: next.kind, due_at: next.due_at, description: next.description } : null;
  const wait = record.state === "waiting_on_customer" ? actions.find(a => a.kind === "wait") : null;
  record.wait_until = wait?.due_at ?? null; record.wait_followup_id = wait?._id ?? null;
  // A clock scan is not an Owner edit. Keep actual transitions fenced, but do not
  // invalidate every open editor merely because the worker inspected this row.
  if (event === "clock_boundary" && !record.isNew && !actionChanged && beforeRefresh === payloadHash(jsonValue(record.toObject()))) return;
  if (!record.isNew) record.revision++;
  await record.save({ session: context.session });
  await auditChange(context, "outreach", subjectKey(record.subject), record, prior, { ...record.toObject(), ...details }, event,
    ["outreach_created", "number_review_opened"].includes(event) ? record.trigger_at : undefined);
}
/**
 * Team 4 spec §7.1 / §6 rule 5: a specific plan replaces the server's own placeholders. A new LLM,
 * Move assessment or Owner action supersedes every open `default_kind` action on the record, and
 * a new `call` action also supersedes open promise retry successors (`promise_chain`). Status
 * `superseded` with `cancel_reason: superseded_by_specific_plan`, audited through `saveFollowup`
 * in the caller's transaction (the timeline reads it as `followup_superseded`). Flag off: no-op.
 */
export const SUPERSEDED_BY_SPECIFIC_PLAN = "superseded_by_specific_plan";
export async function supersedeDefaults(record: Pick<RecordRow, "_id" | "subject">, context: CsiTransactionContext, created: { _id: mongoose.Types.ObjectId | string; kind: string }) {
  if (!attentionEvolutionEnabled()) return [] as string[];
  const placeholders = await getOutreachFollowupModel().find({ outreach_record_id: record._id, status: "open", _id: { $ne: created._id },
    $or: [{ default_kind: { $type: "string" } }, ...(created.kind === "call" ? [{ "promise_chain.root_id": { $exists: true } }] : [])] }).sort({ _id: 1 }).session(context.session);
  for (const action of placeholders) {
    const before = action.toObject();
    action.status = "superseded"; action.cancel_reason = SUPERSEDED_BY_SPECIFIC_PLAN; action.snoozed_until = null;
    await saveFollowup(action, before, context, subjectKey(record.subject), "followup_superseded_by_plan");
  }
  return placeholders.map(action => String(action._id));
}
export type ClosureOrigin = "official" | "owner" | "crm_disposition";
export async function closeRecord(record: Awaited<ReturnType<typeof recordForUpdate>>, reason: string, origin: ClosureOrigin, context: CsiTransactionContext, details: Record<string, JsonValue> = {}) {
  const prior = record.toObject();
  if (record.state === "closed" && record.closed_reason === reason && record.closure_origin === origin) return;
  for (const action of await getOutreachFollowupModel().find({ outreach_record_id: record._id, status: "open" }).session(context.session)) {
    const before = action.toObject(); action.status = "cancelled"; action.cancel_reason = reason; action.snoozed_until = null;
    await saveFollowup(action, before, context, subjectKey(record.subject), "closure_cancelled_action");
  }
  record.state = "closed"; record.state_before_identity_review = null; record.closed_reason = reason;
  record.closed_at = context.now; record.closed_by = context.actor.id; record.closure_origin = origin;
  await refreshRecord(record, context, "outreach_closed", prior, details);
  // A CRM disposition closure refreshes displays through the Attention publish and reads; it must not
  // nominate a paid Number analysis (§12: Priority-only changes make no model call).
  if (origin !== "crm_disposition") await enqueueCsiJob({ stage: "number_refresh", subject_key: subjectKey(record.subject), input_revision: record.revision,
    dedupe_key: `csi:outreach-closure:${record._id}:${record.revision}`, input_refs: [String(record._id)] }, context.session);
}
/**
 * LP-06: `rollups.last_human_conversation_at` / `human_conversations_total` on the Contact Number
 * are owned by the Number rebuild. Capture never labels a call a human conversation; findings and
 * the Owner do. Queue the durable rebuild in the same transaction whenever the label crosses the
 * human-conversation boundary, keyed by the interaction's projection revision.
 */
export async function queueNumberRollupRebuild(call: { _id: unknown; contact_number_id?: unknown; projection_revision: number }, before: string | null | undefined, after: string, session: mongoose.ClientSession) {
  if (!call.contact_number_id || (before === "human_conversation") === (after === "human_conversation")) return;
  const numberId = String(call.contact_number_id);
  await enqueueCsiJob({ stage: "rebuild", subject_key: `number:${numberId}`, dedupe_key: `csi:rebuild:number:${numberId}:contact-type:${call._id}:${call.projection_revision}`,
    input_revision: call.projection_revision, input_refs: [numberId] }, session);
}
/** Stable, meaningful Vantage context fingerprint; excludes observed time and projection bookkeeping. */
export const vantageEventFingerprint = (record: RecordRow, actions: readonly FollowupRow[], official: unknown) => payloadHash(jsonValue({ subject: record.subject, state: record.state,
  closed_reason: record.closed_reason, assignment: record.responsible_agent_id, actions: [...actions].sort((a, b) => a.commitment_key.localeCompare(b.commitment_key)).map(a => ({ key: a.commitment_key, revision: a.revision, status: a.status, due_at: a.due_at, owner: a.responsible_agent_id })), official }));
