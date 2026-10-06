/**
 * Re-point guard for the legacy all-direction subscription command
 * (`ops/ringcentral/sales-intelligence-subscription.ts`, olr CW0).
 *
 * That command resolves its delivery address with `allowNgrok`, so a developer tunnel
 * (`RINGCENTRAL_NGROK_WEBHOOK_URL`) wins over `RINGCENTRAL_WEBHOOK_URL`. Before C6 an `ensure` with a
 * tunnel address created a separate subscription next to the production one. Since C6
 * (`planAllDirectionSubscription` plans `update` / `repair` for a drifted owned `calls` subscription)
 * the same run would `PUT` the production subscription onto the tunnel, or delete it and recreate it
 * there, and production capture would stop. This guard refuses that: an owned subscription that
 * delivers to the production address is never moved to any other address by this command.
 *
 * Allowed as before:
 * - every plan or repair whose target already delivers to the command's address (token update,
 *   renew, an owned subscription that is blacklisted where it is);
 * - a re-point onto the production address (the C6 drift repair itself);
 * - a developer subscription moving from one tunnel to another (its address is not production);
 * - `create` (a separate subscription), e.g. a tunnel against a database whose ownership store does
 *   not own the production subscription.
 * When the production address cannot be resolved (`RINGCENTRAL_WEBHOOK_URL` unset), any re-point is
 * refused, because the command cannot tell whether the target is the production subscription.
 */
import {
  applyAllDirectionSubscriptionPlan,
  planAllDirectionSubscription,
  repairOwnedSubscription,
  resolveAllDirectionWebhookAddress,
  type LifecycleDeps,
  type LifecycleResult,
  type SubscriptionPlan,
  type SubscriptionRecord,
} from "../../src/services/ringcentral/webhook-subscription-lifecycle";

export class SubscriptionRepointRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionRepointRefusedError";
  }
}

/** The production delivery address (`RINGCENTRAL_WEBHOOK_URL`, never the tunnel); null when unset or invalid. */
export function productionWebhookAddress(): string | null {
  try {
    return resolveAllDirectionWebhookAddress();
  } catch {
    return null;
  }
}

/** The subscription a plan would move (`update` PUTs it, `repair` deletes and recreates it); null otherwise. */
export function planTarget(plan: SubscriptionPlan): string | null {
  return plan.action === "update" || plan.action === "repair" ? plan.subscription_id : null;
}

/** Null when the write may go ahead; otherwise the operator-facing reason it is refused. */
export function repointRefusal(input: {
  subscriptionId: string | null;
  records: readonly SubscriptionRecord[];
  /** Where this command would deliver. */
  address: string;
  productionAddress: string | null;
}): string | null {
  const { subscriptionId, address, productionAddress } = input;
  if (!subscriptionId) return null;
  const current = input.records.find((record) => record.id === subscriptionId)?.address ?? null;
  // Not visible, or already delivering here: nothing is re-pointed.
  if (current === null || current === address) return null;
  if (productionAddress === null) {
    return (
      `Refusing to re-point owned subscription ${subscriptionId} from ${current} to ${address}: RINGCENTRAL_WEBHOOK_URL is not set, ` +
      "so this command cannot tell whether it is the production calls subscription."
    );
  }
  if (address === productionAddress) return null;
  if (current !== productionAddress) return null;
  return (
    `Refusing to re-point the production calls subscription ${subscriptionId} (${current}) to the non-production address ${address} ` +
    "(RINGCENTRAL_NGROK_WEBHOOK_URL): production capture would stop. To repair it in place, unset RINGCENTRAL_NGROK_WEBHOOK_URL and re-run. " +
    "For a developer tunnel, run against a database whose ownership store does not own the production subscription (for example " +
    "testvantagemovers); there `ensure` creates a separate subscription."
  );
}

/** `ensure` with the guard: plan, refuse a production re-point, then apply. */
export async function ensureAllDirectionSubscriptionGuarded(
  deps: LifecycleDeps,
  productionAddress: string | null,
): Promise<{ plan: SubscriptionPlan; result: LifecycleResult }> {
  const plan = await planAllDirectionSubscription(deps);
  const refusal = await planRepointRefusal(plan, deps, productionAddress);
  if (refusal) throw new SubscriptionRepointRefusedError(refusal);
  return { plan, result: await applyAllDirectionSubscriptionPlan(plan, deps) };
}

/** The refusal `ensure` would raise for this plan (read-only; `plan` prints it as a note). */
export async function planRepointRefusal(plan: SubscriptionPlan, deps: LifecycleDeps, productionAddress: string | null): Promise<string | null> {
  const subscriptionId = planTarget(plan);
  if (!subscriptionId) return null;
  return repointRefusal({ subscriptionId, records: await deps.provider.list(), address: deps.address, productionAddress });
}

/** `--action repair --id` with the guard: the recreated subscription would deliver to `deps.address`. */
export async function repairOwnedSubscriptionGuarded(
  subscriptionId: string,
  deps: LifecycleDeps,
  productionAddress: string | null,
): Promise<Extract<LifecycleResult, { action: "repaired" }>> {
  const refusal = repointRefusal({ subscriptionId, records: await deps.provider.list(), address: deps.address, productionAddress });
  if (refusal) throw new SubscriptionRepointRefusedError(refusal);
  return repairOwnedSubscription(subscriptionId, deps);
}
