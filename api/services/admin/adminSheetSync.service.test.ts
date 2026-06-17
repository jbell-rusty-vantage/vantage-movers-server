import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import {
  clearCapturedOperationalEvents,
  getCapturedOperationalEvents,
} from "../observability";
import { SheetSyncJob } from "../../models/SheetSyncJob";
import { SheetSyncRun } from "../../models/SheetSyncRun";
import {
  getSheetSyncHealth,
  listSheetSyncJobs,
  retrySheetSyncJobs,
} from "./adminSheetSync.service";

const original: Record<string, unknown> = {
  aggregate: SheetSyncJob.aggregate,
  findOne: SheetSyncJob.findOne,
  find: SheetSyncJob.find,
  countDocuments: SheetSyncJob.countDocuments,
  updateMany: SheetSyncJob.updateMany,
};
const originalRunFindOne = SheetSyncRun.findOne;
const originalEnv = {
  vercel: process.env.VERCEL,
  vercelEnv: process.env.VERCEL_ENV,
  sheetSyncQueueTopic: process.env.SHEET_SYNC_QUEUE_TOPIC,
};

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    (SheetSyncJob as any)[key] = value;
  }
  (SheetSyncRun as any).findOne = originalRunFindOne;
  clearCapturedOperationalEvents();
  restoreEnv("VERCEL", originalEnv.vercel);
  restoreEnv("VERCEL_ENV", originalEnv.vercelEnv);
  restoreEnv("SHEET_SYNC_QUEUE_TOPIC", originalEnv.sheetSyncQueueTopic);
});

/** Minimal chainable query stub that resolves to `result` on await/.lean(). */
function chain(result: unknown) {
  const q: any = {
    sort: () => q,
    skip: () => q,
    limit: () => q,
    select: () => q,
    lean: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return q;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test("getSheetSyncHealth aggregates job counts and derives backlog age", async () => {
  (SheetSyncJob as any).aggregate = () =>
    Promise.resolve([
      { _id: "pending", count: 3 },
      { _id: "retrying", count: 1 },
      { _id: "failed", count: 2 },
    ]);
  const oldDue = new Date(Date.now() - 60_000);
  (SheetSyncJob as any).findOne = () => chain({ due_at: oldDue, resource: "source_lead" });
  (SheetSyncRun as any).findOne = () => chain(null);

  const health = await getSheetSyncHealth();
  assert.equal(health.pending, 4);
  assert.equal(health.failed, 2);
  assert.equal(health.jobs_by_status.pending, 3);
  assert.ok(health.backlog_age_ms >= 60_000 - 5_000);
});

test("listSheetSyncJobs builds a filtered, paginated query", async () => {
  let captured: any;
  (SheetSyncJob as any).find = (filter: any) => {
    captured = filter;
    return chain([{ _id: "j1" }]);
  };
  (SheetSyncJob as any).countDocuments = () => Promise.resolve(1);

  const result = await listSheetSyncJobs({
    status: "failed",
    resource: "source_lead",
    limit: 50,
    page: 2,
  } as any);

  assert.deepEqual(captured, { status: "failed", resource: "source_lead" });
  assert.equal(result.total, 1);
  assert.equal(result.page, 2);
});

test("retrySheetSyncJobs re-queues failed jobs by default and reports the count", async () => {
  let updateFilter: any;
  let updateBody: any;
  const id = new mongoose.Types.ObjectId();
  (SheetSyncJob as any).find = (filter: any) => {
    updateFilter = filter;
    return chain([{ _id: id }]);
  };
  (SheetSyncJob as any).updateMany = (filter: any, body: any) => {
    updateBody = body;
    return Promise.resolve({ modifiedCount: 1 });
  };

  const result = await retrySheetSyncJobs({ limit: 100 } as any);

  assert.deepEqual(updateFilter, { status: { $in: ["failed"] } });
  assert.equal(updateBody.$set.status, "pending");
  assert.equal(updateBody.$set.created_by, "admin");
  assert.ok("leased_until" in updateBody.$unset);
  assert.equal(result.requeued, 1);
});

test("retrySheetSyncJobs skips queue publishing and observability writes outside production", async () => {
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "preview";
  process.env.SHEET_SYNC_QUEUE_TOPIC = "sheet-sync-events-dev";

  const id = new mongoose.Types.ObjectId();
  (SheetSyncJob as any).find = () => chain([{ _id: id }]);
  (SheetSyncJob as any).updateMany = () => Promise.resolve({ modifiedCount: 1 });

  const result = await retrySheetSyncJobs({ limit: 100 } as any);

  assert.equal(result.requeued, 1);
  assert.equal(
    getCapturedOperationalEvents().some(
      (event) => event.input.eventKey === "sheet_sync.queue.publish_failed",
    ),
    false,
  );
});

test("retrySheetSyncJobs is a no-op when nothing matches", async () => {
  (SheetSyncJob as any).find = () => chain([]);
  let updateCalled = false;
  (SheetSyncJob as any).updateMany = () => {
    updateCalled = true;
    return Promise.resolve({ modifiedCount: 0 });
  };

  const result = await retrySheetSyncJobs({ statuses: ["cancelled"], limit: 10 } as any);
  assert.equal(result.requeued, 0);
  assert.equal(updateCalled, false);
});
