import { randomBytes } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { send as queueSend } from "@vercel/queue";
import { logger } from "../../logger";
import { getCallInteractionModel } from "../../models/CallInteraction";
import { getSalesIntelligenceJobModel } from "../../models/SalesIntelligenceJob";
import { recordOperationalEvent } from "../observability";
import { ringCentralRequest } from "../ringcentral/client";
import { csiWorkerActor, CsiError } from "../salesIntelligence/auth";
import {
  claimCsiJob,
  completeCsiJob,
  enqueueCsiJob,
  failCsiJob,
  type JobLease,
} from "../salesIntelligence/jobs";
import { appendCsiAudit } from "../salesIntelligence/transactions";
import {
  accountIdFromProviderPath,
  configuredRingCentralAccountId,
  ProviderAccountError,
  resolveProviderAccountId,
} from "./accountIdentity";
import { isProviderThrottle, throttleRetryAfterMs } from "./callLogClient";
import { loadDirectoryLookup, type DirectoryLookup } from "./directory";
import { callLogReconcileConfig } from "./reconcileCallLog";
import { TERMINAL_PARTY_STATUSES, type CallLogRecordInput } from "./interactionProjection";
import {
  applyInteractionObservation,
  defaultRouteResolver,
  InteractionPersistenceError,
  type ApplyResult,
} from "./persistInteraction";
import type { RouteResolver, WebhookPartyObservation } from "./types";
import {
  salesIntelligenceQueueTopic,
  shouldPublishSalesIntelligenceQueue,
} from "./webhookFanout";

/**
 * CC-08 targeted Call Log re-read (`call_log_refresh`).
 *
 * When a capture-projection job sees a telephony session hang up (the
 * delivery carries a terminal party status and every account party of the
 * stored session is terminal), it enqueues one refresh for that session,
 * due 90 s later (p99 provider Call Log lag is 1.2 min). The refresh reads
 * `GET /account/~/call-log?telephonySessionId=…&view=Detailed&dateFrom=…`
 * and applies each record through `applyInteractionObservation` exactly like
 * the reconcile does, so final duration, recordings and direction land about
 * two minutes after hang-up instead of on the next reconcile window.
 *
 * Webhook projection never settles a row; only the Call Log record applied
 * here (or by the reconcile) does. A session whose record is not published
 * after the retry schedule completes with `state: "not_published"`; the
 * reconcile window covers it. One refresh per session (`...:1` dedupe key).
 */
export const CALL_LOG_REFRESH_STAGE = "call_log_refresh" as const;
/** Due time after hang-up (p99 provider Call Log lag 1.2 min). */
export const CALL_LOG_REFRESH_DELAY_MS = 90_000;
/** Waits after an attempt that found no record: 2, 5, then 15 minutes; the next empty attempt gives up. */
export const CALL_LOG_REFRESH_RETRY_DELAYS_MS = Object.freeze([2 * 60_000, 5 * 60_000, 15 * 60_000]);
/** `dateFrom` reaches this far before the stored session start. */
export const CALL_LOG_REFRESH_LOOKBACK_MS = 60 * 60_000;
const TERMINAL = new Set<string>(TERMINAL_PARTY_STATUSES);

export function callLogRefreshDedupeKey(telephonySessionId: string): string {
  return `csi:call_log_refresh:session:${telephonySessionId}:1`;
}

const SUBJECT_PREFIX = "telephony_session:";

export function callLogRefreshSubjectKey(telephonySessionId: string): string {
  return `${SUBJECT_PREFIX}${telephonySessionId}`;
}

export function telephonySessionFromSubjectKey(subjectKey: string | null | undefined): string | null {
  if (!subjectKey?.startsWith(SUBJECT_PREFIX)) return null;
  const id = subjectKey.slice(SUBJECT_PREFIX.length).trim();
  return id || null;
}

// ---------------------------------------------------------------------------
// Provider read
// ---------------------------------------------------------------------------

export type SessionCallLogFetcher = (input: { telephonySessionId: string; dateFrom: Date }) => Promise<CallLogRecordInput[]>;

/** Detailed Call Log records of one telephony session (GET only). Records naming another session are dropped. */
export async function fetchCallLogRecordsBySession(
  input: { telephonySessionId: string; dateFrom: Date },
  request: typeof ringCentralRequest = ringCentralRequest,
): Promise<CallLogRecordInput[]> {
  const query = new URLSearchParams({
    telephonySessionId: input.telephonySessionId,
    view: "Detailed",
    dateFrom: input.dateFrom.toISOString(),
  });
  const payload = (await request("GET", `/restapi/v1.0/account/~/call-log?${query.toString()}`)) as
    | { records?: unknown }
    | null;
  const records = Array.isArray(payload?.records) ? payload.records : [];
  return records.filter(
    (r): r is CallLogRecordInput =>
      typeof r === "object" &&
      r !== null &&
      !Array.isArray(r) &&
      (typeof (r as { telephonySessionId?: unknown }).telephonySessionId !== "string" ||
        (r as { telephonySessionId: string }).telephonySessionId === input.telephonySessionId),
  );
}

// ---------------------------------------------------------------------------
// Trigger (capture-projection side)
// ---------------------------------------------------------------------------

export type StoredSessionState = {
  telephony_session_id: string | null;
  started_at: Date | null;
  provider_account_id: string | null;
  account_parties_terminal: boolean;
};

/** Reads the stored interaction (following one merge hop). Read-only. */
export async function loadStoredSessionState(interactionId: string): Promise<StoredSessionState | null> {
  if (!mongoose.Types.ObjectId.isValid(interactionId)) return null;
  const Interaction = getCallInteractionModel();
  const projection = { telephony_session_id: 1, started_at: 1, provider_account_id: 1, parties: 1, merged_into_id: 1 };
  let row = await Interaction.findById(interactionId, projection).lean();
  if (row?.merged_into_id) row = (await Interaction.findById(row.merged_into_id, projection).lean()) ?? row;
  if (!row) return null;
  const parties = ((row.parties ?? []) as Array<{ role?: string | null; terminal_at?: Date | null }>).filter(
    (p) => p.role !== "external",
  );
  return {
    telephony_session_id: row.telephony_session_id ?? null,
    started_at: row.started_at ?? null,
    provider_account_id: row.provider_account_id ?? null,
    account_parties_terminal: parties.length > 0 && parties.every((p) => p.terminal_at != null),
  };
}

/** True when this delivery carries a terminal party status for the session (the hang-up signal). */
export function deliveryCarriesTerminalStatus(
  events: readonly Pick<WebhookPartyObservation, "telephony_session_id" | "status_code">[],
  telephonySessionId: string,
): boolean {
  return events.some(
    (e) => e.telephony_session_id === telephonySessionId && e.status_code !== null && TERMINAL.has(e.status_code),
  );
}

export type RefreshCandidate = { telephony_session_id: string; interaction_id: string };

/**
 * Sessions of one capture-projection delivery that hung up: the delivery
 * carries a terminal status for the session AND the projection shows every
 * account party terminal (`newly_terminal`, or the stored row's parties all
 * carry `terminal_at`, the same rule `fromWebhookParties` uses).
 */
export async function sessionsNeedingRefresh(
  observations: readonly WebhookPartyObservation[],
  results: ReadonlyArray<{ telephony_session_id: string; ok: boolean; result?: ApplyResult }>,
  loadState: (interactionId: string) => Promise<StoredSessionState | null> = loadStoredSessionState,
): Promise<RefreshCandidate[]> {
  const out: RefreshCandidate[] = [];
  for (const r of results) {
    if (!r.ok || !r.result) continue;
    if (!deliveryCarriesTerminalStatus(observations, r.telephony_session_id)) continue;
    const terminal = r.result.newly_terminal || (await loadState(r.result.interaction_id))?.account_parties_terminal === true;
    if (terminal) out.push({ telephony_session_id: r.telephony_session_id, interaction_id: r.result.interaction_id });
  }
  return out;
}

/** Enqueues the one refresh for a session inside the caller's transaction, due `now + 90 s`. */
export async function enqueueCallLogRefreshJob(
  candidate: RefreshCandidate,
  session: ClientSession,
  now: Date,
  enqueue: typeof enqueueCsiJob = enqueueCsiJob,
): Promise<{ job_id: string; created: boolean; due_at: Date }> {
  const dueAt = new Date(now.getTime() + CALL_LOG_REFRESH_DELAY_MS);
  const dedupe_key = callLogRefreshDedupeKey(candidate.telephony_session_id);
  const prior = await getSalesIntelligenceJobModel()
    .findOne({ dedupe_key }, { _id: 1, next_attempt_at: 1 })
    .session(session)
    .lean();
  // One refresh per session: a later hang-up delivery (possibly naming a
  // merged interaction) never re-enqueues or conflicts with the first.
  if (prior) return { job_id: String(prior._id), created: false, due_at: prior.next_attempt_at ?? dueAt };
  const row = await enqueue(
    {
      dedupe_key,
      stage: CALL_LOG_REFRESH_STAGE,
      subject_key: callLogRefreshSubjectKey(candidate.telephony_session_id),
      input_revision: 1,
      input_refs: [candidate.interaction_id],
      priority: 10,
    },
    session,
    dueAt,
  );
  return { job_id: String(row._id), created: true, due_at: dueAt };
}

export type DelayedPublishDeps = {
  shouldPublish?: () => boolean;
  send?: (topic: string, payload: { job_id: string }, options: { delaySeconds: number }) => Promise<unknown>;
};

/** Post-commit, best-effort wake-up delivered when the job becomes due. Cron recovery covers a lost message. */
export async function publishDelayedWakeup(
  jobId: string,
  dueAt: Date,
  now: Date,
  deps: DelayedPublishDeps = {},
): Promise<boolean> {
  if (!(deps.shouldPublish ?? shouldPublishSalesIntelligenceQueue)()) return false;
  const delaySeconds = Math.max(0, Math.min(604_800, Math.ceil((dueAt.getTime() - now.getTime()) / 1000)));
  try {
    await (deps.send ?? queueSend)(salesIntelligenceQueueTopic(), { job_id: jobId }, { delaySeconds });
    return true;
  } catch (error) {
    logger.warn({
      msg: "sales_intelligence.call_log_refresh.publish_failed",
      jobId,
      errorName: error instanceof Error ? error.name : "Error",
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Consumer
// ---------------------------------------------------------------------------

export type CallLogRefreshResult = {
  telephony_session_id: string | null;
  state: "applied" | "not_published" | "failed";
  attempt: number;
  records: number;
  applied: Array<{
    call_log_id: string | null;
    interaction_id: string;
    noop: boolean;
    created: boolean;
  }>;
  error_code: string | null;
};

export type CallLogRefreshOutcome =
  | { status: "not_claimable"; job_id: string | null }
  | { status: "completed"; job_id: string; result: CallLogRefreshResult }
  | { status: "retry"; job_id: string; reason: "not_published" | "throttled" | "transient"; next_attempt_at: Date; result: CallLogRefreshResult }
  | { status: "lease_lost"; job_id: string };

export type CallLogRefreshDeps = {
  now?: () => Date;
  owner?: string;
  ttlMs?: number;
  claim?: typeof claimCsiJob;
  complete?: typeof completeCsiJob;
  fail?: typeof failCsiJob;
  fetch?: SessionCallLogFetcher;
  loadState?: (interactionId: string) => Promise<StoredSessionState | null>;
  apply?: typeof applyInteractionObservation;
  directory?: (accountId: string) => Promise<DirectoryLookup>;
  resolveRoute?: RouteResolver;
  configuredAccountId?: string | null;
  recordEvent?: typeof recordOperationalEvent;
  publish?: DelayedPublishDeps;
};

const DETERMINISTIC_APPLY_CODES = new Set(["identity_missing", "projection_failed", "account_mismatch"]);

export async function runCallLogRefreshJob(
  jobId: string | undefined,
  deps: CallLogRefreshDeps = {},
): Promise<CallLogRefreshOutcome> {
  const owner = deps.owner ?? `csi-call-log-refresh:${randomBytes(8).toString("hex")}`;
  const now = deps.now ?? (() => new Date());
  const claim = deps.claim ?? claimCsiJob;
  const complete = deps.complete ?? completeCsiJob;
  const fail = deps.fail ?? failCsiJob;
  const recordEvent = deps.recordEvent ?? recordOperationalEvent;

  if (jobId !== undefined && !mongoose.Types.ObjectId.isValid(jobId)) return { status: "not_claimable", job_id: jobId };
  const row = await claim(owner, jobId, deps.ttlMs ?? 120_000, CALL_LOG_REFRESH_STAGE);
  if (!row) return { status: "not_claimable", job_id: jobId ?? null };
  const lease: JobLease = { job_id: String(row._id), owner, epoch: row.lease_epoch };
  const attempt = Math.max(1, Number(row.attempts) || 1);
  const telephonySessionId = telephonySessionFromSubjectKey(row.subject_key);
  const result: CallLogRefreshResult = {
    telephony_session_id: telephonySessionId,
    state: "failed",
    attempt,
    records: 0,
    applied: [],
    error_code: null,
  };

  const finish = async (): Promise<CallLogRefreshOutcome> => {
    const at = now();
    await complete(
      lease,
      async (session) => {
        await appendCsiAudit(
          { session, command_id: new mongoose.Types.ObjectId(), now: at, actor: csiWorkerActor(lease.job_id) },
          {
            subject_key: `job:${lease.job_id}`,
            event_kind: "call_log_refresh.completed",
            prior: { status: "leased", lease_epoch: lease.epoch },
            current: { status: "completed", ...result },
            target_id: lease.job_id,
            revision: lease.epoch,
            kind: "job",
          },
        );
      },
      { result },
    );
    return { status: "completed", job_id: lease.job_id, result };
  };

  const retry = async (
    reason: "not_published" | "throttled" | "transient",
    resumeAt: Date | undefined,
    retryAfterMs = 0,
  ): Promise<CallLogRefreshOutcome> => {
    const failed = await fail(lease, reason === "throttled" ? "throttled" : "transient", retryAfterMs, {
      result,
      ...(resumeAt ? { resumeAt } : {}),
    });
    if (failed.status === "retry") {
      await publishDelayedWakeup(lease.job_id, failed.next_attempt_at, now(), deps.publish);
    }
    return { status: "retry", job_id: lease.job_id, reason, next_attempt_at: failed.next_attempt_at, result };
  };

  try {
    if (!telephonySessionId) {
      result.error_code = "session_missing";
      return await finish();
    }
    const interactionRef = row.input_refs?.[0] ? String(row.input_refs[0]) : null;
    const state = interactionRef ? await (deps.loadState ?? loadStoredSessionState)(interactionRef) : null;
    const startedAt = state?.started_at ?? new Date(now().getTime() - 24 * 60 * 60_000);
    const dateFrom = new Date(startedAt.getTime() - CALL_LOG_REFRESH_LOOKBACK_MS);

    let records: CallLogRecordInput[];
    try {
      records = await (deps.fetch ?? fetchCallLogRecordsBySession)({ telephonySessionId, dateFrom });
    } catch (error) {
      if (isProviderThrottle(error)) {
        result.error_code = "provider_throttled";
        // A throttle is transient and does not spend an attempt.
        return await retry("throttled", undefined, throttleRetryAfterMs(error));
      }
      result.error_code = "provider_request_failed";
      return await retry("transient", undefined);
    }
    result.records = records.length;

    if (!records.length) {
      const wait = CALL_LOG_REFRESH_RETRY_DELAYS_MS[attempt - 1];
      if (wait === undefined) {
        // The reconcile window covers a record the provider publishes later.
        result.state = "not_published";
        return await finish();
      }
      result.error_code = "not_published";
      return await retry("not_published", new Date(now().getTime() + wait));
    }

    let accountId: string;
    try {
      accountId = resolveProviderAccountId(
        records.map((r) => accountIdFromProviderPath(typeof r.uri === "string" ? r.uri : null)),
        deps.configuredAccountId === undefined
          ? configuredRingCentralAccountId() ?? state?.provider_account_id ?? null
          : deps.configuredAccountId,
      );
    } catch (error) {
      result.error_code = error instanceof ProviderAccountError ? error.code : "account_unresolved";
      await warn(recordEvent, lease.job_id, telephonySessionId, result.error_code);
      return await finish();
    }
    const directory = await (deps.directory ?? loadDirectoryLookup)(accountId);
    const resolveRoute = deps.resolveRoute ?? (await defaultRouteResolver());
    const apply = deps.apply ?? applyInteractionObservation;
    const ordered = [...records].sort((a, b) => startMs(a) - startMs(b));
    for (const record of ordered) {
      const id = typeof record.id === "string" || typeof record.id === "number" ? String(record.id) : null;
      try {
        const applied = await apply(
          accountId,
          { kind: "call_log", record, proof_ref: `call_log_refresh:${id ?? "unknown"}`, source: "call_log_reconcile" },
          { now, directory, resolveRoute, request_id: lease.job_id, settleHorizonMinutes: callLogReconcileConfig().settleHorizonMinutes },
        );
        result.applied.push({ call_log_id: id, interaction_id: applied.interaction_id, noop: applied.noop, created: applied.created });
      } catch (error) {
        const code = error instanceof InteractionPersistenceError ? error.code : "persist_failed";
        result.error_code = code;
        if (!DETERMINISTIC_APPLY_CODES.has(code)) return await retry("transient", undefined);
        await warn(recordEvent, lease.job_id, telephonySessionId, code);
      }
    }
    result.state = result.applied.length ? "applied" : "failed";
    return await finish();
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") {
      return { status: "lease_lost", job_id: lease.job_id };
    }
    logger.error({
      msg: "sales_intelligence.call_log_refresh.worker_failed",
      jobId: lease.job_id,
      errorName: error instanceof Error ? error.name : "Error",
    });
    try {
      result.error_code ??= "worker_error";
      return await retry("transient", undefined);
    } catch (failError) {
      if (failError instanceof CsiError && failError.code === "LEASE_LOST") return { status: "lease_lost", job_id: lease.job_id };
      throw failError;
    }
  }
}

export type CallLogRefreshDrainSummary = {
  claimed: number;
  completed: number;
  retried: number;
  lease_lost: number;
  deadline_reached: boolean;
};

/** Cron recovery: claims due refresh jobs until none remain, `max` is reached, or the budget is spent. */
export async function drainCallLogRefreshJobs(
  max = 50,
  deps: CallLogRefreshDeps = {},
  options: { deadlineMs?: number; clock?: () => number } = {},
): Promise<CallLogRefreshDrainSummary> {
  const summary: CallLogRefreshDrainSummary = { claimed: 0, completed: 0, retried: 0, lease_lost: 0, deadline_reached: false };
  const clock = options.clock ?? (() => Date.now());
  const deadline = clock() + (options.deadlineMs ?? 20_000);
  for (let i = 0; i < max; i += 1) {
    if (clock() >= deadline) {
      summary.deadline_reached = true;
      break;
    }
    const outcome = await runCallLogRefreshJob(undefined, deps);
    if (outcome.status === "not_claimable") break;
    summary.claimed += 1;
    if (outcome.status === "completed") summary.completed += 1;
    else if (outcome.status === "retry") summary.retried += 1;
    else summary.lease_lost += 1;
  }
  return summary;
}

function startMs(record: CallLogRecordInput): number {
  const value = typeof record.startTime === "string" ? Date.parse(record.startTime) : Number.NaN;
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

async function warn(
  recordEvent: typeof recordOperationalEvent,
  jobId: string,
  telephonySessionId: string,
  errorCode: string,
): Promise<void> {
  logger.warn({ msg: "sales_intelligence.call_log_refresh.apply_failed", jobId, telephonySessionId, errorCode });
  await recordEvent({
    level: "warn",
    eventKey: "sales_intelligence.call_log_refresh.apply_failed",
    category: "ringcentral",
    workflow: "sales_intelligence",
    summary: "Targeted Call Log refresh could not apply the session's record; the reconcile window covers it.",
    details: { jobId, telephonySessionId, errorCode },
    notificationCandidate: false,
    reportable: false,
    piiPolicy: "none",
  }).catch(() => undefined);
}
