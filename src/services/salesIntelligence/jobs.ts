import { Types, type ClientSession } from "mongoose";
import { withTransaction } from "../../db";
import {
  CSI_JOB_STAGES,
  CSI_RETIRED_JOB_STAGES,
  csiDataset,
  isRetainedCsiJobStage,
  type CsiJobStage,
} from "../../config/domain/salesIntelligence";
import { logger } from "../../logger";
import {
  getSalesIntelligenceJobModel,
  SALES_INTELLIGENCE_JOB_INDEXES,
} from "../../models/SalesIntelligenceJob";
import { CsiError } from "./auth";
import { assertIndexes, payloadHash } from "./transactions";
export type JobInput = {
  dedupe_key: string;
  stage: CsiJobStage;
  subject_key: string;
  input_revision: number;
  input_refs?: string[];
  priority?: number;
};
export type JobLease = { job_id: string; owner: string; epoch: number };
export async function enqueueCsiJob(
  input: JobInput,
  session: ClientSession,
  now = new Date(),
) {
  // Producer fence: a retired stage is never written again, whatever the caller's type says.
  if (!isRetainedCsiJobStage(input.stage)) throw new CsiError("INVALID_INPUT", [{ path: "stage", code: "stage_retired" }]);
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
        createdAt: now,
        updatedAt: now,
      },
    },
    // Enqueue is insert-only: schema timestamps would otherwise touch duplicates.
    { session, upsert: true, returnDocument: "after", runValidators: true, timestamps: false },
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
 * collection-wide `updateMany` in front of every single claim (14 §7).
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
/**
 * Claims one runnable row of a retained stage. A row of a retired stage is
 * never leased, even by an undirected claim or a wake-up naming its id.
 */
export async function claimCsiJob(
  owner: string,
  jobId?: string,
  ttlMs = 300_000,
  /** A worker that only knows how to run one stage claims only that stage. */
  stage?: CsiJobStage,
) {
  if (!owner.trim() || ttlMs <= 0 || ttlMs > 900_000 || (stage !== undefined && !isRetainedCsiJobStage(stage)))
    throw new CsiError("INVALID_INPUT");
  const Model = getSalesIntelligenceJobModel();
  await assertIndexes(Model.collection, SALES_INTELLIGENCE_JOB_INDEXES);
  const now = new Date();
  await sweepExhaustedCsiJobsOnCadence(now);
  return Model.findOneAndUpdate(
    {
      ...csiDataset(),
      ...(jobId ? { _id: jobId } : {}),
      stage: stage ?? { $in: [...CSI_JOB_STAGES] },
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
/** Rows of a retired stage that still hold work: anything not already terminal. */
const RETIRABLE_STATUSES = ["pending", "leased", "retry", "paused"] as const;
export const CSI_JOB_RETIREMENT_BATCH = 500;
/**
 * Global fence for the retired AI/media/Outreach stages (slimming SPECIFICATION §7.4). Each
 * matched row becomes `retired` with no provider call and no effect. Bumping `lease_epoch` and
 * clearing the lease revokes a lease an earlier deployment still holds: its renew, continue,
 * complete and fail writes all require `status: "leased"` with the epoch it claimed, so they find
 * no row and its transaction rolls back. The row gets no `completed_at`, so the completed-job TTL never
 * removes it: the slimming purge (C2, `status: "retired"` is terminal there) backs it up and deletes it.
 * Bounded per call; job recovery runs it every minute, so a backlog drains over several runs.
 */
export async function retireLegacyCsiJobs(options: { jobId?: string; limit?: number; now?: Date } = {}) {
  // Raw collection: stored rows of retired stages are outside the retained schema enum by design.
  const collection = getSalesIntelligenceJobModel().collection;
  const now = options.now ?? new Date();
  const filter = {
    ...csiDataset(),
    ...(options.jobId ? { _id: new Types.ObjectId(options.jobId) } : {}),
    stage: { $in: [...CSI_RETIRED_JOB_STAGES] as string[] },
    status: { $in: [...RETIRABLE_STATUSES] as string[] },
  };
  const rows = await collection
    .find(filter, { projection: { _id: 1, stage: 1 } })
    .sort({ _id: 1 })
    .limit(Math.max(1, Math.min(CSI_JOB_RETIREMENT_BATCH, options.limit ?? CSI_JOB_RETIREMENT_BATCH)))
    .toArray();
  const stages: Record<string, number> = {};
  if (!rows.length) return { retired: 0, stages };
  const result = await collection.updateMany(
    { ...filter, _id: { $in: rows.map((row) => row._id) } },
    {
      $set: {
        status: "retired",
        reason: "stage_retired",
        lease_owner: null,
        leased_until: null,
        updatedAt: now,
      },
      $inc: { lease_epoch: 1 },
    },
  );
  for (const row of rows) stages[String(row.stage)] = (stages[String(row.stage)] ?? 0) + 1;
  logger.info({ msg: "sales_intelligence.jobs.retired", retired: result.modifiedCount, stages });
  return { retired: result.modifiedCount, stages };
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
/**
 * All effect writes use this session. Final lease write occurs AFTER mutations so expiry during the callback rolls everything back. No network calls in callback.
 * `options.result` is a bounded JSON summary persisted on the job row with the completion write;
 * `options.resultFrom` derives it from the mutation's return value inside the same transaction.
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
  /** `throttled` defers without spending an attempt; the others back off and dead-letter when exhausted. */
  reason: "transient" | "schema_invalid" | "throttled",
  retryAfterMs = 0,
  /** Bounded JSON summary of the partial outcome kept visible on the retried or dead-lettered row. */
  options: {
    result?: unknown;
    /** An explicit retry instant (a provider-published time) instead of the backoff. */
    resumeAt?: Date;
    mutation?: (session: ClientSession, outcome: { status: string; next_attempt_at: Date }) => Promise<void>;
  } = {},
) {
  return withTransaction(async (session) => {
    const Model = getSalesIntelligenceJobModel();
    const row = await Model.findOne(fence(lease)).session(session);
    if (!row) throw new CsiError("LEASE_LOST");
    const deferred = reason === "throttled";
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
    const status = !deferred && exhausted ? "dead_letter" : "retry";
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
