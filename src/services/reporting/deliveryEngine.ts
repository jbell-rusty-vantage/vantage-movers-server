import { computeChecksum } from "../durableWork";
import { REPORTING_PAGE_SIZE } from "../../config/domain/reporting";
import type {
  ReportingCandidateManifestV1,
  ReportingStreamCheckpointV1,
  SelectedColumn,
  ValidatedReportingRequest,
} from "./catalog";
import {
  serializeReportingHeaderCells,
  serializeReportingRowCells,
  type LiteralCell,
} from "./google/cellSerialization";
import type { ReportingDriveAdapter } from "./google/reportingDriveAdapter";
import {
  REPORTING_VALUE_INPUT_OPTION,
  REPORTING_WRITE_BATCH_ROWS,
  type ReportingSheetsAdapter,
} from "./google/reportingSheetsAdapter";
import { sanitizeReportingProviderFailure } from "./google/providerFailures";
import {
  advanceChecksumAccumulator,
  initialChecksumAccumulator,
  validateCompleteManifestBatched,
} from "./executionStream";
import { validateReportingManifestEntries } from "./query/canonicalReporting";
import {
  inspectReplaceTabPromotion,
  recoveryTabTitle,
  stagingTabTitle,
} from "./promotion";

export type DeliveryArtifact = {
  workbookId: string;
  workbookUrl: string;
  stagingSheetId: number;
  stagingSheetTitle: string;
  oldSheetId: number | null;
};

export type DeliveryWriteProgress = {
  nextWriteRow: number;
  completedBatchNumber: number;
  rowsWritten: number;
  cellsWritten: number;
  providerRequests: number;
  providerRetries: number;
  lastAcknowledgedRange: string | null;
  lastStreamCheckpoint: ReportingStreamCheckpointV1 | null;
  finalChecksum: string | null;
};

/**
 * Create or resume exactly one positively run-marked artifact.
 * Persists workbook ID before markers/content via onWorkbookCreated.
 */
export async function createOrResumeDeliveryArtifact(input: {
  sheets: ReportingSheetsAdapter;
  drive: ReportingDriveAdapter;
  runId: string;
  destinationId: string;
  strategy: "replace_tab" | "snapshot";
  folderId: string;
  workbookId?: string;
  workbookUrl?: string;
  managedTab?: { immutableSheetId: number; name: string };
  existing?: Partial<DeliveryArtifact> | null;
  onWorkbookCreated?: (artifact: {
    workbookId: string;
    workbookUrl: string;
  }) => Promise<void>;
  onStagingCreated?: (artifact: DeliveryArtifact) => Promise<void>;
}): Promise<DeliveryArtifact> {
  if (
    input.existing?.workbookId &&
    input.existing.stagingSheetId !== undefined &&
    input.existing.stagingSheetId !== null
  ) {
    // Resolve by immutable sheet ID — never depend on a stale staging title
    // after Google rename / promotion.
    const listed = await input.sheets.listSheets(input.existing.workbookId);
    const byId = listed.find(
      (sheet) => sheet.sheetId === input.existing!.stagingSheetId,
    );
    if (byId) {
      try {
        await input.sheets.verifyOwnershipAndRunMarkers({
          spreadsheetId: input.existing.workbookId,
          sheetTitle: byId.title,
          destinationId: input.destinationId,
          runId: input.runId,
        });
        return {
          workbookId: input.existing.workbookId,
          workbookUrl: input.existing.workbookUrl ?? "",
          stagingSheetId: byId.sheetId,
          stagingSheetTitle: byId.title,
          oldSheetId: input.existing.oldSheetId ?? null,
        };
      } catch {
        // Title may have become the published name after promotion; still
        // return ID-resolved artifact so caller can enter already-promoted recovery.
        if (
          input.strategy === "replace_tab" &&
          input.managedTab &&
          input.existing.oldSheetId != null
        ) {
          const inspection = await inspectReplaceTabPromotion({
            sheets: input.sheets,
            spreadsheetId: input.existing.workbookId,
            oldSheetId: input.existing.oldSheetId,
            stagingSheetId: byId.sheetId,
            publishedTitle: input.managedTab.name,
          });
          if (inspection.state === "already_promoted") {
            return {
              workbookId: input.existing.workbookId,
              workbookUrl: input.existing.workbookUrl ?? "",
              stagingSheetId: byId.sheetId,
              stagingSheetTitle: byId.title,
              oldSheetId: input.existing.oldSheetId,
            };
          }
        }
        // Fall through to run-marker scan / recreate paths.
      }
    }
  }

  if (input.strategy === "snapshot") {
    let workbookId = input.existing?.workbookId;
    let workbookUrl = input.existing?.workbookUrl ?? "";
    if (!workbookId) {
      const created = await input.drive.createSpreadsheet({
        title: `Report ${input.runId.slice(-8)} ${new Date().toISOString()}`,
        folderId: input.folderId,
        runId: input.runId,
        destinationId: input.destinationId,
        role: "snapshot",
      });
      workbookId = created.spreadsheetId;
      workbookUrl = created.spreadsheetUrl;
      // Persist before markers/content so crash recovery can resume.
      await input.onWorkbookCreated?.({ workbookId, workbookUrl });
    }

    const existingMarked = await input.sheets.findSheetByRunMarker({
      spreadsheetId: workbookId,
      destinationId: input.destinationId,
      runId: input.runId,
    });
    if (existingMarked) {
      const artifact = {
        workbookId,
        workbookUrl,
        stagingSheetId: existingMarked.sheetId,
        stagingSheetTitle: existingMarked.title,
        oldSheetId: null,
      };
      await input.onStagingCreated?.(artifact);
      return artifact;
    }

    const staging = await input.sheets.createHiddenStagingTab({
      spreadsheetId: workbookId,
      title: `report_${input.runId.slice(-8)}`,
      destinationId: input.destinationId,
      runId: input.runId,
      strategy: "snapshot",
    });
    await input.sheets.hideSheet({
      spreadsheetId: workbookId,
      sheetId: staging.sheetId,
      hidden: false,
    });
    const artifact = {
      workbookId,
      workbookUrl,
      stagingSheetId: staging.sheetId,
      stagingSheetTitle: staging.title,
      oldSheetId: null,
    };
    await input.onStagingCreated?.(artifact);
    return artifact;
  }

  const workbookId = input.workbookId!;
  const publishedTitle = input.managedTab!.name;
  const oldSheetId = input.managedTab!.immutableSheetId;

  // Requirement (5): verify old published tab before staging.
  await input.sheets.verifyPublishedManagedTab({
    spreadsheetId: workbookId,
    immutableSheetId: oldSheetId,
    publishedTitle,
    destinationId: input.destinationId,
  });

  const existingMarked = await input.sheets.findSheetByRunMarker({
    spreadsheetId: workbookId,
    destinationId: input.destinationId,
    runId: input.runId,
  });
  if (existingMarked) {
    const artifact = {
      workbookId,
      workbookUrl: input.workbookUrl ?? "",
      stagingSheetId: existingMarked.sheetId,
      stagingSheetTitle: existingMarked.title,
      oldSheetId,
    };
    await input.onStagingCreated?.(artifact);
    return artifact;
  }

  const staging = await input.sheets.createHiddenStagingTab({
    spreadsheetId: workbookId,
    title: stagingTabTitle({ publishedTitle, runId: input.runId }),
    destinationId: input.destinationId,
    runId: input.runId,
    strategy: "replace_tab",
  });
  const artifact = {
    workbookId,
    workbookUrl: input.workbookUrl ?? "",
    stagingSheetId: staging.sheetId,
    stagingSheetTitle: staging.title,
    oldSheetId,
  };
  await input.onStagingCreated?.(artifact);
  return artifact;
}

export async function writeBoundedReportingBatch(input: {
  sheets: ReportingSheetsAdapter;
  artifact: DeliveryArtifact;
  startRow: number;
  values: LiteralCell[][];
}): Promise<{
  range: string;
  valueInputOption: typeof REPORTING_VALUE_INPUT_OPTION;
  updatedRows: number;
  updatedCells: number;
}> {
  const write = {
    spreadsheetId: input.artifact.workbookId,
    sheetTitle: input.artifact.stagingSheetTitle,
    startRow: input.startRow,
    startCol: 1,
    values: input.values,
  };
  try {
    const result = await input.sheets.writeValuesRaw(write);
    return {
      range: result.range,
      valueInputOption: result.valueInputOption,
      updatedRows: result.updatedRows,
      updatedCells: result.updatedCells,
    };
  } catch (error) {
    const sanitized = sanitizeReportingProviderFailure(error);
    if (!sanitized.retryable) throw error;
    const verified = await input.sheets.verifyRange(write);
    if (verified.matched) {
      return {
        range: `replay:${write.sheetTitle}:${write.startRow}`,
        valueInputOption: REPORTING_VALUE_INPUT_OPTION,
        updatedRows: write.values.length,
        updatedCells: write.values.reduce((sum, row) => sum + row.length, 0),
      };
    }
    const replayed = await input.sheets.writeValuesRaw(write);
    return {
      range: replayed.range,
      valueInputOption: replayed.valueInputOption,
      updatedRows: replayed.updatedRows,
      updatedCells: replayed.updatedCells,
    };
  }
}

export function buildReportingWriteBatches(input: {
  rows: Array<Record<string, unknown>>;
  columns: ReadonlyArray<SelectedColumn>;
  includeHeader: boolean;
}): LiteralCell[][][] {
  const batches: LiteralCell[][][] = [];
  let current: LiteralCell[][] = [];
  if (input.includeHeader) {
    current.push(serializeReportingHeaderCells(input.columns));
  }
  for (const row of input.rows) {
    if (current.length >= REPORTING_WRITE_BATCH_ROWS) {
      batches.push(current);
      current = [];
    }
    current.push(serializeReportingRowCells(row, input.columns));
  }
  if (current.length) batches.push(current);
  return batches;
}

function rowHasManagedValue(row: ReadonlyArray<LiteralCell | null | undefined>): boolean {
  return row.some((cell) => cell !== null && cell !== undefined && cell !== "");
}

/** Bounded trailing-probe chunk; never sized from upper-bound estimates. */
export const REPORTING_VERIFY_SCAN_CHUNK_ROWS = REPORTING_WRITE_BATCH_ROWS;

/**
 * Pure/read-only Sheets used-range verification. Never clears or trims cells.
 * Reads the claimed used range plus bounded trailing probes capped by capacity —
 * never sized from upper-bound estimate headroom.
 */
export async function verifyStagingContents(input: {
  sheets: ReportingSheetsAdapter;
  artifact: DeliveryArtifact;
  columns: ReadonlyArray<SelectedColumn>;
  /** Estimate rows (exact target or upper bound) — contract only, not read sizing. */
  expectedRows: number;
  estimateKind: "exact" | "upper_bound";
  /** Authoritative rows written by the worker (not the estimate). */
  actualRowsWritten: number;
  finalChecksum: string;
  runId: string;
  destinationId: string;
  queryInput: ValidatedReportingRequest;
  manifest: ReportingCandidateManifestV1;
  pageSize?: number;
  /**
   * Max data rows allowed by destination/provider capacity (excluding header).
   * Caps trailing scans; must not be the estimate upper bound.
   */
  maxCapacityDataRows: number;
}): Promise<{
  matched: boolean;
  reasons: string[];
  recomputedChecksum: string | null;
  actualRows: number;
  actualCells: number;
  derivedUsedRows: number;
}> {
  const reasons: string[] = [];
  const pageSize = input.pageSize ?? REPORTING_PAGE_SIZE;
  const expectedHeaders = serializeReportingHeaderCells(input.columns);
  const claimedRows = input.actualRowsWritten;
  const columnCount = input.columns.length;
  const sheetTitle = await resolveCurrentSheetTitle(
    input.sheets,
    input.artifact.workbookId,
    input.artifact.stagingSheetId,
    input.artifact.stagingSheetTitle,
  );

  await input.sheets.verifyOwnershipAndRunMarkers({
    spreadsheetId: input.artifact.workbookId,
    sheetTitle,
    destinationId: input.destinationId,
    runId: input.runId,
  });

  if (claimedRows < 0 || !Number.isSafeInteger(claimedRows)) {
    reasons.push("invalid_actual_rows");
  }
  if (
    !Number.isSafeInteger(input.maxCapacityDataRows) ||
    input.maxCapacityDataRows < 0
  ) {
    reasons.push("invalid_capacity_cap");
  }
  if (input.estimateKind === "exact" && claimedRows !== input.expectedRows) {
    reasons.push("row_count_mismatch");
  }
  if (
    input.estimateKind === "upper_bound" &&
    claimedRows > input.expectedRows
  ) {
    reasons.push("row_count_exceeds_upper_bound");
  }
  if (claimedRows > input.maxCapacityDataRows) {
    reasons.push("row_count_exceeds_capacity");
  }

  // Claimed used range only — never pad through estimate headroom.
  const claimedEndSheetRow = Math.max(claimedRows, 0) + 1;
  const claimedRead = await input.sheets.readValues({
    spreadsheetId: input.artifact.workbookId,
    sheetTitle,
    startRow: 1,
    startCol: 1,
    endRow: Math.max(claimedEndSheetRow, 1),
    endCol: columnCount,
  });

  const headers = claimedRead[0] ?? [];
  if (
    headers.length !== expectedHeaders.length ||
    headers.some((cell, index) => cell !== expectedHeaders[index])
  ) {
    reasons.push("header_mismatch");
  }

  const claimedData = claimedRead.slice(1, claimedEndSheetRow);
  let derivedUsedRows = 0;
  for (let index = 0; index < claimedData.length; index += 1) {
    if (rowHasManagedValue(claimedData[index] ?? [])) {
      derivedUsedRows = index + 1;
    }
  }
  if (derivedUsedRows !== claimedRows) {
    reasons.push("read_back_row_count_mismatch");
  }

  for (const row of claimedData) {
    if (row.length !== columnCount) {
      reasons.push("column_count_mismatch");
      break;
    }
  }

  // One bounded trailing probe capped by capacity — never estimate headroom.
  const capacityCap = Math.max(0, input.maxCapacityDataRows);
  if (claimedRows < capacityCap) {
    const trailingStartSheetRow = claimedRows + 2; // first sheet row after claimed data
    const trailingLimitSheetRow = capacityCap + 1; // last capacity data sheet row
    const chunkEnd = Math.min(
      trailingStartSheetRow + REPORTING_VERIFY_SCAN_CHUNK_ROWS - 1,
      trailingLimitSheetRow,
    );
    if (chunkEnd >= trailingStartSheetRow) {
      const chunk = await input.sheets.readValues({
        spreadsheetId: input.artifact.workbookId,
        sheetTitle,
        startRow: trailingStartSheetRow,
        startCol: 1,
        endRow: chunkEnd,
        endCol: columnCount,
      });
      for (let index = 0; index < chunk.length; index += 1) {
        if (rowHasManagedValue(chunk[index] ?? [])) {
          reasons.push("unexpected_trailing_values");
          derivedUsedRows = claimedRows + 1 + index;
          break;
        }
      }
    }
  }

  const actualCells = (1 + Math.max(claimedRows, 0)) * columnCount;
  const reconstructed = claimedData.map((row) => {
    const object: Record<string, unknown> = {};
    for (let index = 0; index < columnCount; index += 1) {
      object[input.columns[index]!.id] = row[index];
    }
    return object;
  });

  let recomputedChecksum: string | null = null;
  try {
    recomputedChecksum = recomputeChecksumFromRows({
      rows: reconstructed,
      queryInput: input.queryInput,
      manifest: input.manifest,
      pageSize,
    });
    if (
      !input.finalChecksum ||
      recomputedChecksum.toLowerCase() !== input.finalChecksum.toLowerCase()
    ) {
      reasons.push("checksum_mismatch");
    }
  } catch {
    reasons.push("checksum_recompute_failed");
  }

  return {
    matched: reasons.length === 0,
    reasons,
    recomputedChecksum,
    actualRows: claimedRows,
    actualCells,
    derivedUsedRows,
  };
}

async function resolveCurrentSheetTitle(
  sheets: ReportingSheetsAdapter,
  spreadsheetId: string,
  sheetId: number,
  fallbackTitle: string,
): Promise<string> {
  const listed = await sheets.listSheets(spreadsheetId);
  const current = listed.find((sheet) => sheet.sheetId === sheetId);
  return current?.title ?? fallbackTitle;
}

export function recomputeChecksumFromRows(input: {
  rows: Array<Record<string, unknown>>;
  queryInput: ValidatedReportingRequest;
  manifest: ReportingCandidateManifestV1;
  pageSize: number;
}): string {
  let accumulator = initialChecksumAccumulator(input.queryInput, input.manifest);
  let rowCount = 0;
  let pageNumber = 0;
  for (let offset = 0; offset < input.rows.length; offset += input.pageSize) {
    const pageRows = input.rows.slice(offset, offset + input.pageSize);
    const pageChecksum = computeChecksum({
      checksum_version: 1,
      artifact_kind: "reporting_page",
      schema_version: 1,
      payload: pageRows,
    });
    rowCount += pageRows.length;
    pageNumber += 1;
    const nextCursor =
      offset + pageRows.length < input.rows.length
        ? `page:${pageNumber}`
        : null;
    // Cursor value itself is folded; use deterministic page index for read-back
    // so empty and multi-page reports remain stable. Prefer manifest mapping
    // nextCursor when available.
    const mapped = input.manifest.outputPages[pageNumber - 1];
    accumulator = advanceChecksumAccumulator({
      previous: accumulator,
      pageNumber,
      pageChecksum,
      nextCursor: mapped?.nextCursor ?? nextCursor,
      rowCount,
    });
  }
  if (input.rows.length === 0) {
    return accumulator;
  }
  return accumulator;
}

/** Max data rows from cell capacity (header-inclusive). Never from estimates. */
export function maxCapacityDataRowsFromCells(input: {
  capacityCells: number;
  columnCount: number;
}): number {
  if (
    !Number.isSafeInteger(input.capacityCells) ||
    !Number.isSafeInteger(input.columnCount) ||
    input.capacityCells < 0 ||
    input.columnCount < 1
  ) {
    return 0;
  }
  return Math.max(0, Math.floor(input.capacityCells / input.columnCount) - 1);
}

export type PromoteContentVerification = {
  columns: ReadonlyArray<SelectedColumn>;
  expectedRows: number;
  estimateKind: "exact" | "upper_bound";
  actualRowsWritten: number;
  finalChecksum: string;
  queryInput: ValidatedReportingRequest;
  manifest: ReportingCandidateManifestV1;
  maxCapacityDataRows: number;
};

export async function promoteOrRecoverReplaceTab(input: {
  sheets: ReportingSheetsAdapter;
  artifact: DeliveryArtifact;
  publishedTitle: string;
  destinationId: string;
  runId: string;
  now: Date;
  /** Required to accept already-promoted / post-rename recovery. */
  contentVerification?: PromoteContentVerification;
}): Promise<
  | { outcome: "promoted"; recoveryTitle: string; publishedSheetId: number }
  | { outcome: "ambiguous"; preserveOldTab: true; reason?: string }
> {
  const oldSheetId = input.artifact.oldSheetId;
  if (oldSheetId === null) {
    return { outcome: "ambiguous", preserveOldTab: true, reason: "missing_old_sheet" };
  }

  const inspection = await inspectReplaceTabPromotion({
    sheets: input.sheets,
    spreadsheetId: input.artifact.workbookId,
    oldSheetId,
    stagingSheetId: input.artifact.stagingSheetId,
    publishedTitle: input.publishedTitle,
  });
  if (inspection.state === "ambiguous") {
    return { outcome: "ambiguous", preserveOldTab: true, reason: "inspection_ambiguous" };
  }

  // After inspection: revalidate markers by immutable IDs — never title-only.
  try {
    await input.sheets.verifyOwnershipMarkerBySheetId({
      spreadsheetId: input.artifact.workbookId,
      sheetId: oldSheetId,
      destinationId: input.destinationId,
    });
  } catch {
    return {
      outcome: "ambiguous",
      preserveOldTab: true,
      reason: "old_ownership_marker_invalid",
    };
  }

  const listed = await input.sheets.listSheets(input.artifact.workbookId);
  const staging = listed.find(
    (sheet) => sheet.sheetId === input.artifact.stagingSheetId,
  );
  if (!staging) {
    return { outcome: "ambiguous", preserveOldTab: true, reason: "staging_missing" };
  }
  try {
    await input.sheets.verifyOwnershipAndRunMarkers({
      spreadsheetId: input.artifact.workbookId,
      sheetTitle: staging.title,
      destinationId: input.destinationId,
      runId: input.runId,
    });
  } catch {
    return {
      outcome: "ambiguous",
      preserveOldTab: true,
      reason: "staging_run_marker_invalid",
    };
  }

  const recoveryTitle = recoveryTabTitle({
    publishedTitle: input.publishedTitle,
    runId: input.runId,
    now: input.now,
  });

  if (
    inspection.state === "ready_to_promote" ||
    inspection.state === "staging_still_hidden"
  ) {
    try {
      await input.sheets.promoteStagingTab({
        spreadsheetId: input.artifact.workbookId,
        oldSheetId,
        stagingSheetId: input.artifact.stagingSheetId,
        publishedTitle: input.publishedTitle,
        recoveryTitle,
      });
    } catch {
      const after = await inspectReplaceTabPromotion({
        sheets: input.sheets,
        spreadsheetId: input.artifact.workbookId,
        oldSheetId,
        stagingSheetId: input.artifact.stagingSheetId,
        publishedTitle: input.publishedTitle,
      });
      if (after.state !== "already_promoted") {
        return { outcome: "ambiguous", preserveOldTab: true, reason: "promote_failed" };
      }
    }
  }

  // Re-resolve titles after possible rename and revalidate markers by ID again.
  try {
    await input.sheets.verifyOwnershipMarkerBySheetId({
      spreadsheetId: input.artifact.workbookId,
      sheetId: oldSheetId,
      destinationId: input.destinationId,
    });
    const afterListed = await input.sheets.listSheets(input.artifact.workbookId);
    const stagingAfter = afterListed.find(
      (sheet) => sheet.sheetId === input.artifact.stagingSheetId,
    );
    if (!stagingAfter || stagingAfter.title !== input.publishedTitle) {
      // Must be the published title by ID — never accept title-only coincidence.
      return {
        outcome: "ambiguous",
        preserveOldTab: true,
        reason: "published_title_not_on_staging_id",
      };
    }
    await input.sheets.verifyOwnershipAndRunMarkers({
      spreadsheetId: input.artifact.workbookId,
      sheetTitle: stagingAfter.title,
      destinationId: input.destinationId,
      runId: input.runId,
    });
  } catch {
    return {
      outcome: "ambiguous",
      preserveOldTab: true,
      reason: "post_promote_marker_invalid",
    };
  }

  if (!input.contentVerification) {
    return {
      outcome: "ambiguous",
      preserveOldTab: true,
      reason: "content_verification_required",
    };
  }

  const verified = await verifyStagingContents({
    sheets: input.sheets,
    artifact: {
      ...input.artifact,
      stagingSheetTitle: input.publishedTitle,
    },
    columns: input.contentVerification.columns,
    expectedRows: input.contentVerification.expectedRows,
    estimateKind: input.contentVerification.estimateKind,
    actualRowsWritten: input.contentVerification.actualRowsWritten,
    finalChecksum: input.contentVerification.finalChecksum,
    runId: input.runId,
    destinationId: input.destinationId,
    queryInput: input.contentVerification.queryInput,
    manifest: input.contentVerification.manifest,
    maxCapacityDataRows: input.contentVerification.maxCapacityDataRows,
  });
  if (!verified.matched) {
    return {
      outcome: "ambiguous",
      preserveOldTab: true,
      reason: `content_verify_failed:${verified.reasons.join(",")}`,
    };
  }

  const finalInspection = await inspectReplaceTabPromotion({
    sheets: input.sheets,
    spreadsheetId: input.artifact.workbookId,
    oldSheetId,
    stagingSheetId: input.artifact.stagingSheetId,
    publishedTitle: input.publishedTitle,
  });
  if (finalInspection.state !== "already_promoted") {
    return {
      outcome: "ambiguous",
      preserveOldTab: true,
      reason: "final_inspection_not_promoted",
    };
  }

  return {
    outcome: "promoted",
    recoveryTitle,
    publishedSheetId: input.artifact.stagingSheetId,
  };
}

export function assertNoSilentTruncation(input: {
  rowsWritten: number;
  expectedRows: number;
  estimateKind: "exact" | "upper_bound";
  cellsWritten: number;
  expectedCells: number;
}): void {
  if (
    input.estimateKind === "exact" &&
    input.rowsWritten !== input.expectedRows
  ) {
    throw Object.assign(new Error("reporting_row_count_mismatch"), {
      code: "VERIFICATION_MISMATCH",
    });
  }
  if (input.rowsWritten > input.expectedRows) {
    throw Object.assign(new Error("reporting_silent_truncation_refused"), {
      code: "DESTINATION_CAPACITY_EXCEEDED",
    });
  }
  if (input.cellsWritten > input.expectedCells) {
    throw Object.assign(new Error("reporting_cell_capacity_exceeded"), {
      code: "DESTINATION_CAPACITY_EXCEEDED",
    });
  }
}

export function assertPersistedManifestStructure(
  manifest: ReportingCandidateManifestV1,
  sourceReadThrough: string,
): void {
  if (manifest.version !== 1) {
    throw new Error("unsupported_reporting_manifest_version");
  }
  if (manifest.sourceReadThrough !== sourceReadThrough) {
    throw new Error("reporting_manifest_read_through_mismatch");
  }
  if (!Array.isArray(manifest.entries) || !Array.isArray(manifest.outputPages)) {
    throw new Error("reporting_manifest_incomplete");
  }
  for (const entry of manifest.entries) {
    if ("rows" in entry || "values" in entry) {
      throw new TypeError("Persisted manifest must not contain row payloads.");
    }
  }
  for (const page of manifest.outputPages) {
    if ("rows" in page || "values" in page || "cells" in page) {
      throw new TypeError("Persisted output page maps must not contain row payloads.");
    }
    if (!Number.isSafeInteger(page.pageNumber) || page.pageNumber < 0) {
      throw new Error("reporting_manifest_page_map_invalid");
    }
    if (!Array.isArray(page.dependencyKeys)) {
      throw new Error("reporting_manifest_page_map_invalid");
    }
  }
}

/**
 * Always fully validate persisted manifest entries and output page maps on
 * resume — even when there is no stream checkpoint.
 */
export async function validatePersistedManifestForResume(
  manifest: ReportingCandidateManifestV1,
  sourceReadThrough: string,
  pageSize = REPORTING_PAGE_SIZE,
  validateEntries: typeof validateReportingManifestEntries = validateReportingManifestEntries,
): Promise<void> {
  assertPersistedManifestStructure(manifest, sourceReadThrough);
  await validateCompleteManifestBatched(manifest, pageSize, validateEntries);
}
