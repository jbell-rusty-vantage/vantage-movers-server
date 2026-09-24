import { csiFlag } from "../../config/domain/salesIntelligence";
import { logger } from "../../logger";
import { recordOperationalEvent } from "../observability";
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
 * the provider reports Blacklisted/Suspended, leave healthy or unknown-status
 * ones alone, and never touch a subscription this application did not create.
 * Creating one when none owned exists requires
 * `SALES_INTELLIGENCE_WEBHOOK_AUTO_CREATE=true`; otherwise the run reports
 * `missing` and the operator creates it with the ops command.
 */
export type WebhookSubscriptionMaintenanceSummary = {
  address: string;
  plan: SubscriptionPlan["action"];
  action: "noop" | "created" | "renewed" | "repaired" | "missing";
  subscription_id: string | null;
  removed_subscription_id: string | null;
  expiration_time: string | null;
  warnings: string[];
};

export type WebhookSubscriptionMaintenanceDeps = Partial<Pick<LifecycleDeps, "provider" | "store" | "now" | "eventFilters">> & {
  address?: string;
  autoCreate?: boolean;
  renewWithinMs?: number;
  expiresInSeconds?: number;
  recordEvent?: typeof recordOperationalEvent;
};

const EVENT_PREFIX = "sales_intelligence.webhook_subscription";

export async function runWebhookSubscriptionMaintenance(
  deps: WebhookSubscriptionMaintenanceDeps = {},
): Promise<WebhookSubscriptionMaintenanceSummary> {
  const recordEvent = deps.recordEvent ?? recordOperationalEvent;
  const emit = (
    level: "info" | "warn" | "error",
    kind: string,
    summary: string,
    details: Record<string, unknown>,
  ) =>
    recordEvent({
      level,
      eventKey: `${EVENT_PREFIX}.${kind}`,
      category: "ringcentral",
      workflow: "sales_intelligence",
      summary,
      details,
      notificationCandidate: level !== "info",
      reportable: false,
      piiPolicy: "none",
    }).catch(() => null);

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
      await emit("warn", "foreign_warning", "Webhook subscription plan reported warnings (foreign or unmanaged subscriptions); nothing foreign was touched.", {
        address,
        warnings: plan.warnings,
      });
    }
    const autoCreate = deps.autoCreate ?? csiFlag("WEBHOOK_AUTO_CREATE");
    if (plan.action === "create" && !autoCreate) {
      await emit("warn", "missing", "No owned all-direction webhook subscription exists and auto-create is off; webhook capture receives nothing.", { address });
      return { ...base, action: "missing", subscription_id: null };
    }
    const result: LifecycleResult = await applyAllDirectionSubscriptionPlan(plan, lifecycle);
    const summary: WebhookSubscriptionMaintenanceSummary = {
      ...base,
      action: result.action,
      subscription_id: result.subscription_id,
      removed_subscription_id: result.action === "repaired" ? result.removed_subscription_id : null,
    };
    if (result.action !== "noop") {
      await emit(
        result.action === "repaired" ? "warn" : "info",
        result.action,
        `All-direction webhook subscription ${result.action}.`,
        {
          address,
          subscriptionId: result.subscription_id,
          removedSubscriptionId: summary.removed_subscription_id,
          priorExpiration: summary.expiration_time,
        },
      );
    }
    return summary;
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "Error";
    const subscriptionId = (error as { subscriptionId?: unknown } | null)?.subscriptionId ?? null;
    logger.error({ msg: `${EVENT_PREFIX}.failed`, errorName, subscriptionId });
    await emit("error", "failed", "All-direction webhook subscription maintenance failed.", {
      address,
      errorName,
      subscriptionId,
      message: error instanceof Error ? error.message.slice(0, 300) : null,
    });
    throw error;
  }
}
