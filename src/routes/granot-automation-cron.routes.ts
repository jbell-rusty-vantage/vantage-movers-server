import { timingSafeEqual } from "node:crypto";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { estimatesCronDecision } from "../services/granotHttpCollector/estimatesCron";
import { poolCronDecision, poolDiscoveryDateChunks } from '../services/granotHttpCollector/poolCron';
import { salesOutreachConfigurationLoader } from '../services/salesOutreach/config/load';
import { poolEnabled } from '../services/salesOutreach/pool/policy';
import {
  createEstimatesSchedule,
  dispatchEstimatesSchedule,
  recoverGranotRuns,
  runGranotWorker,
  estimatesScheduledWindows,
} from "../services/granotHttpCollector/runWorkflow";
import { GRANOT_ESTIMATES_CRON_ACTOR_ID } from "../services/domainCommands/types";
import type { DurableActor } from "../services/durableWork/types";

const router = Router();

router.all(
  "/api/cron/granot-automation-heartbeat",
  requireCronAuth,
  async (_req: Request, res: Response) => {
    try {
      const recovery = await recoverGranotRuns();
      if (recovery.recoverable && !recovery.queue_published) {
        return res.status(503).json({
          ok: false,
          error: "Granot recovery could not publish a worker wakeup.",
        });
      }
      return res.json({ ok: true, ...recovery });
    } catch {
      return res.status(500).json({
        ok: false,
        error: "Granot recovery heartbeat failed.",
      });
    }
  },
);

router.all(
  "/api/cron/granot-estimates-in-process",
  requireCronAuth,
  async (_req: Request, res: Response) => {
    const now = new Date();
    const decision = estimatesCronDecision(now), pool = poolCronDecision(now);
    if (!decision.run && !pool.run) {
      return res.json({ ok: true, skipped: true, reason: decision.reason });
    }
    try {
      const windows = decision.run || (pool.run && pool.lane === 'pool_refresh') ? await estimatesScheduledWindows(now) : [];
      const configuration = await salesOutreachConfigurationLoader.inspect();
      const poolActive = configuration.state === 'active' && poolEnabled(configuration.value);
      const runs = [];
      const slotsToDispatch:string[]=[];
      let allScope: { totalWindows: number; windows:Array<{from:string;to:string}> } | null = null;
      if(decision.run) {
        const manifest = await createEstimatesSchedule({slotKey:decision.slotKey,lane:'all',dateWindow:decision.dateWindow,windows,initiator:estimatesCronActor(),alsoPoolRefresh:poolActive});
        allScope = {totalWindows:manifest.windows.length,windows:manifest.windows.map((w:{from:string;to:string})=>({from:w.from,to:w.to}))};
        slotsToDispatch.push(decision.slotKey);
      }
      if(pool.run && poolActive) {
        const poolWindows = pool.lane === 'pool_discovery' ? poolDiscoveryDateChunks(pool.dateWindow) : allScope?.windows ?? windows;
        await createEstimatesSchedule({slotKey:pool.slotKey,lane:pool.lane,dateWindow:pool.dateWindow,windows:poolWindows,initiator:estimatesCronActor(),
          ...(decision.run && allScope ? {afterAllCoverage:{slotKey:decision.slotKey,totalWindows:allScope.totalWindows}} : {})});
        slotsToDispatch.push(pool.slotKey);
      }
      for(const slotKey of slotsToDispatch)runs.push(...await dispatchEstimatesSchedule(slotKey));
      if(!runs.length)return res.json({ok:true,skipped:true,reason:'pool_not_enabled'});
      const created = runs[0]!;
      if (!runs.some((run) => run.queue_published)) {
        const worker = await runGranotWorker();
        return res.json({
          ok: true,
          skipped: false,
          run_id: created.run_id,
          run_ids: runs.map((run) => run.run_id),
          date_window: decision.run ? decision.dateWindow : pool.run ? pool.dateWindow : null,
          pool_enabled: poolActive,
          local_worker: worker,
        });
      }
      return res.json({
        ok: true,
        skipped: false,
        run_id: created.run_id,
        run_ids: runs.map((run) => run.run_id),
        date_window: decision.run ? decision.dateWindow : pool.run ? pool.dateWindow : null,
        pool_enabled: poolActive,
        queue_published: true,
      });
    } catch {
      return res.status(500).json({
        ok: false,
        error: "Estimates in Process cron failed.",
      });
    }
  },
);

function estimatesCronActor(): DurableActor {
  return {
    actor_type: "system",
    actor_id: GRANOT_ESTIMATES_CRON_ACTOR_ID,
    actor_label: "Estimates in Process",
    actor_role: "system",
    request_id: "granot-estimates-in-process-cron",
    origin: "vantage_admin",
  };
}

function requireCronAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    res.status(500).json({ ok: false, error: "CRON_SECRET is not set" });
    return;
  }
  const authorization = req.get("authorization")?.trim();
  const provided =
    authorization?.toLowerCase().startsWith("bearer ")
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

export default router;
