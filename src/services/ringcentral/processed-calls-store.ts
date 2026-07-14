import type { SourceCompany } from "./call-lead-sources";
import { getRingCentralCollectionName } from "./ringcentral-config";
import { getRingCentralDb } from "./ringcentral-mongo";

/**
 * Idempotency + audit ledger for every qualified RingCentral call the
 * pipeline has acted on, keyed by `telephonySessionId`. Both the webhook and
 * cron paths consult and write this collection so a session that a webhook
 * already turned into a lead is never re-created when the cron re-scans the
 * same window ten minutes later.
 */
export type RingCentralProcessedCallStatus =
  | "lead_created"
  | "lead_created_duplicate"
  | "shadow_recorded"
  | "dry_run"
  | "skipped";

export type RingCentralProcessedCallDocument = {
  provider: "ringcentral";
  telephonySessionId: string | null;
  sessionId: string | null;
  callLogId: string | null;
  ingestionSource: "webhook" | "call_log_sync";
  status: RingCentralProcessedCallStatus;
  duplicate: boolean;
  duplicateReason: string | null;
  sourceCompany: SourceCompany | null;
  sourceLabel: string | null;
  callerPhoneNumber: string | null;
  durationSeconds: number | null;
  qualificationReason: string | null;
  callLeadId: string | null;
  firstProcessedAt: Date;
  updatedAt: Date;
};

let indexesReady: Promise<void> | null = null;

async function getCollection() {
  const db = await getRingCentralDb();
  await ensureIndexes();
  return db.collection<RingCentralProcessedCallDocument>(
    getRingCentralCollectionName("processedCalls"),
  );
}

function ensureIndexes(): Promise<void> {
  indexesReady ??= createIndexes();
  return indexesReady;
}

async function createIndexes(): Promise<void> {
  const db = await getRingCentralDb();
  const collection = db.collection<RingCentralProcessedCallDocument>(
    getRingCentralCollectionName("processedCalls"),
  );
  await collection.createIndex(
    { telephonySessionId: 1 },
    { unique: true, sparse: true },
  );
  await collection.createIndex({ callLogId: 1 }, { sparse: true });
  await collection.createIndex({ status: 1, updatedAt: -1 });
  await collection.createIndex({ sourceCompany: 1, callerPhoneNumber: 1 });
}

export async function findProcessedCall(params: {
  telephonySessionId?: string | null;
  callLogId?: string | null;
}): Promise<RingCentralProcessedCallDocument | null> {
  const collection = await getCollection();
  const or: Array<Record<string, string>> = [];
  if (params.telephonySessionId) {
    or.push({ telephonySessionId: params.telephonySessionId });
  }
  if (params.callLogId) {
    or.push({ callLogId: params.callLogId });
  }
  if (or.length === 0) {
    return null;
  }
  return collection.findOne({ $or: or });
}

export async function upsertProcessedCall(
  document: Omit<RingCentralProcessedCallDocument, "firstProcessedAt" | "updatedAt"> & {
    now?: Date;
  },
): Promise<void> {
  const { now, ...rest } = document;
  const timestamp = now ?? new Date();
  const collection = await getCollection();

  const key = rest.telephonySessionId
    ? { telephonySessionId: rest.telephonySessionId }
    : rest.callLogId
      ? { callLogId: rest.callLogId }
      : null;
  if (!key) {
    return;
  }

  await collection.updateOne(
    key,
    {
      $setOnInsert: { firstProcessedAt: timestamp },
      $set: { ...rest, updatedAt: timestamp },
    },
    { upsert: true },
  );
}

export async function listProcessedCalls(limit: number) {
  const collection = await getCollection();
  return collection.find({}).sort({ updatedAt: -1 }).limit(limit).toArray();
}
