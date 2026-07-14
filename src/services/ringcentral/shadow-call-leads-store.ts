import type { SourceCompany } from "./call-lead-sources";
import { getRingCentralCollectionName } from "./ringcentral-config";
import { getRingCentralDb } from "./ringcentral-mongo";

/**
 * Staging collection for "shadow" call leads. When
 * `RINGCENTRAL_SHADOW_CALL_LEADS=true` (and real creation is off), qualified
 * calls are written here instead of `call_leads`, so a production deployment
 * can be observed end-to-end without producing billable leads.
 */
export type RingCentralShadowCallLeadDocument = {
  provider: "ringcentral";
  telephonySessionId: string | null;
  sessionId: string | null;
  callLogId: string | null;
  ingestionSource: "webhook" | "call_log_sync";
  sourceCompany: SourceCompany;
  sourceLabel: string | null;
  callerPhoneNumber: string;
  callerName: string | null;
  targetPhoneNumber: string;
  duration: number | null;
  answeredAt: Date | null;
  terminalAt: Date | null;
  duplicate: boolean;
  qualificationReason: string | null;
  createdAt: Date;
};

let indexesReady: Promise<void> | null = null;

async function getCollection() {
  const db = await getRingCentralDb();
  await ensureIndexes();
  return db.collection<RingCentralShadowCallLeadDocument>(
    getRingCentralCollectionName("shadowCallLeads"),
  );
}

function ensureIndexes(): Promise<void> {
  indexesReady ??= createIndexes();
  return indexesReady;
}

async function createIndexes(): Promise<void> {
  const db = await getRingCentralDb();
  const collection = db.collection<RingCentralShadowCallLeadDocument>(
    getRingCentralCollectionName("shadowCallLeads"),
  );
  await collection.createIndex(
    { telephonySessionId: 1 },
    { unique: true, sparse: true },
  );
  await collection.createIndex({ sourceCompany: 1, createdAt: -1 });
}

export async function insertShadowCallLead(
  document: Omit<RingCentralShadowCallLeadDocument, "provider" | "createdAt"> & {
    now?: Date;
  },
): Promise<string | null> {
  const { now, ...rest } = document;
  const collection = await getCollection();
  try {
    const result = await collection.insertOne({
      provider: "ringcentral",
      createdAt: now ?? new Date(),
      ...rest,
    });
    return result.insertedId?.toString() ?? null;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return null;
    }
    throw error;
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === 11000
  );
}
