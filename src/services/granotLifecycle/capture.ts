import type { IncomingHttpHeaders } from "node:http";
import { connectMongo } from "../../db";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import type { GranotWebhookAuthenticationMethod } from "../../middleware/requireGranotWebhookSecret";
import type { GranotRouteEventClass } from "./types";
import {
  classifyPayloadKind,
  hashCredentialRedactedPayload,
} from "./receiptEvidence";
import { incrementGranotLifecycleReceiptsTotal } from "./metrics";

export const GRANOT_WEBHOOK_STORED_HEADER_ALLOWLIST = [
  "content-type",
  "content-length",
  "user-agent",
  "x-request-id",
  "x-vercel-id",
] as const;

export const GRANOT_WEBHOOK_STORED_HEADER_MAX_LENGTH = 1024;

export type CaptureGranotLifecycleWebhookInput = {
  route_event_class: GranotRouteEventClass;
  captured_at: Date;
  headers: IncomingHttpHeaders;
  payload: unknown;
  authentication_method: GranotWebhookAuthenticationMethod;
};

export type CaptureGranotLifecycleWebhookResult = {
  receipt_id: string;
};

export type GranotWebhookReceiptInsert = {
  source_system: "granot";
  observation_channel: "granot_webhook";
  captured_at: Date;
  route_event_class: GranotRouteEventClass;
  authentication_method: GranotWebhookAuthenticationMethod;
  evidence_version: 2;
  payload_kind: "object" | "array" | "null" | "primitive";
  headers: Record<string, string | string[]>;
  payload: unknown;
  payload_sha256: string;
  processing: {
    state: "pending";
    technical_attempts: 0;
    match_attempt: 0;
    next_attempt_at: Date;
    manual_requeue_count: 0;
  };
  provider: "granot";
  event_type: GranotRouteEventClass;
  received_at: Date;
  schema_version: 1;
  processing_status: "received";
  processing_attempts: 0;
};

export type PersistGranotWebhookReceipt = (
  document: GranotWebhookReceiptInsert,
) => Promise<CaptureGranotLifecycleWebhookResult>;

export function allowlistGranotWebhookHeaders(
  headers: IncomingHttpHeaders | Record<string, unknown>,
): Record<string, string | string[]> {
  const allowlisted = new Set<string>(GRANOT_WEBHOOK_STORED_HEADER_ALLOWLIST);
  const stored: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.toLowerCase();
    if (!allowlisted.has(normalizedKey)) {
      continue;
    }
    const storedValue = storeHeaderValue(value);
    if (storedValue !== undefined) {
      stored[normalizedKey] = storedValue;
    }
  }
  return stored;
}

export function buildGranotWebhookReceiptInsert(
  input: CaptureGranotLifecycleWebhookInput,
): GranotWebhookReceiptInsert {
  if (
    input.authentication_method !== "body_secret" &&
    input.authentication_method !== "header_secret"
  ) {
    throw new Error(
      "Granot webhook capture requires a proven authentication method",
    );
  }

  const headers = allowlistGranotWebhookHeaders(input.headers);
  const evidence = hashCredentialRedactedPayload(input.payload);
  return {
    source_system: "granot",
    observation_channel: "granot_webhook",
    captured_at: input.captured_at,
    route_event_class: input.route_event_class,
    authentication_method: input.authentication_method,
    evidence_version: 2,
    payload_kind: classifyPayloadKind(evidence.redacted_payload),
    headers,
    payload: evidence.redacted_payload,
    payload_sha256: evidence.payload_sha256,
    processing: {
      state: "pending",
      technical_attempts: 0,
      match_attempt: 0,
      next_attempt_at: input.captured_at,
      manual_requeue_count: 0,
    },
    provider: "granot",
    event_type: input.route_event_class,
    received_at: input.captured_at,
    schema_version: 1,
    processing_status: "received",
    processing_attempts: 0,
  };
}

export async function captureGranotLifecycleWebhookReceipt(
  input: CaptureGranotLifecycleWebhookInput,
  persist: PersistGranotWebhookReceipt = persistGranotWebhookReceipt,
): Promise<CaptureGranotLifecycleWebhookResult> {
  const document = buildGranotWebhookReceiptInsert(input);
  const result = await persist(document);
  incrementGranotLifecycleReceiptsTotal({
    channel: "granot_webhook",
    event_class: input.route_event_class,
  });
  return { receipt_id: result.receipt_id };
}

async function persistGranotWebhookReceipt(
  document: GranotWebhookReceiptInsert,
): Promise<CaptureGranotLifecycleWebhookResult> {
  await connectMongo();
  const receipt = await getGranotObservationReceiptModel().create(document);
  return { receipt_id: receipt._id.toString() };
}

function storeHeaderValue(value: unknown): string | string[] | undefined {
  if (typeof value === "string") {
    return value.slice(0, GRANOT_WEBHOOK_STORED_HEADER_MAX_LENGTH);
  }
  if (Array.isArray(value)) {
    const stored = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.slice(0, GRANOT_WEBHOOK_STORED_HEADER_MAX_LENGTH));
    return stored.length > 0 ? stored : undefined;
  }
  return undefined;
}
