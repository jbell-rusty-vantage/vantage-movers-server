import { Router, type NextFunction, type Request, type Response } from "express";
import type { Logger } from "pino";
import { logger as rootLogger } from "../logger";
import {
  recordOperationalEvent,
  retryFailedNotifications,
  sendDailyOwnerDigest,
} from "../services/observability";

/**
 * Cron-triggered notification jobs (see `vercel.json`). Invoked by Vercel Cron
 * with `Authorization: Bearer ${CRON_SECRET}`; for local testing the same
 * secret may be supplied via the `x-cron-secret` header.
 *
 * The daily digest job sends one owner summary email and retries recently
 * failed deliveries. Both are best-effort and never throw out of the route.
 */
const router = Router();

type RequestWithLogger = Request & { log?: Logger };

router.all(
  "/api/cron/notifications-digest-daily",
  requireCronAuth,
  async (req: Request, res: Response) => {
    const log = (req as RequestWithLogger).log ?? rootLogger;
    try {
      const digest = await sendDailyOwnerDigest();
      const retry = await retryFailedNotifications();
      return res.json({ ok: true, digest, retry });
    } catch (error) {
      log.error({ err: error, msg: "notification.cron.digest.failed" });
      void recordOperationalEvent({
        level: "error",
        eventKey: "notification.digest_cron.failed",
        category: "cron",
        workflow: "notification_digest",
        summary: "Notification digest cron failed.",
        request: req,
        statusCode: 500,
        dedupeKey: `notification.digest_cron.failed:${process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development"}`,
        details: {
          causeMessage: error instanceof Error ? error.message : String(error),
        },
        errorMessage: error instanceof Error ? error.message : String(error),
        notificationCandidate: true,
      });
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Notification digest failed",
      });
    }
  },
);

function requireCronAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    void recordOperationalEvent({
      level: "error",
      eventKey: "cron.auth.failed",
      category: "cron",
      workflow: "notification_digest",
      summary: "Notification cron rejected request because CRON_SECRET is not configured.",
      request: req,
      statusCode: 500,
      details: { reason: "missing_cron_secret" },
      notificationCandidate: false,
      reportable: true,
    });
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

  void recordOperationalEvent({
    level: "warn",
    eventKey: "cron.auth.failed",
    category: "cron",
    workflow: "notification_digest",
    summary: "Unauthorized notification cron request rejected.",
    request: req,
    statusCode: 401,
    details: { reason: "invalid_cron_secret" },
    notificationCandidate: false,
    reportable: true,
  });
  res.status(401).json({ ok: false, error: "Unauthorized" });
}

export default router;
