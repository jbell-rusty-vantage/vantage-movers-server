import { promises as fs } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain";
import { connectMongo } from "../../db";
import { logger } from "../../logger";

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

export type RingCentralWebhookSubscriptionMetadata = {
  provider: "ringcentral";
  subscriptionId: string;
  eventFilters: string[];
  deliveryMode: unknown;
  status: string | null;
  expiresIn: number | null;
  expirationTime: Date | null;
  createdAt: Date;
  updatedAt: Date;
  raw: unknown;
};

export type RingCentralSubscriptionStoreResult = {
  saved: boolean;
  target: "mongo" | "file" | "none";
  path?: string;
};

let subscriptionIndexesReady: Promise<void> | null = null;

export async function storeRingCentralWebhookSubscriptionMetadata(
  raw: unknown,
): Promise<RingCentralSubscriptionStoreResult> {
  const metadata = buildRingCentralWebhookSubscriptionMetadata(raw);

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
