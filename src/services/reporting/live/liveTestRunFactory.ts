import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { computeChecksum } from "../../durableWork";
import type { DurableActor } from "../../durableWork";
import { ReportingDefinition } from "../../../models/ReportingDefinition";
import { ReportingDefinitionRevision } from "../../../models/ReportingDefinitionRevision";
import { ReportingRun } from "../../../models/ReportingRun";
import {
  buildExecutionPackage,
  canonicalRevisionSnapshot,
  confirmationImmutableFingerprint,
  type ReportingExecutionPackageV1,
} from "../reporting.service";
import { computeQueryInputChecksum } from "../query/canonicalReporting";
import type { ValidatedReportingDestinationSnapshotV1 } from "../destinationContract";
import type { ValidatedReportingRequest } from "../catalog";

const LIVE_TEST_COLUMNS = [
  { id: "lead_id", label: "Lead ID" },
  { id: "cohort_day", label: "Cohort Day" },
  { id: "outcome", label: "Outcome" },
];

export function liveTestSyntheticRows(): Array<Record<string, string>> {
  return [
    { lead_id: "SYN-LIVE-001", cohort_day: "2026-07-01", outcome: "booked" },
    { lead_id: "SYN-LIVE-002", cohort_day: "2026-07-02", outcome: "cancelled" },
    { lead_id: "SYN-LIVE-003", cohort_day: "2026-07-03", outcome: "open" },
  ];
}

export function buildLiveTestQueryInput(sourceReadThrough: string): ValidatedReportingRequest {
  return {
    datasetKey: "lead_outcome_detail",
    datasetSchemaVersion: 1,
    resolvedWindow: {
      timezone: "America/New_York",
      fromUtc: "2026-01-01T05:00:00.000Z",
      toExclusiveUtc: "2026-02-01T05:00:00.000Z",
    },
    registry: { companies: [], granularities: [] },
    filters: {},
    selectedColumns: LIVE_TEST_COLUMNS,
    effectiveSort: [{ id: "lead_id", direction: "asc" }],
    sourceReadThrough,
  };
}

function revisionChecksum(revision: Record<string, unknown>): string {
  return computeChecksum({
    checksum_version: 1,
    artifact_kind: "reporting_revision",
    schema_version: 1,
    payload: revision,
  });
}

export async function seedLiveTestQueuedRun(input: {
  destinationSnapshot: ValidatedReportingDestinationSnapshotV1;
  strategy: "replace_tab" | "snapshot";
  estimateRows: number;
  runTag: string;
  actor: DurableActor;
}): Promise<{
  runId: string;
  definitionId: string;
  revisionId: string;
  executionPackage: ReportingExecutionPackageV1;
}> {
  const sourceReadThrough = new Date().toISOString();
  const queryInput = buildLiveTestQueryInput(sourceReadThrough);
  const queryInputChecksum = computeQueryInputChecksum(queryInput);
  const estimate = {
    kind: "exact" as const,
    rows: input.estimateRows,
    columns: LIVE_TEST_COLUMNS.length,
    cellsIncludingHeader: (input.estimateRows + 1) * LIVE_TEST_COLUMNS.length,
    generatedAt: new Date().toISOString(),
  };
  const definition = (
    await ReportingDefinition.create([
      {
        name: `Live Test ${input.runTag}`,
        description: "Synthetic live Google harness definition",
        dataset_key: "lead_outcome_detail",
        created_by: input.actor,
        updated_by: input.actor,
      },
    ])
  )[0]!;
  const revisionId = new mongoose.Types.ObjectId();
  const previewId = new mongoose.Types.ObjectId();
  const revisionDoc = {
    _id: revisionId,
    definition_id: definition._id,
    revision_number: 1,
    dataset_key: "lead_outcome_detail",
    dataset_schema_version: 1,
    date_window_spec: {
      kind: "explicit",
      fromLocalDate: "2026-01-01",
      throughLocalDate: "2026-01-31",
    },
    resolved_window: queryInput.resolvedWindow,
    registry_snapshot: queryInput.registry,
    filters: queryInput.filters,
    selected_columns: LIVE_TEST_COLUMNS,
    effective_sort: queryInput.effectiveSort,
    timezone: "America/New_York",
    destination_id: input.destinationSnapshot.destinationId,
    destination_snapshot: input.destinationSnapshot,
    destination_snapshot_checksum: input.destinationSnapshot.snapshotChecksum,
    strategy: input.strategy,
    preview_id: previewId,
    preview_checksum: "c".repeat(64),
    draft_checksum: "d".repeat(64),
    sample_count: 0,
    sample_evidence: "hmac-sha256-v1.live-test",
    warnings: [],
    estimate,
    created_by: input.actor,
  };
  const canonical = canonicalRevisionSnapshot(revisionDoc);
  const revision_snapshot_checksum = revisionChecksum(canonical);
  await ReportingDefinitionRevision.collection.insertOne({
    ...revisionDoc,
    revision_snapshot_checksum,
  });
  await ReportingDefinition.updateOne(
    { _id: definition._id },
    { $set: { current_revision_id: revisionId, next_revision_number: 2 } },
  );

  const confirmationPayload = {
    confirmationId: randomBytes(16).toString("hex"),
    actorFingerprint: "live-test",
    idempotencyKey: `live-${input.runTag}`,
    revisionId: String(revisionId),
    revisionSnapshotChecksum: revision_snapshot_checksum,
    destinationStableIdentityChecksum: input.destinationSnapshot.snapshotChecksum,
    queryInputChecksum,
    estimateFingerprint: "live-test-estimate",
    immutableFingerprint: "",
  };
  confirmationPayload.immutableFingerprint = confirmationImmutableFingerprint(
    confirmationPayload as unknown as Record<string, unknown>,
  );

  const runId = new mongoose.Types.ObjectId();
  const executionPackage = buildExecutionPackage(
    { ...revisionDoc, revision_snapshot_checksum } as any,
    queryInput,
    {
      queryInputChecksum,
      estimate,
      warnings: [],
      intendedChanges:
        input.strategy === "snapshot"
          ? { action: "create_snapshot_workbook", folderId: input.destinationSnapshot.folder.id }
          : {
              action: "replace_managed_tab",
              workbookId: input.destinationSnapshot.workbook?.id,
              immutableSheetId: input.destinationSnapshot.managedTab?.immutableSheetId,
            },
    },
    input.destinationSnapshot,
    String(runId),
  );

  await ReportingRun.collection.insertOne({
    _id: runId,
    definition_id: definition._id,
    definition_revision_id: revisionId,
    revision_snapshot: canonical,
    revision_snapshot_checksum,
    query_input: queryInput,
    query_input_checksum: queryInputChecksum,
    trigger: "manual",
    actor: input.actor,
    status: "queued",
    estimate,
    confirmation: {
      ...confirmationPayload,
      confirmedAt: new Date().toISOString(),
    },
    execution_package: executionPackage,
    idempotency_key: confirmationPayload.idempotencyKey,
    confirmation_id: confirmationPayload.confirmationId,
    immutable_fingerprint: confirmationPayload.immutableFingerprint,
    created_at: new Date(),
    updated_at: new Date(),
  });

  return {
    runId: String(runId),
    definitionId: String(definition._id),
    revisionId: String(revisionId),
    executionPackage,
  };
}

export { LIVE_TEST_COLUMNS };
