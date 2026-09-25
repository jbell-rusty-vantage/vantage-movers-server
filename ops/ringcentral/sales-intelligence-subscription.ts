import mongoose from "mongoose";
import {
  ensureAllDirectionSubscription,
  mongoOwnershipStore,
  planAllDirectionSubscription,
  renewOwnedSubscription,
  repairOwnedSubscription,
  resolveAllDirectionWebhookAddress,
  ringCentralSubscriptionProvider,
  SubscriptionOwnershipError,
  SubscriptionOwnershipRecordError,
  SubscriptionOwnershipUnavailableError,
  type LifecycleDeps,
} from "../../src/services/ringcentral/webhook-subscription-lifecycle";
import { buildRingCentralTelephonyEventFilters } from "../../src/services/ringcentral/webhook-subscriptions";

/**
 * CSI-03 ops command for the all-direction telephony subscription.
 *
 *   node --env-file=.env --import tsx ops/ringcentral/sales-intelligence-subscription.ts [--action plan|list|ensure|renew|repair] [--id <subscriptionId>] [--confirm-production-subscription]
 *
 * `plan` (default) and `list` are read-only. `ensure`, `renew` and `repair`
 * mutate provider state and refuse to run without
 * `--confirm-production-subscription`. Renew/repair additionally refuse any
 * subscription id this application did not create. The inbound-only
 * qualified-call subscription (`RINGCENTRAL_WEBHOOK_FILTER_MODE`) is a
 * separate object and is never touched by this command.
 */
type Action = "plan" | "list" | "ensure" | "renew" | "repair";

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? "";
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const action = (arg("action") ?? "plan") as Action;
  if (!["plan", "list", "ensure", "renew", "repair"].includes(action)) {
    throw new Error(`Unknown --action ${action}`);
  }
  const deps: LifecycleDeps = {
    provider: ringCentralSubscriptionProvider(),
    store: mongoOwnershipStore(),
    address: resolveAllDirectionWebhookAddress({ allowNgrok: true }),
  };
  const filters = await buildRingCentralTelephonyEventFilters("all");
  console.log(`Webhook delivery address: ${deps.address}`);
  console.log(`All-direction filters: ${JSON.stringify(filters)}`);

  if (action === "list") {
    const [records, owned] = await Promise.all([deps.provider.list(), deps.store.ownedIds()]);
    for (const record of records) {
      console.log(
        `${owned.has(record.id) ? "OWNED  " : "FOREIGN"} ${record.id} status=${record.status ?? "?"} address=${record.address ?? "?"} filters=${JSON.stringify(record.eventFilters)} expires=${record.expirationTime?.toISOString() ?? "?"}`,
      );
    }
    if (!records.length) console.log("No subscriptions visible to this application.");
    return;
  }

  if (action === "plan") {
    const plan = await planAllDirectionSubscription(deps);
    console.log(`Plan (read-only): ${JSON.stringify(plan, null, 2)}`);
    return;
  }

  if (!flag("confirm-production-subscription")) {
    throw new Error(`--action ${action} mutates provider state; re-run with --confirm-production-subscription`);
  }

  if (action === "ensure") {
    const { plan, result } = await ensureAllDirectionSubscription(deps);
    console.log(`Plan: ${JSON.stringify(plan)}`);
    console.log(`Result: ${JSON.stringify(result)}`);
    return;
  }
  const id = arg("id");
  if (!id) throw new Error(`--action ${action} requires --id <subscriptionId>`);
  const result =
    action === "renew" ? await renewOwnedSubscription(id, deps) : await repairOwnedSubscription(id, deps);
  console.log(`Result: ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    if (
      error instanceof SubscriptionOwnershipError ||
      error instanceof SubscriptionOwnershipRecordError ||
      error instanceof SubscriptionOwnershipUnavailableError
    ) {
      console.error(error.message);
    } else {
      console.error(`Sales Intelligence subscription command failed: ${error instanceof Error ? error.message : String(error)}`);
      const body = (error as { responseBody?: unknown } | null)?.responseBody;
      if (body !== undefined) console.error(`Provider response: ${JSON.stringify(body).slice(0, 1000)}`);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
