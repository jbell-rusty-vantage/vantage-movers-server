import { ringCentralRequest } from "./client";
import {
  buildRingCentralTelephonyEventFilters,
  listStoredRingCentralWebhookSubscriptionIds,
  markStoredRingCentralWebhookSubscriptionStatus,
  storeRingCentralWebhookSubscriptionMetadata,
} from "./webhook-subscriptions";

/**
 * CSI-03 subscription lifecycle for the all-direction account telephony
 * subscription (03 §2.1). Validation echo, renewal and repair are explicit,
 * testable paths with ownership checks: this module never renews, deletes or
 * replaces a subscription this application did not create (its id must be in
 * the stored subscription metadata). Foreign subscriptions — including ones
 * that point at our webhook address — are reported, never touched.
 *
 * Two callers apply plans: the ops command
 * `scripts/ringcentral/sales-intelligence-subscription.ts` (read-only by
 * default, explicit confirmation flag to apply) and the daily CC-08 cron
 * `/api/cron/sales-intelligence-webhook-subscription`
 * (`webhookSubscriptionCron.ts`, behind `SALES_INTELLIGENCE_CAPTURE_WEBHOOK`;
 * it creates only with `SALES_INTELLIGENCE_WEBHOOK_AUTO_CREATE=true`). All
 * tests use fakes; no production subscription is created, renewed or deleted
 * by tests.
 */
export const SUBSCRIPTION_PATH = "/restapi/v1.0/subscription";
/**
 * WebHook transport accepts `expiresIn` up to 630,720,000 s (20 years); the
 * provider default is 604,800 s (7 days). The longest lifetime is requested so
 * a missed renewal never silently stops capture; the daily cron still renews.
 */
export const MAX_WEBHOOK_EXPIRES_IN_SECONDS = 630_720_000;
export const DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS = MAX_WEBHOOK_EXPIRES_IN_SECONDS;
/** Renew when under 7 days remain (covers a subscription created with the provider's 7-day default). */
export const DEFAULT_RENEW_WITHIN_MS = 7 * 24 * 60 * 60_000;

export type SubscriptionRecord = {
  id: string;
  eventFilters: string[];
  transportType: string | null;
  address: string | null;
  status: string | null;
  expiresIn: number | null;
  expirationTime: Date | null;
  raw: unknown;
};

export type SubscriptionProvider = {
  list(): Promise<SubscriptionRecord[]>;
  create(input: { eventFilters: string[]; address: string; expiresIn: number }): Promise<unknown>;
  renew(id: string): Promise<unknown>;
  remove(id: string): Promise<void>;
};

export type OwnershipStore = {
  ownedIds(): Promise<Set<string>>;
  record(raw: unknown): Promise<void>;
  markStatus(id: string, status: string): Promise<void>;
};

export class SubscriptionOwnershipError extends Error {
  constructor(readonly subscriptionId: string, readonly operation: "renew" | "delete" | "repair") {
    super(`Refusing to ${operation} subscription ${subscriptionId}: not created by this application`);
    this.name = "SubscriptionOwnershipError";
  }
}

/**
 * The provider accepted a create/renew but ownership evidence could not be
 * recorded durably. The subscription id is surfaced so an operator records or
 * removes it deliberately; the module never silently treats it as foreign.
 */
export class SubscriptionOwnershipRecordError extends Error {
  constructor(readonly subscriptionId: string | null, readonly cause?: unknown) {
    super(
      `Subscription ${subscriptionId ?? "(id missing)"} was accepted by the provider but its ownership could not be recorded; record or remove it manually before re-running`,
    );
    this.name = "SubscriptionOwnershipRecordError";
  }
}

/** Ownership evidence must come from a durable store; without Mongo there is no ownership, so mutations fail closed. */
export class SubscriptionOwnershipUnavailableError extends Error {
  constructor() {
    super("Subscription ownership store is unavailable (MONGO_URI not configured); refusing to plan or mutate");
    this.name = "SubscriptionOwnershipUnavailableError";
  }
}

export function ringCentralSubscriptionProvider(
  request: typeof ringCentralRequest = ringCentralRequest,
): SubscriptionProvider {
  return {
    async list() {
      const response = await request("GET", SUBSCRIPTION_PATH);
      const records = Array.isArray(response)
        ? response
        : Array.isArray((response as { records?: unknown } | null)?.records)
          ? ((response as { records: unknown[] }).records)
          : [];
      return records.map((r) => parseSubscriptionRecord(r, new Date())).filter((r): r is SubscriptionRecord => r !== null);
    },
    create(input) {
      return request("POST", SUBSCRIPTION_PATH, {
        eventFilters: input.eventFilters,
        deliveryMode: { transportType: "WebHook", address: input.address },
        expiresIn: input.expiresIn,
      });
    },
    renew(id) {
      return request("POST", `${SUBSCRIPTION_PATH}/${encodeURIComponent(id)}/renew`);
    },
    async remove(id) {
      await request("DELETE", `${SUBSCRIPTION_PATH}/${encodeURIComponent(id)}`);
    },
  };
}

/** Default delivery route when the configured URL names only a host. */
export const RINGCENTRAL_WEBHOOK_ROUTE = "/api/webhooks/ringcentral";

/**
 * The all-direction subscription's delivery address: `RINGCENTRAL_WEBHOOK_URL`
 * (https only; a bare host gets the webhook route). The ops command may pass
 * `allowNgrok` so a developer tunnel (`RINGCENTRAL_NGROK_WEBHOOK_URL`) wins;
 * the production cron never does.
 */
export function resolveAllDirectionWebhookAddress(options: { allowNgrok?: boolean } = {}): string {
  const base =
    (options.allowNgrok ? process.env.RINGCENTRAL_NGROK_WEBHOOK_URL?.trim() : "") ||
    process.env.RINGCENTRAL_WEBHOOK_URL?.trim();
  if (!base) throw new Error("RINGCENTRAL_WEBHOOK_URL is not set");
  const url = new URL(base);
  if (url.protocol !== "https:") throw new Error("RINGCENTRAL_WEBHOOK_URL must start with https://");
  if (url.pathname === "/" || url.pathname === "") url.pathname = RINGCENTRAL_WEBHOOK_ROUTE;
  return url.toString();
}

export function mongoOwnershipStore(): OwnershipStore {
  const requireMongo = () => {
    if (!process.env.MONGO_URI?.trim()) throw new SubscriptionOwnershipUnavailableError();
  };
  return {
    ownedIds: async () => {
      requireMongo();
      return new Set(await listStoredRingCentralWebhookSubscriptionIds());
    },
    record: async (raw) => {
      requireMongo();
      const stored = await storeRingCentralWebhookSubscriptionMetadata(raw);
      // The file fallback is not ownership evidence `ownedIds()` can read.
      if (stored.target !== "mongo") {
        throw new Error(`subscription metadata landed in ${stored.target}, not Mongo`);
      }
    },
    markStatus: async (id, status) => {
      requireMongo();
      await markStoredRingCentralWebhookSubscriptionStatus(id, status);
    },
  };
}

export function parseSubscriptionRecord(raw: unknown, now: Date): SubscriptionRecord | null {
  const record = asRecord(raw);
  const id = str(record?.id);
  if (!id) return null;
  const delivery = asRecord(record?.deliveryMode);
  const expiresIn = num(record?.expiresIn);
  const explicitExpiration = date(record?.expirationTime);
  return {
    id,
    eventFilters: Array.isArray(record?.eventFilters)
      ? record!.eventFilters.map(str).filter((v): v is string => v !== null)
      : [],
    transportType: str(delivery?.transportType),
    address: str(delivery?.address),
    status: str(record?.status),
    expiresIn,
    expirationTime: explicitExpiration ?? (expiresIn === null ? null : new Date(now.getTime() + expiresIn * 1000)),
    raw,
  };
}

// ---------------------------------------------------------------------------
// Validation echo (pure)
// ---------------------------------------------------------------------------

/**
 * RingCentral validates a webhook address by sending `Validation-Token`; the
 * receiver must echo it back on a 200 within a few seconds. The route already
 * does this; this helper is the testable statement of that rule.
 */
export function validationEchoHeaders(validationToken: string | null | undefined): Record<string, string> {
  const token = validationToken?.trim();
  return token ? { "Validation-Token": token } : {};
}

// ---------------------------------------------------------------------------
// Classification and plan (pure over provided records)
// ---------------------------------------------------------------------------

/**
 * `active`: provider says Active and expiry is comfortably ahead.
 * `expiring`: Active but expiry within the renew window, or expiry unknown
 *   (renewal is the safe answer to "we cannot tell when it lapses").
 * `blacklisted`: provider explicitly reports Blacklisted/Suspended; the only
 *   health that permits repair (delete + recreate).
 * `unknown`: any other or missing status. Reported, never repaired: an
 *   unrecognized transient status must not trigger a destructive action.
 */
export type SubscriptionHealth = "active" | "expiring" | "blacklisted" | "unknown";

const TERMINAL_STATUSES = new Set(["blacklisted", "suspended"]);

export function subscriptionHealth(record: SubscriptionRecord, now: Date, renewWithinMs: number): SubscriptionHealth {
  const status = record.status?.trim().toLowerCase() ?? null;
  if (status !== null && TERMINAL_STATUSES.has(status)) return "blacklisted";
  if (status !== "active") return "unknown";
  if (!record.expirationTime) return "expiring";
  if (record.expirationTime.getTime() - now.getTime() <= renewWithinMs) return "expiring";
  return "active";
}

export function sameFilterSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = [...a].sort();
  return [...b].sort().every((v, i) => v === sorted[i]);
}

export type Classified = {
  owned_matching: Array<{ record: SubscriptionRecord; health: SubscriptionHealth }>;
  owned_other: SubscriptionRecord[];
  foreign_same_address: SubscriptionRecord[];
  foreign_other: SubscriptionRecord[];
};

export function classifySubscriptions(input: {
  records: SubscriptionRecord[];
  ownedIds: ReadonlySet<string>;
  address: string;
  eventFilters: readonly string[];
  now: Date;
  renewWithinMs?: number;
}): Classified {
  const renewWithinMs = input.renewWithinMs ?? DEFAULT_RENEW_WITHIN_MS;
  const out: Classified = { owned_matching: [], owned_other: [], foreign_same_address: [], foreign_other: [] };
  for (const record of input.records) {
    const owned = input.ownedIds.has(record.id);
    const matches =
      record.address === input.address &&
      record.transportType?.toLowerCase() === "webhook" &&
      sameFilterSet(record.eventFilters, input.eventFilters);
    if (owned && matches) out.owned_matching.push({ record, health: subscriptionHealth(record, input.now, renewWithinMs) });
    else if (owned) out.owned_other.push(record);
    else if (record.address === input.address) out.foreign_same_address.push(record);
    else out.foreign_other.push(record);
  }
  return out;
}

export type SubscriptionPlan =
  | { action: "noop"; subscription_id: string; expiration_time: string | null; warnings: string[] }
  | { action: "renew"; subscription_id: string; expiration_time: string | null; warnings: string[] }
  | { action: "repair"; subscription_id: string; health: SubscriptionHealth; warnings: string[] }
  | { action: "create"; warnings: string[] };

export type LifecycleDeps = {
  provider: SubscriptionProvider;
  store: OwnershipStore;
  address: string;
  now?: () => Date;
  renewWithinMs?: number;
  expiresInSeconds?: number;
  eventFilters?: () => Promise<string[]>;
};

/** Read-only: lists provider subscriptions and owned ids, then decides. Never mutates. */
export async function planAllDirectionSubscription(deps: LifecycleDeps): Promise<SubscriptionPlan> {
  const now = (deps.now ?? (() => new Date()))();
  const eventFilters = await (deps.eventFilters ?? (() => buildRingCentralTelephonyEventFilters("all")))();
  const [records, ownedIds] = await Promise.all([deps.provider.list(), deps.store.ownedIds()]);
  const classified = classifySubscriptions({ records, ownedIds, address: deps.address, eventFilters, now, renewWithinMs: deps.renewWithinMs });
  const warnings = classified.foreign_same_address.map(
    (r) => `foreign subscription ${r.id} delivers to this address and is not managed here`,
  );
  if (classified.owned_matching.length > 1) {
    warnings.push(`${classified.owned_matching.length} owned matching subscriptions exist; only the healthiest is managed`);
  }
  const rank: Record<SubscriptionHealth, number> = { active: 0, expiring: 1, unknown: 2, blacklisted: 3 };
  const best = [...classified.owned_matching].sort((a, b) => rank[a.health] - rank[b.health])[0];
  if (!best) return { action: "create", warnings };
  const expiration_time = best.record.expirationTime?.toISOString() ?? null;
  if (best.health === "active") return { action: "noop", subscription_id: best.record.id, expiration_time, warnings };
  if (best.health === "expiring") return { action: "renew", subscription_id: best.record.id, expiration_time, warnings };
  if (best.health === "blacklisted") return { action: "repair", subscription_id: best.record.id, health: best.health, warnings };
  // Unknown status: report it and leave it alone; a destructive repair needs an explicit terminal status.
  warnings.push(
    `owned subscription ${best.record.id} reports status ${best.record.status ?? "(missing)"}; not repaired automatically`,
  );
  return { action: "noop", subscription_id: best.record.id, expiration_time, warnings };
}

export type LifecycleResult =
  | { action: "noop"; subscription_id: string }
  | { action: "created"; subscription_id: string | null }
  | { action: "renewed"; subscription_id: string }
  | { action: "repaired"; removed_subscription_id: string; subscription_id: string | null };

/** Applies a plan. Every mutation re-checks ownership against the store. */
export async function applyAllDirectionSubscriptionPlan(
  plan: SubscriptionPlan,
  deps: LifecycleDeps,
): Promise<LifecycleResult> {
  switch (plan.action) {
    case "noop":
      return { action: "noop", subscription_id: plan.subscription_id };
    case "create":
      return { action: "created", subscription_id: await createAllDirectionSubscription(deps) };
    case "renew":
      return renewOwnedSubscription(plan.subscription_id, deps);
    case "repair":
      return repairOwnedSubscription(plan.subscription_id, deps);
  }
}

export async function ensureAllDirectionSubscription(deps: LifecycleDeps): Promise<{ plan: SubscriptionPlan; result: LifecycleResult }> {
  const plan = await planAllDirectionSubscription(deps);
  const result = await applyAllDirectionSubscriptionPlan(plan, deps);
  return { plan, result };
}

async function createAllDirectionSubscription(deps: LifecycleDeps): Promise<string | null> {
  // Ownership evidence must be recordable before anything is created; a
  // subscription we cannot prove we own would be classified foreign next run.
  await deps.store.ownedIds();
  const eventFilters = await (deps.eventFilters ?? (() => buildRingCentralTelephonyEventFilters("all")))();
  const raw = await deps.provider.create({
    eventFilters,
    address: deps.address,
    expiresIn: deps.expiresInSeconds ?? DEFAULT_SUBSCRIPTION_EXPIRES_IN_SECONDS,
  });
  const id = str(asRecord(raw)?.id);
  try {
    await deps.store.record(raw);
  } catch (error) {
    throw new SubscriptionOwnershipRecordError(id, error);
  }
  return id;
}

export async function renewOwnedSubscription(
  subscriptionId: string,
  deps: LifecycleDeps,
): Promise<Extract<LifecycleResult, { action: "renewed" }>> {
  await assertOwned(subscriptionId, deps.store, "renew");
  const raw = await deps.provider.renew(subscriptionId);
  try {
    await deps.store.record(raw);
  } catch (error) {
    throw new SubscriptionOwnershipRecordError(subscriptionId, error);
  }
  return { action: "renewed", subscription_id: subscriptionId };
}

export async function repairOwnedSubscription(
  subscriptionId: string,
  deps: LifecycleDeps,
): Promise<Extract<LifecycleResult, { action: "repaired" }>> {
  await assertOwned(subscriptionId, deps.store, "repair");
  await deps.provider.remove(subscriptionId);
  await deps.store.markStatus(subscriptionId, "Deleted");
  const created = await createAllDirectionSubscription(deps);
  return { action: "repaired", removed_subscription_id: subscriptionId, subscription_id: created };
}

async function assertOwned(id: string, store: OwnershipStore, operation: "renew" | "delete" | "repair") {
  const owned = await store.ownedIds();
  if (!owned.has(id)) throw new SubscriptionOwnershipError(id, operation);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function date(value: unknown): Date | null {
  const s = str(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
