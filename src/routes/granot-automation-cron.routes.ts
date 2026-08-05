import { timingSafeEqual } from "node:crypto";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { recoverGranotRuns } from "../services/granotHttpCollector/runWorkflow";

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
