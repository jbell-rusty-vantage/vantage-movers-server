import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { connectMongo } from "../db";
import { requireApiSecret, type VantageAuthContext } from "../middleware/requireApiSecret";
import { ReportingDefinition } from "../models/ReportingDefinition";
import { ReportingDefinitionRevision } from "../models/ReportingDefinitionRevision";
import { ReportingPreview } from "../models/ReportingPreview";
import { ReportingRun } from "../models/ReportingRun";
import { durableActorFromRegistryActor } from "../services/durableWork";
import { requireRegistryOwnerActor, requireRegistryReadActor } from "../services/operationsRegistry";
import { getReportingCatalog, REPORTING_DATASETS, ReportingError } from "../services/reporting/catalog";
import { prepareManualRun, previewReportingDraft, saveReportingRevision } from "../services/reporting/reporting.service";
import { reportingDraftSchema, runRequestSchema, saveDefinitionSchema } from "../validation/reporting.validation";
import { isRegistryError } from "../services/operationsRegistry/errors";
import {
  requestReportingRunCancellation,
  safeReportingFailureForRead,
} from "../services/reporting/reportingRunRepository";
import {
  loadReportingDelivery,
  safeReportingDeliveryForRead,
} from "../services/reporting/reportingDeliveryRepository";
import { recordReportingAudit } from "../services/reporting/reportingAudit";
import { publishReportingWakeup } from "../services/reporting/queue";
import {
  archiveReportingDestinationRecord,
  createReportingDestination,
  getReportingDestinationSummary,
  listReportingDestinationSummaries,
  updateReportingDestinationRecord,
  verifyReportingDestination,
} from "../services/reporting/reportingDestination.service";
import {
  archiveReportingDestinationSchema,
  createReportingDestinationSchema,
  updateReportingDestinationSchema,
} from "../validation/reportingDestination.validation";
import { isReportingGoogleDeliveryEnabled } from "../config/domain/reporting";
import { emitReportingDestinationHealthFailure } from "../services/reporting/reportingObservability";

const router = Router();
const base = "/api/v1/admin/reporting";
router.use(base, requireApiSecret);

router.get(`${base}/catalog`, async (req, res) => {
  try {
    readActor(req);
    return res.json({ ok: true, data: getReportingCatalog() });
  } catch (error) { return sendError(res, error); }
});

router.get(`${base}/destinations`, async (req, res) => {
  try {
    readActor(req);
    const query = z.object({
      state: z.enum(["active", "archived"]).default("active"),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).strict().parse(req.query);
    await connectMongo();
    const data = await listReportingDestinationSummaries(query);
    return res.json({ ok: true, data });
  } catch (error) { return sendError(res, error); }
});

router.post(`${base}/destinations`, async (req, res) => {
  try {
    const actor = ownerActor(req);
    assertReportingGoogleDeliveryEnabled();
    const body = createReportingDestinationSchema.parse(req.body ?? {});
    await connectMongo();
    const data = await createReportingDestination({
      strategy: body.strategy,
      folderSelectionReference: body.folder_selection_reference,
      createFolderName: body.create_folder_name,
      workbookSelectionReference: body.workbook_selection_reference,
      createWorkbookName: body.create_workbook_name,
      managedTabName: body.managed_tab_name,
    }, actor);
    await recordReportingAudit({
      action: "destination_create",
      outcome: "success",
      actor,
      durationMs: 0,
      destinationId: String((data as { _id?: unknown })._id ?? ""),
    });
    return res.status(201).json({ ok: true, data });
  } catch (error) { return sendError(res, error); }
});

router.get(`${base}/destinations/:id`, async (req, res) => {
  try {
    readActor(req);
    objectId(req.params.id);
    await connectMongo();
    const data = await getReportingDestinationSummary(req.params.id);
    return res.json({ ok: true, data });
  } catch (error) { return sendError(res, error); }
});

router.patch(`${base}/destinations/:id`, async (req, res) => {
  try {
    const actor = ownerActor(req);
    assertReportingGoogleDeliveryEnabled();
    objectId(req.params.id);
    const body = updateReportingDestinationSchema.parse(req.body ?? {});
    await connectMongo();
    const data = await updateReportingDestinationRecord(req.params.id, {
      expectedVersion: body.expected_version,
      managedTabName: body.managed_tab_name,
    }, actor);
    await recordReportingAudit({
      action: "destination_update",
      outcome: "success",
      actor,
      durationMs: 0,
      destinationId: req.params.id,
    });
    return res.json({ ok: true, data });
  } catch (error) { return sendError(res, error); }
});

router.post(`${base}/destinations/:id/verify`, async (req, res) => {
  try {
    const actor = ownerActor(req);
    assertReportingGoogleDeliveryEnabled();
    objectId(req.params.id);
    z.object({}).strict().parse(req.body ?? {});
    await connectMongo();
    const data = await verifyReportingDestination(req.params.id, actor);
    await recordReportingAudit({
      action: "destination_verify",
      outcome: "success",
      actor,
      durationMs: 0,
      destinationId: req.params.id,
    });
    return res.json({ ok: true, data });
  } catch (error) {
    if (
      !(error instanceof ReportingGoogleDeliveryDisabledError) &&
      !(error instanceof z.ZodError) &&
      typeof req.params.id === "string" &&
      mongoose.isValidObjectId(req.params.id)
    ) {
      await emitReportingDestinationHealthFailure({
        destinationId: req.params.id,
        reason: reportingHealthFailureReason(error),
      }).catch(() => undefined);
    }
    return sendError(res, error);
  }
});

router.delete(`${base}/destinations/:id`, async (req, res) => {
  try {
    const actor = ownerActor(req);
    assertReportingGoogleDeliveryEnabled();
    objectId(req.params.id);
    const body = archiveReportingDestinationSchema.parse(req.body ?? {});
    await connectMongo();
    const data = await archiveReportingDestinationRecord(
      req.params.id,
      body.expected_version,
      actor,
    );
    await recordReportingAudit({
      action: "destination_archive",
      outcome: "success",
      actor,
      durationMs: 0,
      destinationId: req.params.id,
    });
    return res.json({ ok: true, data });
  } catch (error) { return sendError(res, error); }
});

router.post(`${base}/draft/preview`, async (req, res) => {
  try {
    const actor = ownerActor(req);
    const started = Date.now();
    await connectMongo();
    const data = await previewReportingDraft(reportingDraftSchema.parse(req.body), actor);
    await recordReportingAudit({ action: "preview", outcome: "success", actor, durationMs: Date.now() - started, rowCount: data.estimate.rows, checksum: data.previewChecksum });
    return res.json({ ok: true, data });
  } catch (error) { return sendError(res, error); }
});

router.post(`${base}/definitions/:id/preview`, async (req, res) => {
  try {
    const actor = ownerActor(req);
    const started = Date.now();
    objectId(req.params.id);
    const body = z.object({ draft: reportingDraftSchema }).strict().parse(req.body);
    await connectMongo();
    const definition = await ReportingDefinition.findOne({ _id: req.params.id, state: "active" }).select("_id").lean().exec();
    if (!definition) return res.status(404).json({ ok: false, error: "Definition not found" });
    const data = await previewReportingDraft(body.draft, actor);
    await recordReportingAudit({ action: "preview", outcome: "success", actor, durationMs: Date.now() - started, definitionId: req.params.id, rowCount: data.estimate.rows, checksum: data.previewChecksum });
    return res.json({ ok: true, data });
  } catch (error) { return sendError(res, error); }
});

router.post(`${base}/definitions`, async (req, res) => {
  try {
    const actor = ownerActor(req);
    const started = Date.now();
    const body = saveDefinitionSchema.parse(req.body);
    await connectMongo();
    const data = await saveReportingRevision(body, actor);
    await recordReportingAudit({ action: "revision_create", outcome: "success", actor, durationMs: Date.now() - started, definitionId: data.definitionId, revisionId: data.revisionId, checksum: data.revisionSnapshotChecksum });
    return res.status(201).json({ ok: true, data });
  } catch (error) { return sendError(res, error); }
});

router.post(`${base}/definitions/:id/revisions`, async (req, res) => {
  try {
    const actor = ownerActor(req);
    const started = Date.now();
    objectId(req.params.id);
    const body = saveDefinitionSchema.parse(req.body);
    await connectMongo();
    const data = await saveReportingRevision({ ...body, definitionId: req.params.id }, actor);
    await recordReportingAudit({ action: "revision_create", outcome: "success", actor, durationMs: Date.now() - started, definitionId: data.definitionId, revisionId: data.revisionId, checksum: data.revisionSnapshotChecksum });
    return res.status(201).json({ ok: true, data });
  } catch (error) { return sendError(res, error); }
});

router.get(`${base}/definitions`, async (req, res) => {
  try {
    readActor(req);
    const query = z.object({
      state: z.enum(["active", "archived"]).default("active"),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).strict().parse(req.query);
    await connectMongo();
    const data = await ReportingDefinition.find({ state: query.state })
      .sort({ updated_at: -1, _id: 1 }).limit(query.limit).lean().exec();
    return res.json({ ok: true, data });
  } catch (error) { return sendError(res, error); }
});

router.get(`${base}/definitions/:id`, async (req, res) => {
  try {
    readActor(req); objectId(req.params.id); await connectMongo();
    const [definition, revisions] = await Promise.all([
      ReportingDefinition.findById(req.params.id).lean().exec(),
      ReportingDefinitionRevision.find({ definition_id: req.params.id }).sort({ revision_number: -1 }).lean().exec(),
    ]);
    if (!definition) return res.status(404).json({ ok: false, error: "Definition not found" });
    const previewIds = revisions.map((revision) => revision.preview_id);
    const previews = await ReportingPreview.find({ _id: { $in: previewIds } })
      .select("-sample_token -destination_snapshot").lean().exec();
    return res.json({ ok: true, data: { definition, revisions, previews } });
  } catch (error) { return sendError(res, error); }
});

router.post(`${base}/definitions/:id/clone`, async (req, res) => {
  try {
    ownerActor(req); objectId(req.params.id);
    z.object({}).strict().parse(req.body ?? {});
    await connectMongo();
    const definition = await ReportingDefinition.findById(req.params.id).lean().exec();
    const revision = definition?.current_revision_id
      ? await ReportingDefinitionRevision.findById(definition.current_revision_id).lean().exec()
      : null;
    if (!definition || !revision) return res.status(404).json({ ok: false, error: "Definition not found" });
    return res.json({
      ok: true,
      data: {
        draft: {
          name: `${definition.name} copy`, description: definition.description,
          datasetKey: revision.dataset_key, datasetSchemaVersion: revision.dataset_schema_version,
          timezone: revision.timezone, dateWindow: revision.date_window_spec,
          sources: {
            companyKeys: (revision.registry_snapshot as any).companies.map((item: any) => item.key),
            granularityKeys: (revision.registry_snapshot as any).granularities.map((item: any) => item.key),
          },
          filters: revision.filters, selectedColumns: revision.selected_columns,
          sort: revision.effective_sort.filter((term: { id: string }) =>
            REPORTING_DATASETS[
              revision.dataset_key as keyof typeof REPORTING_DATASETS
            ].allowedSorts.includes(term.id),
          ),
          destinationId: revision.destination_id,
          destinationSnapshotChecksum: revision.destination_snapshot_checksum, strategy: revision.strategy,
        },
      },
    });
  } catch (error) { return sendError(res, error); }
});

router.delete(`${base}/definitions/:id`, async (req, res) => {
  try {
    const actor = ownerActor(req); objectId(req.params.id);
    const started = Date.now();
    z.object({}).strict().parse(req.body ?? {}); await connectMongo();
    const definition = await ReportingDefinition.findOneAndUpdate(
      { _id: req.params.id, state: "active" },
      { $set: { state: "archived", updated_by: actor } },
      { returnDocument: "after" },
    ).lean().exec();
    if (!definition) return res.status(404).json({ ok: false, error: "Definition not found" });
    await recordReportingAudit({ action: "archive", outcome: "success", actor, durationMs: Date.now() - started, definitionId: req.params.id });
    return res.json({ ok: true, data: definition });
  } catch (error) { return sendError(res, error); }
});

router.post(`${base}/definitions/:id/run`, async (req, res) => {
  try {
    const actor = ownerActor(req); objectId(req.params.id);
    assertReportingGoogleDeliveryEnabled();
    const started = Date.now();
    const body = runRequestSchema.parse(req.body ?? {}); await connectMongo();
    const data = await prepareManualRun({ definitionId: req.params.id, ...body }, actor);
    const action = "requiresConfirmation" in data
      ? "run_estimate"
      : data.idempotentReplay
        ? "run_confirmation"
        : "run_queue";
    await recordReportingAudit({ action, outcome: "success", actor, durationMs: Date.now() - started, definitionId: req.params.id, runId: "runId" in data ? data.runId : undefined, rowCount: "estimate" in data ? data.estimate.rows : undefined });
    return "status" in data && data.status === "queued"
      ? res.status(202).json({ ok: true, data })
      : res.json({ ok: true, data });
  } catch (error) { return sendError(res, error); }
});

router.get(`${base}/runs`, async (req, res) => {
  try {
    readActor(req);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().parse(req.query);
    await connectMongo();
    const data = await ReportingRun.find({}).select(reportingRunReadProjection())
      .sort({ created_at: -1, _id: 1 }).limit(query.limit).lean().exec();
    return res.json({ ok: true, data: data.map(safeReportingRunForRead) });
  } catch (error) { return sendError(res, error); }
});

router.get(`${base}/runs/:id`, async (req, res) => {
  try {
    readActor(req); objectId(req.params.id); await connectMongo();
    const run = await ReportingRun.findById(req.params.id).select(reportingRunReadProjection()).lean().exec();
    if (!run) return res.status(404).json({ ok: false, error: "Run not found" });
    const delivery = await loadReportingDelivery(req.params.id);
    return res.json({
      ok: true,
      data: {
        ...safeReportingRunForRead(run),
        delivery: safeReportingDeliveryForRead(delivery),
      },
    });
  } catch (error) { return sendError(res, error); }
});

/**
 * Wire contract: POST /reporting/runs/:id/cancel
 * Body (strict): { idempotencyKey: string } — required, min 8 / max 200 chars.
 * Admin clients that omit idempotencyKey receive 400 validation errors.
 * Successful responses echo { runId, cancellation, runStatus, idempotencyKey }.
 */
router.post(`${base}/runs/:id/cancel`, async (req, res) => {
  try {
    const actor = ownerActor(req);
    objectId(req.params.id);
    const body = z
      .object({
        idempotencyKey: z.string().trim().min(8).max(200),
      })
      .strict()
      .parse(req.body ?? {});
    await connectMongo();
    const started = Date.now();
    const result = await requestReportingRunCancellation({
      runId: req.params.id,
      actorId: actor.actor_id,
      now: new Date(),
      idempotencyKey: body.idempotencyKey,
    });
    if (result.status === "not_found") {
      return res.status(404).json({ ok: false, error: "Run not found" });
    }
    if (
      result.status === "cancel_requested" ||
      result.status === "already_requested"
    ) {
      await publishReportingWakeup({
        reason: "manual",
        run_hint: req.params.id,
      });
    }
    await recordReportingAudit({
      action: "run_cancel",
      outcome: "success",
      actor,
      durationMs: Date.now() - started,
      runId: req.params.id,
      reasonCode: result.status,
    });
    return res.json({
      ok: true,
      data: {
        runId: req.params.id,
        cancellation: result.status,
        runStatus: result.runStatus ?? null,
        idempotencyKey: body.idempotencyKey,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
});

function auth(req: Request): VantageAuthContext | undefined {
  return (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
}
function readActor(req: Request) {
  return durableActorFromRegistryActor(requireRegistryReadActor(req, auth(req)));
}
function ownerActor(req: Request) {
  return durableActorFromRegistryActor(requireRegistryOwnerActor(req, auth(req)));
}
function objectId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !mongoose.isValidObjectId(value)) {
    throw new InvalidReportingObjectIdError();
  }
}
export class InvalidReportingObjectIdError extends Error {
  constructor() {
    super("Invalid Mongo ObjectId");
    this.name = "InvalidReportingObjectIdError";
  }
}
export class ReportingGoogleDeliveryDisabledError extends Error {
  constructor() {
    super("Google reporting delivery is disabled by deployment configuration.");
    this.name = "ReportingGoogleDeliveryDisabledError";
  }
}
function assertReportingGoogleDeliveryEnabled(): void {
  if (!isReportingGoogleDeliveryEnabled()) {
    throw new ReportingGoogleDeliveryDisabledError();
  }
}
function reportingHealthFailureReason(error: unknown): string {
  if (error instanceof ReportingError) return error.code;
  return "destination_verification_failed";
}
function sendError(res: Response, error: unknown) {
  const serialized = serializeReportingRouteError(error);
  return res.status(serialized.status).json(serialized.body);
}

export function serializeReportingRouteError(error: unknown): {
  status: number;
  body: Record<string, unknown>;
} {
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "Invalid request payload",
        issues: error.issues,
      },
    };
  }
  if (error instanceof ReportingError) {
    return {
      status: error.statusCode,
      body: { ok: false, code: error.code, error: error.message },
    };
  }
  if (isRegistryError(error)) {
    return {
      status: error.statusCode,
      body: error.toHttpBody(),
    };
  }
  if (error instanceof InvalidReportingObjectIdError) {
    return {
      status: 400,
      body: {
        ok: false,
        code: "invalid_object_id",
        error: "Invalid resource identifier",
      },
    };
  }
  if (error instanceof ReportingGoogleDeliveryDisabledError) {
    return {
      status: 503,
      body: {
        ok: false,
        code: "reporting_google_delivery_disabled",
        error: error.message,
      },
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      code: "reporting_internal_error",
      error: "Reporting request failed",
    },
  };
}

export function safeReportingRunForRead(
  value: Record<string, any>,
): Record<string, unknown> {
  const safe = { ...value };
  safe.failure = safeReportingFailureForRead(value.failure);
  if (safe.execution_package && typeof safe.execution_package === "object") {
    safe.execution_package = { ...safe.execution_package };
    delete safe.execution_package.destination;
  }
  // Artifact-safe progress only — never expose row payloads.
  if (safe.checkpoint && typeof safe.checkpoint === "object") {
    const cursor = (safe.checkpoint as any).cursor;
    safe.progress = {
      phase: (safe.checkpoint as any).phase ?? null,
      page_number: cursor?.page_number ?? null,
      row_count: cursor?.row_count ?? null,
      checksum_accumulator: cursor?.checksum_accumulator ?? null,
      cancellation_requested: Boolean(value.cancellation_requested_at),
    };
  } else {
    safe.progress = {
      phase: null,
      page_number: null,
      row_count: null,
      checksum_accumulator: null,
      cancellation_requested: Boolean(value.cancellation_requested_at),
    };
  }
  delete safe.checkpoint;
  return safe;
}

function reportingRunReadProjection() {
  return {
    _id: 1,
    definition_id: 1,
    definition_revision_id: 1,
    revision_snapshot_checksum: 1,
    query_input_checksum: 1,
    query_plan_checksum: 1,
    trigger: 1,
    actor: 1,
    status: 1,
    source_read_through: 1,
    estimate: 1,
    actual: 1,
    counters: 1,
    checkpoint: 1,
    final_data_checksum: 1,
    failure: 1,
    execution_package: 1,
    cancellation_requested_at: 1,
    created_at: 1,
    updated_at: 1,
    started_at: 1,
    completed_at: 1,
  };
}

export default router;
