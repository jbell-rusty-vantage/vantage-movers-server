import type { sheets_v4 } from "googleapis";
import {
  getSheetSyncDrainGuardrails,
  type SheetSyncRunTrigger,
} from "../../../config/domain";
import { connectMongo } from "../../../db";
import { logger } from "../../../logger";
import { mergeSheetSyncEntries, type SheetSyncEntry } from "../../../models/schemaHelpers";
import { SheetSyncAttempt } from "../../../models/SheetSyncAttempt";
import { SheetSyncJob, type SheetSyncJobDocument } from "../../../models/SheetSyncJob";
import { SheetSyncRun } from "../../../models/SheetSyncRun";
import { getSheetsClient } from "../../googleSheets/auth";
import { writeBatchedTargets } from "./batchWriter";
import { acquireLease, releaseLease } from "./leases";
import { planJobWrites, type PlannedDoc } from "./jobPlanner";
import { QuotaLimiter } from "./quotaLimiter";
import type { PlannedWrite, PlannedWriteOutcome } from "./types";

const DRAIN_LEASE_SCOPE = "sheet-sync:drain";
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;

export type RunSheetSyncDrainOptions = {
  sheets?: sheets_v4.Sheets;
  quota?: QuotaLimiter;
  owner?: string;
};

export type SheetSyncDrainSummary = {
  ok: boolean;
  runId: string | null;
  skipped: boolean;
  claimed: number;
  synced: number;
  failed: number;
  deferred: number;
};

/**
 * Drains due sheet-sync outbox jobs: claims a leased batch, reloads Mongo
 * state, batches the resulting writes per tab (quota-aware), persists
 * `sheet_sync` metadata + attempt/run history, and re-queues failures with
 * backoff. A global drain lease guarantees only one drain runs at a time so the
 * queue wake-up and cron safety net never contend for Google quota.
 */
export async function runSheetSyncDrain(
  trigger: SheetSyncRunTrigger,
  options: RunSheetSyncDrainOptions = {},
): Promise<SheetSyncDrainSummary> {
  await connectMongo();
  const guardrails = getSheetSyncDrainGuardrails();
  const owner = options.owner ?? `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const acquired = await acquireLease(DRAIN_LEASE_SCOPE, owner, guardrails.leaseDurationMs);
  if (!acquired) {
    logger.info({ msg: "sheet_sync.drain.skipped_locked", trigger });
    return { ok: true, runId: null, skipped: true, claimed: 0, synced: 0, failed: 0, deferred: 0 };
  }

  const run = await SheetSyncRun.create({ trigger, status: "running", started_at: new Date() });
  const runId = run._id;
  const sheets = options.sheets ?? getSheetsClient();
  const quota = options.quota ?? new QuotaLimiter();

  let syncedJobs = 0;
  let failedJobs = 0;
  let deferredJobs = 0;
  let claimedCount = 0;
  const deadline = Date.now() + guardrails.maxRunDurationMs;

  try {
    const claimed = await claimDueJobs(
      owner,
      runId,
      guardrails.maxJobsPerDrain,
      guardrails.leaseDurationMs,
    );
    claimedCount = claimed.length;

    // Defensive coalescing: collapse any duplicate active jobs sharing a key.
    const representatives = new Map<string, SheetSyncJobDocument>();
    const duplicates: SheetSyncJobDocument[] = [];
    for (const job of claimed) {
      const existing = representatives.get(job.coalescing_key);
      if (existing) {
        duplicates.push(job);
      } else {
        representatives.set(job.coalescing_key, job);
      }
    }

    logger.info({
      msg: "sheet_sync.drain.claimed",
      trigger,
      runId: runId.toString(),
      claimed: claimedCount,
      representatives: representatives.size,
      coalesced_duplicates: duplicates.length,
    });

    // Plan all representatives, accumulating writes + doc handles.
    const plannedDocs: PlannedDoc[] = [];
    const jobsById = new Map<string, SheetSyncJobDocument>();
    const emptyJobs: SheetSyncJobDocument[] = [];
    for (const job of representatives.values()) {
      if (Date.now() > deadline) {
        // Out of time: release remaining claims back to pending.
        await releaseClaim(job);
        continue;
      }
      jobsById.set(job._id.toString(), job);
      try {
        const docs = await planJobWrites(job);
        if (docs.length === 0 || docs.every((doc) => doc.writes.length === 0)) {
          emptyJobs.push(job);
        } else {
          plannedDocs.push(...docs);
        }
      } catch (error) {
        await markJobFailure(job, error, guardrails.maxAttempts);
        failedJobs += 1;
        jobsById.delete(job._id.toString());
      }
    }

    const allWrites = plannedDocs.flatMap((doc) => doc.writes);
    const outcomes =
      allWrites.length > 0
        ? await writeBatchedTargets({ sheets, writes: allWrites, quota })
        : [];

    await persistDocSheetSync(plannedDocs, outcomes);
    await recordAttempts(runId, outcomes);

    // Empty jobs (document gone / intentionally skipped) are done.
    for (const job of emptyJobs) {
      await markJobSynced(job);
      syncedJobs += 1;
    }

    // Apply per-job status from its write outcomes.
    const outcomesByJob = groupBy(outcomes, (o) => o.write.jobId);
    for (const [jobId, job] of jobsById) {
      const jobOutcomes = outcomesByJob.get(jobId) ?? [];
      if (jobOutcomes.length === 0) {
        continue; // already handled as empty/failed above
      }
      const anyDeferred = jobOutcomes.some((o) => o.status === "deferred");
      const anyFailed = jobOutcomes.some((o) => o.status === "failed");
      if (anyFailed) {
        const error = jobOutcomes.find((o) => o.error)?.error ?? "sheet write failed";
        await markJobFailure(job, new Error(error), guardrails.maxAttempts, retryTargetsFor(jobOutcomes));
        failedJobs += 1;
      } else if (anyDeferred) {
        await deferJob(job, retryTargetsFor(jobOutcomes));
        deferredJobs += 1;
      } else {
        await markJobSynced(job);
        syncedJobs += 1;
      }
    }

    // Duplicate jobs are fully covered by their representative's sync.
    for (const job of duplicates) {
      await markJobSynced(job, "coalesced_into_representative");
      syncedJobs += 1;
    }

    const status = failedJobs > 0 || deferredJobs > 0 ? "partial_failure" : "completed";
    await SheetSyncRun.findByIdAndUpdate(runId, {
      $set: {
        status,
        finished_at: new Date(),
        claimed_job_count: claimedCount,
        synced_job_count: syncedJobs,
        failed_job_count: failedJobs,
        deferred_job_count: deferredJobs,
      },
    });

    logger.info({
      msg: "sheet_sync.drain.run_summary",
      trigger,
      runId: runId.toString(),
      claimed: claimedCount,
      synced: syncedJobs,
      failed: failedJobs,
      deferred: deferredJobs,
    });

    return {
      ok: true,
      runId: runId.toString(),
      skipped: false,
      claimed: claimedCount,
      synced: syncedJobs,
      failed: failedJobs,
      deferred: deferredJobs,
    };
  } catch (error) {
    logger.error({ err: error, msg: "sheet_sync.drain.run_failed", trigger, runId: runId.toString() });
    await SheetSyncRun.findByIdAndUpdate(runId, {
      $set: {
        status: "failed",
        finished_at: new Date(),
        claimed_job_count: claimedCount,
        synced_job_count: syncedJobs,
        failed_job_count: failedJobs,
        deferred_job_count: deferredJobs,
        error_summary: error instanceof Error ? error.message : String(error),
      },
    });
    return {
      ok: false,
      runId: runId.toString(),
      skipped: false,
      claimed: claimedCount,
      synced: syncedJobs,
      failed: failedJobs,
      deferred: deferredJobs,
    };
  } finally {
    await releaseLease(DRAIN_LEASE_SCOPE, owner);
  }
}

async function claimDueJobs(
  owner: string,
  runId: unknown,
  limit: number,
  leaseMs: number,
): Promise<SheetSyncJobDocument[]> {
  const now = new Date();
  const candidates = await SheetSyncJob.find({
    status: { $in: ["pending", "retrying"] },
    due_at: { $lte: now },
    $or: [{ leased_until: { $exists: false } }, { leased_until: { $lte: now } }],
  })
    .sort({ priority: -1, createdAt: 1 })
    .limit(limit);

  const claimed: SheetSyncJobDocument[] = [];
  for (const candidate of candidates) {
    const leaseNow = new Date();
    const job = await SheetSyncJob.findOneAndUpdate(
      {
        _id: candidate._id,
        status: { $in: ["pending", "retrying"] },
        $or: [{ leased_until: { $exists: false } }, { leased_until: { $lte: leaseNow } }],
      },
      {
        $set: {
          status: "processing",
          leased_until: new Date(leaseNow.getTime() + leaseMs),
          lease_owner: owner,
          run_id: runId,
        },
      },
      { new: true },
    );
    if (job) {
      claimed.push(job);
    }
  }
  return claimed;
}

async function persistDocSheetSync(
  plannedDocs: PlannedDoc[],
  outcomes: PlannedWriteOutcome[],
): Promise<void> {
  const outcomesByDoc = groupBy(outcomes, (o) => o.write.docKey);
  for (const planned of plannedDocs) {
    if (!planned.doc) {
      continue; // delete tombstone: no surviving document to persist onto
    }
    const docOutcomes = outcomesByDoc.get(planned.docKey) ?? [];
    if (docOutcomes.length === 0) {
      continue;
    }
    const entries: SheetSyncEntry[] = docOutcomes
      .filter((o) => o.write.op === "upsert")
      .map((o) => toSheetSyncEntry(o));
    if (entries.length === 0) {
      continue;
    }
    const doc = planned.doc;
    doc.set("sheet_sync", mergeSheetSyncEntries(doc.get("sheet_sync") as SheetSyncEntry[], entries));
    await doc.save();
  }
}

function toSheetSyncEntry(outcome: PlannedWriteOutcome): SheetSyncEntry {
  const { write } = outcome;
  if (outcome.status === "synced") {
    return {
      target: write.target,
      spreadsheet_id: write.spreadsheetId,
      tab_name: write.tabName,
      row_number: outcome.rowNumber,
      status: "synced",
      last_synced_at: new Date(),
      updated_since_last_sync: false,
    };
  }
  return {
    target: write.target,
    spreadsheet_id: write.spreadsheetId,
    tab_name: write.tabName,
    row_number: write.knownRowNumber,
    status: outcome.status === "deferred" ? "pending" : "failed",
    last_error: outcome.error,
    updated_since_last_sync: true,
  };
}

async function recordAttempts(
  runId: unknown,
  outcomes: PlannedWriteOutcome[],
): Promise<void> {
  if (outcomes.length === 0) {
    return;
  }
  await SheetSyncAttempt.insertMany(
    outcomes.map((o) => ({
      run_id: runId,
      job_id: o.write.jobId,
      target: o.write.target,
      spreadsheet_id: o.write.spreadsheetId,
      tab_name: o.write.tabName,
      action: o.action,
      status: o.status,
      row_number: o.rowNumber,
      error: o.error,
    })),
    { ordered: false },
  ).catch((error) => {
    logger.warn({ err: error, msg: "sheet_sync.drain.attempt_persist_failed" });
  });
}

async function markJobSynced(job: SheetSyncJobDocument, note?: string): Promise<void> {
  await SheetSyncJob.findByIdAndUpdate(job._id, {
    $set: {
      status: "synced",
      leased_until: new Date(0),
      target_hints: [],
      ...(note ? { last_error: note } : { last_error: undefined }),
    },
  });
}

async function deferJob(job: SheetSyncJobDocument, retryTargets: string[]): Promise<void> {
  // Quota deferral is not a failure: retry next minute without burning an attempt.
  await SheetSyncJob.findByIdAndUpdate(job._id, {
    $set: {
      status: "retrying",
      due_at: new Date(Date.now() + 60_000),
      leased_until: new Date(0),
      target_hints: retryTargets,
      last_error: "quota_budget_exhausted",
      last_error_at: new Date(),
    },
  });
}

async function markJobFailure(
  job: SheetSyncJobDocument,
  error: unknown,
  maxAttempts: number,
  retryTargets?: string[],
): Promise<void> {
  const attempts = (job.attempts ?? 0) + 1;
  const message = error instanceof Error ? error.message : String(error);
  const terminal = attempts >= maxAttempts;
  await SheetSyncJob.findByIdAndUpdate(job._id, {
    $set: {
      status: terminal ? "failed" : "retrying",
      attempts,
      due_at: terminal ? job.due_at : retryDueAt(attempts),
      leased_until: new Date(0),
      target_hints: terminal ? [] : retryTargets ?? [],
      last_error: message,
      last_error_at: new Date(),
    },
  });
}

async function releaseClaim(job: SheetSyncJobDocument): Promise<void> {
  await SheetSyncJob.findByIdAndUpdate(job._id, {
    $set: { status: "pending", leased_until: new Date(0) },
  });
}

function retryDueAt(attempts: number): Date {
  const delay = Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS);
  return new Date(Date.now() + delay);
}

function retryTargetsFor(outcomes: PlannedWriteOutcome[]): string[] {
  return [
    ...new Set(
      outcomes
        .filter((outcome) => outcome.status === "failed" || outcome.status === "deferred")
        .map((outcome) => outcome.write.target),
    ),
  ];
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key);
    if (list) {
      list.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}

export type { PlannedWrite };
