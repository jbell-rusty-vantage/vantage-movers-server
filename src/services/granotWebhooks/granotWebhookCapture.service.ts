import type { IncomingHttpHeaders } from "node:http";
import type { GranotWebhookEventType } from "../../config/domain/granotWebhook";
import type { GranotWebhookAuthenticationMethod } from "../../middleware/requireGranotWebhookSecret";
import {
  allowlistGranotWebhookHeaders,
  captureGranotLifecycleWebhookReceipt,
  type CaptureGranotLifecycleWebhookResult,
} from "../granotLifecycle/capture";
import { classifyPayloadKind } from "../granotLifecycle/receiptEvidence";

/** @deprecated Compatibility input. Prefer captureGranotLifecycleWebhookReceipt. */
export type CaptureGranotWebhookInput = {
  event_type: GranotWebhookEventType;
  received_at: Date;
  headers: IncomingHttpHeaders;
  payload: unknown;
  authentication_method: GranotWebhookAuthenticationMethod;
};

/** @deprecated Compatibility alias. Prefer CaptureGranotLifecycleWebhookResult. */
export type CaptureGranotWebhookResult = CaptureGranotLifecycleWebhookResult;

/**
 * Narrow compatibility adapter. Stripping, header filtering, hashing, and
 * receipt creation live in `granotLifecycle/capture`.
 */
export async function captureGranotWebhookReceipt(
  input: CaptureGranotWebhookInput,
): Promise<CaptureGranotWebhookResult> {
  return captureGranotLifecycleWebhookReceipt({
    route_event_class: input.event_type,
    captured_at: input.received_at,
    headers: input.headers,
    payload: input.payload,
    authentication_method: input.authentication_method,
  });
}

/** @deprecated Use allowlistGranotWebhookHeaders. */
export function sanitizeHeaders(
  headers: IncomingHttpHeaders,
): Record<string, string | string[]> {
  return allowlistGranotWebhookHeaders(headers);
}

/** @deprecated Use classifyPayloadKind. */
export function classifyPayload(
  payload: unknown,
): "object" | "array" | "null" | "primitive" {
  return classifyPayloadKind(payload);
}
