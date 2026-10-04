import { csiFlag } from "../../config/domain/salesIntelligence";
import { getContactNumberModel } from "../../models/ContactNumber";
import { getRepIdentityLinkModel } from "../../models/RepIdentityLink";
import { getRingCentralDirectorySnapshotModel } from "../../models/RingCentralDirectorySnapshot";
import { readCaptureCoverage } from "../numberActivity/coverage";
import { getSalesIntelligenceSyncStateModel } from "../../models/SalesIntelligenceSyncState";
import { CALL_LOG_ALL_DIRECTIONS_SCOPE, callLogReconcileConfig } from "../numberActivity/reconcileCallLog";
import { CALL_LOG_SWEEP_SCOPE } from "../numberActivity/callLogSweep";
import { SUBSCRIPTION_MISSING_CODE, WEBHOOK_SUBSCRIPTION_SCOPE } from "../numberActivity/webhookSubscriptionCron";
import { ownerCoverageDtoSchema, type OwnerCoverageDto } from "./dto";
import { resolvePolicy } from "./policy";
import mongoose, { type PipelineStage } from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { getCallInteractionModel } from "../../models/CallInteraction";
import { getRingCentralCollectionName } from "../ringcentral/ringcentral-config";
import { staffedMinutesAtLeast, subtractStaffedMinutes, type Staffing } from "../numberActivity/staffedClock";

/**
 * `GET /coverage`: capture coverage plus Call Log, webhook and directory
 * health for the Numbers and RingCentral Accounts views. Every source is
 * retained capture/directory state; nothing here reads analysis, Outreach or
 * operational-event collections.
 */
async function readMappingHygiene() {
  const snapshot = await getRingCentralDirectorySnapshotModel()
    .findOne({}, { taken_at: 1, provider_account_id: 1, extensions: 1 })
    .sort({ taken_at: -1 })
    .lean();
  const unmapped_inbound_numbers = await getContactNumberModel().countDocuments({
    kind: "external",
    classification: { $in: ["customer", "unknown"] },
    "rollups.attached_lead_count": 0,
  });
  if (!snapshot) {
    return {
      unmapped_inbound_numbers,
      unmapped_directory_users: null,
      last_directory_sync_at: null,
      directory_status: "missing" as const,
    };
  }
  const users = (snapshot.extensions ?? []).filter((row) => row.type === "User");
  const reviewed = await getRepIdentityLinkModel().find(
    { rc_account_id: snapshot.provider_account_id, status: "reviewed", effective_to: null },
    { rc_extension_id: 1 },
  ).lean();
  const linked = new Set(reviewed.map((row) => row.rc_extension_id));
  return {
    unmapped_inbound_numbers,
    unmapped_directory_users: users.filter((row) => !linked.has(row.id)).length,
    last_directory_sync_at: snapshot.taken_at.toISOString(),
    directory_status: "stored" as const,
  };
}

type CaptureHealthRow = {
  scope: string;
  known_complete_through?: Date | null;
  quarantined_records?: Array<{ first_failed_at: Date }> | null;
  consecutive_drift_runs?: number | null;
  consecutive_failures?: number | null;
  last_run?: {
    started_at?: Date | null;
    finished_at?: Date | null;
    error_code?: string | null;
    from?: Date | null;
    to?: Date | null;
    provider_records?: number | null;
    stored_in_latest_version?: number | null;
    applied_changes?: number | null;
    missing_before?: number | null;
    stale_before?: number | null;
    provisional_after_horizon?: number | null;
    quarantined?: number | null;
  } | null;
};

/** Pure: quarantine and last-sweep figures from the two sync-state rows. */
export function composeCallLogCapture(
  reconcile: CaptureHealthRow | null,
  sweep: CaptureHealthRow | null,
  syncMode: "off" | "shadow" | "on",
): OwnerCoverageDto["call_log_capture"] {
  const quarantined = reconcile?.quarantined_records ?? [];
  let oldest: Date | null = null;
  for (const entry of quarantined) if (!oldest || entry.first_failed_at < oldest) oldest = entry.first_failed_at;
  const run = sweep?.last_run;
  const last_sweep = run?.started_at && run.from && run.to
    ? {
        ran_at: run.started_at.toISOString(),
        from: run.from.toISOString(),
        to: run.to.toISOString(),
        complete: !run.error_code,
        provider_records: run.provider_records ?? 0,
        stored_in_latest_version: run.stored_in_latest_version ?? 0,
        applied_changes: run.applied_changes ?? 0,
        missing_before: run.missing_before ?? 0,
        stale_before: run.stale_before ?? 0,
        provisional_after_horizon: run.provisional_after_horizon ?? 0,
        quarantined: run.quarantined ?? 0,
        consecutive_drift_runs: sweep?.consecutive_drift_runs ?? 0,
      }
    : null;
  return {
    quarantined_count: quarantined.length,
    oldest_quarantined_at: oldest ? oldest.toISOString() : null,
    sync_mode: syncMode,
    last_sweep,
  };
}

export async function readCallLogRows() {
  const rows = (await getSalesIntelligenceSyncStateModel()
    .find(
      { scope: { $in: [CALL_LOG_ALL_DIRECTIONS_SCOPE, CALL_LOG_SWEEP_SCOPE] } },
      { scope: 1, quarantined_records: 1, consecutive_drift_runs: 1, last_run: 1, known_complete_through: 1 },
    )
    .lean()) as unknown as CaptureHealthRow[];
  return {
    reconcile: rows.find((row) => row.scope === CALL_LOG_ALL_DIRECTIONS_SCOPE) ?? null,
    sweep: rows.find((row) => row.scope === CALL_LOG_SWEEP_SCOPE) ?? null,
  };
}

// ---------------------------------------------------------------------------
// S5c-HEALTH (G6): `capture_health`
// ---------------------------------------------------------------------------

type CaptureHealth = NonNullable<OwnerCoverageDto["capture_health"]>;
export type CaptureHealthReason = CaptureHealth["reasons"][number];

const MINUTE = 60_000;
/** In-progress calls are counted when they started at most 4 h ago (G3 uses the same bound). */
export const IN_PROGRESS_WINDOW_MS = 4 * 60 * MINUTE;
/** A `terminal: false` call that started more than 10 min ago is pending finalization (addendum §3.4). */
export const PENDING_FINALIZATION_AFTER_MS = 10 * MINUTE;
/** No receipt for this many staffed minutes while the Call Log shows calls in them → `degraded`. */
export const WEBHOOK_SILENCE_STAFFED_MINUTES = 30;
export const QUARANTINE_BROKEN_AFTER_MS = 24 * 60 * MINUTE;
/**
 * The daily subscription cron (06:15 UTC) stores every run's outcome on the
 * `webhook_subscription_maintenance` sync-state row (`webhookSubscriptionCron.ts`).
 * A failure counts only while it is the newest outcome and is at most 26 h old
 * (one cron period plus slack); the next successful run clears it.
 */
export const RENEWAL_ERROR_LOOKBACK_MS = 26 * 60 * MINUTE;
/** The all-direction telephony filter the owned subscription carries (`buildRingCentralTelephonyEventFilters("all")`). */
const ALL_DIRECTION_FILTER = "/restapi/v1.0/account/~/telephony/sessions";
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["blacklisted", "suspended", "deleted"]);

export type OwnedSubscriptionRow = {
  subscriptionId: string;
  status?: string | null;
  expirationTime?: Date | null;
  updatedAt?: Date | null;
  eventFilters?: string[] | null;
};

/** The newest maintenance run: `error_code` null (succeeded), `subscription_missing`, or a failure's error class name. */
export type RenewalOutcome = { finished_at: Date; error_code: string | null };

export type CaptureHealthFacts = {
  now: Date;
  webhook_enabled: boolean;
  staffing: Staffing;
  sync_mode: "off" | "shadow" | "on";
  reconcile: CaptureHealthRow | null;
  sweep: CaptureHealthRow | null;
  subscriptions: OwnedSubscriptionRow[];
  latest_receipt_at: Date | null;
  receipts_1h: number;
  renewal_outcome: RenewalOutcome | null;
  /** Call Log calls (`call_log_state` set) that started in the last 30 staffed minutes. */
  call_log_calls_in_window: number;
  in_progress_calls: number;
  pending_finalization: number;
};

/** Last 6 characters (4 for short ids); never the full provider id. */
export function subscriptionIdSuffix(id: string | null | undefined): string | null {
  const value = id?.trim();
  if (!value || value.length <= 4) return null;
  return value.slice(value.length >= 10 ? -6 : -4);
}

const isTerminalStatus = (status: string | null | undefined) =>
  TERMINAL_SUBSCRIPTION_STATUSES.has(status?.trim().toLowerCase() ?? "");

/** The owned all-direction subscription this read reports on: live rows first, then the latest expiry. */
/**
 * RingCentral stores the filter with the account id resolved (`/account/62948571023/…`), not `~`, so the
 * all-direction filter is matched with the account segment normalized (production 2026-09-24).
 */
export const isAllDirectionFilter = (filter: string) => filter.trim().replace(/^\/restapi\/v1\.0\/account\/[^/]+\//, "/restapi/v1.0/account/~/") === ALL_DIRECTION_FILTER;
export function pickOwnedSubscription(rows: OwnedSubscriptionRow[]): OwnedSubscriptionRow | null {
  const candidates = rows.filter((row) => (row.eventFilters ?? []).some(isAllDirectionFilter));
  const expiry = (row: OwnedSubscriptionRow) => row.expirationTime?.getTime() ?? Number.POSITIVE_INFINITY;
  return [...candidates].sort(
    (a, b) => Number(isTerminalStatus(a.status)) - Number(isTerminalStatus(b.status)) || expiry(b) - expiry(a),
  )[0] ?? null;
}

/** The start of the webhook silence window: 30 staffed minutes before `now` (`now` when no hours are staffed). */
export function webhookSilenceWindowStart(now: Date, staffing: Staffing): Date {
  if (!staffing.staffed_hours.length) return new Date(+now);
  return subtractStaffedMinutes(now, WEBHOOK_SILENCE_STAFFED_MINUTES, staffing);
}

/**
 * Pure: the `capture_health` block from the facts one read gathers. `webhook`
 * and `status` follow reconciliation addendum §3.4; the reason keys are listed
 * on the schema in `dto.ts`.
 */
export function composeCaptureHealth(facts: CaptureHealthFacts): CaptureHealth {
  const { now } = facts;
  const capture = composeCallLogCapture(facts.reconcile, facts.sweep, facts.sync_mode);
  const lastRun = facts.reconcile?.last_run;
  const lastReconcile = lastRun?.finished_at ?? lastRun?.started_at ?? null;
  // The sweep stores what it measured wrong (`missing_before` + `stale_before`)
  // and what it wrote (`applied_changes`); the calls it added or corrected are
  // the measured drift it actually applied. No new sweep write is needed.
  const sweep = capture.last_sweep
    ? {
        ...capture.last_sweep,
        recovered_calls: Math.min(
          capture.last_sweep.applied_changes,
          capture.last_sweep.missing_before + capture.last_sweep.stale_before,
        ),
      }
    : null;

  const subscription = facts.webhook_enabled ? pickOwnedSubscription(facts.subscriptions) : null;
  const outcome = facts.webhook_enabled ? facts.renewal_outcome : null;
  const lastRenewalError = outcome?.error_code && now.getTime() - outcome.finished_at.getTime() <= RENEWAL_ERROR_LOOKBACK_MS
    ? outcome.error_code
    : null;

  // A `subscription_missing` outcome means the renewal cron didn't recognise an owned subscription. When this read
  // finds a live, unexpired owned subscription it isn't a failure (production 2026-09-24: the cron's exact
  // filter match misses the account-resolved filter); it stays visible as `last_renewal_error`. A failed run is down.
  const renewalFailed = lastRenewalError !== null && lastRenewalError !== SUBSCRIPTION_MISSING_CODE;
  let state: CaptureHealth["webhook"]["state"];
  if (!facts.webhook_enabled) state = "off";
  else if (
    !subscription ||
    isTerminalStatus(subscription.status) ||
    (subscription.expirationTime && subscription.expirationTime <= now) ||
    renewalFailed
  ) state = "down";
  else if (
    facts.call_log_calls_in_window > 0 &&
    (!facts.latest_receipt_at ||
      staffedMinutesAtLeast(facts.latest_receipt_at, now, WEBHOOK_SILENCE_STAFFED_MINUTES, facts.staffing))
  ) state = "degraded";
  else state = "healthy";

  const oldestQuarantine = capture.oldest_quarantined_at ? new Date(capture.oldest_quarantined_at) : null;
  const quarantineOver24h = Boolean(
    oldestQuarantine && now.getTime() - oldestQuarantine.getTime() > QUARANTINE_BROKEN_AFTER_MS,
  );
  const reasons: CaptureHealthReason[] = [];
  if (state === "down") reasons.push("webhook_down");
  if (quarantineOver24h) reasons.push("quarantine_over_24h");
  if (state === "degraded") reasons.push("webhook_degraded");
  if (capture.quarantined_count > 0 && !quarantineOver24h) reasons.push("quarantine");
  if (facts.pending_finalization > 0) reasons.push("pending_finalization");
  const status: CaptureHealth["status"] =
    state === "down" || quarantineOver24h ? "broken" : reasons.length ? "attention" : "ok";

  const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);
  return {
    as_of: now.toISOString(),
    status,
    reasons,
    known_complete_through: iso(facts.reconcile?.known_complete_through),
    call_log: {
      sync_mode: capture.sync_mode,
      last_reconcile_at: iso(lastReconcile),
      quarantined_count: capture.quarantined_count,
      oldest_quarantined_at: capture.oldest_quarantined_at,
      last_sweep: sweep,
    },
    webhook: {
      state,
      subscription_id_suffix: subscriptionIdSuffix(subscription?.subscriptionId),
      subscription_expires_at: iso(subscription?.expirationTime),
      last_receipt_at: facts.webhook_enabled ? iso(facts.latest_receipt_at) : null,
      receipts_1h: facts.webhook_enabled ? facts.receipts_1h : 0,
      last_renewal_at: iso(subscription?.updatedAt),
      last_renewal_error: lastRenewalError,
    },
    in_progress_calls: facts.in_progress_calls,
    pending_finalization: facts.pending_finalization,
  };
}

function rawCollection(name: string) {
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db;
  if (!db) throw new Error("Database is not connected");
  return db.collection(name);
}

/**
 * The query shapes behind `capture_health`, exported so the replica proof
 * explains exactly what the read runs. Every range is bounded above by `now`,
 * so a read at a fixed `as_of` ignores later rows.
 */
export function captureHealthQueries(now: Date, staffing: Staffing) {
  const inProgressFrom = new Date(now.getTime() - IN_PROGRESS_WINDOW_MS);
  const pendingBefore = new Date(now.getTime() - PENDING_FINALIZATION_AFTER_MS);
  const windowFrom = webhookSilenceWindowStart(now, staffing);
  const callLogStates = ["provisional", "settled"];
  // Merged rows are excluded in `$group`, not `$match`: a top-level
  // `merged_into_id: null` lets the planner pick `call_interaction_discovery_state`
  // (every unmerged row) instead of the two bounded `$or` branches.
  const unmerged = { $eq: [{ $ifNull: ["$merged_into_id", null] }, null] };
  return {
    window_from: windowFrom,
    // `subscriptionId_1` (unique) serves the scan; the store holds a handful of rows.
    subscriptions: { subscriptionId: { $type: "string" }, provider: "ringcentral" },
    latest_receipt: { provider: "ringcentral", receivedAt: { $lte: now } },
    receipts_1h: { provider: "ringcentral", receivedAt: { $gte: new Date(now.getTime() - 60 * MINUTE), $lte: now } },
    renewal_outcome: { scope: WEBHOOK_SUBSCRIPTION_SCOPE },
    calls_pipeline: [
      {
        $match: {
          $or: [
            { terminal: false, started_at: { $gte: inProgressFrom, $lte: now } },
            { call_log_state: { $in: callLogStates }, started_at: { $gte: windowFrom, $lte: now } },
          ],
        },
      },
      {
        $group: {
          _id: null,
          in_progress: {
            $sum: { $cond: [{ $and: [unmerged, { $eq: ["$terminal", false] }, { $gte: ["$started_at", inProgressFrom] }] }, 1, 0] },
          },
          pending: {
            $sum: {
              $cond: [
                { $and: [unmerged, { $eq: ["$terminal", false] }, { $gte: ["$started_at", inProgressFrom] }, { $lt: ["$started_at", pendingBefore] }] },
                1,
                0,
              ],
            },
          },
          window_calls: {
            $sum: {
              $cond: [{ $and: [unmerged, { $in: ["$call_log_state", callLogStates] }, { $gte: ["$started_at", windowFrom] }] }, 1, 0],
            },
          },
        },
      },
    ] as PipelineStage[],
  };
}

/**
 * The indexed reads behind `capture_health`, all in parallel. The Call Log
 * sync-state rows are shared with `call_log_capture`, so this adds at most
 * five: the owned subscription rows, the newest receipt and the last hour's
 * receipt count (`provider_1_receivedAt_-1`), the newest subscription cron
 * outcome (the `webhook_subscription_maintenance` sync-state row), and one `call_interactions`
 * aggregate whose `$or` branches use `call_interaction_started_window` and
 * `call_interaction_call_log_state_started`. With the webhook flag off only
 * the aggregate runs. Reads only: no index is created on this path, and
 * neither the full subscription id nor its `raw` body leaves this function.
 */
export async function readCaptureHealthFacts(input: {
  now: Date;
  staffing: Staffing;
  reconcile: CaptureHealthRow | null;
  sweep: CaptureHealthRow | null;
}): Promise<CaptureHealthFacts> {
  const { now } = input;
  const webhookEnabled = csiFlag("CAPTURE_WEBHOOK");
  const q = captureHealthQueries(now, input.staffing);
  const receipts = () => rawCollection(getRingCentralCollectionName("webhookEvents"));
  const [subscriptions, latest, receipts1h, renewal, calls] = await Promise.all([
    webhookEnabled
      ? (rawCollection("ringcentral_webhook_subscriptions")
          .find(q.subscriptions, {
            projection: { _id: 0, subscriptionId: 1, status: 1, expirationTime: 1, updatedAt: 1, eventFilters: 1 },
          })
          .limit(50)
          .toArray() as unknown as Promise<OwnedSubscriptionRow[]>)
      : Promise.resolve([] as OwnedSubscriptionRow[]),
    webhookEnabled
      ? receipts().findOne(q.latest_receipt, { sort: { receivedAt: -1 }, projection: { _id: 0, receivedAt: 1 } })
      : Promise.resolve(null),
    webhookEnabled ? receipts().countDocuments(q.receipts_1h) : Promise.resolve(0),
    webhookEnabled
      ? getSalesIntelligenceSyncStateModel().findOne(q.renewal_outcome, { last_run: 1 }).lean()
      : Promise.resolve(null),
    getCallInteractionModel().aggregate<{ in_progress: number; pending: number; window_calls: number }>(q.calls_pipeline),
  ]);
  const lastRun = (renewal as { last_run?: { finished_at?: Date | null; error_code?: string | null } | null } | null)?.last_run ?? null;
  return {
    now,
    webhook_enabled: webhookEnabled,
    staffing: input.staffing,
    sync_mode: callLogReconcileConfig().syncMode,
    reconcile: input.reconcile,
    sweep: input.sweep,
    subscriptions,
    latest_receipt_at: (latest?.receivedAt as Date | undefined) ?? null,
    receipts_1h: receipts1h,
    renewal_outcome: lastRun?.finished_at ? { finished_at: lastRun.finished_at, error_code: lastRun.error_code ?? null } : null,
    call_log_calls_in_window: calls[0]?.window_calls ?? 0,
    in_progress_calls: calls[0]?.in_progress ?? 0,
    pending_finalization: calls[0]?.pending ?? 0,
  };
}

export async function readOwnerCoverage(): Promise<OwnerCoverageDto> {
  const [capture, policy] = await Promise.all([readCaptureCoverage(), resolvePolicy()]);
  const now = new Date();
  const staffing: Staffing = { timezone: policy.timezone, staffed_hours: policy.staffed_hours };
  const callLogRows = readCallLogRows();
  const [mapping, callLogCapture, captureHealth] = await Promise.all([
    readMappingHygiene(),
    callLogRows.then(({ reconcile, sweep }) => composeCallLogCapture(reconcile, sweep, callLogReconcileConfig().syncMode)),
    callLogRows
      .then(({ reconcile, sweep }) => readCaptureHealthFacts({ now, staffing, reconcile, sweep }))
      .then(composeCaptureHealth),
  ]);
  return ownerCoverageDtoSchema.parse({
    ...capture,
    mapping_hygiene: mapping,
    call_log_capture: callLogCapture,
    capture_health: captureHealth,
  });
}
