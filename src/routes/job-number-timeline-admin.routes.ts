import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { connectMongo } from "../db";
import type { VantageAuthContext } from "../middleware/requireApiSecret";
import {
  isRegistryError,
  requireRegistryOwnerActor,
} from "../services/operationsRegistry";
import { assembleJobNumberTimeline } from "../../scripts/prototypes/job-number-timeline/src/assemble.js";
import {
  loadCompanyGranularityIds,
  loadJobNumberTimelineRows,
} from "../../scripts/prototypes/job-number-timeline/src/load.js";
import { redactTimelineValue } from "../../scripts/prototypes/job-number-timeline/src/masking.js";
import { normalizeTypedJobNo } from "../../scripts/prototypes/job-number-timeline/src/normalize.js";
import type { JobTimelineAssembleResult } from "../../scripts/prototypes/job-number-timeline/src/types.js";

const querySchema = z.object({
  job_no: z.string().trim().min(1),
  source_granularity_id: z.string().trim().min(1).optional(),
  source_company_id: z.string().trim().min(1).optional(),
});

export type JobNumberTimelineAdminDeps = {
  connect?: typeof connectMongo;
  read?: (input: {
    job_no: string;
    source_granularity_id?: string;
    source_company_id?: string;
  }) => Promise<JobTimelineAssembleResult>;
};

async function defaultRead(input: {
  job_no: string;
  source_granularity_id?: string;
  source_company_id?: string;
}): Promise<JobTimelineAssembleResult> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Mongo is not connected");
  }
  const normalized = normalizeTypedJobNo(input.job_no);
  if (!normalized) {
    return { status: "invalid_job_number", normalized_job_no: null };
  }
  let company_granularity_ids: string[] | undefined;
  if (input.source_company_id) {
    company_granularity_ids = await loadCompanyGranularityIds(db, input.source_company_id);
    if (
      input.source_granularity_id
      && !company_granularity_ids.includes(input.source_granularity_id)
    ) {
      return { status: "filtered_out", normalized_job_no: normalized, scopes: [] };
    }
  }
  const rows = await loadJobNumberTimelineRows(db, normalized);
  const result = assembleJobNumberTimeline({
    rawJobNo: input.job_no,
    filters: {
      source_granularity_id: input.source_granularity_id,
      source_company_id: input.source_company_id,
      company_granularity_ids,
    },
    rows,
  });
  if (result.status === "ok") {
    return { status: "ok", page: redactTimelineValue(result.page) as typeof result.page };
  }
  return result;
}

export function createJobNumberTimelineAdminRouter(
  deps: JobNumberTimelineAdminDeps = {},
): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  const read = deps.read ?? defaultRead;

  router.get("/api/v1/admin/job-number-timeline", async (req, res) => {
    try {
      await connect();
      requireRegistryOwnerActor(req, auth(req));
      const query = querySchema.parse(req.query);
      const data = await read(query);
      return res.status(200).json({ ok: true, data });
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

  return router;
}

function auth(req: Request): VantageAuthContext | undefined {
  return (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
}

function requestId(req: Request): string | undefined {
  const header = req.header("x-vantage-admin-request-id") ?? req.header("x-request-id");
  return header?.trim() || undefined;
}

function sendError(res: Response, error: unknown, requestIdValue?: string) {
  if (isRegistryError(error)) {
    return res.status(error.statusCode).json({
      ok: false,
      code: error.registryCode,
      error: error.message,
      request_id: requestIdValue ?? null,
    });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      ok: false,
      error: "invalid_job_number",
      request_id: requestIdValue ?? null,
    });
  }
  return res.status(500).json({
    ok: false,
    error: error instanceof Error ? error.message : "Internal error",
    request_id: requestIdValue ?? null,
  });
}

const router = createJobNumberTimelineAdminRouter();
export default router;
