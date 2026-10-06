import { promises as fs } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain";
import { connectMongo } from "../../db";
import { logger } from "../../logger";
import {
  listActiveRingCentralSnapshotNumbers,
  loadRingCentralRouteSnapshot,
} from "../operationsRegistry";

const SUBSCRIPTIONS_COLLECTION = "ringcentral_webhook_subscriptions";
export const LOCAL_SUBSCRIPTION_METADATA_PATH =
  ".ringcentral-webhook-subscription.json";

type RingCentralSubscriptionResponse = {
  id?: unknown;
  eventFilters?: unknown;
  deliveryMode?: unknown;
  status?: unknown;
  expiresIn?: unknown;
};

/**
 * What an app-owned subscription is for (RINGCENTRAL-CAPTURE §3): `calls` = the account telephony
 * subscription, `rep_sms` = one message-store filter per reviewed sales rep mailbox. Rows written
 * before this field existed carry none; the lifecycle treats them as `calls` only when their filters
 * are the telephony filters.
 */
export type SubscriptionPurpose = "calls" | "rep_sms";

/** Ownership metadata the lifecycle stores beside the provider response. */
export type StoredSubscriptionMeta = { purpose: SubscriptionPurpose | null; verificationToken: string | null };

export type RingCentralWebhookSubscriptionMetadata = {
  provider: "ringcentral";
  subscriptionId: string;
  purpose?: SubscriptionPurpose | null;
  /** The `deliveryMode.verificationToken` we generated; deliveries must carry it (`Verification-Token`). */
  verificationToken?: string | null;
  eventFilters: string[];
  deliveryMode: unknown;
  status: string | null;
  expiresIn: number | null;
  expirationTime: Date | null;
  createdAt: Date;
  updatedAt: Date;
  raw: unknown;
  /** olr CW2: deliveries the webhook route refused for this subscription (`verification_failed`). */
  delivery_refusals?: StoredDeliveryRefusals;
};

/**
 * olr CW2: the route's refusal counter on an owned subscription's metadata row. `count` is cumulative;
 * `last_at` / `last_reason` describe the newest refusal (`token_missing` | `token_mismatch`).
 */
export type StoredDeliveryRefusals = { count: number; last_at: Date; last_reason: string };

export type RingCentralSubscriptionStoreResult = {
  saved: boolean;
  target: "mongo" | "file" | "none";
  path?: string;
};

let subscriptionIndexesReady: Promise<void> | null = null;

const TELEPHONY_SESSIONS_FILTER =
  "/restapi/v1.0/account/~/telephony/sessions";

/**
 * Event filters by mode. `"account"` and `"per-number"` are the qualified-call
 * (inbound-only) builders and are unchanged. CSI-03 adds `"all"`: the same
 * account telephony-sessions path with no direction filter and, deliberately,
 * no `withRecordings=true` (that would drop the missed/unrecorded traffic
 * Number Activity needs).
 */
export async function buildRingCentralTelephonyEventFilters(
  mode: "per-number" | "account" | "all" = "account",
): Promise<string[]> {
  if (mode === "all") {
    return [TELEPHONY_SESSIONS_FILTER];
  }
  if (mode === "account") {
    return [`${TELEPHONY_SESSIONS_FILTER}?direction=Inbound`];
  }
  const snapshot = await loadRingCentralRouteSnapshot();
  return listActiveRingCentralSnapshotNumbers(snapshot).map(
    (phoneNumber) =>
      `${TELEPHONY_SESSIONS_FILTER}?direction=Inbound&phoneNumber=${encodeURIComponent(
        phoneNumber,
      )}`,
  );
}

export async function storeRingCentralWebhookSubscriptionMetadata(
  raw: unknown,
  meta: Partial<StoredSubscriptionMeta> = {},
): Promise<RingCentralSubscriptionStoreResult> {
  const metadata = buildRingCentralWebhookSubscriptionMetadata(raw);
  const extra = {
    ...(meta.purpose !== undefined ? { purpose: meta.purpose } : {}),
    ...(meta.verificationToken !== undefined ? { verificationToken: meta.verificationToken } : {}),
  };

  if (process.env.MONGO_URI?.trim()) {
    try {
      const collection = await getSubscriptionsCollection();
      await collection.updateOne(
        { subscriptionId: metadata.subscriptionId },
        {
          $setOnInsert: {
            provider: metadata.provider,
            subscriptionId: metadata.subscriptionId,
            createdAt: metadata.createdAt,
          },
          $set: {
            eventFilters: metadata.eventFilters,
            deliveryMode: metadata.deliveryMode,
            status: metadata.status,
            expiresIn: metadata.expiresIn,
            expirationTime: metadata.expirationTime,
            updatedAt: metadata.updatedAt,
            raw: metadata.raw,
            ...extra,
          },
        },
        { upsert: true },
      );
      return { saved: true, target: "mongo" };
    } catch (error) {
      logger.warn({
        err: error,
        msg: "ringcentral.webhook.subscription_metadata.mongo_failed_falling_back",
        subscriptionId: metadata.subscriptionId,
      });
    }
  }

  const filePath = path.resolve(process.cwd(), LOCAL_SUBSCRIPTION_METADATA_PATH);
  await fs.writeFile(filePath, `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return {
    saved: true,
    target: "file",
    path: LOCAL_SUBSCRIPTION_METADATA_PATH,
  };
}

export function buildRingCentralWebhookSubscriptionMetadata(
  raw: unknown,
): RingCentralWebhookSubscriptionMetadata {
  const response = asSubscriptionResponse(raw);
  const subscriptionId = valueToString(response.id);
  if (!subscriptionId) {
    throw new Error("RingCentral subscription response did not include id");
  }

  const eventFilters = Array.isArray(response.eventFilters)
    ? response.eventFilters.map(valueToString).filter((value) => value !== null)
    : [];
  const expiresIn = valueToNumber(response.expiresIn);
  const now = new Date();

  return {
    provider: "ringcentral",
    subscriptionId,
    eventFilters,
    deliveryMode: response.deliveryMode ?? null,
    status: valueToString(response.status),
    expiresIn,
    expirationTime: expiresIn === null ? null : new Date(now.getTime() + expiresIn * 1000),
    createdAt: now,
    updatedAt: now,
    raw,
  };
}

/** CSI-03 additive: ids of subscriptions this application created (ownership evidence for renew/repair). */
export async function listStoredRingCentralWebhookSubscriptionIds(): Promise<string[]> {
  if (!process.env.MONGO_URI?.trim()) return [];
  const collection = await getSubscriptionsCollection();
  const rows = await collection
    .find({ provider: "ringcentral" }, { projection: { subscriptionId: 1 } })
    .toArray();
  return rows.map((row) => row.subscriptionId).filter((id) => typeof id === "string" && id.trim());
}

/** Purpose and verification token of every owned subscription, keyed by id. */
export async function listStoredRingCentralWebhookSubscriptionMeta(): Promise<Map<string, StoredSubscriptionMeta>> {
  const out = new Map<string, StoredSubscriptionMeta>();
  if (!process.env.MONGO_URI?.trim()) return out;
  const collection = await getSubscriptionsCollection();
  const rows = await collection
    .find({ provider: "ringcentral" }, { projection: { subscriptionId: 1, purpose: 1, verificationToken: 1 } })
    .toArray();
  for (const row of rows) {
    if (typeof row.subscriptionId !== "string" || !row.subscriptionId.trim()) continue;
    out.set(row.subscriptionId, {
      purpose: row.purpose === "calls" || row.purpose === "rep_sms" ? row.purpose : null,
      verificationToken: typeof row.verificationToken === "string" && row.verificationToken ? row.verificationToken : null,
    });
  }
  return out;
}

/** The stored verification token of one subscription; `undefined` when the subscription is not ours. */
export async function findStoredSubscriptionVerificationToken(subscriptionId: string): Promise<string | null | undefined> {
  if (!process.env.MONGO_URI?.trim()) return undefined;
  const collection = await getSubscriptionsCollection();
  const row = await collection.findOne(
    { provider: "ringcentral", subscriptionId },
    { projection: { verificationToken: 1 } },
  );
  if (!row) return undefined;
  return typeof row.verificationToken === "string" && row.verificationToken ? row.verificationToken : null;
}

/**
 * olr CW2: counts one delivery the webhook route refused (`verification_failed`) on the owned
 * subscription's metadata row. Never inserts: the route refuses only subscriptions that already have a
 * stored token, so a missing row means the delivery was not ours. Returns whether a row was counted.
 */
export async function recordStoredSubscriptionDeliveryRefusal(
  subscriptionId: string,
  reason: string,
  at: Date,
): Promise<boolean> {
  if (!process.env.MONGO_URI?.trim()) return false;
  const collection = await getSubscriptionsCollection();
  const result = await collection.updateOne(
    { provider: "ringcentral", subscriptionId },
    {
      $inc: { "delivery_refusals.count": 1 },
      $max: { "delivery_refusals.last_at": at },
      $set: { "delivery_refusals.last_reason": reason },
    },
  );
  return result.matchedCount > 0;
}

/** olr CW2: the refusal counter of one owned subscription; null when none was ever refused (or it is not ours). */
export async function findStoredSubscriptionDeliveryRefusals(subscriptionId: string): Promise<StoredDeliveryRefusals | null> {
  if (!process.env.MONGO_URI?.trim()) return null;
  const collection = await getSubscriptionsCollection();
  const row = await collection.findOne(
    { provider: "ringcentral", subscriptionId },
    { projection: { delivery_refusals: 1 } },
  );
  const refusals = row?.delivery_refusals;
  if (!refusals || !(refusals.last_at instanceof Date)) return null;
  return {
    count: typeof refusals.count === "number" ? refusals.count : 0,
    last_at: refusals.last_at,
    last_reason: typeof refusals.last_reason === "string" ? refusals.last_reason : "unknown",
  };
}

/** CSI-03 additive: records a lifecycle status (e.g. `Deleted`) on an owned subscription's metadata; never removes the row. */
export async function markStoredRingCentralWebhookSubscriptionStatus(
  subscriptionId: string,
  status: string,
): Promise<void> {
  if (!process.env.MONGO_URI?.trim()) return;
  const collection = await getSubscriptionsCollection();
  await collection.updateOne(
    { subscriptionId },
    { $set: { status, updatedAt: new Date() } },
  );
}

async function getSubscriptionsCollection() {
  await connectMongo();
  await ensureSubscriptionIndexes();

  const db = mongoose.connection.useDb(getMongoDatabaseName(), {
    useCache: true,
  }).db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }

  return db.collection<RingCentralWebhookSubscriptionMetadata>(
    SUBSCRIPTIONS_COLLECTION,
  );
}

function ensureSubscriptionIndexes(): Promise<void> {
  subscriptionIndexesReady ??= createSubscriptionIndexes();
  return subscriptionIndexesReady;
}

async function createSubscriptionIndexes(): Promise<void> {
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), {
    useCache: true,
  }).db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }

  const collection = db.collection<RingCentralWebhookSubscriptionMetadata>(
    SUBSCRIPTIONS_COLLECTION,
  );
  await collection.createIndex({ subscriptionId: 1 }, { unique: true });
  await collection.createIndex({ status: 1 });
  await collection.createIndex({ expirationTime: 1 });
}

function asSubscriptionResponse(raw: unknown): RingCentralSubscriptionResponse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as RingCentralSubscriptionResponse;
}

function valueToString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function valueToNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
