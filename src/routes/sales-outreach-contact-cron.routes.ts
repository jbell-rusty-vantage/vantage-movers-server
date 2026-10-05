import { Router } from "express";
import { connectMongo } from "../db";
import { logger } from "../logger";
import { drainContactJobs } from "../services/salesOutreach/contacts/jobs";
import { refreshOpenRepDays, sweepContactSources } from "../services/salesOutreach/contacts/sweep";
import { requireCronAuth } from "./sales-intelligence-cron.routes";

/**
 * Sales Outreach Desk contact-events cron (S3, SRV-6; IMPLEMENTATION-PLAN §6.2), every minute,
 * authenticated like every `/api/cron/*` route. No env flag: each step reads the persisted
 * `sales_outreach_configuration` and skips (cursor unmoved) unless it is active with `desk_enabled` or
 * `goal_metrics_enabled` on. Steps, each bounded and isolated (a failed step never blocks the next):
 *
 * 1. calls sweep — derive contact events for `call_interactions` changed since the cursor (the net
 *    under the queued wake) and recount the rep-days it moved; publishes the derivation watermark;
 * 2. SMS sweep — the same over `ringcentral_rep_sms_evidence`;
 * 3. drain queued `outreach_contact_change` and `outreach_rep_day` jobs (wake-ups that the queue lost);
 * 4. refresh — today's/yesterday's rep-days whose coverage is incomplete or whose goal is not frozen.
 */
export const SALES_OUTREACH_CONTACT_CRON_PATH = "/api/cron/sales-outreach-contact-events" as const;

export type SalesOutreachContactCronDeps = {
  connect?: typeof connectMongo;
  sweepCalls?: () => Promise<unknown>;
  sweepSms?: () => Promise<unknown>;
  drainContactChanges?: () => Promise<unknown>;
  drainRepDays?: () => Promise<unknown>;
  refreshRepDays?: () => Promise<unknown>;
};

const errorName = (error: unknown) => (error instanceof Error ? error.name : "Error");

async function step(name: string, run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    logger.warn({ msg: "sales_outreach.cron.contact_events_step_failed", step: name, errorName: errorName(error) });
    return { ok: false, error: errorName(error) };
  }
}

export function createSalesOutreachContactCronRouter(deps: SalesOutreachContactCronDeps = {}): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  router.all(SALES_OUTREACH_CONTACT_CRON_PATH, requireCronAuth, async (_req, res) => {
    try {
      await connect();
      const calls = await step("calls", deps.sweepCalls ?? (() => sweepContactSources("call", new Date(), { budgetMs: 25_000 })));
      const sms = await step("sms", deps.sweepSms ?? (() => sweepContactSources("sms", new Date(), { budgetMs: 8_000 })));
      const contactChanges = await step("contact_changes", deps.drainContactChanges ?? (() => drainContactJobs("outreach_contact_change", 100, 10_000)));
      const repDays = await step("rep_days", deps.drainRepDays ?? (() => drainContactJobs("outreach_rep_day", 100, 5_000)));
      const refresh = await step("refresh", deps.refreshRepDays ?? (() => refreshOpenRepDays()));
      return res.json({ ok: true, calls, sms, contact_changes: contactChanges, rep_days: repDays, refresh });
    } catch (error) {
      logger.error({ msg: "sales_outreach.cron.contact_events_failed", errorName: errorName(error) });
      return res.status(500).json({ ok: false, error: "Sales Outreach contact events failed" });
    }
  });
  return router;
}

export default createSalesOutreachContactCronRouter();
