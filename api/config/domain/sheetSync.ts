import { getRuntimeDomainOverrides, isVantageTestRunner } from "./runtime";

/**
 * Configuration for the durable Google Sheets sync outbox + queue drainer.
 *
 * This module owns:
 *   - the tri-state `SHEET_SYNC_MODE` (`queued | legacy | disabled`),
 *   - the env-scoped Vercel Queue topic name,
 *   - documented Google Sheets API limit constants,
 *   - env-overridable operational quota budgets (always below the documented
 *     Google limits so the worker leaves headroom),
 *   - drainer guardrails (claim/coalesce/batch/run sizing), and
 *   - the pure coalescing-key + priority helpers shared by the outbox writer
 *     and the drainer.
 *
 * Enum constants and pure helpers are free of side effects so models, tests,
 * and the drainer can import them safely. Env reads happen at call time
 * (mirroring `ringcentral-config.ts`) so scripts/tests can set env first; the
 * only exception is documented where noted.
 */

export const SHEET_SYNC_MODES = ["queued", "legacy", "disabled"] as const;
export type SheetSyncMode = (typeof SHEET_SYNC_MODES)[number];

export const SHEET_SYNC_JOB_STATUSES = [
  "pending",
  "retrying",
  "processing",
  "synced",
  "failed",
  "cancelled",
] as const;
export type SheetSyncJobStatus = (typeof SHEET_SYNC_JOB_STATUSES)[number];

/**
 * The set of statuses that mean a job is still "live" and should block a new
 * coalescing upsert from creating a duplicate.
 */
export const SHEET_SYNC_ACTIVE_JOB_STATUSES = [
  "pending",
  "retrying",
  "processing",
] as const satisfies readonly SheetSyncJobStatus[];

export const SHEET_SYNC_RESOURCES = [
  "source_lead",
  "booked_lead",
  "booking_chain",
  "cancellation_chain",
  "delete_source_lead",
  "delete_booked_lead",
  "delete_cancelled_lead",
] as const;
export type SheetSyncResource = (typeof SHEET_SYNC_RESOURCES)[number];

export const SHEET_SYNC_DELETE_RESOURCES = [
  "delete_source_lead",
  "delete_booked_lead",
  "delete_cancelled_lead",
] as const satisfies readonly SheetSyncResource[];

export function isDeleteResource(resource: SheetSyncResource): boolean {
  return (SHEET_SYNC_DELETE_RESOURCES as readonly string[]).includes(resource);
}

export const SHEET_SYNC_ENTITY_MODELS = [
  "FormLead",
  "CallLead",
  "BookedLead",
  "CancelledLead",
] as const;
export type SheetSyncEntityModel = (typeof SHEET_SYNC_ENTITY_MODELS)[number];

export const SHEET_SYNC_CREATED_BY = ["api", "cron", "admin", "script"] as const;
export type SheetSyncCreatedBy = (typeof SHEET_SYNC_CREATED_BY)[number];

export const SHEET_SYNC_RUN_TRIGGERS = ["queue", "cron", "admin", "script"] as const;
export type SheetSyncRunTrigger = (typeof SHEET_SYNC_RUN_TRIGGERS)[number];

export const SHEET_SYNC_RUN_STATUSES = [
  "running",
  "completed",
  "partial_failure",
  "failed",
] as const;
export type SheetSyncRunStatus = (typeof SHEET_SYNC_RUN_STATUSES)[number];

export const SHEET_SYNC_ATTEMPT_ACTIONS = [
  "lookup",
  "update",
  "append",
  "delete",
  "ensure_headers",
] as const;
export type SheetSyncAttemptAction = (typeof SHEET_SYNC_ATTEMPT_ACTIONS)[number];

export const SHEET_SYNC_ATTEMPT_STATUSES = ["synced", "failed", "deferred"] as const;
export type SheetSyncAttemptStatus = (typeof SHEET_SYNC_ATTEMPT_STATUSES)[number];

export type SheetSyncQuotaOpClass = "read" | "write";

/**
 * Documented Google Sheets API limits (per the published limits page).
 * Service-account calls all count against a single user/service-account, so
 * the per-user budget is the binding constraint for this app. These are the
 * hard ceilings; operational budgets below always stay under them.
 */
export const GOOGLE_SHEETS_LIMITS = {
  projectReadsPerMinute: 300,
  projectWritesPerMinute: 300,
  userReadsPerMinute: 60,
  userWritesPerMinute: 60,
  recommendedMaxPayloadBytes: 2_000_000,
  maxRequestProcessingSeconds: 180,
} as const;

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

/**
 * Resolves the active sheet-sync execution mode.
 *
 * Defaults to `legacy` (the current `waitUntil` behavior) so that simply
 * deploying this code changes nothing until production explicitly sets
 * `SHEET_SYNC_MODE=queued`. Unknown values fall back to `legacy`.
 */
export function getSheetSyncMode(): SheetSyncMode {
  const override = getRuntimeDomainOverrides().sheetSyncMode;
  if (override) {
    return override;
  }

  const raw = process.env.SHEET_SYNC_MODE?.trim().toLowerCase();
  if (raw === "queued" || raw === "legacy" || raw === "disabled") {
    return raw;
  }
  return "legacy";
}

export function isSheetSyncQueuedMode(): boolean {
  return getSheetSyncMode() === "queued";
}

export function isSheetSyncDisabledMode(): boolean {
  return getSheetSyncMode() === "disabled";
}

/**
 * Whether this runtime is the production Vercel environment. Used to scope the
 * queue topic so preview/development/test never publish onto the production
 * topic.
 */
export function isProductionVercelEnv(): boolean {
  return process.env.VERCEL_ENV?.trim().toLowerCase() === "production";
}

/**
 * Env-scoped Vercel Queue topic. Production uses `sheet-sync-events`; every
 * other environment uses `sheet-sync-events-dev` unless `SHEET_SYNC_QUEUE_TOPIC`
 * overrides it explicitly.
 */
export function getSheetSyncQueueTopic(): string {
  const explicit = process.env.SHEET_SYNC_QUEUE_TOPIC?.trim();
  if (explicit) {
    return explicit;
  }
  return isProductionVercelEnv() ? "sheet-sync-events" : "sheet-sync-events-dev";
}

/**
 * The consumer group name for the drainer consumer. A single group keeps one
 * logical worker stream; extra groups would each receive a copy and compete
 * for the same Google quota.
 */
export function getSheetSyncConsumerGroup(): string {
  return process.env.SHEET_SYNC_CONSUMER_GROUP?.trim() || "sheet-sync-drainer";
}

export type SheetSyncBudgets = {
  readsPerMinute: number;
  writesPerMinute: number;
  projectReadsPerMinute: number;
  projectWritesPerMinute: number;
  maxPayloadBytes: number;
};

/**
 * Conservative operational budgets. Defaults reserve headroom below the
 * documented Google limits; each is env-overridable for live tuning.
 */
export function getSheetSyncBudgets(): SheetSyncBudgets {
  return {
    readsPerMinute: envInt("SHEET_SYNC_READS_PER_MINUTE_BUDGET", 45),
    writesPerMinute: envInt("SHEET_SYNC_WRITES_PER_MINUTE_BUDGET", 45),
    projectReadsPerMinute: envInt("SHEET_SYNC_PROJECT_READS_PER_MINUTE_BUDGET", 250),
    projectWritesPerMinute: envInt("SHEET_SYNC_PROJECT_WRITES_PER_MINUTE_BUDGET", 250),
    maxPayloadBytes: envInt("SHEET_SYNC_MAX_PAYLOAD_BYTES", 1_500_000),
  };
}

export type SheetSyncDrainGuardrails = {
  maxJobsPerDrain: number;
  maxCoalescedEntitiesPerDrain: number;
  maxRowsPerBatch: number;
  maxWriteSubrequestsPerCall: number;
  maxRunDurationMs: number;
  leaseDurationMs: number;
  debounceWindowMs: number;
  maxAttempts: number;
};

export function getSheetSyncDrainGuardrails(): SheetSyncDrainGuardrails {
  return {
    maxJobsPerDrain: envInt("SHEET_SYNC_MAX_JOBS_PER_DRAIN", 500),
    maxCoalescedEntitiesPerDrain: envInt("SHEET_SYNC_MAX_COALESCED_ENTITIES_PER_DRAIN", 500),
    maxRowsPerBatch: envInt("SHEET_SYNC_MAX_ROWS_PER_BATCH", 500),
    maxWriteSubrequestsPerCall: envInt("SHEET_SYNC_MAX_WRITE_SUBREQUESTS_PER_CALL", 100),
    maxRunDurationMs: envInt("SHEET_SYNC_MAX_RUN_DURATION_MS", 60_000),
    leaseDurationMs: envInt("SHEET_SYNC_LEASE_DURATION_MS", 120_000),
    debounceWindowMs: envInt("SHEET_SYNC_DEBOUNCE_WINDOW_MS", 3_000),
    maxAttempts: envInt("SHEET_SYNC_MAX_ATTEMPTS", 8),
  };
}

/**
 * Whether the queue publisher should attempt a real `send` to Vercel Queues.
 *
 * On Vercel (`VERCEL=1`) we always publish. Locally we only publish when
 * `SHEET_SYNC_QUEUE_LOCAL_PUBLISH=true`; otherwise the adapter no-ops and the
 * cron / direct-drain path is responsible for draining (keeps local dev from
 * needing queue credentials).
 *
 * The unit suite marks the process as a Vantage test runner (see
 * `scripts/test-setup.ts`). Deploy-time test runs also inject `VERCEL=1`, which
 * would otherwise attempt queue publishes and record bogus
 * `sheet_sync.queue.publish_failed` events. Never publish from the test runner;
 * isolated queue adapter tests should stub `@vercel/queue` directly instead.
 */
export function shouldPublishSheetSyncQueue(): boolean {
  if (isVantageTestRunner()) {
    return false;
  }
  if (process.env.VERCEL === "1") {
    return true;
  }
  return envFlag("SHEET_SYNC_QUEUE_LOCAL_PUBLISH", false);
}

/**
 * Priority weighting for due-job ordering. Higher numbers drain first
 * (the job index sorts `priority: -1`). Order mirrors the design doc:
 * deletes > booking chains > cancellation chains > new creates > updates.
 */
export const SHEET_SYNC_PRIORITIES = {
  delete: 100,
  bookingChain: 80,
  cancellationChain: 70,
  bookedLead: 65,
  sourceLeadCreate: 60,
  sourceLeadUpdate: 50,
} as const;

export function priorityForJob(
  resource: SheetSyncResource,
  operation?: string,
): number {
  switch (resource) {
    case "delete_source_lead":
    case "delete_booked_lead":
    case "delete_cancelled_lead":
      return SHEET_SYNC_PRIORITIES.delete;
    case "booking_chain":
      return SHEET_SYNC_PRIORITIES.bookingChain;
    case "cancellation_chain":
      return SHEET_SYNC_PRIORITIES.cancellationChain;
    case "booked_lead":
      return SHEET_SYNC_PRIORITIES.bookedLead;
    case "source_lead":
      return operation?.includes("create")
        ? SHEET_SYNC_PRIORITIES.sourceLeadCreate
        : SHEET_SYNC_PRIORITIES.sourceLeadUpdate;
  }
}

/**
 * Builds the durable coalescing key that collapses repeated jobs for the same
 * logical entity into one outbox row. Keys follow the design doc exactly so a
 * delete tombstone and its upsert occupy distinct keys (the outbox writer is
 * responsible for letting the delete supersede the upsert).
 */
export function buildCoalescingKey(args: {
  resource: SheetSyncResource;
  entityId: string;
  entityModel?: SheetSyncEntityModel | string;
}): string {
  const { resource, entityId, entityModel } = args;
  switch (resource) {
    case "source_lead":
      return `source_lead:${entityModel}:${entityId}`;
    case "delete_source_lead":
      return `delete_source_lead:${entityModel}:${entityId}`;
    case "booked_lead":
      return `booked_lead:${entityId}`;
    case "booking_chain":
      return `booking_chain:${entityId}`;
    case "cancellation_chain":
      return `cancellation_chain:${entityId}`;
    case "delete_booked_lead":
      return `delete_booked_lead:${entityId}`;
    case "delete_cancelled_lead":
      return `delete_cancelled_lead:${entityId}`;
  }
}

/**
 * Maps a delete resource to the upsert coalescing key it supersedes, so the
 * outbox writer can cancel a pending upsert when a tombstone is created.
 */
export function supersededUpsertCoalescingKey(args: {
  resource: SheetSyncResource;
  entityId: string;
  entityModel?: SheetSyncEntityModel | string;
}): string | undefined {
  const { resource, entityId, entityModel } = args;
  switch (resource) {
    case "delete_source_lead":
      return `source_lead:${entityModel}:${entityId}`;
    case "delete_booked_lead":
      return `booked_lead:${entityId}`;
    case "delete_cancelled_lead":
      return `cancellation_chain:${entityId}`;
    default:
      return undefined;
  }
}
