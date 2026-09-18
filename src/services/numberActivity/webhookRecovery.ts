import { createHash, randomBytes } from "node:crypto";
import { csiFlag } from "../../config/domain/salesIntelligence";
import { logger } from "../../logger";
import { getSalesIntelligenceSyncStateModel } from "../../models/SalesIntelligenceSyncState";
import { MongoLeaseStore, type MongoLeaseModel } from "../durableWork/leases";
import type { LeaseToken } from "../durableWork/types";
import { recordOperationalEvent } from "../observability";
import { CsiError } from "../salesIntelligence/auth";
import {
  ensureCaptureProjectionJob,
  publishCaptureProjectionWakeup,
  WEBHOOK_RECEIPTS_SCOPE,
} from "./webhookFanout";
import { listWebhookReceiptsBetween, type ReceiptCursor } from "./webhookReceipts";

/**
 * CSI-03 receipt watermark recovery (03 §2.2, §14 "durable receipt/outbox and
 * repair scan"). Scans stored telephony receipts from a fenced watermark and
 * ensures a capture-projection job exists for each; dedupe makes this exactly
 * once per receipt.
 *
 * Progress guarantees (independent review findings 1, 4, R2, R3): the overlap
 * is subtracted once at the start of a run; every page resumes strictly after
 * the last processed `(receivedAt, _id)` keyset position; the stored watermark
 * is monotone (never earlier than the previous value); a run that exhausts its
 * page or wall-clock budget stops at the last processed receipt and the next
 * run resumes there. Deterministic per-receipt failures are quarantined and
 * reported so the scan keeps moving; transport failures end the run with the
 * watermark at the last receipt that has a job.
 */
export type RecoveryConfig = {
  /** First run scans back this far; later runs start at the stored watermark minus overlap. */
  lookbackMinutes: number;
  /** Re-checked window before the watermark; applied once per run, never per page. */
  overlapMs: number;
  /** Receipts newer than `now − settleMs` are left for the next run so a receipt inserted concurrently is not skipped past. */
  settleMs: number;
  /** Page size for one scan query. */
  batch: number;
  /** Pages per run; a run that exhausts its budget resumes from the last processed receipt next time. */
  maxPages: number;
  /** Wall-clock budget for one run, checked between pages; exhaustion is reported as `budget_exhausted`. */
  deadlineMs: number;
  leaseTtlMs: number;
};

export function receiptRecoveryConfig(): RecoveryConfig {
  const int = (name: string, fallback: number, min: number) => {
    const raw = process.env[`SALES_INTELLIGENCE_${name}`]?.trim();
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= min ? parsed : fallback;
  };
  return {
    lookbackMinutes: int("WEBHOOK_RECOVERY_LOOKBACK_MINUTES", 720, 1),
    overlapMs: int("WEBHOOK_RECOVERY_OVERLAP_MINUTES", 5, 0) * 60_000,
    settleMs: 5_000,
    batch: int("WEBHOOK_RECOVERY_BATCH", 200, 1),
    maxPages: int("WEBHOOK_RECOVERY_MAX_PAGES", 10, 1),
    deadlineMs: int("WEBHOOK_RECOVERY_DEADLINE_MS", 30_000, 1_000),
    leaseTtlMs: 120_000,
  };
}

export type RecoverySummary = {
  ran_at: string;
  skipped: boolean;
  skip_reason: "disabled" | "lease_held" | null;
  lease_owner_hash: string | null;
  scan_from: string | null;
  scan_to: string | null;
  pages: number;
  scanned: number;
  created: number;
  existing: number;
  /** Receipt ids whose job could not be created for a deterministic reason; recorded and skipped so the scan keeps moving. */
  quarantined: string[];
  failed: number;
  published: number;
  watermark_before: string | null;
  watermark_after: string | null;
  /** True when the page budget ran out before `scan_to`; the watermark stopped at the last processed receipt. */
  budget_exhausted: boolean;
  error_code: "ensure_failed" | "lease_lost" | "state_write_failed" | null;
  runtime_ms: number;
};

export type RecoveryDependencies = {
  now: () => Date;
  owner: string;
  config: RecoveryConfig;
  listReceipts: typeof listWebhookReceiptsBetween;
  ensure: typeof ensureCaptureProjectionJob;
  publish: typeof publishCaptureProjectionWakeup;
  recordEvent: typeof recordOperationalEvent;
  requireFlag: boolean;
};

class LeaseLostError extends Error {
  constructor() {
    super("CSI webhook receipt recovery lease lost");
    this.name = "LeaseLostError";
  }
}

function maskOwner(owner: string): string {
  return createHash("sha256").update(owner).digest("hex").slice(0, 12);
}

/** Codes for which retrying the same receipt cannot succeed; the receipt is quarantined rather than blocking the scan. */
const DETERMINISTIC_ENSURE_CODES = new Set(["IDEMPOTENCY_CONFLICT", "INVALID_INPUT"]);

export async function runReceiptWatermarkRecovery(
  overrides: Partial<RecoveryDependencies> = {},
): Promise<RecoverySummary> {
  const deps: RecoveryDependencies = {
    now: () => new Date(),
    owner: `csi-webhook-recovery:${randomBytes(8).toString("hex")}`,
    config: receiptRecoveryConfig(),
    listReceipts: listWebhookReceiptsBetween,
    ensure: ensureCaptureProjectionJob,
    publish: publishCaptureProjectionWakeup,
    recordEvent: recordOperationalEvent,
    requireFlag: true,
    ...overrides,
  };
  const startedAt = deps.now();
  const summary: RecoverySummary = {
    ran_at: startedAt.toISOString(),
    skipped: false,
    skip_reason: null,
    lease_owner_hash: null,
    scan_from: null,
    scan_to: null,
    pages: 0,
    scanned: 0,
    created: 0,
    existing: 0,
    quarantined: [],
    failed: 0,
    published: 0,
    watermark_before: null,
    watermark_after: null,
    budget_exhausted: false,
    error_code: null,
    runtime_ms: 0,
  };
  if (deps.requireFlag && !csiFlag("CAPTURE_WEBHOOK")) {
    summary.skipped = true;
    summary.skip_reason = "disabled";
    return summary;
  }

  const Model = getSalesIntelligenceSyncStateModel();
  const leaseModel: MongoLeaseModel = {
    findOneAndUpdate: (filter, update, options) =>
      Model.findOneAndUpdate(filter, update, { ...options, lean: true }) as never,
    updateOne: (filter, update) => Model.updateOne(filter, update),
    findOne: (filter) => Model.findOne(filter).lean() as never,
  };
  const leases = new MongoLeaseStore(leaseModel);
  const ownerHash = maskOwner(deps.owner);
  const token = await leases.acquire({
    scope: WEBHOOK_RECEIPTS_SCOPE,
    owner: deps.owner,
    ttl_ms: deps.config.leaseTtlMs,
    now: startedAt,
  });
  if (!token) {
    summary.skipped = true;
    summary.skip_reason = "lease_held";
    summary.runtime_ms = elapsed(startedAt, deps.now());
    return summary;
  }
  summary.lease_owner_hash = ownerHash;
  let lease: LeaseToken = token;

  const state = (await Model.findOne({ scope: WEBHOOK_RECEIPTS_SCOPE }).lean()) as
    | { cursor?: { last_sync_to?: Date | null } | null; consecutive_failures?: number }
    | null;
  const watermarkBefore = state?.cursor?.last_sync_to ?? null;
  summary.watermark_before = watermarkBefore?.toISOString() ?? null;
  const scanFrom = watermarkBefore
    ? new Date(watermarkBefore.getTime() - deps.config.overlapMs)
    : new Date(startedAt.getTime() - deps.config.lookbackMinutes * 60_000);
  const scanTo = new Date(startedAt.getTime() - deps.config.settleMs);
  summary.scan_from = scanFrom.toISOString();
  summary.scan_to = scanTo.toISOString();

  // Monotone: never earlier than the stored watermark, whatever this run sees.
  let watermarkAfter: Date = watermarkBefore ?? scanFrom;
  const advance = (candidate: Date) => {
    if (candidate > watermarkAfter) watermarkAfter = candidate;
  };

  try {
    // Keyset position of the last processed receipt; pages resume strictly after it.
    let after: ReceiptCursor | null = null;
    let reachedEnd = scanTo <= scanFrom;
    let stopped = false;
    const deadline = startedAt.getTime() + deps.config.deadlineMs;
    while (!reachedEnd && !stopped && summary.pages < deps.config.maxPages) {
      if (deps.now().getTime() >= deadline) break;
      const renewed = await leases.renew({ token: lease, ttl_ms: deps.config.leaseTtlMs, now: deps.now() });
      if (!renewed) throw new LeaseLostError();
      lease = renewed;
      const rows = await deps.listReceipts(scanFrom, scanTo, deps.config.batch, after);
      summary.pages += 1;
      summary.scanned += rows.length;
      let lastProcessed: Date | null = null;
      for (const row of rows) {
        try {
          const ensured = await deps.ensure({ receiptId: String(row._id), uuid: row.uuid ?? null });
          if (ensured.created) {
            summary.created += 1;
            // Recovery-created jobs get the same best-effort wake-up as route-created ones.
            const wake = await deps.publish(ensured.job_id, { recordEvent: deps.recordEvent });
            if (wake.published) summary.published += 1;
          } else {
            summary.existing += 1;
          }
          lastProcessed = row.receivedAt;
          after = { receivedAt: row.receivedAt, _id: row._id };
        } catch (error) {
          if (error instanceof CsiError && DETERMINISTIC_ENSURE_CODES.has(error.code)) {
            // Retrying this receipt cannot succeed; record it and keep the scan moving.
            summary.quarantined.push(String(row._id));
            lastProcessed = row.receivedAt;
            after = { receivedAt: row.receivedAt, _id: row._id };
            logger.warn({
              msg: "sales_intelligence.capture.recovery.receipt_quarantined",
              leaseOwnerHash: ownerHash,
              receiptId: String(row._id),
              errorCode: error.code,
            });
            continue;
          }
          summary.failed += 1;
          summary.error_code = "ensure_failed";
          logger.warn({
            msg: "sales_intelligence.capture.recovery.ensure_failed",
            leaseOwnerHash: ownerHash,
            errorName: error instanceof Error ? error.name : "Error",
          });
          stopped = true;
          break;
        }
      }
      if (lastProcessed) advance(lastProcessed);
      if (stopped) break;
      if (rows.length < deps.config.batch) {
        reachedEnd = true;
        advance(scanTo);
      }
      // Otherwise the next page resumes strictly after `after` (keyset), so
      // same-millisecond clusters larger than one page still make progress.
    }
    summary.budget_exhausted = !reachedEnd && !stopped;

    const finishedAt = deps.now();
    summary.runtime_ms = elapsed(startedAt, finishedAt);
    summary.watermark_after = watermarkAfter.toISOString();
    const written = await Model.updateOne(
      {
        scope: WEBHOOK_RECEIPTS_SCOPE,
        lease_owner: lease.owner,
        lease_epoch: lease.epoch,
        leased_until: { $gt: finishedAt },
      },
      {
        $set: {
          cursor: {
            last_sync_from: scanFrom,
            last_sync_to: watermarkAfter,
            provider_modified_watermark: null,
            entity_change_applied_at: null,
            entity_change_id: null,
          },
          known_complete_through: null,
          gaps: [],
          consecutive_failures: summary.error_code ? (state?.consecutive_failures ?? 0) + 1 : 0,
          last_run: {
            started_at: startedAt,
            finished_at: finishedAt,
            runtime_ms: summary.runtime_ms,
            pages: summary.pages,
            records: summary.scanned,
            upserts: summary.created,
            throttled_count: 0,
            error_code: summary.error_code,
          },
          lease_owner: null,
          leased_until: finishedAt,
        },
      },
    );
    if (written.modifiedCount !== 1) throw new LeaseLostError();
    if (summary.created > 0 || summary.quarantined.length > 0) {
      await deps.recordEvent({
        level: "warn",
        eventKey: "sales_intelligence.capture.recovery.gap_closed",
        category: "ringcentral",
        workflow: "sales_intelligence",
        summary: "Receipt watermark recovery created capture-projection jobs the route path had not.",
        details: {
          leaseOwnerHash: ownerHash,
          created: summary.created,
          scanned: summary.scanned,
          quarantined: summary.quarantined,
          budgetExhausted: summary.budget_exhausted,
        },
        notificationCandidate: false,
        reportable: false,
        piiPolicy: "none",
      });
    }
    return summary;
  } catch (error) {
    summary.runtime_ms = elapsed(startedAt, deps.now());
    summary.watermark_after = summary.watermark_before;
    if (error instanceof LeaseLostError) {
      summary.error_code = "lease_lost";
      return summary;
    }
    summary.error_code = "state_write_failed";
    logger.error({
      msg: "sales_intelligence.capture.recovery.failed",
      leaseOwnerHash: ownerHash,
      errorName: error instanceof Error ? error.name : "Error",
    });
    try {
      await leases.release({ token: lease, now: deps.now() });
    } catch {
      /* lease expiry is the recovery path */
    }
    return summary;
  }
}

function elapsed(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
}
