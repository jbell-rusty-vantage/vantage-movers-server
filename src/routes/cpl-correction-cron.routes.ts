import { Router, type NextFunction, type Request, type Response } from "express";
import { connectMongo } from "../db";
import { logger } from "../logger";
import {
  createDefaultCplCorrectionDependencies,
  runDueCplCorrectionJobs,
} from "../services/operationsRegistry";

const router = Router();

router.all(
  "/api/cron/cpl-corrections-drain",
  requireCronAuth,
  async (_req: Request, res: Response) => {
    try {
      await connectMongo();
      const results = await runDueCplCorrectionJobs(
        createDefaultCplCorrectionDependencies(),
        { limit: 5 },
      );
      return res.json({ ok: true, claimed: results.length, results });
    } catch (error) {
      logger.error({ err: error, msg: "cpl_correction.cron.failed" });
      return res.status(500).json({
        ok: false,
        error: "CPL correction drain failed",
        code: "CPL_CORRECTION_DRAIN_FAILED",
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
    res.status(500).json({ ok: false, error: "CRON_SECRET is not configured" });
    return;
  }
  const authorization = req.get("authorization");
  const bearer = authorization?.toLowerCase().startsWith("bearer ")
    ? authorization.slice("bearer ".length).trim()
    : null;
  if (bearer === expected || req.get("x-cron-secret")?.trim() === expected) {
    next();
    return;
  }
  res.status(401).json({ ok: false, error: "Unauthorized" });
}

export default router;
