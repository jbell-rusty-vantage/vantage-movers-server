import { timingSafeEqual } from "node:crypto";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { connectMongo } from "../db";
import { logger } from "../logger";
import {
  drainDueReceipts,
  emitDrainRunEvent,
  type DrainSummary,
  type DrainerDeps,
} from "../services/granotLifecycle/drainer";

export type GranotLifecycleCronRouteDeps = {
  connect?: typeof connectMongo;
  drain?: (deps?: DrainerDeps) => Promise<DrainSummary>;
};

export function createGranotLifecycleCronRouter(
  deps: GranotLifecycleCronRouteDeps = {},
): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  const drain = deps.drain ?? ((drainDeps?: DrainerDeps) => drainDueReceipts("cron", drainDeps));

  router.all(
    "/api/cron/granot-lifecycle-drain",
    requireCronAuth,
    async (_req: Request, res: Response) => {
      try {
        await connect();
        const summary = await drain();
        await emitDrainRunEvent(summary, false);
        return res.json({
          ok: true,
          skipped: summary.skipped,
          scanned: summary.scanned,
          claimed: summary.claimed,
          completed: summary.completed,
          retried: summary.retried,
          dead_lettered: summary.dead_lettered,
          recovered: summary.recovered,
          lease_lost: summary.lease_lost,
        });
      } catch (error) {
        logger.error({ err: error, msg: "granot_lifecycle.cron.drain.failed" });
        await emitDrainRunEvent(
          {
            trigger: "cron",
            skipped: false,
            scanned: 0,
            claimed: 0,
            completed: 0,
            retried: 0,
            dead_lettered: 0,
            recovered: 0,
            lease_lost: 0,
          },
          true,
        );
        return res.status(500).json({
          ok: false,
          error: "Granot lifecycle drain failed",
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
  const authorization = req.get("authorization")?.trim();
  const provided = authorization?.toLowerCase().startsWith("bearer ")
    ? authorization.slice("bearer ".length).trim()
    : req.get("x-cron-secret")?.trim();
  const left = Buffer.from(provided ?? "");
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }
  next();
}

export default createGranotLifecycleCronRouter();
