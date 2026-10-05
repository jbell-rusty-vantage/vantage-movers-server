import { Router } from "express";
import { connectMongo } from "../db";
import { logger } from "../logger";
import { drainOutreachLeadChangeJobs } from "../services/salesOutreach/subjects/leadChangeJob";
import { reconcileOutreachRevisions, scanOutreachLeadChanges } from "../services/salesOutreach/subjects/feed";
import { requireCronAuth } from "./sales-intelligence-cron.routes";

/**
 * Sales Outreach Desk crons (IMPLEMENTATION-PLAN §6.2), registered in `vercel.json`, authenticated
 * like every `/api/cron/*` route (`Authorization: Bearer ${CRON_SECRET}` / `x-cron-secret`).
 *
 * There is no env flag: each pass reads the persisted `sales_outreach_configuration` pointer and
 * answers `{ ok: true, skipped: true, reason }` while it is uninitialized or unavailable (fail closed;
 * the tail cursor does not move, so nothing is lost).
 *
 * - lead changes (every minute): one bounded `entity_changes` tail pass, then a drain of
 *   `outreach_lead_change` jobs (≤ 100, 40 s). A failed tail pass never blocks the drain.
 * - revision reconcile (every 5 minutes): the net for Lead writes that skipped an EntityChange.
 */
export const SALES_OUTREACH_CRON_PATHS = {
  leadChanges: "/api/cron/sales-outreach-lead-changes",
  revisionReconcile: "/api/cron/sales-outreach-revision-reconcile",
} as const;

export type SalesOutreachCronDeps = {
  connect?: typeof connectMongo;
  scan?: () => ReturnType<typeof scanOutreachLeadChanges>;
  drain?: () => ReturnType<typeof drainOutreachLeadChangeJobs>;
  reconcile?: () => ReturnType<typeof reconcileOutreachRevisions>;
};

const errorName = (error: unknown) => (error instanceof Error ? error.name : "Error");

export function createSalesOutreachCronRouter(deps: SalesOutreachCronDeps = {}): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;

  router.all(SALES_OUTREACH_CRON_PATHS.leadChanges, requireCronAuth, async (_req, res) => {
    try {
      await connect();
      const tail = await (deps.scan ?? (() => scanOutreachLeadChanges()))().catch((error: unknown) => {
        logger.warn({ msg: "sales_outreach.cron.lead_change_scan_failed", errorName: errorName(error) });
        return null;
      });
      if (tail?.skipped) return res.json({ ok: true, skipped: true, reason: tail.reason });
      const drain = await (deps.drain ?? (() => drainOutreachLeadChangeJobs()))();
      return res.json({ ok: true, skipped: false, tail, drain });
    } catch (error) {
      logger.error({ msg: "sales_outreach.cron.lead_changes_failed", errorName: errorName(error) });
      return res.status(500).json({ ok: false, error: "Sales Outreach lead changes failed" });
    }
  });

  router.all(SALES_OUTREACH_CRON_PATHS.revisionReconcile, requireCronAuth, async (_req, res) => {
    try {
      await connect();
      const summary = await (deps.reconcile ?? (() => reconcileOutreachRevisions()))();
      if (summary.skipped) return res.json({ ok: true, skipped: true, reason: summary.reason, summary });
      return res.json({ ok: true, skipped: false, summary });
    } catch (error) {
      logger.error({ msg: "sales_outreach.cron.revision_reconcile_failed", errorName: errorName(error) });
      return res.status(500).json({ ok: false, error: "Sales Outreach revision reconcile failed" });
    }
  });

  return router;
}

export default createSalesOutreachCronRouter();
