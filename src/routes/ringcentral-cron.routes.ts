import { Router, type NextFunction, type Request, type Response } from "express";
import type { Logger } from "pino";
import { logger as rootLogger } from "../logger";
import { recordOperationalEvent } from "../services/observability";
import { runRingCentralAnalyticsReconcile } from "../services/ringcentral/analytics-reconcile.service";
import { runRingCentralCallLogSync } from "../services/ringcentral/call-log-sync.service";
import {
  isRingCentralAnalyticsReconcileEnabled,
  isRingCentralCallLogSyncEnabled,
} from "../services/ringcentral/ringcentral-config";

/**
 * Cron-triggered routes for the Call Log / Analytics half of the hybrid
 * pipeline. Invoked by Vercel Cron (see `vercel.json`), which sends
 * `Authorization: Bearer ${CRON_SECRET}`. For local testing the same secret
 * may be supplied via the `x-cron-secret` header.
 *
 * Each route is also gated by its feature flag so a deploy can ship the cron
 * wiring while keeping the strategy dormant (returns `skipped`).
 */
const router = Router();

type RequestWithLogger = Request & { log?: Logger };

router.all(
  "/api/cron/ringcentral-call-log-sync",
  requireCronAuth,
  async (req: Request, res: Response) => {
    const log = (req as RequestWithLogger).log ?? rootLogger;
    if (!isRingCentralCallLogSyncEnabled()) {
      return res.json({
        ok: true,
        skipped: true,
        reason: "RINGCENTRAL_CALL_LOG_SYNC_ENABLED is not true",
      });
    }

    try {
      const summary = await runRingCentralCallLogSync();
      return res.json({ ok: true, skipped: false, summary });
    } catch (error) {
      log.error({ err: error, msg: "ringcentral.cron.call_log_sync.failed" });
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Call log sync failed",
      });
    }
  },
);

router.all(
  "/api/cron/ringcentral-analytics-reconcile",
  requireCronAuth,
  async (req: Request, res: Response) => {
    const log = (req as RequestWithLogger).log ?? rootLogger;
    if (!isRingCentralAnalyticsReconcileEnabled()) {
      return res.json({
        ok: true,
        skipped: true,
        reason: "RINGCENTRAL_ANALYTICS_RECONCILE_ENABLED is not true",
      });
    }

    try {
      const summary = await runRingCentralAnalyticsReconcile();
      return res.json({ ok: true, skipped: false, summary });
    } catch (error) {
      log.error({ err: error, msg: "ringcentral.cron.analytics_reconcile.failed" });
      const message =
        error instanceof Error ? error.message : "Analytics reconcile failed";
      await recordOperationalEvent({
        level: "error",
        eventKey: "ringcentral.analytics_reconcile.failed",
        category: "ringcentral",
        workflow: "ringcentral_analytics_reconcile",
        summary: "RingCentral analytics reconcile failed.",
        request: req,
        dedupeKey: `ringcentral.analytics_reconcile.failed:${
          process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development"
        }`,
        details: { causeMessage: message },
        errorMessage: message,
        notificationCandidate: true,
      });
      return res.status(500).json({
        ok: false,
        error: message,
      });
    }
  },
);

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

export default router;
