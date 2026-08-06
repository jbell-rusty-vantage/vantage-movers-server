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
