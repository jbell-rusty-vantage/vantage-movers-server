import mongoose from "mongoose";
import { getSheetSyncMode } from "../../config/domain";
import { SheetSyncAttempt } from "../../models/SheetSyncAttempt";
import { SheetSyncJob } from "../../models/SheetSyncJob";
import { SheetSyncRun } from "../../models/SheetSyncRun";
import { publishSheetSyncWakeup } from "../sheetSync";
import { V1ServiceError } from "../v1ServiceError";
import type {
  SheetSyncJobsQuery,
  SheetSyncRunsQuery,
  SheetSyncRetryInput,
} from "../../validation/v1.validation";

/**
 * Read-only admin surface plus a bounded retry control for the sheet-sync
 * outbox. Mutation is deliberately limited to re-queuing already-terminal jobs
 * (`failed`/`cancelled`) back to `pending`; there is no destructive "heal" that
 * could fight the drainer for the same rows.
 */

/** Aggregate snapshot for the admin health card. */
export async function getSheetSyncHealth() {
  const [statusCounts, oldestPending, lastRun] = await Promise.all([
    SheetSyncJob.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    SheetSyncJob.findOne({ status: { $in: ["pending", "retrying"] } })
      .sort({ due_at: 1 })
      .select({ due_at: 1, coalescing_key: 1, resource: 1 })
      .lean(),
    SheetSyncRun.findOne().sort({ started_at: -1 }).lean(),
  ]);

  const jobsByStatus: Record<string, number> = {};
  for (const entry of statusCounts) {
    jobsByStatus[entry._id] = entry.count;
  }

  const now = Date.now();
  const oldestPendingDueAt = oldestPending?.due_at ?? null;
  const backlogAgeMs =
    oldestPendingDueAt && oldestPendingDueAt.getTime() < now
      ? now - oldestPendingDueAt.getTime()
      : 0;

  return {
    mode: getSheetSyncMode(),
    jobs_by_status: jobsByStatus,
    pending: (jobsByStatus.pending ?? 0) + (jobsByStatus.retrying ?? 0),
    failed: jobsByStatus.failed ?? 0,
    processing: jobsByStatus.processing ?? 0,
    oldest_pending_due_at: oldestPendingDueAt,
    backlog_age_ms: backlogAgeMs,
    last_run: lastRun ?? null,
  };
}

export async function listSheetSyncJobs(query: SheetSyncJobsQuery) {
  const filter: Record<string, unknown> = {};
  if (query.status) {
    filter.status = query.status;
  }
  if (query.resource) {
    filter.resource = query.resource;
  }
  if (query.entity_id) {
    filter.entity_id = query.entity_id;
  }

  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    SheetSyncJob.find(filter)
      .sort({ due_at: 1, priority: -1, createdAt: 1 })
      .skip(skip)
      .limit(query.limit)
      .lean(),
    SheetSyncJob.countDocuments(filter),
  ]);

  return { items, total, page: query.page, limit: query.limit };
}

export async function listSheetSyncRuns(query: SheetSyncRunsQuery) {
  const filter: Record<string, unknown> = {};
  if (query.status) {
    filter.status = query.status;
  }

  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    SheetSyncRun.find(filter).sort({ started_at: -1 }).skip(skip).limit(query.limit).lean(),
    SheetSyncRun.countDocuments(filter),
  ]);

  return { items, total, page: query.page, limit: query.limit };
}

export async function getSheetSyncRunDetail(id: string) {
  if (!mongoose.isValidObjectId(id)) {
    throw new V1ServiceError("Invalid run id", 400);
  }
  const run = await SheetSyncRun.findById(id).lean();
  if (!run) {
    throw new V1ServiceError("Sheet sync run not found", 404);
  }
  const attempts = await SheetSyncAttempt.find({ run_id: id }).sort({ createdAt: 1 }).lean();
  return { run, attempts };
}

/**
 * Re-queues terminal jobs to `pending` with an immediate `due_at`, clearing the
 * lease so the next drain claims them. Defaults to `failed` jobs when no filter
 * is supplied. Returns the number actually re-queued and publishes a wake-up so
 * a drain runs promptly.
 */
export async function retrySheetSyncJobs(input: SheetSyncRetryInput) {
  const filter: Record<string, unknown> = {};
  if (input.job_ids && input.job_ids.length > 0) {
    filter._id = { $in: input.job_ids.map((id) => new mongoose.Types.ObjectId(id)) };
  } else {
    filter.status = { $in: input.statuses ?? ["failed"] };
  }

  const ids = await SheetSyncJob.find(filter).limit(input.limit).select({ _id: 1 }).lean();
  if (ids.length === 0) {
    return { requeued: 0 };
  }

  const result = await SheetSyncJob.updateMany(
    { _id: { $in: ids.map((doc) => doc._id) } },
    {
      $set: {
        status: "pending",
        due_at: new Date(),
        attempts: 0,
        created_by: "admin",
      },
      $unset: { leased_until: "", lease_owner: "", last_error: "", last_error_at: "" },
    },
  );

  await publishSheetSyncWakeup({ reason: "admin_retry" });

  return { requeued: result.modifiedCount };
}
