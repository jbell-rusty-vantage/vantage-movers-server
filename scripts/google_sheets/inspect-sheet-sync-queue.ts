/**
 * Read-only inspector for the durable sheet-sync outbox (queued mode). Prints
 * job counts by status, the oldest pending job, the most recent failed jobs,
 * and the last few drain runs so an operator can gauge backlog/health without
 * touching the admin API.
 *
 * Run:
 *   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/google_sheets/inspect-sheet-sync-queue.ts
 *
 * Env:
 * - MONGO_URI (required) — read by `connectMongo`.
 * - SHEET_SYNC_INSPECT_FAILED_LIMIT (default 10) — failed jobs to list.
 * - SHEET_SYNC_INSPECT_RUN_LIMIT (default 5) — recent runs to list.
 */

import process from "node:process";
import mongoose from "mongoose";
import { connectMongo } from "../../api/db";
import { getSheetSyncMode } from "../../api/config/domain";
import { SheetSyncJob } from "../../api/models/SheetSyncJob";
import { SheetSyncRun } from "../../api/models/SheetSyncRun";

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<void> {
  const failedLimit = intEnv("SHEET_SYNC_INSPECT_FAILED_LIMIT", 10);
  const runLimit = intEnv("SHEET_SYNC_INSPECT_RUN_LIMIT", 5);

  await connectMongo();

  const statusCounts = await SheetSyncJob.aggregate<{ _id: string; count: number }>([
    { $group: { _id: "$status", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const oldestPending = await SheetSyncJob.findOne({ status: { $in: ["pending", "retrying"] } })
    .sort({ due_at: 1 })
    .select({ due_at: 1, coalescing_key: 1, resource: 1, attempts: 1 })
    .lean();

  const failed = await SheetSyncJob.find({ status: "failed" })
    .sort({ updatedAt: -1 })
    .limit(failedLimit)
    .select({ coalescing_key: 1, resource: 1, attempts: 1, last_error: 1, last_error_at: 1 })
    .lean();

  const runs = await SheetSyncRun.find().sort({ started_at: -1 }).limit(runLimit).lean();

  console.log("=== Sheet Sync Queue Inspection ===");
  console.log(`mode: ${getSheetSyncMode()}`);

  console.log("\nJobs by status:");
  if (statusCounts.length === 0) {
    console.log("  (no jobs)");
  } else {
    for (const entry of statusCounts) {
      console.log(`  ${entry._id.padEnd(12)} ${entry.count}`);
    }
  }

  console.log("\nOldest live job:");
  if (oldestPending) {
    const ageMs = Date.now() - new Date(oldestPending.due_at).getTime();
    console.log(
      `  ${oldestPending.coalescing_key} (resource=${oldestPending.resource}, attempts=${oldestPending.attempts}, due ${ageMs > 0 ? `${Math.round(ageMs / 1000)}s ago` : "in future"})`,
    );
  } else {
    console.log("  (none)");
  }

  console.log(`\nMost recent failed jobs (max ${failedLimit}):`);
  if (failed.length === 0) {
    console.log("  (none)");
  } else {
    for (const job of failed) {
      console.log(
        `  ${job.coalescing_key} attempts=${job.attempts} error="${job.last_error ?? ""}"`,
      );
    }
  }

  console.log(`\nRecent runs (max ${runLimit}):`);
  if (runs.length === 0) {
    console.log("  (none)");
  } else {
    for (const run of runs) {
      console.log(
        `  ${new Date(run.started_at).toISOString()} trigger=${run.trigger} status=${run.status} claimed=${run.claimed_job_count} synced=${run.synced_job_count} failed=${run.failed_job_count} deferred=${run.deferred_job_count}`,
      );
    }
  }
}

main()
  .catch((error) => {
    console.error("inspect-sheet-sync-queue failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
