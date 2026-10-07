import { Router, type Request, type Response } from "express";
import type { Logger } from "pino";
import { connectMongo } from "../db";
import { logger as rootLogger } from "../logger";
import { takeCapacitySnapshot } from "../services/systems";
import { requireCronAuth } from "./sales-intelligence-cron.routes";

/**
 * Daily capacity snapshot for the Systems tab (doc 11b, R2). Vercel Cron (see `vercel.json`) invokes
 * `ALL /api/cron/capacity-snapshot` at `45 8 * * *` UTC (about 04:45 New York) with
 * `Authorization: Bearer ${CRON_SECRET}` or `x-cron-secret`. One row per New York day: a second call the same
 * day answers `written: false, reason: "already_exists"`.
 */
export type CapacitySnapshotCronRouteDeps = {
  connect?: typeof connectMongo;
  snapshot?: typeof takeCapacitySnapshot;
};

export function createCapacitySnapshotCronRouter(deps: CapacitySnapshotCronRouteDeps = {}): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  const snapshot = deps.snapshot ?? takeCapacitySnapshot;

  router.all("/api/cron/capacity-snapshot", requireCronAuth, async (req: Request, res: Response) => {
    const log = (req as Request & { log?: Logger }).log ?? rootLogger;
    try {
      await connect();
      const result = await snapshot();
      log.info({ msg: "systems.capacity_snapshot", day: result.day, written: result.written });
      if (!result.written) return res.json({ ok: true, written: false, day: result.day, reason: result.reason });
      return res.json({
        ok: true,
        written: true,
        day: result.day,
        snapshot: result.snapshot,
        ...(result.partial ? { partial: result.partial } : {}),
      });
    } catch (error) {
      log.error({ err: error, msg: "systems.capacity_snapshot.failed" });
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Capacity snapshot failed",
      });
    }
  });

  return router;
}

export default createCapacitySnapshotCronRouter();
