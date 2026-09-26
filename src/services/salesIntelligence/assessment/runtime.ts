import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongoose";
import type { LanguageModel } from "ai" with { "resolution-mode": "import" };
import { withTransaction } from "../../../db";
import {
  CSI_EXTRACTION_MODELS, CSI_LIVE_JOB_PRIORITY, csiDataset, csiFlag, csiProviderConfiguration,
} from "../../../config/domain/salesIntelligence";
import { getMoveAssessmentArtifactModel } from "../../../models/MoveAssessmentArtifact";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { getSalesIntelligenceAttentionSnapshotModel } from "../../../models/SalesIntelligenceAttentionSnapshot";
import { lockAttentionArtifacts } from "../outreach/attentionArtifactStore";
import { isObjectIdString, toObjectId } from "../../../utils/objectId";
import { retryAfterMs } from "../../ringcentral/recordings";
import { CsiError } from "../auth";
import { claimCsiJob, checkpointCsiJob, completeCsiJob, enqueueCsiJob, failCsiJob, renewCsiJob, type JobLease } from "../jobs";
import { appendCsiAudit, duplicateKey, payloadHash } from "../transactions";
import { loadLead } from "../attachment/sources";
import { workerContext } from "../outreach/ensure";
import { authoritativeClosure } from "../outreach/transitions";
import { isTerminal, type LeadProgressRow } from "../outreach/leadProgress";
import { jsonValue } from "../outreach/store";
import { subjectKey } from "../outreach/types";
import { pricingSchema } from "../analysis/worker";
import { StructuredStepTimeout, StructuredYield, STRUCTURED_INVOCATION_MS, type StepPricing } from "../analysis/structuredGeneration";
import { assessmentStepContract, MOVE_ASSESSMENT_SCHEMA_VERSION, type AcceptedAssessment } from "./contract";
import { assembleAssessmentContext, type AssessmentContext, type AssessmentSkip } from "./context";
import { generateMoveAssessment, type AssessmentCredential, type AssessmentLedger } from "./generate";
import { applyAssessmentEngagement } from "./engagement";

/**
 * Move assessment runtime (MA-01 §4/§8, specification §7/§9). One subject-level model
 * call per input fingerprint; an unchanged fingerprint reuses the accepted artifact with
 * no model call. Publication is fenced against a fresh context and the Outreach Record's
 * current closure/disposition and never queues follow-up effects. Shadow never publishes.
 */
export const MOVE_ASSESSMENT_LEASE_MS = 660_000;
export const MOVE_ASSESSMENT_DRAIN_BUDGET_MS = 785_000;
const ACCEPTED = ["ready", "insufficient_evidence"] as const;
/** Canonical Lead paths whose change re-nominates an assessment (MA-01 §8 hook). */
export const MOVE_TRIGGER_PATHS = ["pickup_city", "pickup_zip", "pickup_state", "delivery_city", "destination_zip", "delivery_zip",
  "delivery_state", "move_date", "move_size", "granot_move_size", "cubic_feet", "current_move_provenance"] as const;
const MOVE_TRIGGER_SET = new Set<string>(MOVE_TRIGGER_PATHS);

export type MoveAssessmentDeps = {
  gateway_key?: string; credential?: AssessmentCredential; model?: LanguageModel; model_id?: string; pricing?: StepPricing;
  shadow?: boolean; allow_lead_only?: boolean; beforeProvider?: () => Promise<void>; onProviderCall?: () => void;
  now?: () => Date;
  /** Backfill/runner gate: runs with `MOVE_ASSESSMENT` off. `ENABLED` is still required. */
  force?: boolean;
  /** Absolute epoch ms for the invocation (the drain passes its own). */
  deadline?: number;
  /** Test seam for the budget ledger; production uses the monthly ledger. */
  ledger?: AssessmentLedger;
  onError?: (error: unknown) => void;
};
export type MoveAssessmentOutcome = {
  status: "completed" | "reused" | "skipped" | "shadow_completed" | "stale_input" | "paused" | "retry" | "not_claimable" | "disabled" | "lease_lost";
  reason?: string; artifact_id?: string;
};
/** `current_replan` (Team 4 §8.1): the projection is already this artifact, and a `progress:*` re-plan re-applies its engagement. */
export type PublicationOutcome = "published" | "fenced" | "stale_input" | "current" | "current_replan";
/** Team 4 §8.1: the progress re-plan trigger prefix (`nominateMoveAssessment({ trigger: "progress:<disposition_revision>" })`). */
export const PROGRESS_REPLAN_TRIGGER = "progress:";
/** The nomination trigger a job was queued with, read back from its dedupe key (`csi:move-assessment:<subject>:<trigger>`). */
export function assessmentJobTrigger(job: { dedupe_key?: string | null; subject_key: string }): string | null {
  const prefix = `csi:move-assessment:${job.subject_key}:`;
  return job.dedupe_key?.startsWith(prefix) ? job.dedupe_key.slice(prefix.length) : null;
}

export function moveAssessmentRuntimeConfiguration() {
  const provider = csiProviderConfiguration();
  const pricing = pricingSchema.safeParse({ version: process.env.SALES_INTELLIGENCE_ANALYSIS_PRICING_VERSION,
    input_cents_per_million: Number(process.env.SALES_INTELLIGENCE_ANALYSIS_INPUT_CENTS_PER_MILLION),
    output_cents_per_million: Number(process.env.SALES_INTELLIGENCE_ANALYSIS_OUTPUT_CENTS_PER_MILLION) });
  return { model_id: provider.extractionModel, pricing: pricing.success ? pricing.data : null,
    gateway_key: provider.gatewayKey, credential: "AI_GATEWAY_API_KEY" as const };
}

// ── Pure decisions (unit-tested) ────────────────────────────────────────────
/** Both dimensions unknown and nothing stated: the evidence cannot support an assessment. */
export function assessmentStatusFor(accepted: Pick<AcceptedAssessment, "scores" | "move_details" | "inventory">): "ready" | "insufficient_evidence" {
  return accepted.scores.move_likelihood.level === "unknown" && accepted.scores.transaction_intent.level === "unknown" &&
    !accepted.move_details.length && !accepted.inventory.items.length ? "insufficient_evidence" : "ready";
}

export function changeTriggersMoveAssessment(change: { entity: { model: string }; changed_paths: readonly string[] }): boolean {
  return (change.entity.model === "FormLead" || change.entity.model === "CallLead") &&
    change.changed_paths.some(path => MOVE_TRIGGER_SET.has(path) || MOVE_TRIGGER_SET.has(path.split(".")[0]!));
}

export function assessmentProviderFailure(error: unknown): { kind: "throttled" | "permission_denied" | "transient"; retryAfterMs: number } | null {
  const candidate = error as { statusCode?: number; status?: number; responseHeaders?: Record<string, string>; headers?: Record<string, string> } | null;
  const status = candidate?.statusCode ?? candidate?.status;
  if (status === 429) {
    const raw = candidate?.responseHeaders?.["retry-after"] ?? candidate?.headers?.["retry-after"];
    return { kind: "throttled", retryAfterMs: retryAfterMs(raw ?? null, new Date()) };
  }
  if (status === 401 || status === 403) return { kind: "permission_denied", retryAfterMs: 0 };
  if (typeof status === "number" && status >= 500) return { kind: "transient", retryAfterMs: 0 };
  return null;
}

type ArtifactRow = {
  _id: unknown; status: string; input_fingerprint: string; schema_version: string; scores?: unknown; context_as_of: Date;
  latest_conversation_at?: Date | null; generated_at?: Date | null; job_id?: unknown; subject_key: string; shadow: boolean;
  engagement?: unknown; contact_number_id?: unknown; conflicts?: unknown;
};
type Projection = { artifact_id: unknown; context_as_of?: Date | null; stale?: boolean; status?: string } | null | undefined;
type Scores = { move_likelihood?: { score?: number | null; confidence?: string | null }; transaction_intent?: { score?: number | null; confidence?: string | null } } | null;

/** Data spec §2.2: the fields the artifact's conflicts affect (`conflicts[].affects`), deduped, in first-seen order. */
export function conflictTargetsFor(conflicts: unknown): string[] {
  if (!Array.isArray(conflicts)) return [];
  const affects = conflicts.map(conflict => (conflict && typeof conflict === "object" ? (conflict as { affects?: unknown }).affects : null));
  return [...new Set(affects.filter((target): target is string => typeof target === "string" && target.length > 0))];
}

export function projectionFor(artifact: ArtifactRow, eligibilityRevision: number, now: Date) {
  const scores = (artifact.scores ?? null) as Scores;
  return {
    conflict_targets: conflictTargetsFor(artifact.conflicts),
    artifact_id: artifact._id, status: artifact.status as "ready" | "insufficient_evidence",
    transaction_intent: scores?.transaction_intent?.score ?? null, move_likelihood: scores?.move_likelihood?.score ?? null,
    transaction_intent_confidence: scores?.transaction_intent?.confidence ?? null, move_likelihood_confidence: scores?.move_likelihood?.confidence ?? null,
    context_as_of: artifact.context_as_of, latest_conversation_at: artifact.latest_conversation_at ?? null,
    input_fingerprint: artifact.input_fingerprint, schema_version: artifact.schema_version,
    stale: false, stale_reason: null, published_at: now, eligibility_revision: eligibilityRevision,
  };
}

/**
 * The publication fence. `fresh` is a context assembled inside the publishing transaction;
 * `closure` is the authoritative official closure of the Lead subject (null when none).
 */
export function publicationDecision(input: {
  artifact: Pick<ArtifactRow, "_id" | "input_fingerprint" | "context_as_of" | "status">;
  fresh: AssessmentContext | AssessmentSkip;
  record: { state: string; lead_progress?: Pick<LeadProgressRow, "disposition" | "provenance" | "override"> | null; move_assessment?: Projection } | null;
  closure: string | null;
  /** The job trigger; only `progress:*` changes the outcome (Team 4 §8.1). */
  trigger?: string | null;
}): PublicationOutcome {
  const { artifact, fresh, record, closure } = input;
  if (!(ACCEPTED as readonly string[]).includes(artifact.status)) return "fenced";
  if (!record || record.state === "closed" || closure) return "fenced";
  const progress = record.lead_progress;
  if (progress && isTerminal(progress.disposition) && progress.provenance === "accepted" && !progress.override) return "fenced";
  if ("skip" in fresh) return fresh.skip === "not_applicable" || fresh.skip === "ambiguous_subject" ? "fenced" : "stale_input";
  if (fresh.fingerprint !== artifact.input_fingerprint) return "stale_input";
  const current = record.move_assessment;
  if (current && String(current.artifact_id) === String(artifact._id) && !current.stale && current.status === artifact.status)
    // A progress re-plan may reuse the artifact (unchanged customer evidence) but must still re-apply its engagement to the current record.
    return input.trigger?.startsWith(PROGRESS_REPLAN_TRIGGER) ? "current_replan" : "current";
  // Never replace a projection built from newer context with an older artifact.
  if (current && current.status !== "purged" && String(current.artifact_id) !== String(artifact._id) && current.context_as_of &&
    +current.context_as_of > +artifact.context_as_of) return "fenced";
  return "published";
}

// ── Publication, staleness, retention ──────────────────────────────────────
/**
 * Compare-and-set the Outreach projection. Re-runs the context in this transaction so the
 * fingerprint is checked against current inputs, re-reads closure/disposition, and writes
 * only `move_assessment` + `revision` and one audit event. Never touches follow-ups.
 */
export async function publishAssessmentProjection(artifact: ArtifactRow & { outreach_record_id?: unknown },
  context: Pick<AssessmentContext, "outreach_record_id">, session: ClientSession, now = new Date(), trigger: string | null = null): Promise<PublicationOutcome> {
  if (artifact.shadow) return "fenced";
  const Records = getOutreachRecordModel();
  const fresh = await assembleAssessmentContext({ outreach_record_id: context.outreach_record_id, allow_lead_only: true, now }, session);
  const record = await Records.findById(context.outreach_record_id).session(session).lean();
  let closure: string | null = null;
  if (record?.subject.kind === "lead" && record.subject.model && record.subject.id) {
    const ref = { model: record.subject.model, id: String(record.subject.id) };
    const lead = await loadLead(ref, session);
    closure = lead ? await authoritativeClosure(lead, ref, session) : "lead_unavailable";
  }
  const decision = publicationDecision({ artifact, fresh, closure, trigger,
    record: record ? { state: record.state, lead_progress: record.lead_progress as LeadProgressRow | null, move_assessment: record.move_assessment } : null });
  if (decision === "current_replan") {
    // Team 4 §8.1: the projection stays; the engagement is re-planned against the current record (same transaction, idempotent keys).
    await applyAssessmentEngagement({ _id: artifact._id, job_id: artifact.job_id, engagement: artifact.engagement,
      latest_conversation_at: artifact.latest_conversation_at ?? null, contact_number_id: artifact.contact_number_id }, context.outreach_record_id, session, now);
    return decision;
  }
  if (decision !== "published" || !record) return decision;
  const projection = projectionFor(artifact, record.revision, now);
  const changed = await Records.updateOne({ _id: record._id, revision: record.revision,
    $or: [{ move_assessment: null }, { "move_assessment.published_at": { $lt: now } }] },
  { $set: { move_assessment: projection }, $inc: { revision: 1 } }, { session, runValidators: true });
  if (changed.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
  await getMoveAssessmentArtifactModel().updateOne({ _id: String(artifact._id) }, { $set: { published_at: now } }, { session });
  await appendCsiAudit(workerContext(session, String(artifact.job_id ?? artifact._id), now), { kind: "outreach",
    subject_key: subjectKey(record.subject), target_id: String(record._id), revision: record.revision + 1,
    event_kind: "move_assessment_published", prior: jsonValue(record.move_assessment ?? { value: null }), current: jsonValue(projection) });
  // Deterministic work-state effects (promised callbacks, next steps, marked worked) ride the same
  // transaction as the projection, so the Attention band and the score never disagree about inputs.
  await applyAssessmentEngagement({ _id: artifact._id, job_id: artifact.job_id, engagement: artifact.engagement,
    latest_conversation_at: artifact.latest_conversation_at ?? null, contact_number_id: artifact.contact_number_id }, context.outreach_record_id, session, now);
  return "published";
}

/** Marks the current projection stale without recomputing (e.g. a passed move-date window). */
export async function markAssessmentStale(recordId: string, reason: string, session: ClientSession) {
  const result = await getOutreachRecordModel().updateOne({ _id: recordId, move_assessment: { $ne: null }, "move_assessment.status": { $ne: "purged" } },
    { $set: { "move_assessment.stale": true, "move_assessment.stale_reason": reason } }, { session });
  return result.modifiedCount === 1;
}

/**
 * Retention: tombstone matching artifacts (content nulled, `model_output: {purged:true}`),
 * purge projections that point at them, and expire the dataset's current Attention
 * snapshots (including the non-expiring latest) so no frozen row keeps a purged score.
 */
export async function purgeMoveAssessments(filter: { contact_number_id?: string; conversation_id?: string; artifact_ids?: string[] }, at: Date, session: ClientSession) {
  const or: Array<Record<string, unknown>> = [];
  if (filter.contact_number_id) or.push({ contact_number_id: toObjectId(filter.contact_number_id) });
  if (filter.conversation_id) or.push({ "source_manifest.conversation_id": filter.conversation_id });
  if (filter.artifact_ids?.length) or.push({ _id: { $in: filter.artifact_ids.map(toObjectId) } });
  if (!or.length) throw new CsiError("INVALID_INPUT");
  const Artifacts = getMoveAssessmentArtifactModel();
  const ids = (await Artifacts.find({ ...csiDataset(), purged_at: null, $or: or }).select("_id").session(session).lean()).map(row => row._id);
  if (!ids.length) return { artifacts: 0, projections: 0 };
  // No-op retention must not invalidate an in-flight Attention publication.
  // Acquire the shared fence before any erasure write; transaction retries also
  // repeat the eligibility read if a publisher or another purge wins the lock.
  await lockAttentionArtifacts(session, undefined, true);
  const artifacts = await Artifacts.updateMany({ _id: { $in: ids } }, { $set: { status: "purged", purged_at: at, purge_reason: "retention",
    scores: null, views: null, inventory: null, conflicts: null, engagement: null, engagement_effects: null, coverage: null, model_output: { purged: true } }, $inc: { revision: 1 } }, { session });
  const projections = await getOutreachRecordModel().updateMany({ "move_assessment.artifact_id": { $in: ids } }, { $set: {
    "move_assessment.status": "purged", "move_assessment.transaction_intent": null, "move_assessment.move_likelihood": null,
    "move_assessment.transaction_intent_confidence": null, "move_assessment.move_likelihood_confidence": null,
  }, $inc: { revision: 1 } }, { session });
  // Invalidate old cursors too; every cache hit checks its header. Publication checks the erasure epoch.
  await getSalesIntelligenceAttentionSnapshotModel().collection.updateMany({ ...csiDataset() }, { $set: { expires_at: at, cursor_expires_at: at } }, { session });
  return { artifacts: artifacts.modifiedCount, projections: projections.modifiedCount };
}

// ── Nomination ─────────────────────────────────────────────────────────────
/**
 * Cheap and idempotent per trigger: the job computes the fingerprint at claim and reuses
 * an accepted artifact when nothing changed. The trigger lives in the dedupe key only
 * (job `input_refs` are ObjectIds).
 */
export async function nominateMoveAssessment(input: { outreach_record_id: string; trigger: string; priority?: number; force?: boolean }, session: ClientSession) {
  if (!input.force && !(csiFlag("ENABLED") && csiFlag("MOVE_ASSESSMENT"))) return null;
  if (!isObjectIdString(input.outreach_record_id) || !input.trigger.trim()) throw new CsiError("INVALID_INPUT");
  const record = await getOutreachRecordModel().findById(input.outreach_record_id).select("subject state revision").session(session).lean();
  if (!record || record.state === "closed") return null;
  const subject_key = subjectKey(record.subject), dedupe_key = `csi:move-assessment:${subject_key}:${input.trigger}`;
  const existing = await getSalesIntelligenceJobModel().findOne({ dedupe_key }).select("_id").session(session).lean();
  if (existing) return String(existing._id);
  const job = await enqueueCsiJob({ stage: "move_assessment", subject_key, dedupe_key, input_revision: record.revision,
    input_refs: [String(record._id)], priority: input.priority ?? CSI_LIVE_JOB_PRIORITY }, session);
  return String(job._id);
}

/** Every non-closed Outreach Record whose primary Contact Number is `numberId` (new/replaced summaries). */
export async function nominateMoveAssessmentForNumber(numberId: string, trigger: string, session: ClientSession) {
  if (!(csiFlag("ENABLED") && csiFlag("MOVE_ASSESSMENT"))) return [];
  if (!isObjectIdString(numberId)) throw new CsiError("INVALID_INPUT");
  const records = await getOutreachRecordModel().find({ primary_contact_number_id: toObjectId(numberId), state: { $ne: "closed" } })
    .select("_id").sort({ _id: 1 }).limit(50).session(session).lean();
  const ids: string[] = [];
  for (const record of records) {
    const id = await nominateMoveAssessment({ outreach_record_id: String(record._id), trigger }, session);
    if (id) ids.push(id);
  }
  return ids;
}

/** Outreach entity-change scan hook: a meaningful canonical move change nominates the Lead's record. */
export async function nominateMoveAssessmentForChange(change: { _id: unknown; entity: { model: string; id: string }; changed_paths: readonly string[] }, session: ClientSession) {
  if (!changeTriggersMoveAssessment(change) || !(csiFlag("ENABLED") && csiFlag("MOVE_ASSESSMENT")) || !isObjectIdString(String(change.entity.id))) return null;
  const record = await getOutreachRecordModel().findOne({ "subject.kind": "lead", "subject.model": change.entity.model as "FormLead" | "CallLead",
    "subject.id": toObjectId(String(change.entity.id)) }).select("_id").session(session).lean();
  return record ? nominateMoveAssessment({ outreach_record_id: String(record._id), trigger: `change:${change._id}` }, session) : null;
}

// ── Job ────────────────────────────────────────────────────────────────────
export async function runMoveAssessmentJob(jobId?: string, deps: MoveAssessmentDeps = {}): Promise<MoveAssessmentOutcome> {
  if (!csiFlag("ENABLED") || (!csiFlag("MOVE_ASSESSMENT") && !deps.force)) return { status: "disabled" };
  // The live path (flag-driven cron/queue, company key) never claims backfill-priority rows: those belong
  // to the assessment-only runner, which claims them by id with `force` on the personal key (§9).
  const job = await claimCsiJob(`csi-move-assessment:${randomUUID()}`, jobId, MOVE_ASSESSMENT_LEASE_MS, "move_assessment",
    deps.force ? undefined : CSI_LIVE_JOB_PRIORITY);
  if (!job) return { status: "not_claimable" };
  const lease: JobLease = { job_id: String(job._id), owner: job.lease_owner!, epoch: job.lease_epoch };
  const clock = deps.now ?? (() => new Date());
  const shadow = Boolean(deps.shadow), Artifacts = getMoveAssessmentArtifactModel();
  let artifactId: string | null = null;
  try {
    const recordId = String(job.input_refs[0] ?? "");
    if (!isObjectIdString(recordId)) throw new CsiError("INVALID_INPUT");
    const allow_lead_only = deps.allow_lead_only ?? csiFlag("MOVE_ASSESSMENT");
    const context = await assembleAssessmentContext({ outreach_record_id: recordId, allow_lead_only, now: clock() });
    if ("skip" in context) return await completeSkip(lease, context, shadow, deps);
    // AC2-ASSESS: the recorded contract follows the layout the context was assembled with (read once, at claim).
    const contract = assessmentStepContract(context.layout);
    const key = { ...csiDataset(), subject_key: context.subject_key, input_fingerprint: context.fingerprint,
      schema_version: MOVE_ASSESSMENT_SCHEMA_VERSION, shadow };
    let artifact = await Artifacts.findOne(key).lean();
    if (artifact && (ACCEPTED as readonly string[]).includes(artifact.status)) return await finishAccepted(lease, artifact, context, shadow, "reused", job.priority, assessmentJobTrigger(job));
    if (artifact?.status === "purged") {
      await completeCsiJob(lease, async () => undefined, { result: { reason: "purged", artifact_id: String(artifact._id) } });
      return { status: "skipped", reason: "purged", artifact_id: String(artifact._id) };
    }

    const config = moveAssessmentRuntimeConfiguration();
    const credential = deps.credential ?? config.credential;
    const model_id = deps.model_id ?? config.model_id, pricing = deps.pricing ?? config.pricing;
    // The personal credential never falls back to the company key.
    const gateway_key = deps.gateway_key ?? (credential === "AI_GATEWAY_API_KEY" ? config.gateway_key : undefined);
    // Same pinned-model allowlist as the analysis worker: a backfill `--model` cannot select an unlisted id.
    if (!pricing || !model_id || !(CSI_EXTRACTION_MODELS as readonly string[]).includes(model_id) || (!deps.model && !gateway_key?.trim())) throw new CsiError("FEATURE_DISABLED");

    if (!artifact) {
      try {
        const [created] = await Artifacts.create([{ ...key, outreach_record_id: toObjectId(context.outreach_record_id),
          contact_number_id: context.contact_number_id ? toObjectId(context.contact_number_id) : null,
          lead_ref: context.lead_ref ? { model: context.lead_ref.model, id: toObjectId(context.lead_ref.id) } : null,
          rubric_version: contract.rubric_version, prompt_version: contract.prompt_version, prompt_digest: contract.prompt_digest,
          schema_digest: contract.schema_digest, model_version: model_id, input_mode: context.input_mode,
          source_manifest: jsonValue(context.source_manifest), context_as_of: context.context_as_of,
          latest_conversation_at: context.latest_conversation_at, status: "pending", job_id: toObjectId(lease.job_id), lease_epoch: lease.epoch }]);
        artifact = created.toObject();
      } catch (error) {
        if (!duplicateKey(error)) throw error;
        artifact = await Artifacts.findOne(key).lean();
        if (!artifact) throw error;
        if ((ACCEPTED as readonly string[]).includes(artifact.status)) return await finishAccepted(lease, artifact, context, shadow, "reused", job.priority, assessmentJobTrigger(job));
      }
    }
    artifactId = String(artifact._id);
    if (!(String(artifact.job_id) === lease.job_id && artifact.lease_epoch === lease.epoch)) {
      if (artifact.status === "pending" && artifact.job_id && String(artifact.job_id) !== lease.job_id &&
        await getSalesIntelligenceJobModel().exists({ _id: artifact.job_id, status: "leased", leased_until: { $gt: new Date() } })) {
        await failCsiJob(lease, "transient", 0, { result: { reason: "concurrent_generation", artifact_id: artifactId } });
        return { status: "retry", reason: "concurrent_generation", artifact_id: artifactId };
      }
      // Take over a pending (or failed) row whose holder is gone: CAS on its previous holder and epoch.
      const taken = await Artifacts.updateOne({ _id: artifact._id, status: { $in: ["pending", "failed"] }, job_id: artifact.job_id ?? null,
        lease_epoch: artifact.lease_epoch }, { $set: { status: "pending", failure_reason: null, job_id: toObjectId(lease.job_id), lease_epoch: lease.epoch } });
      if (taken.modifiedCount !== 1) {
        await failCsiJob(lease, "transient", 0, { result: { reason: "concurrent_generation", artifact_id: artifactId } });
        return { status: "retry", reason: "concurrent_generation", artifact_id: artifactId };
      }
    }

    const generated = await generateMoveAssessment({ lease, artifact_id: artifactId, model: deps.model, model_id, gateway_key, credential,
      pricing, prompt_payload: context.prompt_payload, catalog: context.catalog, ledger: deps.ledger, layout: context.layout,
      deadline: deps.deadline ?? Date.now() + STRUCTURED_INVOCATION_MS, onProviderCall: deps.onProviderCall,
      beforeProvider: async () => {
        if (!csiFlag("ENABLED")) throw new CsiError("FEATURE_DISABLED");
        await renewCsiJob(lease, MOVE_ASSESSMENT_LEASE_MS);
        await deps.beforeProvider?.();
      } });
    const { accepted } = generated, status = assessmentStatusFor(accepted), generatedAt = clock();
    await checkpointCsiJob(lease, async session => {
      const written = await Artifacts.updateOne({ _id: artifact._id, status: "pending", job_id: toObjectId(lease.job_id), lease_epoch: lease.epoch }, { $set: {
        status, scores: jsonValue(accepted.scores),
        views: jsonValue({ original_ingestion: context.views?.original_ingestion ?? null, canonical_current: context.views?.canonical_current ?? null,
          customer_stated: accepted.move_details }),
        inventory: jsonValue({ ...accepted.inventory, source_coverage: context.coverage.source_coverage }),
        conflicts: jsonValue(accepted.conflicts), engagement: jsonValue(accepted.engagement), coverage: jsonValue(context.coverage), model_output: jsonValue(generated.model_output),
        usage: generated.usage, generated_at: generatedAt,
      } }, { session, runValidators: true });
      if (written.modifiedCount !== 1) throw new CsiError("LEASE_LOST");
    });
    const stored = await Artifacts.findById(artifact._id).orFail().lean();
    return await finishAccepted(lease, stored, context, shadow, "completed", job.priority, assessmentJobTrigger(job));
  } catch (error) {
    deps.onError?.(error);
    return failAssessment(lease, job.result, error, artifactId);
  }
}

async function completeSkip(lease: JobLease, skip: AssessmentSkip, shadow: boolean, deps: MoveAssessmentDeps): Promise<MoveAssessmentOutcome> {
  const Artifacts = getMoveAssessmentArtifactModel();
  let artifact_id: string | undefined;
  if (skip.skip === "not_applicable" || skip.skip === "ambiguous_subject") {
    // Recorded only when a previous ready assessment exists: the subject changed status since.
    const prior = await Artifacts.findOne({ ...csiDataset(), subject_key: skip.subject_key, shadow, status: "ready" }).sort({ _id: -1 }).lean();
    if (prior) {
      const contract = assessmentStepContract();
      const input_fingerprint = payloadHash(jsonValue({ contract: { schema_version: contract.schema_version, rubric_version: contract.rubric_version },
        skip: skip.skip, reason: skip.reason, supersedes: String(prior._id) }));
      if (input_fingerprint !== prior.input_fingerprint) {
        const key = { ...csiDataset(), subject_key: skip.subject_key, input_fingerprint, schema_version: MOVE_ASSESSMENT_SCHEMA_VERSION, shadow };
        const existing = await Artifacts.findOne(key).select("_id").lean();
        if (existing) artifact_id = String(existing._id);
        else {
          try {
            const [row] = await Artifacts.create([{ ...key, outreach_record_id: prior.outreach_record_id, contact_number_id: prior.contact_number_id,
              lead_ref: prior.lead_ref, rubric_version: contract.rubric_version, prompt_version: contract.prompt_version, prompt_digest: contract.prompt_digest,
              schema_digest: contract.schema_digest, model_version: prior.model_version, input_mode: prior.input_mode, source_manifest: [],
              context_as_of: (deps.now ?? (() => new Date()))(), status: skip.skip, failure_reason: skip.reason,
              job_id: toObjectId(lease.job_id), lease_epoch: lease.epoch }]);
            artifact_id = String(row._id);
          } catch (error) { if (!duplicateKey(error)) throw error; }
        }
      }
    }
  }
  await completeCsiJob(lease, async () => undefined, { result: { reason: skip.skip, detail: skip.reason, ...(artifact_id ? { artifact_id } : {}) } });
  return { status: "skipped", reason: skip.skip, ...(artifact_id ? { artifact_id } : {}) };
}

async function finishAccepted(lease: JobLease, artifact: ArtifactRow & { outreach_record_id?: unknown }, context: AssessmentContext,
  shadow: boolean, kind: "completed" | "reused", priority: number, trigger: string | null = null): Promise<MoveAssessmentOutcome> {
  const artifact_id = String(artifact._id);
  if (shadow) {
    await completeCsiJob(lease, async () => undefined, { result: { reason: kind === "reused" ? "reused" : "shadow_completed", artifact_id } });
    return { status: kind === "reused" ? "reused" : "shadow_completed", artifact_id };
  }
  const outcome = await completeCsiJob(lease, async session => {
    const decision = await publishAssessmentProjection(artifact, context, session, new Date(), trigger);
    // The result stays historical; a fresh nomination assesses the current inputs.
    if (decision === "stale_input") await nominateMoveAssessment({ outreach_record_id: context.outreach_record_id, trigger: `stale:${artifact_id}`,
      priority, force: true }, session);
    return decision;
  }, { resultFrom: decision => ({ reason: kind === "reused" ? `reused_${decision}` : decision, artifact_id }) });
  if (outcome === "stale_input") return { status: "stale_input", reason: "stale_input", artifact_id };
  return { status: kind, reason: outcome, artifact_id };
}

async function failAssessment(lease: JobLease, priorResult: unknown, error: unknown, artifactId: string | null): Promise<MoveAssessmentOutcome> {
  if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost" };
  const markFailed = async (session: ClientSession, outcome: { status: string }) => {
    if (artifactId && outcome.status === "dead_letter") await getMoveAssessmentArtifactModel().updateOne({ _id: artifactId, status: "pending",
      job_id: toObjectId(lease.job_id) }, { $set: { status: "failed", failure_reason: "attempts_exhausted" } }, { session });
  };
  const artifact = artifactId ? { artifact_id: artifactId } : {};
  try {
    if (error instanceof StructuredYield || error instanceof StructuredStepTimeout) {
      const previous = priorResult && typeof priorResult === "object" && "step_timeouts" in priorResult ? Number(priorResult.step_timeouts) : 0;
      const timeouts = error instanceof StructuredStepTimeout ? previous + 1 : previous;
      const pause = timeouts >= 2;
      await failCsiJob(lease, pause ? "permission_denied" : "recording_pending", 0, {
        result: { reason: error.message, step_timeouts: timeouts, ...artifact }, ...(pause ? {} : { resumeAt: new Date() }) });
      return { status: pause ? "paused" : "retry", reason: error.message, ...artifact };
    }
    if (error instanceof CsiError && error.code === "FEATURE_DISABLED") {
      await failCsiJob(lease, "permission_denied", 0, { result: { reason: "analysis_configuration_missing", ...artifact } });
      return { status: "paused", reason: "analysis_configuration_missing", ...artifact };
    }
    if (error instanceof CsiError && error.code === "BUDGET_EXHAUSTED") {
      await failCsiJob(lease, "budget_exhausted", 0, { result: { reason: "budget_exhausted", ...artifact } });
      return { status: "paused", reason: "budget_exhausted", ...artifact };
    }
    const provider = assessmentProviderFailure(error);
    if (provider) {
      const outcome = await failCsiJob(lease, provider.kind, provider.retryAfterMs, { result: { reason: provider.kind, ...artifact }, mutation: markFailed });
      return { status: provider.kind === "permission_denied" ? "paused" : outcome.status === "paused" ? "paused" : "retry", reason: provider.kind, ...artifact };
    }
    await failCsiJob(lease, "transient", 0, { result: { reason: "assessment_failed", ...artifact }, mutation: markFailed });
    return { status: "retry", reason: "assessment_failed", ...artifact };
  } catch (failure) {
    if (failure instanceof CsiError && failure.code === "LEASE_LOST") return { status: "lease_lost" };
    throw failure;
  }
}

/** Mirrors `drainIntelligenceJobs`' bounded loop without its recovery preparation. */
export async function drainMoveAssessmentJobs(deps: MoveAssessmentDeps = {}, options: { deadline?: number; max?: number } = {}) {
  if (!csiFlag("ENABLED") || (!csiFlag("MOVE_ASSESSMENT") && !deps.force)) return { status: "disabled", outcomes: [] as MoveAssessmentOutcome[], deadline_reached: false };
  const deadline = options.deadline ?? Date.now() + MOVE_ASSESSMENT_DRAIN_BUDGET_MS, max = options.max ?? 50;
  const outcomes: MoveAssessmentOutcome[] = [];
  for (let i = 0; i < max; i++) {
    if (Date.now() + MOVE_ASSESSMENT_LEASE_MS + 5_000 > deadline) break;
    const result = await runMoveAssessmentJob(undefined, { ...deps, deadline });
    outcomes.push(result);
    if (["not_claimable", "disabled", "lease_lost"].includes(result.status)) break;
  }
  const productive = outcomes.filter(o => o.status !== "not_claimable");
  return { status: productive.at(-1)?.status ?? "not_claimable", outcomes, deadline_reached: Date.now() + MOVE_ASSESSMENT_LEASE_MS + 5_000 > deadline };
}

/** Convenience for callers outside a transaction (tests, runner scripts). */
export const nominateMoveAssessmentNow = (input: Parameters<typeof nominateMoveAssessment>[0]) =>
  withTransaction(session => nominateMoveAssessment(input, session));
