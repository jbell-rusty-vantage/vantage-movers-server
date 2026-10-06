import { logger } from "../../logger";
import { getSalesIntelligenceSyncStateModel } from "../../models/SalesIntelligenceSyncState";
import { repSmsCaptureEnabled } from "./repSms/gate";
import { listReviewedRepMailboxes } from "./repSms/mailboxes";
import {
  DEFAULT_RENEW_WITHIN_MS,
  mongoOwnershipStore,
  planAllDirectionSubscription,
  planRepSmsSubscription,
  resolveAllDirectionWebhookAddress,
  ringCentralSubscriptionProvider,
  type OwnershipStore,
  type RepSmsChannelHealth,
  type SubscriptionPlan,
  type SubscriptionProvider,
  type SubscriptionRecord,
} from "./webhook-subscription-lifecycle";

/**
 * RINGCENTRAL-CAPTURE §3 `ownerCoverage`: the 5-minute webhook subscription health check
 * (cron `/api/cron/sales-intelligence-subscription-health`, every 5 minutes, behind
 * `SALES_INTELLIGENCE_CAPTURE_WEBHOOK`).
 *
 * Read-only against RingCentral: one `GET /subscription` per run, shared by both channel
 * evaluations through the memoized provider below, then the existing read-only plans decide
 * (`planAllDirectionSubscription` for `calls`, `planRepSmsSubscription` for `rep_sms`). It never
 * creates, renews, updates or deletes a subscription and never touches a foreign one; the daily
 * maintenance cron owns every mutation. Logs carry channel health, the owned subscription id and
 * the number of plan warnings only — never a foreign subscription's id or address.
 *
 * olr CW2: the plans also read the webhook route's refusal counter (`OwnershipStore.deliveryRefusals`),
 * so an owned subscription the provider reports Active while the route refuses its deliveries reads
 * `deliveries_refused` (incident 2026-10-06: ~22 h of refused deliveries before RingCentral blacklisted it).
 *
 * Each run upserts one sync-state row per channel (`webhook_subscription_health:calls`,
 * `webhook_subscription_health:rep_sms`) with `last_run.error_code` null when healthy, the health
 * string otherwise, or the failure's error class name — the convention of the maintenance rows.
 */
export const SUBSCRIPTION_HEALTH_SCOPE_CALLS = "webhook_subscription_health:calls";
export const SUBSCRIPTION_HEALTH_SCOPE_REP_SMS = "webhook_subscription_health:rep_sms";

/** A channel whose evaluation threw; `error_name` carries the error class name. */
export const SUBSCRIPTION_HEALTH_CHECK_FAILED = "check_failed";
/** `rep_sms` while `controls.rep_sms_capture_enabled` is off: skipped, still recorded. */
export const REP_SMS_NOT_CONNECTED = "not_connected";

export type CallsChannelHealth =
  | "ok"
  | "subscription_missing"
  | "expired"
  | "blacklisted"
  | "filter_drift"
  | "token_missing"
  /** olr CW2: Active at the provider while the webhook route refuses its deliveries (newest refusal ≤ 30 min, none accepted since). */
  | "deliveries_refused";
export type RepSmsHealthReport = RepSmsChannelHealth | typeof REP_SMS_NOT_CONNECTED;

type ChannelReport<Health extends string> = {
  health: Health | typeof SUBSCRIPTION_HEALTH_CHECK_FAILED;
  /** Error class name when `health` is `check_failed`; null otherwise. */
  error_name: string | null;
  /** The owned subscription the plan settled on, when one exists. */
  subscription_id: string | null;
  expires_at: string | null;
  /** Number of plan warnings (foreign same-address subscriptions, duplicates, unknown status). */
  warnings: number;
};

export type SubscriptionHealthSummary = {
  started_at: string;
  calls: ChannelReport<CallsChannelHealth>;
  rep_sms: ChannelReport<RepSmsHealthReport> & { mailboxes: number };
};

export type SubscriptionHealthOutcome = { started_at: Date; finished_at: Date; error_code: string | null };

export type SubscriptionHealthDeps = {
  provider?: SubscriptionProvider;
  store?: OwnershipStore;
  address?: string;
  now?: () => Date;
  renewWithinMs?: number;
  /** `calls` event filters (defaults to the all-direction telephony filter). */
  eventFilters?: () => Promise<string[]>;
  /** `controls.rep_sms_capture_enabled`. */
  enabled?: () => Promise<boolean>;
  /** Extension ids of the current reviewed `sales_rep` mailboxes. */
  mailboxes?: () => Promise<string[]>;
  recordOutcome?: (scope: string, outcome: SubscriptionHealthOutcome) => Promise<unknown>;
};

const EVENT_PREFIX = "sales_outreach.subscription_health";

/** Only an error class name is stored or logged (a message can carry a subscription id or address). */
const errorClassName = (error: unknown) => {
  const name = error instanceof Error ? error.name : "Error";
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : "Error";
};

/**
 * `list()` resolves once per run and both channels share the result (a rejection too, so a failing
 * provider costs one request). The mutating methods are deliberately not exposed: the health check
 * has no way to call them.
 */
function readOnlyMemoizedProvider(provider: SubscriptionProvider): SubscriptionProvider {
  let listed: Promise<SubscriptionRecord[]> | null = null;
  const refuse = (operation: string) => async (): Promise<never> => {
    throw new Error(`subscription health check is read-only; refusing to ${operation}`);
  };
  return {
    list: () => (listed ??= provider.list()),
    create: refuse("create"),
    renew: refuse("renew"),
    remove: refuse("delete"),
    update: refuse("update"),
  };
}

export async function recordSubscriptionHealthOutcome(scope: string, outcome: SubscriptionHealthOutcome): Promise<void> {
  await getSalesIntelligenceSyncStateModel().updateOne(
    { scope },
    {
      $set: {
        last_run: {
          started_at: outcome.started_at,
          finished_at: outcome.finished_at,
          runtime_ms: Math.max(0, outcome.finished_at.getTime() - outcome.started_at.getTime()),
          error_code: outcome.error_code,
        },
      },
    },
    { upsert: true },
  );
}

/** Pure: the `calls` plan read as a channel health (RINGCENTRAL-CAPTURE §3). */
export function callsHealthFromPlan(plan: SubscriptionPlan): CallsChannelHealth {
  switch (plan.action) {
    case "noop":
    case "renew":
      return "ok";
    case "create":
      return "subscription_missing";
    case "repair":
      return plan.health === "blacklisted" ? "blacklisted" : "expired";
    case "update":
      return "filter_drift";
    case "replace":
      if (plan.reasons.includes("deliveries_refused")) return "deliveries_refused";
      return plan.reasons.includes("filter_drift") ? "filter_drift" : "token_missing";
  }
}

export async function runSubscriptionHealthCheck(deps: SubscriptionHealthDeps = {}): Promise<SubscriptionHealthSummary> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const provider = readOnlyMemoizedProvider(deps.provider ?? ringCentralSubscriptionProvider());
  const store = deps.store ?? mongoOwnershipStore();
  const renewWithinMs = deps.renewWithinMs ?? DEFAULT_RENEW_WITHIN_MS;
  // Lazy so a missing webhook address is a per-channel failure, recorded like any other.
  const address = () => deps.address ?? resolveAllDirectionWebhookAddress();
  // Best effort: an unavailable store must not turn a provider outcome into a different one.
  const record = (scope: string, errorCode: string | null) =>
    (deps.recordOutcome ?? recordSubscriptionHealthOutcome)(scope, { started_at: startedAt, finished_at: now(), error_code: errorCode }).catch(
      (error: unknown) => logger.error({ msg: `${EVENT_PREFIX}.outcome_store_failed`, scope, errorName: errorClassName(error) }),
    );

  let calls: SubscriptionHealthSummary["calls"];
  try {
    const plan = await planAllDirectionSubscription({
      provider,
      store,
      address: address(),
      now,
      renewWithinMs,
      eventFilters: deps.eventFilters,
    });
    const health = callsHealthFromPlan(plan);
    calls = {
      health,
      error_name: null,
      subscription_id: "subscription_id" in plan ? plan.subscription_id : null,
      expires_at: "expiration_time" in plan ? plan.expiration_time : null,
      warnings: plan.warnings.length,
    };
    await record(SUBSCRIPTION_HEALTH_SCOPE_CALLS, health === "ok" ? null : health);
  } catch (error) {
    const errorName = errorClassName(error);
    calls = { health: SUBSCRIPTION_HEALTH_CHECK_FAILED, error_name: errorName, subscription_id: null, expires_at: null, warnings: 0 };
    await record(SUBSCRIPTION_HEALTH_SCOPE_CALLS, errorName);
  }

  let repSms: SubscriptionHealthSummary["rep_sms"];
  try {
    if (!(await (deps.enabled ?? repSmsCaptureEnabled)())) {
      repSms = { health: REP_SMS_NOT_CONNECTED, error_name: null, subscription_id: null, expires_at: null, mailboxes: 0, warnings: 0 };
      await record(SUBSCRIPTION_HEALTH_SCOPE_REP_SMS, REP_SMS_NOT_CONNECTED);
    } else {
      const mailboxes = await (deps.mailboxes ?? (async () => (await listReviewedRepMailboxes(now())).map((m) => m.extension_id)))();
      const plan = await planRepSmsSubscription({
        provider,
        store,
        address: address(),
        mailboxes: async () => mailboxes,
        now,
        renewWithinMs,
      });
      repSms = {
        health: plan.health,
        error_name: null,
        subscription_id: "subscription_id" in plan ? plan.subscription_id : null,
        expires_at: "expiration_time" in plan ? plan.expiration_time : null,
        mailboxes: mailboxes.length,
        warnings: plan.warnings.length,
      };
      await record(SUBSCRIPTION_HEALTH_SCOPE_REP_SMS, plan.health === "ok" ? null : plan.health);
    }
  } catch (error) {
    const errorName = errorClassName(error);
    repSms = { health: SUBSCRIPTION_HEALTH_CHECK_FAILED, error_name: errorName, subscription_id: null, expires_at: null, mailboxes: 0, warnings: 0 };
    await record(SUBSCRIPTION_HEALTH_SCOPE_REP_SMS, errorName);
  }

  const summary: SubscriptionHealthSummary = { started_at: startedAt.toISOString(), calls, rep_sms: repSms };
  const entry = {
    msg: `${EVENT_PREFIX}.checked`,
    calls: calls.health,
    callsSubscriptionId: calls.subscription_id,
    callsErrorName: calls.error_name,
    callsWarnings: calls.warnings,
    repSms: repSms.health,
    repSmsSubscriptionId: repSms.subscription_id,
    repSmsErrorName: repSms.error_name,
    repSmsMailboxes: repSms.mailboxes,
    repSmsWarnings: repSms.warnings,
  };
  const healthy = calls.health === "ok" && (repSms.health === "ok" || repSms.health === REP_SMS_NOT_CONNECTED);
  if (healthy) logger.info(entry);
  else logger.warn(entry);
  return summary;
}
