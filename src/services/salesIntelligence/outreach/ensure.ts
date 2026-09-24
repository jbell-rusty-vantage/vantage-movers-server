import mongoose, { type ClientSession } from "mongoose";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { resolveRepIdentities } from "../repIdentity/resolve";
import { getSalesIntelligenceAuditEventModel } from "../../../models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { csiDataset, csiFlag } from "../../../config/domain/salesIntelligence";
import { csiWorkerActor } from "../auth";
import { appendCsiAudit, payloadHash, type CsiTransactionContext } from "../transactions";
import { resolvePolicy } from "../policy";
import { loadLead } from "../attachment/sources";
import { attachmentPolicyInput, type StoredAttachment } from "../attachment/store";
import { resolveAtInteraction, type LeadRef } from "../attachment/suggest";
import { openReview } from "../review/items";
import { addStaffedMinutes } from "./staffing";
import { authoritativeClosure, callFacts, customerCalledBack, fulfilledByCall, pickCallbackTarget, type CompletionPolicy } from "./transitions";
import { closeRecord, jsonValue, refreshRecord, saveFollowup, recordForUpdate } from "./store";
import { attentionEvolutionEnabled, CONTACT_FACT_FIELDS, mayReplaceAssignment, progressPlanEnabled, subjectKey, type InteractionRow, type RecordRow } from "./types";
export { CONTACT_FACT_FIELDS } from "./types";
import { isPromisedCallback, KNOWN_MISS_DISPOSITIONS } from "./derive";
import { csiPolicyEvolution, type CsiPolicy } from "../../../validation/v1/salesIntelligence";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { historicalCaptureReady, historicalAttachmentsReady } from "../backfill/readiness";
import { getEntityChangeModel } from "../../../models/EntityChange";
import { getSalesIntelligenceReviewItemModel } from "../../../models/SalesIntelligenceReviewItem";
import { closureBasisFor, isTerminal, projectLeadProgress, selectProgressEvidence, type LeadProgressRow, type ProgressEvidence, type ProgressEvidenceSet, type SourceOrigin } from "./leadProgress";

export function workerContext(session: ClientSession, requestId: string, now = new Date()): CsiTransactionContext {
  return { session, actor: csiWorkerActor(/^[a-f\d]{24}$/i.test(requestId) ? requestId : payloadHash(requestId).slice(0, 24)), command_id: new mongoose.Types.ObjectId(), now };
}
/**
 * Number rollup `outreach_records_total` (data spec §8): records with this Number as
 * `primary_contact_number_id` or `subject.contact_number_id`, not purged. Called exactly where a
 * record starts to reference a Number: `outreach_created` with a primary, `outreach_number_linked`
 * (primary set from null; it is never re-pointed), and `number_review_opened` (subject and primary
 * are the same Number, so the record counts once). `$inc` without a revision bump, in the caller's
 * transaction with the record insert or link, so a concurrent capture or rebuild that read this
 * Number earlier aborts on WriteConflict and re-reads; the rebuild recounts it with `countDocuments`.
 */
export async function countOutreachRecordOnNumber(numberId: string | mongoose.Types.ObjectId, session: ClientSession) {
  await getContactNumberModel().updateOne({ _id: numberId }, { $inc: { "rollups.outreach_records_total": 1 } }, { session });
}
export type EnsureLeadOptions = {
  /** The `EntityChange` that raised this job, so basis and `source_change_id` are exact (H1). */
  changeId?: string | null;
};
/**
 * The Lead projection (§13.3 H1). Keeps every call site: `outreach-lead` jobs,
 * `outreach-clock`, the attachment reaction and the repair sweep. In the caller's
 * transaction it mirrors official/authoritative closure, then — behind
 * LEAD_PROGRESS — projects the current canonical Priority/Quoted into
 * `lead_progress`, applies the §4 ordering and saves only when the semantic
 * fingerprint changed, so an identical re-delivery writes nothing.
 */
export async function ensureLead(ref: LeadRef, context: CsiTransactionContext, numberId?: string, options: EnsureLeadOptions = {}) {
  const lead = await loadLead(ref, context.session);
  if (!lead) return null;
  const Model = getOutreachRecordModel();
  let row = await Model.findOne({ "subject.kind": "lead", "subject.model": ref.model, "subject.id": ref.id }).session(context.session);
  const policy = await resolvePolicy();
  if (!row) {
    row = new Model({ subject: { kind: "lead", model: ref.model, id: ref.id }, trigger_kind: "lead_arrival", trigger_at: lead.timestamp,
      primary_contact_number_id: numberId ?? null, policy_version: policy.version,
      first_action_due_at: ref.model === "FormLead" ? addStaffedMinutes(lead.timestamp, policy.first_action_due_staffed_minutes, policy) : null,
      deadline_resolution: { precision: "exact", timezone: policy.timezone, assumption: "Staffed first-call deadline", anchor: lead.timestamp, policy_version: policy.version } });
    // AC3 §5.2/§5.4: `called_before_form` and the contact facts are computed at creation.
    if (attentionEvolutionEnabled()) row.set(await computeContactFacts(row, context.session));
    await refreshRecord(row, context, "outreach_created", null);
    if (numberId) await countOutreachRecordOnNumber(numberId, context.session);
  } else if (numberId && !row.primary_contact_number_id) {
    const prior = row.toObject(); row.primary_contact_number_id = new mongoose.Types.ObjectId(numberId);
    // A first primary Number changes which calls count (`prior_contact_at` included): recompute them.
    if (attentionEvolutionEnabled()) row.set(await computeContactFacts(row, context.session));
    await refreshRecord(row, context, "outreach_number_linked", prior);
    // A Lead record's subject never names a Number, so linking its first primary is a new record for this Number.
    // (Retention purges records by primary, so a record without one is never purged.)
    await countOutreachRecordOnNumber(numberId, context.session);
  } else await backfillContactFacts(row, context);
  // §11.1: an exact Booking relationship closes work even when the Lead mirror is delayed.
  const reason = await authoritativeClosure(lead, ref, context.session);
  if (reason) await closeRecord(row, reason, "official", context);
  // G8 (reconciliation §4.2): inside `applyLeadProgress` the CRM-disposition closure (accepted 5/7/8) is decided
  // before the §7.1 quote default can be created, so an accepted 5 (Granot also sets `quoted`) never gets one.
  if (csiFlag("LEAD_PROGRESS")) await applyLeadProgress(row, lead, ref, context, options.changeId ?? null, reason);
  if (numberId) {
    const numberReview = await Model.findOne({ "subject.kind": "number_review", "subject.contact_number_id": numberId, state: { $ne: "closed" } }).session(context.session);
    if (numberReview) await closeRecord(numberReview, "lead_context_available", "official", context);
  }
  return row;
}

const PROGRESS_PATHS = ["granot_priority", "quoted"];
function toEvidence(change: { _id: mongoose.Types.ObjectId; applied_at: Date; provenance?: { source_system?: string; observation_id?: unknown; decision_id?: unknown }; fields: ReadonlyArray<{ path: string; before?: unknown; after?: unknown }> }): ProgressEvidence {
  const system = change.provenance?.source_system;
  return { change_id: change._id, applied_at: change.applied_at, fields: change.fields,
    source_system: (system === "granot" || system === "ringcentral" ? system : "vantage") as SourceOrigin,
    observation_id: change.provenance?.observation_id ? new mongoose.Types.ObjectId(String(change.provenance.observation_id)) : null,
    decision_id: change.provenance?.decision_id ? new mongoose.Types.ObjectId(String(change.provenance.decision_id)) : null };
}
/**
 * The accepted changes that vouch for the Lead's current Priority and Quoted
 * values, judged per field over the entity's recent changes (§6). A stale
 * triggering change never regresses provenance: the latest change that agrees
 * with the current value wins, whichever job delivered it. A value with no
 * vouching change is displayed as uncertain provenance: it neither establishes
 * work nor cancels actions.
 */
export const PROGRESS_EVIDENCE_WINDOW = 25;
export async function latestProgressEvidence(ref: LeadRef, session: ClientSession, lead: { granot_priority?: unknown; quoted?: unknown }): Promise<ProgressEvidenceSet> {
  const recent = await getEntityChangeModel().find({ "entity.model": ref.model, "entity.id": ref.id, changed_paths: { $in: PROGRESS_PATHS } })
    .sort({ applied_at: -1, _id: -1 }).limit(PROGRESS_EVIDENCE_WINDOW).session(session).lean();
  return selectProgressEvidence(recent.map(toEvidence), lead);
}
const reviewKey = (row: LeadProgressRow) => `lead_progress:${row.disposition_revision}`;
async function resolveDispositionReviews(context: CsiTransactionContext, key: string, kinds: readonly string[], reason: string) {
  const Review = getSalesIntelligenceReviewItemModel();
  const open = await Review.find({ subject_key: key, state: "open" }).session(context.session);
  for (const row of open.filter(item => kinds.includes(item.cause_kind))) {
    const prior = { state: row.state, revision: row.revision };
    row.state = "resolved"; row.resolution_actor = { ...context.actor, run_id: null }; row.resolved_at = context.now; row.resolution_reason = reason; row.revision++;
    await row.save({ session: context.session });
    await appendCsiAudit(context, { kind: "review", target_id: String(row._id), subject_key: key, revision: row.revision, event_kind: "review_resolved", prior, current: { state: row.state, reason } });
  }
}
/**
 * §3.3/§4 ordering on one record: official closure (already mirrored by the
 * caller) → Owner closure and explicit override → identity restriction → CRM
 * disposition → accepted Lead progress → existing action-state derivation.
 */
async function applyLeadProgress(record: Awaited<ReturnType<typeof recordForUpdate>>, lead: Awaited<ReturnType<typeof loadLead>> & object, ref: LeadRef, context: CsiTransactionContext, changeId: string | null, officialReason: string | null) {
  const prior = record.toObject();
  const canonical = lead as { granot_priority?: unknown; quoted?: unknown };
  const evidence = await latestProgressEvidence(ref, context.session, canonical);
  // Eligibility gates the state transition only; evidence is recorded whatever the state.
  const eligible = officialReason === null && record.state !== "identity_review" && record.closure_origin !== "owner";
  const next = projectLeadProgress({ lead: canonical, prior: (record.lead_progress as LeadProgressRow | null) ?? null, evidence, now: context.now });
  const before = record.lead_progress as LeadProgressRow | null;
  const key = subjectKey(record.subject);
  const dispositionChanged = before?.disposition_revision !== next.disposition_revision;
  const overrideExpired = Boolean(before?.override) && !next.override;
  let event: string | null = before?.fingerprint === next.fingerprint && before?.override?.instruction_id?.toString() === next.override?.instruction_id?.toString() ? null : "lead_progress_updated";
  const terminal = isTerminal(next.disposition);
  let becameOpen = false;
  if (officialReason || record.closure_origin === "owner") {
    // Stronger closures keep their reason. Facts are still refreshed for display and repair.
  } else if (terminal && next.provenance === "accepted" && !next.override) {
    const basis = closureBasisFor(next.disposition)!;
    if (record.state !== "closed") {
      await closeRecord(record, basis, "crm_disposition", context, { disposition: next.disposition, source_change_id: next.source_change_id ? String(next.source_change_id) : null });
      event = "lead_progress_updated";
    } else if (record.closure_origin === "crm_disposition" && record.closed_reason !== basis) {
      // 5 ↔ 7 ↔ 8 refreshes the current disposition and keeps the closure history (closed_at unchanged).
      record.closed_reason = basis; event = "lead_progress_updated";
    }
    if (next.reopen_review_id) { await resolveDispositionReviews(context, key, ["disposition_reopen"], "disposition_terminal_again"); next.reopen_review_id = null; event = "lead_progress_updated"; }
    // Accepted evidence answers an earlier uncertain-provenance review.
    if (before?.provenance === "uncertain") await resolveDispositionReviews(context, key, ["disposition_review"], "disposition_provenance_accepted");
    if (overrideExpired) event = "lead_progress_updated";
  } else if (terminal && next.provenance === "accepted" && next.override) {
    // A revision-scoped Owner override permits work despite the CRM disposition; nothing to change.
  } else if (terminal && next.provenance === "uncertain") {
    // A terminal value of uncertain origin is visible and blocks new sales execution, but cancels nothing (§6).
    await openReview(context, key, "disposition_review", reviewKey(next), []);
  } else {
    // Nonterminal.
    await resolveDispositionReviews(context, key, ["disposition_review"], "disposition_nonterminal");
    if (record.state === "closed" && record.closure_origin === "crm_disposition") {
      if (!next.reopen_review_id) {
        const review = await openReview(context, key, "disposition_reopen", reviewKey(next), []);
        next.reopen_review_id = review._id; event = "lead_progress_updated";
      }
    } else if (record.state === "unworked" && eligible && next.work_observed && !terminal) {
      record.state = "open"; event = "lead_progress_updated"; becameOpen = true;
    }
  }
  if (dispositionChanged && !terminal && next.reopen_review_id && record.state !== "closed") next.reopen_review_id = null;
  if (!event) return;
  record.lead_progress = next;
  // §7.1 / §8.1: accepted progress to Quoted that opens the record, or moves an open record to Quoted. A terminal
  // disposition (S6-P5: 5 included) never reaches here as `quoted`, and a 5 → 1 on closed work leaves it closed.
  const quotedProgress = next.provenance === "accepted" && next.disposition === "quoted" && eligible && (becameOpen || (record.state === "open" && dispositionChanged));
  let defaultId: string | null = null;
  if (attentionEvolutionEnabled()) {
    // §7.3: accepted progress is activity (going cold resets).
    if (next.provenance === "accepted" && next.last_progress_at) record.last_activity_at = latestOf(record.last_activity_at, next.last_progress_at);
    if (quotedProgress) defaultId = await createProgressDefault(record, next, context);
  }
  await refreshRecord(record, context, event, prior, { lead_progress_change_id: next.source_change_id ? String(next.source_change_id) : null, trigger_change_id: changeId,
    lead_progress_basis: next.basis, lead_progress_disposition: next.disposition, lead_progress_provenance: next.provenance, ...(overrideExpired ? { override_expired: true } : {}),
    ...(defaultId ? { default_followup_id: defaultId } : {}) });
  if (quotedProgress) await nominateProgressReplan(record, next, context);
}
/** Spec §7.1 (P4): the default next step after accepted progress to Quoted. Never a promise, never a model call. */
export const QUOTE_FOLLOWUP_DESCRIPTION = "Follow up on the quote";
export const progressDefaultKey = (recordId: unknown, dispositionRevision: string) => `progress-default:${recordId}:${dispositionRevision}`;
/**
 * One `system_default` day-precision call due one staffed day (policy) after the progress, only when
 * the record has no open action of any kind. The commitment key is per disposition revision, so a
 * re-delivery, a replay or `1 → 3 → 1` never creates a second one; it rides the caller's transaction.
 */
async function createProgressDefault(record: Awaited<ReturnType<typeof recordForUpdate>>, next: LeadProgressRow, context: CsiTransactionContext): Promise<string | null> {
  const Followups = getOutreachFollowupModel();
  const commitment_key = progressDefaultKey(record._id, next.disposition_revision);
  if (await Followups.exists({ outreach_record_id: record._id, status: "open" }).session(context.session)) return null;
  if (await Followups.exists({ commitment_key }).session(context.session)) return null;
  const policy = await resolvePolicy(context.session);
  const anchor = next.last_progress_at ?? context.now;
  const due = addStaffedMinutes(anchor, csiPolicyEvolution(policy).quote_followup_staffed_minutes, policy);
  const row = new Followups({ outreach_record_id: record._id, commitment_key, kind: "call", description: QUOTE_FOLLOWUP_DESCRIPTION, origin: "system_default",
    due_at: due, base_attention_due_at: due, default_kind: "quote_followup",
    date_resolution: { precision: "day", timezone: policy.timezone, assumption: "One staffed day after accepted progress to Quoted", anchor, policy_version: policy.version },
    responsible_agent_id: record.responsible_agent_id ?? null,
    assignment: record.responsible_agent_id ? { origin: "inherited_outreach", assigned_at: context.now } : null });
  await saveFollowup(row, null, context, subjectKey(record.subject), "progress_default_created");
  return String(row._id);
}
export const PROGRESS_REPLAN_WINDOW_MS = 30 * 86_400_000;
/**
 * §8.1 "at least one conversation with a completed summary in the last 30 days": a conversation on the
 * Number started in the window with a stored summary, either the conversation run's `summary` or a
 * retained summary-step artifact (what the Move assessment reads). Bounded; no transcript is read.
 */
async function recentSummarizedConversation(numberId: mongoose.Types.ObjectId, context: CsiTransactionContext): Promise<boolean> {
  const recent = await getLeadConversationModel().find({ contact_number_id: numberId, started_at: { $gte: new Date(+context.now - PROGRESS_REPLAN_WINDOW_MS) } })
    .select({ _id: 1, summary: 1 }).sort({ started_at: -1, _id: -1 }).limit(50).session(context.session).lean();
  if (recent.some(row => row.summary)) return true;
  if (!recent.length) return false;
  return Boolean(await getIntelligenceEvidenceSnapshotModel().exists({ ...csiDataset(), source_type: "summary", artifact_key: { $type: "string" },
    conversation_id: { $in: recent.map(row => row._id) }, purged_at: null, purge_started_at: null }).session(context.session));
}
/**
 * Spec §8.1 (P5), behind SALES_INTELLIGENCE_PROGRESS_PLAN (default off) and MOVE_ASSESSMENT: accepted
 * progress to Quoted re-plans through the Move assessment, at most once per disposition revision
 * (the job dedupe key carries `progress:<disposition_revision>`), only when the Number has a summarized
 * conversation in the last 30 days and the record has no open action other than a default.
 */
async function nominateProgressReplan(record: Awaited<ReturnType<typeof recordForUpdate>>, next: LeadProgressRow, context: CsiTransactionContext) {
  if (!progressPlanEnabled() || !csiFlag("ENABLED") || !csiFlag("MOVE_ASSESSMENT")) return null;
  const numberId = record.primary_contact_number_id;
  if (!numberId) return null;
  if (await getOutreachFollowupModel().exists({ outreach_record_id: record._id, status: "open", default_kind: { $not: { $type: "string" } } }).session(context.session)) return null;
  if (!await recentSummarizedConversation(numberId, context)) return null;
  // Loaded lazily: the assessment runtime imports this module.
  const { nominateMoveAssessment } = await import("../assessment/runtime.js");
  return nominateMoveAssessment({ outreach_record_id: String(record._id), trigger: `progress:${next.disposition_revision}`, force: true }, context.session);
}
/** Leaving identity review restores the effective state, including work established by Lead progress (§4). */
export function restoreFromIdentityReview(record: { state: string; state_before_identity_review?: string | null; lead_progress?: { work_observed?: boolean } | null }) {
  const restored = record.state_before_identity_review ?? "unworked";
  record.state = restored === "unworked" && record.lead_progress?.work_observed ? "open" : restored;
  record.state_before_identity_review = null;
}
export async function interactionAttribution(call: InteractionRow, session: ClientSession) {
  const edges = await getNumberLeadAttachmentModel().find({ contact_number_id: call.contact_number_id }).session(session).lean();
  return resolveAtInteraction(edges.map(attachmentPolicyInput), { id: String(call._id), provider_account_id: call.provider_account_id, started_at: call.started_at,
    telephony_session_id: call.telephony_session_id, session_id: call.session_id, call_log_ids: call.call_log_ids });
}
/** Read-only consumption of reviewed effective-dated identities; CSI-10 owns their creation/review. */
export async function mappedSalesReps(call: InteractionRow, session: ClientSession): Promise<string[]> {
  return (await interactionRepIdentity(call, session)).agent_ids;
}
export async function interactionRepIdentity(call: InteractionRow, session: ClientSession) {
  const ids = call.parties.filter(p => p.role === "user" && p.extension_id && p.connected).map(p => p.extension_id!);
  const resolved = await resolveRepIdentities(call.provider_account_id, ids, call.started_at, session);
  // One known participant beside an unknown/conflicting participant is not a reliably identified sole rep.
  if (resolved.resolutions.some(r => ["unknown", "proposed_only", "conflicting"].includes(r.status))) resolved.agent_ids = [];
  return resolved;
}

// ── Team 4 AC3/AC5: contact facts on the record (spec §5.4, §7.2, §7.3) ─────────────────────────
/** The four record fields written at ensure time and read from the row by `derive()` (no query in the Attention walk). */
/** The four facts plus the revision they are current at (V-AC S1). */
export type ContactFacts = Record<(typeof CONTACT_FACT_FIELDS)[number], Date | null> & { contact_facts_revision: number };
/** A record the flag never computed (legacy, or written with the flag off) lacks the fields; `null` means computed, none. */
/**
 * V-AC S1: missing (a field absent) or stale (not stamped at the current revision: the record was written
 * while the flag was off, e.g. across a rollback). Either way the next ensure or repair recomputes them.
 */
export const contactFactsMissing = (record: Partial<Record<(typeof CONTACT_FACT_FIELDS)[number], Date | null | undefined>> & { revision?: number | null; contact_facts_revision?: number | null }) =>
  CONTACT_FACT_FIELDS.some(field => record[field] === undefined) || (record.revision != null && record.contact_facts_revision !== record.revision);
/** Newest of the given instants, or null. */
export function latestOf(...values: Array<Date | null | undefined>): Date | null {
  let out: Date | null = null;
  for (const value of values) if (value && (!out || +value > +out)) out = value;
  return out;
}
/** §7.3: last activity = newest of the last human contact, the last attributable attempt, accepted Lead progress and the newest Owner command. */
export function lastActivityAt(record: Pick<RecordRow, "last_meaningful_contact_at" | "last_attributable_outbound_at" | "lead_progress">, ownerCommandAt: Date | null = null): Date | null {
  const progress = record.lead_progress?.provenance === "accepted" ? record.lead_progress.last_progress_at : null;
  return latestOf(record.last_meaningful_contact_at, record.last_attributable_outbound_at, progress, ownerCommandAt);
}
/** Bounds of the recompute (repair and H1a only; the per-call path updates the fields incrementally). */
export const CONTACT_FACTS_SCAN = 50;
export const PRIOR_CONTACT_WINDOW_MS = 7 * 86_400_000;
const PRIOR_CONTACT_SCAN = 20;
/** A rep leg on the call (the same party rule as `callFacts`). */
const hasRepParty = (call: InteractionRow) => call.parties.some(p => p.role === "user" && p.extension_id && (p.connected || (p.direction === "Outbound" && call.terminal)));
/**
 * §5.2 `called_before_form`: the newest outbound attempt or human conversation by a Vantage rep on
 * the Lead's primary Number in `[trigger_at − 7 days, trigger_at)`. Calls before the trigger are
 * never attributable to the Lead, so only the Number and the rep leg are checked.
 */
export async function priorContactAt(numberId: mongoose.Types.ObjectId | string, triggerAt: Date, session: ClientSession): Promise<Date | null> {
  const calls = await getCallInteractionModel().find({ contact_number_id: numberId, merged_into_id: null, direction: { $in: ["Inbound", "Outbound"] },
    started_at: { $gte: new Date(+triggerAt - PRIOR_CONTACT_WINDOW_MS), $lt: triggerAt } }).sort({ started_at: -1, _id: -1 }).limit(PRIOR_CONTACT_SCAN).session(session).lean();
  for (const call of calls) {
    if (call.monitoring || !hasRepParty(call)) continue;
    if ((call.direction === "Outbound" && call.terminal) || call.contact_type === "human_conversation") return call.started_at;
  }
  return null;
}
/**
 * Recompute all four fields from stored history (bounded): the newest attributable outbound attempt
 * and inbound human conversation among the newest `CONTACT_FACTS_SCAN` calls since the trigger,
 * `prior_contact_at` for a Form Lead, and `last_activity_at` (with the newest Owner instruction).
 * A record without a Number gets nulls for the call fields.
 */
export async function computeContactFacts(record: RecordRow | InstanceType<ReturnType<typeof getOutreachRecordModel>>, session: ClientSession): Promise<ContactFacts> {
  const row = record as RecordRow;
  const numberId = row.primary_contact_number_id ?? (row.subject.kind === "number_review" ? row.subject.contact_number_id : null);
  let outbound: Date | null = null, inbound: Date | null = null, prior: Date | null = null;
  if (numberId) {
    const calls = await getCallInteractionModel().find({ contact_number_id: numberId, merged_into_id: null, direction: { $in: ["Inbound", "Outbound"] },
      started_at: { $gte: row.trigger_at } }).sort({ started_at: -1, _id: -1 }).limit(CONTACT_FACTS_SCAN).session(session).lean();
    for (const call of calls) {
      if (outbound && inbound) break;
      const out = call.direction === "Outbound" && call.terminal, inboundHuman = call.direction === "Inbound" && call.contact_type === "human_conversation";
      if ((out && outbound) || (inboundHuman && inbound) || (!out && !inboundHuman)) continue;
      const facts = callFacts(row, call, await interactionAttribution(call, session), inboundHuman ? await mappedSalesReps(call, session) : []);
      if (out && facts.outboundAttempt) outbound = call.started_at;
      if (inboundHuman && facts.human) inbound = call.started_at;
    }
    if (row.subject.kind === "lead" && row.subject.model === "FormLead" && row.primary_contact_number_id) prior = await priorContactAt(row.primary_contact_number_id, row.trigger_at, session);
  }
  const owner = await getSalesIntelligenceOwnerInstructionModel().findOne({ subject_key: subjectKey(row.subject) }).sort({ happened_at: -1, _id: -1 }).select({ happened_at: 1 }).session(session).lean();
  return { contact_facts_revision: row.revision ?? 1, last_inbound_human_at: inbound, last_attributable_outbound_at: outbound, prior_contact_at: prior,
    last_activity_at: lastActivityAt({ last_meaningful_contact_at: row.last_meaningful_contact_at, last_attributable_outbound_at: outbound, lead_progress: row.lead_progress }, owner?.happened_at ?? null) };
}
/** Repair backfill (§5.4): a record whose facts were never computed gets them once, audited. Flag off: no-op. */
export async function backfillContactFacts(record: Awaited<ReturnType<typeof recordForUpdate>>, context: CsiTransactionContext) {
  if (!attentionEvolutionEnabled() || !contactFactsMissing(record)) return false;
  const prior = record.toObject();
  record.set(await computeContactFacts(record, context.session));
  await refreshRecord(record, context, "outreach_contact_facts", prior);
  return true;
}
/** Rep ids of an outbound attempt's own leg (reviewed only; any unknown/proposed/conflicting leg yields none). */
async function attemptRepIds(call: InteractionRow, session: ClientSession): Promise<string[]> {
  const ids = call.parties.filter(p => p.role === "user" && p.extension_id && (p.connected || (p.direction === "Outbound" && call.terminal))).map(p => p.extension_id!);
  if (!ids.length) return [];
  const resolved = await resolveRepIdentities(call.provider_account_id, ids, call.started_at, session);
  return resolved.resolutions.some(r => ["unknown", "proposed_only", "conflicting"].includes(r.status)) ? [] : [...new Set(resolved.agent_ids)];
}
export const FIRST_ATTEMPTS_SCAN = 20;
/**
 * §7.2 P7: the one reviewed rep behind at least `threshold` attributable attempts since the trigger,
 * when no other rep has an attributable attempt or conversation and every attempt names that rep.
 * Bounded: the first `FIRST_ATTEMPTS_SCAN` calls on the Number since the trigger.
 */
export async function firstAttemptsAgent(record: RecordRow, numberId: mongoose.Types.ObjectId | string, threshold: number, session: ClientSession): Promise<string | null> {
  const calls = await getCallInteractionModel().find({ contact_number_id: numberId, merged_into_id: null, direction: { $in: ["Inbound", "Outbound"] },
    started_at: { $gte: record.trigger_at } }).sort({ started_at: 1, _id: 1 }).limit(FIRST_ATTEMPTS_SCAN).session(session).lean();
  const reps = new Set<string>();
  let attempts = 0;
  for (const call of calls) {
    const mapped = await mappedSalesReps(call, session);
    const facts = callFacts(record, call, await interactionAttribution(call, session), mapped);
    if (facts.outboundAttempt) {
      const own = await attemptRepIds(call, session);
      if (own.length !== 1) return null;
      reps.add(own[0]!); attempts++;
    } else if (facts.attributable && call.contact_type === "human_conversation") {
      // A conversation whose rep is not reliably identified could be anyone's: never assign past it.
      if (!mapped.length) return null;
      for (const id of mapped) reps.add(id);
    }
  }
  return reps.size === 1 && attempts >= threshold ? [...reps][0]! : null;
}
export const PROMISE_RETRY_DESCRIPTION = "Try again: promised callback not reached";
export const promiseRetryKey = (rootId: unknown, attempt: number) => `retry:${rootId}:${attempt}`;
/**
 * V-AC B1 (2026-09-24): capture never labels a connected call a human conversation; only a finding
 * (`finding:<id>`) or the Owner (`owner`) classifies it. Until then a `connected_contact_unknown`
 * completion is not known to be a miss.
 */
export const contactClassified = (call: Pick<InteractionRow, "contact_type_basis">) =>
  Boolean(call.contact_type_basis && (call.contact_type_basis === "owner" || call.contact_type_basis.startsWith("finding:")));
/** A completion that is a known miss: no answer, voicemail, or a connected call classified as not a conversation. */
export function knownMiss(disposition: string | null | undefined, call: Pick<InteractionRow, "contact_type" | "contact_type_basis">): boolean {
  if (call.contact_type === "human_conversation") return false;
  if ((KNOWN_MISS_DISPOSITIONS as readonly string[]).includes(disposition ?? "")) return true;
  return disposition === "connected_contact_unknown" && contactClassified(call);
}
/**
 * Spec §6 rule 4 (F9): a promised callback (or one of its successors) that a call completed without
 * reaching the customer gets one `system_default` exact successor due `callback_retry_staffed_minutes`
 * after that call, while `attempt <= callback_max_retries`. Same transaction as the completion; the
 * unique `retry:<root>:<attempt>` key makes a re-delivery, replay or out-of-order call a no-op.
 * V-AC B1: only for a known miss (`knownMiss`); a connected, unclassified call waits for its classification.
 */
async function createPromiseRetry(record: Awaited<ReturnType<typeof recordForUpdate>>, completed: InstanceType<ReturnType<typeof getOutreachFollowupModel>>,
  call: InteractionRow, policy: CsiPolicy, context: CsiTransactionContext) {
  if (!isPromisedCallback(completed) || !knownMiss(completed.disposition, call)) return null;
  const tuning = csiPolicyEvolution(policy);
  const attempt = (completed.promise_chain?.attempt ?? 0) + 1;
  if (attempt > tuning.callback_max_retries) return null;
  const rootId = completed.promise_chain?.root_id ?? completed._id;
  const rootOrigin = (completed.promise_chain?.root_origin ?? completed.origin) as "rep_promise" | "customer_request" | "owner";
  const Followups = getOutreachFollowupModel(), commitment_key = promiseRetryKey(rootId, attempt);
  const existing = await Followups.findOne({ commitment_key }).session(context.session);
  if (existing) {
    // T4-VAC-A4 (R-S1): a retry superseded because its call was classified a conversation comes back, once,
    // when that call is re-classified as not a conversation (same key). Anything else: already handled.
    if (existing.status !== "superseded" || existing.cancel_reason !== REACHED_ON_CLASSIFICATION) return null;
    const before = existing.toObject();
    existing.status = "open"; existing.cancel_reason = null;
    await saveFollowup(existing, before, context, subjectKey(record.subject), "promise_retry_reopened");
    await advanceRetryThroughLaterCalls(record, existing, call, policy, context);
    return String(existing._id);
  }
  const due = addStaffedMinutes(call.started_at, tuning.callback_retry_staffed_minutes, policy);
  const row = new Followups({ outreach_record_id: record._id, commitment_key, kind: "call", description: PROMISE_RETRY_DESCRIPTION, origin: "system_default",
    requested_by: completed.requested_by ?? null, due_at: due, base_attention_due_at: due, supersedes_id: completed._id,
    promise_chain: { root_id: rootId, root_origin: rootOrigin, attempt }, trigger_interaction_ids: [call._id],
    date_resolution: { precision: "exact", timezone: policy.timezone, assumption: "Staffed retry after an unreached promised callback", anchor: call.started_at, policy_version: policy.version },
    responsible_agent_id: completed.responsible_agent_id ?? null, promised_by_agent_id: completed.promised_by_agent_id ?? null,
    assignment: completed.responsible_agent_id ? { origin: "inherited_outreach", assigned_at: call.started_at, evidence_id: call._id } : null });
  await saveFollowup(row, null, context, subjectKey(record.subject), "promise_retry_created");
  await advanceRetryThroughLaterCalls(record, row, call, policy, context);
  return String(row._id);
}
/** Bound of the later-call scan when a retry is created or reopened (T4-VAC-A4). */
export const RETRY_LATER_CALL_SCAN = 50;
/**
 * T4-VAC-A4 (R-N2): a retry is "try the customer again after the call that did not reach them"; it stays
 * anchored at that call (due +retry minutes after it), so it is genuinely overdue when nobody has tried again.
 * When it is created late (the call was classified later, or arrived out of order), attributable calls that
 * already happened after that call are applied to it at once: the first outbound attempt (any time after the
 * call; the rep could not see a due time that did not exist yet) or inbound human conversation completes it
 * with that call's outcome, and a known miss creates the next link the same way (bounded by
 * `callback_max_retries`). An unclassified connected call completes it without a successor, as in B1.
 */
async function advanceRetryThroughLaterCalls(record: Awaited<ReturnType<typeof recordForUpdate>>, retry: InstanceType<ReturnType<typeof getOutreachFollowupModel>>,
  after: InteractionRow, policy: CsiPolicy, context: CsiTransactionContext) {
  const later = await getCallInteractionModel().find({ contact_number_id: after.contact_number_id, merged_into_id: null, direction: { $in: ["Inbound", "Outbound"] },
    started_at: { $gt: after.started_at } }).sort({ started_at: 1, _id: 1 }).limit(RETRY_LATER_CALL_SCAN).session(context.session).lean();
  for (const next of later) {
    const facts = callFacts(record, next, await interactionAttribution(next, context.session), await mappedSalesReps(next, context.session));
    const inboundHuman = facts.human && next.direction === "Inbound";
    if (!facts.outboundAttempt && !inboundHuman) continue;
    const before = retry.toObject();
    retry.status = "completed"; retry.disposition = inboundHuman ? "customer_called" : facts.outcome;
    retry.completion_basis = "call_attempt"; retry.completed_at = next.started_at; retry.evidence_interaction_id = next._id; retry.snoozed_until = null;
    await saveFollowup(retry, before, context, subjectKey(record.subject), "call_fulfilled_action");
    await createPromiseRetry(record, retry, next, policy, context);
    return;
  }
}
/** The completion outcome a call has when it is not a human conversation (as `callFacts` computes it). */
const missOutcome = (call: Pick<InteractionRow, "contact_type" | "provider_connected">) =>
  call.contact_type === "voicemail" ? "left_voicemail" as const : call.provider_connected ? "connected_contact_unknown" as const : "no_answer" as const;
export const REACHED_ON_CLASSIFICATION = "reached_on_classification";
/**
 * V-AC B1: the same call projected again after it was classified (new projection revision: the
 * `set_contact_type` effect or an Owner correction). A promised callback that call completed is
 * re-marked `spoke_with_customer` when the call is now a human conversation, and every open retry in
 * its chain is superseded (`reached_on_classification`); when it is classified as not a conversation,
 * the deferred retry is created now. Idempotent: the re-mark is a no-op once done; the retry is keyed.
 */
async function reconcileClassifiedCall(record: Awaited<ReturnType<typeof recordForUpdate>>, call: InteractionRow, policy: CsiPolicy, context: CsiTransactionContext, recordKey: string) {
  const human = call.contact_type === "human_conversation";
  if (!human && !contactClassified(call)) return;
  const Followups = getOutreachFollowupModel();
  const settled = await Followups.find({ outreach_record_id: record._id, status: "completed", evidence_interaction_id: call._id, kind: "call", missed_episode_key: null })
    .sort({ _id: 1 }).session(context.session);
  for (const action of settled.filter(isPromisedCallback)) {
    if (!human) {
      // T4-VAC-A4 (R-S1): a completion first marked reached, then re-classified not a conversation, is a miss again.
      if (action.disposition === "spoke_with_customer" && action.completion_basis === "call_attempt") {
        const before = action.toObject();
        action.disposition = missOutcome(call);
        await saveFollowup(action, before, context, recordKey, "promise_unreached_on_classification");
      }
      await createPromiseRetry(record, action, call, policy, context);
      continue;
    }
    if (["spoke_with_customer", "customer_called", "completed"].includes(action.disposition ?? "")) continue;
    const before = action.toObject();
    action.disposition = "spoke_with_customer";
    await saveFollowup(action, before, context, recordKey, "promise_reached_on_classification");
    const rootId = action.promise_chain?.root_id ?? action._id;
    for (const retry of await Followups.find({ outreach_record_id: record._id, status: "open", "promise_chain.root_id": rootId }).sort({ _id: 1 }).session(context.session)) {
      const prior = retry.toObject();
      retry.status = "superseded"; retry.cancel_reason = REACHED_ON_CLASSIFICATION; retry.snoozed_until = null;
      await saveFollowup(retry, prior, context, recordKey, "followup_superseded_by_plan");
    }
  }
}
/** §6: the completion policy handed to `fulfilledByCall` with the flag on. */
export const completionPolicy = (policy: CsiPolicy): CompletionPolicy =>
  ({ timezone: policy.timezone, staffed_hours: policy.staffed_hours, callback_early_window_staffed_minutes: csiPolicyEvolution(policy).callback_early_window_staffed_minutes });
export async function ensureInteraction(call: InteractionRow, context: CsiTransactionContext) {
  if ("purged_at" in call && call.purged_at) return null;
  if (call.sources.includes("backfill") && (!await historicalCaptureReady(call.started_at, context.session) ||
    !await historicalAttachmentsReady(String(call.contact_number_id), context.session))) return null;
  if (!call.contact_number_id || call.direction === "Internal" || call.monitoring) return null;
  const numberId = String(call.contact_number_id), key = `number:${numberId}`;
  const number = await getContactNumberModel().findById(numberId).session(context.session).lean();
  if (!number || number.kind !== "external" || ["company", "non_customer"].includes(number.classification)) return null;
  const attribution = await interactionAttribution(call, context.session);
  const policy = await resolvePolicy();
  const missed = call.direction === "Inbound" && call.terminal && !call.provider_connected && call.contact_type !== "human_conversation";
  let record = attribution.lead_ref ? await ensureLead(attribution.lead_ref, context, numberId) : null;
  if (!attribution.lead_effects_allowed && attribution.blocked_reason !== "unlinked") {
    await openReview(context, key, "identity", numberId, [String(call._id)]);
    for (const ref of attribution.applicable_leads) {
      const blocked = await ensureLead(ref, context, numberId);
      if (blocked && !["closed", "identity_review"].includes(blocked.state)) {
        const prior = blocked.toObject(); blocked.state_before_identity_review = blocked.state; blocked.state = "identity_review";
        await refreshRecord(blocked, context, "identity_blocked", prior);
      }
    }
    return null;
  }
  if (!record && attribution.blocked_reason === "unlinked") {
    // Related official closure must not be escaped via a Number Review, including outside matching windows.
    const related = await getNumberLeadAttachmentModel().find({ contact_number_id: numberId, state: { $ne: "rejected" } }).session(context.session).lean();
    for (const edge of related) {
      const edgeRef = { model: edge.lead_ref.model, id: String(edge.lead_ref.id) };
      const lead = await loadLead(edgeRef, context.session);
      const closed = await getOutreachRecordModel().findOne({ "subject.model": edge.lead_ref.model, "subject.id": edge.lead_ref.id, state: "closed" }).session(context.session).lean();
      if (closed || (lead && await authoritativeClosure(lead, edgeRef, context.session))) {
        if (missed && (!closed?.closed_at || call.started_at > closed.closed_at))
          await openReview(context, closed ? subjectKey(closed.subject) : key, "closed_work_request", String(call._id), [String(call._id)]);
        return null;
      }
    }
    record = await getOutreachRecordModel().findOne({ "subject.kind": "number_review", "subject.contact_number_id": numberId }).session(context.session);
    if (!record && missed && call.inbound_route_id && number.contact_eligibility.state !== "suppressed") {
      record = new (getOutreachRecordModel())({ subject: { kind: "number_review", contact_number_id: numberId }, primary_contact_number_id: numberId,
        trigger_kind: "unanswered_inbound", trigger_at: call.started_at, policy_version: policy.version });
      await refreshRecord(record, context, "number_review_opened", null);
      // Primary and subject are the same Number: one record, counted once.
      await countOutreachRecordOnNumber(numberId, context.session);
    }
  }
  if (!record) return null;
  const recordKey = subjectKey(record.subject);
  const repIdentity = await interactionRepIdentity(call, context.session);
  const previousCall = await getSalesIntelligenceAuditEventModel().exists({ subject_key: recordKey, event_kind: "outreach_call_applied",
    "current.interaction_id": String(call._id), "current.projection_revision": call.projection_revision }).session(context.session);
  const seen = await getSalesIntelligenceAuditEventModel().exists({ subject_key: recordKey, event_kind: "outreach_call_applied",
    "current.interaction_id": String(call._id), "current.projection_revision": call.projection_revision,
    "current.rep_identity_fingerprint": repIdentity.fingerprint }).session(context.session);
  if (record.state === "closed") {
    if (missed && (!record.closed_at || call.started_at > record.closed_at)) await openReview(context, recordKey, "closed_work_request", String(call._id), [String(call._id)]);
    return record;
  }
  if (record.state === "identity_review" && attribution.lead_effects_allowed) {
    const before = record.toObject();
    restoreFromIdentityReview(record);
    await refreshRecord(record, context, "identity_resolved", before);
  }
  if (seen) return record;
  const evolution = attentionEvolutionEnabled();
  const prior = record.toObject(), reps = repIdentity.agent_ids;
  // §5.4: a record whose contact facts were never computed gets them before this call applies (bounded, once).
  if (evolution && contactFactsMissing(record)) record.set(await computeContactFacts(record, context.session));
  const facts = callFacts(record, call, attribution, reps);
  if (!facts.identityAllowed) return record;
  // The Owner should not have to remember to press stop. The covering window is the interaction's
  // own span widened backwards by that same duration for the dialling gap, so no clock constant
  // is invented outside policy; a call with no end time yet stamps on a later projection.
  const progress = record.call_progress;
  if (progress?.state === "in_progress" && facts.attributable) {
    const ended = call.ended_at ?? call.started_at;
    if (+progress.started_at >= +call.started_at - (+ended - +call.started_at) && +progress.started_at <= +ended) {
      progress.state = "ended"; progress.ended_at = ended; progress.ended_by = "system"; progress.interaction_id = call._id;
    }
  }
  if (facts.outboundAttempt || facts.human) {
    if (record.state === "unworked") record.state = "open";
    if (facts.outboundAttempt && (!record.first_attributable_outbound_at || record.first_attributable_outbound_at > call.started_at)) record.first_attributable_outbound_at = call.started_at;
    // §5.4: the newest attributable attempt and inbound human conversation, maintained per call.
    if (evolution && facts.outboundAttempt) record.last_attributable_outbound_at = latestOf(record.last_attributable_outbound_at, call.started_at);
    if (evolution && facts.human && call.direction === "Inbound") record.last_inbound_human_at = latestOf(record.last_inbound_human_at, call.started_at);
    if (facts.human) {
      if (!record.first_human_conversation_at || record.first_human_conversation_at > call.started_at) record.first_human_conversation_at = call.started_at;
      if (!record.last_meaningful_contact_at || record.last_meaningful_contact_at < call.started_at) record.last_meaningful_contact_at = call.started_at;
      // §7.2: with the flag the one precedence decides (a conversation replaces `first_attempts`, never the Owner).
      const assignable = evolution ? mayReplaceAssignment(record, "first_conversation") : !record.responsible_agent_id && record.assignment?.origin !== "owner";
      if (assignable && reps.length === 1) {
        record.responsible_agent_id = new mongoose.Types.ObjectId(reps[0]); record.assignment = { origin: "first_conversation", assigned_at: call.started_at, evidence_id: call._id };
      }
    }
    // §7.2 P7: repeated attempts by one reviewed rep, weakest automatic origin, only when nobody is assigned.
    if (evolution && facts.outboundAttempt && !record.responsible_agent_id && !record.assignment?.origin) {
      const agent = await firstAttemptsAgent(record as unknown as RecordRow, call.contact_number_id, csiPolicyEvolution(policy).first_attempts_threshold, context.session);
      if (agent) { record.responsible_agent_id = new mongoose.Types.ObjectId(agent); record.assignment = { origin: "first_attempts", assigned_at: call.started_at, evidence_id: call._id }; }
    }
  }
  if (call.contact_type_basis === "owner" || previousCall) {
    const calls = await getCallInteractionModel().find({ contact_number_id: call.contact_number_id, merged_into_id: null, started_at: { $gte: record.trigger_at }, contact_type: "human_conversation" }).sort({ started_at: 1 }).session(context.session).lean();
    const humanDates: Date[] = [];
    for (const candidate of calls) if (callFacts(record, candidate, await interactionAttribution(candidate, context.session), await mappedSalesReps(candidate, context.session)).human) humanDates.push(candidate.started_at);
    record.first_human_conversation_at = humanDates[0] ?? null; record.last_meaningful_contact_at = humanDates.at(-1) ?? null;
    // §5.4: the correction/replay recompute covers the four contact facts too.
    if (evolution) record.set(await computeContactFacts(record, context.session));
    // H1a: a call correction or replay never undoes work established by accepted Lead progress.
    if (!humanDates.length && !record.first_attributable_outbound_at && record.state === "open" && !record.lead_progress?.work_observed &&
      !await getSalesIntelligenceOwnerInstructionModel().exists({ subject_key: recordKey, field: "status", followup_id: null }).session(context.session)) record.state = "unworked";
  }
  // §7.3: last activity follows the contact facts written above.
  if (evolution) record.last_activity_at = latestOf(record.last_activity_at, record.last_meaningful_contact_at, record.last_attributable_outbound_at);
  const actions = await getOutreachFollowupModel().find({ outreach_record_id: record._id, status: "open" }).session(context.session);
  let waitOwner: mongoose.Types.ObjectId | null = null;
  // §6 (flag on): early window, customer called, single target, retry successors. Off: exactly today's rules.
  const evolved = evolution ? completionPolicy(policy) : undefined;
  const fulfilled = (action: (typeof actions)[number]) => fulfilledByCall(action, call, facts, evolved);
  const waits = actions.filter(a => a.kind === "wait" && fulfilled(a));
  const callbacks = actions.filter(a => a.kind === "call" && !a.missed_episode_key && fulfilled(a));
  const target = evolved && callbacks.length > 1 ? pickCallbackTarget(callbacks, call, evolved) : null;
  for (const action of actions) {
    if (!fulfilled(action) || (action.kind === "wait" && waits.length !== 1)) continue;
    if (action.kind === "call" && !action.missed_episode_key && callbacks.length !== 1 && action !== target) continue;
    const before = action.toObject();
    if (action.kind === "wait") waitOwner = action.responsible_agent_id ?? null;
    action.status = "completed";
    action.disposition = action.kind === "wait" || (evolved && customerCalledBack(action, call, facts)) ? "customer_called" : facts.outcome;
    action.completion_basis = "call_attempt"; action.completed_at = call.started_at; action.evidence_interaction_id = call._id; action.snoozed_until = null;
    await saveFollowup(action, before, context, recordKey, "call_fulfilled_action");
    if (evolved) await createPromiseRetry(record, action, call, policy, context);
  }
  // V-AC B1: a re-projection of a call that already completed a promised callback (its classification).
  if (evolved && facts.attributable) await reconcileClassifiedCall(record, call, policy, context, recordKey);
  if (waits.length > 1) await openReview(context, recordKey, "completion_target", `wait:${call._id}`, [String(call._id)]);
  if (callbacks.length > 1 && !target) await openReview(context, recordKey, "completion_target", `callback:${call._id}`, [String(call._id)]);
  // Identity-only replay can fulfill still-open work, but cannot recreate an already applied missed-call episode.
  if (missed && call.inbound_route_id && !previousCall) {
    const episodeKey = numberId;
    let episode = actions.find(a => a.status === "open" && a.missed_episode_key === episodeKey);
    const before = episode?.toObject() ?? null;
    if (!episode) episode = new (getOutreachFollowupModel())({ outreach_record_id: record._id, commitment_key: `missed:${record._id}:${call._id}`,
      kind: "call", description: "Return missed customer call", origin: "system_default", requested_by: "customer", missed_episode_key: episodeKey,
      first_missed_at: call.started_at, due_at: addStaffedMinutes(call.started_at, policy.missed_callback_due_staffed_minutes, policy),
      date_resolution: { precision: "exact", timezone: policy.timezone, assumption: "Staffed missed-call deadline", anchor: call.started_at, policy_version: policy.version },
      responsible_agent_id: waitOwner ?? record.responsible_agent_id,
      assignment: { origin: "inherited_outreach", assigned_at: context.now, evidence_id: call._id } });
    else if (episode.first_missed_at && episode.first_missed_at > call.started_at) {
      // Out-of-order earlier miss moves the episode earlier, never later; preserve Owner date correction.
      episode.first_missed_at = call.started_at;
      if (!episode.owner_instruction_ids.length) episode.due_at = addStaffedMinutes(call.started_at, policy.missed_callback_due_staffed_minutes, policy);
    }
    if (!episode.trigger_interaction_ids.some(id => String(id) === String(call._id))) episode.trigger_interaction_ids.push(call._id);
    if (!episode.base_attention_due_at || (episode.due_at && episode.due_at < episode.base_attention_due_at)) episode.base_attention_due_at = episode.due_at;
    await saveFollowup(episode, before, context, recordKey, "missed_call_episode");
    // An older miss arriving after its callback must not resurrect already fulfilled work.
    const later = await getCallInteractionModel().find({ contact_number_id: call.contact_number_id, merged_into_id: null, started_at: { $gt: call.started_at }, terminal: true }).sort({ started_at: 1 }).session(context.session).lean();
    for (const next of later) {
      const nextFacts = callFacts(record, next, await interactionAttribution(next, context.session), await mappedSalesReps(next, context.session));
      if (!fulfilledByCall(episode, next, nextFacts)) continue;
      const old = episode.toObject(); episode.status = "completed"; episode.disposition = nextFacts.outcome;
      episode.completed_at = next.started_at; episode.completion_basis = "call_attempt"; episode.evidence_interaction_id = next._id;
      await saveFollowup(episode, old, context, recordKey, "historical_missed_fulfilled"); break;
    }
  }
  await refreshRecord(record, context, "outreach_interaction", prior);
  await appendCsiAudit(context, { kind: "interaction", subject_key: recordKey, target_id: String(call._id), revision: call.projection_revision,
    happened_at: call.started_at,
    event_kind: "outreach_call_applied", prior: {}, current: { interaction_id: String(call._id), projection_revision: call.projection_revision,
      rep_identity_fingerprint: repIdentity.fingerprint, happened_at: call.started_at.toISOString(), ...facts } });
  return record;
}
/**
 * The deciding attachment edge as the Outreach Record displays it.
 *
 * A bounded display mirror (02 §17): the append-only audit rows remain the full history, and
 * this only exists so provenance is readable without re-resolving identity on every GET.
 * Ambiguous or competing identity is recorded as Ambiguous rather than silently picking a lead.
 */
function leadAttachmentMirror(edge: StoredAttachment, ambiguous: boolean, observedAt: Date) {
  const state = ambiguous && edge.state !== "rejected" ? "ambiguous" as const : edge.state;
  return { attachment_id: edge._id, lead_ref: { model: edge.lead_ref.model, id: edge.lead_ref.id }, state,
    certainty: state === "ambiguous" && !edge.decided_at ? "unsure" as const : edge.certainty,
    decided_by: edge.decided_at ? "owner" as const : edge.auto_decision ? "automatic" as const : "evidence" as const,
    decided_at: edge.decided_at ?? edge.auto_decision?.decided_at ?? null,
    confidence: edge.auto_decision?.confidence ?? null, observed_at: observedAt };
}
/** Mirror equality excluding the observation time, so an unchanged edge writes no audit row. */
const mirrorIdentity = (mirror: unknown) => payloadHash({ ...(jsonValue(mirror) as Record<string, unknown>), observed_at: null });
/** Same-transaction reaction to CSI-05. Recheck official closure BEFORE identity state restoration. */
export async function reactToAttachmentChanged(change: { number_id: string; revision: number }, session: ClientSession) {
  if (!csiFlag("OUTREACH_ENSURE")) return;
  const context = workerContext(session, `attachment:${change.number_id}:${change.revision}`);
  const edges = await getNumberLeadAttachmentModel().find({ contact_number_id: change.number_id }).session(session).lean();
  const latest = await getCallInteractionModel().findOne({ contact_number_id: change.number_id, merged_into_id: null }).sort({ started_at: -1, _id: -1 }).session(session).lean();
  if (latest?.sources.includes("backfill") && (!await historicalCaptureReady(latest.started_at, session) ||
    !await historicalAttachmentsReady(change.number_id, session))) return;
  for (const edge of edges) {
    const record = await ensureLead({ model: edge.lead_ref.model, id: String(edge.lead_ref.id) }, context, change.number_id);
    if (!record || record.state === "closed") continue;
    const identity = latest ? { ...latest, id: String(latest._id) } : { id: "", provider_account_id: "", call_log_ids: [], started_at: record.trigger_at };
    const attribution = resolveAtInteraction(edges.map(attachmentPolicyInput), identity);
    const blocked = ["ambiguous_attachment", "competing_attached"].includes(attribution.blocked_reason ?? "");
    // Provenance mirror. The edge is re-read live in this transaction, so the stored Contact
    // Number revision only fences an out-of-order older change from clobbering a newer mirror.
    const mirror = leadAttachmentMirror(edge, blocked, context.now);
    if (String(record.primary_contact_number_id ?? change.number_id) === change.number_id &&
      (record.lead_attachment_revision ?? 0) <= change.revision && mirrorIdentity(record.lead_attachment) !== mirrorIdentity(mirror)) {
      const before = record.toObject();
      record.lead_attachment = mirror;
      record.lead_attachment_revision = Math.max(record.lead_attachment_revision ?? 0, change.revision);
      await refreshRecord(record, context, "outreach_lead_attachment_mirrored", before);
    }
    const prior = record.toObject();
    if (blocked && record.state !== "identity_review") { record.state_before_identity_review = record.state; record.state = "identity_review"; }
    else if (!blocked && record.state === "identity_review") restoreFromIdentityReview(record);
    if (prior.state !== record.state) await refreshRecord(record, context, "attachment_identity_changed", prior);
  }
  if (latest) await ensureInteraction(latest, context);
}
