/**
 * Central, env-driven configuration for the hybrid RingCentral call-lead
 * pipeline (webhook path + Call Log / Analytics cron path).
 *
 * This module is the single place where the "is one, both, or neither
 * strategy live?" question is answered. Every runtime decision about whether
 * to process webhooks, run the cron sync, create real `call_leads`, write
 * shadow leads, or reconcile via Analytics is resolved here from
 * `process.env`. Service/route code calls these helpers instead of reading
 * env vars directly so behavior stays consistent across paths.
 *
 * All reads happen at call time (not module load) so scripts and tests can
 * set env before invoking. The only exception is the backward-compatible
 * collection-name constants exported by the stores, which snapshot the
 * resolved name at import for the dev monitor.
 *
 * Production note: nothing here creates real leads unless
 * `RINGCENTRAL_CREATE_CALL_LEADS=true`. Default posture is dry-run.
 */

export type RingCentralCollectionMode = "test" | "production";

export type RingCentralCollectionKey =
  | "webhookEvents"
  | "callCandidates"
  | "callCandidateDecisions"
  | "callSessions"
  | "callSessionDecisions"
  | "processedCalls"
  | "callLogSyncState"
  | "shadowCallLeads"
  | "analyticsSnapshots";

/**
 * Base (production) collection names. In `test` collection mode every name
 * gets a `_test` suffix so local ngrok traffic never mixes with production
 * RingCentral state. Subscription metadata is intentionally not suffixed
 * (see `webhook-subscriptions.ts`) because it is safe to share.
 */
const BASE_COLLECTION_NAMES: Record<RingCentralCollectionKey, string> = {
  webhookEvents: "ringcentral_webhook_events",
  callCandidates: "ringcentral_call_candidates",
  callCandidateDecisions: "ringcentral_call_candidate_decisions",
  callSessions: "ringcentral_call_sessions",
  callSessionDecisions: "ringcentral_call_session_decisions",
  processedCalls: "ringcentral_processed_calls",
  callLogSyncState: "ringcentral_call_log_sync_state",
  shadowCallLeads: "ringcentral_shadow_call_leads",
  analyticsSnapshots: "ringcentral_analytics_snapshots",
};

export type RingCentralWebhookFilterMode = "per-number" | "account";

export type RingCentralHybridMode = "A_webhook_only" | "B_cron_only" | "C_hybrid" | "Z_disabled";

export type RingCentralRuntimeConfig = {
  webhookEnabled: boolean;
  callLogSyncEnabled: boolean;
  analyticsReconcileEnabled: boolean;
  createCallLeads: boolean;
  shadowCallLeads: boolean;
  webhookCallLogValidate: boolean;
  collectionMode: RingCentralCollectionMode;
  webhookFilterMode: RingCentralWebhookFilterMode;
  duplicateWindowHours: number;
  callLogSyncLookbackMinutes: number;
  callLogSyncOverlapMinutes: number;
  callLogSyncRollingLookbackMinutes: number;
  analyticsEndBufferMinutes: number;
  hybridMode: RingCentralHybridMode;
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

export function getRingCentralCollectionMode(): RingCentralCollectionMode {
  return process.env.RINGCENTRAL_COLLECTION_MODE?.trim().toLowerCase() === "production"
    ? "production"
    : "test";
}

export function getRingCentralCollectionName(key: RingCentralCollectionKey): string {
  const base = BASE_COLLECTION_NAMES[key];
  return getRingCentralCollectionMode() === "production" ? base : `${base}_test`;
}

export function isRingCentralWebhookEnabled(): boolean {
  return envFlag("RINGCENTRAL_WEBHOOK_ENABLED", true);
}

export function isRingCentralCallLogSyncEnabled(): boolean {
  return envFlag("RINGCENTRAL_CALL_LOG_SYNC_ENABLED", false);
}

export function isRingCentralAnalyticsReconcileEnabled(): boolean {
  return envFlag("RINGCENTRAL_ANALYTICS_RECONCILE_ENABLED", false);
}

/**
 * Master kill switch for inserts into the real `call_leads` collection. Must
 * stay `false` for the entire testing phase and through the production
 * dry-run window. Flipping to `true` is the Phase P3 "go live" action.
 */
export function shouldCreateRingCentralCallLeads(): boolean {
  return envFlag("RINGCENTRAL_CREATE_CALL_LEADS", false);
}

/**
 * When true (and real lead creation is off) qualified calls are written to a
 * staging collection instead of `call_leads`, so a production deployment can
 * be observed without producing billable leads.
 */
export function shouldShadowRingCentralCallLeads(): boolean {
  return envFlag("RINGCENTRAL_SHADOW_CALL_LEADS", false);
}

/**
 * When true, the webhook path confirms a qualified session against the
 * authoritative Call Log before acting on it, reducing false positives from
 * best-effort webhook duration math.
 */
export function shouldWebhookCallLogValidate(): boolean {
  return envFlag("RINGCENTRAL_WEBHOOK_CALL_LOG_VALIDATE", false);
}

export function getRingCentralWebhookFilterMode(): RingCentralWebhookFilterMode {
  return process.env.RINGCENTRAL_WEBHOOK_FILTER_MODE?.trim().toLowerCase() === "per-number"
    ? "per-number"
    : "account";
}

export function getRingCentralDuplicateWindowHours(): number {
  return envInt("RINGCENTRAL_DUPLICATE_WINDOW_HOURS", 24);
}

export function getRingCentralCallLogSyncLookbackMinutes(): number {
  return envInt("RINGCENTRAL_CALL_LOG_SYNC_LOOKBACK_MINUTES", 30);
}

export function getRingCentralCallLogSyncOverlapMinutes(): number {
  return envInt("RINGCENTRAL_CALL_LOG_SYNC_OVERLAP_MINUTES", 15);
}

/**
 * Every Call Log sync re-scans at least this much recent history, even after
 * the high-water cursor has advanced. RingCentral Call Log records for very
 * long calls can show up only after the call ends; a short cursor overlap can
 * therefore skip calls whose start time fell outside the next cron window.
 *
 * Default: 12h. This comfortably covers the current 2h cron cadence, multi-hour
 * calls, and RingCentral finalization lag. Idempotent processed-call upserts
 * make repeated scans safe.
 */
export function getRingCentralCallLogSyncRollingLookbackMinutes(): number {
  return envInt("RINGCENTRAL_CALL_LOG_SYNC_ROLLING_LOOKBACK_MINUTES", 12 * 60);
}

/**
 * Analytics `timeTo` must never be in the future or RingCentral returns
 * `ANL-302`; the cron/reconcile path always trims the window end by this
 * buffer.
 */
export function getRingCentralAnalyticsEndBufferMinutes(): number {
  return envInt("RINGCENTRAL_ANALYTICS_END_BUFFER_MINUTES", 2);
}

export function resolveRingCentralHybridMode(): RingCentralHybridMode {
  const webhook = isRingCentralWebhookEnabled();
  const cron = isRingCentralCallLogSyncEnabled();
  if (webhook && cron) {
    return "C_hybrid";
  }
  if (webhook) {
    return "A_webhook_only";
  }
  if (cron) {
    return "B_cron_only";
  }
  return "Z_disabled";
}

export function getRingCentralRuntimeConfig(): RingCentralRuntimeConfig {
  return {
    webhookEnabled: isRingCentralWebhookEnabled(),
    callLogSyncEnabled: isRingCentralCallLogSyncEnabled(),
    analyticsReconcileEnabled: isRingCentralAnalyticsReconcileEnabled(),
    createCallLeads: shouldCreateRingCentralCallLeads(),
    shadowCallLeads: shouldShadowRingCentralCallLeads(),
    webhookCallLogValidate: shouldWebhookCallLogValidate(),
    collectionMode: getRingCentralCollectionMode(),
    webhookFilterMode: getRingCentralWebhookFilterMode(),
    duplicateWindowHours: getRingCentralDuplicateWindowHours(),
    callLogSyncLookbackMinutes: getRingCentralCallLogSyncLookbackMinutes(),
    callLogSyncOverlapMinutes: getRingCentralCallLogSyncOverlapMinutes(),
    callLogSyncRollingLookbackMinutes:
      getRingCentralCallLogSyncRollingLookbackMinutes(),
    analyticsEndBufferMinutes: getRingCentralAnalyticsEndBufferMinutes(),
    hybridMode: resolveRingCentralHybridMode(),
  };
}

/**
 * Resolves how a qualified call should be materialized given the current
 * env posture. `create` wins over `shadow` wins over `dry_run`.
 */
export type RingCentralLeadWriteMode = "create" | "shadow" | "dry_run";

export function resolveRingCentralLeadWriteMode(): RingCentralLeadWriteMode {
  if (shouldCreateRingCentralCallLeads()) {
    return "create";
  }
  if (shouldShadowRingCentralCallLeads()) {
    return "shadow";
  }
  return "dry_run";
}
