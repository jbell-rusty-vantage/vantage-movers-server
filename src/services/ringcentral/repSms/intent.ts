import { randomBytes } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { withTransaction } from "../../../db";
import { logger } from "../../../logger";
import { CsiError } from "../../salesIntelligence/auth";
import { claimCsiJob, completeCsiJob, enqueueCsiJob, failCsiJob, type JobLease } from "../../salesIntelligence/jobs";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { publishDelayedWakeup, type DelayedPublishDeps } from "../../numberActivity/callLogRefresh";
import { repSmsCaptureEnabled } from "./gate";
import { listReviewedRepMailboxes, type RepMailbox } from "./mailboxes";
import { runRepSmsMailboxSync, type MailboxSyncSummary } from "./mailboxSync";

/**
 * Webhook → coalesced per-mailbox sync intent (RINGCENTRAL-CAPTURE §5).
 *
 * A message-store delivery only says "something changed in mailbox X" (update events carry no ids),
 * so each stored receipt becomes one `rep_sms_sync` job for that mailbox, deduplicated per 10-second
 * bucket and due 2 s after the bucket ends: a burst of events costs one Light ISync, 2–12 s later.
 * The job runs the mailbox sync with high Light priority. Lost deliveries and lost wake-ups are
 * covered by the 5-minute safety poll and the job-recovery drain.
 */
export const REP_SMS_SYNC_STAGE = "rep_sms_sync" as const;
export const REP_SMS_INTENT_BUCKET_MS = 10_000;
export const REP_SMS_INTENT_SETTLE_MS = 2_000;
const LEASE_HELD_RETRY_MS = 15_000;

const MESSAGE_STORE_EVENT = /^\/restapi\/v1\.0\/account\/[^/]+\/extension\/(\d+)\/message-store(?:\?.*)?$/;

/** The mailbox a message-store event names; null for any other event (telephony, presence…). */
export function extensionFromMessageStoreEvent(event: string | null | undefined): string | null {
  const match = event ? MESSAGE_STORE_EVENT.exec(event.trim()) : null;
  return match?.[1] ?? null;
}

export function repSmsIntentKey(extensionId: string, receivedAt: Date): { dedupe_key: string; due_at: Date } {
  const bucket = Math.floor(receivedAt.getTime() / REP_SMS_INTENT_BUCKET_MS);
  return {
    dedupe_key: `rc:rep_sms_sync:${extensionId}:${bucket}`,
    due_at: new Date((bucket + 1) * REP_SMS_INTENT_BUCKET_MS + REP_SMS_INTENT_SETTLE_MS),
  };
}

export function repSmsSubjectKey(extensionId: string): string {
  return `rep_sms:${extensionId}`;
}

function extensionFromSubjectKey(subjectKey: string | null | undefined): string | null {
  const match = subjectKey ? /^rep_sms:(\d+)$/.exec(subjectKey) : null;
  return match?.[1] ?? null;
}

export type RepSmsFanoutResult =
  | { status: "skipped"; reason: "not_message_store" | "capture_disabled" }
  | { status: "enqueued" | "existing"; job_id: string; published: boolean }
  | { status: "enqueue_failed" };

export type RepSmsFanoutDeps = {
  enabled?: () => Promise<boolean>;
  enqueue?: typeof enqueueCsiJob;
  /** Whether the bucket's job already exists (read in the same transaction before the insert-only enqueue). */
  exists?: (dedupeKey: string, session: ClientSession) => Promise<boolean>;
  transaction?: <T>(work: (session: ClientSession) => Promise<T>) => Promise<T>;
  publish?: DelayedPublishDeps;
  now?: () => Date;
};

async function jobExists(dedupeKey: string, session: ClientSession): Promise<boolean> {
  return (await getSalesIntelligenceJobModel().findOne({ dedupe_key: dedupeKey }, { _id: 1 }).session(session).lean()) !== null;
}

/** Route hook after the receipt is stored. Never throws; the safety poll covers any failure. */
export async function fanOutRepSmsReceipt(
  input: { event: string | null; receivedAt: Date },
  deps: RepSmsFanoutDeps = {},
): Promise<RepSmsFanoutResult> {
  const extensionId = extensionFromMessageStoreEvent(input.event);
  if (!extensionId) return { status: "skipped", reason: "not_message_store" };
  try {
    if (!(await (deps.enabled ?? repSmsCaptureEnabled)())) return { status: "skipped", reason: "capture_disabled" };
    const { dedupe_key, due_at } = repSmsIntentKey(extensionId, input.receivedAt);
    const enqueue = deps.enqueue ?? enqueueCsiJob;
    const { row, created } = await (deps.transaction ?? withTransaction)(async (session) => {
      const existed = await (deps.exists ?? jobExists)(dedupe_key, session);
      const job = await enqueue(
        { dedupe_key, stage: REP_SMS_SYNC_STAGE, subject_key: repSmsSubjectKey(extensionId), input_revision: 1, input_refs: [], priority: 15 },
        session,
        due_at,
      );
      return { row: job, created: !existed };
    });
    const published = created ? await publishDelayedWakeup(String(row._id), due_at, (deps.now ?? (() => new Date()))(), deps.publish) : false;
    return { status: created ? "enqueued" : "existing", job_id: String(row._id), published };
  } catch (error) {
    logger.warn({ msg: "sales_outreach.rep_sms.fanout_failed", extensionId, errorName: error instanceof Error ? error.name : "Error" });
    return { status: "enqueue_failed" };
  }
}

export type RepSmsSyncJobOutcome =
  | { status: "not_claimable"; job_id: string | null }
  | { status: "completed"; job_id: string; state: string; summary: MailboxSyncSummary | null }
  | { status: "retry"; job_id: string; reason: "throttled" | "transient" | "lease_held"; next_attempt_at: Date }
  | { status: "lease_lost"; job_id: string };

export type RepSmsSyncJobDeps = {
  now?: () => Date;
  owner?: string;
  claim?: typeof claimCsiJob;
  complete?: typeof completeCsiJob;
  fail?: typeof failCsiJob;
  enabled?: () => Promise<boolean>;
  mailboxes?: (at: Date) => Promise<RepMailbox[]>;
  sync?: (mailbox: RepMailbox) => Promise<MailboxSyncSummary>;
  publish?: DelayedPublishDeps;
};

export async function runRepSmsSyncJob(jobId: string | undefined, deps: RepSmsSyncJobDeps = {}): Promise<RepSmsSyncJobOutcome> {
  const owner = deps.owner ?? `rep-sms-sync-job:${randomBytes(8).toString("hex")}`;
  const now = deps.now ?? (() => new Date());
  if (jobId !== undefined && !mongoose.Types.ObjectId.isValid(jobId)) return { status: "not_claimable", job_id: jobId };
  const row = await (deps.claim ?? claimCsiJob)(owner, jobId, 120_000, REP_SMS_SYNC_STAGE);
  if (!row) return { status: "not_claimable", job_id: jobId ?? null };
  const lease: JobLease = { job_id: String(row._id), owner, epoch: row.lease_epoch };
  const complete = async (state: string, summary: MailboxSyncSummary | null): Promise<RepSmsSyncJobOutcome> => {
    await (deps.complete ?? completeCsiJob)(lease, async () => undefined, { result: { state, summary } });
    return { status: "completed", job_id: lease.job_id, state, summary };
  };
  const retry = async (reason: "throttled" | "transient" | "lease_held", retryAfterMs: number, result: unknown): Promise<RepSmsSyncJobOutcome> => {
    const failed = await (deps.fail ?? failCsiJob)(lease, reason === "throttled" ? "throttled" : "transient", retryAfterMs, {
      result,
      ...(reason === "lease_held" ? { resumeAt: new Date(now().getTime() + LEASE_HELD_RETRY_MS) } : {}),
    });
    if (failed.status === "retry") await publishDelayedWakeup(lease.job_id, failed.next_attempt_at, now(), deps.publish);
    return { status: "retry", job_id: lease.job_id, reason, next_attempt_at: failed.next_attempt_at };
  };
  try {
    const extensionId = extensionFromSubjectKey(row.subject_key);
    if (!extensionId) return await complete("subject_invalid", null);
    if (!(await (deps.enabled ?? repSmsCaptureEnabled)())) return await complete("capture_disabled", null);
    const mailbox = (await (deps.mailboxes ?? ((at: Date) => listReviewedRepMailboxes(at)))(now())).find((m) => m.extension_id === extensionId);
    // Only reviewed sales_rep mailboxes are synced (P07e); anything else waits for review.
    if (!mailbox) return await complete("not_reviewed_mailbox", null);
    const summary = await (deps.sync ?? ((m: RepMailbox) => runRepSmsMailboxSync(m, { priority: "high" })))(mailbox);
    if (summary.skipped) return await retry("lease_held", 0, { state: "lease_held" });
    if (summary.error_code === "provider_throttled") return await retry("throttled", summary.throttle_retry_after_ms ?? 60_000, { state: "throttled" });
    if (summary.error_code === "provider_permission_denied") return await complete("permission_denied", summary);
    if (summary.error_code) return await retry("transient", 0, { state: summary.error_code });
    return await complete("synced", summary);
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost", job_id: lease.job_id };
    logger.error({ msg: "sales_outreach.rep_sms_sync.job_failed", jobId: lease.job_id, errorName: error instanceof Error ? error.name : "Error" });
    try {
      return await retry("transient", 0, { state: "worker_error" });
    } catch (failError) {
      if (failError instanceof CsiError && failError.code === "LEASE_LOST") return { status: "lease_lost", job_id: lease.job_id };
      throw failError;
    }
  }
}

/** Cron recovery drain; stops at the first throttle (the shared gate would refuse the rest). */
export async function drainRepSmsSyncJobs(
  max = 20,
  deps: RepSmsSyncJobDeps = {},
  options: { deadlineMs?: number; clock?: () => number } = {},
): Promise<{ claimed: number; completed: number; retried: number; lease_lost: number; deadline_reached: boolean; throttled: boolean }> {
  const summary = { claimed: 0, completed: 0, retried: 0, lease_lost: 0, deadline_reached: false, throttled: false };
  const clock = options.clock ?? (() => Date.now());
  const deadline = clock() + (options.deadlineMs ?? 20_000);
  for (let i = 0; i < max; i += 1) {
    if (clock() >= deadline) {
      summary.deadline_reached = true;
      break;
    }
    const outcome = await runRepSmsSyncJob(undefined, deps);
    if (outcome.status === "not_claimable") break;
    summary.claimed += 1;
    if (outcome.status === "completed") summary.completed += 1;
    else if (outcome.status === "retry") summary.retried += 1;
    else summary.lease_lost += 1;
    if (outcome.status === "retry" && outcome.reason === "throttled") {
      summary.throttled = true;
      break;
    }
  }
  return summary;
}
