import { getRingCentralCollectionName } from "./ringcentral-config";
import { getRingCentralDb } from "./ringcentral-mongo";

/**
 * High-water-mark cursor for the Call Log cron sync. A single document
 * (`key: "account"`) tracks the end of the last successfully processed window
 * so each run only fetches new records (with a configurable overlap to catch
 * late-arriving call-log rows).
 */
const SYNC_STATE_KEY = "account";

export type RingCentralCallLogSyncStateDocument = {
  key: string;
  provider: "ringcentral";
  lastSyncFrom: Date | null;
  lastSyncTo: Date | null;
  lastRunAt: Date | null;
  lastRunStatus: "success" | "error" | null;
  lastError: string | null;
  lastProcessedCount: number | null;
  lastQualifiedCount: number | null;
  lastLeadActionCount: number | null;
  updatedAt: Date;
};

async function getCollection() {
  const db = await getRingCentralDb();
  return db.collection<RingCentralCallLogSyncStateDocument>(
    getRingCentralCollectionName("callLogSyncState"),
  );
}

export async function getCallLogSyncState(): Promise<RingCentralCallLogSyncStateDocument | null> {
  const collection = await getCollection();
  return collection.findOne({ key: SYNC_STATE_KEY });
}

export async function recordCallLogSyncSuccess(params: {
  syncFrom: Date;
  syncTo: Date;
  processedCount: number;
  qualifiedCount: number;
  leadActionCount: number;
  now?: Date;
}): Promise<void> {
  const collection = await getCollection();
  const now = params.now ?? new Date();
  await collection.updateOne(
    { key: SYNC_STATE_KEY },
    {
      $setOnInsert: { key: SYNC_STATE_KEY, provider: "ringcentral" },
      $set: {
        lastSyncFrom: params.syncFrom,
        lastSyncTo: params.syncTo,
        lastRunAt: now,
        lastRunStatus: "success",
        lastError: null,
        lastProcessedCount: params.processedCount,
        lastQualifiedCount: params.qualifiedCount,
        lastLeadActionCount: params.leadActionCount,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
}

export async function recordCallLogSyncError(params: {
  error: string;
  now?: Date;
}): Promise<void> {
  const collection = await getCollection();
  const now = params.now ?? new Date();
  await collection.updateOne(
    { key: SYNC_STATE_KEY },
    {
      $setOnInsert: { key: SYNC_STATE_KEY, provider: "ringcentral" },
      $set: {
        lastRunAt: now,
        lastRunStatus: "error",
        lastError: params.error,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
}
