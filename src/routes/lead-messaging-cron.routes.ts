import { Router, type NextFunction, type Request, type Response } from "express";
import { connectMongo } from "../db";
import { logger } from "../logger";
import { runLeadMessagingDrain } from "../services/leadMessaging";

const router = Router();

router.all(
  "/api/cron/lead-messaging-drain",
  requireCronAuth,
  async (_req: Request, res: Response) => {
    try {
      await connectMongo();
      const summary = await runLeadMessagingDrain("cron");
      logger.info({ msg: "lead_messaging.cron.completed", ...summary });
      return res.json({ ok: true, summary });
    } catch (error) {
      logger.error({ err: error, msg: "lead_messaging.cron.failed" });
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Lead messaging drain failed",
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
