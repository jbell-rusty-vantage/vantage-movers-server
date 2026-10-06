import { csiFlag } from "../../config/domain/salesIntelligence";
import { logger } from "../../logger";
import { getSalesIntelligenceSyncStateModel } from "../../models/SalesIntelligenceSyncState";
import {
  applyAllDirectionSubscriptionPlan,
  DEFAULT_RENEW_WITHIN_MS,
  DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS,
  mongoOwnershipStore,
  planAllDirectionSubscription,
  resolveAllDirectionWebhookAddress,
  ringCentralSubscriptionProvider,
  type LifecycleDeps,
  type LifecycleResult,
  type SubscriptionPlan,
} from "../ringcentral/webhook-subscription-lifecycle";

/**
 * CC-08 daily maintenance of the all-direction `/telephony/sessions` WebHook
 * subscription (cron `/api/cron/sales-intelligence-webhook-subscription`,
 * behind `SALES_INTELLIGENCE_CAPTURE_WEBHOOK`).
 *
 * Runs the lifecycle plan with its ownership guards: renew an owned matching
 * subscription with under 7 days left, repair (delete + recreate) an owned one
 * the provider reports Blacklisted/Suspended, `PUT` an owned `calls` one whose
 * filters or delivery address drifted (`update` with `filter_drift`, never a
 * duplicate create), replace (create with a verification token, then delete
 * the old one; olr CW2) an owned one whose deliveries the webhook route has
 * been refusing or a drifted one with no stored token — like a repair, this is
 * not gated by auto-create —, leave healthy or unknown-status ones alone, and
 * never touch a subscription this application did not create.
 * Creating one when none owned exists requires
 * `SALES_INTELLIGENCE_WEBHOOK_AUTO_CREATE=true`; otherwise the run reports
 * `missing` and the operator creates it with the ops command.
 *
 * Every run stores its outcome on the `webhook_subscription_maintenance`
 * sync-state row (`last_run.error_code`: null, `subscription_missing`, or the
 * failure's error class name), which the capture health read uses. Logs carry
 * the same outcome for operators.
 */
export type WebhookSubscriptionMaintenanceSummary = {
  address: string;
  plan: SubscriptionPlan["action"];
  action: "noop" | "created" | "renewed" | "updated" | "repaired" | "replaced" | "missing";
  subscription_id: string | null;
  removed_subscription_id: string | null;
  expiration_time: string | null;
  warnings: string[];
};

/** The sync-state scope holding the newest maintenance outcome. */
export const WEBHOOK_SUBSCRIPTION_SCOPE = "webhook_subscription_maintenance";
/** `last_run.error_code` of a run that found no owned subscription with auto-create off. */
export const SUBSCRIPTION_MISSING_CODE = "subscription_missing";
export type WebhookSubscriptionOutcome = { started_at: Date; finished_at: Date; error_code: string | null };

export type WebhookSubscriptionMaintenanceDeps = Partial<Pick<LifecycleDeps, "provider" | "store" | "now" | "eventFilters">> & {
  address?: string;
  autoCreate?: boolean;
  renewWithinMs?: number;
  expiresInSeconds?: number;
  recordOutcome?: (outcome: WebhookSubscriptionOutcome) => Promise<unknown>;
};

const EVENT_PREFIX = "sales_intelligence.webhook_subscription";
/** Only an error class name is stored (a message can carry a subscription id). */
const errorClassName = (error: unknown) => {
  const name = error instanceof Error ? error.name : "Error";
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : "Error";
};

export async function recordWebhookSubscriptionOutcome(outcome: WebhookSubscriptionOutcome): Promise<void> {
  await getSalesIntelligenceSyncStateModel().updateOne(
    { scope: WEBHOOK_SUBSCRIPTION_SCOPE },
    { $set: { last_run: { started_at: outcome.started_at, finished_at: outcome.finished_at, error_code: outcome.error_code } } },
    { upsert: true },
  );
}

export async function runWebhookSubscriptionMaintenance(
  deps: WebhookSubscriptionMaintenanceDeps = {},
): Promise<WebhookSubscriptionMaintenanceSummary> {
  const startedAt = deps.now?.() ?? new Date();
  // Best effort: an unavailable store must not turn a provider outcome into a different one.
  const record = (errorCode: string | null) =>
    (deps.recordOutcome ?? recordWebhookSubscriptionOutcome)({ started_at: startedAt, finished_at: new Date(), error_code: errorCode })
      .catch((error: unknown) => logger.error({ msg: `${EVENT_PREFIX}.outcome_store_failed`, errorName: errorClassName(error) }));

  let address = deps.address ?? null;
  try {
    address ??= resolveAllDirectionWebhookAddress();
    const lifecycle: LifecycleDeps = {
      provider: deps.provider ?? ringCentralSubscriptionProvider(),
      store: deps.store ?? mongoOwnershipStore(),
      address,
      now: deps.now,
      eventFilters: deps.eventFilters,
      renewWithinMs: deps.renewWithinMs ?? DEFAULT_RENEW_WITHIN_MS,
      expiresInSeconds: deps.expiresInSeconds ?? DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS,
    };
    const plan = await planAllDirectionSubscription(lifecycle);
    const base = {
      address,
      plan: plan.action,
      removed_subscription_id: null,
      expiration_time: "expiration_time" in plan ? plan.expiration_time : null,
      warnings: plan.warnings,
    };
    if (plan.warnings.length) {
      logger.warn({ msg: `${EVENT_PREFIX}.foreign_warning`, address, warnings: plan.warnings });
    }
    const autoCreate = deps.autoCreate ?? csiFlag("WEBHOOK_AUTO_CREATE");
    if (plan.action === "create" && !autoCreate) {
      logger.warn({ msg: `${EVENT_PREFIX}.missing`, address });
      await record(SUBSCRIPTION_MISSING_CODE);
      return { ...base, action: "missing", subscription_id: null };
    }
    const result: LifecycleResult = await applyAllDirectionSubscriptionPlan(plan, lifecycle);
    const summary: WebhookSubscriptionMaintenanceSummary = {
      ...base,
      action: result.action,
      subscription_id: result.subscription_id,
      removed_subscription_id: result.action === "repaired" || result.action === "replaced" ? result.removed_subscription_id : null,
    };
    if (result.action !== "noop") {
      const entry = {
        msg: `${EVENT_PREFIX}.${result.action}`,
        address,
        subscriptionId: result.subscription_id,
        removedSubscriptionId: summary.removed_subscription_id,
        priorExpiration: summary.expiration_time,
      };
      if (result.action === "repaired" || result.action === "replaced") logger.warn(entry);
      else logger.info(entry);
    }
    await record(null);
    return summary;
  } catch (error) {
    const errorName = errorClassName(error);
    const subscriptionId = (error as { subscriptionId?: unknown } | null)?.subscriptionId ?? null;
    logger.error({ msg: `${EVENT_PREFIX}.failed`, errorName, subscriptionId, address });
    await record(errorName);
    throw error;
  }
}
