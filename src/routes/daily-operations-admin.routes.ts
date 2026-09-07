import { Router, type Request, type Response } from "express";
import { connectMongo } from "../db";
import type { VantageAuthContext } from "../middleware/requireApiSecret";
import {
  isRegistryError,
  requireRegistryOwnerActor,
} from "../services/operationsRegistry";
import {
  DailyOperationsEventsQueryError,
  listDailyOperationsEvents,
} from "../services/dailyOperations/eventsPage";
import {
  DailyOperationsRebuildError,
  rebuildOpenDailyOperationsDay,
} from "../services/dailyOperations/rebuild";
import { getDailyOperationsSnapshot } from "../services/dailyOperations/snapshot";

export type DailyOperationsAdminRouteDeps = {
  connect?: typeof connectMongo;
  getSnapshot?: typeof getDailyOperationsSnapshot;
  listEvents?: typeof listDailyOperationsEvents;
  rebuild?: typeof rebuildOpenDailyOperationsDay;
};

export function createDailyOperationsAdminRouter(
  deps: DailyOperationsAdminRouteDeps = {},
): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  const getSnapshot = deps.getSnapshot ?? getDailyOperationsSnapshot;
  const listEvents = deps.listEvents ?? listDailyOperationsEvents;
  const rebuild = deps.rebuild ?? rebuildOpenDailyOperationsDay;

  router.get("/api/v1/admin/daily-operations", async (req, res) => {
    try {
      await connect();
      requireRegistryOwnerActor(req, auth(req));
      const snapshot = await getSnapshot();
      return res.status(200).json(snapshot);
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

  router.get("/api/v1/admin/daily-operations/events", async (req, res) => {
    try {
      await connect();
      requireRegistryOwnerActor(req, auth(req));
      const page = await listEvents({
        cursor: asString(req.query.cursor),
        lane: asString(req.query.lane),
        limit: asLimit(req.query.limit),
      });
      return res.status(200).json(page);
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

  router.post("/api/v1/admin/daily-operations/rebuild", async (req, res) => {
    try {
      await connect();
      requireRegistryOwnerActor(req, auth(req));
      const result = await rebuild();
      return res.status(200).json(result);
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asLimit(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function sendError(res: Response, error: unknown, requestIdValue?: string) {
  if (error instanceof DailyOperationsRebuildError) {
    return res.status(error.statusCode).json({
      ok: false,
      code: error.code,
      error: error.message,
      request_id: requestIdValue ?? null,
    });
  }
  if (error instanceof DailyOperationsEventsQueryError) {
    return res.status(error.statusCode).json({
      ok: false,
      code: error.code,
      error: error.message,
      request_id: requestIdValue ?? null,
    });
  }
  if (isRegistryError(error)) {
    const ownerRequired =
      error.statusCode === 403 || String(error.registryCode).includes("ACTOR_");
    if (ownerRequired) {
      return res.status(403).json({
        ok: false,
        code: "OWNER_REQUIRED",
        error: "Owner authority is required",
        request_id: requestIdValue ?? null,
      });
    }
    return res.status(error.statusCode).json({
      ok: false,
      code: error.registryCode,
      error: error.message,
      request_id: requestIdValue ?? null,
    });
  }
  throw error;
}

export default createDailyOperationsAdminRouter();
