import { Router, type NextFunction, type Request, type Response } from "express";
import type { Logger } from "pino";
import { logger as rootLogger } from "../logger";
import { closeDailyOperationsDay } from "../services/dailyOperations/closeDay";

/**
 * Close-of-day for Daily Operations. Vercel Cron (see `vercel.json`) invokes
 * `ALL /api/cron/daily-operations-close` hourly at minute 5 UTC
 * (`5 * * * *`) with `Authorization: Bearer ${CRON_SECRET}` or
 * `x-cron-secret`. The handler no-ops unless an open day exists whose
 * `day` is before today America/New_York. UTC midnight is never the day key.
 */
export type DailyOperationsCronRouteDeps = {
  closeDay?: typeof closeDailyOperationsDay;
};

export function createDailyOperationsCronRouter(
  deps: DailyOperationsCronRouteDeps = {},
): Router {
  const router = Router();
  const closeDay = deps.closeDay ?? closeDailyOperationsDay;

  router.all(
    "/api/cron/daily-operations-close",
    requireCronAuth,
    async (req: Request, res: Response) => {
      const log = (req as Request & { log?: Logger }).log ?? rootLogger;
      try {
        const result = await closeDay();
        return res.json({ ok: true, ...result });
      } catch (error) {
        log.error({ err: error, msg: "daily_operations.cron.close.failed" });
        return res.status(500).json({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Daily Operations close failed",
        });
      }
    },
  );

  return router;
}

function requireCronAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    res.status(500).json({ ok: false, error: "CRON_SECRET is not set" });
    return;
  }

  const authHeader = req.get("authorization")?.trim();
  const bearer = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length).trim()
    : null;
  const headerSecret = req.get("x-cron-secret")?.trim();

  if (bearer === expected || headerSecret === expected) {
    next();
    return;
  }

  res.status(401).json({ ok: false, error: "Unauthorized" });
}

export default createDailyOperationsCronRouter();
