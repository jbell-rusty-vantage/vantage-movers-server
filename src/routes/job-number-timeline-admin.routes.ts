import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { connectMongo } from "../db";
import { logger } from "../logger";
import type { VantageAuthContext } from "../middleware/requireApiSecret";
import {
  isRegistryError,
  requireRegistryOwnerActor,
} from "../services/operationsRegistry";
import {
  createJobNumberTimelineModule,
  type JobTimelineAssembleResult,
} from "../services/jobNumberTimeline";
import { createMongoEvidenceLoader } from "../services/jobNumberTimeline/mongo-evidence-loader";
import {
  createMongoRecentOfficialBookingLister,
  listRecentOfficialBookingExamples,
  type RecentOfficialBookingExample,
} from "../services/jobNumberTimeline/recent-official-bookings";

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
  listRecentOfficialBookings?: () => Promise<RecentOfficialBookingExample[]>;
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
  return createJobNumberTimelineModule({
    loader: createMongoEvidenceLoader({ db }),
  }).read(input);
}

async function defaultListRecentOfficialBookings(): Promise<RecentOfficialBookingExample[]> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Mongo is not connected");
  }
  return listRecentOfficialBookingExamples(createMongoRecentOfficialBookingLister(db));
}

export function createJobNumberTimelineAdminRouter(
  deps: JobNumberTimelineAdminDeps = {},
): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  const read = deps.read ?? defaultRead;
  const listRecentOfficialBookings =
    deps.listRecentOfficialBookings ?? defaultListRecentOfficialBookings;

  router.get("/api/v1/admin/job-number-timeline/recent-official-bookings", async (req, res) => {
    try {
      await connect();
      requireRegistryOwnerActor(req, auth(req));
      const bookings = await listRecentOfficialBookings();
      return res.status(200).json({ ok: true, data: { bookings } });
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

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
  logger.error({
    err: error,
    request_id: requestIdValue ?? null,
    msg: "job-number-timeline.admin.unhandled",
  });
  return res.status(500).json({
    ok: false,
    error: "Internal error",
    request_id: requestIdValue ?? null,
  });
}

const router = createJobNumberTimelineAdminRouter();
export default router;
