import { parseExplicitBooleanFlag } from "./granotLifecycle";
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

export const LEAD_MESSAGE_PURPOSES = [
  "quote_request_confirmation",
  "granot_lead_created_confirmation",
] as const;
export type LeadMessagePurpose = (typeof LEAD_MESSAGE_PURPOSES)[number];

export const LEAD_MESSAGE_ORIGINS = ["public_form", "granot_lead_created"] as const;
export type LeadMessageOrigin = (typeof LEAD_MESSAGE_ORIGINS)[number];

export const OUTBOUND_SMS_CONSENT_BASES = [
  "not_attested",
  "customer_submitted_form",
  "existing_relationship",
] as const;
export type OutboundSmsConsentBasis = (typeof OUTBOUND_SMS_CONSENT_BASES)[number];

export const OUTBOUND_SMS_TRIGGERS = ["granot_lead_created"] as const;
export type OutboundSmsTrigger = (typeof OUTBOUND_SMS_TRIGGERS)[number];

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

/**
 * Off by default. Overnight Twilio scheduling stays inert until this is
 * explicitly `true`, so deploys keep sending immediately 24/7.
 */
export function isLeadMessagingQuietHoursEnabled(): boolean {
  return (
    process.env.LEAD_MESSAGING_QUIET_HOURS_ENABLED?.trim().toLowerCase() ===
    "true"
  );
}

/**
 * Off by default. Granot create-if-missing confirmation SMS stay inert until
 * this is an explicit boolean `true`.
 */
export function isGranotLeadCreatedSmsEnabled(): boolean {
  return parseExplicitBooleanFlag(
    process.env.GRANOT_LEAD_CREATED_SMS_ENABLED,
    false,
    "GRANOT_LEAD_CREATED_SMS_ENABLED",
  );
}

export function getLeadMessagingCredentials(): {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  statusCallbackUrl: string;
  messagingServiceSid: string | null;
} {
  return {
    accountSid: required("TWILIO_ACCOUNT_SID"),
    authToken: required("TWILIO_PRIMARY_AUTH_TOKEN"),
    fromNumber: required("TWILIO_FROM_NUMBER"),
    statusCallbackUrl: required("TWILIO_STATUS_CALLBACK_URL"),
    messagingServiceSid:
      process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() || null,
  };
}

export const DEFAULT_TWILIO_VOICE_FORWARD_TO = "+18884862499";
export const DEFAULT_TWILIO_VOICE_WEBHOOK_URL =
  "https://vantage-movers-main-server.vercel.app/api/webhooks/twilio/voice";

export function getTwilioVoiceConfig(): {
  fromNumber: string;
  forwardTo: string;
  webhookUrl: string;
  statusCallbackUrl: string;
  completedCallbackUrl: string;
} {
  const webhookUrl =
    process.env.TWILIO_VOICE_WEBHOOK_URL?.trim() ||
    DEFAULT_TWILIO_VOICE_WEBHOOK_URL;
  const parsedWebhookUrl = new URL(webhookUrl);
  const callbackBase = parsedWebhookUrl.pathname.replace(/\/$/, "");
  const fromNumber = required("TWILIO_FROM_NUMBER");
  const forwardTo =
    process.env.TWILIO_VOICE_FORWARD_TO?.trim() ||
    DEFAULT_TWILIO_VOICE_FORWARD_TO;

  if (!/^\+[1-9]\d{7,14}$/.test(forwardTo)) {
    throw new Error("TWILIO_VOICE_FORWARD_TO must be an E.164 phone number");
  }
  if (digits(fromNumber) === digits(forwardTo)) {
    throw new Error("TWILIO_VOICE_FORWARD_TO cannot equal TWILIO_FROM_NUMBER");
  }

  const callbackUrl = (suffix: string) => {
    const url = new URL(parsedWebhookUrl.toString());
    url.pathname = `${callbackBase}/${suffix}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  };

  return {
    fromNumber,
    forwardTo,
    webhookUrl: parsedWebhookUrl.toString(),
    statusCallbackUrl: callbackUrl("status"),
    completedCallbackUrl: callbackUrl("completed"),
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

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
