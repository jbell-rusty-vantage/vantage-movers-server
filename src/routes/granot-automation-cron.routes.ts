import { timingSafeEqual } from "node:crypto";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { estimatesCronDecision } from "../services/granotHttpCollector/estimatesCron";
import {
  createGranotRun,
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
    const decision = estimatesCronDecision(new Date());
    if (!decision.run) {
      return res.json({ ok: true, skipped: true, reason: decision.reason });
    }
    try {
      const windows = await estimatesScheduledWindows(new Date());
      const runs = [];
      for (const dateWindow of windows) {
        runs.push(await createGranotRun({
          operation: "estimates_in_process",
          workflow: "apply",
          dateWindow,
          sourceLabels: [],
          autoApply: true,
          scheduledSlotKey: `${decision.slotKey}:${dateWindow.from}:${dateWindow.to}`,
          scheduledCoverage: {
            slotKey: decision.slotKey,
            dateWindow: decision.dateWindow,
            totalWindows: windows.length,
          },
          initiator: estimatesCronActor(),
        }));
      }
      const created = runs[0]!;
      if (!runs.some((run) => run.queue_published)) {
        const worker = await runGranotWorker();
        return res.json({
          ok: true,
          skipped: false,
          run_id: created.run_id,
          run_ids: runs.map((run) => run.run_id),
          date_window: decision.dateWindow,
          local_worker: worker,
        });
      }
      return res.json({
        ok: true,
        skipped: false,
        run_id: created.run_id,
        run_ids: runs.map((run) => run.run_id),
        date_window: decision.dateWindow,
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
