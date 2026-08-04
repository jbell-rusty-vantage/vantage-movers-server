import assert from "node:assert/strict";
import test from "node:test";
import {
  createOperationalWorkbookRegistry,
  type OperationalWorkbookRegistration,
} from "../operationalWorkbooks/registry";
import {
  a1Range,
  serializeLiteralCell,
  serializeReportingHeaderCells,
  serializeReportingRowCells,
} from "./google/cellSerialization";
import { createFakeReportingGoogle } from "./google/fakeReportingGoogle";
import {
  assertBoundedWrite,
  REPORTING_VALUE_INPUT_OPTION,
} from "./google/reportingSheetsAdapter";
import {
  assertProviderErrorIsPiiSafe,
  sanitizeReportingProviderFailure,
} from "./google/providerFailures";
import {
  assertNoSilentTruncation,
  buildReportingWriteBatches,
  assertPersistedManifestStructure,
  createOrResumeDeliveryArtifact,
  promoteOrRecoverReplaceTab,
  recomputeChecksumFromRows,
  verifyStagingContents,
  writeBoundedReportingBatch,
} from "./deliveryEngine";
import { inspectReplaceTabPromotion } from "./promotion";
import { cleanupDeliveryArtifacts, positivelyMarkedForCleanup } from "./cleanup";
import { assertNoRowPayload } from "./reportingManifestRepository";
import { serializeReportingRunMarker } from "./google/runMarker";
import { serializeReportingOwnershipMarker } from "./ownershipMarker";
import {
  REPORTING_FAILURE_CODES,
  reportingFailure,
  assertSafeReportingFailure,
} from "./reportingRunRepository";
import { safeReportingDeliveryForRead } from "./reportingDeliveryRepository";
import type { ReportingCandidateManifestV1 } from "./catalog";

const columns = [
  { id: "lead_id", label: "Lead ID" },
  { id: "name", label: "Customer Name" },
];

const queryInput = {
  datasetKey: "lead_outcome_detail" as const,
  datasetSchemaVersion: 1 as const,
  resolvedWindow: {
    timezone: "America/New_York",
    fromUtc: "2026-01-01T05:00:00.000Z",
    toExclusiveUtc: "2026-02-01T05:00:00.000Z",
  },
  registry: { companies: [], granularities: [] },
  filters: {},
  selectedColumns: columns,
  effectiveSort: [{ id: "lead_id", direction: "asc" as const }],
  sourceReadThrough: "2026-08-01T00:00:00.000Z",
};

function manifestFixture(): ReportingCandidateManifestV1 {
  return {
    version: 1,
    sourceReadThrough: queryInput.sourceReadThrough,
    manifestCapturedAt: "2026-08-01T00:00:01.000Z",
    snapshotToken: {
      adapter: "mongodb_snapshot",
      operationTime: "1",
      capturedAt: "2026-08-01T00:00:01.000Z",
    },
    entries: [
      {
        model: "FormLead",
        id: "64b000000000000000000001",
        version: "2026-07-01T00:00:00.000Z",
        fingerprint: "c".repeat(64),
      },
    ],
    outputPages: [
      {
        pageNumber: 0,
        afterCursor: null,
        nextCursor: null,
        dependencyKeys: ["FormLead:64b000000000000000000001"],
      },
    ],
    checksum: "d".repeat(64),
  };
}

test("acceptance 10: denylist rejects every registered operational workbook id", () => {
  const registrations: OperationalWorkbookRegistration[] = [
    {
      registration_key: "master_leads",
      purpose: "operational_projection",
      env_key: "MASTER_LEADS_SHEET_ID",
      required_in_production: true,
      owner_module: "operations",
      display_label: "Master Leads",
    },
    {
      registration_key: "best_relocation_leads",
      purpose: "ingestion_source",
      env_key: "BEST_RELOCATION_LEADS_SHEET_ID",
      required_in_production: true,
      owner_module: "best_relocation_ingestion",
      display_label: "Best Relocation Leads",
    },
  ];
  const registry = createOperationalWorkbookRegistry({
    registrations,
    env: {
      MASTER_LEADS_SHEET_ID: "1MasterLeadsWorkbook000000000001",
      BEST_RELOCATION_LEADS_SHEET_ID: "1BestRelocationLeads00000000001",
    },
    production: true,
  });
  assert.equal(
    registry.evaluateReportingDestination("1MasterLeadsWorkbook000000000001")
      .allowed,
    false,
  );
  assert.equal(
    registry.evaluateReportingDestination("1BestRelocationLeads00000000001")
      .allowed,
    false,
  );
  assert.equal(
    registry.evaluateReportingDestination("1SafeOwnerWorkbook0000000000001")
      .allowed,
    true,
  );
});

test("acceptance 11: human-created tab takeover is refused by staging ownership markers", async () => {
  const google = createFakeReportingGoogle();
  const created = await google.drive.createSpreadsheet({
    title: "Dest",
    folderId: "folder",
    runId: "64b000000000000000000001",
    destinationId: "64b000000000000000000099",
    role: "snapshot",
  });
  // Simulate a human tab with the published name and no marker.
  await google.sheets.renameSheet({
    spreadsheetId: created.spreadsheetId,
    sheetId: 1,
    title: "Report",
  });
  await assert.rejects(
    () =>
      google.sheets.verifyOwnershipAndRunMarkers({
        spreadsheetId: created.spreadsheetId,
        sheetTitle: "Report",
        destinationId: "64b000000000000000000099",
        runId: "64b000000000000000000001",
      }),
    /ownership marker|run marker/i,
  );
});

test("acceptance 12: capacity feedback refuses silent truncation", () => {
  assert.throws(
    () =>
      assertNoSilentTruncation({
        rowsWritten: 101,
        expectedRows: 100,
        estimateKind: "exact",
        cellsWritten: 202,
        expectedCells: 202,
      }),
    /capacity|truncation|mismatch/i,
  );
  assert.throws(
    () =>
      assertNoSilentTruncation({
        rowsWritten: 100,
        expectedRows: 100,
        estimateKind: "exact",
        cellsWritten: 250,
        expectedCells: 202,
      }),
    /capacity/i,
  );
  assert.doesNotThrow(() =>
    assertNoSilentTruncation({
      rowsWritten: 100,
      expectedRows: 100,
      estimateKind: "exact",
      cellsWritten: 202,
      expectedCells: 202,
    }),
  );
});

test("acceptance 13/14: bounded RAW writes, idempotent replay, and checksum-safe progress", async () => {
  const google = createFakeReportingGoogle();
  const created = await google.drive.createSpreadsheet({
    title: "Snap",
    folderId: "folder",
    runId: "64b0000000000000000000aa",
    destinationId: "64b0000000000000000000bb",
    role: "snapshot",
  });
  const artifact = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b0000000000000000000aa",
    destinationId: "64b0000000000000000000bb",
    strategy: "snapshot",
    folderId: "folder",
    existing: {
      workbookId: created.spreadsheetId,
      workbookUrl: created.spreadsheetUrl,
    },
  });
  // Force create path by clearing existing staging.
  const fresh = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b0000000000000000000aa",
    destinationId: "64b0000000000000000000bb",
    strategy: "snapshot",
    folderId: "folder",
  });
  assert.ok(fresh.workbookId);
  assert.equal(
    REPORTING_VALUE_INPUT_OPTION,
    "RAW",
  );
  const rows = [
    { lead_id: "1", name: "Ada" },
    { lead_id: "2", name: "Bob" },
  ];
  const batches = buildReportingWriteBatches({
    rows,
    columns,
    includeHeader: true,
  });
  assert.equal(batches[0]![0]![0], "Lead ID");
  let row = 1;
  for (const batch of batches) {
    const written = await writeBoundedReportingBatch({
      sheets: google.sheets,
      artifact: fresh,
      startRow: row,
      values: batch,
    });
    assert.equal(written.valueInputOption, "RAW");
    // Idempotent exact-range replay.
    const replayed = await writeBoundedReportingBatch({
      sheets: google.sheets,
      artifact: fresh,
      startRow: row,
      values: batch,
    });
    assert.equal(replayed.valueInputOption, "RAW");
    row += batch.length;
  }
  const manifest = manifestFixture();
  const finalChecksum = recomputeChecksumFromRows({
    rows,
    queryInput,
    manifest,
    pageSize: 500,
  });
  const verified = await verifyStagingContents({
    sheets: google.sheets,
    artifact: fresh,
    columns,
    expectedRows: 2,
    estimateKind: "exact",
    actualRowsWritten: 2,
    finalChecksum,
    runId: "64b0000000000000000000aa",
    destinationId: "64b0000000000000000000bb",
    queryInput,
    manifest,
    maxCapacityDataRows: 10_000,
  });
  assert.equal(verified.matched, true);
  void artifact;
});

test("acceptance 13: ambiguous provider timeout replays exact range after read-back", async () => {
  const google = createFakeReportingGoogle();
  const artifact = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b0000000000000000000cc",
    destinationId: "64b0000000000000000000dd",
    strategy: "snapshot",
    folderId: "folder",
  });
  const values = [
    serializeReportingHeaderCells(columns),
    serializeReportingRowCells({ lead_id: "1", name: "Ada" }, columns),
  ];
  await writeBoundedReportingBatch({
    sheets: google.sheets,
    artifact,
    startRow: 1,
    values,
  });
  google.forceTransientFailure(1);
  // First call fails transiently; writeBoundedReportingBatch verifies and
  // treats matching read-back as success without requiring a second write.
  const replay = await writeBoundedReportingBatch({
    sheets: google.sheets,
    artifact,
    startRow: 1,
    values,
  });
  assert.match(replay.range, /replay:|report_/);
});

test("acceptance 15/16: staging verification/promotion and failed replacement preserves old tab", async () => {
  const google = createFakeReportingGoogle();
  const created = await google.drive.createSpreadsheet({
    title: "Managed",
    folderId: "folder",
    runId: "64b0000000000000000000ff",
    destinationId: "64b0000000000000000000ee",
    role: "snapshot",
  });
  // Seed published managed tab.
  await google.sheets.renameSheet({
    spreadsheetId: created.spreadsheetId,
    sheetId: 1,
    title: "Weekly Report",
  });
  await google.sheets.writeOwnershipAndRunMarkers({
    spreadsheetId: created.spreadsheetId,
    sheetTitle: "Weekly Report",
    destinationId: "64b0000000000000000000ee",
    runId: "64b0000000000000000000ff",
    strategy: "replace_tab",
    role: "published",
  });

  const artifact = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b000000000000000000100",
    destinationId: "64b0000000000000000000ee",
    strategy: "replace_tab",
    folderId: "folder",
    workbookId: created.spreadsheetId,
    managedTab: { immutableSheetId: 1, name: "Weekly Report" },
  });
  assert.equal(artifact.oldSheetId, 1);
  assert.equal(
    (await google.sheets.listSheets(created.spreadsheetId)).find(
      (sheet) => sheet.sheetId === 1,
    )?.title,
    "Weekly Report",
  );

  await writeBoundedReportingBatch({
    sheets: google.sheets,
    artifact,
    startRow: 1,
    values: [serializeReportingHeaderCells(columns)],
  });

  // Forced failed replacement: delete staging before promotion and prove old tab remains.
  await google.sheets.deleteSheet({
    spreadsheetId: created.spreadsheetId,
    sheetId: artifact.stagingSheetId,
  });
  const inspection = await inspectReplaceTabPromotion({
    sheets: google.sheets,
    spreadsheetId: created.spreadsheetId,
    oldSheetId: 1,
    stagingSheetId: artifact.stagingSheetId,
    publishedTitle: "Weekly Report",
  });
  assert.equal(inspection.state, "ambiguous");
  const old = (await google.sheets.listSheets(created.spreadsheetId)).find(
    (sheet) => sheet.sheetId === 1,
  );
  assert.equal(old?.title, "Weekly Report");

  // Successful path on a fresh staging tab.
  const retryArtifact = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b000000000000000000101",
    destinationId: "64b0000000000000000000ee",
    strategy: "replace_tab",
    folderId: "folder",
    workbookId: created.spreadsheetId,
    managedTab: { immutableSheetId: 1, name: "Weekly Report" },
  });
  await writeBoundedReportingBatch({
    sheets: google.sheets,
    artifact: retryArtifact,
    startRow: 1,
    values: [
      serializeReportingHeaderCells(columns),
      serializeReportingRowCells({ lead_id: "9", name: "Zoe" }, columns),
    ],
  });
  const promoteManifest = manifestFixture();
  const promoteRows = [{ lead_id: "9", name: "Zoe" }];
  const promoteChecksum = recomputeChecksumFromRows({
    rows: promoteRows,
    queryInput,
    manifest: promoteManifest,
    pageSize: 500,
  });
  const promoted = await promoteOrRecoverReplaceTab({
    sheets: google.sheets,
    artifact: retryArtifact,
    publishedTitle: "Weekly Report",
    destinationId: "64b0000000000000000000ee",
    runId: "64b000000000000000000101",
    now: new Date("2026-08-04T12:00:00.000Z"),
    contentVerification: {
      columns,
      expectedRows: 1,
      estimateKind: "exact",
      actualRowsWritten: 1,
      finalChecksum: promoteChecksum,
      queryInput,
      manifest: promoteManifest,
      maxCapacityDataRows: 10_000,
    },
  });
  assert.equal(promoted.outcome, "promoted");
  const sheets = await google.sheets.listSheets(created.spreadsheetId);
  assert.ok(sheets.some((sheet) => sheet.title === "Weekly Report" && !sheet.hidden));
  assert.ok(
    sheets.some(
      (sheet) =>
        sheet.sheetId === 1 && sheet.title.includes("__vantage_recovery_"),
    ),
  );
});

test("acceptance 17: incomplete snapshot cleanup only trashes positively marked workbooks", async () => {
  const google = createFakeReportingGoogle();
  const artifact = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b000000000000000000102",
    destinationId: "64b000000000000000000103",
    strategy: "snapshot",
    folderId: "folder",
  });
  assert.equal(
    positivelyMarkedForCleanup({
      ownershipRaw: serializeReportingOwnershipMarker(
        "64b000000000000000000103",
      ),
      runRaw: serializeReportingRunMarker({
        runId: "64b000000000000000000102",
        destinationId: "64b000000000000000000103",
        strategy: "snapshot",
        role: "snapshot",
      }),
      runId: "64b000000000000000000102",
      destinationId: "64b000000000000000000103",
    }),
    true,
  );
  assert.equal(
    positivelyMarkedForCleanup({
      ownershipRaw: "human tab",
      runRaw: "not a marker",
      runId: "64b000000000000000000102",
      destinationId: "64b000000000000000000103",
    }),
    false,
  );
  await google.drive.trashFile({
    fileId: artifact.workbookId,
    expectedRunId: "64b000000000000000000102",
    expectedDestinationId: "64b000000000000000000103",
  });
  const file = await google.drive.getFile({ fileId: artifact.workbookId });
  assert.equal(file.trashed, true);
});

test("cleanup janitor never trashes a completed snapshot artifact", async () => {
  let driveTouched = false;
  const result = await cleanupDeliveryArtifacts({
    drive: {
      async getFile() {
        driveTouched = true;
        throw new Error("completed artifact must not be inspected");
      },
      async trashFile() {
        driveTouched = true;
        throw new Error("completed artifact must not be trashed");
      },
    } as any,
    sheets: {} as any,
    delivery: {
      run_id: "64b000000000000000000102",
      destination_id: "64b000000000000000000103",
      strategy: "snapshot",
      status: "completed",
      workbook_id: "published-workbook",
      cleanup: {
        state: "pending",
        artifact_ids: ["published-workbook"],
      },
    },
  });
  assert.equal(result, "skipped");
  assert.equal(driveTouched, false);
});

test("acceptance 19: PII is excluded from provider failures, checkpoints, and delivery reads", () => {
  const sanitized = sanitizeReportingProviderFailure({
    status: 500,
    message: "failed for customer@example.com named Ada Lovelace",
    values: [["Ada", "555-0100"]],
  });
  assert.equal(sanitized.summary.includes("@"), false);
  assert.equal(sanitized.summary.includes("Ada"), false);
  assert.doesNotThrow(() => assertProviderErrorIsPiiSafe(sanitized));
  assert.throws(
    () =>
      assertProviderErrorIsPiiSafe({
        message: "row values leaked",
        values: "a,b,c",
      }),
    /PII|cell/i,
  );

  const failure = reportingFailure("PROVIDER_UNAVAILABLE", {
    phase: "writing",
    provider_status: 503,
    attempt: 2,
  });
  assertSafeReportingFailure(failure);
  assert.equal(failure.summary, REPORTING_FAILURE_CODES.PROVIDER_UNAVAILABLE.summary);
  assert.equal(JSON.stringify(failure).includes("Ada"), false);

  const deliveryRead = safeReportingDeliveryForRead({
    run_id: "64b000000000000000000104",
    destination_id: "dest",
    strategy: "snapshot",
    status: "writing",
    workbook_id: "ss",
    workbook_url: "https://example.test",
    staging_sheet_id: 2,
    published_sheet_id: null,
    published_sheet_title: null,
    old_sheet_id: null,
    expected: { rows: 1, columns: 2, cells_including_header: 4, header_labels: ["Lead ID", "Customer Name"], data_checksum: "a".repeat(64) },
    actual: { rows: null, columns: null, cells_including_header: null, header_labels: [], data_checksum: null },
    verification: { matched: null, checked_at: null, reasons: [] },
    progress: {
      next_write_row: 2,
      completed_batch_number: 1,
      rows_written: 0,
      cells_written: 2,
      provider_requests: 1,
      provider_retries: 0,
      promotion_step: "not_started",
      last_stream_checkpoint: {
        version: 1,
        cursor: null,
        pageNumber: 0,
        rowCount: 0,
        checksumAccumulator: "b".repeat(64),
      },
    },
    cleanup: { state: "not_needed", attempts: 0, last_error_code: null },
    failure: null,
    completed_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  });
  assert.ok(deliveryRead);
  assert.equal(
    JSON.stringify(deliveryRead).includes("Customer Name") ||
      JSON.stringify(deliveryRead).includes("Lead ID"),
    true,
  );
  assert.equal(JSON.stringify(deliveryRead).includes("Ada"), false);
  assert.equal(
    "last_stream_checkpoint" in (deliveryRead.progress as object),
    false,
  );
});

test("RAW semantics reject formula-shaped cells and require literal serialization", () => {
  assert.equal(serializeLiteralCell(null), null);
  assert.equal(serializeLiteralCell(12), 12);
  assert.throws(() => serializeLiteralCell({ nested: true }), /literal/);
  assert.throws(
    () => assertBoundedWrite([["=SUM(A1:A2)"]]),
    /formula/i,
  );
  assert.equal(a1Range("Tab Name", 1, 1, 2, 2), "'Tab Name'!A1:B2");
});

test("persisted manifests reject row payloads and validate resume identity", () => {
  const manifest = manifestFixture();
  assert.doesNotThrow(() => assertNoRowPayload(manifest));
  assert.doesNotThrow(() =>
    assertPersistedManifestStructure(
      manifest,
      "2026-08-01T00:00:00.000Z",
    ),
  );
  assert.throws(
    () =>
      assertPersistedManifestStructure(
        manifest,
        "2026-08-02T00:00:00.000Z",
      ),
    /read_through_mismatch/,
  );
  assert.throws(
    () =>
      assertNoRowPayload({
        ...manifest,
        outputPages: [
          {
            ...manifest.outputPages[0]!,
            rows: [{ lead_id: "1" }],
          } as any,
        ],
      }),
    /row payloads/,
  );
});

test("lease fencing failure codes remain typed and PII-safe", () => {
  const leaseLost = reportingFailure("LEASE_LOST", { phase: "writing", attempt: 1 });
  const ambiguous = reportingFailure("PROMOTION_AMBIGUOUS", {
    phase: "promoting",
    sheet_id: 12,
  });
  assertSafeReportingFailure(leaseLost);
  assertSafeReportingFailure(ambiguous);
  assert.equal(leaseLost.retryable, true);
  assert.equal(ambiguous.retryable, false);
});
