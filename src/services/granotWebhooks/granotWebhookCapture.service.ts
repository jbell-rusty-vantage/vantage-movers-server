import type { IncomingHttpHeaders } from "node:http";
import type { GranotWebhookEventType } from "../../config/domain/granotWebhook";
import { connectMongo } from "../../db";
import { getGranotWebhookReceiptModel } from "../../models/GranotWebhookReceipt";

export type CaptureGranotWebhookInput = {
  event_type: GranotWebhookEventType;
  received_at: Date;
  headers: IncomingHttpHeaders;
  payload: unknown;
};

export type CaptureGranotWebhookResult = {
  receipt_id: string;
};

export async function captureGranotWebhookReceipt(
  input: CaptureGranotWebhookInput,
): Promise<CaptureGranotWebhookResult> {
  await connectMongo();
  const receipt = await getGranotWebhookReceiptModel().create({
    provider: "granot",
    event_type: input.event_type,
    received_at: input.received_at,
    schema_version: 1,
    payload_kind: classifyPayload(input.payload),
    headers: sanitizeHeaders(input.headers),
    payload: input.payload,
    processing_status: "received",
    processing_attempts: 0,
  });

  return { receipt_id: receipt._id.toString() };
}

export function sanitizeHeaders(
  headers: IncomingHttpHeaders,
): Record<string, string | string[]> {
  const sanitized: Record<string, string | string[]> = {};
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

export function classifyPayload(
  payload: unknown,
): "object" | "array" | "null" | "primitive" {
  if (payload === null) return "null";
  if (Array.isArray(payload)) return "array";
  if (typeof payload === "object") return "object";
  return "primitive";
}
