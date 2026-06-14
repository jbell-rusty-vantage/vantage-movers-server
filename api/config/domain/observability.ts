import { isTestMode } from "./runtime";

/**
 * Configuration for the operational observability + email-notification layer.
 *
 * This module owns every runtime decision about:
 *   - whether observability events/incidents are persisted at all,
 *   - whether writes go to Mongo, are mirrored to pino only, or are disabled,
 *   - which Mongo collection names are used (production / test / custom),
 *   - which event capture flags are enabled,
 *   - the email-notification provider, mode, recipients, and alert policy.
 *
 * Like `sheetSync.ts` and `ringcentral-config.ts`, all env reads happen at
 * call time (not module load) so scripts and tests can set env before
 * invoking. Helpers are pure aside from `process.env` reads, and unknown
 * values fall back to safe defaults.
 */

export const OBSERVABILITY_LEVELS = [
  "debug",
  "info",
  "warn",
  "error",
  "critical",
] as const;
export type ObservabilityLevel = (typeof OBSERVABILITY_LEVELS)[number];

/** Numeric ordering so callers can compare severities (higher = worse). */
const LEVEL_RANK: Record<ObservabilityLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  critical: 4,
};

export function observabilityLevelRank(level: ObservabilityLevel): number {
  return LEVEL_RANK[level];
}

export function isObservabilityLevel(value: string): value is ObservabilityLevel {
  return (OBSERVABILITY_LEVELS as readonly string[]).includes(value);
}

export const OBSERVABILITY_WRITE_MODES = [
  "enabled",
  "log_only",
  "disabled",
] as const;
export type ObservabilityWriteMode = (typeof OBSERVABILITY_WRITE_MODES)[number];

/** Broad event areas. Used by the event/incident models and admin filters. */
export const OPERATIONAL_EVENT_CATEGORIES = [
  "http",
  "mongo",
  "crm",
  "google_sheets",
  "sheet_sync",
  "ringcentral",
  "queue",
  "cron",
  "lead",
  "booking",
  "cancellation",
  "customer",
  "auth",
  "zip_state",
  "notification",
  "report",
  "admin",
] as const;
export type OperationalEventCategory =
  (typeof OPERATIONAL_EVENT_CATEGORIES)[number];

export const INCIDENT_STATUSES = [
  "open",
  "acknowledged",
  "resolved",
  "ignored",
  "auto_resolved",
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Statuses that mean an incident is still "live" for dedupe upserts. */
export const INCIDENT_OPEN_STATUSES = ["open", "acknowledged"] as const;

export const INCIDENT_SEVERITIES = ["warn", "error", "critical"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const PII_POLICIES = ["none", "masked", "internal"] as const;
export type PiiPolicy = (typeof PII_POLICIES)[number];

export const NOTIFICATION_PURPOSES = [
  "immediate_alert",
  "daily_digest",
  "weekly_report",
  "test",
] as const;
export type NotificationPurpose = (typeof NOTIFICATION_PURPOSES)[number];

export const NOTIFICATION_STATUSES = [
  "queued",
  "sending",
  "sent",
  "failed",
  "suppressed",
  "cancelled",
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const NOTIFICATION_RECIPIENT_TYPES = [
  "owner",
  "developer",
  "internal",
] as const;
export type NotificationRecipientType =
  (typeof NOTIFICATION_RECIPIENT_TYPES)[number];

export const REPORT_RUN_STATUSES = ["running", "completed", "failed"] as const;
export type ReportRunStatus = (typeof REPORT_RUN_STATUSES)[number];

export const OBSERVABILITY_COLLECTION_MODES = [
  "runtime",
  "production",
  "test",
  "custom",
] as const;
export type ObservabilityCollectionMode =
  (typeof OBSERVABILITY_COLLECTION_MODES)[number];

export const EMAIL_NOTIFICATION_MODES = [
  "live",
  "sandbox",
  "log_only",
  "disabled",
] as const;
export type EmailNotificationMode = (typeof EMAIL_NOTIFICATION_MODES)[number];

export type ObservabilityCollectionKey =
  | "events"
  | "incidents"
  | "notifications"
  | "reportRuns";

export type ObservabilityCollectionNames = Record<
  ObservabilityCollectionKey,
  string
>;

const PRODUCTION_COLLECTION_NAMES: ObservabilityCollectionNames = {
  events: "operational_events",
  incidents: "operational_incidents",
  notifications: "notification_deliveries",
  reportRuns: "operational_report_runs",
};

const TEST_COLLECTION_NAMES: ObservabilityCollectionNames = {
  events: "test_operational_events",
  incidents: "test_operational_incidents",
  notifications: "test_notification_deliveries",
  reportRuns: "test_operational_report_runs",
};

const CUSTOM_COLLECTION_ENV_VARS: Record<ObservabilityCollectionKey, string> = {
  events: "OBSERVABILITY_EVENTS_COLLECTION",
  incidents: "OBSERVABILITY_INCIDENTS_COLLECTION",
  notifications: "OBSERVABILITY_NOTIFICATIONS_COLLECTION",
  reportRuns: "OBSERVABILITY_REPORT_RUNS_COLLECTION",
};

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") {
    return defaultValue;
  }
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

function envCsv(name: string): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function envLevel(name: string, defaultValue: ObservabilityLevel): ObservabilityLevel {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw && isObservabilityLevel(raw)) {
    return raw;
  }
  return defaultValue;
}

function isNodeTestRunner(): boolean {
  return Boolean(process.env.NODE_TEST_CONTEXT) || process.env.VANTAGE_TEST_RUNNER === "true";
}

function allowTestObservabilityWrites(): boolean {
  return process.env.ALLOW_TEST_OBSERVABILITY === "true";
}

function allowProductionObservabilityInTests(): boolean {
  return process.env.ALLOW_PRODUCTION_OBSERVABILITY_IN_TESTS === "true";
}

function forceTestObservabilityCollections(): boolean {
  return isNodeTestRunner() && !allowProductionObservabilityInTests();
}

/**
 * The master enablement flag. When `OBSERVABILITY_ENABLED=false`, no
 * observability collections are written and notification policy is not
 * evaluated. The write-mode `disabled` value mirrors this for explicit
 * deploy posture.
 */
export function isObservabilityEnabled(): boolean {
  if (isNodeTestRunner() && !allowTestObservabilityWrites()) {
    return false;
  }
  if (!envFlag("OBSERVABILITY_ENABLED", true)) {
    return false;
  }
  return getObservabilityWriteMode() !== "disabled";
}

export function getObservabilityWriteMode(): ObservabilityWriteMode {
  const raw = process.env.OBSERVABILITY_WRITE_MODE?.trim().toLowerCase();
  if (raw === "enabled" || raw === "log_only" || raw === "disabled") {
    return raw;
  }
  return "enabled";
}

/**
 * `enabled` mode writes Mongo collections; `log_only` mirrors event decisions
 * to pino without writing collections. Disabled (or master-disabled) writes
 * nothing.
 */
export function shouldWriteObservabilityCollections(): boolean {
  return isObservabilityEnabled() && getObservabilityWriteMode() === "enabled";
}

export function getObservabilityCollectionMode(): ObservabilityCollectionMode {
  const raw = process.env.OBSERVABILITY_COLLECTION_MODE?.trim().toLowerCase();
  if (
    raw === "runtime" ||
    raw === "production" ||
    raw === "test" ||
    raw === "custom"
  ) {
    return raw;
  }
  return "runtime";
}

function applyPrefix(names: ObservabilityCollectionNames): ObservabilityCollectionNames {
  const prefix = process.env.OBSERVABILITY_COLLECTION_PREFIX?.trim();
  if (!prefix) {
    return names;
  }
  return {
    events: `${prefix}${names.events}`,
    incidents: `${prefix}${names.incidents}`,
    notifications: `${prefix}${names.notifications}`,
    reportRuns: `${prefix}${names.reportRuns}`,
  };
}

/**
 * Resolves the active observability collection names based on
 * `OBSERVABILITY_COLLECTION_MODE`:
 *   - `runtime`    follows `TEST_MODE` (test names when `TEST_MODE=true`).
 *   - `production` forces production names.
 *   - `test`       forces test names.
 *   - `custom`     requires explicit per-collection env vars.
 *
 * `OBSERVABILITY_COLLECTION_PREFIX` is prepended to default (non-custom)
 * names. Custom names are used verbatim.
 */
export function getObservabilityCollectionNames(): ObservabilityCollectionNames {
  if (forceTestObservabilityCollections()) {
    return applyPrefix(TEST_COLLECTION_NAMES);
  }

  const mode = getObservabilityCollectionMode();

  if (mode === "custom") {
    const resolved = {} as ObservabilityCollectionNames;
    for (const key of Object.keys(CUSTOM_COLLECTION_ENV_VARS) as ObservabilityCollectionKey[]) {
      const envVar = CUSTOM_COLLECTION_ENV_VARS[key];
      const value = process.env[envVar]?.trim();
      if (!value) {
        throw new Error(
          `${envVar} is required when OBSERVABILITY_COLLECTION_MODE=custom`,
        );
      }
      resolved[key] = value;
    }
    return resolved;
  }

  if (mode === "production") {
    return applyPrefix(PRODUCTION_COLLECTION_NAMES);
  }

  if (mode === "test") {
    return applyPrefix(TEST_COLLECTION_NAMES);
  }

  // runtime
  return applyPrefix(
    isTestMode() ? TEST_COLLECTION_NAMES : PRODUCTION_COLLECTION_NAMES,
  );
}

export function getObservabilityCollectionName(
  key: ObservabilityCollectionKey,
): string {
  return getObservabilityCollectionNames()[key];
}

export function getObservabilityEventMinLevel(): ObservabilityLevel {
  return envLevel("OBSERVABILITY_EVENT_MIN_LEVEL", "info");
}

export function shouldCaptureOwnerEvents(): boolean {
  return envFlag("OBSERVABILITY_CAPTURE_OWNER_EVENTS", true);
}

export function shouldCaptureInfoEvents(): boolean {
  return envFlag("OBSERVABILITY_CAPTURE_INFO_EVENTS", true);
}

export function shouldCaptureHttp5xx(): boolean {
  return envFlag("OBSERVABILITY_CAPTURE_HTTP_5XX", true);
}

export function shouldCaptureAuthEvents(): boolean {
  return envFlag("OBSERVABILITY_CAPTURE_AUTH_EVENTS", true);
}

export function shouldCaptureZipStateEvents(): boolean {
  return envFlag("OBSERVABILITY_CAPTURE_ZIP_STATE_EVENTS", true);
}

export function getObservabilitySlowRequestMs(): number {
  return envInt("OBSERVABILITY_SLOW_REQUEST_MS", 3000);
}

export function getObservabilityDetailsMaxBytes(): number {
  return envInt("OBSERVABILITY_DETAILS_MAX_BYTES", 16384);
}

export function getObservabilityBulkBatchSize(): number {
  return envInt("OBSERVABILITY_BULK_BATCH_SIZE", 500);
}

/**
 * Whether a given event level should be persisted, considering both the
 * configured minimum level and the info-capture flag. Owner-worthy lifecycle
 * events use `info` and remain enabled by default.
 */
export function shouldPersistEventLevel(
  level: ObservabilityLevel,
  options: { ownerVisible?: boolean } = {},
): boolean {
  if (options.ownerVisible && level === "info") {
    return shouldCaptureOwnerEvents();
  }
  if (observabilityLevelRank(level) < observabilityLevelRank(getObservabilityEventMinLevel())) {
    return false;
  }
  if (level === "info" && !shouldCaptureInfoEvents()) {
    return false;
  }
  return true;
}

export type ObservabilityConfigValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  collectionNames: ObservabilityCollectionNames | null;
};

export function validateObservabilityConfig(): ObservabilityConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  let collectionNames: ObservabilityCollectionNames | null = null;

  try {
    collectionNames = getObservabilityCollectionNames();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const mode = getEmailNotificationsMode();
  const email = getSendgridConfig();
  if (isEmailNotificationsEnabled() && mode !== "log_only") {
    if (!email.fromEmail) warnings.push("SENDGRID_FROM_EMAIL is not set");
    if (email.ownerToEmails.length === 0 && email.developerToEmails.length === 0) {
      warnings.push("No SendGrid recipients are configured");
    }
    if ((mode === "live" || mode === "sandbox") && !email.apiKey) {
      warnings.push("SENDGRID_API_KEY is not set");
    }
  }

  return { ok: errors.length === 0, errors, warnings, collectionNames };
}

// ---------------------------------------------------------------------------
// Email notifications
// ---------------------------------------------------------------------------

export type EmailProvider = "sendgrid" | "resend" | "ses" | "mailgun" | string;

export function getEmailProvider(): EmailProvider {
  return process.env.EMAIL_PROVIDER?.trim().toLowerCase() || "sendgrid";
}

export function isEmailNotificationsEnabled(): boolean {
  if (!envFlag("EMAIL_NOTIFICATIONS_ENABLED", true)) {
    return false;
  }
  return getEmailNotificationsMode() !== "disabled";
}

/**
 * Email send posture:
 *   - `live`     send real email.
 *   - `sandbox`  call provider sandbox mode; still records deliveries.
 *   - `log_only` render subject/body to logs + delivery records, no provider call.
 *   - `disabled` do not create deliveries.
 *
 * Defaults to `log_only` so the pipeline can be verified before real email
 * is sent in production.
 */
export function getEmailNotificationsMode(): EmailNotificationMode {
  const raw = process.env.EMAIL_NOTIFICATIONS_MODE?.trim().toLowerCase();
  if (
    raw === "live" ||
    raw === "sandbox" ||
    raw === "log_only" ||
    raw === "disabled"
  ) {
    return raw;
  }
  return "log_only";
}

export type SendgridConfig = {
  apiKey: string | null;
  fromEmail: string | null;
  ownerToEmails: string[];
  developerToEmails: string[];
  replyTo: string | null;
};

export function getSendgridConfig(): SendgridConfig {
  return {
    apiKey: process.env.SENDGRID_API_KEY?.trim() || null,
    fromEmail: process.env.SENDGRID_FROM_EMAIL?.trim() || null,
    ownerToEmails: envCsv("SENDGRID_TO_EMAIL"),
    developerToEmails: envCsv("SENDGRID_DEVELOPER_TO_EMAIL"),
    replyTo: process.env.ALERT_EMAIL_REPLY_TO?.trim() || null,
  };
}

export function getAlertEmailMinLevel(): ObservabilityLevel {
  return envLevel("ALERT_EMAIL_MIN_LEVEL", "error");
}

export function getAlertEmailImmediateLevels(): ObservabilityLevel[] {
  const raw = envCsv("ALERT_EMAIL_IMMEDIATE_LEVELS")
    .map((value) => value.toLowerCase())
    .filter((value): value is ObservabilityLevel => isObservabilityLevel(value));
  return raw.length > 0 ? raw : ["critical"];
}

export function getAlertEmailThrottleMinutes(): number {
  return envInt("ALERT_EMAIL_THROTTLE_MINUTES", 60);
}

export function isAlertEmailDailyDigestEnabled(): boolean {
  return envFlag("ALERT_EMAIL_DAILY_DIGEST_ENABLED", true);
}

export function getAlertEmailDailyDigestCronTime(): string {
  return process.env.ALERT_EMAIL_DAILY_DIGEST_CRON_TIME?.trim() || "12:00";
}

/**
 * Event keys that should email the owner (immediately for success milestones
 * like booking/cancellation, or as failure alerts). Controlled by env so the
 * owner can tune which events page them without code changes.
 */
export function getAlertEmailOwnerEvents(): string[] {
  return envCsv("ALERT_EMAIL_OWNER_EVENTS");
}

/**
 * "Near-worthy" events that are not emailed individually but are surfaced in
 * the daily digest and prominently in the Observational tab.
 */
export function getAlertEmailNearWorthyDigestEvents(): string[] {
  return envCsv("ALERT_EMAIL_NEAR_WORTHY_DIGEST_EVENTS");
}
