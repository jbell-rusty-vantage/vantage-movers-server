import mongoose from "mongoose";
import { send as queueSend } from "@vercel/queue";
import { csiFlag } from "../../config/domain/salesIntelligence";
import { isTestMode, isVantageTestRunner } from "../../config/domain/runtime";
import { withTransaction } from "../../db";
import { logger } from "../../logger";
import { getSalesIntelligenceJobModel } from "../../models/SalesIntelligenceJob";
import { recordOperationalEvent } from "../observability";
import { enqueueCsiJob } from "../salesIntelligence/jobs";

/**
 * CSI-03 durable webhook fan-out (03 §2.2).
 *
 * The existing `captureRingCentralWebhookEvent` stores the raw receipt with a
 * plain insert (no transaction), so the capture-projection job cannot share
 * its transaction. Instead:
 *
 * 1. `ensureCaptureProjectionJob` durably upserts one deduplicated job per
 *    receipt (`sales_intelligence_jobs`, stage `capture_projection`) in its
 *    own transaction, awaited (with a bounded acknowledgement budget) before
 *    the route acknowledges.
 * 2. `publishCaptureProjectionWakeup` is post-commit and best-effort; a lost
 *    or failed publish leaves a pending job the recovery cron claims.
 * 3. `runReceiptWatermarkRecovery` (`webhookRecovery.ts`) closes the
 *    receipt→job gap: it scans stored receipts by `receivedAt` from a fenced,
 *    monotone watermark and ensures the job exists for each. Dedupe makes
 *    that exactly-once per receipt.
 *
 * Nothing here projects anything; the worker loads the stored receipt.
 */
export const CAPTURE_PROJECTION_STAGE = "capture_projection" as const;
export const WEBHOOK_RECEIPTS_SCOPE = "webhook_receipts";

export type ReceiptRef = { receiptId: string; uuid: string | null };

export function captureProjectionDedupeKey(ref: ReceiptRef): string {
  return ref.uuid
    ? `csi:capture_projection:receipt:${ref.uuid}`
    : `csi:capture_projection:receipt_id:${ref.receiptId}`;
}

export function captureProjectionSubjectKey(ref: ReceiptRef): string {
  return `webhook_receipt:${ref.uuid ?? ref.receiptId}`;
}

export type EnsureCaptureProjectionJobResult = {
  job_id: string;
  dedupe_key: string;
  created: boolean;
};

export type EnsureDependencies = {
  now?: () => Date;
  enqueue?: typeof enqueueCsiJob;
};

/** Durable, deduplicated capture-projection job for one stored receipt. Awaited by the route before it acknowledges. */
export async function ensureCaptureProjectionJob(
  ref: ReceiptRef,
  deps: EnsureDependencies = {},
): Promise<EnsureCaptureProjectionJobResult> {
  if (!mongoose.Types.ObjectId.isValid(ref.receiptId)) {
    throw new TypeError("receiptId must be a stored receipt _id");
  }
  const now = deps.now ?? (() => new Date());
  const enqueue = deps.enqueue ?? enqueueCsiJob;
  const dedupe_key = captureProjectionDedupeKey(ref);
  return withTransaction(async (session) => {
    const Model = getSalesIntelligenceJobModel();
    const prior = await Model.findOne({ dedupe_key }).session(session).lean();
    const row = await enqueue(
      {
        dedupe_key,
        stage: CAPTURE_PROJECTION_STAGE,
        subject_key: captureProjectionSubjectKey(ref),
        input_revision: 1,
        input_refs: [ref.receiptId],
        priority: 10,
      },
      session,
      now(),
    );
    return { job_id: String(row._id), dedupe_key, created: prior === null };
  });
}

export function salesIntelligenceQueueTopic(): string {
  const explicit = process.env.SALES_INTELLIGENCE_QUEUE_TOPIC?.trim();
  if (explicit) return explicit;
  return process.env.VERCEL_ENV?.trim().toLowerCase() === "production"
    ? "sales-intelligence-events"
    : "sales-intelligence-events-dev";
}

/** Tests, local tooling and non-Vercel runtimes never publish; Mongo remains the durable work source regardless. */
export function shouldPublishSalesIntelligenceQueue(): boolean {
  if (isVantageTestRunner() || isTestMode()) return false;
  return process.env.VERCEL === "1" && Boolean(process.env.VERCEL_REGION?.trim());
}

export type PublishDependencies = {
  shouldPublish?: () => boolean;
  send?: (topic: string, payload: { job_id: string }) => Promise<unknown>;
  recordEvent?: typeof recordOperationalEvent;
};

/** Post-commit wake-up. Failure is logged and counted, never thrown: the pending job is the durable truth. */
export async function publishCaptureProjectionWakeup(
  jobId: string,
  deps: PublishDependencies = {},
): Promise<{ published: boolean; error_code: "publish_failed" | null }> {
  const shouldPublish = deps.shouldPublish ?? shouldPublishSalesIntelligenceQueue;
  if (!shouldPublish()) return { published: false, error_code: null };
  try {
    await (deps.send ?? queueSend)(salesIntelligenceQueueTopic(), { job_id: jobId });
    return { published: true, error_code: null };
  } catch (error) {
    logger.error({
      msg: "sales_intelligence.queue.publish_failed",
      jobId,
      errorName: error instanceof Error ? error.name : "Error",
    });
    await (deps.recordEvent ?? recordOperationalEvent)({
      level: "warn",
      eventKey: "sales_intelligence.queue.publish_failed",
      category: "ringcentral",
      workflow: "sales_intelligence",
      summary: "Capture-projection wake-up publish failed; recovery cron will claim the pending job.",
      details: { jobId },
      notificationCandidate: false,
      reportable: false,
      piiPolicy: "none",
    });
    return { published: false, error_code: "publish_failed" };
  }
}

export type FanoutResult =
  | { status: "skipped"; reason: "flag_off" | "receipt_not_durable" | "no_telephony_session" }
  | { status: "enqueued"; job_id: string; dedupe_key: string; published: boolean }
  | { status: "existing"; job_id: string; dedupe_key: string; published: boolean }
  | { status: "enqueue_failed"; error_code: "enqueue_failed" }
  /** The job transaction did not finish within the acknowledgement budget; it may still commit, and recovery covers it either way. */
  | { status: "enqueue_timeout"; error_code: "enqueue_timeout"; timeout_ms: number };

export type FanoutDependencies = EnsureDependencies &
  PublishDependencies & {
    flag?: () => boolean;
    ensure?: typeof ensureCaptureProjectionJob;
    publish?: typeof publishCaptureProjectionWakeup;
    /** Upper bound on how long the route waits for the job transaction before acknowledging (default `SALES_INTELLIGENCE_FANOUT_ACK_TIMEOUT_MS` or 2500). */
    ackTimeoutMs?: number;
  };

export function fanoutAckTimeoutMs(): number {
  const raw = Number(process.env.SALES_INTELLIGENCE_FANOUT_ACK_TIMEOUT_MS?.trim());
  return Number.isSafeInteger(raw) && raw >= 100 ? raw : 2500;
}

class FanoutTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super("capture-projection enqueue exceeded the acknowledgement budget");
    this.name = "FanoutTimeoutError";
  }
}

function withAckTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new FanoutTimeoutError(timeoutMs)), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Route hook: after the receipt is stored and before the route acknowledges.
 * Independent of the qualified-call evaluation flag. On enqueue failure or
 * timeout the receipt is still durable and the watermark recovery closes the
 * gap. Receipts with no telephony session (validation handshakes) carry no
 * party evidence and are skipped here and by the recovery scan alike.
 */
export async function fanOutCaptureProjection(
  ref: { receiptId: string | null; uuid: string | null; telephonySessionId: string | null },
  deps: FanoutDependencies = {},
): Promise<FanoutResult> {
  const enabled = deps.flag ?? (() => csiFlag("CAPTURE_WEBHOOK"));
  if (!enabled()) return { status: "skipped", reason: "flag_off" };
  if (!ref.receiptId) return { status: "skipped", reason: "receipt_not_durable" };
  if (!ref.telephonySessionId) return { status: "skipped", reason: "no_telephony_session" };
  const timeoutMs = deps.ackTimeoutMs ?? fanoutAckTimeoutMs();
  let ensured: EnsureCaptureProjectionJobResult;
  try {
    ensured = await withAckTimeout(
      (deps.ensure ?? ensureCaptureProjectionJob)({ receiptId: ref.receiptId, uuid: ref.uuid }, deps),
      timeoutMs,
    );
  } catch (error) {
    if (error instanceof FanoutTimeoutError) {
      logger.warn({ msg: "sales_intelligence.capture.fanout.enqueue_timeout", receiptId: ref.receiptId, timeoutMs });
      await (deps.recordEvent ?? recordOperationalEvent)({
        level: "warn",
        eventKey: "sales_intelligence.capture.fanout.enqueue_timeout",
        category: "ringcentral",
        workflow: "sales_intelligence",
        summary: "Capture-projection enqueue exceeded the acknowledgement budget; receipt is durable and watermark recovery covers it.",
        details: { receiptId: ref.receiptId, timeoutMs },
        notificationCandidate: false,
        reportable: false,
        piiPolicy: "none",
      });
      return { status: "enqueue_timeout", error_code: "enqueue_timeout", timeout_ms: timeoutMs };
    }
    logger.error({
      msg: "sales_intelligence.capture.fanout.enqueue_failed",
      receiptId: ref.receiptId,
      errorName: error instanceof Error ? error.name : "Error",
      errorCode: (error as { code?: unknown } | null)?.code ?? null,
    });
    await (deps.recordEvent ?? recordOperationalEvent)({
      level: "warn",
      eventKey: "sales_intelligence.capture.fanout.enqueue_failed",
      category: "ringcentral",
      workflow: "sales_intelligence",
      summary: "Capture-projection job could not be enqueued; receipt is durable and watermark recovery will close the gap.",
      details: { receiptId: ref.receiptId, uuidPresent: ref.uuid !== null },
      notificationCandidate: false,
      reportable: false,
      piiPolicy: "none",
    });
    return { status: "enqueue_failed", error_code: "enqueue_failed" };
  }
  const wake = await (deps.publish ?? publishCaptureProjectionWakeup)(ensured.job_id, deps);
  return {
    status: ensured.created ? "enqueued" : "existing",
    job_id: ensured.job_id,
    dedupe_key: ensured.dedupe_key,
    published: wake.published,
  };
}

