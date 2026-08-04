import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import mongoose from "mongoose";
import { parseReportingEnabledDatasets } from "../../config/domain/reporting";
import { ReportingDefinition } from "../../models/ReportingDefinition";
import { ReportingDefinitionRevision } from "../../models/ReportingDefinitionRevision";
import { ReportingPreview } from "../../models/ReportingPreview";
import { ReportingRun } from "../../models/ReportingRun";
import { ReportingRunConfirmation } from "../../models/ReportingRunConfirmation";
import { BookedLead } from "../../models/BookedLead";
import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { CancelledLead } from "../../models/CancelledLead";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { IngestionConflict } from "../../models/IngestionConflict";
import { assertRevisionBulkWriteIsInsertOnly } from "../../models/ReportingDefinitionRevision";
import { computeChecksum } from "../durableWork";
import {
  EXCEPTION_TYPES,
  getReportingCatalog,
  LEAD_OUTCOME_COLUMNS,
  SOURCE_PERFORMANCE_MEASURES,
} from "./catalog";
import {
  destinationSnapshotChecksum,
  destinationStableIdentityChecksum,
  FakeReportingDestinationPort,
  validateDestinationSnapshot,
  type ValidatedReportingDestinationSnapshotV1,
} from "./destinationContract";
import {
  aggregateSourcePerformance,
  assertGlobalMaterializationBudget,
  assertWithinQueryBudget,
  buildReportingCandidateManifest,
  buildScopedUnresolvedCancellationPipeline,
  CanonicalSourceChangedError,
  choosePrimaryBooking,
  deriveReportingEstimate,
  isUnresolvedCplStatus,
  queryReportingPage,
  registryHierarchyPredicate,
  representativeSampleRows,
  sourcePerformanceGroupIdentity,
  validateReportingManifestEntries,
} from "./query/canonicalReporting";
import { decodeCursor, paginateRows } from "./query/pagination";
import { resolveLocalWindow, resolveReportingDateWindow, localBoundaryToUtc } from "./timezone";
import { reportingDateWindowSchema, reportingDraftSchema, runRequestSchema, validateAndBuildEffectiveSort, validateReportingDraft } from "../../validation/reporting.validation";
import {
  assertIdempotencyFingerprint,
  assertEstimateFitsCapacity,
  assertRevisionChecksum,
  buildExecutionPackage,
  canonicalRevisionSnapshot,
  confirmationImmutableFingerprint,
  createOpaqueSampleEvidence,
  reportingActorFingerprint,
  serializePersistedRunReplay,
  isMongoDuplicateKeyError,
  type ReportingExecutionPackageV1,
  type ReportingRevisionSnapshotV1,
} from "./reporting.service";
import {
  InvalidReportingObjectIdError,
  ReportingGoogleDeliveryDisabledError,
  safeReportingRunForRead,
  serializeReportingRouteError,
} from "../../routes/reporting.routes";
import {
  assertSafeReportingFailure,
  reportingCheckpoint,
  reportingFailure,
  reportingSourceCaptureFilter,
  safeReportingFailureForRead,
} from "./reportingRunRepository";
import { RegistryError } from "../operationsRegistry/errors";
import { REGISTRY_ERROR_CODES } from "../errors/registryErrorCodes";
import {
  getReportingSnapshotAdapter,
  setReportingSnapshotAdapter,
  SnapshotConsistencyUnavailableError,
  type ReportingSnapshotAdapter,
} from "./snapshotAdapter";
import { buildReportingAuditDetails } from "./reportingAudit";

test("catalog contains exactly three code-defined @1 datasets and complete contracts", () => {
  const catalog = getReportingCatalog(new Set([
    "lead_outcome_detail", "lead_quality_exceptions", "source_performance",
  ]));
  assert.deepEqual(catalog.datasets.map((dataset) => `${dataset.key}@${dataset.schemaVersion}`), [
    "lead_outcome_detail@1", "lead_quality_exceptions@1", "source_performance@1",
  ]);
  assert.equal(LEAD_OUTCOME_COLUMNS.length, 31);
  assert.equal(EXCEPTION_TYPES.length, 8);
  assert.equal(SOURCE_PERFORMANCE_MEASURES.length, 14);
  assert.equal(catalog.manualOnly, true);
  assert.deepEqual(catalog.dateWindow.rolling, {
    presets: ["last_n_days"],
    minDays: 1,
    maxDays: 366,
    anchor: "preview_or_run_time",
    endPolicy: "include_current_local_day",
  });
  for (const dataset of catalog.datasets) {
    assert.equal(dataset.filterSchema.unknownKeys, "reject");
    assert.deepEqual(
      dataset.filterSchema.fields.map((field) => field.id),
      dataset.filterKeys,
    );
    assert.equal(dataset.samplePolicyVersion, 1);
  }
});

test("owner sorts reject internal and duplicate terms and append ASC tie-breakers", () => {
  const detail = getReportingCatalog().datasets.find(
    (dataset) => dataset.key === "lead_outcome_detail",
  )!;
  assert.deepEqual(
    validateAndBuildEffectiveSort(detail, [{
      id: "customer_name",
      direction: "desc",
    }]),
    [
      { id: "customer_name", direction: "desc" },
      { id: "lead_type", direction: "asc" },
      { id: "lead_id", direction: "asc" },
    ],
  );
  assert.throws(
    () => validateAndBuildEffectiveSort(detail, [
      { id: "lead_timestamp", direction: "asc" },
      { id: "lead_timestamp", direction: "desc" },
    ]),
    /unique/,
  );
  assert.throws(
    () => validateAndBuildEffectiveSort(detail, [{
      id: "lead_id",
      direction: "desc",
    }]),
    /owner-visible/,
  );
});

test("deployment allowlist defaults, narrows, and rejects unknown or duplicate tokens", () => {
  assert.equal(parseReportingEnabledDatasets("").size, 3);
  assert.deepEqual([...parseReportingEnabledDatasets("source_performance")], ["source_performance"]);
  assert.throws(() => parseReportingEnabledDatasets("source_performance,source_performance"), /duplicate/i);
  assert.throws(() => parseReportingEnabledDatasets("arbitrary_query"), /Unknown/);
});

test("strict request contracts reject caller scope and arbitrary dataset filters", async () => {
  const valid = draft();
  assert.throws(() => reportingDraftSchema.parse({ ...valid, database_scope: "historical" }));
  await assert.rejects(
    validateReportingDraft({ ...valid, filters: { arbitraryMongo: { $where: "true" } } }),
    /unrecognized|invalid/i,
  );
});

test("request bounds and formula-safe labels fail before database work", async () => {
  const valid = draft();
  assert.throws(() => reportingDraftSchema.parse({
    ...valid,
    selectedColumns: [{ id: "total_leads", label: "   =IMPORTDATA()" }],
  }), /formula/i);
  assert.throws(() => reportingDraftSchema.parse({
    ...valid,
    sources: { companyKeys: Array.from({ length: 51 }, (_, index) => `source_${index}`) },
  }));
  await assert.rejects(validateReportingDraft({
    ...valid,
    filters: { agentKeys: Array.from({ length: 101 }, (_, index) => `agent_${index}`) },
  }));
  await assert.rejects(validateReportingDraft({
    ...valid,
    dateWindow: { kind: "explicit", fromLocal: "2024-01-01", throughLocal: "2026-01-01" },
  }), /cannot exceed/i);
  assert.throws(() => runRequestSchema.parse({ revisionId: "a".repeat(24) }));
  assert.equal(runRequestSchema.parse({ idempotencyKey: "run-key-123" }).idempotencyKey, "run-key-123");
});

test("cancel wire contract requires idempotencyKey (admin clients must send it)", () => {
  // Mirrors POST /reporting/runs/:id/cancel body schema in reporting.routes.ts.
  const cancelBodySchema = z
    .object({
      idempotencyKey: z.string().trim().min(8).max(200),
    })
    .strict();
  assert.throws(() => cancelBodySchema.parse({}), /idempotencyKey|Required/i);
  assert.throws(
    () => cancelBodySchema.parse({ idempotencyKey: "short" }),
    /idempotencyKey|at least|min/i,
  );
  assert.equal(
    cancelBodySchema.parse({ idempotencyKey: "cancel-key-123" }).idempotencyKey,
    "cancel-key-123",
  );
});

test("New York date boundaries are half-open across 23 and 25 hour days", () => {
  const spring = resolveLocalWindow({
    fromLocal: "2026-03-08", throughLocal: "2026-03-08", timezone: "America/New_York",
  });
  assert.deepEqual(spring, {
    timezone: "America/New_York",
    fromUtc: "2026-03-08T05:00:00.000Z",
    toExclusiveUtc: "2026-03-09T04:00:00.000Z",
  });
  assert.equal(new Date(spring.toExclusiveUtc).getTime() - new Date(spring.fromUtc).getTime(), 23 * 3_600_000);
  const fall = resolveLocalWindow({
    fromLocal: "2026-11-01", throughLocal: "2026-11-01", timezone: "America/New_York",
  });
  assert.equal(new Date(fall.toExclusiveUtc).getTime() - new Date(fall.fromUtc).getTime(), 25 * 3_600_000);
  assert.throws(() => localBoundaryToUtc("2026-03-08T02:30:00", "America/New_York"), /Nonexistent/);
  assert.throws(() => localBoundaryToUtc("2026-11-01T01:30:00", "America/New_York"), /Ambiguous/);
  assert.notEqual(
    localBoundaryToUtc("2026-11-01T01:30:00", "America/New_York", "earlier").toISOString(),
    localBoundaryToUtc("2026-11-01T01:30:00", "America/New_York", "later").toISOString(),
  );
});

test("rolling windows are strict, bounded, fresh, and DST-aware", () => {
  const spec = reportingDateWindowSchema.parse({
    kind: "rolling",
    preset: "last_n_days",
    days: 2,
    anchor: "preview_or_run_time",
    endPolicy: "include_current_local_day",
  });
  const persistedSpec = structuredClone(spec);
  assert.deepEqual(
    resolveReportingDateWindow(
      spec,
      "America/New_York",
      new Date("2026-03-08T16:00:00Z"),
    ),
    {
      timezone: "America/New_York",
      fromUtc: "2026-03-07T05:00:00.000Z",
      toExclusiveUtc: "2026-03-09T04:00:00.000Z",
    },
  );
  assert.deepEqual(spec, persistedSpec);
  assert.notDeepEqual(
    resolveReportingDateWindow(
      spec,
      "America/New_York",
      new Date("2026-03-09T16:00:00Z"),
    ),
    resolveReportingDateWindow(
      spec,
      "America/New_York",
      new Date("2026-03-08T16:00:00Z"),
    ),
  );
  assert.throws(() => reportingDateWindowSchema.parse({
    kind: "rolling",
    preset: "last_n_days",
    days: 367,
    anchor: "preview_or_run_time",
    endPolicy: "include_current_local_day",
  }));
  assert.throws(() => reportingDateWindowSchema.parse({
    kind: "rolling",
    preset: "arbitrary",
    days: 7,
    anchor: "preview_or_run_time",
    endPolicy: "include_current_local_day",
  }));
});

test("source performance aggregates all related bookings with approved semantics", () => {
  const leads = [
    { _id: "l1", leadType: "form" as const, quoted: true, duplicate: false, cpl: 10.125, cpl_resolution_status: "resolved" },
    { _id: "l2", leadType: "call" as const, quoted: true, bad_lead: "spam", cpl: 20, cpl_resolution_status: "missing_rate" },
  ];
  const bookings = [
    { _id: "b1", lead_ref: "l1", total_binder_amount: 100.111, deposit_amount: 10 },
    { _id: "b2", lead_ref: "l1", total_binder_amount: 200.222, deposit_amount: 20 },
    { _id: "b3", lead_ref: "l2", total_binder_amount: 300.333, deposit_amount: 30 },
  ];
  const measures = aggregateSourcePerformance(leads, bookings, new Map([
    ["b2", [{}]], ["b3", [{}]],
  ]));
  assert.deepEqual(measures, {
    total_leads: 2, valid_leads: 1, duplicates: 0, bad_leads: 1,
    quoted_form_leads: 1, booked_leads: 2, cancelled_bookings: 2,
    net_bookings: 1, lead_to_booking_conversion: 1, net_conversion: 0.5,
    resolved_cpl_spend: 10.13, unresolved_cpl_count: 1,
    total_binder: 600.67, total_deposit: 60,
  });
  const empty = aggregateSourcePerformance([], [], new Map());
  assert.equal(empty.lead_to_booking_conversion, null);
  assert.equal(empty.net_conversion, null);
});

test("CPL unresolved semantics exclude resolved zero and not-applicable states", () => {
  assert.equal(isUnresolvedCplStatus("resolved"), false);
  assert.equal(isUnresolvedCplStatus("duplicate_zero"), false);
  assert.equal(isUnresolvedCplStatus("not_applicable"), false);
  assert.equal(isUnresolvedCplStatus("missing_rate"), true);
  assert.equal(isUnresolvedCplStatus(undefined), true);
  assert.equal(isUnresolvedCplStatus(null), true);
  const leads = [
    { _id: "f1", leadType: "form" as const, cpl_resolution_status: "resolved" },
    { _id: "f2", leadType: "form" as const, cpl_resolution_status: "duplicate_zero" },
    { _id: "c1", leadType: "call" as const, cpl_resolution_status: "not_applicable" },
    { _id: "c2", leadType: "call" as const, cpl_resolution_status: "missing_rate" },
  ];
  assert.equal(
    aggregateSourcePerformance(leads, [], new Map()).unresolved_cpl_count,
    1,
  );
});

test("source performance grouping uses stable IDs and ignores label drift", () => {
  const input = {
    ...queryInput(),
    datasetKey: "source_performance" as const,
    filters: { timeDimension: "month", includeGranularity: true },
  };
  const base = {
    timestamp: new Date("2026-05-10T12:00:00Z"),
    lead_source_company: "64b000000000000000000001",
    source_granularity_key: "forms",
  };
  assert.equal(
    sourcePerformanceGroupIdentity({
      ...base,
      source_company_label_snapshot: "Old Label",
    }, input).key,
    sourcePerformanceGroupIdentity({
      ...base,
      source_company_label_snapshot: "New Label",
    }, input).key,
  );
});

test("representative policies retain temporal and outcome or exception variation", () => {
  const details = Array.from({ length: 100 }, (_, index) => ({
    lead_timestamp: String(index).padStart(3, "0"),
    lead_type: index % 2 ? "form" : "call",
    booked: index === 50,
    cancelled_or_refunded: index === 75,
  }));
  const detailSample = representativeSampleRows(
    "lead_outcome_detail",
    details,
    50,
  );
  assert.equal(detailSample[0], details[0]);
  assert.equal(detailSample.at(-1), details.at(-1));
  assert.ok(detailSample.some((row) => row.booked === true));
  assert.ok(detailSample.some((row) => row.cancelled_or_refunded === true));
  const exceptions = Array.from({ length: 80 }, (_, index) => ({
    exception_timestamp: index,
    exception_type: EXCEPTION_TYPES[index % EXCEPTION_TYPES.length],
  }));
  const exceptionSample = representativeSampleRows(
    "lead_quality_exceptions",
    exceptions,
    50,
  );
  assert.deepEqual(
    new Set(exceptionSample.map((row) => row.exception_type)),
    new Set(EXCEPTION_TYPES),
  );
});

test("lead detail primary booking is one-row deterministic and prefers active state", () => {
  const bookings = [
    { _id: "b2", book_date: new Date("2026-06-03T00:00:00Z") },
    { _id: "b1", book_date: new Date("2026-06-02T00:00:00Z") },
    { _id: "b3", book_date: new Date("2026-06-01T00:00:00Z") },
  ];
  const cancellations = new Map([
    ["b2", [{ _id: "c1", booked_lead: "b2", cancel_date: new Date("2026-06-04T00:00:00Z") }]],
  ]);
  assert.equal(choosePrimaryBooking(bookings, cancellations)?._id, "b1");
  assert.equal(
    choosePrimaryBooking([bookings[1]!, { ...bookings[1]!, _id: "a1" }], new Map())?._id,
    "a1",
  );
});

test("keyset cursor covers rows once and checksums are deterministic", () => {
  const rows = [{ id: "a", value: 1 }, { id: "b", value: 2 }, { id: "c", value: 3 }];
  const sort = [{ id: "id", direction: "asc" as const }];
  const first = paginateRows(rows, sort, 2);
  const second = paginateRows(rows, sort, 2, first.nextCursor!);
  assert.deepEqual([...first.rows, ...second.rows], rows);
  assert.deepEqual(decodeCursor(first.nextCursor!).values, ["b"]);
  assert.equal(
    first.canonicalPageChecksum,
    paginateRows(structuredClone(rows), sort, 2).canonicalPageChecksum,
  );
  assert.equal(computeChecksum({
    checksum_version: 1, artifact_kind: "reporting_data", schema_version: 1, payload: rows,
  }), computeChecksum({
    checksum_version: 1, artifact_kind: "reporting_data", schema_version: 1, payload: structuredClone(rows),
  }));
});

test("destination port is injectable and fails closed on safety or checksum drift", async () => {
  const snapshot = destination();
  const fake = new FakeReportingDestinationPort();
  fake.add(snapshot);
  assert.deepEqual(await fake.getValidatedSnapshot(snapshot.destinationId), snapshot);
  assert.equal(validateDestinationSnapshot(snapshot, {
    destinationId: snapshot.destinationId, checksum: snapshot.snapshotChecksum, strategy: "snapshot",
  }).destinationId, snapshot.destinationId);
  assert.throws(() => validateDestinationSnapshot(
    { ...snapshot, safety: { ...snapshot.safety, operationalWorkbookMatch: true as false } },
    { destinationId: snapshot.destinationId, checksum: snapshot.snapshotChecksum, strategy: "snapshot" },
  ), /checksum|safety/i);
  assert.throws(() => validateDestinationSnapshot(snapshot, {
    destinationId: snapshot.destinationId, checksum: "0".repeat(64), strategy: "snapshot",
  }), /checksum/i);
});

test("destination verification timestamps must be finite, fresh, and not future-skewed", () => {
  for (const timestamp of [
    "not-a-date",
    new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  ]) {
    const snapshot = destinationWithTimes(timestamp, timestamp);
    assert.throws(() => validateDestinationSnapshot(snapshot, {
      destinationId: snapshot.destinationId,
      checksum: snapshot.snapshotChecksum,
      strategy: "snapshot",
    }), /stale/i);
  }
});

test("destination validation binds identity and strategy-specific shape", () => {
  const snapshot = destination();
  assert.throws(
    () =>
      validateDestinationSnapshot(snapshot, {
        destinationId: "different-destination",
        checksum: snapshot.snapshotChecksum,
        strategy: "snapshot",
      }),
    /identity mismatch/,
  );
  const unsafeSnapshot = destinationWithReplaceFields("snapshot");
  assert.throws(
    () =>
      validateDestinationSnapshot(unsafeSnapshot, {
        destinationId: unsafeSnapshot.destinationId,
        checksum: unsafeSnapshot.snapshotChecksum,
        strategy: "snapshot",
      }),
    /safety validation/,
  );
  const replace = destinationWithReplaceFields("replace_tab");
  assert.equal(
    validateDestinationSnapshot(replace, {
      destinationId: replace.destinationId,
      checksum: replace.snapshotChecksum,
      strategy: "replace_tab",
    }).managedTab?.immutableSheetId,
    123,
  );
});

test("unresolved cancellation pipeline scopes through canonical booking attribution", () => {
  const input = queryInput();
  const pipeline = buildScopedUnresolvedCancellationPipeline(input);
  assert.ok(pipeline.some((stage) => "$lookup" in stage));
  assert.ok(pipeline.some((stage) => "$unwind" in stage));
  const serialized = JSON.stringify(pipeline);
  assert.match(serialized, /booked_leads/);
  assert.match(serialized, /booking\.employee_source_snapshot\.lead_source_company/);
  assert.match(serialized, /booking\.employee_source_snapshot\.source_granularity_key/);
  assert.match(serialized, /booking_id/);
  assert.match(serialized, /booking_updatedAt/);
  assert.match(serialized, /form_lead_id/);
  assert.match(serialized, /form_lead_updatedAt/);
  assert.match(serialized, /call_lead_id/);
  assert.match(serialized, /call_lead_updatedAt/);
  assert.doesNotMatch(serialized, /source_company_key/);
});

test("every orphan predicate narrows granularities per parent company", () => {
  const registry = {
    companies: [
      { id: "64b000000000000000000001", key: "company_a", label: "A" },
      { id: "64b000000000000000000003", key: "company_b", label: "B" },
    ],
    granularities: [{
      id: "64b000000000000000000002",
      key: "forms",
      label: "Forms",
      companyId: "64b000000000000000000001",
    }],
  };
  const predicate = registryHierarchyPredicate(registry, {
    companyPath: "company",
    granularityPath: "granularity",
    companyValue: "id",
  }) as { $or: Array<Record<string, any>> };
  assert.deepEqual(predicate.$or, [
    {
      company: "64b000000000000000000001",
      granularity: { $in: ["forms"] },
    },
    { company: "64b000000000000000000003" },
  ]);
});

test("confirmation binds stable destination identity; health refresh stays valid", () => {
  withReportingSecrets(() => {
    const snap = destinationWithTimes(
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
    );
    const refreshedHealth = destinationWithTimes(
      "2026-08-04T12:00:00.000Z",
      "2026-08-04T12:00:00.000Z",
    );
    const stableA = destinationStableIdentityChecksum(snap);
    const stableB = destinationStableIdentityChecksum(refreshedHealth);
    assert.equal(stableA, stableB);
    assert.notEqual(snap.snapshotChecksum, refreshedHealth.snapshotChecksum);

    const owner = actor("owner-a");
    const fingerprintA = confirmationImmutableFingerprint({
      definitionId: "def",
      revisionId: "rev",
      revisionSnapshotChecksum: "a".repeat(64),
      destinationStableIdentityChecksum: stableA,
      queryInputChecksum: "b".repeat(64),
      estimateFingerprint: "c".repeat(64),
      actorFingerprint: reportingActorFingerprint(owner),
      idempotencyKey: "run-key-123",
    });
    const fingerprintB = confirmationImmutableFingerprint({
      definitionId: "def",
      revisionId: "rev",
      revisionSnapshotChecksum: "a".repeat(64),
      destinationStableIdentityChecksum: stableB,
      queryInputChecksum: "b".repeat(64),
      estimateFingerprint: "c".repeat(64),
      actorFingerprint: reportingActorFingerprint(owner),
      idempotencyKey: "run-key-123",
    });
    assert.equal(fingerprintA, fingerprintB);

    const drifted = confirmationImmutableFingerprint({
      definitionId: "def",
      revisionId: "rev",
      revisionSnapshotChecksum: "a".repeat(64),
      destinationStableIdentityChecksum: destinationStableIdentityChecksum({
        ...snap,
        folder: { ...snap.folder, id: "other" },
      }),
      queryInputChecksum: "b".repeat(64),
      estimateFingerprint: "c".repeat(64),
      actorFingerprint: reportingActorFingerprint(owner),
      idempotencyKey: "run-key-123",
    });
    assert.notEqual(fingerprintA, drifted);
  });
});

test("confirmation evidence binds actor, idempotency key, and immutable fingerprint", () => {
  withReportingSecrets(() => {
    const owner = actor("owner-a");
    const other = actor("owner-b");
    assert.notEqual(reportingActorFingerprint(owner), reportingActorFingerprint(other));
    const base = {
      confirmationId: "server-confirmation-id",
      actorFingerprint: reportingActorFingerprint(owner),
      idempotencyKey: "run-key-123",
      revisionSnapshotChecksum: "a".repeat(64),
    };
    const fingerprint = confirmationImmutableFingerprint(base);
    assert.notEqual(
      fingerprint,
      confirmationImmutableFingerprint({ ...base, idempotencyKey: "run-key-456" }),
    );
    assert.doesNotThrow(() => assertIdempotencyFingerprint(fingerprint, fingerprint));
    assert.throws(
      () => assertIdempotencyFingerprint(fingerprint, "different"),
      /different immutable inputs/i,
    );
    const persistedPackage = { contractVersion: 1, runId: "run-1" };
    assert.deepEqual(
      serializePersistedRunReplay({
        _id: "run-1",
        status: "queued",
        immutable_fingerprint: fingerprint,
        execution_package: persistedPackage,
      }, fingerprint),
      {
        runId: "run-1",
        status: "queued",
        executionPackage: persistedPackage,
        idempotentReplay: true,
      },
    );
  });
});

test("concurrent confirmation duplicate keys are recognized without a 500 race", () => {
  assert.equal(isMongoDuplicateKeyError({ code: 11000 }), true);
  assert.equal(isMongoDuplicateKeyError({ code: 11001 }), false);
  assert.equal(isMongoDuplicateKeyError(new Error("duplicate")), false);
});

test("snapshot adapter contract records a token and fails closed when unavailable", async () => {
  const fake: ReportingSnapshotAdapter = {
    async capture(read) {
      const value = await read({} as mongoose.ClientSession);
      return {
        value,
        token: {
          adapter: "mongodb_snapshot",
          operationTime: "100:1",
          capturedAt: "2026-06-01T00:00:00.000Z",
        },
      };
    },
  };
  assert.deepEqual(await fake.capture(async () => "captured"), {
    value: "captured",
    token: {
      adapter: "mongodb_snapshot",
      operationTime: "100:1",
      capturedAt: "2026-06-01T00:00:00.000Z",
    },
  });
  const unavailable = new SnapshotConsistencyUnavailableError();
  assert.equal(unavailable.code, "snapshot_consistency_unavailable");
  assert.equal(unavailable.retryable, true);
  const changed = new CanonicalSourceChangedError();
  assert.equal(changed.code, "canonical_source_changed");
  assert.equal(changed.retryable, true);
});

test("unchanged leadless booking manifest entries retain job and source fingerprints", async () => {
  await withLeadlessManifestFixture(async () => {
    const input = {
      ...queryInput(),
      sourceReadThrough: "2026-06-01T12:00:00.000Z",
    };
    const manifest = await buildReportingCandidateManifest(input);
    const bookingEntry = manifest.entries.find(
      (entry) => entry.model === "BookedLead",
    );

    assert.ok(bookingEntry);
    await assert.doesNotReject(() =>
      validateReportingManifestEntries(
        [bookingEntry],
        input.sourceReadThrough,
      ),
    );
  });
});

test("changed leadless booking job or source data invalidates its manifest entry", async () => {
  await withLeadlessManifestFixture(async (booking) => {
    const input = {
      ...queryInput(),
      sourceReadThrough: "2026-06-01T12:00:00.000Z",
    };
    const manifest = await buildReportingCandidateManifest(input);
    const bookingEntry = manifest.entries.find(
      (entry) => entry.model === "BookedLead",
    );
    assert.ok(bookingEntry);

    booking.job_no = "JOB-CHANGED";
    booking.employee_source_snapshot = {
      ...booking.employee_source_snapshot,
      source_granularity_key: "changed-source",
    };

    await assert.rejects(
      () =>
        validateReportingManifestEntries(
          [bookingEntry],
          input.sourceReadThrough,
        ),
      CanonicalSourceChangedError,
    );
  });
});

test("sample evidence is keyed opaque HMAC rather than raw SHA", () => {
  withReportingSecrets(() => {
    const sample = [{ customer_name: "Sensitive Name" }];
    const evidence = createOpaqueSampleEvidence(sample);
    const raw = computeChecksum({
      checksum_version: 1,
      artifact_kind: "reporting_sample",
      schema_version: 1,
      payload: sample,
    });
    assert.match(evidence, /^hmac-sha256-v1\./);
    assert.notEqual(evidence, raw);
    assert.equal(evidence, createOpaqueSampleEvidence(structuredClone(sample)));
  });
});

test("execution package mandates literal RAW spreadsheet writes", () => {
  const revision = {
    ...revisionFixture(),
    revision_snapshot_checksum: "d".repeat(64),
  } satisfies ReportingRevisionSnapshotV1;
  const destinationSnapshot = destination();
  const packageV1: ReportingExecutionPackageV1 = buildExecutionPackage(
    revision,
    {
      ...queryInput(),
      datasetKey: "source_performance",
      filters: { timeDimension: "none", includeGranularity: false },
      selectedColumns: revision.selected_columns,
      effectiveSort: revision.effective_sort,
    },
    {
      queryInputChecksum: "e".repeat(64),
      estimate: {
        kind: "exact",
        rows: 1,
        columns: 1,
        cellsIncludingHeader: 2,
        generatedAt: "2026-06-01T00:00:00.000Z",
      },
      warnings: [],
      intendedChanges: { action: "create_snapshot_workbook" },
    },
    destinationSnapshot,
    "64b000000000000000000099",
  );
  assert.deepEqual(packageV1.writeSemantics, {
    valueInputOption: "RAW",
    headers: "literal_strings",
    cells: "literal_values",
    formulasAllowed: false,
  });
  assert.equal(packageV1.acceptance.requireValueInputOptionRaw, true);
  assert.equal(packageV1.acceptance.rejectFormulaInterpretation, true);
});

test("query budgets reject oversized materialization and page requests before reads", async () => {
  assert.throws(
    () => assertWithinQueryBudget(51, 50, "cohort"),
    /safe query bound/,
  );
  await assert.rejects(
    queryReportingPage(queryInput(), 1001),
    /page size/i,
  );
  assert.doesNotThrow(() =>
    assertGlobalMaterializationBudget([
      { label: "a", count: 40 },
      { label: "b", count: 60 },
    ], 100),
  );
  assert.throws(
    () =>
      assertGlobalMaterializationBudget([
        { label: "a", count: 60 },
        { label: "b", count: 41 },
      ], 100),
    /Combined reporting branches/,
  );
});

test("estimates distinguish exact and safe upper bounds without truncation", () => {
  assert.deepEqual(deriveReportingEstimate({
    datasetKey: "lead_outcome_detail",
    cohortRows: 25,
    hasOutcomeFilters: false,
    orphanUpper: 0,
  }), { kind: "exact", rows: 25 });
  const upper = deriveReportingEstimate({
    datasetKey: "lead_quality_exceptions",
    cohortRows: 10,
    hasOutcomeFilters: false,
    orphanUpper: 7,
  });
  assert.equal(upper.kind, "upper_bound");
  assert.equal(upper.rows, 47);
  assert.match(upper.explanation, /four lead exceptions/);
  assert.doesNotThrow(() => assertEstimateFitsCapacity(upper, 2, 100));
  assert.throws(
    () => assertEstimateFitsCapacity(upper, 3, 100),
    /cannot prove/,
  );
  assert.equal(upper.rows, 47);
});

test("run failures are fixed safe envelopes and unsafe fields are never exposed", () => {
  const failure = reportingFailure("CANONICAL_SOURCE_CHANGED", {
    phase: "querying",
    model: "BookedLead",
    page_number: 3,
  });
  assert.doesNotThrow(() => assertSafeReportingFailure(failure));
  assert.equal(safeReportingFailureForRead(failure), failure);
  for (const unsafe of [
    {
      ...failure,
      raw_payload: { customer_name: "Sensitive Name" },
    },
    {
      ...failure,
      summary: "Customer Sensitive Name failed",
    },
    {
      ...failure,
      metadata: { nested: { phone: "555-1212" } },
    },
  ]) {
    assert.throws(() => assertSafeReportingFailure(unsafe));
    assert.equal(safeReportingFailureForRead(unsafe), null);
  }
  assert.equal(
    safeReportingRunForRead({
      _id: "run-1",
      failure: { raw_payload: { customer_name: "Sensitive Name" } },
      execution_package: { destination: { token: "secret" }, contractVersion: 1 },
    }).failure,
    null,
  );
});

test("reporting lifecycle audit payloads contain only safe identifiers and counts", () => {
  const details = buildReportingAuditDetails({
    action: "preview",
    outcome: "success",
    actor: actor("owner-a"),
    durationMs: 12.4,
    definitionId: "definition-1",
    revisionId: "revision-1",
    rowCount: 42,
    checksum: "a".repeat(64),
  });
  assert.deepEqual(details, {
    action: "preview",
    outcome: "success",
    actor_id: "owner-a",
    actor_type: "owner",
    duration_ms: 12,
    definition_id: "definition-1",
    revision_id: "revision-1",
    row_count: 42,
    checksum: "a".repeat(64),
  });
  assert.doesNotMatch(JSON.stringify(details), /name|phone|email|sample|token/i);
});

test("source read-through capture is fenced by active lease owner and epoch", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const filter = reportingSourceCaptureFilter({
    runId: "64b000000000000000000099",
    leaseOwner: "worker-a",
    leaseEpoch: 4,
    now,
  });
  assert.deepEqual(filter, {
    _id: new mongoose.Types.ObjectId("64b000000000000000000099"),
    status: "queued",
    lease_owner: "worker-a",
    lease_epoch: 4,
    leased_until: { $gt: now },
    source_read_through: null,
    query_plan_checksum: null,
  });
  assert.notEqual(filter.lease_epoch, 3);
  assert.deepEqual(filter.leased_until, { $gt: now });
});

test("revision checksum verification detects tampering and bulk mutation is blocked", () => {
  const revision = revisionFixture();
  revision.revision_snapshot_checksum = computeChecksum({
    checksum_version: 1,
    artifact_kind: "reporting_revision",
    schema_version: 1,
    payload: canonicalRevisionSnapshot(revision),
  });
  assert.doesNotThrow(() => assertRevisionChecksum(revision));
  assert.throws(
    () => assertRevisionChecksum({ ...revision, filters: { tampered: true } }),
    /checksum mismatch/i,
  );
  assert.doesNotThrow(() => assertRevisionBulkWriteIsInsertOnly([
    { insertOne: { document: revision } },
  ]));
  assert.throws(() => assertRevisionBulkWriteIsInsertOnly([
    { updateOne: { filter: {}, update: {} } },
  ]), /immutable/i);
});

test("unexpected reporting errors serialize to a generic 500 response", () => {
  const response = serializeReportingRouteError(
    new Error("mongodb://user:password@private-host/customer-name"),
  );
  assert.deepEqual(response, {
    status: 500,
    body: {
      ok: false,
      code: "reporting_internal_error",
      error: "Reporting request failed",
    },
  });
});

test("reporting routes preserve RegistryError status and reject malformed IDs", () => {
  const forbidden = new RegistryError("Owner role required.", {
    registryCode: REGISTRY_ERROR_CODES.FORBIDDEN,
  });
  assert.deepEqual(serializeReportingRouteError(forbidden), {
    status: 403,
    body: {
      ok: false,
      error: "Owner role required.",
      registry_code: REGISTRY_ERROR_CODES.FORBIDDEN,
    },
  });
  assert.deepEqual(
    serializeReportingRouteError(new InvalidReportingObjectIdError()),
    {
      status: 400,
      body: {
        ok: false,
        code: "invalid_object_id",
        error: "Invalid resource identifier",
      },
    },
  );
});

test("reporting routes expose the deployment kill switch without leaking config", () => {
  assert.deepEqual(
    serializeReportingRouteError(new ReportingGoogleDeliveryDisabledError()),
    {
      status: 503,
      body: {
        ok: false,
        code: "reporting_google_delivery_disabled",
        error: "Google reporting delivery is disabled by deployment configuration.",
      },
    },
  );
});

test("persistence models expose required indexes and immutable revision middleware", () => {
  type Index = [Record<string, number>, Record<string, any>];
  assert.ok((ReportingDefinition.schema.indexes() as Index[]).some(([index]) => index.state === 1 && index.updated_at === -1));
  assert.ok((ReportingDefinitionRevision.schema.indexes() as Index[]).some(([index, options]) => index.definition_id === 1 && index.revision_number === 1 && options.unique));
  assert.ok((ReportingPreview.schema.indexes() as Index[]).some(([index, options]) => index.expires_at === 1 && options.expireAfterSeconds === 0));
  assert.ok((ReportingRun.schema.indexes() as Index[]).some(([, options]) => options.name === "reporting_manual_run_idempotency" && options.unique));
  assert.ok((ReportingRunConfirmation.schema.indexes() as Index[]).some(([, options]) => options.name === "reporting_confirmation_idempotency" && options.unique));
  assert.ok((ReportingDefinitionRevision.schema as any).s.hooks._pres.get("updateOne")?.length);
  assert.ok((ReportingDefinitionRevision.schema as any).s.hooks._pres.get("findOneAndReplace")?.length);
  assert.ok((ReportingDefinitionRevision.schema as any).s.hooks._pres.get("bulkWrite")?.length);
  assert.ok((ReportingRun.schema as any).s.hooks._pres.get("updateOne")?.length);
  assert.ok((ReportingRun.schema as any).s.hooks._pres.get("findOneAndReplace")?.length);
  assert.ok((ReportingRun.schema as any).s.hooks._pres.get("bulkWrite")?.length);
  assert.deepEqual(
    reportingCheckpoint({
      version: 1,
      cursor: "next",
      pageNumber: 2,
      rowCount: 20,
      checksumAccumulator: "a".repeat(64),
    }, new Date("2026-06-01T00:00:00Z")),
    {
      version: 3,
      phase: "querying",
      cursor: {
        cursor: "next",
        checksum_accumulator: "a".repeat(64),
        row_count: 20,
        page_number: 2,
      },
      completed_units: 20,
      updated_at: new Date("2026-06-01T00:00:00Z"),
    },
  );
});

function draft() {
  return {
    name: "Owner report", description: "", datasetKey: "source_performance",
    datasetSchemaVersion: 1, timezone: "America/New_York",
    dateWindow: { kind: "explicit", fromLocal: "2026-05-01", throughLocal: "2026-05-31" },
    sources: { companyKeys: ["best_relocation"], granularityKeys: [] },
    filters: { timeDimension: "none", includeGranularity: false },
    selectedColumns: [{ id: "source_company", label: "Source Company" }, { id: "total_leads", label: "Leads" }],
    sort: [{ id: "source_company", direction: "asc" }],
    destinationId: "destination-1", destinationSnapshotChecksum: "a".repeat(64),
    strategy: "snapshot",
  };
}

function destination(): ValidatedReportingDestinationSnapshotV1 {
  const payload = {
    contractVersion: 1 as const, destinationId: "destination-1",
    provider: "google_sheets" as const, driveConnectionId: "drive-1",
    ownerIdentitySnapshot: { stableOwnerId: "owner", maskedEmail: "o***@example.com" },
    folder: { id: "folder", name: "Reports", url: "https://example.test/folder" },
    strategy: "snapshot" as const, destinationType: "owner_drive",
    ownershipPolicy: "owner", accessStatus: "verified" as const,
    healthVerifiedAt: new Date().toISOString(), archived: false as const,
    safety: {
      denylistCheckedAt: new Date().toISOString(),
      operationalWorkbookMatch: false as const, humanCreatedTabTakeover: false as const,
    },
    capacity: { providerMaxCells: 10_000_000, destinationAvailableCells: 10_000_000 },
  };
  return { ...payload, snapshotChecksum: destinationSnapshotChecksum(payload) };
}

function destinationWithTimes(
  healthVerifiedAt: string,
  denylistCheckedAt: string,
): ValidatedReportingDestinationSnapshotV1 {
  const { snapshotChecksum: _checksum, ...payload } = destination();
  const changed = {
    ...payload,
    healthVerifiedAt,
    safety: { ...payload.safety, denylistCheckedAt },
  };
  return {
    ...changed,
    snapshotChecksum: destinationSnapshotChecksum(changed),
  };
}

function destinationWithReplaceFields(
  strategy: "snapshot" | "replace_tab",
): ValidatedReportingDestinationSnapshotV1 {
  const { snapshotChecksum: _checksum, ...payload } = destination();
  const changed = {
    ...payload,
    strategy,
    workbook: {
      id: "workbook-1",
      name: "Reports",
      url: "https://example.test/workbook",
    },
    managedTab: {
      immutableSheetId: 123,
      name: "Report",
      managed: true as const,
    },
  };
  return {
    ...changed,
    snapshotChecksum: destinationSnapshotChecksum(changed),
  };
}

function queryInput() {
  return {
    datasetKey: "lead_quality_exceptions" as const,
    datasetSchemaVersion: 1 as const,
    resolvedWindow: {
      timezone: "America/New_York",
      fromUtc: "2026-05-01T04:00:00.000Z",
      toExclusiveUtc: "2026-06-01T04:00:00.000Z",
    },
    registry: {
      companies: [{
        id: "64b000000000000000000001",
        key: "best_relocation",
        label: "Best Relocation",
      }],
      granularities: [{
        id: "64b000000000000000000002",
        key: "forms",
        label: "Forms",
        companyId: "64b000000000000000000001",
      }],
    },
    filters: {},
    selectedColumns: [{ id: "exception_type", label: "Exception Type" }],
    effectiveSort: [
      { id: "exception_timestamp", direction: "asc" as const },
      { id: "exception_type", direction: "asc" as const },
      { id: "exception_key", direction: "asc" as const },
    ],
  };
}

async function withLeadlessManifestFixture(
  action: (booking: Record<string, any>) => Promise<void>,
): Promise<void> {
  const booking: Record<string, any> = {
    _id: new mongoose.Types.ObjectId("64b000000000000000000099"),
    timestamp: new Date("2026-05-15T14:00:00.000Z"),
    createdAt: new Date("2026-05-15T14:00:00.000Z"),
    updatedAt: new Date("2026-05-15T15:00:00.000Z"),
    is_leadless_booking: true,
    lead_ref: null,
    lead_model: null,
    job_no: "JOB-100",
    employee_source_snapshot: {
      lead_source_company: new mongoose.Types.ObjectId(
        "64b000000000000000000001",
      ),
      source_granularity_key: "forms",
      source_company_label_snapshot: "Best Relocation",
      source_granularity_label_snapshot: "Forms",
    },
  };
  const formModel = getFormLeadModel();
  const callModel = getCallLeadModel();
  const originals = {
    snapshotAdapter: getReportingSnapshotAdapter(),
    formFind: formModel.find,
    callFind: callModel.find,
    bookingFind: BookedLead.find,
    reconciliationFind: BookingLeadReconciliationCase.find,
    conflictFind: IngestionConflict.find,
    cancellationFind: CancelledLead.find,
    cancellationAggregate: CancelledLead.aggregate,
  };
  const emptyFind = () => reportingFindChain([]);
  try {
    setReportingSnapshotAdapter({
      async capture(read) {
        const value = await read({} as mongoose.ClientSession);
        return {
          value,
          token: {
            adapter: "mongodb_snapshot",
            operationTime: "100:1",
            capturedAt: "2026-06-01T12:00:00.000Z",
          },
        };
      },
    });
    (formModel as any).find = emptyFind;
    (callModel as any).find = emptyFind;
    (BookedLead as any).find = (filter: Record<string, unknown>) =>
      reportingFindChain(
        filter.is_leadless_booking === true || filter._id ? [booking] : [],
      );
    (BookingLeadReconciliationCase as any).find = emptyFind;
    (IngestionConflict as any).find = emptyFind;
    (CancelledLead as any).find = emptyFind;
    (CancelledLead as any).aggregate = () => reportingAggregateChain([]);

    await action(booking);
  } finally {
    setReportingSnapshotAdapter(originals.snapshotAdapter);
    (formModel as any).find = originals.formFind;
    (callModel as any).find = originals.callFind;
    (BookedLead as any).find = originals.bookingFind;
    (BookingLeadReconciliationCase as any).find =
      originals.reconciliationFind;
    (IngestionConflict as any).find = originals.conflictFind;
    (CancelledLead as any).find = originals.cancellationFind;
    (CancelledLead as any).aggregate = originals.cancellationAggregate;
  }
}

function reportingFindChain(rows: Record<string, any>[]) {
  let projection: Record<string, number> | undefined;
  const chain = {
    session: () => chain,
    select: (value: Record<string, number>) => {
      projection = value;
      return chain;
    },
    limit: () => chain,
    maxTimeMS: () => chain,
    lean: () => chain,
    exec: async () =>
      projection
        ? rows.map((row) => projectFixtureRow(row, projection!))
        : rows,
  };
  return chain;
}

function reportingAggregateChain(rows: Record<string, any>[]) {
  const chain = {
    session: () => chain,
    option: () => chain,
    exec: async () => rows,
  };
  return chain;
}

function projectFixtureRow(
  row: Record<string, any>,
  projection: Record<string, number>,
): Record<string, any> {
  const projected: Record<string, any> = {};
  for (const [path, included] of Object.entries(projection)) {
    if (included !== 1) continue;
    const parts = path.split(".");
    let source: any = row;
    let target: Record<string, any> = projected;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!;
      source = source?.[part];
      if (source === undefined) break;
      if (index === parts.length - 1) {
        target[part] = source;
      } else {
        target = target[part] ??= {};
      }
    }
  }
  return projected;
}

function actor(actorId: string) {
  return {
    actor_type: "owner" as const,
    actor_id: actorId,
    actor_label: "Owner",
    actor_role: "owner" as const,
    request_id: "request-1",
    origin: "vantage_admin" as const,
  };
}

function withReportingSecrets(action: () => void): void {
  const beforeApi = process.env.API_SECRET;
  const beforeConfirmation = process.env.REPORTING_CONFIRMATION_SECRET;
  const beforeEvidence = process.env.REPORTING_EVIDENCE_SECRET;
  process.env.REPORTING_CONFIRMATION_SECRET = "test-confirmation-secret";
  process.env.REPORTING_EVIDENCE_SECRET = "test-evidence-secret";
  try {
    action();
  } finally {
    restoreEnv("API_SECRET", beforeApi);
    restoreEnv("REPORTING_CONFIRMATION_SECRET", beforeConfirmation);
    restoreEnv("REPORTING_EVIDENCE_SECRET", beforeEvidence);
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function revisionFixture(): ReportingRevisionSnapshotV1 {
  const destinationSnapshot = destination();
  return {
    _id: "64b000000000000000000010",
    definition_id: "64b000000000000000000011",
    revision_number: 1,
    dataset_key: "source_performance",
    dataset_schema_version: 1,
    date_window_spec: { kind: "explicit", fromLocal: "2026-05-01", throughLocal: "2026-05-31" },
    resolved_window: queryInput().resolvedWindow,
    registry_snapshot: queryInput().registry,
    filters: { timeDimension: "none", includeGranularity: false },
    selected_columns: [{ id: "total_leads", label: "Leads" }],
    effective_sort: [{ id: "source_company", direction: "asc" }],
    timezone: "America/New_York",
    destination_id: destinationSnapshot.destinationId,
    destination_snapshot: destinationSnapshot,
    destination_snapshot_checksum: destinationSnapshot.snapshotChecksum,
    strategy: "snapshot",
    preview_id: "64b000000000000000000012",
    preview_checksum: "b".repeat(64),
    draft_checksum: "c".repeat(64),
    sample_count: 1,
    sample_evidence: "hmac-sha256-v1.opaque",
    warnings: [],
    estimate: { kind: "exact", rows: 1 },
    created_by: actor("owner-a"),
    revision_snapshot_checksum: "d".repeat(64),
  };
}
