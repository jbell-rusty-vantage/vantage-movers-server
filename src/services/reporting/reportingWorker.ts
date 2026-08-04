import { randomBytes } from "node:crypto";
import { isReportingGoogleDeliveryEnabled } from "../../config/domain/reporting";
import { connectMongo } from "../../db";
import { operationalWorkbookRegistry } from "../operationalWorkbooks";
import {
  initialChecksumAccumulator,
  reportingStage4StreamV1,
} from "./executionStream";
import { serializeReportingHeaderCells } from "./google/cellSerialization";
import type { ReportingDriveAdapter } from "./google/reportingDriveAdapter";
import type { ReportingSheetsAdapter } from "./google/reportingSheetsAdapter";
import { sanitizeReportingProviderFailure } from "./google/providerFailures";
import {
  createOrResumeDeliveryArtifact,
  maxCapacityDataRowsFromCells,
  promoteOrRecoverReplaceTab,
  validatePersistedManifestForResume,
  verifyStagingContents,
  writeBoundedReportingBatch as writeBoundedReportingBatchEngine,
  assertNoSilentTruncation,
  buildReportingWriteBatches,
} from "./deliveryEngine";
import { consumeLiveTestTransientWriteFailure } from "./live/liveTestWorkerHooks";
import {
  bindReportingDeliveryFence,
  commitSnapshotDeliveryAndRunCompletion,
  ensureReportingDelivery,
  loadReportingDelivery,
  patchReportingDeliveryFenced,
} from "./reportingDeliveryRepository";
import {
  emitReportingCapacityDivergence,
  emitReportingDenylistUnavailable,
  emitReportingPromotionAmbiguous,
  emitReportingRetryExhausted,
  emitReportingVerificationMismatch,
} from "./reportingObservability";
import {
  getReportingDestinationById,
  refreshDestinationHealthAndDenylist,
} from "./reportingDestinationRepository";
import {
  extractPredecessorSheetIds,
  resolveDestinationForWorker,
} from "./destinationLineage";
import { inspectReplaceTabPromotion, recoveryTabTitle } from "./promotion";
import {
  commitPromotionDestinationCas,
  isTransientPromotionTransactionError,
  markPromotionReservationProviderApplied,
  planPromotionRecovery,
  writePromotionReservationUnderLease,
  type ReportingPromotionReservation,
} from "./promotionReservation";
import {
  loadReportingCandidateManifest,
  persistReportingCandidateManifest,
} from "./reportingManifestRepository";
import {
  applyReportingRunCancellationAtSafePoint,
  captureReportingSourceReadThrough,
  checkpointReportingRun,
  claimNextQueuedReportingRun,
  loadReportingRun,
  releaseReportingRunLease,
  renewReportingRunLease,
  reportingFailure,
  streamCheckpointFromRun,
  transitionReportingRun,
  type ReportingSafeFailureEnvelope,
} from "./reportingRunRepository";
import { computeQueryPlanChecksum } from "./query/canonicalReporting";
import { assertEstimateFitsCapacity } from "./reporting.service";
import { enqueueIncompleteArtifactCleanup } from "./cleanup";
import { recordReportingAudit } from "./reportingAudit";
import type { ReportingExecutionPackageV1 } from "./reporting.service";
import type { ValidatedReportingRequest } from "./catalog";
import { getReportingDestinationPort } from "./destinationContract";

const LEASE_TTL_MS = 5 * 60_000;
const PROMOTION_CAS_TX_ATTEMPTS = 3;
const SNAPSHOT_COMPLETION_TX_ATTEMPTS = 3;

const PHASE_ORDER = [
  "queued",
  "querying",
  "writing",
  "verifying",
  "promoting",
  "completed",
] as const;

export class LeaseLostError extends Error {
  readonly code = "LEASE_LOST";
  readonly envelope: ReportingSafeFailureEnvelope;
  constructor(phase: "querying" | "writing" | "verifying" | "promoting") {
    const envelope = reportingFailure("LEASE_LOST", { phase });
    super(envelope.summary);
    this.name = "LeaseLostError";
    this.envelope = envelope;
  }
}

/** Expected-status mismatch while the lease is still held — not LEASE_LOST. */
export class PhaseSkipError extends Error {
  readonly code = "PHASE_ALREADY_ADVANCED";
  constructor(readonly currentStatus: string, readonly expectedStatus: string) {
    super(
      `Reporting run already advanced past ${expectedStatus} (current=${currentStatus}).`,
    );
    this.name = "PhaseSkipError";
  }
}

function phaseIndex(status: string): number {
  const index = PHASE_ORDER.indexOf(status as (typeof PHASE_ORDER)[number]);
  return index;
}

function isAtOrPast(status: string, target: string): boolean {
  const current = phaseIndex(status);
  const want = phaseIndex(target);
  if (current < 0 || want < 0) return false;
  return current >= want;
}

export type ReportingWorkerDependencies = {
  sheets: ReportingSheetsAdapter;
  drive: ReportingDriveAdapter;
  now?: () => Date;
};

type Lease = { owner: string; epoch: number; leasedUntil: Date };

async function writeBoundedReportingBatch(
  input: Parameters<typeof writeBoundedReportingBatchEngine>[0] & { runId?: string },
): Promise<Awaited<ReturnType<typeof writeBoundedReportingBatchEngine>>> {
  if (input.runId && consumeLiveTestTransientWriteFailure(input.runId)) {
    throw reportingFailure("PROVIDER_UNAVAILABLE", {
      phase: "writing",
      attempt: 1,
    });
  }
  const { runId: _runId, ...engineInput } = input;
  return writeBoundedReportingBatchEngine(engineInput);
}

export async function runReportingDeliveryWorker(
  input: { runHint?: string | null } = {},
  deps?: ReportingWorkerDependencies,
): Promise<{ claimed: boolean; run_id?: string; status?: string }> {
  await connectMongo();
  const deliveryEnabled = isReportingGoogleDeliveryEnabled();
  if (!deps && deliveryEnabled) {
    throw new Error(
      "Reporting worker requires injected Google adapters in this process.",
    );
  }
  const nowFn = deps?.now ?? (() => new Date());
  const owner = `reporting-worker:${randomBytes(8).toString("hex")}`;
  const claimed = await claimNextQueuedReportingRun({
    owner,
    now: nowFn(),
    ttlMs: LEASE_TTL_MS,
    runHint: input.runHint,
    cancellationOnly: !deliveryEnabled,
  });
  if (!claimed) return { claimed: false, status: "lease_busy_or_empty" };

  const runId = String(claimed.run._id);
  try {
    if (!deliveryEnabled) {
      const cancelled = await cancelIfRequested(
        runId,
        claimed.lease,
        nowFn(),
      );
      await releaseReportingRunLease({
        runId,
        owner: claimed.lease.owner,
        epoch: claimed.lease.epoch,
      });
      return {
        claimed: true,
        run_id: runId,
        status: cancelled ? "cancelled" : "delivery_disabled",
      };
    }
    if (!deps) {
      throw new Error(
        "Reporting worker requires injected Google adapters in this process.",
      );
    }
    const status = await executeLeasedReportingRun({
      run: claimed.run,
      lease: claimed.lease,
      sheets: deps.sheets,
      drive: deps.drive,
      now: nowFn,
    });
    await releaseReportingRunLease({
      runId,
      owner: claimed.lease.owner,
      epoch: claimed.lease.epoch,
    });
    return { claimed: true, run_id: runId, status };
  } catch (error) {
    const current = await loadReportingRun(runId);
    const disposition = disposeWorkerError({
      error,
      runStatus: current ? String(current.status) : String(claimed.run.status),
    });

    if (
      disposition.kind === "already_terminal" ||
      disposition.kind === "phase_skip"
    ) {
      await releaseReportingRunLease({
        runId,
        owner: claimed.lease.owner,
        epoch: claimed.lease.epoch,
      }).catch(() => false);
      return {
        claimed: true,
        run_id: runId,
        status: disposition.status,
      };
    }

    if (disposition.kind === "retryable_abandon") {
      // LeaseLost / retryable: never terminal-fail. Stop provider work, release
      // if still owned, leave checkpoints/reservation/delivery progress intact.
      await releaseReportingRunLease({
        runId,
        owner: claimed.lease.owner,
        epoch: claimed.lease.epoch,
      }).catch(() => false);
      return {
        claimed: true,
        run_id: runId,
        status: disposition.status,
      };
    }

    // Non-retryable: terminal-fail under lease when still non-terminal.
    if (
      current &&
      !["completed", "failed", "cancelled"].includes(String(current.status))
    ) {
      await transitionReportingRun({
        runId,
        expectedStatus: current.status,
        nextStatus: "failed",
        leaseOwner: claimed.lease.owner,
        leaseEpoch: claimed.lease.epoch,
        now: nowFn(),
        failure: disposition.failure,
      }).catch(() => false);
      await patchReportingDeliveryFenced({
        runId,
        leaseOwner: claimed.lease.owner,
        leaseEpoch: claimed.lease.epoch,
        now: nowFn(),
        set: { status: "failed", failure: disposition.failure },
      }).catch(() => false);
    }
    await releaseReportingRunLease({
      runId,
      owner: claimed.lease.owner,
      epoch: claimed.lease.epoch,
    }).catch(() => false);
    return {
      claimed: true,
      run_id: runId,
      status: "failed",
    };
  }
}

/**
 * Pure worker-catch disposition. LeaseLost and other retryable abandonments
 * must never mark run/delivery failed — queue/takeover resumes from durable state.
 */
export function disposeWorkerError(input: {
  error: unknown;
  runStatus: string;
}):
  | { kind: "already_terminal"; status: string }
  | { kind: "phase_skip"; status: string }
  | {
      kind: "retryable_abandon";
      status: string;
      failure: ReportingSafeFailureEnvelope;
    }
  | { kind: "terminal_fail"; failure: ReportingSafeFailureEnvelope } {
  if (["completed", "failed", "cancelled"].includes(input.runStatus)) {
    return { kind: "already_terminal", status: input.runStatus };
  }
  if (
    input.error instanceof PhaseSkipError &&
    isAtOrPast(input.runStatus, "writing")
  ) {
    return { kind: "phase_skip", status: input.runStatus };
  }
  const phase = inferPhase({ status: input.runStatus });
  if (input.error instanceof LeaseLostError) {
    return {
      kind: "retryable_abandon",
      status: "lease_lost",
      failure: input.error.envelope,
    };
  }
  const failure = toFailure(input.error, phase);
  if (failure.retryable) {
    return {
      kind: "retryable_abandon",
      status:
        failure.code === "LEASE_LOST"
          ? "lease_lost"
          : failure.code.toLowerCase(),
      failure,
    };
  }
  return { kind: "terminal_fail", failure };
}

async function requireLease(
  lease: Lease,
  runId: string,
  now: Date,
  phase: "querying" | "writing" | "verifying" | "promoting",
): Promise<void> {
  const held = await renewReportingRunLease({
    runId,
    owner: lease.owner,
    epoch: lease.epoch,
    now,
    ttlMs: LEASE_TTL_MS,
  });
  if (!held) throw new LeaseLostError(phase);
}

async function requireTransition(
  input: Parameters<typeof transitionReportingRun>[0],
  phase: "querying" | "writing" | "verifying" | "promoting",
): Promise<void> {
  const ok = await transitionReportingRun(input);
  if (ok) return;
  const run = await loadReportingRun(input.runId);
  if (!run) throw new LeaseLostError(phase);
  const leaseHeld =
    String(run.lease_owner) === input.leaseOwner &&
    Number(run.lease_epoch) === input.leaseEpoch &&
    run.leased_until != null &&
    new Date(run.leased_until).getTime() > input.now.getTime();
  if (!leaseHeld) throw new LeaseLostError(phase);
  // Lease held: skip already-completed earlier transitions on phase-aware resume.
  if (isAtOrPast(String(run.status), input.nextStatus)) {
    return;
  }
  throw new PhaseSkipError(String(run.status), input.expectedStatus);
}

async function requireCheckpoint(
  input: Parameters<typeof checkpointReportingRun>[0],
): Promise<void> {
  const ok = await checkpointReportingRun(input);
  if (!ok) throw new LeaseLostError("writing");
}

async function requireDeliveryPatch(
  input: Parameters<typeof patchReportingDeliveryFenced>[0],
  phase: "querying" | "writing" | "verifying" | "promoting",
): Promise<void> {
  const ok = await patchReportingDeliveryFenced(input);
  if (!ok) throw new LeaseLostError(phase);
}

async function executeLeasedReportingRun(input: {
  run: Record<string, any>;
  lease: Lease;
  sheets: ReportingSheetsAdapter;
  drive: ReportingDriveAdapter;
  now: () => Date;
}): Promise<string> {
  const { run, lease, sheets, drive, now } = input;
  const runId = String(run._id);
  const executionPackage = run.execution_package as ReportingExecutionPackageV1;
  const queryInput = run.query_input as ValidatedReportingRequest;
  const columns = executionPackage.stream.selectedColumns;
  const expectedRows = executionPackage.estimate.rows;
  const estimateKind = executionPackage.estimate.kind;
  const expectedColumns = columns.length;
  const expectedCells = (expectedRows + 1) * expectedColumns;

  await ensureReportingDelivery({
    runId,
    definitionId: executionPackage.definitionId,
    revisionId: executionPackage.revisionId,
    destinationId: executionPackage.destination.destinationId,
    strategy: executionPackage.destination.strategy,
    expected: {
      rows: expectedRows,
      columns: expectedColumns,
      cellsIncludingHeader: expectedCells,
      headerLabels: serializeReportingHeaderCells(columns),
    },
  });

  // Atomic delivery fence bound to this claim/takeover epoch.
  const fenced = await bindReportingDeliveryFence({
    runId,
    fenceOwner: lease.owner,
    fenceEpoch: lease.epoch,
    now: now(),
  });
  if (!fenced) throw new LeaseLostError("querying");

  // CAS-resume before incompatible live-checksum assertions — but never
  // complete directly: re-inspect, revalidate markers, recompute content.
  const existingDeliveryEarly = await loadReportingDelivery(runId);
  if (
    executionPackage.destination.strategy === "replace_tab" &&
    existingDeliveryEarly?.progress?.promotion_step === "rename_batch_submitted" &&
    existingDeliveryEarly.published_sheet_id != null &&
    existingDeliveryEarly.old_sheet_id != null
  ) {
    const recovered = await recoverRenameBatchSubmitted({
      runId,
      lease,
      now,
      sheets,
      run,
      executionPackage,
      delivery: existingDeliveryEarly,
      queryInput,
      expectedColumns,
      estimateKind,
      expectedRows,
    });
    return recovered;
  }

  const live = await getReportingDestinationPort().getValidatedSnapshot(
    executionPackage.destination.destinationId,
  );
  const destinationRecord = await getReportingDestinationById(
    executionPackage.destination.destinationId,
  );
  const destination = resolveDestinationForWorker({
    live,
    packaged: executionPackage.destination,
    predecessorSheetIds: extractPredecessorSheetIds(destinationRecord),
    casResumeInFlight: false,
  });

  try {
    // Snapshot destinations do not target an existing workbook, but a complete
    // operational-workbook registry is still required at the final pre-write
    // seam. Otherwise a newly missing registration could make the denylist
    // incomplete after the run was confirmed.
    operationalWorkbookRegistry.assertConfigurationComplete();
  } catch {
    await emitReportingDenylistUnavailable({});
    await failRun(runId, lease, now(), currentStatus(run), "DESTINATION_UNSAFE");
    return "failed";
  }

  if (destination.strategy === "replace_tab" && destination.workbook?.id) {
    const denylist = operationalWorkbookRegistry.evaluateReportingDestination(
      destination.workbook.id,
    );
    if (!denylist.allowed) {
      if (denylist.code === "DENYLIST_INCOMPLETE") {
        await emitReportingDenylistUnavailable({});
      }
      await failRun(runId, lease, now(), currentStatus(run), "DESTINATION_UNSAFE");
      return "failed";
    }
    await refreshDestinationHealthAndDenylist({
      destinationId: destination.destinationId,
      now: now(),
    });
  } else if (destination.strategy === "snapshot") {
    // Folder destinations still age health/denylist together on allow.
    await refreshDestinationHealthAndDenylist({
      destinationId: destination.destinationId,
      now: now(),
    });
  }

  let observedDestinationAvailableCells =
    destination.capacity.destinationAvailableCells;
  if (destination.strategy === "replace_tab" && destination.workbook?.id) {
    const listed = await sheets.listSheets(destination.workbook.id);
    let usedCells = 0;
    let resumableStagingCells = 0;
    for (const sheet of listed) {
      if (
        !Number.isSafeInteger(sheet.rowCount) ||
        !Number.isSafeInteger(sheet.columnCount)
      ) {
        await failRun(
          runId,
          lease,
          now(),
          currentStatus(run),
          "DESTINATION_CAPACITY_EXCEEDED",
          { limit: 0, count: expectedRows * expectedColumns },
        );
        return "failed";
      }
      const sheetCells = Number(sheet.rowCount) * Number(sheet.columnCount);
      usedCells += sheetCells;
      if (
        existingDeliveryEarly?.staging_sheet_id != null &&
        sheet.sheetId === Number(existingDeliveryEarly.staging_sheet_id)
      ) {
        resumableStagingCells = sheetCells;
      }
    }
    observedDestinationAvailableCells = Math.max(
      0,
      destination.capacity.providerMaxCells -
        usedCells +
        resumableStagingCells,
    );
    // Google creates a staging tab with a default 1000x26 grid before writes.
    if (
      existingDeliveryEarly?.staging_sheet_id == null &&
      observedDestinationAvailableCells < 26_000
    ) {
      await failRun(
        runId,
        lease,
        now(),
        currentStatus(run),
        "DESTINATION_CAPACITY_EXCEEDED",
        {
          limit: observedDestinationAvailableCells,
          count: 26_000,
        },
      );
      return "failed";
    }
  }

  const capacityCells = Math.min(
    destination.capacity.providerMaxCells,
    destination.capacity.destinationAvailableCells,
    observedDestinationAvailableCells,
  );
  const maxCapacityDataRows = maxCapacityDataRowsFromCells({
    capacityCells,
    columnCount: expectedColumns,
  });
  assertEstimateFitsCapacity(
    { kind: estimateKind, rows: expectedRows },
    expectedColumns,
    capacityCells,
  );

  if (await cancelIfRequested(runId, lease, now())) return "cancelled";

  let sourceReadThrough = run.source_read_through
    ? new Date(run.source_read_through).toISOString()
    : null;
  if (!sourceReadThrough) {
    const capturedAt = now();
    const queryPlanChecksum = computeQueryPlanChecksum({
      ...queryInput,
      destinationSnapshotChecksum: destination.snapshotChecksum,
      sourceReadThrough: capturedAt.toISOString(),
    });
    const captured = await captureReportingSourceReadThrough({
      runId,
      sourceReadThrough: capturedAt,
      queryPlanChecksum,
      leaseOwner: lease.owner,
      leaseEpoch: lease.epoch,
      now: now(),
    });
    if (!captured) {
      // Idempotent resume: another attempt may have captured already.
      const latest = await loadReportingRun(runId);
      if (latest?.source_read_through) {
        sourceReadThrough = new Date(latest.source_read_through).toISOString();
      } else {
        throw new LeaseLostError("querying");
      }
    } else {
      sourceReadThrough = capturedAt.toISOString();
    }
  }

  const statusNow = String((await loadReportingRun(runId))?.status ?? run.status);
  if (statusNow === "queued") {
    await requireTransition(
      {
        runId,
        expectedStatus: "queued",
        nextStatus: "querying",
        leaseOwner: lease.owner,
        leaseEpoch: lease.epoch,
        now: now(),
      },
      "querying",
    );
  }

  if (await cancelIfRequested(runId, lease, now())) return "cancelled";

  let manifest = await loadReportingCandidateManifest(runId);
  if (!manifest) {
    await requireLease(lease, runId, now(), "querying");
    manifest = await reportingStage4StreamV1.prepareManifest(
      { ...queryInput, sourceReadThrough },
      async (prepared) => {
        await persistReportingCandidateManifest({
          runId,
          manifest: prepared,
          now: now(),
        });
      },
    );
  }
  // Always fully validate persisted manifest on resume (even without checkpoint).
  await validatePersistedManifestForResume(manifest, sourceReadThrough);

  const existingDelivery = await loadReportingDelivery(runId);
  let runStatus = String((await loadReportingRun(runId))?.status ?? statusNow);
  // Phase-aware: skip write work when already verifying/promoting.
  const needsWriteWork = !isAtOrPast(runStatus, "verifying");

  await requireLease(lease, runId, now(), isAtOrPast(runStatus, "writing") ? "writing" : "querying");
  const artifact = await createOrResumeDeliveryArtifact({
    sheets,
    drive,
    runId,
    destinationId: destination.destinationId,
    strategy: destination.strategy,
    folderId: destination.folder.id,
    workbookId: destination.workbook?.id,
    workbookUrl: destination.workbook?.url,
    managedTab: destination.managedTab,
    existing: existingDelivery
      ? {
          workbookId: existingDelivery.workbook_id ?? undefined,
          workbookUrl: existingDelivery.workbook_url ?? undefined,
          stagingSheetId: existingDelivery.staging_sheet_id ?? undefined,
          stagingSheetTitle: existingDelivery.staging_sheet_title ?? undefined,
          oldSheetId: existingDelivery.old_sheet_id ?? null,
        }
      : null,
    onWorkbookCreated: async ({ workbookId, workbookUrl }) => {
      await requireDeliveryPatch(
        {
          runId,
          leaseOwner: lease.owner,
          leaseEpoch: lease.epoch,
          now: now(),
          set: { workbook_id: workbookId, workbook_url: workbookUrl },
        },
        "querying",
      );
    },
    onStagingCreated: async (created) => {
      await requireDeliveryPatch(
        {
          runId,
          leaseOwner: lease.owner,
          leaseEpoch: lease.epoch,
          now: now(),
          set: {
            workbook_id: created.workbookId,
            workbook_url: created.workbookUrl,
            staging_sheet_id: created.stagingSheetId,
            staging_sheet_title: created.stagingSheetTitle,
            old_sheet_id: created.oldSheetId,
          },
        },
        "querying",
      );
    },
  });
  await requireDeliveryPatch(
    {
      runId,
      leaseOwner: lease.owner,
      leaseEpoch: lease.epoch,
      now: now(),
      set: {
        workbook_id: artifact.workbookId,
        workbook_url: artifact.workbookUrl,
        staging_sheet_id: artifact.stagingSheetId,
        staging_sheet_title: artifact.stagingSheetTitle,
        old_sheet_id: artifact.oldSheetId,
      },
    },
    isAtOrPast(runStatus, "writing") ? "writing" : "querying",
  );

  if (await cancelIfRequested(runId, lease, now())) {
    await enqueueIncompleteArtifactCleanup({
      runId,
      artifactIds: [artifact.workbookId],
    });
    return "cancelled";
  }

  const deliveryProgress = await loadReportingDelivery(runId);
  let nextWriteRow = Number(deliveryProgress?.progress?.next_write_row ?? 1);
  let completedBatch = Number(
    deliveryProgress?.progress?.completed_batch_number ?? 0,
  );
  let rowsWritten = Number(deliveryProgress?.progress?.rows_written ?? 0);
  let cellsWritten = Number(deliveryProgress?.progress?.cells_written ?? 0);
  let providerRequests = Number(
    deliveryProgress?.progress?.provider_requests ?? 0,
  );
  let finalChecksum =
    typeof deliveryProgress?.expected?.data_checksum === "string"
      ? deliveryProgress.expected.data_checksum
      : typeof (await loadReportingRun(runId))?.final_data_checksum === "string"
        ? String((await loadReportingRun(runId))!.final_data_checksum)
        : "";

  if (needsWriteWork) {
    const latest = await loadReportingRun(runId);
    if (String(latest?.status) === "querying") {
      await requireTransition(
        {
          runId,
          expectedStatus: "querying",
          nextStatus: "writing",
          leaseOwner: lease.owner,
          leaseEpoch: lease.epoch,
          now: now(),
        },
        "writing",
      );
    }

    if (nextWriteRow === 1) {
      await requireLease(lease, runId, now(), "writing");
      const headerBatch = buildReportingWriteBatches({
        rows: [],
        columns,
        includeHeader: true,
      })[0]!;
      const written = await writeBoundedReportingBatch({
        sheets,
        artifact,
        startRow: 1,
        values: headerBatch,
        runId,
      });
      nextWriteRow = 2;
      cellsWritten += headerBatch[0]!.length;
      completedBatch += 1;
      providerRequests += 1;
      await requireDeliveryPatch(
        {
          runId,
          leaseOwner: lease.owner,
          leaseEpoch: lease.epoch,
          now: now(),
          set: {
            status: "writing",
            "progress.next_write_row": nextWriteRow,
            "progress.completed_batch_number": completedBatch,
            "progress.cells_written": cellsWritten,
            "progress.provider_requests": providerRequests,
            "progress.last_acknowledged_range": written.range,
          },
        },
        "writing",
      );
    }

    const initialStreamCheckpoint = streamCheckpointFromRun(latest ?? run);
    let writtenRowBaseline = initialStreamCheckpoint?.rowCount ?? 0;
    for await (const entry of reportingStage4StreamV1.stream(
      { ...queryInput, sourceReadThrough },
      manifest,
      initialStreamCheckpoint,
    )) {
      if (await cancelIfRequested(runId, lease, now())) {
        await enqueueIncompleteArtifactCleanup({
          runId,
          artifactIds: [artifact.workbookId],
        });
        return "cancelled";
      }
      await requireLease(lease, runId, now(), "writing");

      const expectedStartRow = 2 + writtenRowBaseline;
      const skipRows = Math.max(0, nextWriteRow - expectedStartRow);
      const remainingRows = (
        entry.page.rows as Array<Record<string, unknown>>
      ).slice(skipRows);

      const pageBatches = buildReportingWriteBatches({
        rows: remainingRows,
        columns,
        includeHeader: false,
      });
      for (const batch of pageBatches) {
        if (rowsWritten + batch.length > expectedRows) {
          throw reportingFailure("DESTINATION_CAPACITY_EXCEEDED", {
            phase: "writing",
            count: rowsWritten + batch.length,
            limit: expectedRows,
          });
        }
        await requireLease(lease, runId, now(), "writing");
        const written = await writeBoundedReportingBatch({
          sheets,
          artifact,
          startRow: nextWriteRow,
          values: batch,
          runId,
        });
        nextWriteRow += batch.length;
        rowsWritten += batch.length;
        cellsWritten += batch.length * columns.length;
        completedBatch += 1;
        providerRequests += 1;
        await requireDeliveryPatch(
          {
            runId,
            leaseOwner: lease.owner,
            leaseEpoch: lease.epoch,
            now: now(),
            set: {
              "progress.next_write_row": nextWriteRow,
              "progress.completed_batch_number": completedBatch,
              "progress.rows_written": rowsWritten,
              "progress.cells_written": cellsWritten,
              "progress.provider_requests": providerRequests,
              "progress.last_acknowledged_range": written.range,
            },
          },
          "writing",
        );
      }
      finalChecksum = entry.checkpoint.checksumAccumulator;
      writtenRowBaseline = entry.checkpoint.rowCount;
      await requireDeliveryPatch(
        {
          runId,
          leaseOwner: lease.owner,
          leaseEpoch: lease.epoch,
          now: now(),
          set: {
            "progress.last_stream_checkpoint": entry.checkpoint,
            "expected.data_checksum": finalChecksum,
          },
        },
        "writing",
      );
      await requireCheckpoint({
        runId,
        expectedStatus: "writing",
        leaseOwner: lease.owner,
        leaseEpoch: lease.epoch,
        now: now(),
        checkpoint: entry.checkpoint,
        counters: {
          rows_written: rowsWritten,
          cells_written: cellsWritten,
          provider_requests: providerRequests,
        },
      });
    }

    // Upper-bound: cells are actual (rowsWritten+1)*columns, not the estimate ceiling.
    const actualCellsIncludingHeader = (rowsWritten + 1) * expectedColumns;
    assertNoSilentTruncation({
      rowsWritten,
      expectedRows,
      estimateKind,
      cellsWritten: actualCellsIncludingHeader,
      expectedCells:
        estimateKind === "exact"
          ? expectedCells
          : actualCellsIncludingHeader,
    });
    cellsWritten = actualCellsIncludingHeader;

    if (!finalChecksum) {
      finalChecksum = initialChecksumAccumulator(
        { ...queryInput, sourceReadThrough },
        manifest,
      );
    }

    await requireTransition(
      {
        runId,
        expectedStatus: "writing",
        nextStatus: "verifying",
        leaseOwner: lease.owner,
        leaseEpoch: lease.epoch,
        now: now(),
        finalDataChecksum: finalChecksum,
        counters: { rows_written: rowsWritten, cells_written: cellsWritten },
      },
      "verifying",
    );
  } else {
    // Resume in verifying/promoting: reload authoritative progress.
    const progress = await loadReportingDelivery(runId);
    rowsWritten = Number(progress?.progress?.rows_written ?? rowsWritten);
    cellsWritten = Number(progress?.progress?.cells_written ?? cellsWritten);
    if (!finalChecksum) {
      finalChecksum = initialChecksumAccumulator(
        { ...queryInput, sourceReadThrough },
        manifest,
      );
    }
  }

  runStatus = String((await loadReportingRun(runId))?.status ?? runStatus);
  if (!isAtOrPast(runStatus, "promoting")) {
    await requireLease(lease, runId, now(), "verifying");
    const verified = await verifyStagingContents({
      sheets,
      artifact,
      columns,
      expectedRows,
      estimateKind,
      actualRowsWritten: rowsWritten,
      finalChecksum,
      runId,
      destinationId: destination.destinationId,
      queryInput: { ...queryInput, sourceReadThrough },
      manifest,
      maxCapacityDataRows,
    });
    if (!verified.matched) {
      await failRun(runId, lease, now(), "verifying", "VERIFICATION_MISMATCH", {
        count: verified.reasons.length,
      });
      if (destination.strategy === "snapshot") {
        await enqueueIncompleteArtifactCleanup({
          runId,
          artifactIds: [artifact.workbookId],
        });
      }
      return "failed";
    }
    rowsWritten = verified.actualRows;
    cellsWritten = verified.actualCells;

    await requireTransition(
      {
        runId,
        expectedStatus: "verifying",
        nextStatus: "promoting",
        leaseOwner: lease.owner,
        leaseEpoch: lease.epoch,
        now: now(),
      },
      "promoting",
    );
  }

  if (destination.strategy === "replace_tab") {
    await requireLease(lease, runId, now(), "promoting");
    const publishedTitle = destination.managedTab!.name;
    const contentVerification = {
      columns,
      expectedRows,
      estimateKind,
      actualRowsWritten: rowsWritten,
      finalChecksum,
      queryInput: { ...queryInput, sourceReadThrough },
      manifest,
      maxCapacityDataRows,
    };
    const promoted = await executeReplaceTabPromotion({
      runId,
      lease,
      now,
      sheets,
      artifact,
      destinationId: destination.destinationId,
      publishedTitle,
      contentVerification,
      rowsWritten,
      cellsWritten,
      expectedColumns,
      finalChecksum,
      columns,
      actor: run.actor,
      definitionId: executionPackage.definitionId,
      revisionId: executionPackage.revisionId,
    });
    return promoted;
  }

  await finishSnapshotDeliveryAndComplete({
    runId,
    lease,
    now,
    stagingSheetId: artifact.stagingSheetId,
    stagingSheetTitle: artifact.stagingSheetTitle,
    workbookUrl: artifact.workbookUrl,
    rowsWritten,
    cellsWritten,
    expectedColumns,
    finalChecksum,
    columns,
    actor: run.actor,
    definitionId: executionPackage.definitionId,
    revisionId: executionPackage.revisionId,
  });
  return "completed";
}

/**
 * Resume after Google rename was recorded but destination CAS / completion did
 * not finish. Never completes from promotion_step alone — re-inspects IDs,
 * revalidates markers, and recomputes content/count/checksum first.
 */
async function recoverRenameBatchSubmitted(input: {
  runId: string;
  lease: Lease;
  now: () => Date;
  sheets: ReportingSheetsAdapter;
  run: Record<string, any>;
  executionPackage: ReportingExecutionPackageV1;
  delivery: Record<string, any>;
  queryInput: ValidatedReportingRequest;
  expectedColumns: number;
  estimateKind: "exact" | "upper_bound";
  expectedRows: number;
}): Promise<string> {
  const {
    runId,
    lease,
    now,
    sheets,
    executionPackage,
    delivery,
    expectedColumns,
    estimateKind,
    expectedRows,
  } = input;
  const destinationId = executionPackage.destination.destinationId;
  const oldSheetId = Number(delivery.old_sheet_id);
  const publishedSheetId = Number(delivery.published_sheet_id);
  const publishedTitle =
    String(delivery.published_sheet_title ?? "") ||
    executionPackage.destination.managedTab!.name;
  const workbookId = String(delivery.workbook_id ?? "");
  const rowsWritten = Number(delivery.progress?.rows_written ?? 0);
  const finalChecksum = String(delivery.expected?.data_checksum ?? "");
  const columns = executionPackage.stream.selectedColumns;
  const sourceReadThrough = input.run.source_read_through
    ? new Date(input.run.source_read_through).toISOString()
    : "";

  if (!workbookId || !sourceReadThrough || !finalChecksum) {
    await failRun(runId, lease, now(), "promoting", "PROMOTION_AMBIGUOUS");
    return "failed";
  }

  await requireLease(lease, runId, now(), "promoting");

  const inspection = await inspectReplaceTabPromotion({
    sheets,
    spreadsheetId: workbookId,
    oldSheetId,
    stagingSheetId: publishedSheetId,
    publishedTitle,
  });
  if (inspection.state !== "already_promoted") {
    await failRun(runId, lease, now(), "promoting", "PROMOTION_AMBIGUOUS", {
      phase: "promoting",
    });
    return "failed";
  }

  try {
    await sheets.verifyOwnershipMarkerBySheetId({
      spreadsheetId: workbookId,
      sheetId: oldSheetId,
      destinationId,
    });
    const listed = await sheets.listSheets(workbookId);
    const published = listed.find((sheet) => sheet.sheetId === publishedSheetId);
    if (!published || published.title !== publishedTitle || published.hidden) {
      throw new Error("published_sheet_identity_mismatch");
    }
    await sheets.verifyOwnershipAndRunMarkers({
      spreadsheetId: workbookId,
      sheetTitle: published.title,
      destinationId,
      runId,
    });
  } catch {
    await failRun(runId, lease, now(), "promoting", "OWNERSHIP_MARKER_MISMATCH");
    return "failed";
  }

  const manifest = await loadReportingCandidateManifest(runId);
  if (!manifest) {
    await failRun(runId, lease, now(), "promoting", "INTERNAL_FAILURE");
    return "failed";
  }
  await validatePersistedManifestForResume(manifest, sourceReadThrough);

  const destinationRecord = await getReportingDestinationById(destinationId);
  const capacity = destinationRecord?.capacity as
    | { provider_max_cells?: number; destination_available_cells?: number }
    | undefined;
  const capacityCells = Math.min(
    Number(capacity?.provider_max_cells ?? 0),
    Number(capacity?.destination_available_cells ?? 0),
  );
  const maxCapacityDataRows = maxCapacityDataRowsFromCells({
    capacityCells,
    columnCount: expectedColumns,
  });

  const verified = await verifyStagingContents({
    sheets,
    artifact: {
      workbookId,
      workbookUrl: String(delivery.workbook_url ?? ""),
      stagingSheetId: publishedSheetId,
      stagingSheetTitle: publishedTitle,
      oldSheetId,
    },
    columns,
    expectedRows,
    estimateKind,
    actualRowsWritten: rowsWritten,
    finalChecksum,
    runId,
    destinationId,
    queryInput: { ...input.queryInput, sourceReadThrough },
    manifest,
    maxCapacityDataRows,
  });
  if (!verified.matched) {
    await failRun(runId, lease, now(), "promoting", "VERIFICATION_MISMATCH", {
      count: verified.reasons.length,
    });
    return "failed";
  }

  // Ensure reservation reflects provider-applied before atomic CAS.
  const runDoc = await loadReportingRun(runId);
  const prior = runDoc?.promotion_reservation as
    | ReportingPromotionReservation
    | null
    | undefined;
  if (!prior || prior.generation !== lease.epoch) {
    const reserved = await writePromotionReservationUnderLease({
      runId,
      leaseOwner: lease.owner,
      leaseEpoch: lease.epoch,
      now: now(),
      expectedPriorGeneration: prior?.generation ?? null,
      reservation: {
        workbook_id: workbookId,
        staging_sheet_id: publishedSheetId,
        old_sheet_id: oldSheetId,
        published_title: publishedTitle,
        status: "provider_applied",
        recovery_title: String(delivery.old_sheet_recovery_title ?? null),
        published_sheet_id: publishedSheetId,
      },
    });
    if (!reserved) throw new LeaseLostError("promoting");
  }

  await finishDestinationCasAndComplete({
    runId,
    lease,
    now,
    destinationId,
    oldSheetId,
    publishedSheetId,
    publishedTitle,
    rowsWritten: verified.actualRows,
    cellsWritten: verified.actualCells,
    expectedColumns,
    finalChecksum,
    artifactUrl: String(delivery.workbook_url ?? ""),
    columns,
    actor: input.run.actor,
    definitionId: executionPackage.definitionId,
    revisionId: executionPackage.revisionId,
  });
  return "completed";
}

/**
 * Reserve under lease → provider mutate → renew → atomic CAS+complete.
 * Stale lease after Google response abandons CAS for the current recovery path.
 */
async function executeReplaceTabPromotion(input: {
  runId: string;
  lease: Lease;
  now: () => Date;
  sheets: ReportingSheetsAdapter;
  artifact: {
    workbookId: string;
    workbookUrl: string;
    stagingSheetId: number;
    stagingSheetTitle: string;
    oldSheetId: number | null;
  };
  destinationId: string;
  publishedTitle: string;
  contentVerification: {
    columns: Array<{ id: string; label: string }>;
    expectedRows: number;
    estimateKind: "exact" | "upper_bound";
    actualRowsWritten: number;
    finalChecksum: string;
    queryInput: ValidatedReportingRequest;
    manifest: NonNullable<Awaited<ReturnType<typeof loadReportingCandidateManifest>>>;
    maxCapacityDataRows: number;
  };
  rowsWritten: number;
  cellsWritten: number;
  expectedColumns: number;
  finalChecksum: string;
  columns: Array<{ id: string; label: string }>;
  actor: any;
  definitionId: string;
  revisionId: string;
}): Promise<string> {
  const { runId, lease, now, sheets, artifact } = input;
  const oldSheetId = artifact.oldSheetId;
  if (oldSheetId === null) {
    await failAmbiguousPromotion(runId, lease, now);
    return "failed";
  }

  const inspection = await inspectReplaceTabPromotion({
    sheets,
    spreadsheetId: artifact.workbookId,
    oldSheetId,
    stagingSheetId: artifact.stagingSheetId,
    publishedTitle: input.publishedTitle,
  });
  const runDoc = await loadReportingRun(runId);
  const prior = runDoc?.promotion_reservation as
    | ReportingPromotionReservation
    | null
    | undefined;
  const plan = planPromotionRecovery({
    leaseOwner: lease.owner,
    leaseEpoch: lease.epoch,
    reservation: prior,
    inspection,
  });

  if (plan.action === "fail_ambiguous") {
    await failAmbiguousPromotion(runId, lease, now);
    return "failed";
  }

  let skipProvider = false;
  let recoveryTitle: string | null =
    prior?.recovery_title ??
    recoveryTabTitle({
      publishedTitle: input.publishedTitle,
      runId,
      now: now(),
    });
  let publishedSheetId = artifact.stagingSheetId;

  if (plan.action === "complete_cas_only") {
    skipProvider = true;
    recoveryTitle = plan.reservation.recovery_title ?? recoveryTitle;
    publishedSheetId =
      plan.reservation.published_sheet_id ?? artifact.stagingSheetId;
  } else if (
    plan.action === "recover_already_applied" ||
    plan.action === "adopt_already_promoted"
  ) {
    skipProvider = true;
    const expectedPrior =
      plan.action === "recover_already_applied"
        ? plan.prior?.generation ?? null
        : null;
    const reserved = await writePromotionReservationUnderLease({
      runId,
      leaseOwner: lease.owner,
      leaseEpoch: lease.epoch,
      now: now(),
      expectedPriorGeneration: expectedPrior,
      reservation: {
        workbook_id: artifact.workbookId,
        staging_sheet_id: artifact.stagingSheetId,
        old_sheet_id: oldSheetId,
        published_title: input.publishedTitle,
        status: "provider_applied",
        recovery_title: recoveryTitle,
        published_sheet_id: artifact.stagingSheetId,
      },
    });
    if (!reserved) throw new LeaseLostError("promoting");
  } else {
    const expectedPrior =
      plan.action === "takeover_and_promote"
        ? plan.prior.generation
        : plan.action === "reuse_own_reservation"
          ? lease.epoch
          : null;
    const reserved = await writePromotionReservationUnderLease({
      runId,
      leaseOwner: lease.owner,
      leaseEpoch: lease.epoch,
      now: now(),
      expectedPriorGeneration:
        plan.action === "reuse_own_reservation" ? lease.epoch : expectedPrior,
      reservation: {
        workbook_id: artifact.workbookId,
        staging_sheet_id: artifact.stagingSheetId,
        old_sheet_id: oldSheetId,
        published_title: input.publishedTitle,
        status: "reserved",
        recovery_title: recoveryTitle,
        published_sheet_id: null,
      },
    });
    if (!reserved) throw new LeaseLostError("promoting");
  }

  if (!skipProvider) {
    // Expiry before provider call: renew must succeed under active lease.
    const heldBefore = await renewReportingRunLease({
      runId,
      owner: lease.owner,
      epoch: lease.epoch,
      now: now(),
      ttlMs: LEASE_TTL_MS,
    });
    if (!heldBefore) throw new LeaseLostError("promoting");

    const promotion = await promoteOrRecoverReplaceTab({
      sheets,
      artifact,
      publishedTitle: input.publishedTitle,
      destinationId: input.destinationId,
      runId,
      now: now(),
      contentVerification: input.contentVerification,
    });
    if (promotion.outcome === "ambiguous") {
      await failAmbiguousPromotion(runId, lease, now);
      return "failed";
    }
    recoveryTitle = promotion.recoveryTitle;
    publishedSheetId = promotion.publishedSheetId;

    // After provider response: re-check/renew; never destination-CAS from stale epoch.
    const heldAfter = await renewReportingRunLease({
      runId,
      owner: lease.owner,
      epoch: lease.epoch,
      now: now(),
      ttlMs: LEASE_TTL_MS,
    });
    if (!heldAfter) {
      // Leave Google state for the current worker's full recovery path.
      throw new LeaseLostError("promoting");
    }

    const marked = await markPromotionReservationProviderApplied({
      runId,
      leaseOwner: lease.owner,
      leaseEpoch: lease.epoch,
      now: now(),
      recoveryTitle,
      publishedSheetId,
    });
    if (!marked) throw new LeaseLostError("promoting");
  }

  await requireDeliveryPatch(
    {
      runId,
      leaseOwner: lease.owner,
      leaseEpoch: lease.epoch,
      now: now(),
      set: {
        "progress.promotion_step": "rename_batch_submitted",
        old_sheet_recovery_title: recoveryTitle,
        published_sheet_id: publishedSheetId,
        published_sheet_title: input.publishedTitle,
        old_sheet_id: oldSheetId,
      },
    },
    "promoting",
  );

  await finishDestinationCasAndComplete({
    runId,
    lease,
    now,
    destinationId: input.destinationId,
    oldSheetId,
    publishedSheetId,
    publishedTitle: input.publishedTitle,
    rowsWritten: input.rowsWritten,
    cellsWritten: input.cellsWritten,
    expectedColumns: input.expectedColumns,
    finalChecksum: input.finalChecksum,
    artifactUrl: artifact.workbookUrl,
    columns: input.columns,
    actor: input.actor,
    definitionId: input.definitionId,
    revisionId: input.revisionId,
  });
  return "completed";
}

async function failAmbiguousPromotion(
  runId: string,
  lease: Lease,
  now: () => Date,
): Promise<void> {
  await requireDeliveryPatch(
    {
      runId,
      leaseOwner: lease.owner,
      leaseEpoch: lease.epoch,
      now: now(),
      set: {
        "progress.promotion_step": "ambiguous",
        failure: reportingFailure("PROMOTION_AMBIGUOUS", {
          phase: "promoting",
        }),
      },
    },
    "promoting",
  );
  await failRun(runId, lease, now(), "promoting", "PROMOTION_AMBIGUOUS");
}

async function finishDestinationCasAndComplete(input: {
  runId: string;
  lease: Lease;
  now: () => Date;
  destinationId: string;
  oldSheetId: number;
  publishedSheetId: number;
  publishedTitle: string;
  rowsWritten: number;
  cellsWritten: number;
  expectedColumns: number;
  finalChecksum: string;
  artifactUrl: string;
  columns: Array<{ id: string; label: string }>;
  actor: any;
  definitionId: string;
  revisionId: string;
}): Promise<void> {
  const deliverySet = {
    "progress.promotion_step": "destination_updated",
    status: "completed",
    completed_at: input.now(),
    workbook_url: input.artifactUrl,
    published_sheet_id: input.publishedSheetId,
    published_sheet_title: input.publishedTitle,
    old_sheet_id: input.oldSheetId,
    "actual.rows": input.rowsWritten,
    "actual.columns": input.expectedColumns,
    "actual.cells_including_header": input.cellsWritten,
    "actual.header_labels": serializeReportingHeaderCells(input.columns),
    "actual.data_checksum": input.finalChecksum,
    "verification.matched": true,
    "verification.checked_at": input.now(),
    "verification.reasons": [],
  };

  let committed = false;
  for (let attempt = 1; attempt <= PROMOTION_CAS_TX_ATTEMPTS; attempt += 1) {
    await requireLease(input.lease, input.runId, input.now(), "promoting");
    const destination = await getReportingDestinationById(input.destinationId);
    if (!destination) {
      throw reportingFailure("PROMOTION_AMBIGUOUS", { phase: "promoting" });
    }
    const expectedDestinationVersion = Number(destination.version);
    try {
      const outcome = await commitPromotionDestinationCas({
        runId: input.runId,
        leaseOwner: input.lease.owner,
        leaseEpoch: input.lease.epoch,
        now: input.now(),
        reservationGeneration: input.lease.epoch,
        destinationId: input.destinationId,
        expectedOldSheetId: input.oldSheetId,
        expectedDestinationVersion,
        nextSheetId: input.publishedSheetId,
        publishedTitle: input.publishedTitle,
        deliverySet: {
          ...deliverySet,
          completed_at: input.now(),
          "verification.checked_at": input.now(),
        },
        finalDataChecksum: input.finalChecksum,
      });
      if (outcome === "stale") {
        // True conditional stale (lease/fence/reservation/version). Leave Google
        // + durable promoting state for takeover/recovery — never terminal-fail.
        throw new LeaseLostError("promoting");
      }
      committed = true;
      break;
    } catch (error) {
      if (error instanceof LeaseLostError) throw error;
      if (
        isTransientPromotionTransactionError(error) &&
        attempt < PROMOTION_CAS_TX_ATTEMPTS
      ) {
        continue;
      }
      if (isTransientPromotionTransactionError(error)) {
        // Exhausted bounded retries — retryable abandon, not terminal fail.
        throw new LeaseLostError("promoting");
      }
      throw error;
    }
  }
  if (!committed) throw new LeaseLostError("promoting");

  await recordReportingAudit({
    action: "delivery_complete",
    outcome: "success",
    actor: input.actor,
    durationMs: 0,
    runId: input.runId,
    definitionId: input.definitionId,
    revisionId: input.revisionId,
    checksum: input.finalChecksum,
    rowCount: input.rowsWritten,
  });
}

async function finishSnapshotDeliveryAndComplete(input: {
  runId: string;
  lease: Lease;
  now: () => Date;
  stagingSheetId: number;
  stagingSheetTitle: string;
  workbookUrl: string;
  rowsWritten: number;
  cellsWritten: number;
  expectedColumns: number;
  finalChecksum: string;
  columns: Array<{ id: string; label: string }>;
  actor: any;
  definitionId: string;
  revisionId: string;
}): Promise<void> {
  const deliverySet = {
    "progress.promotion_step": "verified_published",
    published_sheet_id: input.stagingSheetId,
    published_sheet_title: input.stagingSheetTitle,
    workbook_url: input.workbookUrl,
    "actual.rows": input.rowsWritten,
    "actual.columns": input.expectedColumns,
    "actual.cells_including_header": input.cellsWritten,
    "actual.header_labels": serializeReportingHeaderCells(input.columns),
    "actual.data_checksum": input.finalChecksum,
    "verification.matched": true,
    "verification.checked_at": input.now(),
    "verification.reasons": [],
  };

  for (let attempt = 1; attempt <= SNAPSHOT_COMPLETION_TX_ATTEMPTS; attempt += 1) {
    await requireLease(input.lease, input.runId, input.now(), "promoting");
    try {
      const outcome = await commitSnapshotDeliveryAndRunCompletion({
        runId: input.runId,
        leaseOwner: input.lease.owner,
        leaseEpoch: input.lease.epoch,
        now: input.now(),
        deliverySet: {
          ...deliverySet,
          "verification.checked_at": input.now(),
        },
        finalDataChecksum: input.finalChecksum,
      });
      if (outcome === "stale") {
        throw new LeaseLostError("promoting");
      }
      break;
    } catch (error) {
      if (error instanceof LeaseLostError) throw error;
      if (
        isTransientPromotionTransactionError(error) &&
        attempt < SNAPSHOT_COMPLETION_TX_ATTEMPTS
      ) {
        continue;
      }
      if (isTransientPromotionTransactionError(error)) {
        throw new LeaseLostError("promoting");
      }
      throw error;
    }
  }

  await recordReportingAudit({
    action: "delivery_complete",
    outcome: "success",
    actor: input.actor,
    durationMs: 0,
    runId: input.runId,
    definitionId: input.definitionId,
    revisionId: input.revisionId,
    checksum: input.finalChecksum,
    rowCount: input.rowsWritten,
  });
}

async function cancelIfRequested(
  runId: string,
  lease: Lease,
  now: Date,
): Promise<boolean> {
  const run = await loadReportingRun(runId);
  if (!run?.cancellation_requested_at) return false;
  if (String(run.status) === "promoting") return false;
  const status = String(run.status);
  if (
    status !== "queued" &&
    status !== "querying" &&
    status !== "writing" &&
    status !== "verifying"
  ) {
    return false;
  }
  const cancelled = await applyReportingRunCancellationAtSafePoint({
    runId,
    leaseOwner: lease.owner,
    leaseEpoch: lease.epoch,
    now,
    expectedStatus: status,
  });
  if (!cancelled) {
    // Lease lost or race — abort further Google work.
    const latest = await loadReportingRun(runId);
    if (String(latest?.status) === "cancelled") return true;
    throw new LeaseLostError(
      status === "queued" ? "querying" : (status as any),
    );
  }
  await patchReportingDeliveryFenced({
    runId,
    leaseOwner: lease.owner,
    leaseEpoch: lease.epoch,
    now,
    set: {
      status: "cancelled",
      failure: reportingFailure("RUN_CANCELLED", {
        phase: status === "queued" ? "querying" : status,
      }),
    },
  }).catch(() => false);
  return true;
}

async function failRun(
  runId: string,
  lease: Lease,
  now: Date,
  expectedStatus: any,
  code: Parameters<typeof reportingFailure>[0],
  metadata: Parameters<typeof reportingFailure>[1] = {},
) {
  const failure = reportingFailure(code, metadata);
  const runDoc = await loadReportingRun(runId);
  const transitioned = await transitionReportingRun({
    runId,
    expectedStatus,
    nextStatus: "failed",
    leaseOwner: lease.owner,
    leaseEpoch: lease.epoch,
    now,
    failure,
  });
  if (!transitioned) throw new LeaseLostError(
    expectedStatus === "queued" ? "querying" : expectedStatus,
  );
  await requireDeliveryPatch(
    {
      runId,
      leaseOwner: lease.owner,
      leaseEpoch: lease.epoch,
      now,
      set: { status: "failed", failure },
    },
    expectedStatus === "queued" ? "querying" : expectedStatus,
  );
  await emitObservabilityForReportingFailure({
    runId,
    code,
    metadata,
    phase:
      metadata.phase ??
      (expectedStatus === "queued" ? "querying" : expectedStatus),
  });
  if (runDoc && String(runDoc.trigger) === "manual" && runDoc.actor) {
    const executionPackage = runDoc.execution_package as ReportingExecutionPackageV1 | undefined;
    await recordReportingAudit({
      action: "delivery_failed",
      outcome: "failure",
      actor: runDoc.actor,
      durationMs: 0,
      runId,
      definitionId: executionPackage?.definitionId,
      revisionId: executionPackage?.revisionId,
      reasonCode: code,
    }).catch(() => undefined);
  }
}

async function emitObservabilityForReportingFailure(input: {
  runId: string;
  code: Parameters<typeof reportingFailure>[0];
  metadata: Parameters<typeof reportingFailure>[1];
  phase: string;
}): Promise<void> {
  const metadata = input.metadata ?? {};
  switch (input.code) {
    case "VERIFICATION_MISMATCH":
      await emitReportingVerificationMismatch({
        runId: input.runId,
        reasons: [input.phase],
      });
      break;
    case "PROMOTION_AMBIGUOUS":
      await emitReportingPromotionAmbiguous({ runId: input.runId });
      break;
    case "PROVIDER_UNAVAILABLE":
      await emitReportingRetryExhausted({
        runId: input.runId,
        phase: input.phase,
        providerRetries: Number(metadata.attempt ?? 0),
      });
      break;
    case "DESTINATION_CAPACITY_EXCEEDED":
      await emitReportingCapacityDivergence({
        runId: input.runId,
        expectedCells: Number(metadata.limit ?? 0),
        observedCells: Number(metadata.count ?? 0),
      });
      break;
    default:
      break;
  }
}

function currentStatus(run: Record<string, any>) {
  return String(run.status) as any;
}

function inferPhase(
  run: Record<string, any>,
): "querying" | "writing" | "verifying" | "promoting" {
  const status = String(run.status);
  if (
    status === "writing" ||
    status === "verifying" ||
    status === "promoting" ||
    status === "querying"
  ) {
    return status;
  }
  return "querying";
}

function toFailure(
  error: unknown,
  phase: "querying" | "writing" | "verifying" | "promoting",
): ReportingSafeFailureEnvelope {
  if (error instanceof LeaseLostError) return error.envelope;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    [
      "CANONICAL_SOURCE_CHANGED",
      "DESTINATION_CAPACITY_EXCEEDED",
      "DESTINATION_UNSAFE",
      "VERIFICATION_MISMATCH",
      "PROMOTION_AMBIGUOUS",
      "LEASE_LOST",
      "RUN_CANCELLED",
      "HEADER_OR_CURSOR_DRIFT",
      "OWNERSHIP_MARKER_MISMATCH",
      "PROVIDER_UNAVAILABLE",
      "PROVIDER_AUTHENTICATION",
      "PROVIDER_AUTHORIZATION",
      "INTERNAL_FAILURE",
    ].includes((error as { code: string }).code)
  ) {
    try {
      if (
        "summary" in (error as object) &&
        "retryable" in (error as object)
      ) {
        return error as ReportingSafeFailureEnvelope;
      }
      return reportingFailure(
        (error as { code: Parameters<typeof reportingFailure>[0] }).code,
        { phase },
      );
    } catch {
      // fall through
    }
  }
  const sanitized = sanitizeReportingProviderFailure(error);
  if (sanitized.failure_class === "authentication") {
    return reportingFailure("PROVIDER_AUTHENTICATION", {
      phase,
      ...(sanitized.provider_status !== undefined
        ? { provider_status: sanitized.provider_status }
        : {}),
    });
  }
  if (sanitized.failure_class === "authorization") {
    return reportingFailure("PROVIDER_AUTHORIZATION", {
      phase,
      ...(sanitized.provider_status !== undefined
        ? { provider_status: sanitized.provider_status }
        : {}),
    });
  }
  if (sanitized.retryable) {
    return reportingFailure("PROVIDER_UNAVAILABLE", {
      phase,
      ...(sanitized.provider_status !== undefined
        ? { provider_status: sanitized.provider_status }
        : {}),
    });
  }
  return reportingFailure("INTERNAL_FAILURE", { phase });
}
