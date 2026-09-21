import mongoose, { type ClientSession } from "mongoose";
import { withTransaction } from "../../db";
import {
  CSI_BACKFILL_JOB_PRIORITY,
  CSI_LIVE_JOB_PRIORITY,
  csiDataset,
  type CSI_JOB_STAGES,
} from "../../config/domain/salesIntelligence";
export { CSI_BACKFILL_JOB_PRIORITY, CSI_LIVE_JOB_PRIORITY };
import {
  getSalesIntelligenceJobModel,
  SALES_INTELLIGENCE_JOB_INDEXES,
} from "../../models/SalesIntelligenceJob";
import { CsiError } from "./auth";
import { assertIndexes, payloadHash } from "./transactions";
export type JobInput = {
  dedupe_key: string;
  stage: (typeof CSI_JOB_STAGES)[number];
  subject_key: string;
  input_revision: number;
  input_refs?: string[];
  priority?: number;
  owner_reanalysis?: { run_id: string; source_run_id: string; mode: "original_evidence" | "current_context"; owner_correction_ids: string[]; focus_finding_id?: string | null };
  rep_identity_window?: { account: string; extension: string; from: string; through: string; change_id: string; after: string | null; after_at: string | null };
};
export type JobLease = { job_id: string; owner: string; epoch: number };
export async function enqueueCsiJob(
  input: JobInput,
  session: ClientSession,
  now = new Date(),
) {
  if (!session.inTransaction()) throw new CsiError("INVALID_INPUT");
  const Model = getSalesIntelligenceJobModel();
  await assertIndexes(Model.collection, SALES_INTELLIGENCE_JOB_INDEXES);
  const dataset = csiDataset();
  const payload_hash = payloadHash({
    ...dataset,
    stage: input.stage,
    subject_key: input.subject_key,
    input_revision: input.input_revision,
    input_refs: input.input_refs ?? [],
    ...(input.owner_reanalysis ? { owner_reanalysis: input.owner_reanalysis } : {}),
    ...(input.rep_identity_window ? { rep_identity_window: input.rep_identity_window } : {}),
  });
  const row = await Model.findOneAndUpdate(
    { dedupe_key: input.dedupe_key },
    {
      $setOnInsert: {
        ...input,
        ...dataset,
        payload_hash,
        status: "pending",
        attempts: 0,
        max_attempts: 8,
        next_attempt_at: now,
        lease_epoch: 0,
      },
    },
    { session, upsert: true, returnDocument: "after", runValidators: true },
  );
  if (
    !row ||
    row.payload_hash !== payload_hash ||
    row.deployment !== dataset.deployment ||
    row.database !== dataset.database
  )
    throw new CsiError("IDEMPOTENCY_CONFLICT");
  return row;
}
function fence(lease: JobLease, now = new Date()) {
  return {
    _id: lease.job_id,
    ...csiDataset(),
    status: "leased" as const,
    lease_owner: lease.owner,
    lease_epoch: lease.epoch,
    leased_until: { $gt: now },
  };
}
/**
 * Exhausted crashed claims remain visible; recovery never runs a ninth
 * provider attempt.
 *
 * This is queue-wide housekeeping, not a claim precondition: the claim filter
 * already carries `attempts < max_attempts`, so an exhausted row can never be
 * claimed whether or not it has been dead-lettered yet. The sweep only makes
 * it *visible*, which is why it runs on a cadence instead of as a
 * collection-wide `updateMany` in front of every single claim — up to 150 a
 * minute across the ensure and recovery drains (14 §7).
 */
const SWEEP_INTERVAL_MS = 60_000;
let lastSweepAt = 0;

/** Test seam; production relies on the interval alone. */
export function resetCsiJobSweepClock(): void {
  lastSweepAt = 0;
}

async function sweepExhaustedCsiJobsOnCadence(now: Date) {
  if (now.getTime() - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now.getTime();
  // Housekeeping must never fail a claim.
  try {
    await sweepExhaustedCsiJobs(now);
  } catch {
    /* the next tick sweeps again */
  }
}

export async function sweepExhaustedCsiJobs(now = new Date()) {
  const result = await getSalesIntelligenceJobModel().updateMany(
    {
      ...csiDataset(),
      status: "leased",
      leased_until: { $lte: now },
      $expr: { $gte: ["$attempts", "$max_attempts"] },
    },
    {
      $set: {
        status: "dead_letter",
        reason: "attempts_exhausted",
        lease_owner: null,
      },
    },
  );
  return { dead_lettered: result.modifiedCount };
}
export async function claimCsiJob(
  owner: string,
  jobId?: string,
  ttlMs = 300_000,
  /**
   * CSI-03 additive: a worker that only knows how to run one stage claims
   * only that stage, so a consumer never leases work it cannot process.
   */
  stage?: JobInput["stage"],
) {
  if (!owner.trim() || ttlMs <= 0 || ttlMs > 900_000)
    throw new CsiError("INVALID_INPUT");
  const Model = getSalesIntelligenceJobModel();
  await assertIndexes(Model.collection, SALES_INTELLIGENCE_JOB_INDEXES);
  const now = new Date();
  // A queue wake-up for a particular historical job cannot jump ahead of
  // current STT/analysis simply by bypassing the sorted cron claim.
  const aiStages: JobInput["stage"][] = ["transcription", "analysis", "number_refresh"];
  const liveAiDue = (!stage || aiStages.includes(stage)) && await Model.exists({
    ...csiDataset(), stage: { $in: aiStages }, priority: { $gte: CSI_LIVE_JOB_PRIORITY },
    $or: [{ status: { $in: ["pending", "retry"] }, next_attempt_at: { $lte: now } },
      { status: "leased" }],
  });
  await sweepExhaustedCsiJobsOnCadence(now);
  return Model.findOneAndUpdate(
    {
      ...csiDataset(),
      ...(jobId ? { _id: jobId } : {}),
      ...(stage ? { stage } : {}),
      ...(liveAiDue ? { priority: { $gte: CSI_LIVE_JOB_PRIORITY } } : {}),
      $expr: { $lt: ["$attempts", "$max_attempts"] },
      $or: [
        {
          status: { $in: ["pending", "retry"] },
          next_attempt_at: { $lte: now },
        },
        { status: "leased", leased_until: { $lte: now } },
      ],
    },
    {
      $set: {
        status: "leased",
        lease_owner: owner,
        leased_until: new Date(now.getTime() + ttlMs),
      },
      $inc: { lease_epoch: 1, attempts: 1 },
    },
    {
      // `csi_job_claim` leads with the dataset and stage and then carries this
      // exact order, so the claim is an index scan rather than a blocking
      // in-memory sort over every pending job (14 §7).
      sort: { priority: -1, next_attempt_at: 1, _id: 1 },
      returnDocument: "after",
    },
  );
}
export async function renewCsiJob(lease: JobLease, ttlMs = 300_000) {
  if (ttlMs <= 0 || ttlMs > 900_000) throw new CsiError("INVALID_INPUT");
  const now = new Date();
  const result = await getSalesIntelligenceJobModel().updateOne(
    fence(lease, now),
    { $set: { leased_until: new Date(now.getTime() + ttlMs) } },
  );
  if (result.modifiedCount !== 1) throw new CsiError("LEASE_LOST");
}
/** Successful bounded progress is not a failed attempt. Commit continuation with its effects. */
export async function continueCsiJob<T>(lease: JobLease, mutation: (session: ClientSession) => Promise<T>) {
  return withTransaction(async session => {
    const Model = getSalesIntelligenceJobModel();
    if (!await Model.exists(fence(lease)).session(session)) throw new CsiError("LEASE_LOST");
    const value = await mutation(session);
    const changed = await Model.updateOne(fence(lease), {
      $set: { status: "pending", lease_owner: null, leased_until: null, next_attempt_at: new Date() },
      $inc: { attempts: -1 },
    }, { session });
    if (changed.modifiedCount !== 1) throw new CsiError("LEASE_LOST");
    return value;
  });
}
/** Commit bounded resumable application progress without completing the durable job. */
export async function checkpointCsiJob<T>(lease: JobLease, mutation: (session: ClientSession) => Promise<T>) {
  return withTransaction(async session => {
    const Model = getSalesIntelligenceJobModel();
    if (!await Model.exists(fence(lease)).session(session)) throw new CsiError("LEASE_LOST");
    const value = await mutation(session);
    const changed = await Model.updateOne(fence(lease), { $inc: { evidence_fence: 1 } }, { session });
    if (changed.modifiedCount !== 1) throw new CsiError("LEASE_LOST");
    return value;
  });
}
/**
 * All effect writes use this session. Final lease write occurs AFTER mutations so expiry during the callback rolls everything back. No network calls in callback.
 * CSI-03 additive: `options.result` is a bounded JSON summary persisted on the job row with the completion write;
 * `options.resultFrom` derives it from the mutation's return value inside the same transaction (CSI-04).
 */
export async function completeCsiJob<T>(
  lease: JobLease,
  mutation: (session: ClientSession) => Promise<T>,
  options: { result?: unknown; resultFrom?: (value: T) => unknown } = {},
) {
  return withTransaction(async (session) => {
    const Model = getSalesIntelligenceJobModel();
    const held = await Model.findOne(fence(lease)).session(session);
    if (!held) throw new CsiError("LEASE_LOST");
    const result = await mutation(session);
    const stored = options.resultFrom ? options.resultFrom(result) : options.result;
    const updated = await Model.updateOne(
      fence(lease),
      {
        $set: {
          status: "completed",
          completed_at: new Date(),
          lease_owner: null,
          leased_until: null,
          ...(stored === undefined ? {} : { result: stored }),
        },
      },
      { session, runValidators: true },
    );
    if (updated.modifiedCount !== 1) throw new CsiError("LEASE_LOST");
    return result;
  });
}
export async function failCsiJob(
  lease: JobLease,
  reason:
    | "transient"
    | "schema_invalid"
    | "permission_denied"
    | "budget_exhausted"
    /** One invocation's reservation exceeds the Owner's per-recording ceiling. Monthly headroom cannot resume it; only a higher ceiling or smaller limits can (17 §5). */
    | "per_recording_ceiling"
    | "recording_pending"
    | "eligibility_pending"
    | "throttled",
  retryAfterMs = 0,
  /** CSI-03 additive: bounded JSON summary of the partial outcome kept visible on the retried/paused/dead-lettered row. */
  options: {
    result?: unknown;
    /** Timed capability pauses resume through the normal claim path. */
    resumeAt?: Date;
    mutation?: (session: ClientSession, outcome: { status: string; next_attempt_at: Date }) => Promise<void>;
  } = {},
) {
  return withTransaction(async (session) => {
    const Model = getSalesIntelligenceJobModel();
    const row = await Model.findOne(fence(lease)).session(session);
    if (!row) throw new CsiError("LEASE_LOST");
    const paused =
      reason === "permission_denied" || reason === "budget_exhausted" || reason === "per_recording_ceiling";
    const deferred = paused || ["recording_pending", "eligibility_pending", "throttled"].includes(reason);
    const exhausted =
      row.attempts >= (reason === "schema_invalid" ? 2 : row.max_attempts);
    const delay = Math.max(
      retryAfterMs,
      Math.min(21_600_000, 30_000 * 2 ** (row.attempts - 1)) *
        (1 + Math.random() * 0.25),
    );
    if (!Number.isFinite(delay) || delay < 0) throw new CsiError("INVALID_INPUT");
    const next_attempt_at = options.resumeAt ?? new Date(Date.now() + delay);
    if (!Number.isFinite(next_attempt_at.getTime())) throw new CsiError("INVALID_INPUT");
    const status = paused && !options.resumeAt ? "paused" : !deferred && exhausted ? "dead_letter" : "retry";
    await options.mutation?.(session, { status, next_attempt_at });
    const result = await Model.updateOne(
      fence(lease),
      {
        $set: {
          status,
          reason,
          next_attempt_at,
          lease_owner: null,
          leased_until: null,
          ...(options.result === undefined ? {} : { result: options.result }),
        },
        ...(deferred ? { $inc: { attempts: -1 } } : {}),
      },
      { session, runValidators: true },
    );
    if (result.modifiedCount !== 1) throw new CsiError("LEASE_LOST");
    return { status, next_attempt_at };
  });
}
