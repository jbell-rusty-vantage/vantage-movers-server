import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import { REPORTING_PAGE_SIZE, REPORTING_PREVIEW_TTL_MS, REPORTING_RUN_CONFIRMATION_TTL_MS } from "../../config/domain/reporting";
import { ReportingDefinition } from "../../models/ReportingDefinition";
import { ReportingDefinitionRevision } from "../../models/ReportingDefinitionRevision";
import { ReportingPreview } from "../../models/ReportingPreview";
import { ReportingRun } from "../../models/ReportingRun";
import { ReportingRunConfirmation } from "../../models/ReportingRunConfirmation";
import { canonicalJson, computeChecksum, type ChecksumArtifactKind, type DurableActor } from "../durableWork";
import {
  REPORTING_DATASETS,
  requireDataset,
  reportingError,
  type DatasetKey,
  type ResolvedWindow,
  type ScalarType,
  type SelectedColumn,
  type Sensitivity,
  type SortTerm,
  type ValidatedReportingRequest,
} from "./catalog";
import {
  getReportingDestinationPort,
  validateDestinationSnapshot,
  type ValidatedReportingDestinationSnapshotV1,
} from "./destinationContract";
import { computeQueryInputChecksum, estimateReportingQuery, previewReportingQuery } from "./query/canonicalReporting";
import { validateReportingDraft } from "../../validation/reporting.validation";
import { withTransaction } from "../../db";
import { recordReportingAudit } from "./reportingAudit";
import {
  resolveReportingDateWindow,
  type ReportingDateWindowSpec,
} from "./timezone";

export interface ReportingRevisionSnapshotV1 {
  _id: unknown;
  definition_id: unknown;
  revision_number: number;
  dataset_key: DatasetKey;
  dataset_schema_version: 1;
  date_window_spec: unknown;
  resolved_window: ResolvedWindow;
  registry_snapshot: ValidatedReportingRequest["registry"];
  filters: Record<string, unknown>;
  selected_columns: SelectedColumn[];
  effective_sort: SortTerm[];
  timezone: string;
  destination_id: string;
  destination_snapshot: ValidatedReportingDestinationSnapshotV1;
  destination_snapshot_checksum: string;
  strategy: "replace_tab" | "snapshot";
  preview_id: unknown;
  preview_checksum: string;
  draft_checksum: string;
  sample_count: number;
  sample_evidence: string;
  warnings: ReportingConfirmationSnapshotV1["warnings"];
  estimate: { kind: "exact" | "upper_bound"; rows: number };
  created_by: DurableActor;
  revision_snapshot_checksum: string;
}

export interface ReportingConfirmationSnapshotV1 {
  queryInputChecksum: string;
  estimate: {
    kind: "exact" | "upper_bound";
    rows: number;
    columns: number;
    cellsIncludingHeader: number;
    generatedAt: string;
  };
  warnings: Array<{
    code: string;
    parameters: Record<string, string | number>;
  }>;
  intendedChanges: Record<string, unknown>;
}

export interface ReportingExecutionPackageV1 {
  contractVersion: 1;
  runId: string;
  definitionId: string;
  revisionId: string;
  revisionNumber: number;
  revisionSnapshotChecksum: string;
  dataset: { key: DatasetKey; schemaVersion: 1; grain: string };
  resolvedWindow: ResolvedWindow;
  queryInputChecksum: string;
  sourceReadThroughCapture: "stage_4_worker_before_query";
  stream: {
    selectedColumns: Array<SelectedColumn & {
      type: ScalarType;
      sensitivity: Sensitivity;
    }>;
    effectiveSort: SortTerm[];
    cursorVersion: 1;
    pageSize: number;
    resumeCursor: null;
    checksumAlgorithm: "sha256";
    executionInterfaceVersion: 1;
    candidateManifestVersion: 1;
    checksumAccumulatorVersion: 1;
  };
  estimate: ReportingConfirmationSnapshotV1["estimate"] & {
    queryPages: number;
    writeBatches: number;
  };
  preview: {
    previewChecksum: string;
    sampleCount: number;
    sampleEvidence: string;
    warnings: ReportingConfirmationSnapshotV1["warnings"];
    intendedChanges: Record<string, unknown>;
  };
  sensitivity: {
    highest: Sensitivity;
    piiColumnIds: string[];
    destinationOwnership: string;
  };
  writeSemantics: {
    valueInputOption: "RAW";
    headers: "literal_strings";
    cells: "literal_values";
    formulasAllowed: false;
  };
  destination: ValidatedReportingDestinationSnapshotV1;
  acceptance: {
    requireQueuedManualRun: true;
    requireMatchingRevisionChecksum: true;
    requireEnabledDataset: true;
    requireUnsetSourceReadThrough: true;
    rejectHeaderOrCursorDrift: true;
    rejectCapacityOrSafetyDrift: true;
    requireValueInputOptionRaw: true;
    requireLiteralHeadersAndCells: true;
    rejectFormulaInterpretation: true;
  };
}

export async function previewReportingDraft(input: unknown, actor: DurableActor) {
  const started = Date.now();
  try {
    return await previewReportingDraftCore(input, actor);
  } catch (error) {
    await recordReportingAudit({
      action: "preview",
      outcome: "failure",
      actor,
      durationMs: Date.now() - started,
      reasonCode: safeReasonCode(error),
    });
    throw error;
  }
}

async function previewReportingDraftCore(input: unknown, actor: DurableActor) {
  const validated = await validateReportingDraft(input);
  requireDataset(validated.draft.datasetKey);
  const snapshot = validateDestinationSnapshot(
    await getReportingDestinationPort().getValidatedSnapshot(validated.draft.destinationId),
    { destinationId: validated.draft.destinationId, checksum: validated.draft.destinationSnapshotChecksum, strategy: validated.draft.strategy },
  );
  const sourceReadThrough = new Date();
  const queryInput = toQueryInput(validated, sourceReadThrough.toISOString());
  const { estimate, sample } = await previewReportingQuery(queryInput, 50);
  const columns = validated.draft.selectedColumns.length;
  const projectedRows = estimate.rows + 1;
  const cellsIncludingHeader = projectedRows * columns;
  const applicableLimit = Math.min(snapshot.capacity.providerMaxCells, snapshot.capacity.destinationAvailableCells);
  assertEstimateFitsCapacity(estimate, columns, applicableLimit);
  const draftChecksum = checksumArtifact("reporting_draft", validated.draft);
  const sampleEvidence = createOpaqueSampleEvidence(sample);
  const piiColumnIds = validated.draft.selectedColumns
    .filter((selected) => validated.contract.columns.find((column) => column.id === selected.id)?.sensitivity === "confidential_pii")
    .map((selected) => selected.id);
  const metadata = {
    draft_checksum: draftChecksum,
    dataset_key: validated.draft.datasetKey,
    dataset_schema_version: 1,
    resolved_window: validated.resolvedWindow,
    destination_snapshot: snapshot,
    destination_snapshot_checksum: snapshot.snapshotChecksum,
    source_read_through: sourceReadThrough,
    estimate,
    projected: { rows: projectedRows, columns, cellsIncludingHeader },
    capacity: { applicableLimit, remainingCells: applicableLimit - cellsIncludingHeader },
    batches: {
      queryPages: Math.ceil(estimate.rows / REPORTING_PAGE_SIZE),
      writeBatches: Math.ceil(estimate.rows / 1000),
    },
    warnings: [] as Array<{ code: string; parameters: Record<string, string | number> }>,
    pii_column_ids: piiColumnIds,
    destination_ownership: snapshot.ownershipPolicy,
    intended_changes: validated.draft.strategy === "snapshot"
      ? { action: "create_snapshot_workbook", folderId: snapshot.folder.id }
      : { action: "replace_managed_tab", workbookId: snapshot.workbook?.id, immutableSheetId: snapshot.managedTab?.immutableSheetId },
    sample_count: sample.length,
    sample_token: randomBytes(24).toString("base64url"),
    sample_evidence: sampleEvidence,
    created_by: actor,
    expires_at: new Date(Date.now() + REPORTING_PREVIEW_TTL_MS),
  };
  const previewChecksum = checksumArtifact("reporting_preview", metadata);
  const preview = await ReportingPreview.create({ ...metadata, preview_checksum: previewChecksum });
  return {
    previewId: String(preview._id), draftChecksum, previewChecksum,
    estimate, projected: metadata.projected, capacity: metadata.capacity,
    batches: metadata.batches, sampleRows: sample, sampleEvidence,
    warnings: metadata.warnings, piiColumnIds,
    destinationOwnership: metadata.destination_ownership,
    intendedChanges: metadata.intended_changes, expiresAt: metadata.expires_at.toISOString(),
  };
}

export function assertEstimateFitsCapacity(
  estimate: { kind: "exact" | "upper_bound"; rows: number },
  columns: number,
  applicableLimit: number,
): void {
  const cellsIncludingHeader = (estimate.rows + 1) * columns;
  if (cellsIncludingHeader > applicableLimit) {
    throw reportingError(
      "destination_capacity_exceeded",
      estimate.kind === "upper_bound"
        ? "The safe upper bound cannot prove the report fits destination capacity."
        : `Projected ${cellsIncludingHeader} cells exceed limit ${applicableLimit}.`,
      409,
    );
  }
}

export async function saveReportingRevision(input: {
  definitionId?: string;
  draft: unknown;
  previewId: string;
  previewChecksum: string;
}, actor: DurableActor) {
  const started = Date.now();
  try {
    return await saveReportingRevisionCore(input, actor);
  } catch (error) {
    await recordReportingAudit({
      action: "revision_create",
      outcome: "failure",
      actor,
      durationMs: Date.now() - started,
      definitionId: input.definitionId,
      reasonCode: safeReasonCode(error),
    });
    throw error;
  }
}

async function saveReportingRevisionCore(input: {
  definitionId?: string;
  draft: unknown;
  previewId: string;
  previewChecksum: string;
}, actor: DurableActor) {
  const validated = await validateReportingDraft(input.draft);
  requireDataset(validated.draft.datasetKey);
  const draftChecksum = checksumArtifact("reporting_draft", validated.draft);
  const preview = await ReportingPreview.findOne({
    _id: input.previewId, preview_checksum: input.previewChecksum,
    draft_checksum: draftChecksum, expires_at: { $gt: new Date() },
  }).lean().exec();
  if (!preview) throw reportingError("preview_expired_or_mismatch", "A matching unexpired preview is required.", 409);
  const destination = validateDestinationSnapshot(
    await getReportingDestinationPort().getValidatedSnapshot(validated.draft.destinationId),
    { destinationId: validated.draft.destinationId, checksum: validated.draft.destinationSnapshotChecksum, strategy: validated.draft.strategy },
  );
  const revisionId = new mongoose.Types.ObjectId();
  return withTransaction(async (session) => {
    const definition = input.definitionId
      ? await ReportingDefinition.findOne({
          _id: input.definitionId,
          state: "active",
        }).session(session).exec()
      : (
          await ReportingDefinition.create(
            [{
              name: validated.draft.name,
              description: validated.draft.description,
              dataset_key: validated.draft.datasetKey,
              created_by: actor,
              updated_by: actor,
            }],
            { session },
          )
        )[0];
    if (!definition) {
      throw reportingError(
        "definition_unavailable",
        "Definition is archived or missing.",
        409,
      );
    }
    if (definition.dataset_key !== validated.draft.datasetKey) {
      throw reportingError(
        "invalid_filter",
        "A definition cannot change dataset key.",
        409,
      );
    }
    const allocation = await ReportingDefinition.findOneAndUpdate(
      { _id: definition._id, state: "active" },
      {
        $inc: { next_revision_number: 1 },
        $set: {
          name: validated.draft.name,
          description: validated.draft.description,
          updated_by: actor,
        },
      },
      { session, returnDocument: "before" },
    ).lean().exec();
    if (!allocation) {
      throw reportingError(
        "definition_unavailable",
        "Definition became unavailable.",
        409,
      );
    }
    const revisionNumber = allocation.next_revision_number;
    const snapshot = {
      _id: String(revisionId),
      definition_id: String(definition._id),
      revision_number: revisionNumber,
      dataset_key: validated.draft.datasetKey,
      dataset_schema_version: 1,
      date_window_spec: validated.draft.dateWindow,
      resolved_window: validated.resolvedWindow,
      registry_snapshot: validated.registry,
      filters: validated.filters,
      selected_columns: validated.draft.selectedColumns,
      effective_sort: validated.effectiveSort,
      timezone: validated.draft.timezone,
      destination_id: validated.draft.destinationId,
      destination_snapshot: destination,
      destination_snapshot_checksum: destination.snapshotChecksum,
      strategy: validated.draft.strategy,
      preview_id: String(preview._id),
      preview_checksum: preview.preview_checksum,
      draft_checksum: draftChecksum,
      sample_count: preview.sample_count,
      sample_evidence: preview.sample_evidence,
      warnings: preview.warnings,
      estimate: preview.estimate,
      created_by: actor,
    };
    const revisionSnapshotChecksum = checksumArtifact(
      "reporting_revision",
      canonicalRevisionSnapshot(snapshot),
    );
    await ReportingDefinitionRevision.create(
      [{
        ...snapshot,
        _id: revisionId,
        preview_id: preview._id,
        revision_snapshot_checksum: revisionSnapshotChecksum,
      }],
      { session },
    );
    const pointer = await ReportingDefinition.updateOne(
      {
        _id: definition._id,
        current_revision_number: allocation.current_revision_number ?? 0,
      },
      {
        $set: {
          current_revision_id: revisionId,
          current_revision_number: revisionNumber,
        },
      },
      { session },
    ).exec();
    if (pointer.modifiedCount !== 1) {
      throw new Error("reporting_definition_pointer_conflict");
    }
    return {
      definitionId: String(definition._id),
      revisionId: String(revisionId),
      revisionNumber,
      revisionSnapshotChecksum,
    };
  });
}

export async function prepareManualRun(input: {
  definitionId: string;
  revisionId?: string;
  confirmationToken?: string;
  idempotencyKey?: string;
}, actor: DurableActor) {
  const started = Date.now();
  try {
    return await prepareManualRunCore(input, actor);
  } catch (error) {
    await recordReportingAudit({
      action: input.confirmationToken ? "run_confirmation" : "run_estimate",
      outcome: "failure",
      actor,
      durationMs: Date.now() - started,
      definitionId: input.definitionId,
      revisionId: input.revisionId,
      reasonCode: safeReasonCode(error),
    });
    throw error;
  }
}

async function prepareManualRunCore(input: {
  definitionId: string;
  revisionId?: string;
  confirmationToken?: string;
  idempotencyKey?: string;
}, actor: DurableActor) {
  const definition = await ReportingDefinition.findOne({ _id: input.definitionId, state: "active" }).lean().exec();
  if (!definition) throw reportingError("definition_unavailable", "Definition is archived or missing.", 409);
  const revisionId = input.revisionId ?? String(definition.current_revision_id ?? "");
  const revision = await ReportingDefinitionRevision.findOne({ _id: revisionId, definition_id: definition._id }).lean().exec();
  if (!revision) throw reportingError("revision_unavailable", "Revision was not found.", 404);
  assertRevisionChecksum(revision);
  requireDataset(revision.dataset_key as keyof typeof REPORTING_DATASETS);
  const destination = validateDestinationSnapshot(
    await getReportingDestinationPort().getValidatedSnapshot(revision.destination_id),
    { destinationId: revision.destination_id, checksum: revision.destination_snapshot_checksum, strategy: revision.strategy },
  );
  const queryInput = revisionToQueryInput(revision);
  const estimate = await estimateReportingQuery(queryInput);
  const columns = revision.selected_columns.length;
  const cellsIncludingHeader = (estimate.rows + 1) * columns;
  const limit = Math.min(destination.capacity.providerMaxCells, destination.capacity.destinationAvailableCells);
  assertEstimateFitsCapacity(estimate, columns, limit);
  const confirmation = {
    definitionId: String(definition._id), revisionId: String(revision._id),
    revisionSnapshotChecksum: revision.revision_snapshot_checksum,
    destinationSnapshotChecksum: destination.snapshotChecksum,
    queryInputChecksum: computeQueryInputChecksum(queryInput),
    estimate: { ...estimate, columns, cellsIncludingHeader, generatedAt: new Date().toISOString() },
    warnings: revision.warnings ?? [], intendedChanges: intendedChanges(revision),
    expiresAt: new Date(Date.now() + REPORTING_RUN_CONFIRMATION_TTL_MS).toISOString(),
  };
  const estimateFingerprint = confirmationImmutableFingerprint({
    estimate: {
      kind: confirmation.estimate.kind,
      rows: confirmation.estimate.rows,
      columns: confirmation.estimate.columns,
      cellsIncludingHeader: confirmation.estimate.cellsIncludingHeader,
    },
    warnings: confirmation.warnings,
    intendedChanges: confirmation.intendedChanges,
  });
  if (!input.idempotencyKey) {
    throw reportingError(
      "invalid_confirmation",
      "idempotencyKey is required in both run-preparation steps.",
      400,
    );
  }
  const actorFingerprint = reportingActorFingerprint(actor);
  const immutableFingerprint = confirmationImmutableFingerprint({
    definitionId: confirmation.definitionId,
    revisionId: confirmation.revisionId,
    revisionSnapshotChecksum: confirmation.revisionSnapshotChecksum,
    destinationSnapshotChecksum: confirmation.destinationSnapshotChecksum,
    queryInputChecksum: confirmation.queryInputChecksum,
    estimateFingerprint,
    actorFingerprint,
    idempotencyKey: input.idempotencyKey,
  });
  if (!input.confirmationToken) {
    const existing = await ReportingRunConfirmation.findOne({
      actor_id: actor.actor_id,
      revision_id: revision._id,
      idempotency_key: input.idempotencyKey,
    }).lean().exec();
    if (existing) {
      if (existing.immutable_fingerprint !== immutableFingerprint) {
        throw reportingError(
          "idempotency_fingerprint_mismatch",
          "The idempotency key was already bound to different immutable inputs.",
          409,
        );
      }
      if (existing.consumed_run_id) {
        return persistedRunReplay(existing.consumed_run_id, immutableFingerprint);
      }
      if (new Date(existing.expires_at).getTime() <= Date.now()) {
        throw reportingError(
          "invalid_confirmation",
          "The confirmation expired; use a new idempotency key.",
          409,
        );
      }
      const tokenPayload = existing.confirmation_snapshot as Record<string, unknown>;
      return confirmationResponse(tokenPayload);
    }
    const confirmationId = randomBytes(24).toString("base64url");
    const tokenPayload = {
      ...confirmation,
      estimateFingerprint,
      confirmationId,
      actorFingerprint,
      idempotencyKey: input.idempotencyKey,
      immutableFingerprint,
    };
    try {
      await ReportingRunConfirmation.create({
        confirmation_id: confirmationId,
        definition_id: definition._id,
        revision_id: revision._id,
        actor_id: actor.actor_id,
        actor_fingerprint: actorFingerprint,
        idempotency_key: input.idempotencyKey,
        immutable_fingerprint: immutableFingerprint,
        confirmation_snapshot: tokenPayload,
        expires_at: new Date(confirmation.expiresAt),
      });
      return confirmationResponse(tokenPayload);
    } catch (error) {
      if (!isMongoDuplicateKeyError(error)) throw error;
      const winner = await ReportingRunConfirmation.findOne({
        actor_id: actor.actor_id,
        revision_id: revision._id,
        idempotency_key: input.idempotencyKey,
      }).lean().exec();
      if (!winner) throw error;
      assertIdempotencyFingerprint(
        String(winner.immutable_fingerprint),
        immutableFingerprint,
      );
      return confirmationResponse(
        winner.confirmation_snapshot as Record<string, unknown>,
      );
    }
  }
  const accepted = verifyConfirmation(input.confirmationToken);
  if (
    accepted.actorFingerprint !== actorFingerprint ||
    accepted.idempotencyKey !== input.idempotencyKey ||
    accepted.revisionId !== confirmation.revisionId ||
    accepted.revisionSnapshotChecksum !== confirmation.revisionSnapshotChecksum ||
    accepted.destinationSnapshotChecksum !== confirmation.destinationSnapshotChecksum ||
    accepted.queryInputChecksum !== confirmation.queryInputChecksum ||
    accepted.estimateFingerprint !== estimateFingerprint ||
    accepted.immutableFingerprint !== immutableFingerprint
  ) throw reportingError("invalid_confirmation", "Confirmation does not match current immutable inputs.", 409);
  const confirmationRecord = await ReportingRunConfirmation.findOne({
    confirmation_id: accepted.confirmationId,
    actor_id: actor.actor_id,
    actor_fingerprint: actorFingerprint,
    idempotency_key: input.idempotencyKey,
    immutable_fingerprint: immutableFingerprint,
  }).lean().exec();
  if (!confirmationRecord) {
    throw reportingError("invalid_confirmation", "Confirmation was not issued by this server.", 409);
  }
  if (confirmationRecord.consumed_run_id) {
    return persistedRunReplay(
      confirmationRecord.consumed_run_id,
      immutableFingerprint,
    );
  }
  const existingRun = await ReportingRun.findOne({
    "actor.actor_id": actor.actor_id,
    definition_revision_id: revision._id,
    idempotency_key: input.idempotencyKey,
  }).lean().exec();
  if (existingRun) {
    assertIdempotencyFingerprint(
      String(existingRun.immutable_fingerprint),
      immutableFingerprint,
    );
    await ReportingRunConfirmation.updateOne(
      {
        _id: confirmationRecord._id,
        consumed_at: null,
        immutable_fingerprint: immutableFingerprint,
      },
      {
        $set: {
          consumed_at: new Date(),
          consumed_run_id: existingRun._id,
        },
      },
    ).exec();
    return persistedRunReplay(existingRun._id, immutableFingerprint);
  }
  const proposedRunId = new mongoose.Types.ObjectId();
  const executionPackage = buildExecutionPackage(
    revision,
    queryInput,
    confirmation,
    destination,
    String(proposedRunId),
  );
  const session = await mongoose.startSession();
  let concurrentReplay = false;
  try {
    await session.withTransaction(async () => {
      const claimed = await ReportingRunConfirmation.findOneAndUpdate(
        {
          _id: confirmationRecord._id,
          consumed_at: null,
          expires_at: { $gt: new Date() },
          immutable_fingerprint: immutableFingerprint,
        },
        {
          $set: {
            consumed_at: new Date(),
            consumed_run_id: proposedRunId,
          },
        },
        { session, returnDocument: "after" },
      ).lean().exec();
      if (!claimed) {
        throw reportingError(
          "confirmation_already_consumed",
          "Confirmation was already consumed.",
          409,
        );
      }
      await ReportingRun.create([{
        _id: proposedRunId,
        definition_id: definition._id, definition_revision_id: revision._id,
        revision_snapshot: revision, revision_snapshot_checksum: revision.revision_snapshot_checksum,
        query_input: queryInput, query_input_checksum: confirmation.queryInputChecksum,
        trigger: "manual", actor, status: "queued", estimate: confirmation.estimate,
        confirmation: { ...accepted, confirmedAt: new Date().toISOString() },
        execution_package: executionPackage, idempotency_key: input.idempotencyKey,
        confirmation_id: accepted.confirmationId,
        immutable_fingerprint: immutableFingerprint,
      }], { session });
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "confirmation_already_consumed"
    ) {
      concurrentReplay = true;
    } else {
      throw error;
    }
  } finally {
    await session.endSession();
  }
  if (concurrentReplay) {
    const consumed = await ReportingRunConfirmation.findById(
      confirmationRecord._id,
    ).lean().exec();
    if (!consumed?.consumed_run_id) {
      throw reportingError(
        "confirmation_consumption_conflict",
        "Confirmation consumption did not produce a durable run.",
        409,
      );
    }
    return persistedRunReplay(consumed.consumed_run_id, immutableFingerprint);
  }
  return persistedRunReplay(proposedRunId, immutableFingerprint, false);
}

export function isMongoDuplicateKeyError(
  error: unknown,
): error is { code: 11000 } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

export function buildExecutionPackage(
  revision: ReportingRevisionSnapshotV1,
  queryInput: ValidatedReportingRequest,
  confirmation: ReportingConfirmationSnapshotV1,
  destination: ValidatedReportingDestinationSnapshotV1,
  runId: string,
) : ReportingExecutionPackageV1 {
  const contract = REPORTING_DATASETS[revision.dataset_key];
  const columns = revision.selected_columns.map((selected: { id: string; label: string }) => {
    const column = contract.columns.find((candidate) => candidate.id === selected.id)!;
    return { ...selected, type: column.type, sensitivity: column.sensitivity };
  });
  const piiColumnIds = columns.filter((column: { sensitivity: Sensitivity }) => column.sensitivity === "confidential_pii").map((column: { id: string }) => column.id);
  return {
    contractVersion: 1, runId, definitionId: String(revision.definition_id),
    revisionId: String(revision._id), revisionNumber: revision.revision_number,
    revisionSnapshotChecksum: revision.revision_snapshot_checksum,
    dataset: { key: revision.dataset_key, schemaVersion: 1, grain: contract.grain },
    resolvedWindow: queryInput.resolvedWindow, queryInputChecksum: confirmation.queryInputChecksum,
    sourceReadThroughCapture: "stage_4_worker_before_query",
    stream: {
      selectedColumns: columns, effectiveSort: revision.effective_sort, cursorVersion: 1,
      pageSize: REPORTING_PAGE_SIZE, resumeCursor: null, checksumAlgorithm: "sha256",
      executionInterfaceVersion: 1,
      candidateManifestVersion: 1,
      checksumAccumulatorVersion: 1,
    },
    estimate: {
      kind: confirmation.estimate.kind, rows: confirmation.estimate.rows,
      columns: confirmation.estimate.columns, cellsIncludingHeader: confirmation.estimate.cellsIncludingHeader,
      queryPages: Math.ceil(confirmation.estimate.rows / REPORTING_PAGE_SIZE),
      writeBatches: Math.ceil(confirmation.estimate.rows / 1000),
      generatedAt: confirmation.estimate.generatedAt,
    },
    preview: {
      previewChecksum: revision.preview_checksum,
      sampleCount: revision.sample_count, sampleEvidence: revision.sample_evidence,
      warnings: confirmation.warnings, intendedChanges: confirmation.intendedChanges,
    },
    sensitivity: {
      highest: piiColumnIds.length ? "confidential_pii" : "internal",
      piiColumnIds, destinationOwnership: destination.ownershipPolicy,
    },
    writeSemantics: {
      valueInputOption: "RAW",
      headers: "literal_strings",
      cells: "literal_values",
      formulasAllowed: false,
    },
    destination,
    acceptance: {
      requireQueuedManualRun: true, requireMatchingRevisionChecksum: true,
      requireEnabledDataset: true, requireUnsetSourceReadThrough: true,
      rejectHeaderOrCursorDrift: true, rejectCapacityOrSafetyDrift: true,
      requireValueInputOptionRaw: true,
      requireLiteralHeadersAndCells: true,
      rejectFormulaInterpretation: true,
    },
  };
}

function toQueryInput(validated: Awaited<ReturnType<typeof validateReportingDraft>>, sourceReadThrough?: string): ValidatedReportingRequest {
  return {
    datasetKey: validated.draft.datasetKey, datasetSchemaVersion: 1,
    resolvedWindow: validated.resolvedWindow, registry: validated.registry,
    filters: validated.filters, selectedColumns: validated.draft.selectedColumns,
    effectiveSort: validated.effectiveSort, ...(sourceReadThrough ? { sourceReadThrough } : {}),
  };
}

function revisionToQueryInput(revision: Record<string, any>): ValidatedReportingRequest {
  return {
    datasetKey: revision.dataset_key, datasetSchemaVersion: 1,
    resolvedWindow: resolveReportingDateWindow(
      revision.date_window_spec as ReportingDateWindowSpec,
      revision.timezone,
      new Date(),
    ),
    registry: revision.registry_snapshot,
    filters: revision.filters, selectedColumns: revision.selected_columns,
    effectiveSort: revision.effective_sort,
  };
}

function intendedChanges(revision: Record<string, any>) {
  return revision.strategy === "snapshot"
    ? { action: "create_snapshot_workbook", folderId: revision.destination_snapshot.folder.id }
    : { action: "replace_managed_tab", workbookId: revision.destination_snapshot.workbook?.id, immutableSheetId: revision.destination_snapshot.managedTab?.immutableSheetId };
}

function checksumArtifact(kind: ChecksumArtifactKind, payload: unknown): string {
  return computeChecksum({ checksum_version: 1, artifact_kind: kind, schema_version: 1, payload });
}

export function canonicalRevisionSnapshot(
  revision: Record<string, any>,
): Record<string, unknown> {
  return {
    _id: String(revision._id),
    definition_id: String(revision.definition_id),
    revision_number: revision.revision_number,
    dataset_key: revision.dataset_key,
    dataset_schema_version: revision.dataset_schema_version,
    date_window_spec: revision.date_window_spec,
    resolved_window: revision.resolved_window,
    registry_snapshot: revision.registry_snapshot,
    filters: revision.filters,
    selected_columns: revision.selected_columns,
    effective_sort: revision.effective_sort,
    timezone: revision.timezone,
    destination_id: revision.destination_id,
    destination_snapshot: revision.destination_snapshot,
    destination_snapshot_checksum: revision.destination_snapshot_checksum,
    strategy: revision.strategy,
    preview_id: String(revision.preview_id),
    preview_checksum: revision.preview_checksum,
    draft_checksum: revision.draft_checksum,
    sample_count: revision.sample_count,
    sample_evidence: revision.sample_evidence,
    warnings: revision.warnings ?? [],
    estimate: revision.estimate,
    created_by: revision.created_by,
  };
}

export function assertRevisionChecksum(revision: Record<string, any>): void {
  const actual = checksumArtifact(
    "reporting_revision",
    canonicalRevisionSnapshot(revision),
  );
  if (!safeEqual(actual, String(revision.revision_snapshot_checksum ?? ""))) {
    throw reportingError(
      "revision_checksum_mismatch",
      "Immutable reporting revision checksum mismatch.",
      409,
    );
  }
}

export function createOpaqueSampleEvidence(sample: unknown): string {
  const digest = createHmac("sha256", reportingEvidenceSecret())
    .update(canonicalJson(sample), "utf8")
    .digest("base64url");
  return `hmac-sha256-v1.${digest}`;
}

export function reportingActorFingerprint(actor: DurableActor): string {
  return createHmac("sha256", confirmationSecret())
    .update(
      canonicalJson({
        actor_type: actor.actor_type,
        actor_id: actor.actor_id,
        actor_role: actor.actor_role,
        origin: actor.origin,
      }),
      "utf8",
    )
    .digest("base64url");
}

export function confirmationImmutableFingerprint(
  payload: Record<string, unknown>,
): string {
  return createHmac("sha256", confirmationSecret())
    .update(canonicalJson(payload), "utf8")
    .digest("base64url");
}

async function persistedRunReplay(
  runId: mongoose.Types.ObjectId | string,
  immutableFingerprint: string,
  idempotentReplay = true,
) {
  const run = await ReportingRun.findById(runId).lean().exec();
  if (!run) {
    throw reportingError(
      "idempotency_state_incomplete",
      "The idempotent run record is unavailable.",
      409,
    );
  }
  return serializePersistedRunReplay(
    run,
    immutableFingerprint,
    idempotentReplay,
  );
}

export function serializePersistedRunReplay(
  run: Record<string, any>,
  immutableFingerprint: string,
  idempotentReplay = true,
) {
  assertIdempotencyFingerprint(
    String(run.immutable_fingerprint),
    immutableFingerprint,
  );
  return {
    runId: String(run._id),
    status: run.status,
    executionPackage: run.execution_package,
    idempotentReplay,
  };
}

export function assertIdempotencyFingerprint(
  persisted: string,
  requested: string,
): void {
  if (!safeEqual(persisted, requested)) {
    throw reportingError(
      "idempotency_fingerprint_mismatch",
      "The idempotency key was already bound to different immutable inputs.",
      409,
    );
  }
}

function confirmationSecret(): string {
  const secret = process.env.REPORTING_CONFIRMATION_SECRET ?? process.env.API_SECRET;
  if (!secret) throw new Error("REPORTING_CONFIRMATION_SECRET or API_SECRET is required.");
  return secret;
}

function reportingEvidenceSecret(): string {
  const secret =
    process.env.REPORTING_EVIDENCE_SECRET ??
    process.env.REPORTING_CONFIRMATION_SECRET ??
    process.env.API_SECRET;
  if (!secret) {
    throw new Error(
      "REPORTING_EVIDENCE_SECRET, REPORTING_CONFIRMATION_SECRET, or API_SECRET is required.",
    );
  }
  return secret;
}

function signConfirmation(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", confirmationSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function confirmationResponse(payload: Record<string, any>) {
  return {
    requiresConfirmation: true,
    confirmationToken: signConfirmation(payload),
    confirmationId: payload.confirmationId,
    idempotencyKey: payload.idempotencyKey,
    definitionId: payload.definitionId,
    revisionId: payload.revisionId,
    revisionSnapshotChecksum: payload.revisionSnapshotChecksum,
    destinationSnapshotChecksum: payload.destinationSnapshotChecksum,
    queryInputChecksum: payload.queryInputChecksum,
    estimate: payload.estimate,
    warnings: payload.warnings,
    intendedChanges: payload.intendedChanges,
    expiresAt: payload.expiresAt,
  };
}

function verifyConfirmation(token: string): Record<string, any> {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) throw reportingError("invalid_confirmation", "Malformed confirmation token.", 400);
  const expected = createHmac("sha256", confirmationSecret()).update(encoded).digest("base64url");
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw reportingError("invalid_confirmation", "Invalid confirmation token.", 400);
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, any>;
  if (new Date(payload.expiresAt).getTime() <= Date.now()) throw reportingError("invalid_confirmation", "Confirmation token expired.", 409);
  return payload;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function safeReasonCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code.slice(0, 100);
  }
  return "reporting_operation_failed";
}
