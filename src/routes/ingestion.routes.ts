import mongoose from "mongoose";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { connectMongo } from "../db";
import { ExternalDataConnection } from "../models/ExternalDataConnection";
import { IngestionConflict } from "../models/IngestionConflict";
import { IngestionRun } from "../models/IngestionRun";
import { SourceRowReceipt } from "../models/SourceRowReceipt";
import { requireApiSecret, type VantageAuthContext } from "../middleware/requireApiSecret";
import {
  durableActorFromRegistryActor,
} from "../services/durableWork";
import {
  requireRegistryOwnerActor,
  requireRegistryReadActor,
} from "../services/operationsRegistry";

const router = Router();
const base = "/api/v1/admin/ingestion";

router.use(base, requireApiSecret);
router.use(base, (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();
  try {
    ownerActor(req);
    return res.status(410).json({ ok: false, code: "BEST_RELOCATION_RETIRED", error: "Best Relocation ingestion is permanently retired." });
  } catch (error) { return sendError(res, error); }
});

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
        retired: true,
        env_gate_enabled: false,
        configured_sources: null,
      },
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


function auth(req: Request): VantageAuthContext | undefined {
  return (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
}

function readActor(req: Request) {
  return durableActorFromRegistryActor(requireRegistryReadActor(req, auth(req)));
}

function ownerActor(req: Request) {
  return durableActorFromRegistryActor(requireRegistryOwnerActor(req, auth(req)));
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
