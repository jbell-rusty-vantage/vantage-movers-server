import { logger } from "../../../logger";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import {
  applyRepSmsSubscriptionPlan,
  DEFAULT_RENEW_WITHIN_MS,
  DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS,
  mongoOwnershipStore,
  planRepSmsSubscription,
  resolveAllDirectionWebhookAddress,
  ringCentralSubscriptionProvider,
  type OwnershipStore,
  type RepSmsChannelHealth,
  type RepSmsLifecycleResult,
  type SubscriptionProvider,
} from "../webhook-subscription-lifecycle";
import { repSmsCaptureEnabled } from "./gate";
import { listReviewedRepMailboxes } from "./mailboxes";

/**
 * Daily `rep_sms` subscription maintenance, run by the existing subscription cron
 * (`/api/cron/sales-intelligence-webhook-subscription`, `15 6 * * *`) after the `calls` step
 * (RINGCENTRAL-CAPTURE §3): renew when expiring, and `PUT` the owned subscription when its filters
 * drifted from the current reviewed `sales_rep` mailbox set or it lacks a verification token. It never
 * creates or recreates the subscription (that is the operator's user-authorized step,
 * `ops/ringcentral/rep-sms-subscription.ts`) and never touches a subscription it did not create.
 *
 * Runs only when `controls.rep_sms_capture_enabled` is on. Each run stores the channel health on the
 * sync-state row `webhook_subscription_maintenance:rep_sms` (`last_run.error_code`: null when healthy,
 * else `subscription_missing` / `expired` / `blacklisted` / `filter_drift` / `token_missing` /
 * `no_mailboxes`, or the failure's error class name).
 */
export const REP_SMS_SUBSCRIPTION_SCOPE = "webhook_subscription_maintenance:rep_sms";

export type RepSmsSubscriptionSummary =
  | { skipped: true; reason: "capture_disabled" }
  | {
      skipped: false;
      health: RepSmsChannelHealth;
      plan: string;
      result: RepSmsLifecycleResult["action"];
      subscription_id: string | null;
      mailboxes: number;
      warnings: string[];
    };

export type RepSmsSubscriptionMaintenanceDeps = {
  enabled?: () => Promise<boolean>;
  provider?: SubscriptionProvider;
  store?: OwnershipStore;
  address?: string;
  mailboxes?: () => Promise<string[]>;
  now?: () => Date;
  recordOutcome?: (errorCode: string | null, startedAt: Date) => Promise<unknown>;
};

async function recordOutcome(errorCode: string | null, startedAt: Date): Promise<void> {
  await getSalesIntelligenceSyncStateModel().updateOne(
    { scope: REP_SMS_SUBSCRIPTION_SCOPE },
    { $set: { last_run: { started_at: startedAt, finished_at: new Date(), error_code: errorCode } } },
    { upsert: true },
  );
}

export async function runRepSmsSubscriptionMaintenance(
  deps: RepSmsSubscriptionMaintenanceDeps = {},
): Promise<RepSmsSubscriptionSummary> {
  if (!(await (deps.enabled ?? repSmsCaptureEnabled)())) return { skipped: true, reason: "capture_disabled" };
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const record = (code: string | null) =>
    (deps.recordOutcome ?? recordOutcome)(code, startedAt).catch((error: unknown) =>
      logger.error({ msg: "sales_outreach.rep_sms_subscription.outcome_store_failed", errorName: error instanceof Error ? error.name : "Error" }),
    );
  try {
    const mailboxes = await (deps.mailboxes ?? (async () => (await listReviewedRepMailboxes(now())).map((m) => m.extension_id)))();
    const lifecycle = {
      provider: deps.provider ?? ringCentralSubscriptionProvider(),
      store: deps.store ?? mongoOwnershipStore(),
      address: deps.address ?? resolveAllDirectionWebhookAddress(),
      mailboxes: async () => mailboxes,
      now,
      renewWithinMs: DEFAULT_RENEW_WITHIN_MS,
      expiresInSeconds: DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS,
    };
    const plan = await planRepSmsSubscription(lifecycle);
    const result = await applyRepSmsSubscriptionPlan(plan, lifecycle, { allowCreate: false });
    // After a successful filter/token update the channel is healthy again.
    const health: RepSmsChannelHealth = result.action === "updated" || result.action === "renewed" ? "ok" : plan.health;
    if (plan.warnings.length) logger.warn({ msg: "sales_outreach.rep_sms_subscription.warning", warnings: plan.warnings });
    if (result.action !== "noop") {
      logger.info({ msg: "sales_outreach.rep_sms_subscription.applied", plan: plan.action, result: result.action, health });
    }
    await record(health === "ok" ? null : health);
    return {
      skipped: false,
      health,
      plan: plan.action,
      result: result.action,
      subscription_id: "subscription_id" in result ? result.subscription_id : null,
      mailboxes: mailboxes.length,
      warnings: plan.warnings,
    };
  } catch (error) {
    const errorName = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name) ? error.name : "Error";
    logger.error({ msg: "sales_outreach.rep_sms_subscription.failed", errorName });
    await record(errorName);
    throw error;
  }
}
