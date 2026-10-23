import { Router, type Request, type Response } from "express";
import { connectMongo } from "../db";
import type { VantageAuthContext } from "../middleware/requireApiSecret";
import {
  isRegistryError,
  RegistryError,
  requireRegistryOwnerActor,
} from "../services/operationsRegistry";
import { verifySignedDashboardActor } from "../services/operationsRegistry/trustedActor";
import { ADMIN_PROXY_HEADER_NAMES } from "../services/operationsRegistry/trustedActorCanonical";
import { REGISTRY_ERROR_CODES } from "../services/errors/registryErrorCodes";
import {
  DailyOperationsEventsQueryError,
  listDailyOperationsEvents,
} from "../services/dailyOperations/eventsPage";
import type { DailyOperationsLiveSseDeps } from "../services/dailyOperations/liveStream";
import { getDailyOperationsBoard } from "../services/dailyOperations/readView";
import { DailyOperationsReadViewUnavailable } from "../services/dailyOperations/readViewCache";
import { getDailyOperationsGoalSummary, getDailyOperationsLeadSpend } from "../services/dailyOperations/auxiliaryReadViews";
import {
  DailyOperationsRebuildError,
  rebuildOpenDailyOperationsDay,
} from "../services/dailyOperations/rebuild";
import { getDailyOperationsSnapshot } from "../services/dailyOperations/snapshot";

export type DailyOperationsAdminRouteDeps = {
  connect?: typeof connectMongo;
  getSnapshot?: typeof getDailyOperationsSnapshot;
  getBoard?: typeof getDailyOperationsBoard;
  getGoalSummary?: typeof getDailyOperationsGoalSummary;
  getLeadSpend?: typeof getDailyOperationsLeadSpend;
  listEvents?: typeof listDailyOperationsEvents;
  rebuild?: typeof rebuildOpenDailyOperationsDay;
  findLiveEventById?: DailyOperationsLiveSseDeps["findEventById"];
  listLiveAfter?: DailyOperationsLiveSseDeps["listAfter"];
  listLiveNewest?: DailyOperationsLiveSseDeps["listNewest"];
  getLiveRedis?: DailyOperationsLiveSseDeps["getRedis"];
  liveStreamSleep?: (ms: number) => Promise<void>;
  liveStreamNow?: () => number;
  liveStreamPollMs?: number;
  liveStreamHeartbeatMs?: number;
  liveStreamMaxMs?: number;
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
      requireDailyOperationsReader(req);
      const snapshot = await getSnapshot();
      return res.status(200).json(snapshot);
    } catch (error) {
      return sendError(res, error, requestId(req));
    }
  });

  router.get("/api/v1/admin/daily-operations/board", async (req, res) => {
    try {
      requireDailyOperationsReader(req);
      await connect();
      const board = await (deps.getBoard ?? getDailyOperationsBoard)();
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("ETag", `"dailyops:${board.day}:${board.revision}"`);
      // Always return freshness metadata; a content-only 304 could hide a stale refresh.
      return res.status(200).json(board);
    } catch (error) {
      return sendReadViewError(res, error, requestId(req));
    }
  });

  router.get("/api/v1/admin/daily-operations/goal-summary", async (req, res) => {
    try {
      requireDailyOperationsReader(req);
      await connect();
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(200).json(await (deps.getGoalSummary ?? getDailyOperationsGoalSummary)());
    } catch (error) { return sendReadViewError(res, error, requestId(req)); }
  });

  router.get("/api/v1/admin/daily-operations/lead-spend-summary", async (req, res) => {
    try {
      requireRegistryOwnerActor(req, auth(req));
      await connect();
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(200).json({ ok: true, data: await (deps.getLeadSpend ?? getDailyOperationsLeadSpend)() });
    } catch (error) { return sendReadViewError(res, error, requestId(req)); }
  });

  // Retired endpoint: native EventSource stops reconnecting on HTTP 204.
  // It never constructs Redis or enters a Mongo tail loop, even for old tabs.
  router.get("/api/v1/admin/daily-operations/live", (req, res) => {
    try {
      requireDailyOperationsReader(req);
      return res.status(204).end();
    } catch (error) { return sendError(res, error, requestId(req)); }
  });

  router.get("/api/v1/admin/daily-operations/events", async (req, res) => {
    try {
      await connect();
      requireDailyOperationsReader(req);
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

/**
 * Daily Operations reads (snapshot, live stream, events) admit the Owner and, under P09b/IMPL-03, a
 * signed Manager. The rebuild command stays Owner-only. Generic Admin and Rep stay denied.
 */
function requireDailyOperationsReader(req: Request): void {
  const role = req.header(ADMIN_PROXY_HEADER_NAMES.role)?.trim().toLowerCase();
  if (role !== "manager") {
    requireRegistryOwnerActor(req, auth(req));
    return;
  }
  const vantageAuth = auth(req);
  if (!vantageAuth || vantageAuth.kind === "scoped_key" || !verifySignedDashboardActor(req, "manager")) {
    throw new RegistryError("Daily Operations requires an Owner or Manager actor.", {
      registryCode: REGISTRY_ERROR_CODES.FORBIDDEN,
    });
  }
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

function sendReadViewError(res: Response, error: unknown, requestIdValue?: string) {
  if (isRegistryError(error)) return sendError(res, error, requestIdValue);
  const unavailable = error instanceof DailyOperationsReadViewUnavailable ? error : new DailyOperationsReadViewUnavailable();
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Retry-After", "60");
  return res.status(503).json({ ok: false, code: unavailable.code, error: unavailable.message, poll_after_ms: unavailable.poll_after_ms, request_id: requestIdValue ?? null });
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
