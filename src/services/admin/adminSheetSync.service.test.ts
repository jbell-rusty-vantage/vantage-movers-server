import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { SheetSyncJob } from "../../models/SheetSyncJob";
import { retrySheetSyncJobs } from "./adminSheetSync.service";

const original: Record<string, unknown> = {
  find: SheetSyncJob.find,
  updateMany: SheetSyncJob.updateMany,
};
const originalEnv = {
  vercel: process.env.VERCEL,
  vercelEnv: process.env.VERCEL_ENV,
  sheetSyncQueueTopic: process.env.SHEET_SYNC_QUEUE_TOPIC,
};

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    (SheetSyncJob as any)[key] = value;
  }
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

test("retrySheetSyncJobs starts an admin drain instead of publishing a queue wake-up", async () => {
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "preview";
  process.env.SHEET_SYNC_QUEUE_TOPIC = "sheet-sync-events-dev";
  let drainStarted = false;

  const id = new mongoose.Types.ObjectId();
  (SheetSyncJob as any).find = () => chain([{ _id: id }]);
  (SheetSyncJob as any).updateMany = () => Promise.resolve({ modifiedCount: 1 });

  const result = await retrySheetSyncJobs({ limit: 100 } as any, {
    startDrain: () => {
      drainStarted = true;
    },
  });

  assert.equal(result.requeued, 1);
  assert.equal(result.drain_started, true);
  assert.equal(drainStarted, true);
});
