import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain";
import { connectMongo } from "../../db";
import { logger } from "../../logger";
import type { RingCentralWebhookEventDocument } from "./call-candidate-types";
import { getRingCentralCollectionName } from "./ringcentral-config";
import { valueToNumber, valueToString } from "./webhook-event-normalizer";

export const RINGCENTRAL_TELEPHONY_SESSIONS_EVENT_FILTER =
  "/restapi/v1.0/account/~/telephony/sessions";

/**
 * Name of the raw webhook-capture collection currently in use. Resolved from
 * `ringcentral-config` at import time: `_test`-suffixed in test collection
 * mode (default), unsuffixed in production. The historical export name is
 * kept so the dev monitor and existing imports continue to work.
 */
export const WEBHOOK_EVENTS_TEST_COLLECTION =
  getRingCentralCollectionName("webhookEvents");

export type NormalizedPreview = {
  subscriptionId: string | null;
  event: string | null;
  uuid: string | null;
  timestamp: string | null;
  telephonySessionId: string | null;
  sessionId: string | null;
  partyId: string | null;
  direction: string | null;
  statusCode: string | null;
  fromPhoneNumber: string | null;
  fromName: string | null;
  toPhoneNumber: string | null;
  toName: string | null;
  extensionId: string | null;
  extensionNumber: string | null;
};

type CaptureRingCentralWebhookEventInput = {
  receivedAt: Date;
  validationTokenPresent: boolean;
  headers: Record<string, string | string[] | undefined>;
  payload: unknown;
};

export type CaptureRingCentralWebhookEventResult = {
  storedRawEvent: boolean;
  duplicate: boolean;
};

let webhookEventIndexesReady: Promise<void> | null = null;

export async function captureRingCentralWebhookEvent(
  input: CaptureRingCentralWebhookEventInput,
): Promise<CaptureRingCentralWebhookEventResult> {
  const document = buildRingCentralWebhookCaptureDocument(input);

  if (!process.env.MONGO_URI?.trim()) {
    logger.info({
      msg: "ringcentral.webhook.capture.mongo_unavailable_logged",
      capture: redactSensitiveValues(document),
    });
    return { storedRawEvent: false, duplicate: false };
  }

  try {
    const collection = await getWebhookEventsCollection();
    await collection.insertOne(document);
    logger.info({
      msg: "ringcentral.webhook.capture.persisted",
      receivedAt: document.receivedAt.toISOString(),
      subscriptionId: document.normalizedPreview.subscriptionId,
      telephonySessionId: document.normalizedPreview.telephonySessionId,
      partyId: document.normalizedPreview.partyId,
      event: document.normalizedPreview.event,
    });
    return { storedRawEvent: true, duplicate: false };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      logger.info({
        msg: "ringcentral.webhook.capture.duplicate_acknowledged",
        uuid: document.uuid,
      });
      return { storedRawEvent: true, duplicate: true };
    }

    logger.error({
      err: error,
      msg: "ringcentral.webhook.capture.persist_failed_logged",
      capture: redactSensitiveValues(document),
    });
    return { storedRawEvent: false, duplicate: false };
  }
}

export function buildRingCentralWebhookCaptureDocument(
  input: CaptureRingCentralWebhookEventInput,
): RingCentralWebhookEventDocument & { normalizedPreview: NormalizedPreview } {
  const normalizedPreview = previewRingCentralWebhookPayload(input.payload);
  const document: RingCentralWebhookEventDocument & {
    normalizedPreview: NormalizedPreview;
  } = {
    provider: "ringcentral",
    receivedAt: input.receivedAt,
    validationTokenPresent: input.validationTokenPresent,
    headers: sanitizeHeaders(input.headers),
    rawBody: input.payload,
    normalizedPreview,
  };

  assignIfPresent(document, "uuid", normalizedPreview.uuid);
  assignIfPresent(document, "subscriptionId", normalizedPreview.subscriptionId);
  assignIfPresent(document, "event", normalizedPreview.event);
  assignIfPresent(document, "timestamp", normalizedPreview.timestamp);
  assignIfPresent(document, "ownerId", valueToString(asRecord(input.payload)?.ownerId));
  assignIfPresent(document, "telephonySessionId", normalizedPreview.telephonySessionId);
  assignIfPresent(document, "sessionId", normalizedPreview.sessionId);
  assignIfPresent(
    document,
    "sequence",
    valueToNumber(asRecord(asRecord(input.payload)?.body)?.sequence),
  );

  return document;
}

export function previewRingCentralWebhookPayload(
  payload: unknown,
): NormalizedPreview {
  const root = asRecord(payload);
  const body = asRecord(root?.body);
  const parties = Array.isArray(body?.parties) ? body.parties : [];
  const firstParty = asRecord(parties[0]);
  const status = asRecord(firstParty?.status);
  const from = asRecord(firstParty?.from);
  const to = asRecord(firstParty?.to);
  const extension = asRecord(firstParty?.extension);

  return {
    subscriptionId: valueToString(root?.subscriptionId),
    event: valueToString(root?.event),
    uuid: valueToString(root?.uuid),
    timestamp: valueToString(root?.timestamp),
    telephonySessionId: valueToString(body?.telephonySessionId),
    sessionId: valueToString(body?.sessionId),
    partyId: valueToString(firstParty?.partyId ?? firstParty?.id),
    direction: valueToString(firstParty?.direction),
    statusCode: valueToString(status?.code ?? status?.reason),
    fromPhoneNumber: valueToString(from?.phoneNumber),
    fromName: valueToString(from?.name),
    toPhoneNumber: valueToString(to?.phoneNumber),
    toName: valueToString(to?.name),
    extensionId: valueToString(firstParty?.extensionId ?? extension?.id),
    extensionNumber: valueToString(
      firstParty?.extensionNumber ?? extension?.extensionNumber,
    ),
  };
}

export function sanitizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const sanitized: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === "authorization" ||
      normalizedKey === "cookie" ||
      normalizedKey === "x-api-secret"
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      sanitized[normalizedKey] = value;
    } else if (typeof value === "string") {
      sanitized[normalizedKey] = value;
    }
  }
  return sanitized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

async function getWebhookEventsCollection() {
  await connectMongo();
  await ensureWebhookEventIndexes();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), {
    useCache: true,
  }).db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }

  return db.collection<
    RingCentralWebhookEventDocument & { normalizedPreview?: NormalizedPreview }
  >(
    WEBHOOK_EVENTS_TEST_COLLECTION,
  );
}

export async function listRingCentralWebhookEvents(limit: number) {
  const collection = await getWebhookEventsCollection();
  return collection
    .find(
      {},
      {
        projection: {
          rawBody: 0,
          headers: 0,
        },
      },
    )
    .sort({ receivedAt: -1 })
    .limit(limit)
    .toArray();
}

function ensureWebhookEventIndexes(): Promise<void> {
  webhookEventIndexesReady ??= createWebhookEventIndexes();
  return webhookEventIndexesReady;
}

async function createWebhookEventIndexes(): Promise<void> {
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), {
    useCache: true,
  }).db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }

  const collection = db.collection<RingCentralWebhookEventDocument>(
    WEBHOOK_EVENTS_TEST_COLLECTION,
  );
  await collection.createIndex({ provider: 1, receivedAt: -1 });
  await collection.createIndex({ uuid: 1 }, { unique: true, sparse: true });
  await collection.createIndex({ telephonySessionId: 1 });
  await collection.createIndex({ sessionId: 1 });
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === 11000
  );
}

function assignIfPresent<K extends keyof RingCentralWebhookEventDocument>(
  target: RingCentralWebhookEventDocument,
  key: K,
  value: RingCentralWebhookEventDocument[K] | null,
): void {
  if (value !== null) {
    target[key] = value as RingCentralWebhookEventDocument[K];
  }
}

function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveValues);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes("authorization") ||
      normalizedKey.includes("access_token") ||
      normalizedKey.includes("refresh_token") ||
      normalizedKey.includes("client_secret") ||
      normalizedKey.includes("jwt")
    ) {
      redacted[key] = "[redacted]";
      continue;
    }
    redacted[key] = redactSensitiveValues(nestedValue);
  }
  return redacted;
}
