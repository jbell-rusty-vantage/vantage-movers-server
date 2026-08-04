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
import { safeReportingFailureForRead } from "../services/reporting/reportingRunRepository";
import { recordReportingAudit } from "../services/reporting/reportingAudit";

const router = Router();
const base = "/api/v1/admin/reporting";
router.use(base, requireApiSecret);

router.get(`${base}/catalog`, async (req, res) => {
  try {
    readActor(req);
    return res.json({ ok: true, data: getReportingCatalog() });
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
    return res.json({ ok: true, data: safeReportingRunForRead(run) });
  } catch (error) { return sendError(res, error); }
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
    final_data_checksum: 1,
    failure: 1,
    execution_package: 1,
    created_at: 1,
    updated_at: 1,
    started_at: 1,
    completed_at: 1,
  };
}

export default router;
