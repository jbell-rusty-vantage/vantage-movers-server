import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain";
import { connectMongo } from "../../db";
import {
  estimateAnsweredDurationSeconds,
  evaluateRingCentralCallCandidate,
  isLikelyTerminalRingCentralStatus,
} from "./call-candidate-evaluator";
import type {
  CandidateDecision,
  NormalizedRingCentralPartyEvent,
  RingCentralCallCandidateDecisionDocument,
  RingCentralCallCandidateDocument,
} from "./call-candidate-types";
import { getRingCentralCollectionName } from "./ringcentral-config";

export const CALL_CANDIDATES_TEST_COLLECTION =
  getRingCentralCollectionName("callCandidates");
export const CALL_CANDIDATE_DECISIONS_TEST_COLLECTION =
  getRingCentralCollectionName("callCandidateDecisions");

export type CandidateUpdateResult = {
  candidate: RingCentralCallCandidateDocument;
  decision: CandidateDecision;
};

let candidateIndexesReady: Promise<void> | null = null;
let decisionIndexesReady: Promise<void> | null = null;

export async function upsertRingCentralCallCandidateFromEvent(
  event: NormalizedRingCentralPartyEvent,
  now = new Date(),
): Promise<CandidateUpdateResult> {
  const collection = await getCallCandidatesCollection();
  const existing = await collection.findOne({
    provider: "ringcentral",
    telephonySessionId: event.telephonySessionId,
    partyId: event.partyId,
  });

  if (existing && isOlderEvent(existing, event)) {
    const decision = evaluateRingCentralCallCandidate(existing, now);
    return { candidate: existing, decision };
  }

  const candidate = buildCandidateDocument(existing, event, now);
  const decision = evaluateRingCentralCallCandidate(candidate, now);
  const candidateWithDecision: RingCentralCallCandidateDocument = {
    ...candidate,
    estimatedDurationSeconds: estimateAnsweredDurationSeconds(
      candidate.answeredAt,
      candidate.terminalAt,
      now,
    ),
    decisionStatus: decision.decisionStatus,
    decisionReason: decision.decisionReason,
  };

  await collection.updateOne(
    {
      provider: "ringcentral",
      telephonySessionId: event.telephonySessionId,
      partyId: event.partyId,
    },
    {
      $setOnInsert: {
        provider: "ringcentral",
        telephonySessionId: event.telephonySessionId,
        partyId: event.partyId,
        firstSeenAt: candidateWithDecision.firstSeenAt,
        createdAt: candidateWithDecision.createdAt,
      },
      $set: {
        sessionId: candidateWithDecision.sessionId,
        lastSeenAt: candidateWithDecision.lastSeenAt,
        lastEventTime: candidateWithDecision.lastEventTime,
        lastSequence: candidateWithDecision.lastSequence,
        direction: candidateWithDecision.direction,
        statusCode: candidateWithDecision.statusCode,
        fromPhoneNumber: candidateWithDecision.fromPhoneNumber,
        fromName: candidateWithDecision.fromName,
        toPhoneNumber: candidateWithDecision.toPhoneNumber,
        toName: candidateWithDecision.toName,
        normalizedFromPhoneNumber: candidateWithDecision.normalizedFromPhoneNumber,
        normalizedToPhoneNumber: candidateWithDecision.normalizedToPhoneNumber,
        queueCall: candidateWithDecision.queueCall,
        missedCall: candidateWithDecision.missedCall,
        targetMatched: candidateWithDecision.targetMatched,
        sourceLabel: candidateWithDecision.sourceLabel,
        sourceCompany: candidateWithDecision.sourceCompany,
        answered: candidateWithDecision.answered,
        answeredAt: candidateWithDecision.answeredAt,
        terminal: candidateWithDecision.terminal,
        terminalStatusCode: candidateWithDecision.terminalStatusCode,
        terminalAt: candidateWithDecision.terminalAt,
        estimatedDurationSeconds: candidateWithDecision.estimatedDurationSeconds,
        decisionStatus: candidateWithDecision.decisionStatus,
        decisionReason: candidateWithDecision.decisionReason,
        lastWebhookUuid: candidateWithDecision.lastWebhookUuid,
        rawLatestParty: candidateWithDecision.rawLatestParty,
        updatedAt: candidateWithDecision.updatedAt,
      },
    },
    { upsert: true },
  );

  return { candidate: candidateWithDecision, decision };
}

export async function storeRingCentralCallCandidateDecision(
  candidate: RingCentralCallCandidateDocument,
  decision: CandidateDecision,
): Promise<void> {
  const collection = await getCallCandidateDecisionsCollection();
  const document: RingCentralCallCandidateDecisionDocument = {
    ...decision,
    provider: "ringcentral",
    telephonySessionId: candidate.telephonySessionId,
    sessionId: candidate.sessionId,
    partyId: candidate.partyId,
    candidateUpdatedAt: candidate.updatedAt,
    createdAt: new Date(),
  };

  await collection.insertOne(document);
}

export async function listRingCentralCallCandidates(limit: number) {
  const collection = await getCallCandidatesCollection();
  return collection
    .find({}, { projection: { rawLatestParty: 0 } })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();
}

export async function listRingCentralCallCandidateDecisions(limit: number) {
  const collection = await getCallCandidateDecisionsCollection();
  return collection.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function findRingCentralCallCandidatesByTelephonySessionId(
  telephonySessionId: string,
) {
  const collection = await getCallCandidatesCollection();
  return collection
    .find({ provider: "ringcentral", telephonySessionId })
    .sort({ updatedAt: -1 })
    .toArray();
}

/**
 * Pure folder: applies a normalized party event onto the existing per-party
 * candidate (or builds a fresh one). Exported so offline tooling (the
 * workflow test harness) can replay webhook payloads into candidates without
 * a database.
 */
export function buildRingCentralCandidateDocument(
  existing: RingCentralCallCandidateDocument | null,
  event: NormalizedRingCentralPartyEvent,
  now: Date = new Date(),
): RingCentralCallCandidateDocument {
  return buildCandidateDocument(existing, event, now);
}

function buildCandidateDocument(
  existing: RingCentralCallCandidateDocument | null,
  event: NormalizedRingCentralPartyEvent,
  now: Date,
): RingCentralCallCandidateDocument {
  const observedAt = event.eventTime ?? event.timestamp ?? event.receivedAt;
  const wasAnswered = existing?.answered === true;
  const isAnswered = event.statusCode === "Answered";
  const answered = wasAnswered || isAnswered;
  const terminalStatus = isLikelyTerminalRingCentralStatus(event.statusCode)
    ? event.statusCode
    : existing?.terminalStatusCode ?? null;
  const terminal = existing?.terminal === true || terminalStatus !== null;
  const existingTargetMatched = existing?.targetMatched === true;
  const targetMatched = existingTargetMatched || event.targetMatched;

  return {
    provider: "ringcentral",
    telephonySessionId: event.telephonySessionId,
    sessionId: event.sessionId ?? existing?.sessionId ?? null,
    partyId: event.partyId,
    firstSeenAt: existing?.firstSeenAt ?? event.receivedAt,
    lastSeenAt: event.receivedAt,
    lastEventTime: observedAt,
    lastSequence: event.sequence ?? existing?.lastSequence ?? null,
    direction: event.direction ?? existing?.direction ?? null,
    statusCode: event.statusCode ?? existing?.statusCode ?? null,
    fromPhoneNumber: event.fromPhoneNumber ?? existing?.fromPhoneNumber ?? null,
    fromName: event.fromName ?? existing?.fromName ?? null,
    toPhoneNumber: event.toPhoneNumber ?? existing?.toPhoneNumber ?? null,
    toName: event.toName ?? existing?.toName ?? null,
    normalizedFromPhoneNumber:
      event.normalizedFromPhoneNumber ?? existing?.normalizedFromPhoneNumber ?? null,
    normalizedToPhoneNumber:
      event.normalizedToPhoneNumber ?? existing?.normalizedToPhoneNumber ?? null,
    queueCall: event.queueCall ?? existing?.queueCall ?? null,
    missedCall: event.missedCall ?? existing?.missedCall ?? null,
    targetMatched,
    sourceLabel: event.sourceLabel ?? existing?.sourceLabel ?? null,
    sourceCompany: event.sourceCompany ?? existing?.sourceCompany ?? null,
    answered,
    answeredAt:
      existing?.answeredAt ?? (isAnswered ? observedAt : null),
    terminal,
    terminalStatusCode: terminalStatus,
    terminalAt:
      existing?.terminalAt ?? (terminalStatus ? observedAt : null),
    estimatedDurationSeconds: existing?.estimatedDurationSeconds ?? null,
    decisionStatus:
      existing?.decisionStatus ??
      (targetMatched ? "candidate" : "not_candidate"),
    decisionReason: existing?.decisionReason ?? null,
    lastWebhookUuid: event.webhookUuid ?? existing?.lastWebhookUuid ?? null,
    rawLatestParty: event.rawParty,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function isOlderEvent(
  existing: RingCentralCallCandidateDocument,
  event: NormalizedRingCentralPartyEvent,
): boolean {
  if (existing.lastSequence === null || event.sequence === null) {
    return false;
  }
  return event.sequence < existing.lastSequence;
}

async function getCallCandidatesCollection() {
  await connectMongo();
  await ensureCandidateIndexes();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), {
    useCache: true,
  }).db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }

  return db.collection<RingCentralCallCandidateDocument>(
    CALL_CANDIDATES_TEST_COLLECTION,
  );
}

async function getCallCandidateDecisionsCollection() {
  await connectMongo();
  await ensureDecisionIndexes();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), {
    useCache: true,
  }).db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }

  return db.collection<RingCentralCallCandidateDecisionDocument>(
    CALL_CANDIDATE_DECISIONS_TEST_COLLECTION,
  );
}

function ensureCandidateIndexes(): Promise<void> {
  candidateIndexesReady ??= createCandidateIndexes();
  return candidateIndexesReady;
}

function ensureDecisionIndexes(): Promise<void> {
  decisionIndexesReady ??= createDecisionIndexes();
  return decisionIndexesReady;
}

async function createCandidateIndexes(): Promise<void> {
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), {
    useCache: true,
  }).db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }

  const collection = db.collection<RingCentralCallCandidateDocument>(
    CALL_CANDIDATES_TEST_COLLECTION,
  );
  await collection.createIndex(
    { provider: 1, telephonySessionId: 1, partyId: 1 },
    { unique: true },
  );
  await collection.createIndex({ provider: 1, updatedAt: -1 });
  await collection.createIndex({ sourceCompany: 1, decisionStatus: 1 });
  await collection.createIndex({ normalizedFromPhoneNumber: 1 });
  await collection.createIndex({ normalizedToPhoneNumber: 1 });
}

async function createDecisionIndexes(): Promise<void> {
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), {
    useCache: true,
  }).db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }

  const collection = db.collection<RingCentralCallCandidateDecisionDocument>(
    CALL_CANDIDATE_DECISIONS_TEST_COLLECTION,
  );
  await collection.createIndex({ provider: 1, createdAt: -1 });
  await collection.createIndex({ telephonySessionId: 1, partyId: 1 });
  await collection.createIndex({ decisionStatus: 1 });
  await collection.createIndex({ wouldCreateCallLead: 1 });
}
