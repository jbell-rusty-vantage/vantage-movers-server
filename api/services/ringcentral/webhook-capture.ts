import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain";
import { connectMongo } from "../../db";
import { logger } from "../../logger";

export const RINGCENTRAL_TELEPHONY_SESSIONS_EVENT_FILTER =
  "/restapi/v1.0/account/~/telephony/sessions";

const WEBHOOK_EVENTS_TEST_COLLECTION = "ringcentral_webhook_events_test";

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

export type RingCentralWebhookCaptureDocument = {
  provider: "ringcentral";
  receivedAt: Date;
  validationTokenPresent: boolean;
  headers: Record<string, string>;
  rawBody: unknown;
  normalizedPreview: NormalizedPreview;
};

type CaptureRingCentralWebhookEventInput = {
  receivedAt: Date;
  validationTokenPresent: boolean;
  headers: Record<string, string>;
  payload: unknown;
};

export async function captureRingCentralWebhookEvent(
  input: CaptureRingCentralWebhookEventInput,
): Promise<void> {
  const document = buildRingCentralWebhookCaptureDocument(input);

  if (!process.env.MONGO_URI?.trim()) {
    logger.info({
      msg: "ringcentral.webhook.capture.mongo_unavailable_logged",
      capture: redactSensitiveValues(document),
    });
    return;
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
  } catch (error) {
    logger.error({
      err: error,
      msg: "ringcentral.webhook.capture.persist_failed_logged",
      capture: redactSensitiveValues(document),
    });
  }
}

export function buildRingCentralWebhookCaptureDocument(
  input: CaptureRingCentralWebhookEventInput,
): RingCentralWebhookCaptureDocument {
  return {
    provider: "ringcentral",
    receivedAt: input.receivedAt,
    validationTokenPresent: input.validationTokenPresent,
    headers: sanitizeHeaders(input.headers),
    rawBody: input.payload,
    normalizedPreview: previewRingCentralWebhookPayload(input.payload),
  };
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
  headers: Record<string, string>,
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === "authorization" ||
      normalizedKey === "cookie" ||
      normalizedKey === "x-api-secret"
    ) {
      continue;
    }
    sanitized[normalizedKey] = value;
  }
  return sanitized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
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

async function getWebhookEventsCollection() {
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), {
    useCache: true,
  }).db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }

  return db.collection<RingCentralWebhookCaptureDocument>(
    WEBHOOK_EVENTS_TEST_COLLECTION,
  );
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
