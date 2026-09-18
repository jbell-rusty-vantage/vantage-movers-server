import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { logger } from "../../logger";
import { recordOperationalEvent } from "../observability";
import { csiWorkerActor, CsiError } from "../salesIntelligence/auth";
import {
  claimCsiJob,
  completeCsiJob,
  failCsiJob,
  type JobLease,
} from "../salesIntelligence/jobs";
import { appendCsiAudit } from "../salesIntelligence/transactions";
import {
  normalizeWebhookPartyObservations,
  observeRingCentralWebhookEvents,
  type ObserveDependencies,
  type SessionObservationResult,
} from "./observeWebhookEvents";
import { CAPTURE_PROJECTION_STAGE } from "./webhookFanout";
import { findWebhookReceiptById } from "./webhookReceipts";

/**
 * CSI-03 capture-projection worker.
 *
 * Claims one `capture_projection` job through `claimCsiJob`, loads the stored
 * receipt named by `input_refs[0]` (never the queue payload), normalizes it
 * with the CSI-02 normalizer and projects it with
 * `observeRingCentralWebhookEvents`, passing the job id as `request_id` so
 * every audit row ties back to this job. The queue consumer and the recovery
 * cron call this same function.
 *
 * Completion semantics: projection itself is idempotent (CSI-02 semantic
 * replay is a no-op), so a crash between projection and completion is safe.
 * Deterministic per-session failures (`account_unresolved`,
 * `account_mismatch`, `identity_missing`, `projection_failed`) complete the
 * job with the failures visible in `result` and in the `job` audit row.
 * Retryable failures (`persist_failed`, `retry_exhausted`) retry the job with
 * the partial result kept on the row.
 */
export type SessionSummary =
  | {
      telephony_session_id: string;
      ok: true;
      interaction_id: string;
      contact_number_id: string | null;
      projection_revision: number;
      noop: boolean;
      created: boolean;
      newly_terminal: boolean;
      jobs: number;
    }
  | { telephony_session_id: string; ok: false; error_code: Extract<SessionObservationResult, { ok: false }>["error_code"] };

export type CaptureProjectionJobResult = {
  receipt_id: string;
  receipt_uuid: string | null;
  sessions: number;
  ok: number;
  failed: number;
  results: SessionSummary[];
};

export type CaptureProjectionOutcome =
  | { status: "not_claimable"; job_id: string | null }
  | { status: "completed"; job_id: string; result: CaptureProjectionJobResult }
  /**
   * The job was handed to `failCsiJob`. `transient` retries with backoff;
   * `schema_invalid` (receipt unloadable) dead-letters after two attempts.
   * The partial or diagnostic result stays on the row either way.
   */
  | {
      status: "failed";
      job_id: string;
      reason: "transient" | "schema_invalid";
      error_code: "receipt_missing" | "receipt_ref_missing" | "session_retryable" | "worker_error";
      result: CaptureProjectionJobResult | { receipt_id: string | null; error_code: string } | null;
    }
  | { status: "lease_lost"; job_id: string };

export type CaptureProjectionWorkerDeps = {
  now?: () => Date;
  owner?: string;
  ttlMs?: number;
  claim?: typeof claimCsiJob;
  complete?: typeof completeCsiJob;
  fail?: typeof failCsiJob;
  loadReceipt?: typeof findWebhookReceiptById;
  observe?: typeof observeRingCentralWebhookEvents;
  /** Passed through to `observeRingCentralWebhookEvents`; `request_id` is always overridden with the job id. */
  observeDeps?: Omit<ObserveDependencies, "request_id">;
  recordEvent?: typeof recordOperationalEvent;
};

const RETRYABLE_SESSION_CODES = new Set(["persist_failed", "retry_exhausted"]);

export function defaultCaptureWorkerOwner(): string {
  return `csi-capture-projection:${randomBytes(8).toString("hex")}`;
}

export async function runCaptureProjectionJob(
  jobId: string | undefined,
  deps: CaptureProjectionWorkerDeps = {},
): Promise<CaptureProjectionOutcome> {
  const owner = deps.owner ?? defaultCaptureWorkerOwner();
  const claim = deps.claim ?? claimCsiJob;
  const complete = deps.complete ?? completeCsiJob;
  const fail = deps.fail ?? failCsiJob;
  const now = deps.now ?? (() => new Date());

  if (jobId !== undefined && !mongoose.Types.ObjectId.isValid(jobId)) {
    return { status: "not_claimable", job_id: jobId };
  }
  const row = await claim(owner, jobId, deps.ttlMs ?? 300_000, CAPTURE_PROJECTION_STAGE);
  if (!row) return { status: "not_claimable", job_id: jobId ?? null };
  const lease: JobLease = { job_id: String(row._id), owner, epoch: row.lease_epoch };

  const receiptRef = row.input_refs?.[0] ? String(row.input_refs[0]) : null;
  try {
    if (!receiptRef) {
      const diagnostic = { receipt_id: null, error_code: "receipt_ref_missing" };
      await fail(lease, "schema_invalid", 0, { result: diagnostic });
      return { status: "failed", job_id: lease.job_id, reason: "schema_invalid", error_code: "receipt_ref_missing", result: diagnostic };
    }
    const receipt = await (deps.loadReceipt ?? findWebhookReceiptById)(receiptRef);
    if (!receipt) {
      const diagnostic = { receipt_id: receiptRef, error_code: "receipt_missing" };
      await fail(lease, "schema_invalid", 0, { result: diagnostic });
      return { status: "failed", job_id: lease.job_id, reason: "schema_invalid", error_code: "receipt_missing", result: diagnostic };
    }

    const observations = normalizeWebhookPartyObservations(receipt.rawBody, receipt.receivedAt);
    const results = observations.length
      ? await (deps.observe ?? observeRingCentralWebhookEvents)(observations, {
          ...(deps.observeDeps ?? {}),
          request_id: lease.job_id,
        })
      : [];
    const result: CaptureProjectionJobResult = {
      receipt_id: String(receipt._id),
      receipt_uuid: receipt.uuid ?? null,
      sessions: results.length,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results: results.map(summarize),
    };

    const retryable = results.some((r) => !r.ok && RETRYABLE_SESSION_CODES.has(r.error_code));
    if (retryable) {
      await fail(lease, "transient", 0, { result });
      return { status: "failed", job_id: lease.job_id, reason: "transient", error_code: "session_retryable", result };
    }

    const at = now();
    await complete(
      lease,
      async (session) => {
        await appendCsiAudit(
          { session, command_id: new mongoose.Types.ObjectId(), now: at, actor: csiWorkerActor(lease.job_id) },
          {
            subject_key: `job:${lease.job_id}`,
            event_kind: "capture_projection.completed",
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
    if (result.failed > 0) {
      await (deps.recordEvent ?? recordOperationalEvent)({
        level: "warn",
        eventKey: "sales_intelligence.capture.projection.sessions_failed",
        category: "ringcentral",
        workflow: "sales_intelligence",
        summary: "Capture-projection job completed with per-session failures.",
        details: {
          jobId: lease.job_id,
          failed: result.failed,
          errorCodes: result.results.filter((r) => !r.ok).map((r) => (r as { error_code: string }).error_code),
        },
        notificationCandidate: false,
        reportable: false,
        piiPolicy: "none",
      });
    }
    return { status: "completed", job_id: lease.job_id, result };
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") {
      logger.warn({ msg: "sales_intelligence.capture.projection.lease_lost", jobId: lease.job_id });
      return { status: "lease_lost", job_id: lease.job_id };
    }
    logger.error({
      msg: "sales_intelligence.capture.projection.worker_failed",
      jobId: lease.job_id,
      errorName: error instanceof Error ? error.name : "Error",
    });
    try {
      await fail(lease, "transient");
    } catch (failError) {
      if (failError instanceof CsiError && failError.code === "LEASE_LOST") {
        return { status: "lease_lost", job_id: lease.job_id };
      }
      throw failError;
    }
    return { status: "failed", job_id: lease.job_id, reason: "transient", error_code: "worker_error", result: null };
  }
}

export type DrainSummary = {
  claimed: number;
  completed: number;
  failed: number;
  lease_lost: number;
  /** True when the wall-clock budget ended the drain with claimable work possibly remaining; the next invocation continues. */
  deadline_reached: boolean;
  outcomes: CaptureProjectionOutcome[];
};

/**
 * Recovery path: claims due `capture_projection` jobs oldest-first until none
 * remain, `max` is reached, or the wall-clock `deadlineMs` budget is spent.
 * The deadline is checked between jobs so a claimed job is never abandoned
 * mid-flight by this loop.
 */
export async function drainCaptureProjectionJobs(
  max: number,
  deps: CaptureProjectionWorkerDeps = {},
  options: { deadlineMs?: number; now?: () => number } = {},
): Promise<DrainSummary> {
  const summary: DrainSummary = { claimed: 0, completed: 0, failed: 0, lease_lost: 0, deadline_reached: false, outcomes: [] };
  const clock = options.now ?? (() => Date.now());
  const deadline = options.deadlineMs === undefined ? Number.POSITIVE_INFINITY : clock() + options.deadlineMs;
  for (let i = 0; i < max; i += 1) {
    if (clock() >= deadline) {
      summary.deadline_reached = true;
      break;
    }
    const outcome = await runCaptureProjectionJob(undefined, deps);
    if (outcome.status === "not_claimable") break;
    summary.claimed += 1;
    summary.outcomes.push(outcome);
    if (outcome.status === "completed") summary.completed += 1;
    else if (outcome.status === "failed") summary.failed += 1;
    else summary.lease_lost += 1;
  }
  return summary;
}

function summarize(result: SessionObservationResult): SessionSummary {
  if (!result.ok) {
    return { telephony_session_id: result.telephony_session_id, ok: false, error_code: result.error_code };
  }
  return {
    telephony_session_id: result.telephony_session_id,
    ok: true,
    interaction_id: result.result.interaction_id,
    contact_number_id: result.result.contact_number_id,
    projection_revision: result.result.projection_revision,
    noop: result.result.noop,
    created: result.result.created,
    newly_terminal: result.result.newly_terminal,
    jobs: result.result.jobs.length,
  };
}
