import { randomBytes } from "node:crypto";
import { csiBackfillDays, csiFlag } from "../../../config/domain/salesIntelligence";
import { withTransaction } from "../../../db";
import { getSalesIntelligenceSyncWindowModel } from "../../../models/SalesIntelligenceSyncWindow";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { MongoLeaseStore } from "../../durableWork/leases";
import type { LeaseToken } from "../../durableWork/types";
import {
  BACKFILL_LEASE_SCOPE,
  projectCallLogBackfillPage,
  syncStateLeaseModel,
} from "../../numberActivity/reconcileCallLog";
import type { CallLogPageFetcher } from "../../numberActivity/callLogClient";
import type { applyInteractionObservation } from "../../numberActivity/persistInteraction";
import type { DirectoryLookup } from "../../numberActivity/directory";
import { enqueueBackfillActivation } from "./worker";
import { CALL_LOG_BACKFILL_STREAM } from "./windows";
import { backfillYieldToLiveWork } from "./livePriority";
import {
  claimWindowWork,
  commitWindowPage,
  markWindowFailed,
  markWindowRetryableFailure,
  markWindowThrottle,
  pauseWindowPermission,
  releaseWindowWork,
  renewWindowWork,
  type WindowWorkLease,
} from "./windowWork";

const MAX_WINDOW_ATTEMPTS = 8;

export type BackfillStepSummary = {
  skipped: boolean;
  skip_reason: "disabled" | "lease_held" | "live_priority" | "idle" | "retry_after" | null;
  window_from: string | null;
  window_to: string | null;
  status: string | null;
  page: number | null;
  last_page: boolean;
  records: number;
  upserts: number;
  throttled: boolean;
  error_code: string | null;
};

export type BackfillStepDeps = {
  now?: () => Date;
  fetchPage?: CallLogPageFetcher;
  apply?: typeof applyInteractionObservation;
  directory?: (accountId: string) => Promise<DirectoryLookup>;
  leaseTtlMs?: number;
  perPage?: number;
  configuredAccountId?: string | null;
  resolveRoute?: import("../../numberActivity/types").RouteResolver;
};

export async function runBackfillStepOnce(deps: BackfillStepDeps = {}): Promise<BackfillStepSummary> {
  const now = deps.now ?? (() => new Date());
  const started = now();
  const summary: BackfillStepSummary = {
    skipped: false,
    skip_reason: null,
    window_from: null,
    window_to: null,
    status: null,
    page: null,
    last_page: false,
    records: 0,
    upserts: 0,
    throttled: false,
    error_code: null,
  };
  if (!csiFlag("ENABLED") || csiBackfillDays() <= 0) {
    summary.skipped = true;
    summary.skip_reason = "disabled";
    return summary;
  }
  if (await backfillYieldToLiveWork(started)) {
    summary.skipped = true;
    summary.skip_reason = "live_priority";
    return summary;
  }
  const leases = new MongoLeaseStore(syncStateLeaseModel());
  const scopeOwner = `csi-backfill:${randomBytes(8).toString("hex")}`;
  const token = await leases.acquire({
    scope: BACKFILL_LEASE_SCOPE,
    owner: scopeOwner,
    ttl_ms: deps.leaseTtlMs ?? 300_000,
    now: started,
  });
  if (!token) {
    summary.skipped = true;
    summary.skip_reason = "lease_held";
    return summary;
  }
  let scopeLease: LeaseToken = token;
  const Window = getSalesIntelligenceSyncWindowModel();
  let windowLease: WindowWorkLease | null = null;
  try {
    const window = await Window.findOne({
      stream: CALL_LOG_BACKFILL_STREAM,
      permission_paused: { $ne: true },
      status: { $in: ["planned", "partial", "running"] },
      $or: [{ retry_after_until: null }, { retry_after_until: { $lte: started } }],
    })
      .sort({ window_from: 1, _id: 1 })
      .lean();
    if (!window) {
      summary.skipped = true;
      summary.skip_reason = "idle";
      return summary;
    }
    if (window.retry_after_until && window.retry_after_until > started) {
      summary.skipped = true;
      summary.skip_reason = "retry_after";
      return summary;
    }
    summary.window_from = window.window_from.toISOString();
    summary.window_to = window.window_to.toISOString();
    const page = (window.checkpoint_page ?? 0) + 1;
    summary.page = page;
    const workOwner = `${scopeOwner}:window`;
    windowLease = await claimWindowWork({
      window_id: String(window._id),
      owner: workOwner,
      ttl_ms: deps.leaseTtlMs ?? 300_000,
      now: started,
      checkpoint_page: window.checkpoint_page ?? 0,
    });
    if (!windowLease) {
      summary.skipped = true;
      summary.skip_reason = "lease_held";
      return summary;
    }
    const renewedScope = await leases.renew({
      token: scopeLease,
      ttl_ms: deps.leaseTtlMs ?? 300_000,
      now: now(),
    });
    if (!renewedScope) {
      summary.skipped = true;
      summary.skip_reason = "lease_held";
      summary.error_code = "lease_lost";
      return summary;
    }
    scopeLease = renewedScope;
    if (!(await renewWindowWork(windowLease, deps.leaseTtlMs ?? 300_000, now()))) {
      summary.skipped = true;
      summary.skip_reason = "lease_held";
      summary.error_code = "lease_lost";
      return summary;
    }
    const pageResult = await projectCallLogBackfillPage({
      from: window.window_from,
      to: window.window_to,
      page,
      request_id: randomBytes(12).toString("hex"),
      now,
      fetchPage: deps.fetchPage,
      apply: deps.apply,
      directory: deps.directory,
      perPage: deps.perPage,
      configuredAccountId: deps.configuredAccountId,
      resolveRoute: deps.resolveRoute,
    });
    summary.records = pageResult.records;
    summary.upserts = pageResult.upserts;
    summary.last_page = pageResult.last_page;
    summary.throttled = pageResult.throttled;
    summary.error_code = pageResult.error_code;
    const finished = now();
    if (pageResult.throttled) {
      const delay = Math.max(pageResult.retry_after_ms ?? 60_000, 1_000);
      const retry_after_until = new Date(finished.getTime() + delay);
      const ok = await markWindowThrottle(windowLease, finished, retry_after_until);
      summary.status = ok ? "partial" : null;
      if (!ok) summary.error_code = "lease_lost";
      return summary;
    }
    if (pageResult.error_code === "provider_permission_denied") {
      const paused = await pauseWindowPermission(windowLease, finished);
      summary.status = paused.modifiedCount ? "partial" : null;
      if (!paused.modifiedCount) summary.error_code = "lease_lost";
      return summary;
    }
    const pageOk = !pageResult.error_code;
    if (!pageOk) {
      const attempts = (window.attempts ?? 0) + 1;
      if (attempts >= MAX_WINDOW_ATTEMPTS) {
        const saved = await markWindowFailed(windowLease, finished, pageResult.error_code!);
        summary.status = saved ? "failed" : null;
        if (!saved) summary.error_code = "lease_lost";
        return summary;
      }
      const backoff = Math.min(21_600_000, 30_000 * 2 ** (attempts - 1));
      const retry_after_until = new Date(finished.getTime() + backoff);
      const saved = await markWindowRetryableFailure(windowLease, finished, pageResult.error_code!, retry_after_until);
      summary.status = saved ? "partial" : null;
      if (!saved) summary.error_code = "lease_lost";
      return summary;
    }
    const captureComplete = pageResult.last_page;
    const activeLease = windowLease;
    const committed = await withTransaction(async session => {
      const saved = await commitWindowPage(activeLease, now(), {
      checkpoint_page: page,
      records: pageResult.records,
      status: captureComplete ? "complete" : "partial",
      last_error_code: null,
      ...(captureComplete ? { completed_at: finished, activation_status: "pending" } : {}),
      }, session);
      if (saved && captureComplete) {
        await getSalesIntelligenceSyncStateModel().updateOne({ scope: "backfill:call_log" },
          { $max: { known_complete_through: window.window_to } }, { upsert: true, session });
        await enqueueBackfillActivation(String(window._id), session, finished);
      }
      return saved;
    });
    if (!committed) {
      summary.error_code = "lease_lost";
      return summary;
    }
    summary.status = captureComplete ? "complete" : "partial";
    return summary;
  } finally {
    if (windowLease) await releaseWindowWork(windowLease, now()).catch(() => undefined);
    await leases.release({ token: scopeLease, now: now() }).catch(() => undefined);
  }
}
