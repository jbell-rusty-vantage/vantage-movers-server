import mongoose, { type ClientSession } from "mongoose";
import { z } from "zod";
import type { CSI_ACTION_KINDS } from "../../../config/domain/salesIntelligence";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getMoveAssessmentArtifactModel } from "../../../models/MoveAssessmentArtifact";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { toObjectId } from "../../../utils/objectId";
import { resolvePolicy } from "../policy";
import { openReview } from "../review/items";
import { workerContext } from "../outreach/ensure";
import { resolveActionDate, resolveActionDateText } from "../outreach/staffing";
import { jsonValue, recordForUpdate, refreshRecord, saveFollowup, supersedeDefaults } from "../outreach/store";
import { attentionEvolutionEnabled, subjectKey } from "../outreach/types";
import { engagementSchema, evidenceRefSchema, nextStepSchema, promisedCallbackSchema, type EvidenceRef } from "./contract";

/**
 * Deterministic Outreach effects of an accepted assessment's `engagement` block.
 *
 * The model only reports what the conversations say (promised callbacks, agreed next
 * steps, whether a rep actually worked the customer). This module decides, with fixed
 * rules and no model call, which of those become open Outreach follow-ups and whether an
 * unworked record is now being worked. The Attention band then follows from `derive()`
 * exactly as it does for Owner-created actions: an overdue promised callback is band 1,
 * a due follow-up band 4, an open record with no action band 5, and a record with a
 * future-dated action leaves band 5.
 *
 * Rules (all pure, in `planEngagementEffects`):
 * - Closed / identity-review records and records under an active Owner status or closure
 *   instruction are never touched.
 * - Only commitments made on the latest selected conversation apply; anything from an
 *   earlier call was superseded by that later contact.
 * - A rep's promised callback is dropped when an attributable outbound attempt happened
 *   after that call (the promise was acted on, whatever its outcome).
 * - One open action per kind: an existing open follow-up of the same kind wins.
 * - Every follow-up created here carries `commitment_key = assessment:<artifact>:<source>:<n>`,
 *   so republishing the same artifact is idempotent.
 */
export type ActionKind = (typeof CSI_ACTION_KINDS)[number];
const ACTION_KIND_FOR_STEP: Record<string, ActionKind> = {
  call: "call", text_customer: "text_customer_via_lead_message", send_estimate: "send_estimate", check_availability: "check_availability",
  review: "review", wait: "wait", other: "other",
};

const citedPromisedCallback = promisedCallbackSchema.extend({ evidence: z.array(evidenceRefSchema) });
const citedNextStep = nextStepSchema.extend({ evidence: z.array(evidenceRefSchema) });
export const acceptedEngagementSchema = engagementSchema.extend({
  evidence: z.array(evidenceRefSchema),
  promised_callbacks: z.array(citedPromisedCallback),
  next_steps: z.array(citedNextStep),
});
export type StoredEngagement = z.infer<typeof acceptedEngagementSchema>;

export type PlannedFollowup = {
  commitment_key: string; source: "promised_callback" | "next_step"; index: number;
  kind: ActionKind; origin: "rep_promise" | "customer_wait"; requested_by: "rep" | "customer";
  description: string; date: string | null; date_text: string | null;
  /** ISO time of the call that made the commitment; dates resolve from here, not from now. */
  anchor: string;
  evidence: EvidenceRef[];
};
export type SkippedItem = { source: "promised_callback" | "next_step"; index: number; reason: string };
export type EngagementPlan = { mark_worked: boolean; followups: PlannedFollowup[]; skipped: SkippedItem[]; blocked: string | null };

export type EngagementPlanInput = {
  artifact_id: string;
  engagement: StoredEngagement;
  latest_conversation_at: string | null;
  record: { state: string };
  open_actions: ReadonlyArray<{ kind: string }>;
  /** Commitment keys already created for this artifact (idempotent republish). */
  existing_keys: ReadonlySet<string>;
  /** An attributable outbound attempt after the latest conversation. */
  later_outbound_attempt: boolean;
  /** An active Owner instruction on status or closure. */
  owner_protected: boolean;
};

const latestOf = (item: { evidence: EvidenceRef[] }, latest: string | null) =>
  latest !== null && item.evidence.some(ref => ref.call_at === latest);

/** Pure. Same input, same plan. */
export function planEngagementEffects(input: EngagementPlanInput): EngagementPlan {
  const { engagement, record } = input;
  const skipped: SkippedItem[] = [], followups: PlannedFollowup[] = [];
  const blocked = ["closed", "identity_review"].includes(record.state) ? `record_${record.state}` : input.owner_protected ? "owner_instruction" : null;
  const kinds = new Set(input.open_actions.map(a => a.kind));
  const consider = (source: PlannedFollowup["source"], index: number, item: { evidence: EvidenceRef[] }, build: () => Omit<PlannedFollowup, "commitment_key" | "source" | "index" | "anchor" | "evidence"> | string) => {
    if (blocked) { skipped.push({ source, index, reason: blocked }); return; }
    if (!latestOf(item, input.latest_conversation_at)) { skipped.push({ source, index, reason: "superseded_by_later_call" }); return; }
    const built = build();
    if (typeof built === "string") { skipped.push({ source, index, reason: built }); return; }
    const commitment_key = `assessment:${input.artifact_id}:${source}:${index}`;
    if (input.existing_keys.has(commitment_key)) { skipped.push({ source, index, reason: "already_created" }); return; }
    if (kinds.has(built.kind)) { skipped.push({ source, index, reason: "open_action_exists" }); return; }
    kinds.add(built.kind);
    followups.push({ ...built, commitment_key, source, index, anchor: input.latest_conversation_at!, evidence: item.evidence });
  };
  engagement.promised_callbacks.forEach((item, index) => consider("promised_callback", index, item, () => {
    if (item.status !== "pending") return `status_${item.status}`;
    if (item.by === "unknown") return "party_unknown";
    if (item.by === "rep" && input.later_outbound_attempt) return "fulfilled_by_later_attempt";
    const rep = item.by === "rep";
    return { kind: rep ? "call" : "wait", origin: rep ? "rep_promise" : "customer_wait", requested_by: rep ? "rep" : "customer",
      description: rep ? `Promised callback: ${item.raw_text}` : `Customer will call back: ${item.raw_text}`,
      date: item.date, date_text: item.time_text ?? null };
  }));
  engagement.next_steps.forEach((item, index) => consider("next_step", index, item, () => {
    if (item.status !== "planned") return `status_${item.status}`;
    if (item.owner === "unknown") return "owner_unknown";
    const customer = item.owner === "customer" || item.action === "wait";
    const kind = customer ? "wait" : ACTION_KIND_FOR_STEP[item.action] ?? "other";
    if (kind === "call" && input.later_outbound_attempt) return "fulfilled_by_later_attempt";
    return { kind, origin: customer ? "customer_wait" : "rep_promise", requested_by: customer ? "customer" : "rep",
      description: customer ? `Waiting on customer: ${item.description}` : item.description, date: item.date, date_text: item.date_text };
  }));
  const mark_worked = !blocked && record.state === "unworked" && engagement.work_status.startsWith("worked");
  return { mark_worked, followups, skipped, blocked };
}

export type EngagementEffectResult = EngagementPlan & { applied: boolean; followup_ids: string[]; reason?: string };

/**
 * Applies the plan inside the publishing transaction. Reads live record/action state
 * under the session, creates follow-ups through the shared store (audited), marks an
 * unworked record open, refreshes the record's next action/state and writes the effect
 * ledger to the artifact (`engagement_effects`, mutable after generation).
 */
export async function applyAssessmentEngagement(artifact: { _id: unknown; job_id?: unknown; engagement?: unknown; latest_conversation_at?: Date | null; contact_number_id?: unknown },
  outreachRecordId: string, session: ClientSession, now = new Date()): Promise<EngagementEffectResult> {
  const parsed = acceptedEngagementSchema.safeParse(artifact.engagement);
  const artifactId = String(artifact._id);
  const Artifacts = getMoveAssessmentArtifactModel();
  const empty = (reason: string): EngagementEffectResult => ({ mark_worked: false, followups: [], skipped: [], blocked: reason, applied: false, followup_ids: [], reason });
  if (!parsed.success) return empty("engagement_unavailable");
  const context = workerContext(session, String(artifact.job_id ?? artifact._id), now);
  const record = await recordForUpdate(outreachRecordId, context);
  const key = subjectKey(record.subject);
  const Followups = getOutreachFollowupModel();
  const [open, existing, ownerProtected, laterAttempt] = await Promise.all([
    Followups.find({ outreach_record_id: record._id, status: "open" }).select("kind default_kind promise_chain").session(session).lean(),
    Followups.find({ outreach_record_id: record._id, commitment_key: { $regex: `^assessment:${artifactId}:` } }).select("commitment_key").session(session).lean(),
    getSalesIntelligenceOwnerInstructionModel().exists({ subject_key: key, state: "active", field: { $in: ["status", "closure"] } }).session(session),
    artifact.latest_conversation_at && artifact.contact_number_id
      ? getCallInteractionModel().exists({ contact_number_id: toObjectId(String(artifact.contact_number_id)), started_at: { $gt: artifact.latest_conversation_at },
        direction: "Outbound", terminal: true, monitoring: false }).session(session)
      : Promise.resolve(null),
  ]);
  const plan = planEngagementEffects({ artifact_id: artifactId, engagement: parsed.data,
    latest_conversation_at: artifact.latest_conversation_at ? artifact.latest_conversation_at.toISOString() : null, record: { state: record.state },
    // Team 4 §7.1 / §6 rule 5: server placeholders (the default next step, promise retries) never block a specific plan; it supersedes them.
    open_actions: open.filter(a => !(attentionEvolutionEnabled() && (a.default_kind || a.promise_chain))), existing_keys: new Set(existing.map(row => row.commitment_key)), later_outbound_attempt: Boolean(laterAttempt), owner_protected: Boolean(ownerProtected) });
  const followup_ids: string[] = [];
  if (plan.followups.length || plan.mark_worked) {
    const prior = record.toObject();
    const policy = await resolvePolicy(session);
    for (const item of plan.followups) {
      const anchor = new Date(item.anchor), wait = item.kind === "wait";
      const resolved = item.date ? resolveActionDate({ day: item.date, wait }, policy, anchor) : resolveActionDateText(item.date_text, policy, anchor, wait);
      const row = new Followups({ outreach_record_id: record._id, commitment_key: item.commitment_key, kind: item.kind, description: item.description,
        ...resolved, source_due_at: resolved.due_at, date_text: item.date_text, origin: item.origin, requested_by: item.requested_by,
        responsible_agent_id: record.responsible_agent_id ?? null,
        assignment: record.responsible_agent_id ? { origin: "inherited_outreach", actor_id: context.actor.id, assigned_at: context.now } : null });
      await saveFollowup(row, null, context, key, "assessment_followup_created");
      followup_ids.push(String(row._id));
      // Team 4 §7.1 / §6 rule 5: an assessment next step supersedes the default next step (a call also open promise retries).
      await supersedeDefaults(record, context, row);
      if (!resolved.due_at) await openReview(context, key, "missing_date", String(row._id), []);
      if (!record.responsible_agent_id) await openReview(context, key, "missing_responsibility", String(row._id), []);
    }
    if (plan.mark_worked) record.state = "open";
    await refreshRecord(record, context, "move_assessment_engagement", prior, { artifact_id: artifactId, followup_ids, mark_worked: plan.mark_worked });
  }
  const result: EngagementEffectResult = { ...plan, applied: Boolean(plan.followups.length || plan.mark_worked), followup_ids };
  await Artifacts.updateOne({ _id: new mongoose.Types.ObjectId(artifactId) },
    { $set: { engagement_effects: jsonValue({ ...result, applied_at: now.toISOString() }) } }, { session });
  return result;
}
