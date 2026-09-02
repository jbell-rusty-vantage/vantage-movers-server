import type { SourceCompany } from "../../config/domain";
import { isVantageTestRunner } from "../../config/domain/runtime";
import type { ClientSession } from "mongoose";
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
  | "lead_adopted"
  | "lead_adopted_duplicate"
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

export const RINGCENTRAL_PROCESSED_CALL_LOG_ID_UNIQUE_INDEX = {
  name: "ringcentral_processed_call_log_id_unique",
  key: { callLogId: 1 },
  unique: true,
  sparse: true,
} as const;

export const RINGCENTRAL_PROCESSED_CALL_INDEXES = [
  {
    name: "ringcentral_processed_call_telephony_session_id_unique",
    key: { telephonySessionId: 1 },
    unique: true,
    sparse: true,
  },
  RINGCENTRAL_PROCESSED_CALL_LOG_ID_UNIQUE_INDEX,
  {
    name: "ringcentral_processed_call_status_updated",
    key: { status: 1, updatedAt: -1 },
  },
  {
    name: "ringcentral_processed_call_source_phone",
    key: { sourceCompany: 1, callerPhoneNumber: 1 },
  },
] as const;

export const RINGCENTRAL_PROCESSED_CALL_TERMINAL_STATUSES = [
  "lead_created",
  "lead_created_duplicate",
  "lead_adopted",
  "lead_adopted_duplicate",
  "shadow_recorded",
] as const satisfies readonly RingCentralProcessedCallStatus[];

let indexesReady: Promise<void> | null = null;

async function getCollection(options: { ensureIndexes?: boolean } = {}) {
  const db = await getRingCentralDb();
  if (options.ensureIndexes !== false) {
    await ensureIndexes();
  }
  return db.collection<RingCentralProcessedCallDocument>(
    getRingCentralCollectionName("processedCalls"),
  );
}

function ensureIndexes(): Promise<void> {
  indexesReady ??= createIndexes();
  return indexesReady;
}

export function ensureProcessedCallIndexes(): Promise<void> {
  return ensureIndexes();
}

async function createIndexes(): Promise<void> {
  const db = await getRingCentralDb();
  const collection = db.collection<RingCentralProcessedCallDocument>(
    getRingCentralCollectionName("processedCalls"),
  );
  if (isVantageTestRunner()) {
    const existing = await collection.indexes();
    for (const index of RINGCENTRAL_PROCESSED_CALL_INDEXES) {
      const conflict = existing.find(
        (row) =>
          row.name !== index.name &&
          JSON.stringify(row.key) === JSON.stringify(index.key),
      );
      if (conflict?.name && conflict.name !== "_id_") {
        await collection.dropIndex(conflict.name);
      }
      await collection.createIndex(index.key, {
        name: index.name,
        ...("unique" in index && index.unique ? { unique: true } : {}),
        ...("sparse" in index && index.sparse ? { sparse: true } : {}),
      });
    }
    return;
  }
  const actual = await collection.indexes();
  const missing = RINGCENTRAL_PROCESSED_CALL_INDEXES.filter((expected) => !actual.some((index) =>
    index.name === expected.name &&
    JSON.stringify(index.key) === JSON.stringify(expected.key) &&
    Boolean(index.unique) === Boolean("unique" in expected && expected.unique) &&
    Boolean(index.sparse) === Boolean("sparse" in expected && expected.sparse)
  ));
  if (missing.length > 0) {
    throw new Error("RingCentral processed-call indexes are not predeployed.");
  }
}

export async function findProcessedCall(params: {
  telephonySessionId?: string | null;
  sessionId?: string | null;
  callLogId?: string | null;
  session?: ClientSession;
}): Promise<RingCentralProcessedCallDocument | null> {
  const collection = await getCollection({ ensureIndexes: params.session == null });
  const or: Array<Record<string, string>> = [];
  if (params.telephonySessionId) {
    or.push({ telephonySessionId: params.telephonySessionId });
  }
  if (params.sessionId) {
    or.push({ sessionId: params.sessionId });
  }
  if (params.callLogId) {
    or.push({ callLogId: params.callLogId });
  }
  if (or.length === 0) {
    return null;
  }
  return collection.findOne(
    { $or: or },
    params.session ? { session: params.session } : {},
  );
}

export async function upsertProcessedCall(
  document: Omit<RingCentralProcessedCallDocument, "firstProcessedAt" | "updatedAt"> & {
    now?: Date;
    session?: ClientSession;
  },
): Promise<void> {
  const { now, session, ...rest } = document;
  const timestamp = now ?? new Date();
  const collection = await getCollection({ ensureIndexes: session == null });

  const key = processedCallIdentityKey(rest);
  if (!key) {
    return;
  }
  const persisted: Partial<typeof rest> = { ...rest };
  if (!rest.telephonySessionId) delete persisted.telephonySessionId;
  if (!rest.callLogId) delete persisted.callLogId;

  await collection.updateOne(
    key,
    {
      $setOnInsert: { firstProcessedAt: timestamp },
      $set: { ...persisted, updatedAt: timestamp },
    },
    { upsert: true, ...(session ? { session } : {}) },
  );
}

export function processedCallIdentityKey(input: {
  telephonySessionId?: string | null;
  callLogId?: string | null;
}): { telephonySessionId: string } | { callLogId: string } | null {
  return input.telephonySessionId
    ? { telephonySessionId: input.telephonySessionId }
    : input.callLogId
      ? { callLogId: input.callLogId }
      : null;
}

export async function assertProcessedCallAdoptionIndexes(): Promise<void> {
  const collection = await getCollection();
  const indexes = await collection.indexes();
  const hasUniqueSession = indexes.some(
    (index) =>
      index.unique === true &&
      index.sparse === true &&
      index.key.telephonySessionId === 1 &&
      Object.keys(index.key).length === 1,
  );
  const hasUniqueCallLog = indexes.some(
    (index) =>
      index.unique === true &&
      index.sparse === true &&
      index.key.callLogId === 1 &&
      Object.keys(index.key).length === 1,
  );
  if (!hasUniqueSession || !hasUniqueCallLog) {
    throw new Error(
      "RingCentral adoption requires unique processed-call session and call-log identity indexes.",
    );
  }
}

export async function listProcessedCalls(limit: number) {
  const collection = await getCollection();
  return collection.find({}).sort({ updatedAt: -1 }).limit(limit).toArray();
}
