import mongoose, { type ClientSession } from "mongoose";
import { createHash, randomUUID } from "node:crypto";
import { getSalesOutreachRefreshRequestModel, SALES_OUTREACH_REFRESH_REQUEST_INDEXES } from "../../../models/salesOutreach/refreshRequests";
import { getSalesOutreachSubjectModel } from "../../../models/salesOutreach/subjects";
import { assertIndexes } from "../../salesIntelligence/transactions";
import { CsiError } from "../../salesIntelligence/auth";
import { enqueueCsiJob, type JobInput } from "../../salesIntelligence/jobs";
import { isRoutineEvaluationKey } from "../../salesIntelligence/routineJobExpiry";
import { salesOutreachConfigurationLoader, type ActiveConfiguration } from "../config/load";

export const REFRESH_LEASE_MS = 120_000;
export const refreshFingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const oid = (id: string) => new mongoose.Types.ObjectId(id);

/** Every nomination advances generation, even equal fingerprints. Never cache admission refusals. */
export async function requestSubjectRefresh(job: JobInput, configuration: ActiveConfiguration, session: ClientSession, now = new Date()) {
  if (!session.inTransaction() || job.stage !== "outreach_evaluate") throw new CsiError("INVALID_INPUT");
  const control = configuration.value.refresh_requests;
  if (!control) return false;
  const subjectId = String(job.input_refs?.[0] ?? "");
  if (!mongoose.isValidObjectId(subjectId) || job.subject_key !== `outreach-subject:${subjectId}`) throw new CsiError("INVALID_INPUT");
  const Model = getSalesOutreachRefreshRequestModel();
  await assertIndexes(Model.collection, SALES_OUTREACH_REFRESH_REQUEST_INDEXES);
  const subject = await getSalesOutreachSubjectModel().findById(subjectId, { priority: 1 }).session(session).lean();
  const active = control.mode === "active";
  const nomination = {
    pending: true, request_version: "w2-v1", requested_mode: control.mode,
    request_fingerprint: refreshFingerprint({ configuration: configuration.version, cause: job.dedupe_key, revision: job.input_revision, priority: subject?.priority }),
    configuration_version: configuration.version, configuration_revision: configuration.revision,
    accepted_observation_id: subject?.priority.observation_id ? String(subject.priority.observation_id) : null,
    accepted_at: subject?.priority.accepted_at ?? null, next_due_at: now, cause: job.dedupe_key.slice(0, 240),
  };
  // Both generation fields use the same pre-update value. Shadow requests retain any active work owed.
  const nextGeneration = { $add: [{ $ifNull: ["$requested_generation", 0] }, 1] };
  await Model.collection.updateOne({ subject_id: oid(subjectId) }, [
    { $replaceWith: { $mergeObjects: [
      { active_generation: 0, consumed_generation: 0, lease_epoch: 0, claimed_generation: 0, requires_projection: false, createdAt: "$$NOW" },
      "$$ROOT", { $literal: nomination },
      { requested_generation: nextGeneration, updatedAt: "$$NOW",
        ...(active ? { active_generation: nextGeneration, requires_projection: true } : {}) },
    ] } },
  ], { upsert: true, session });
  return control.mode === "active";
}

/** Sweeps, commands and contacts use their durable CSI job identity for deduplication or queue wakeups. */
export async function enqueueOutreachWork(job: JobInput, session: ClientSession, now = new Date()) {
  const subjectId = job.input_refs?.[0];
  if (job.stage === "outreach_evaluate" && job.input_refs?.length === 1
    && job.subject_key === `outreach-subject:${subjectId}` && isRoutineEvaluationKey(job.dedupe_key, subjectId)) {
    const configuration = await salesOutreachConfigurationLoader.inspect(session);
    if (configuration.state === "active" && configuration.value.refresh_requests
      && await requestSubjectRefresh(job, configuration, session, now)) return null;
  }
  return enqueueCsiJob(job, session, now);
}

export async function claimSubjectRefresh(now = new Date(), owner = `sod-refresh:${randomUUID()}`) {
  const Model = getSalesOutreachRefreshRequestModel();
  await assertIndexes(Model.collection, SALES_OUTREACH_REFRESH_REQUEST_INDEXES);
  return Model.findOneAndUpdate({ pending: true, next_due_at: { $lte: now },
    $or: [{ lease_until: null }, { lease_until: { $lte: now } }] },
  { $set: { lease_owner: owner, lease_until: new Date(+now + REFRESH_LEASE_MS) }, $inc: { lease_epoch: 1 } },
  { sort: { next_due_at: 1, _id: 1 }, hint: "sod_refresh_pending_due", maxTimeMS: 3000, returnDocument: "after" }).lean();
}
export type RefreshClaim = NonNullable<Awaited<ReturnType<typeof claimSubjectRefresh>>>;
export type RefreshEvidence = { input: string; output: string; requirements: string; parity: "match" | "different" | "not_observed" };

/** Consume the claimed generation only; a concurrent request remains pending, even during completion. */
export async function completeSubjectRefresh(claim: RefreshClaim, evidence: RefreshEvidence, session: ClientSession, now = new Date()) {
  const Model = getSalesOutreachRefreshRequestModel();
  const result = await Model.collection.updateOne({ _id: claim._id, lease_owner: claim.lease_owner,
    lease_epoch: claim.lease_epoch, lease_until: { $gt: now }, consumed_generation: { $lt: claim.requested_generation } }, [
    { $set: { consumed_generation: claim.requested_generation, claimed_generation: claim.requested_generation,
      pending: { $gt: ["$requested_generation", claim.requested_generation] },
      requires_projection: { $gt: [{ $ifNull: ["$active_generation", 0] }, claim.requested_generation] },
      lease_owner: null, lease_until: null, last_completed_at: now, updatedAt: now,
      last_input_fingerprint: evidence.input, last_output_fingerprint: evidence.output,
      last_requirement_fingerprint: evidence.requirements, last_parity: evidence.parity } },
  ], { session });
  if (result.matchedCount !== 1) throw new CsiError("LEASE_LOST");
}

export async function retrySubjectRefresh(claim: RefreshClaim, now = new Date()) {
  await getSalesOutreachRefreshRequestModel().updateOne({ _id: claim._id, lease_owner: claim.lease_owner, lease_epoch: claim.lease_epoch },
    { $set: { lease_owner: null, lease_until: null, last_failure_at: now, next_due_at: new Date(+now + 30_000) } });
}
