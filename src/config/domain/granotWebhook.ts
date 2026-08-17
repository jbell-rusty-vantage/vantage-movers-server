import { isTestMode, isVantageTestRunner } from "./runtime";

export const GRANOT_WEBHOOK_EVENT_TYPES = [
  "lead_created",
  "priority_updated",
  "booking_status_changed",
] as const;

export type GranotWebhookEventType =
  (typeof GRANOT_WEBHOOK_EVENT_TYPES)[number];

export function getGranotWebhookSecret(): string | null {
  return process.env.GRANOT_WEBHOOK_SECRET?.trim() || null;
}

/**
 * Env-scoped Vercel Queue topic for the receipt-ID wake-up. Production uses
 * `granot-lifecycle-events`; every other environment uses
 * `granot-lifecycle-events-dev` unless `GRANOT_LIFECYCLE_QUEUE_TOPIC` overrides
 * it. A dedicated consumer may drain `{ receipt_id }` wake-ups; publish
 * failure still cannot change capture `202`.
 */
export function getGranotLifecycleQueueTopic(): string {
  const explicit = process.env.GRANOT_LIFECYCLE_QUEUE_TOPIC?.trim();
  if (explicit) {
    return explicit;
  }
  return isProductionVercelEnv()
    ? "granot-lifecycle-events"
    : "granot-lifecycle-events-dev";
}

/**
 * Whether the webhook capture path may attempt a real Vercel Queue send.
 * Tests, local/admin tooling, and unapproved environments never publish.
 */
export function shouldPublishGranotLifecycleQueue(): boolean {
  if (isVantageTestRunner() || isTestMode()) {
    return false;
  }
  return isVercelFunctionRuntimeEnv() && isProductionVercelEnv();
}

function isProductionVercelEnv(): boolean {
  return process.env.VERCEL_ENV?.trim().toLowerCase() === "production";
}

function isVercelFunctionRuntimeEnv(): boolean {
  return process.env.VERCEL === "1" && Boolean(process.env.VERCEL_REGION?.trim());
}
