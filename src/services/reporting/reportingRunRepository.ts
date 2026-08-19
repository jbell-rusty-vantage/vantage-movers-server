import { ReportingRun } from "../../models/ReportingRun";
import mongoose from "mongoose";
import { toObjectId } from "../../utils/objectId";
import type { ReportingStreamCheckpointV1 } from "./catalog";

export type ReportingRunStatus =
  | "queued"
  | "querying"
  | "writing"
  | "verifying"
  | "promoting"
  | "completed"
  | "failed"
  | "cancelled";

export const REPORTING_FAILURE_CODES = {
  CANONICAL_SOURCE_CHANGED: {
    summary: "Canonical source data changed; retry with a fresh run.",
    retryable: true,
  },
  QUERY_BUDGET_EXCEEDED: {
    summary: "The reporting query exceeded its safe execution budget.",
    retryable: false,
  },
  DESTINATION_CHANGED: {
    summary: "The reporting destination changed before delivery.",
    retryable: true,
  },
  DESTINATION_UNSAFE: {
    summary: "The reporting destination failed a safety check.",
    retryable: false,
  },
  DESTINATION_CAPACITY_EXCEEDED: {
    summary: "Projected report cells exceed destination capacity.",
    retryable: false,
  },
  PROVIDER_UNAVAILABLE: {
    summary: "The reporting provider is temporarily unavailable.",
    retryable: true,
  },
  PROVIDER_AUTHENTICATION: {
    summary: "Reporting Google OAuth authentication failed.",
    retryable: false,
  },
  PROVIDER_AUTHORIZATION: {
    summary: "Reporting Google access was denied.",
    retryable: false,
  },
  OWNERSHIP_MARKER_MISMATCH: {
    summary: "The managed reporting tab ownership marker did not match.",
    retryable: false,
  },
  HEADER_OR_CURSOR_DRIFT: {
    summary: "Reporting headers or cursors drifted from the immutable revision.",
    retryable: false,
  },
  VERIFICATION_MISMATCH: {
    summary: "Reporting delivery verification did not match expectations.",
    retryable: false,
  },
  PROMOTION_AMBIGUOUS: {
    summary: "Reporting tab promotion ended in an ambiguous Google state.",
    retryable: false,
  },
  LEASE_LOST: {
    summary: "The reporting worker lease was lost.",
    retryable: true,
  },
  RUN_CANCELLED: {
    summary: "The reporting run was cancelled.",
    retryable: false,
  },
  INTERNAL_FAILURE: {
    summary: "The reporting run failed safely.",
    retryable: false,
  },
} as const;

export type ReportingFailureCode = keyof typeof REPORTING_FAILURE_CODES;
export type ReportingSafeFailureEnvelope = {
  code: ReportingFailureCode;
  summary: string;
  retryable: boolean;
  metadata: Partial<{
    phase: "querying" | "writing" | "verifying" | "promoting";
    model:
      | "FormLead"
      | "CallLead"
      | "BookedLead"
      | "CancelledLead"
      | "BookingLeadReconciliationCase"
      | "IngestionConflict";
    provider_status: number;
    limit: number;
    count: number;
    attempt: number;
    page_number: number;
    row_count: number;
    batch_number: number;
    sheet_id: number;
    remediation: string;
  }>;
};

export function reportingFailure(
  code: ReportingFailureCode,
  metadata: ReportingSafeFailureEnvelope["metadata"] = {},
): ReportingSafeFailureEnvelope {
  const contract = REPORTING_FAILURE_CODES[code];
  const envelope = {
    code,
    summary: contract.summary,
    retryable: contract.retryable,
    metadata: { ...metadata },
  };
  assertSafeReportingFailure(envelope);
  return envelope;
}

export function assertSafeReportingFailure(
  value: unknown,
): asserts value is ReportingSafeFailureEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid reporting failure envelope.");
  }
  const source = value as Record<string, unknown>;
  if (
    Object.keys(source).some(
      (key) => !["code", "summary", "retryable", "metadata"].includes(key),
    ) ||
    typeof source.code !== "string" ||
    !(source.code in REPORTING_FAILURE_CODES)
  ) {
    throw new TypeError("Invalid reporting failure code.");
  }
  const contract =
    REPORTING_FAILURE_CODES[source.code as ReportingFailureCode];
  if (
    source.summary !== contract.summary ||
    source.retryable !== contract.retryable
  ) {
    throw new TypeError("Reporting failure text and retryability are fixed.");
  }
  const metadata = source.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("Invalid reporting failure metadata.");
  }
  const allowed = new Set([
    "phase",
    "model",
    "provider_status",
    "limit",
    "count",
    "attempt",
    "page_number",
    "row_count",
    "batch_number",
    "sheet_id",
    "remediation",
  ]);
  for (const [key, entry] of Object.entries(metadata)) {
    if (!allowed.has(key) || (typeof entry !== "number" && typeof entry !== "string")) {
      throw new TypeError("Reporting failure metadata is not allowlisted.");
    }
    if (typeof entry === "number" && (!Number.isFinite(entry) || entry < 0)) {
      throw new TypeError("Reporting failure metadata must be non-negative.");
    }
    if (
      key === "phase" &&
      !["querying", "writing", "verifying", "promoting"].includes(String(entry))
    ) {
      throw new TypeError("Invalid reporting failure phase.");
    }
    if (
      key === "model" &&
      ![
        "FormLead",
        "CallLead",
        "BookedLead",
        "CancelledLead",
        "BookingLeadReconciliationCase",
        "IngestionConflict",
      ].includes(String(entry))
    ) {
      throw new TypeError("Invalid reporting failure model.");
    }
  }
}

export function safeReportingFailureForRead(
  value: unknown,
): ReportingSafeFailureEnvelope | null {
  try {
    assertSafeReportingFailure(value);
    return value;
  } catch {
    return null;
  }
}

const STATUS_GRAPH: Readonly<Record<ReportingRunStatus, readonly ReportingRunStatus[]>> = {
  queued: ["querying", "failed", "cancelled"],
  querying: ["writing", "failed", "cancelled"],
  writing: ["verifying", "failed", "cancelled"],
  verifying: ["promoting", "failed", "cancelled"],
  promoting: ["completed", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export async function acquireReportingRunLease(input: {
  runId: string;
  owner: string;
  now: Date;
  ttlMs: number;
}): Promise<{ owner: string; epoch: number; leasedUntil: Date } | null> {
  if (!input.owner.trim() || !Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1) {
    throw new TypeError("Invalid reporting lease request.");
  }
  const leasedUntil = new Date(input.now.getTime() + input.ttlMs);
  const run = await ReportingRun.collection.findOneAndUpdate(
    {
      _id: asObjectId(input.runId),
      status: { $in: ["queued", "querying", "writing", "verifying", "promoting"] },
      $or: [
        { leased_until: null },
        { leased_until: { $lte: input.now } },
        { lease_owner: input.owner },
      ],
    },
    {
      $set: {
        lease_owner: input.owner,
        leased_until: leasedUntil,
        last_attempt_at: input.now,
      },
      $inc: { lease_epoch: 1, attempt_count: 1 },
    },
    { returnDocument: "after" },
  );
  if (!run) return null;
  return {
    owner: input.owner,
    epoch: Number(run.lease_epoch),
    leasedUntil,
  };
}

export async function renewReportingRunLease(input: {
  runId: string;
  owner: string;
  epoch: number;
  now: Date;
  ttlMs: number;
}): Promise<boolean> {
  const result = await ReportingRun.collection.updateOne(
    {
      _id: asObjectId(input.runId),
      lease_owner: input.owner,
      lease_epoch: input.epoch,
      leased_until: { $gt: input.now },
    },
    {
      $set: {
        leased_until: new Date(input.now.getTime() + input.ttlMs),
      },
    },
  );
  // matchedCount: identical leased_until (same now+ttl) must not look like LEASE_LOST.
  return result.matchedCount === 1;
}

export async function releaseReportingRunLease(input: {
  runId: string;
  owner: string;
  epoch: number;
}): Promise<boolean> {
  const result = await ReportingRun.collection.updateOne(
    {
      _id: asObjectId(input.runId),
      lease_owner: input.owner,
      lease_epoch: input.epoch,
    },
    {
      $set: { lease_owner: null, leased_until: null },
    },
  );
  return result.matchedCount === 1;
}

export async function captureReportingSourceReadThrough(input: {
  runId: string;
  sourceReadThrough: Date;
  queryPlanChecksum: string;
  leaseOwner: string;
  leaseEpoch: number;
  now: Date;
}): Promise<boolean> {
  if (
    !Number.isFinite(input.sourceReadThrough.getTime()) ||
    !/^[a-f\d]{64}$/i.test(input.queryPlanChecksum) ||
    !input.leaseOwner.trim() ||
    !Number.isSafeInteger(input.leaseEpoch) ||
    input.leaseEpoch < 1 ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new TypeError("Invalid reporting read-through capture.");
  }
  const result = await ReportingRun.collection.updateOne(
    reportingSourceCaptureFilter(input),
    {
      $set: {
        source_read_through: input.sourceReadThrough,
        query_plan_checksum: input.queryPlanChecksum.toLowerCase(),
      },
    },
  );
  return result.modifiedCount === 1;
}

export function reportingSourceCaptureFilter(input: {
  runId: string;
  leaseOwner: string;
  leaseEpoch: number;
  now: Date;
}) {
  return {
    _id: asObjectId(input.runId),
    status: "queued",
    lease_owner: input.leaseOwner,
    lease_epoch: input.leaseEpoch,
    leased_until: { $gt: input.now },
    source_read_through: null,
    query_plan_checksum: null,
  };
}

export async function transitionReportingRun(input: {
  runId: string;
  expectedStatus: ReportingRunStatus;
  nextStatus: ReportingRunStatus;
  leaseOwner: string;
  leaseEpoch: number;
  now: Date;
  checkpoint?: ReportingStreamCheckpointV1;
  counters?: Record<string, number>;
  finalDataChecksum?: string;
  failure?: ReportingSafeFailureEnvelope | null;
}): Promise<boolean> {
  if (!STATUS_GRAPH[input.expectedStatus].includes(input.nextStatus)) {
    throw new Error(
      `Reporting run transition ${input.expectedStatus} -> ${input.nextStatus} is not allowed.`,
    );
  }
  const set: Record<string, unknown> = { status: input.nextStatus };
  if (input.checkpoint) set.checkpoint = reportingCheckpoint(input.checkpoint, input.now);
  if (input.failure !== undefined) {
    if (input.failure !== null) assertSafeReportingFailure(input.failure);
    set.failure = input.failure;
  }
  if (input.finalDataChecksum !== undefined) {
    if (!/^[a-f\d]{64}$/i.test(input.finalDataChecksum)) {
      throw new TypeError("Invalid final reporting data checksum.");
    }
    set.final_data_checksum = input.finalDataChecksum.toLowerCase();
  }
  for (const [key, value] of Object.entries(input.counters ?? {})) {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`Invalid reporting counter: ${key}`);
    }
    set[`counters.${key}`] = value;
  }
  if (input.nextStatus === "completed" || input.nextStatus === "failed" || input.nextStatus === "cancelled") {
    set.completed_at = input.now;
  }
  if (input.nextStatus === "querying" && input.expectedStatus === "queued") {
    set.started_at = input.now;
  }
  const result = await ReportingRun.collection.updateOne(
    {
      _id: asObjectId(input.runId),
      status: input.expectedStatus,
      lease_owner: input.leaseOwner,
      lease_epoch: input.leaseEpoch,
      leased_until: { $gt: input.now },
    },
    { $set: set },
  );
  return result.modifiedCount === 1;
}

export async function checkpointReportingRun(input: {
  runId: string;
  expectedStatus: ReportingRunStatus;
  leaseOwner: string;
  leaseEpoch: number;
  now: Date;
  checkpoint: ReportingStreamCheckpointV1;
  counters?: Record<string, number>;
}): Promise<boolean> {
  const set: Record<string, unknown> = {
    checkpoint: reportingCheckpoint(input.checkpoint, input.now),
  };
  for (const [key, value] of Object.entries(input.counters ?? {})) {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`Invalid reporting counter: ${key}`);
    }
    set[`counters.${key}`] = value;
  }
  const result = await ReportingRun.collection.updateOne(
    {
      _id: asObjectId(input.runId),
      status: input.expectedStatus,
      lease_owner: input.leaseOwner,
      lease_epoch: input.leaseEpoch,
      leased_until: { $gt: input.now },
    },
    { $set: set },
  );
  return result.modifiedCount === 1;
}

export function reportingCheckpoint(
  checkpoint: ReportingStreamCheckpointV1,
  now: Date,
) {
  return {
    version: checkpoint.pageNumber + 1,
    phase: "querying",
    cursor: {
      cursor: checkpoint.cursor,
      checksum_accumulator: checkpoint.checksumAccumulator,
      row_count: checkpoint.rowCount,
      page_number: checkpoint.pageNumber,
    },
    completed_units: checkpoint.rowCount,
    updated_at: now,
  };
}

export type ReportingCancelResult = {
  status: "cancel_requested" | "already_terminal" | "already_requested" | "not_found";
  runStatus?: ReportingRunStatus;
};

export async function requestReportingRunCancellation(input: {
  runId: string;
  actorId: string;
  now: Date;
  idempotencyKey: string;
}): Promise<ReportingCancelResult> {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length < 8) {
    throw new TypeError("idempotencyKey is required for cancellation.");
  }
  const run = await ReportingRun.collection.findOne({
    _id: asObjectId(input.runId),
  });
  if (!run) return { status: "not_found" };

  // Idempotent replay: same key returns the persisted result.
  if (
    run.cancellation_idempotency_key === input.idempotencyKey &&
    run.cancellation_result &&
    typeof run.cancellation_result === "object"
  ) {
    return run.cancellation_result as ReportingCancelResult;
  }
  if (
    run.cancellation_idempotency_key &&
    run.cancellation_idempotency_key !== input.idempotencyKey
  ) {
    // A different key already bound this cancel request — replay that result.
    if (run.cancellation_result && typeof run.cancellation_result === "object") {
      return run.cancellation_result as ReportingCancelResult;
    }
    return {
      status: "already_requested",
      runStatus: run.status as ReportingRunStatus,
    };
  }

  if (["completed", "failed", "cancelled"].includes(String(run.status))) {
    const result: ReportingCancelResult = {
      status: "already_terminal",
      runStatus: run.status as ReportingRunStatus,
    };
    await persistCancelResult(input.runId, input.idempotencyKey, input.actorId, input.now, result);
    return result;
  }
  if (run.cancellation_requested_at) {
    const result: ReportingCancelResult = {
      status: "already_requested",
      runStatus: run.status as ReportingRunStatus,
    };
    await persistCancelResult(input.runId, input.idempotencyKey, input.actorId, input.now, result);
    return result;
  }

  // Promoting is not a cancel safe-point; request is recorded but worker will
  // refuse to interrupt rename/recovery blindly.
  const updated = await ReportingRun.collection.findOneAndUpdate(
    {
      _id: asObjectId(input.runId),
      status: { $in: ["queued", "querying", "writing", "verifying", "promoting"] },
      cancellation_requested_at: null,
      $or: [
        { cancellation_idempotency_key: null },
        { cancellation_idempotency_key: input.idempotencyKey },
      ],
    },
    {
      $set: {
        cancellation_requested_at: input.now,
        cancellation_requested_by: input.actorId,
        cancellation_idempotency_key: input.idempotencyKey,
        cancellation_result: {
          status: "cancel_requested",
          runStatus: run.status,
        },
      },
    },
    { returnDocument: "after" },
  );
  if (!updated) {
    const latest = await ReportingRun.collection.findOne({
      _id: asObjectId(input.runId),
    });
    if (!latest) return { status: "not_found" };
    if (
      latest.cancellation_idempotency_key === input.idempotencyKey &&
      latest.cancellation_result
    ) {
      return latest.cancellation_result as ReportingCancelResult;
    }
    if (["completed", "failed", "cancelled"].includes(String(latest.status))) {
      const result: ReportingCancelResult = {
        status: "already_terminal",
        runStatus: latest.status as ReportingRunStatus,
      };
      await persistCancelResult(input.runId, input.idempotencyKey, input.actorId, input.now, result);
      return result;
    }
    const result: ReportingCancelResult = {
      status: "already_requested",
      runStatus: latest.status as ReportingRunStatus,
    };
    await persistCancelResult(input.runId, input.idempotencyKey, input.actorId, input.now, result);
    return result;
  }
  return {
    status: "cancel_requested",
    runStatus: run.status as ReportingRunStatus,
  };
}

async function persistCancelResult(
  runId: string,
  idempotencyKey: string,
  actorId: string,
  now: Date,
  result: ReportingCancelResult,
): Promise<void> {
  const set: Record<string, unknown> = {
    cancellation_idempotency_key: idempotencyKey,
    cancellation_requested_by: actorId,
    cancellation_result: result,
  };
  if (
    result.status === "cancel_requested" ||
    result.status === "already_requested"
  ) {
    set.cancellation_requested_at = now;
  }
  await ReportingRun.collection.updateOne(
    {
      _id: asObjectId(runId),
      $or: [
        { cancellation_idempotency_key: null },
        { cancellation_idempotency_key: idempotencyKey },
      ],
    },
    { $set: set },
  );
}

export async function applyReportingRunCancellationAtSafePoint(input: {
  runId: string;
  leaseOwner: string;
  leaseEpoch: number;
  now: Date;
  expectedStatus: "queued" | "querying" | "writing" | "verifying";
}): Promise<boolean> {
  const result = await ReportingRun.collection.updateOne(
    {
      _id: asObjectId(input.runId),
      status: input.expectedStatus,
      lease_owner: input.leaseOwner,
      lease_epoch: input.leaseEpoch,
      leased_until: { $gt: input.now },
      cancellation_requested_at: { $ne: null },
    },
    {
      $set: {
        status: "cancelled",
        completed_at: input.now,
        failure: reportingFailure("RUN_CANCELLED", {
          phase:
            input.expectedStatus === "queued"
              ? "querying"
              : input.expectedStatus,
        }),
      },
    },
  );
  return result.modifiedCount === 1;
}

export async function loadReportingRun(
  runId: string,
): Promise<Record<string, any> | null> {
  return ReportingRun.collection.findOne({ _id: asObjectId(runId) });
}

export async function claimNextQueuedReportingRun(input: {
  owner: string;
  now: Date;
  ttlMs: number;
  runHint?: string | null;
  cancellationOnly?: boolean;
}): Promise<{
  run: Record<string, any>;
  lease: { owner: string; epoch: number; leasedUntil: Date };
} | null> {
  const hintFilter = input.runHint
    ? { _id: asObjectId(input.runHint) }
    : {};
  const candidates = await ReportingRun.collection
    .find({
      ...hintFilter,
      ...(input.cancellationOnly
        ? { cancellation_requested_at: { $ne: null } }
        : {}),
      status: { $in: ["queued", "querying", "writing", "verifying", "promoting"] },
      $or: [
        { leased_until: null },
        { leased_until: { $lte: input.now } },
        { lease_owner: input.owner },
      ],
    })
    .sort({ created_at: 1, _id: 1 })
    .limit(1)
    .toArray();
  const candidate = candidates[0];
  if (!candidate) return null;
  const lease = await acquireReportingRunLease({
    runId: String(candidate._id),
    owner: input.owner,
    now: input.now,
    ttlMs: input.ttlMs,
  });
  if (!lease) return null;
  const run = await loadReportingRun(String(candidate._id));
  if (!run) return null;
  return { run, lease };
}

export function streamCheckpointFromRun(
  run: Record<string, any>,
): ReportingStreamCheckpointV1 | undefined {
  const cursor = run.checkpoint?.cursor;
  if (!cursor || typeof cursor !== "object") return undefined;
  if (
    typeof cursor.page_number !== "number" ||
    typeof cursor.row_count !== "number" ||
    typeof cursor.checksum_accumulator !== "string"
  ) {
    return undefined;
  }
  return {
    version: 1,
    cursor: cursor.cursor ?? null,
    pageNumber: cursor.page_number,
    rowCount: cursor.row_count,
    checksumAccumulator: cursor.checksum_accumulator,
  };
}

function asObjectId(value: string) {
  if (!/^[a-f\d]{24}$/i.test(value)) {
    throw new TypeError("Invalid reporting run ID.");
  }
  return toObjectId(value);
}
