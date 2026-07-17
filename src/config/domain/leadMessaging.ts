import { isTestMode, isVantageTestRunner } from "./runtime";

export const LEAD_MESSAGING_MODES = ["disabled", "inline", "queued"] as const;
export type LeadMessagingMode = (typeof LEAD_MESSAGING_MODES)[number];

export const LEAD_MESSAGE_STATUSES = [
  "pending",
  "queued",
  "sending",
  "accepted",
  "sent",
  "delivered",
  "retry_scheduled",
  "uncertain",
  "failed",
  "undelivered",
  "skipped",
] as const;
export type LeadMessageStatus = (typeof LEAD_MESSAGE_STATUSES)[number];

export const LEAD_MESSAGE_PURPOSES = ["quote_request_confirmation"] as const;
export type LeadMessagePurpose = (typeof LEAD_MESSAGE_PURPOSES)[number];

export const LEAD_MESSAGE_PROVIDER_STATUSES = [
  "accepted",
  "scheduled",
  "queued",
  "sending",
  "sent",
  "receiving",
  "received",
  "delivered",
  "undelivered",
  "failed",
  "read",
  "canceled",
] as const;
export type LeadMessageProviderStatus =
  (typeof LEAD_MESSAGE_PROVIDER_STATUSES)[number];

export function getLeadMessagingMode(): LeadMessagingMode {
  const raw = process.env.LEAD_MESSAGING_MODE?.trim().toLowerCase();
  return LEAD_MESSAGING_MODES.includes(raw as LeadMessagingMode)
    ? (raw as LeadMessagingMode)
    : "disabled";
}

/**
 * Explicit escape hatch for exercising real SMS delivery against test data.
 * It remains disabled in the automated test runner even if the env var leaks
 * into that process.
 */
export function shouldAllowLeadMessagingInTestMode(): boolean {
  return (
    !isVantageTestRunner() &&
    process.env.LEAD_MESSAGING_ALLOW_TEST_MODE?.trim().toLowerCase() === "true"
  );
}

export function getLeadMessagingCredentials(): {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  statusCallbackUrl: string;
} {
  return {
    accountSid: required("TWILIO_ACCOUNT_SID"),
    authToken: required("TWILIO_PRIMARY_AUTH_TOKEN"),
    fromNumber: required("TWILIO_FROM_NUMBER"),
    statusCallbackUrl: required("TWILIO_STATUS_CALLBACK_URL"),
  };
}

export function getLeadMessagingQueueTopic(): string {
  const explicit = process.env.LEAD_MESSAGING_QUEUE_TOPIC?.trim();
  if (explicit) return explicit;
  return process.env.VERCEL_ENV === "production"
    ? "lead-messaging-events"
    : "lead-messaging-events-dev";
}

export function shouldPublishLeadMessagingQueue(): boolean {
  if (isTestMode() || isVantageTestRunner()) return false;
  return (
    process.env.VERCEL === "1" &&
    Boolean(process.env.VERCEL_REGION?.trim()) &&
    process.env.VERCEL_ENV === "production"
  );
}

export const LEAD_MESSAGING_MAX_ATTEMPTS = 4;
export const LEAD_MESSAGING_LEASE_MS = 60_000;
export const LEAD_MESSAGING_DRAIN_LIMIT = 25;
export const LEAD_MESSAGING_MAX_MANUAL_RETRIES = 3;

export function getLeadMessagingDestinationCooldownMs(): number {
  return parsePositiveInt(
    process.env.LEAD_MESSAGING_DESTINATION_COOLDOWN_MINUTES,
    15,
  ) * 60_000;
}

export function getLeadMessagingHourlyLimit(): number {
  return parsePositiveInt(process.env.LEAD_MESSAGING_HOURLY_LIMIT, 200);
}

export function getLeadMessagingAllowedCountryPrefixes(): string[] {
  const raw =
    process.env.LEAD_MESSAGING_ALLOWED_COUNTRY_PREFIXES?.trim() || "+1";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^\+\d+$/.test(value));
}

export function leadMessagingRetryDelayMs(attemptCount: number): number {
  const delays = [60_000, 4 * 60_000, 10 * 60_000];
  const base = delays[Math.max(0, Math.min(attemptCount - 1, delays.length - 1))];
  return Math.round(base * (0.9 + Math.random() * 0.2));
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
