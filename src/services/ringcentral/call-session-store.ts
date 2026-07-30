import { findRingCentralCallCandidatesByTelephonySessionId } from "./call-candidate-store";
import { aggregateRingCentralCallSession } from "./call-session-aggregator";
import type {
  RingCentralCallSessionDecisionDocument,
  RingCentralCallSessionDocument,
} from "./call-session-types";
import type { RingCentralDecisionStatus } from "./call-candidate-types";
import { getRingCentralCollectionName } from "./ringcentral-config";
import { getRingCentralDb } from "./ringcentral-mongo";

/**
 * Persistence for session-level aggregates. Unlike the per-party decision
 * trail (which logs on every webhook tick), session decisions are only
 * recorded on a *status transition* (e.g. candidate -> pending_buffer ->
 * qualified), keeping the audit trail compact and meaningful.
 */
export type ProcessRingCentralSessionResult = {
  document: RingCentralCallSessionDocument;
  previousStatus: RingCentralDecisionStatus | null;
  statusChanged: boolean;
};

let sessionIndexesReady: Promise<void> | null = null;
let sessionDecisionIndexesReady: Promise<void> | null = null;

/**
 * Rebuilds the session aggregate for a telephony session from its current
 * per-party candidates, persists it, and records a decision document iff the
 * decision status changed. Returns the aggregate so callers can decide
 * whether to ingest a lead (`document.ingestEligible`).
 */
export async function processRingCentralCallSession(
  telephonySessionId: string,
  now: Date = new Date(),
): Promise<ProcessRingCentralSessionResult | null> {
  const parties = await findRingCentralCallCandidatesByTelephonySessionId(
    telephonySessionId,
  );
  if (parties.length === 0) {
    return null;
  }

  const { document } = aggregateRingCentralCallSession(parties, now);
  const collection = await getSessionsCollection();

  const previous = await collection.findOne({
    provider: "ringcentral",
    telephonySessionId,
  });
  const previousStatus = previous?.decisionStatus ?? null;
  const statusChanged = previousStatus !== document.decisionStatus;

  await collection.updateOne(
    { provider: "ringcentral", telephonySessionId },
    {
      $setOnInsert: {
        provider: "ringcentral",
        telephonySessionId,
        createdAt: document.createdAt,
      },
      $set: {
        sessionId: document.sessionId,
        canonicalPartyId: document.canonicalPartyId,
        partyIds: document.partyIds,
        partyCount: document.partyCount,
        firstSeenAt: document.firstSeenAt,
        lastSeenAt: document.lastSeenAt,
        callStartedAt: document.callStartedAt,
        direction: document.direction,
        statusCode: document.statusCode,
        queueCall: document.queueCall,
        missedCall: document.missedCall,
        targetMatched: document.targetMatched,
        sourceLabel: document.sourceLabel,
        sourceCompany: document.sourceCompany,
        routeResolution: document.routeResolution,
        fromPhoneNumber: document.fromPhoneNumber,
        normalizedFromPhoneNumber: document.normalizedFromPhoneNumber,
        fromName: document.fromName,
        toPhoneNumber: document.toPhoneNumber,
        normalizedToPhoneNumber: document.normalizedToPhoneNumber,
        toName: document.toName,
        answered: document.answered,
        answeredAt: document.answeredAt,
        terminal: document.terminal,
        terminalStatusCode: document.terminalStatusCode,
        terminalAt: document.terminalAt,
        estimatedDurationSeconds: document.estimatedDurationSeconds,
        decisionStatus: document.decisionStatus,
        decisionReason: document.decisionReason,
        wouldCreateCallLead: document.wouldCreateCallLead,
        ingestEligible: document.ingestEligible,
        leadPreview: document.leadPreview,
        updatedAt: document.updatedAt,
      },
    },
    { upsert: true },
  );

  if (statusChanged) {
    await recordSessionDecision(document, previousStatus);
  }

  return { document, previousStatus, statusChanged };
}

async function recordSessionDecision(
  document: RingCentralCallSessionDocument,
  previousStatus: RingCentralDecisionStatus | null,
): Promise<void> {
  const collection = await getSessionDecisionsCollection();
  const decisionDocument: RingCentralCallSessionDecisionDocument = {
    provider: "ringcentral",
    telephonySessionId: document.telephonySessionId,
    sessionId: document.sessionId,
    canonicalPartyId: document.canonicalPartyId,
    decisionStatus: document.decisionStatus,
    decisionReason: document.decisionReason,
    wouldCreateCallLead: document.wouldCreateCallLead,
    ingestEligible: document.ingestEligible,
    estimatedDurationSeconds: document.estimatedDurationSeconds,
    previousDecisionStatus: previousStatus,
    createdAt: new Date(),
  };
  await collection.insertOne(decisionDocument);
}

export async function listRingCentralCallSessions(limit: number) {
  const collection = await getSessionsCollection();
  return collection
    .find({}, { projection: { leadPreview: 0 } })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();
}

export async function listRingCentralCallSessionDecisions(limit: number) {
  const collection = await getSessionDecisionsCollection();
  return collection.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function findRingCentralCallSession(telephonySessionId: string) {
  const collection = await getSessionsCollection();
  return collection.findOne({ provider: "ringcentral", telephonySessionId });
}

async function getSessionsCollection() {
  const db = await getRingCentralDb();
  await ensureSessionIndexes();
  return db.collection<RingCentralCallSessionDocument>(
    getRingCentralCollectionName("callSessions"),
  );
}

async function getSessionDecisionsCollection() {
  const db = await getRingCentralDb();
  await ensureSessionDecisionIndexes();
  return db.collection<RingCentralCallSessionDecisionDocument>(
    getRingCentralCollectionName("callSessionDecisions"),
  );
}

function ensureSessionIndexes(): Promise<void> {
  sessionIndexesReady ??= createSessionIndexes();
  return sessionIndexesReady;
}

function ensureSessionDecisionIndexes(): Promise<void> {
  sessionDecisionIndexesReady ??= createSessionDecisionIndexes();
  return sessionDecisionIndexesReady;
}

async function createSessionIndexes(): Promise<void> {
  const db = await getRingCentralDb();
  const collection = db.collection<RingCentralCallSessionDocument>(
    getRingCentralCollectionName("callSessions"),
  );
  await collection.createIndex(
    { provider: 1, telephonySessionId: 1 },
    { unique: true },
  );
  await collection.createIndex({ updatedAt: -1 });
  await collection.createIndex({ decisionStatus: 1, updatedAt: -1 });
  await collection.createIndex({ ingestEligible: 1 });
}

async function createSessionDecisionIndexes(): Promise<void> {
  const db = await getRingCentralDb();
  const collection = db.collection<RingCentralCallSessionDecisionDocument>(
    getRingCentralCollectionName("callSessionDecisions"),
  );
  await collection.createIndex({ telephonySessionId: 1, createdAt: -1 });
  await collection.createIndex({ decisionStatus: 1, createdAt: -1 });
}
