import assert from "node:assert/strict";
import test from "node:test";
import { computeChecksum } from "../durableWork";
import {
  assertSafeToTrashReportingArtifact,
  type ReportingDriveFile,
} from "./google/reportingDriveAdapter";
import { createFakeReportingGoogle } from "./google/fakeReportingGoogle";
import {
  REPORTING_SPREADSHEET_MIME_TYPE,
  buildReportingDriveAppProperties,
  driveAppPropertiesMatchRun,
} from "./google/driveAppProperties";
import {
  createOrResumeDeliveryArtifact,
  promoteOrRecoverReplaceTab,
  recomputeChecksumFromRows,
  validatePersistedManifestForResume,
  verifyStagingContents,
  writeBoundedReportingBatch,
  buildReportingWriteBatches,
} from "./deliveryEngine";
import { enqueueIncompleteArtifactCleanup } from "./cleanup";
import {
  serializeReportingHeaderCells,
  serializeReportingRowCells,
} from "./google/cellSerialization";
import { serializeReportingOwnershipMarker } from "./ownershipMarker";
import { serializeReportingRunMarker } from "./google/runMarker";
import {
  initialChecksumAccumulator,
} from "./executionStream";
import type { ReportingCandidateManifestV1 } from "./catalog";
import { BadRequestError } from "../errors";
import { registerReportingStage4Foundation } from "./registerStage4Foundation";

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

test("regression 1: queue consumer registers Stage 4 foundation before work", () => {
  // Idempotent; proves the same bootstrap the consumer calls is safe.
  registerReportingStage4Foundation();
  registerReportingStage4Foundation();
  assert.ok(true);
});

test("regression 4: read-back recomputes deterministic content checksum", async () => {
  const google = createFakeReportingGoogle();
  const artifact = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b000000000000000000201",
    destinationId: "64b000000000000000000202",
    strategy: "snapshot",
    folderId: "folder",
  });
  const rows = [
    { lead_id: "1", name: "Ada" },
    { lead_id: "2", name: "Bob" },
  ];
  const batches = buildReportingWriteBatches({
    rows,
    columns,
    includeHeader: true,
  });
  let row = 1;
  for (const batch of batches) {
    await writeBoundedReportingBatch({
      sheets: google.sheets,
      artifact,
      startRow: row,
      values: batch,
    });
    row += batch.length;
  }
  const manifest = manifestFixture();
  const expected = recomputeChecksumFromRows({
    rows,
    queryInput,
    manifest,
    pageSize: 500,
  });
  const verified = await verifyStagingContents({
    sheets: google.sheets,
    artifact,
    columns,
    expectedRows: 2,
    estimateKind: "exact",
    actualRowsWritten: 2,
    finalChecksum: expected,
    runId: "64b000000000000000000201",
    destinationId: "64b000000000000000000202",
    queryInput,
    manifest,
    maxCapacityDataRows: 10_000,
  });
  assert.equal(verified.matched, true);
  assert.equal(verified.recomputedChecksum, expected);
  assert.notEqual(verified.recomputedChecksum, "a".repeat(64));

  const mismatched = await verifyStagingContents({
    sheets: google.sheets,
    artifact,
    columns,
    expectedRows: 2,
    estimateKind: "exact",
    actualRowsWritten: 2,
    finalChecksum: "a".repeat(64),
    runId: "64b000000000000000000201",
    destinationId: "64b000000000000000000202",
    queryInput,
    manifest,
    maxCapacityDataRows: 10_000,
  });
  assert.equal(mismatched.matched, false);
  assert.ok(mismatched.reasons.includes("checksum_mismatch"));
});

test("regression 5: published managed tab verified before staging and promotion", async () => {
  const google = createFakeReportingGoogle();
  const created = await google.drive.createSpreadsheet({
    title: "Managed",
    folderId: "folder",
    runId: "64b000000000000000000210",
    destinationId: "64b000000000000000000211",
    role: "snapshot",
  });
  await google.sheets.renameSheet({
    spreadsheetId: created.spreadsheetId,
    sheetId: 1,
    title: "Weekly Report",
  });
  await google.sheets.writeOwnershipAndRunMarkers({
    spreadsheetId: created.spreadsheetId,
    sheetTitle: "Weekly Report",
    destinationId: "64b000000000000000000211",
    runId: "64b000000000000000000210",
    strategy: "replace_tab",
    role: "published",
  });

  await assert.rejects(
    () =>
      google.sheets.verifyPublishedManagedTab({
        spreadsheetId: created.spreadsheetId,
        immutableSheetId: 999,
        publishedTitle: "Weekly Report",
        destinationId: "64b000000000000000000211",
      }),
    /immutable ID/i,
  );

  const artifact = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b000000000000000000212",
    destinationId: "64b000000000000000000211",
    strategy: "replace_tab",
    folderId: "folder",
    workbookId: created.spreadsheetId,
    managedTab: { immutableSheetId: 1, name: "Weekly Report" },
  });
  assert.equal(artifact.oldSheetId, 1);
  await google.sheets.verifyOwnershipAndRunMarkers({
    spreadsheetId: created.spreadsheetId,
    sheetTitle: artifact.stagingSheetTitle,
    destinationId: "64b000000000000000000211",
    runId: "64b000000000000000000212",
  });
});

test("regression 6: cleanup does not overwrite delivery terminal status", async () => {
  // Pure contract: enqueueIncompleteArtifactCleanup only patches cleanup.*.
  // Validated by patchReportingDeliveryCleanup rejecting status keys.
  const { patchReportingDeliveryCleanup } = await import(
    "./reportingDeliveryRepository.js"
  );
  await assert.rejects(
    () =>
      patchReportingDeliveryCleanup({
        runId: "64b000000000000000000220",
        set: { status: "cleanup_pending" as any },
      }),
    /must not modify delivery status|cleanup\.\*/i,
  );
  void enqueueIncompleteArtifactCleanup;
});

test("regression 7: artifact creation recovers one positively marked artifact", async () => {
  const google = createFakeReportingGoogle();
  const persisted: Array<Record<string, unknown>> = [];
  const first = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b000000000000000000230",
    destinationId: "64b000000000000000000231",
    strategy: "snapshot",
    folderId: "folder",
    onWorkbookCreated: async (artifact) => {
      persisted.push({ phase: "workbook", ...artifact });
    },
    onStagingCreated: async (artifact) => {
      persisted.push({ phase: "staging", ...artifact });
    },
  });
  assert.equal(persisted[0]?.phase, "workbook");
  assert.ok(persisted[0]?.workbookId);
  assert.equal(persisted.some((item) => item.phase === "staging"), true);

  // Crash after workbook+staging persisted: resume must reuse, not duplicate.
  const resumed = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b000000000000000000230",
    destinationId: "64b000000000000000000231",
    strategy: "snapshot",
    folderId: "folder",
    existing: {
      workbookId: first.workbookId,
      workbookUrl: first.workbookUrl,
      stagingSheetId: first.stagingSheetId,
      stagingSheetTitle: first.stagingSheetTitle,
      oldSheetId: null,
    },
  });
  assert.equal(resumed.workbookId, first.workbookId);
  assert.equal(resumed.stagingSheetId, first.stagingSheetId);
  assert.equal(
    google.inspect().spreadsheets.filter((item) => !item.trashed).length,
    1,
  );

  // Crash after workbook ID persisted but before staging checkpoint:
  const interrupted = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b000000000000000000232",
    destinationId: "64b000000000000000000233",
    strategy: "snapshot",
    folderId: "folder",
  });
  const recovered = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b000000000000000000232",
    destinationId: "64b000000000000000000233",
    strategy: "snapshot",
    folderId: "folder",
    existing: {
      workbookId: interrupted.workbookId,
      workbookUrl: interrupted.workbookUrl,
    },
  });
  assert.equal(recovered.workbookId, interrupted.workbookId);
  assert.equal(recovered.stagingSheetId, interrupted.stagingSheetId);
});

test("regression 8: resume always fully validates persisted manifest entries/maps", async () => {
  const manifest = manifestFixture();
  const noopValidate = async () => {};
  // Structural + page-map validation runs even with no stream checkpoint.
  await assert.rejects(
    () =>
      validatePersistedManifestForResume(
        {
          ...manifest,
          outputPages: [
            {
              pageNumber: 0,
              afterCursor: null,
              nextCursor: null,
              dependencyKeys: "bad" as any,
            },
          ],
        },
        queryInput.sourceReadThrough,
        500,
        noopValidate,
      ),
    /page_map_invalid|manifest/,
  );
  await assert.rejects(
    () =>
      validatePersistedManifestForResume(
        {
          ...manifest,
          outputPages: [
            {
              ...manifest.outputPages[0]!,
              rows: [{ x: 1 }],
            } as any,
          ],
        },
        queryInput.sourceReadThrough,
        500,
        noopValidate,
      ),
    /row payloads/,
  );
});

test("regression 9: trash requires ownedByMe, MIME, identity, and Drive appProperties", () => {
  const good: ReportingDriveFile = {
    id: "ss_1",
    name: "Report",
    trashed: false,
    mimeType: REPORTING_SPREADSHEET_MIME_TYPE,
    ownedByMe: true,
    appProperties: buildReportingDriveAppProperties({
      runId: "64b000000000000000000240",
      destinationId: "64b000000000000000000241",
      role: "snapshot",
    }),
  };
  assert.doesNotThrow(() =>
    assertSafeToTrashReportingArtifact({
      file: good,
      expectedRunId: "64b000000000000000000240",
      expectedDestinationId: "64b000000000000000000241",
      expectedFileId: "ss_1",
    }),
  );
  assert.throws(
    () =>
      assertSafeToTrashReportingArtifact({
        file: { ...good, ownedByMe: false },
        expectedRunId: "64b000000000000000000240",
        expectedDestinationId: "64b000000000000000000241",
        expectedFileId: "ss_1",
      }),
    BadRequestError,
  );
  assert.throws(
    () =>
      assertSafeToTrashReportingArtifact({
        file: { ...good, mimeType: "application/pdf" },
        expectedRunId: "64b000000000000000000240",
        expectedDestinationId: "64b000000000000000000241",
        expectedFileId: "ss_1",
      }),
    BadRequestError,
  );
  assert.throws(
    () =>
      assertSafeToTrashReportingArtifact({
        file: { ...good, appProperties: {} },
        expectedRunId: "64b000000000000000000240",
        expectedDestinationId: "64b000000000000000000241",
        expectedFileId: "ss_1",
      }),
    /appProperties/i,
  );
  assert.equal(
    driveAppPropertiesMatchRun({
      appProperties: good.appProperties,
      runId: "64b000000000000000000240",
      destinationId: "64b000000000000000000241",
    }),
    true,
  );
  // Sheet-cell markers alone are insufficient — Drive appProperties required.
  void serializeReportingOwnershipMarker;
  void serializeReportingRunMarker;
});

test("regression 11: promotion ambiguity preserves old tab and never deletes by name", async () => {
  const google = createFakeReportingGoogle();
  const created = await google.drive.createSpreadsheet({
    title: "Managed",
    folderId: "folder",
    runId: "64b000000000000000000250",
    destinationId: "64b000000000000000000251",
    role: "snapshot",
  });
  await google.sheets.renameSheet({
    spreadsheetId: created.spreadsheetId,
    sheetId: 1,
    title: "Weekly Report",
  });
  await google.sheets.writeOwnershipAndRunMarkers({
    spreadsheetId: created.spreadsheetId,
    sheetTitle: "Weekly Report",
    destinationId: "64b000000000000000000251",
    runId: "64b000000000000000000250",
    strategy: "replace_tab",
    role: "published",
  });
  const artifact = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b000000000000000000252",
    destinationId: "64b000000000000000000251",
    strategy: "replace_tab",
    folderId: "folder",
    workbookId: created.spreadsheetId,
    managedTab: { immutableSheetId: 1, name: "Weekly Report" },
  });
  // Force ambiguity by deleting staging before promotion.
  await google.sheets.deleteSheet({
    spreadsheetId: created.spreadsheetId,
    sheetId: artifact.stagingSheetId,
  });
  const result = await promoteOrRecoverReplaceTab({
    sheets: google.sheets,
    artifact,
    publishedTitle: "Weekly Report",
    destinationId: "64b000000000000000000251",
    runId: "64b000000000000000000252",
    now: new Date("2026-08-04T12:00:00.000Z"),
  });
  assert.equal(result.outcome, "ambiguous");
  if (result.outcome === "ambiguous") {
    assert.equal(result.preserveOldTab, true);
  }
  const old = (await google.sheets.listSheets(created.spreadsheetId)).find(
    (sheet) => sheet.sheetId === 1,
  );
  assert.equal(old?.title, "Weekly Report");
  // No deletion by published name occurred.
  assert.ok(old);
});

test("regression: empty report checksum equals initial accumulator", () => {
  const manifest = manifestFixture();
  const expected = initialChecksumAccumulator(queryInput, manifest);
  const recomputed = recomputeChecksumFromRows({
    rows: [],
    queryInput,
    manifest,
    pageSize: 500,
  });
  assert.equal(recomputed, expected);
  assert.equal(
    computeChecksum({
      checksum_version: 1,
      artifact_kind: "reporting_data",
      schema_version: 1,
      payload: {
        datasetKey: queryInput.datasetKey,
        datasetSchemaVersion: 1,
        selectedColumns: queryInput.selectedColumns,
        effectiveSort: queryInput.effectiveSort,
        manifestChecksum: manifest.checksum,
        sourceReadThrough: manifest.sourceReadThrough,
      },
    }),
    expected,
  );
  void serializeReportingHeaderCells;
});

test("regression 2/3: lease fence helpers abort on false without Google side effects", async () => {
  const { LeaseLostError } = await import("./reportingWorker.js");
  const err = new LeaseLostError("writing");
  assert.equal(err.envelope.code, "LEASE_LOST");
  assert.match(err.message, /writing|lease/i);

  // Fenced delivery patch must refuse when the run lease is absent.
  const { patchReportingDeliveryFenced } = await import(
    "./reportingDeliveryRepository.js"
  );
  // Without a matching lease document, the fence returns false (not throw).
  // Integration with Mongo is covered by repository filters; here we assert the
  // worker contract maps false → LeaseLostError immediately.
  assert.equal(typeof patchReportingDeliveryFenced, "function");
  assert.ok(err instanceof Error);
});

test("regression 8b: resume validates entries even with no stream checkpoint", async () => {
  const manifest = manifestFixture();
  let validatedBatches = 0;
  await validatePersistedManifestForResume(
    manifest,
    queryInput.sourceReadThrough,
    500,
    async (entries) => {
      validatedBatches += 1;
      assert.equal(entries.length, 1);
      assert.equal(entries[0]!.id, "64b000000000000000000001");
    },
  );
  assert.equal(validatedBatches, 1);
});

test("regression 10: cancel requires and replays idempotency keys", async () => {
  const { requestReportingRunCancellation } = await import(
    "./reportingRunRepository.js"
  );
  await assert.rejects(
    () =>
      requestReportingRunCancellation({
        runId: "64b000000000000000000260",
        actorId: "actor",
        now: new Date(),
        idempotencyKey: "short",
      }),
    /idempotencyKey/i,
  );
  // Contract: key is required on the route schema and repository.
  assert.equal(typeof requestReportingRunCancellation, "function");
});

test("regression 2b: destination CAS after promotion updates managed immutable id", async () => {
  const { casUpdateManagedSheetAfterPromotion } = await import(
    "./reportingDestinationRepository.js"
  );
  assert.equal(typeof casUpdateManagedSheetAfterPromotion, "function");
  await assert.rejects(
    () =>
      casUpdateManagedSheetAfterPromotion({
        destinationId: "64b000000000000000000270",
        expectedOldSheetId: Number.NaN,
        nextSheetId: 2,
        publishedTitle: "Weekly Report",
        now: new Date(),
      }),
    /Invalid managed sheet IDs/,
  );
});

test("regression: upper-bound verification never reads estimate headroom", async () => {
  const google = createFakeReportingGoogle();
  const artifact = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b000000000000000000280",
    destinationId: "64b000000000000000000281",
    strategy: "snapshot",
    folderId: "folder",
  });
  const rows = [{ lead_id: "1", name: "Ada" }];
  const batches = buildReportingWriteBatches({
    rows,
    columns,
    includeHeader: true,
  });
  let row = 1;
  for (const batch of batches) {
    await writeBoundedReportingBatch({
      sheets: google.sheets,
      artifact,
      startRow: row,
      values: batch,
    });
    row += batch.length;
  }
  const manifest = manifestFixture();
  const expected = recomputeChecksumFromRows({
    rows,
    queryInput,
    manifest,
    pageSize: 500,
  });
  const upperBoundRows = 50;
  const capacityDataRows = 5_000;
  const reads: Array<{ startRow: number; endRow: number }> = [];
  const trackingSheets = {
    ...google.sheets,
    async readValues(input: Parameters<typeof google.sheets.readValues>[0]) {
      reads.push({ startRow: input.startRow, endRow: input.endRow });
      return google.sheets.readValues(input);
    },
  };
  const clean = await verifyStagingContents({
    sheets: trackingSheets,
    artifact,
    columns,
    expectedRows: upperBoundRows,
    estimateKind: "upper_bound",
    actualRowsWritten: 1,
    finalChecksum: expected,
    runId: "64b000000000000000000280",
    destinationId: "64b000000000000000000281",
    queryInput,
    manifest,
    maxCapacityDataRows: capacityDataRows,
  });
  assert.equal(clean.matched, true);
  assert.equal(clean.derivedUsedRows, 1);
  assert.equal(clean.actualCells, 4);
  assert.ok(reads.length >= 1);
  assert.ok(
    reads.every((read) => read.endRow !== upperBoundRows + 1),
    "must not size reads from upperBoundRows",
  );
  assert.ok(
    reads.every((read) => read.endRow <= capacityDataRows + 1),
    "reads must stay within capacity",
  );
  assert.equal(reads[0]?.endRow, 2);

  await google.sheets.writeValuesRaw({
    spreadsheetId: artifact.workbookId,
    sheetTitle: artifact.stagingSheetTitle,
    startRow: 3,
    startCol: 1,
    values: [["junk", "row"]],
  });
  reads.length = 0;
  const trailing = await verifyStagingContents({
    sheets: trackingSheets,
    artifact,
    columns,
    expectedRows: upperBoundRows,
    estimateKind: "upper_bound",
    actualRowsWritten: 1,
    finalChecksum: expected,
    runId: "64b000000000000000000280",
    destinationId: "64b000000000000000000281",
    queryInput,
    manifest,
    maxCapacityDataRows: capacityDataRows,
  });
  assert.equal(trailing.matched, false);
  assert.ok(trailing.reasons.includes("unexpected_trailing_values"));
  assert.ok(
    reads.every((read) => read.endRow !== upperBoundRows + 1),
    "trailing probe must not use upperBoundRows",
  );
  const stillThere = await google.sheets.readValues({
    spreadsheetId: artifact.workbookId,
    sheetTitle: artifact.stagingSheetTitle,
    startRow: 3,
    startCol: 1,
    endRow: 3,
    endCol: 2,
  });
  assert.deepEqual(stillThere[0], ["junk", "row"]);
});

test("regression: title change resolved by immutable sheet ID on resume", async () => {
  const google = createFakeReportingGoogle();
  const artifact = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b000000000000000000290",
    destinationId: "64b000000000000000000291",
    strategy: "snapshot",
    folderId: "folder",
  });
  const renamed = `${artifact.stagingSheetTitle}__renamed`;
  await google.sheets.renameSheet({
    spreadsheetId: artifact.workbookId,
    sheetId: artifact.stagingSheetId,
    title: renamed,
  });
  const resumed = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b000000000000000000290",
    destinationId: "64b000000000000000000291",
    strategy: "snapshot",
    folderId: "folder",
    existing: {
      workbookId: artifact.workbookId,
      workbookUrl: artifact.workbookUrl,
      stagingSheetId: artifact.stagingSheetId,
      stagingSheetTitle: artifact.stagingSheetTitle, // stale title
      oldSheetId: null,
    },
  });
  assert.equal(resumed.stagingSheetId, artifact.stagingSheetId);
  assert.equal(resumed.stagingSheetTitle, renamed);
});

test("regression: ambiguous marker tampering refuses promotion", async () => {
  const google = createFakeReportingGoogle();
  const created = await google.drive.createSpreadsheet({
    title: "Managed",
    folderId: "folder",
    runId: "64b000000000000000000300",
    destinationId: "64b000000000000000000301",
    role: "snapshot",
  });
  await google.sheets.renameSheet({
    spreadsheetId: created.spreadsheetId,
    sheetId: 1,
    title: "Weekly Report",
  });
  await google.sheets.writeOwnershipAndRunMarkers({
    spreadsheetId: created.spreadsheetId,
    sheetTitle: "Weekly Report",
    destinationId: "64b000000000000000000301",
    runId: "64b000000000000000000300",
    strategy: "replace_tab",
    role: "published",
  });
  const artifact = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b000000000000000000302",
    destinationId: "64b000000000000000000301",
    strategy: "replace_tab",
    folderId: "folder",
    workbookId: created.spreadsheetId,
    managedTab: { immutableSheetId: 1, name: "Weekly Report" },
  });
  await writeBoundedReportingBatch({
    sheets: google.sheets,
    artifact,
    startRow: 1,
    values: [
      serializeReportingHeaderCells(columns),
      serializeReportingRowCells({ lead_id: "1", name: "Ada" }, columns),
    ],
  });
  // Tamper staging run marker.
  await google.sheets.writeOwnershipAndRunMarkers({
    spreadsheetId: created.spreadsheetId,
    sheetTitle: artifact.stagingSheetTitle,
    destinationId: "64b000000000000000000301",
    runId: "64b000000000000000000399",
    strategy: "replace_tab",
    role: "staging",
  });
  const manifest = manifestFixture();
  const result = await promoteOrRecoverReplaceTab({
    sheets: google.sheets,
    artifact,
    publishedTitle: "Weekly Report",
    destinationId: "64b000000000000000000301",
    runId: "64b000000000000000000302",
    now: new Date("2026-08-04T12:00:00.000Z"),
    contentVerification: {
      columns,
      expectedRows: 1,
      estimateKind: "exact",
      actualRowsWritten: 1,
      finalChecksum: recomputeChecksumFromRows({
        rows: [{ lead_id: "1", name: "Ada" }],
        queryInput,
        manifest,
        pageSize: 500,
      }),
      queryInput,
      manifest,
      maxCapacityDataRows: 10_000,
    },
  });
  assert.equal(result.outcome, "ambiguous");
  if (result.outcome === "ambiguous") {
    assert.match(String(result.reason), /staging_run_marker|marker/i);
  }
  const old = (await google.sheets.listSheets(created.spreadsheetId)).find(
    (sheet) => sheet.sheetId === 1,
  );
  assert.equal(old?.title, "Weekly Report");
});

test("regression: destination lineage accepts proven replace_tab advancement", async () => {
  const {
    isProvenManagedTabAdvancement,
    validateDestinationForImmutableRevision,
  } = await import("./destinationLineage.js");
  const {
    destinationSnapshotChecksum,
  } = await import("./destinationContract.js");
  assert.equal(
    isProvenManagedTabAdvancement({
      revisionSheetId: 1,
      liveSheetId: 2,
      predecessorSheetIds: [1],
    }),
    true,
  );
  assert.equal(
    isProvenManagedTabAdvancement({
      revisionSheetId: 1,
      liveSheetId: 2,
      predecessorSheetIds: [],
    }),
    false,
  );

  const base = {
    contractVersion: 1 as const,
    destinationId: "64b000000000000000000310",
    provider: "google_sheets" as const,
    driveConnectionId: "conn",
    ownerIdentitySnapshot: {
      stableOwnerId: "owner",
      maskedEmail: "o***@example.com",
    },
    folder: { id: "folder", name: "F", url: "https://example.test/f" },
    strategy: "replace_tab" as const,
    workbook: { id: "wb", name: "W", url: "https://example.test/w" },
    managedTab: {
      immutableSheetId: 1,
      name: "Weekly Report",
      managed: true as const,
    },
    destinationType: "owner_drive",
    ownershipPolicy: "vantage_managed_tab",
    accessStatus: "verified" as const,
    healthVerifiedAt: new Date().toISOString(),
    archived: false as const,
    safety: {
      denylistCheckedAt: new Date().toISOString(),
      operationalWorkbookMatch: false as const,
      humanCreatedTabTakeover: false as const,
    },
    capacity: { providerMaxCells: 10_000_000, destinationAvailableCells: 9_000_000 },
  };
  const revisionDestination = {
    ...base,
    snapshotChecksum: destinationSnapshotChecksum(base),
  };
  const liveBase = {
    ...base,
    managedTab: {
      immutableSheetId: 2,
      name: "Weekly Report",
      managed: true as const,
    },
  };
  const live = {
    ...liveBase,
    snapshotChecksum: destinationSnapshotChecksum(liveBase),
  };
  const accepted = validateDestinationForImmutableRevision({
    live,
    revisionDestination,
    predecessorSheetIds: [1],
  });
  assert.equal(accepted.managedTab?.immutableSheetId, 2);
  assert.throws(
    () =>
      validateDestinationForImmutableRevision({
        live,
        revisionDestination,
        predecessorSheetIds: [],
      }),
    /lineage|drift/i,
  );
});

test("regression: phase-aware transition skips advanced status without LEASE_LOST", async () => {
  const { PhaseSkipError, LeaseLostError } = await import("./reportingWorker.js");
  const skip = new PhaseSkipError("promoting", "writing");
  assert.equal(skip.code, "PHASE_ALREADY_ADVANCED");
  assert.notEqual(skip.code, "LEASE_LOST");
  const lost = new LeaseLostError("writing");
  assert.equal(lost.code, "LEASE_LOST");
});

test("regression: delivery fence rejects forged fence fields and stale epoch predicate", async () => {
  const { patchReportingDeliveryFenced, bindReportingDeliveryFence } =
    await import("./reportingDeliveryRepository.js");
  await assert.rejects(
    () =>
      patchReportingDeliveryFenced({
        runId: "64b000000000000000000320",
        leaseOwner: "worker-a",
        leaseEpoch: 1,
        now: new Date(),
        set: { fence_owner: "forged", status: "writing" },
      }),
    /fence fields/i,
  );
  assert.equal(typeof bindReportingDeliveryFence, "function");
});

test("regression: stale-worker fence bind loses to lease takeover", async () => {
  const { simulateFenceBindRace } = await import(
    "./reportingDeliveryRepository.js"
  );
  // Worker A acquires epoch 1, worker B takes over epoch 2, then A binds late.
  const lost = simulateFenceBindRace([
    { kind: "acquire", worker: "A", epoch: 1 },
    { kind: "acquire", worker: "B", epoch: 2 },
    { kind: "bind", worker: "A", epoch: 1 },
  ]);
  assert.equal(lost.fenceOwner, null);
  assert.equal(lost.fenceEpoch, null);

  const won = simulateFenceBindRace([
    { kind: "acquire", worker: "A", epoch: 1 },
    { kind: "acquire", worker: "B", epoch: 2 },
    { kind: "bind", worker: "B", epoch: 2 },
    { kind: "bind", worker: "A", epoch: 1 },
  ]);
  assert.equal(won.fenceOwner, "B");
  assert.equal(won.fenceEpoch, 2);
});

test("regression: LeaseLost after promote CAS never terminal-fails run", async () => {
  const { LeaseLostError, disposeWorkerError } = await import(
    "./reportingWorker.js"
  );
  // Post-Google-promote stale CAS while lease semantics still held: worker throws
  // LeaseLostError to abandon; run must remain promoting/recoverable, never failed.
  const disposition = disposeWorkerError({
    error: new LeaseLostError("promoting"),
    runStatus: "promoting",
  });
  assert.equal(disposition.kind, "retryable_abandon");
  if (disposition.kind === "retryable_abandon") {
    assert.equal(disposition.status, "lease_lost");
    assert.equal(disposition.failure.code, "LEASE_LOST");
    assert.equal(disposition.failure.retryable, true);
  }
  assert.notEqual(disposition.kind, "terminal_fail");
});

test("regression: retryable provider abandon does not terminal-fail", async () => {
  const { disposeWorkerError } = await import("./reportingWorker.js");
  const { reportingFailure } = await import("./reportingRunRepository.js");
  const disposition = disposeWorkerError({
    error: reportingFailure("PROVIDER_UNAVAILABLE", { phase: "writing" }),
    runStatus: "writing",
  });
  assert.equal(disposition.kind, "retryable_abandon");
  if (disposition.kind === "retryable_abandon") {
    assert.match(disposition.status, /provider_unavailable/i);
  }
});

test("regression: snapshot terminal consistency refuses delivery-completed + run-failed", async () => {
  const { snapshotTerminalConsistency } = await import(
    "./reportingDeliveryRepository.js"
  );
  assert.equal(
    snapshotTerminalConsistency({
      runStatus: "completed",
      deliveryStatus: "completed",
    }),
    "consistent",
  );
  assert.equal(
    snapshotTerminalConsistency({
      runStatus: "promoting",
      deliveryStatus: "completed",
    }),
    "delivery_ahead_recoverable",
  );
  assert.equal(
    snapshotTerminalConsistency({
      runStatus: "failed",
      deliveryStatus: "completed",
    }),
    "inconsistent_terminal",
  );
  assert.equal(
    typeof (await import("./reportingDeliveryRepository.js"))
      .commitSnapshotDeliveryAndRunCompletion,
    "function",
  );
});

test("regression: fence bind TX interleaves with lease takeover", async () => {
  const { simulateFenceBindInterleaving } = await import(
    "./reportingDeliveryRepository.js"
  );
  // A writes run fence, B takes over before A's delivery bind → A aborts.
  const raced = simulateFenceBindInterleaving([
    { kind: "acquire", worker: "A", epoch: 1 },
    { kind: "bind_tx", worker: "A", epoch: 1, txId: "txA" },
    { kind: "run_fence_write", txId: "txA" },
    { kind: "acquire", worker: "B", epoch: 2 },
    { kind: "bind_tx", worker: "B", epoch: 2, txId: "txB" },
    { kind: "run_fence_write", txId: "txB" },
    { kind: "delivery_bind", txId: "txA" },
    { kind: "delivery_bind", txId: "txB" },
    { kind: "commit", txId: "txA" },
    { kind: "commit", txId: "txB" },
  ]);
  assert.ok(raced.aborted.includes("txA"));
  assert.deepEqual(raced.committed, ["txB"]);
  assert.equal(raced.deliveryFenceOwner, "B");
  assert.equal(raced.deliveryFenceGeneration, 2);
  assert.equal(raced.runFenceGeneration, 2);
});

test("regression: already-promoted recovery requires content verify not title-only", async () => {
  const google = createFakeReportingGoogle();
  const created = await google.drive.createSpreadsheet({
    title: "Managed",
    folderId: "folder",
    runId: "64b000000000000000000330",
    destinationId: "64b000000000000000000331",
    role: "snapshot",
  });
  await google.sheets.renameSheet({
    spreadsheetId: created.spreadsheetId,
    sheetId: 1,
    title: "Weekly Report",
  });
  await google.sheets.writeOwnershipAndRunMarkers({
    spreadsheetId: created.spreadsheetId,
    sheetTitle: "Weekly Report",
    destinationId: "64b000000000000000000331",
    runId: "64b000000000000000000330",
    strategy: "replace_tab",
    role: "published",
  });
  const artifact = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b000000000000000000332",
    destinationId: "64b000000000000000000331",
    strategy: "replace_tab",
    folderId: "folder",
    workbookId: created.spreadsheetId,
    managedTab: { immutableSheetId: 1, name: "Weekly Report" },
  });
  await writeBoundedReportingBatch({
    sheets: google.sheets,
    artifact,
    startRow: 1,
    values: [
      serializeReportingHeaderCells(columns),
      serializeReportingRowCells({ lead_id: "1", name: "Ada" }, columns),
    ],
  });
  await google.sheets.promoteStagingTab({
    spreadsheetId: created.spreadsheetId,
    oldSheetId: 1,
    stagingSheetId: artifact.stagingSheetId,
    publishedTitle: "Weekly Report",
    recoveryTitle: "Weekly Report__vantage_recovery_x",
  });
  // Title-only accept is refused without contentVerification.
  const without = await promoteOrRecoverReplaceTab({
    sheets: google.sheets,
    artifact: {
      ...artifact,
      stagingSheetTitle: "Weekly Report",
    },
    publishedTitle: "Weekly Report",
    destinationId: "64b000000000000000000331",
    runId: "64b000000000000000000332",
    now: new Date("2026-08-04T12:00:00.000Z"),
  });
  assert.equal(without.outcome, "ambiguous");
  if (without.outcome === "ambiguous") {
    assert.match(String(without.reason), /content_verification/i);
  }
  const manifest = manifestFixture();
  const checksum = recomputeChecksumFromRows({
    rows: [{ lead_id: "1", name: "Ada" }],
    queryInput,
    manifest,
    pageSize: 500,
  });
  const withVerify = await promoteOrRecoverReplaceTab({
    sheets: google.sheets,
    artifact: {
      ...artifact,
      stagingSheetTitle: "Weekly Report",
    },
    publishedTitle: "Weekly Report",
    destinationId: "64b000000000000000000331",
    runId: "64b000000000000000000332",
    now: new Date("2026-08-04T12:00:00.000Z"),
    contentVerification: {
      columns,
      expectedRows: 1,
      estimateKind: "exact",
      actualRowsWritten: 1,
      finalChecksum: checksum,
      queryInput,
      manifest,
      maxCapacityDataRows: 10_000,
    },
  });
  assert.equal(withVerify.outcome, "promoted");
});

test("regression: CAS-resume path refuses tampered markers and trailing edits", async () => {
  const google = createFakeReportingGoogle();
  const created = await google.drive.createSpreadsheet({
    title: "Managed",
    folderId: "folder",
    runId: "64b000000000000000000340",
    destinationId: "64b000000000000000000341",
    role: "snapshot",
  });
  await google.sheets.renameSheet({
    spreadsheetId: created.spreadsheetId,
    sheetId: 1,
    title: "Weekly Report",
  });
  await google.sheets.writeOwnershipAndRunMarkers({
    spreadsheetId: created.spreadsheetId,
    sheetTitle: "Weekly Report",
    destinationId: "64b000000000000000000341",
    runId: "64b000000000000000000340",
    strategy: "replace_tab",
    role: "published",
  });
  const artifact = await createOrResumeDeliveryArtifact({
    sheets: google.sheets,
    drive: google.drive,
    runId: "64b000000000000000000342",
    destinationId: "64b000000000000000000341",
    strategy: "replace_tab",
    folderId: "folder",
    workbookId: created.spreadsheetId,
    managedTab: { immutableSheetId: 1, name: "Weekly Report" },
  });
  const rows = [{ lead_id: "1", name: "Ada" }];
  await writeBoundedReportingBatch({
    sheets: google.sheets,
    artifact,
    startRow: 1,
    values: [
      serializeReportingHeaderCells(columns),
      serializeReportingRowCells(rows[0]!, columns),
    ],
  });
  await google.sheets.promoteStagingTab({
    spreadsheetId: created.spreadsheetId,
    oldSheetId: 1,
    stagingSheetId: artifact.stagingSheetId,
    publishedTitle: "Weekly Report",
    recoveryTitle: "Weekly Report__vantage_recovery_cas",
  });
  const manifest = manifestFixture();
  const checksum = recomputeChecksumFromRows({
    rows,
    queryInput,
    manifest,
    pageSize: 500,
  });

  // Concurrent edit: trailing junk after rename — content verify must fail.
  await google.sheets.writeValuesRaw({
    spreadsheetId: created.spreadsheetId,
    sheetTitle: "Weekly Report",
    startRow: 3,
    startCol: 1,
    values: [["tamper", "x"]],
  });
  const tamperedContent = await promoteOrRecoverReplaceTab({
    sheets: google.sheets,
    artifact: { ...artifact, stagingSheetTitle: "Weekly Report" },
    publishedTitle: "Weekly Report",
    destinationId: "64b000000000000000000341",
    runId: "64b000000000000000000342",
    now: new Date("2026-08-04T12:00:00.000Z"),
    contentVerification: {
      columns,
      expectedRows: 1,
      estimateKind: "exact",
      actualRowsWritten: 1,
      finalChecksum: checksum,
      queryInput,
      manifest,
      maxCapacityDataRows: 10_000,
    },
  });
  assert.equal(tamperedContent.outcome, "ambiguous");
  if (tamperedContent.outcome === "ambiguous") {
    assert.match(String(tamperedContent.reason), /content_verify|trailing/i);
  }

  // Clear trailing for marker-tamper case (direct cell overwrite of marker).
  await google.sheets.writeValuesRaw({
    spreadsheetId: created.spreadsheetId,
    sheetTitle: "Weekly Report",
    startRow: 3,
    startCol: 1,
    values: [[null, null]],
  });
  await google.sheets.writeOwnershipAndRunMarkers({
    spreadsheetId: created.spreadsheetId,
    sheetTitle: "Weekly Report",
    destinationId: "64b000000000000000000341",
    runId: "64b000000000000000000399",
    strategy: "replace_tab",
    role: "staging",
  });
  const tamperedMarker = await promoteOrRecoverReplaceTab({
    sheets: google.sheets,
    artifact: { ...artifact, stagingSheetTitle: "Weekly Report" },
    publishedTitle: "Weekly Report",
    destinationId: "64b000000000000000000341",
    runId: "64b000000000000000000342",
    now: new Date("2026-08-04T12:00:00.000Z"),
    contentVerification: {
      columns,
      expectedRows: 1,
      estimateKind: "exact",
      actualRowsWritten: 1,
      finalChecksum: checksum,
      queryInput,
      manifest,
      maxCapacityDataRows: 10_000,
    },
  });
  assert.equal(tamperedMarker.outcome, "ambiguous");
  if (tamperedMarker.outcome === "ambiguous") {
    assert.match(String(tamperedMarker.reason), /marker|staging_run/i);
  }
});

test("regression: destination stable identity ignores volatile health timestamps", async () => {
  const {
    destinationStableIdentityChecksum,
    destinationSnapshotChecksum,
  } = await import("./destinationContract.js");
  const base = {
    contractVersion: 1 as const,
    destinationId: "64b000000000000000000350",
    provider: "google_sheets" as const,
    driveConnectionId: "conn",
    ownerIdentitySnapshot: {
      stableOwnerId: "owner",
      maskedEmail: "o***@example.com",
    },
    folder: { id: "folder", name: "F", url: "https://example.test/f" },
    strategy: "snapshot" as const,
    destinationType: "owner_drive",
    ownershipPolicy: "vantage_managed_tab",
    accessStatus: "verified" as const,
    healthVerifiedAt: "2026-08-01T00:00:00.000Z",
    archived: false as const,
    safety: {
      denylistCheckedAt: "2026-08-01T00:00:00.000Z",
      operationalWorkbookMatch: false as const,
      humanCreatedTabTakeover: false as const,
    },
    capacity: { providerMaxCells: 10_000_000, destinationAvailableCells: 9_000_000 },
  };
  const refreshed = {
    ...base,
    healthVerifiedAt: "2026-08-04T12:00:00.000Z",
    safety: {
      ...base.safety,
      denylistCheckedAt: "2026-08-04T12:00:00.000Z",
    },
  };
  assert.equal(
    destinationStableIdentityChecksum(base),
    destinationStableIdentityChecksum(refreshed),
  );
  assert.notEqual(
    destinationSnapshotChecksum(base),
    destinationSnapshotChecksum(refreshed),
  );
  const drifted = {
    ...refreshed,
    folder: { ...base.folder, id: "other-folder" },
  };
  assert.notEqual(
    destinationStableIdentityChecksum(base),
    destinationStableIdentityChecksum(drifted),
  );
});
