import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { connectMongo } from "../db";
import { ExternalDataConnection } from "../models/ExternalDataConnection";
import { IngestionConflict } from "../models/IngestionConflict";
import { IngestionRun } from "../models/IngestionRun";
import { SourceRowReceipt } from "../models/SourceRowReceipt";
import { requireApiSecret, type VantageAuthContext } from "../middleware/requireApiSecret";
import {
  durableActorFromRegistryActor,
  createBestRelocationIngestionActor,
  computeChecksum,
} from "../services/durableWork";
import {
  requireRegistryOwnerActor,
  requireRegistryReadActor,
} from "../services/operationsRegistry";
import {
  createQueuedIngestionRun,
  ensureBestRelocationConnection,
  publishIngestionWakeup,
} from "../services/ingestion";
import {
  inspectBestRelocationSources,
  resolveWorkbookIds,
} from "../services/bestRelocationSheetIngest";
import { maskSpreadsheetId } from "../services/operationalWorkbooks";
import { envGateEnabled } from "./best-relocation-ingestion-cron.routes";
import { canonicalDomainCommands } from "../services/domainCommands";

const router = Router();
const base = "/api/v1/admin/ingestion";

router.use(base, requireApiSecret);

router.get(`${base}/connections/best-relocation`, async (req, res) => {
  try {
    readActor(req);
    await connectMongo();
    const connection = await ExternalDataConnection.findOne({
      key: "best_relocation",
    })
      .lean()
      .exec();
    return res.json({
      ok: true,
      data: {
        ...(safeConnection(connection) ?? {
          key: "best_relocation",
          application_enabled: false,
          cadence_hours: 24,
          next_due_at: null,
          bootstrap_completed_at: null,
          health: {},
        }),
        env_gate_enabled: envGateEnabled(),
        configured_sources: configuredSourceSummary(),
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.patch(`${base}/connections/best-relocation`, async (req, res) => {
  try {
    const actor = ownerActor(req);
    const parsed = z
      .object({
        application_enabled: z.boolean().optional(),
        cadence_hours: z.union([z.literal(24), z.literal(48)]).optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0)
      .parse(req.body);
    if (parsed.application_enabled === true && !envGateEnabled()) {
      return res.status(409).json({
        ok: false,
        error: "BEST_RELOCATION_INGEST_ENABLED must be true before activation.",
      });
    }
    await connectMongo();
    await ensureBestRelocationConnection(actor);
    const connection = await ExternalDataConnection.findOneAndUpdate(
      {
        key: "best_relocation",
        ...(parsed.application_enabled === true
          ? { bootstrap_completed_at: { $type: "date" } }
          : {}),
      },
      {
        $set: {
          ...parsed,
          updated_actor: actor,
          ...(parsed.application_enabled === true
            ? {
                next_due_at: new Date(),
                application_enabled_actor: actor,
              }
            : parsed.application_enabled === false
              ? { application_enabled_actor: null }
            : parsed.cadence_hours
              ? {
                  next_due_at: new Date(
                    Date.now() +
                      parsed.cadence_hours * 60 * 60 * 1000,
                  ),
                }
            : {}),
        },
      },
      { returnDocument: "after" },
    )
      .lean()
      .exec();
    if (!connection && parsed.application_enabled === true) {
      return res.status(409).json({
        ok: false,
        error: "Bootstrap adoption must complete before scheduling is enabled.",
      });
    }
    return res.json({ ok: true, data: safeConnection(connection) });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(`${base}/connections/best-relocation/inspect`, async (req, res) => {
  try {
    const parsed = z
      .object({ repair_identity: z.boolean().default(false) })
      .strict()
      .parse(req.body ?? {});
    if (parsed.repair_identity) {
      // Repair is owner-gated and still refused outside fenced runs.
      ownerActor(req);
      return res.status(409).json({
        ok: false,
        error:
          "Identity repair is available only inside a fenced bootstrap/apply run.",
      });
    }
    // Non-mutating inspection is admin-readable health.
    readActor(req);
    const data = await inspectBestRelocationSources({
      repairIdentity: false,
    });
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(`${base}/connections/best-relocation/preview`, async (req, res) => {
  try {
    const initiator = ownerActor(req);
    const body = z
      .object({
        bootstrap: z.boolean().optional(),
        /** Mutation-free plan that completes after planning (never applies). */
        dry_run: z.boolean().optional(),
      })
      .strict()
      .parse(req.body ?? {});
    const trigger = body.bootstrap
      ? "bootstrap"
      : body.dry_run
        ? "preview"
        : "manual";
    await connectMongo();
    const connection = await ensureBestRelocationConnection(initiator) as {
      _id: unknown;
    };
    const system = createBestRelocationIngestionActor(requestId(req));
    const queued = await createQueuedIngestionRun({
      connection_id: String(connection._id),
      trigger,
      actor: system,
      initiator,
      now: new Date(),
    });
    await publishIngestionWakeup({
      reason: "manual",
      run_hint: queued.run_id,
    });
    return res.status(202).json({
      ok: true,
      data: {
        run_id: queued.run_id,
        status: "queued",
        approval_required: trigger !== "preview",
        trigger,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(`${base}/connections/best-relocation/run`, async (req, res) => {
  try {
    const actor = ownerActor(req);
    const parsed = z
      .object({
        run_id: z.string().regex(/^[a-f\d]{24}$/i),
        plan_checksum: z.string().regex(/^[a-f\d]{64}$/i),
      })
      .strict()
      .parse(req.body);
    await connectMongo();
    const candidate = await IngestionRun.findOne({
      _id: parsed.run_id,
      status: "awaiting_approval",
      plan_checksum: parsed.plan_checksum,
    })
      .select("trigger connection_id")
      .lean()
      .exec();
    if (!candidate) {
      return res.status(409).json({
        ok: false,
        error: "Run is not awaiting approval or checksum does not match.",
      });
    }
    if (candidate.trigger !== "bootstrap") {
      if (!envGateEnabled()) {
        return res.status(409).json({
          ok: false,
          error: "BEST_RELOCATION_INGEST_ENABLED must be true before apply.",
        });
      }
      const enabled = await ExternalDataConnection.exists({
        _id: candidate.connection_id,
        application_enabled: true,
      });
      if (!enabled) {
        return res.status(409).json({
          ok: false,
          error: "Application ingestion must be enabled before apply.",
        });
      }
    }
    const blocking = await IngestionConflict.countDocuments({
      run_id: parsed.run_id,
      status: "open",
      severity: { $in: ["blocking", "critical"] },
    }).exec();
    if (blocking > 0) {
      return res.status(409).json({
        ok: false,
        error: "Blocking ingestion conflicts must be dispositioned first.",
      });
    }
    const approved = await IngestionRun.findOneAndUpdate(
      {
        _id: parsed.run_id,
        status: "awaiting_approval",
        plan_checksum: parsed.plan_checksum,
        trigger: candidate.trigger,
      },
      {
        $set: {
          status: "applying",
          approval: {
            approved_at: new Date(),
            approved_by: actor,
            checksum: parsed.plan_checksum,
          },
          lease_owner: null,
          leased_until: null,
        },
      },
      { returnDocument: "after" },
    )
      .select("_id")
      .lean()
      .exec();
    if (!approved) {
      return res.status(409).json({
        ok: false,
        error: "Run approval lost a concurrent state or checksum change.",
      });
    }
    await publishIngestionWakeup({
      reason: "manual",
      run_hint: parsed.run_id,
    });
    return res.status(202).json({
      ok: true,
      data: { run_id: parsed.run_id, status: "applying" },
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get(`${base}/runs`, async (req, res) => {
  try {
    readActor(req);
    await connectMongo();
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const data = await IngestionRun.find({ adapter_key: "best_relocation" })
      .select("-plan_snapshot -source_snapshot.leads.id -source_snapshot.booked.id")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get(`${base}/runs/:runId`, async (req, res) => {
  try {
    readActor(req);
    assertObjectId(req.params.runId);
    await connectMongo();
    const run = await IngestionRun.findById(req.params.runId)
      .select("-source_snapshot.leads.id -source_snapshot.booked.id")
      .lean()
      .exec();
    if (!run) return res.status(404).json({ ok: false, error: "Run not found" });
    const receipts = await SourceRowReceipt.find({
      ingestion_run_id: req.params.runId,
    })
      .select("-workbook_id -last_applied_source_values")
      .limit(500)
      .lean()
      .exec();
    return res.json({
      ok: true,
      data: { run: safeRunDetail(run), receipts },
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(`${base}/runs/:runId/retry`, async (req, res) => {
  try {
    const initiator = ownerActor(req);
    if (!envGateEnabled()) {
      return res.status(409).json({
        ok: false,
        error: "BEST_RELOCATION_INGEST_ENABLED must be true before retry.",
      });
    }
    assertObjectId(req.params.runId);
    await connectMongo();
    const source = await IngestionRun.findOne({
      _id: req.params.runId,
      status: { $in: ["failed", "completed_with_errors"] },
      plan_snapshot: { $ne: null },
      plan_checksum: { $type: "string" },
    })
      .lean()
      .exec();
    if (!source?.plan_snapshot || !source.plan_checksum) {
      return res.status(409).json({
        ok: false,
        error: "Only failed immutable-plan runs can be retried.",
      });
    }
    const actor = createBestRelocationIngestionActor(requestId(req));
    const now = new Date();
    const retry = await IngestionRun.create({
      adapter_key: source.adapter_key,
      schema_version: source.schema_version,
      trigger: "retry",
      status: "applying",
      connection_id: source.connection_id,
      source_snapshot: source.source_snapshot,
      source_read_through: source.source_read_through,
      cutoff: source.cutoff,
      timezone: source.timezone,
      plan_snapshot: source.plan_snapshot,
      plan_checksum: source.plan_checksum,
      plan_locked_at: now,
      counters: source.counters,
      actor,
      initiator,
      approval: {
        approved_at: now,
        approved_by: initiator,
        checksum: source.plan_checksum,
        retry_of: String(source._id),
      },
      last_attempt_at: now,
    });
    await publishIngestionWakeup({
      reason: "retry",
      run_hint: String(retry._id),
    });
    return res.status(202).json({
      ok: true,
      data: { run_id: String(retry._id), status: "applying" },
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get(`${base}/conflicts`, async (req, res) => {
  try {
    readActor(req);
    await connectMongo();
    const status = z
      .enum(["open", "resolved", "dismissed"])
      .default("open")
      .parse(req.query.status);
    const data = await IngestionConflict.find({ status })
      .sort({ severity: -1, createdAt: 1 })
      .limit(200)
      .lean()
      .exec();
    return res.json({ ok: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(`${base}/conflicts/:conflictId/resolve`, async (req, res) => {
  try {
    const initiator = ownerActor(req);
    assertObjectId(req.params.conflictId);
    const parsed = z
      .discriminatedUnion("disposition", [
        z.object({
          disposition: z.literal("dismiss"),
          note: z.string().trim().min(1),
        }),
        z.object({
          disposition: z.literal("attach_booking"),
          booking_id: z.string().regex(/^[a-f\d]{24}$/i),
          lead_model: z.enum(["FormLead", "CallLead"]),
          lead_id: z.string().regex(/^[a-f\d]{24}$/i),
          expected_revision: z.number().int().min(0),
        }),
      ])
      .parse(req.body);
    await connectMongo();
    const conflict = await IngestionConflict.findOne({
      _id: req.params.conflictId,
      status: "open",
    })
      .lean()
      .exec();
    if (!conflict) {
      return res.status(404).json({ ok: false, error: "Conflict not found" });
    }
    if (parsed.disposition === "attach_booking") {
      const actor = createBestRelocationIngestionActor(requestId(req));
      const payload = {
        booking_id: parsed.booking_id,
        lead_model: parsed.lead_model,
        lead_id: parsed.lead_id,
        expected_revision: parsed.expected_revision,
      };
      const payloadChecksum = computeChecksum({
        checksum_version: 1,
        artifact_kind: "ingestion_plan",
        schema_version: 2,
        payload,
      });
      await canonicalDomainCommands.attachBookingToLead({
        ...payload,
        context: {
          command_id: sha256(
            `resolve:${req.params.conflictId}:${payloadChecksum}`,
          ),
          idempotency_key: `resolve-conflict:${req.params.conflictId}`,
          payload_checksum: payloadChecksum,
          actor,
          initiator,
          provenance: {
            origin: "external_sheet_ingestion",
            run_id: String(conflict.run_id),
            source_receipt_id: conflict.source_receipt_id
              ? String(conflict.source_receipt_id)
              : null,
            source_connection_key: "best_relocation",
          },
        },
      });
    }
    const resolved = await IngestionConflict.findByIdAndUpdate(
      req.params.conflictId,
      {
        $set: {
          status:
            parsed.disposition === "dismiss" ? "dismissed" : "resolved",
          resolution: parsed,
          resolver_actor: initiator,
          resolved_at: new Date(),
        },
      },
      { returnDocument: "after" },
    )
      .lean()
      .exec();
    return res.json({ ok: true, data: resolved });
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

function requestId(req: Request): string {
  return req.header("x-request-id")?.trim() || String(new mongoose.Types.ObjectId());
}

function configuredSourceSummary() {
  try {
    const ids = resolveWorkbookIds({ onDeprecationWarning: () => undefined });
    return {
      leads: { configured: true, masked_id: maskSpreadsheetId(ids.leadsSheetId) },
      booked: { configured: true, masked_id: maskSpreadsheetId(ids.bookedSheetId) },
    };
  } catch {
    return {
      leads: { configured: false, masked_id: null },
      booked: { configured: false, masked_id: null },
    };
  }
}

function safeConnection(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const {
    workbook_env_keys: _envKeys,
    created_actor: _createdActor,
    updated_actor: _updatedActor,
    ...safe
  } = source;
  return safe;
}

function safeRunDetail(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const run = structuredClone(value as Record<string, unknown>);
  const snapshot = run.source_snapshot;
  if (snapshot && typeof snapshot === "object") {
    for (const source of Object.values(snapshot as Record<string, unknown>)) {
      if (source && typeof source === "object") {
        delete (source as Record<string, unknown>).id;
      }
    }
  }
  const plan = run.plan_snapshot;
  if (plan && typeof plan === "object") {
    const planRecord = plan as Record<string, unknown>;
    const sources = planRecord.source_snapshot;
    if (sources && typeof sources === "object") {
      for (const source of Object.values(sources as Record<string, unknown>)) {
        if (source && typeof source === "object") {
          delete (source as Record<string, unknown>).id;
        }
      }
    }
    if (Array.isArray(planRecord.actions)) {
      planRecord.actions = planRecord.actions.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const action = { ...(entry as Record<string, unknown>) };
        delete action.command_payload;
        delete action.source_owned_values;
        action.provenance = redactProvenance(action.provenance);
        return action;
      });
    }
  }
  return run;
}

function redactProvenance(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if ("rows" in value && Array.isArray((value as { rows: unknown[] }).rows)) {
    return {
      rows: (value as { rows: unknown[] }).rows.map(redactProvenance),
    };
  }
  const source = value as Record<string, unknown>;
  return {
    workbook_title: source.workbook_title,
    tab: source.tab,
    sheet_row: source.sheet_row,
  };
}

function assertObjectId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !mongoose.isValidObjectId(value)) {
    throw new Error("Invalid Mongo ObjectId");
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sendError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      ok: false,
      error: "Invalid request payload",
      issues: error.issues,
    });
  }
  const status =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
  const rawCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : undefined;
  const code =
    rawCode && /^[a-z0-9_]{1,64}$/i.test(rawCode)
      ? rawCode.toLowerCase()
      : status >= 500
        ? "ingestion_internal_error"
        : "ingestion_request_rejected";
  return res.status(status).json({
    ok: false,
    code,
    error:
      status >= 500
        ? "Ingestion request failed"
        : "Ingestion request was rejected",
  });
}

export default router;
