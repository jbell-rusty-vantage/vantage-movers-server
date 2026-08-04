import type { ClientSession } from "mongoose";
import mongoose from "mongoose";
import { withTransaction } from "../../db";
import { ReportingDelivery } from "../../models/ReportingDelivery";
import { ReportingRun } from "../../models/ReportingRun";
import {
  assertSafeReportingFailure,
  type ReportingSafeFailureEnvelope,
} from "./reportingRunRepository";

export type ReportingDeliveryStatus =
  | "pending"
  | "writing"
  | "verifying"
  | "promoting"
  | "completed"
  | "failed"
  | "cancelled";

export type ReportingDeliveryProgress = {
  next_write_row: number;
  completed_batch_number: number;
  rows_written: number;
  cells_written: number;
  provider_requests: number;
  provider_retries: number;
  last_acknowledged_range: string | null;
  last_stream_checkpoint: unknown;
  promotion_step:
    | "not_started"
    | "rename_batch_submitted"
    | "verified_published"
    | "destination_updated"
    | "old_tab_retained"
    | "ambiguous";
};

export async function ensureReportingDelivery(input: {
  runId: string;
  definitionId: string;
  revisionId: string;
  destinationId: string;
  strategy: "replace_tab" | "snapshot";
  expected: {
    rows: number;
    columns: number;
    cellsIncludingHeader: number;
    headerLabels: string[];
  };
}): Promise<Record<string, any>> {
  const existing = await ReportingDelivery.collection.findOne({
    run_id: asObjectId(input.runId),
  });
  if (existing) return existing;
  const now = new Date();
  const doc = {
    run_id: asObjectId(input.runId),
    definition_id: asObjectId(input.definitionId),
    definition_revision_id: asObjectId(input.revisionId),
    destination_id: input.destinationId,
    strategy: input.strategy,
    status: "pending",
    workbook_id: null,
    workbook_url: null,
    staging_sheet_id: null,
    staging_sheet_title: null,
    published_sheet_id: null,
    published_sheet_title: null,
    old_sheet_id: null,
    old_sheet_recovery_title: null,
    expected: {
      rows: input.expected.rows,
      columns: input.expected.columns,
      cells_including_header: input.expected.cellsIncludingHeader,
      header_labels: input.expected.headerLabels,
      data_checksum: null,
    },
    actual: {
      rows: null,
      columns: null,
      cells_including_header: null,
      header_labels: [],
      data_checksum: null,
    },
    verification: {
      matched: null,
      checked_at: null,
      reasons: [],
    },
    progress: {
      next_write_row: 1,
      completed_batch_number: 0,
      rows_written: 0,
      cells_written: 0,
      provider_requests: 0,
      provider_retries: 0,
      last_acknowledged_range: null,
      last_stream_checkpoint: null,
      promotion_step: "not_started",
    },
    cleanup: {
      state: "not_needed",
      artifact_ids: [],
      attempts: 0,
      last_error_code: null,
      updated_at: null,
    },
    failure: null,
    fence_owner: null,
    fence_epoch: null,
    fence_generation: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
  };
  try {
    await ReportingDelivery.collection.insertOne(doc);
    return doc;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const raced = await ReportingDelivery.collection.findOne({
        run_id: asObjectId(input.runId),
      });
      if (raced) return raced;
    }
    throw error;
  }
}

export async function loadReportingDelivery(
  runId: string,
): Promise<Record<string, any> | null> {
  return ReportingDelivery.collection.findOne({ run_id: asObjectId(runId) });
}

/** Conditional run-side fence write filter (active owner+epoch+expiry). */
export function runFenceGenerationWriteFilter(input: {
  runId: string;
  fenceOwner: string;
  fenceEpoch: number;
  now: Date;
}) {
  return {
    _id: asObjectId(input.runId),
    lease_owner: input.fenceOwner,
    lease_epoch: input.fenceEpoch,
    leased_until: { $gt: input.now },
  };
}

export function runFenceGenerationWriteUpdate(input: {
  fenceOwner: string;
  fenceEpoch: number;
}) {
  return {
    $set: {
      delivery_fence_owner: input.fenceOwner,
      delivery_fence_generation: input.fenceEpoch,
    },
  };
}

export function deliveryFenceBindUpdate(input: {
  fenceOwner: string;
  fenceEpoch: number;
  fenceGeneration: number;
  now: Date;
}) {
  return {
    $set: {
      fence_owner: input.fenceOwner,
      fence_epoch: input.fenceEpoch,
      fence_generation: input.fenceGeneration,
      updated_at: input.now,
    },
  };
}

type FenceSimState = {
  leaseOwner: string | null;
  leaseEpoch: number | null;
  runFenceOwner: string | null;
  runFenceGeneration: number | null;
  deliveryFenceOwner: string | null;
  deliveryFenceGeneration: number | null;
};

/**
 * Deterministic interleaving model: bind TX conditionally WRITES run fence
 * generation under active lease, then binds delivery to that generation.
 * Lease takeover between those steps aborts the stale TX.
 */
export function simulateFenceBindInterleaving(
  events: Array<
    | { kind: "acquire"; worker: string; epoch: number }
    | { kind: "bind_tx"; worker: string; epoch: number; txId: string }
    | { kind: "run_fence_write"; txId: string }
    | { kind: "delivery_bind"; txId: string }
    | { kind: "commit"; txId: string }
    | { kind: "abort"; txId: string }
  >,
): FenceSimState & { aborted: string[]; committed: string[] } {
  const state: FenceSimState = {
    leaseOwner: null,
    leaseEpoch: null,
    runFenceOwner: null,
    runFenceGeneration: null,
    deliveryFenceOwner: null,
    deliveryFenceGeneration: null,
  };
  const open = new Map<
    string,
    {
      worker: string;
      epoch: number;
      runWritten: boolean;
      deliveryWritten: boolean;
      aborted: boolean;
    }
  >();
  const aborted: string[] = [];
  const committed: string[] = [];

  for (const event of events) {
    if (event.kind === "acquire") {
      state.leaseOwner = event.worker;
      state.leaseEpoch = event.epoch;
      continue;
    }
    if (event.kind === "bind_tx") {
      open.set(event.txId, {
        worker: event.worker,
        epoch: event.epoch,
        runWritten: false,
        deliveryWritten: false,
        aborted: false,
      });
      continue;
    }
    const tx = open.get(event.txId);
    if (!tx || tx.aborted) continue;
    if (event.kind === "run_fence_write") {
      // Conditional write: requires active lease match at write time.
      if (
        state.leaseOwner !== tx.worker ||
        state.leaseEpoch !== tx.epoch
      ) {
        tx.aborted = true;
        aborted.push(event.txId);
        continue;
      }
      state.runFenceOwner = tx.worker;
      state.runFenceGeneration = tx.epoch;
      tx.runWritten = true;
      continue;
    }
    if (event.kind === "delivery_bind") {
      if (!tx.runWritten) {
        tx.aborted = true;
        aborted.push(event.txId);
        continue;
      }
      if (
        state.runFenceOwner !== tx.worker ||
        state.runFenceGeneration !== tx.epoch
      ) {
        tx.aborted = true;
        aborted.push(event.txId);
        continue;
      }
      state.deliveryFenceOwner = tx.worker;
      state.deliveryFenceGeneration = tx.epoch;
      tx.deliveryWritten = true;
      continue;
    }
    if (event.kind === "commit") {
      if (!tx.runWritten || !tx.deliveryWritten || tx.aborted) {
        tx.aborted = true;
        aborted.push(event.txId);
      } else {
        committed.push(event.txId);
      }
      continue;
    }
    if (event.kind === "abort") {
      tx.aborted = true;
      aborted.push(event.txId);
    }
  }
  return { ...state, aborted, committed };
}

/** @deprecated use simulateFenceBindInterleaving */
export function simulateFenceBindRace(events: Array<{
  kind: "acquire" | "bind";
  worker: string;
  epoch: number;
}>): { fenceOwner: string | null; fenceEpoch: number | null } {
  type InterleaveEvent = Parameters<typeof simulateFenceBindInterleaving>[0][number];
  const mapped: InterleaveEvent[] = [];
  for (const [index, event] of events.entries()) {
    if (event.kind === "acquire") {
      mapped.push({ kind: "acquire", worker: event.worker, epoch: event.epoch });
      continue;
    }
    const txId = `tx-${event.worker}-${event.epoch}-${index}`;
    mapped.push(
      { kind: "bind_tx", worker: event.worker, epoch: event.epoch, txId },
      { kind: "run_fence_write", txId },
      { kind: "delivery_bind", txId },
      { kind: "commit", txId },
    );
  }
  const result = simulateFenceBindInterleaving(mapped);
  return {
    fenceOwner: result.deliveryFenceOwner,
    fenceEpoch: result.deliveryFenceGeneration,
  };
}

/**
 * Atomically: conditionally WRITE run fence generation under active lease,
 * then bind ReportingDelivery to that exact generation in the same TX.
 */
export async function bindReportingDeliveryFence(input: {
  runId: string;
  fenceOwner: string;
  fenceEpoch: number;
  now: Date;
  session?: ClientSession;
}): Promise<boolean> {
  if (!input.fenceOwner.trim() || !Number.isSafeInteger(input.fenceEpoch)) {
    throw new TypeError("Invalid reporting delivery fence binding.");
  }

  const bindOnce = async (session: ClientSession): Promise<boolean> => {
    const runUpdated = await ReportingRun.collection.findOneAndUpdate(
      runFenceGenerationWriteFilter(input),
      runFenceGenerationWriteUpdate(input),
      { session, returnDocument: "after" },
    );
    if (!runUpdated) {
      throw new Error("STALE_FENCE_BIND");
    }
    const generation = Number(runUpdated.delivery_fence_generation);
    if (generation !== input.fenceEpoch) {
      throw new Error("STALE_FENCE_BIND");
    }
    const result = await ReportingDelivery.collection.updateOne(
      { run_id: asObjectId(input.runId) },
      deliveryFenceBindUpdate({
        fenceOwner: input.fenceOwner,
        fenceEpoch: input.fenceEpoch,
        fenceGeneration: generation,
        now: input.now,
      }),
      { session },
    );
    if (result.matchedCount !== 1) {
      throw new Error("STALE_FENCE_BIND");
    }
    return true;
  };

  if (input.session) {
    try {
      return await bindOnce(input.session);
    } catch (error) {
      if (error instanceof Error && error.message === "STALE_FENCE_BIND") {
        return false;
      }
      throw error;
    }
  }
  try {
    return await withTransaction((session) => bindOnce(session));
  } catch (error) {
    if (error instanceof Error && error.message === "STALE_FENCE_BIND") {
      return false;
    }
    throw error;
  }
}

/**
 * Every delivery patch requires the currently bound generation/owner/epoch.
 */
export async function patchReportingDeliveryFenced(input: {
  runId: string;
  leaseOwner: string;
  leaseEpoch: number;
  now: Date;
  set: Record<string, unknown>;
  expectedStatus?: ReportingDeliveryStatus | ReportingDeliveryStatus[];
}): Promise<boolean> {
  if (input.set.failure !== undefined && input.set.failure !== null) {
    assertSafeReportingFailure(input.set.failure);
  }
  assertArtifactSafePatch(input.set);
  if ("status" in input.set && input.set.status === "cleanup_pending") {
    throw new TypeError(
      "cleanup_pending must not overwrite delivery terminal truth.",
    );
  }
  if (
    "fence_owner" in input.set ||
    "fence_epoch" in input.set ||
    "fence_generation" in input.set
  ) {
    throw new TypeError(
      "Delivery fence fields may only be bound via bindReportingDeliveryFence.",
    );
  }

  const filter: Record<string, unknown> = {
    run_id: asObjectId(input.runId),
    fence_owner: input.leaseOwner,
    fence_epoch: input.leaseEpoch,
    fence_generation: input.leaseEpoch,
  };
  if (input.expectedStatus) {
    filter.status = Array.isArray(input.expectedStatus)
      ? { $in: input.expectedStatus }
      : input.expectedStatus;
  }
  const result = await ReportingDelivery.collection.updateOne(filter, {
    $set: { ...input.set, updated_at: new Date() },
  });
  return result.matchedCount === 1;
}

/**
 * Cleanup-only patches. Never changes delivery status / terminal truth.
 */
export async function patchReportingDeliveryCleanup(input: {
  runId: string;
  set: Record<string, unknown>;
}): Promise<boolean> {
  for (const key of Object.keys(input.set)) {
    if (key === "status" || key.startsWith("status")) {
      throw new TypeError("Cleanup patches must not modify delivery status.");
    }
    if (!key.startsWith("cleanup.")) {
      throw new TypeError("Cleanup patches may only update cleanup.* fields.");
    }
  }
  const result = await ReportingDelivery.collection.updateOne(
    { run_id: asObjectId(input.runId) },
    { $set: { ...input.set, updated_at: new Date() } },
  );
  return result.matchedCount === 1;
}

export async function listCleanupPendingDeliveries(limit = 50) {
  return ReportingDelivery.collection
    .find({ "cleanup.state": "pending" })
    .sort({ updated_at: 1 })
    .limit(limit)
    .toArray();
}

/**
 * Atomically complete snapshot delivery + authoritative run in one TX under
 * active lease/fence. Prevents delivery=completed with run still promoting.
 */
export async function commitSnapshotDeliveryAndRunCompletion(input: {
  runId: string;
  leaseOwner: string;
  leaseEpoch: number;
  now: Date;
  deliverySet: Record<string, unknown>;
  finalDataChecksum: string;
  session?: ClientSession;
}): Promise<"committed" | "stale"> {
  if (input.deliverySet.failure !== undefined && input.deliverySet.failure !== null) {
    assertSafeReportingFailure(input.deliverySet.failure);
  }
  assertArtifactSafePatch(input.deliverySet);

  const commitOnce = async (session: ClientSession): Promise<"committed"> => {
    const runUpdated = await ReportingRun.collection.findOneAndUpdate(
      {
        _id: asObjectId(input.runId),
        status: "promoting",
        lease_owner: input.leaseOwner,
        lease_epoch: input.leaseEpoch,
        leased_until: { $gt: input.now },
        delivery_fence_generation: input.leaseEpoch,
        delivery_fence_owner: input.leaseOwner,
      },
      {
        $set: {
          status: "completed",
          completed_at: input.now,
          final_data_checksum: input.finalDataChecksum.toLowerCase(),
        },
      },
      { session, returnDocument: "after" },
    );
    if (!runUpdated) {
      throw new Error("STALE_SNAPSHOT_COMPLETION");
    }

    const deliveryUpdated = await ReportingDelivery.collection.updateOne(
      {
        run_id: asObjectId(input.runId),
        fence_owner: input.leaseOwner,
        fence_epoch: input.leaseEpoch,
        fence_generation: input.leaseEpoch,
        status: { $in: ["pending", "writing", "verifying", "promoting"] },
      },
      {
        $set: {
          ...input.deliverySet,
          status: "completed",
          completed_at: input.now,
          updated_at: input.now,
        },
      },
      { session },
    );
    if (deliveryUpdated.matchedCount !== 1) {
      throw new Error("STALE_SNAPSHOT_COMPLETION");
    }
    return "committed";
  };

  if (input.session) {
    try {
      return await commitOnce(input.session);
    } catch (error) {
      if (error instanceof Error && error.message === "STALE_SNAPSHOT_COMPLETION") {
        return "stale";
      }
      throw error;
    }
  }
  try {
    return await withTransaction((session) => commitOnce(session));
  } catch (error) {
    if (error instanceof Error && error.message === "STALE_SNAPSHOT_COMPLETION") {
      return "stale";
    }
    throw error;
  }
}

/**
 * Detect inconsistent terminal pairs that recovery must close without exposing
 * delivery-completed + run-failed (or other mismatched terminals).
 */
export function snapshotTerminalConsistency(input: {
  runStatus: string;
  deliveryStatus: string;
}): "consistent" | "delivery_ahead_recoverable" | "inconsistent_terminal" {
  const runTerminal = ["completed", "failed", "cancelled"].includes(
    input.runStatus,
  );
  const deliveryTerminal = ["completed", "failed", "cancelled"].includes(
    input.deliveryStatus,
  );
  if (input.runStatus === input.deliveryStatus) return "consistent";
  if (
    input.deliveryStatus === "completed" &&
    (input.runStatus === "promoting" || input.runStatus === "verifying")
  ) {
    return "delivery_ahead_recoverable";
  }
  if (runTerminal && deliveryTerminal && input.runStatus !== input.deliveryStatus) {
    return "inconsistent_terminal";
  }
  if (input.deliveryStatus === "completed" && input.runStatus === "failed") {
    return "inconsistent_terminal";
  }
  if (input.runStatus === "completed" && input.deliveryStatus !== "completed") {
    return "inconsistent_terminal";
  }
  return "consistent";
}

export function safeReportingDeliveryForRead(
  value: Record<string, any> | null | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  return {
    run_id: String(value.run_id),
    destination_id: value.destination_id,
    strategy: value.strategy,
    status: value.status,
    workbook_id: value.workbook_id,
    workbook_url: value.workbook_url,
    staging_sheet_id: value.staging_sheet_id,
    published_sheet_id: value.published_sheet_id,
    published_sheet_title: value.published_sheet_title,
    old_sheet_id: value.old_sheet_id,
    expected: value.expected,
    actual: value.actual,
    verification: value.verification,
    progress: {
      next_write_row: value.progress?.next_write_row,
      completed_batch_number: value.progress?.completed_batch_number,
      rows_written: value.progress?.rows_written,
      cells_written: value.progress?.cells_written,
      provider_requests: value.progress?.provider_requests,
      provider_retries: value.progress?.provider_retries,
      promotion_step: value.progress?.promotion_step,
    },
    cleanup: {
      state: value.cleanup?.state,
      attempts: value.cleanup?.attempts,
      last_error_code: value.cleanup?.last_error_code,
    },
    failure: value.failure,
    completed_at: value.completed_at,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function assertArtifactSafePatch(set: Record<string, unknown>): void {
  const json = JSON.stringify(set);
  if (/"rows"\s*:\s*\[/.test(json) || /"values"\s*:\s*\[/.test(json)) {
    throw new TypeError(
      "ReportingDelivery patches must not persist row payloads.",
    );
  }
}

function asObjectId(value: string) {
  if (!/^[a-f\d]{24}$/i.test(value)) {
    throw new TypeError("Invalid reporting object ID.");
  }
  return new mongoose.Types.ObjectId(value);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: number }).code === 11000
  );
}

export type { ReportingSafeFailureEnvelope };
