import mongoose, { type ClientSession } from "mongoose";
import { withTransaction } from "../../db";
import {
  csiDataset,
  type CSI_JOB_STAGES,
} from "../../config/domain/salesIntelligence";
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
  // Exhausted crashed claims remain visible; recovery never runs a ninth provider attempt.
  await Model.updateMany(
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
  return Model.findOneAndUpdate(
    {
      ...csiDataset(),
      ...(jobId ? { _id: jobId } : {}),
      ...(stage ? { stage } : {}),
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
      reason === "permission_denied" || reason === "budget_exhausted";
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
