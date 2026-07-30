import {
  estimateAnsweredDurationSeconds,
  evaluateRingCentralCallCandidate,
} from "./call-candidate-evaluator";
import type { RingCentralCallCandidateDocument } from "./call-candidate-types";
import type {
  RingCentralCallSessionAggregateResult,
  RingCentralCallSessionDocument,
} from "./call-session-types";

/**
 * Pure session-level aggregation. Takes every per-party candidate observed
 * for one telephony session and collapses them into a single canonical
 * candidate, then runs the shared evaluator to produce one session decision.
 *
 * Canonical identity selection order (best first):
 *   1. Inbound AND matched to one of our toll-frees
 *   2. queueCall = true (the queue/landing leg)
 *   3. answered = true (an agent actually picked up)
 *   4. longest estimated answered duration
 *   5. most recently updated
 *
 * Source/target identity and call lifecycle timing are intentionally selected
 * separately. Queue legs can disconnect as soon as an agent answers, so timing
 * prefers the answered party and only falls back to every-party terminal state.
 */
export function aggregateRingCentralCallSession(
  parties: RingCentralCallCandidateDocument[],
  now: Date = new Date(),
): RingCentralCallSessionAggregateResult {
  if (parties.length === 0) {
    throw new Error("aggregateRingCentralCallSession requires at least one party");
  }

  const telephonySessionId = parties[0]!.telephonySessionId;
  const canonical = selectCanonicalParty(parties);

  const answeredParties = parties.filter((party) => party.answered);
  const lifecycleParty = selectLifecycleParty(parties);
  const answered = answeredParties.length > 0;
  const answeredAt = earliestDate(
    [lifecycleParty?.answeredAt ?? null, ...answeredParties.map((party) => party.answeredAt)].filter(
      (value): value is Date => value instanceof Date,
    ),
  );

  const terminalParties = parties.filter((party) => party.terminal);
  // A session is "over" when the answered lifecycle party is terminal, or when
  // every observed party has reached a terminal status.
  const terminal =
    lifecycleParty?.terminal === true || parties.every((party) => party.terminal);
  const terminalAt = terminal
    ? lifecycleParty?.terminalAt ??
      latestDate(
        terminalParties
          .map((party) => party.terminalAt)
          .filter((value): value is Date => value instanceof Date),
      )
    : null;
  const terminalStatusCode = terminal
    ? lifecycleParty?.terminalStatusCode ??
      terminalParties.find((party) => party.terminalStatusCode)?.terminalStatusCode ??
      null
    : null;

  const targetMatchedParty =
    parties.find((party) => party.targetMatched && party.sourceCompany) ?? canonical;
  const targetMatched = parties.some((party) => party.targetMatched);

  const estimatedDurationSeconds = estimateAnsweredDurationSeconds(
    answeredAt,
    terminalAt,
    now,
  );

  // Synthetic candidate fed to the shared evaluator so webhook + cron + tests
  // all share the same 120s/answered/inbound/target rules.
  const syntheticCandidate: RingCentralCallCandidateDocument = {
    provider: "ringcentral",
    telephonySessionId,
    sessionId: canonical.sessionId,
    partyId: canonical.partyId,
    firstSeenAt: canonical.firstSeenAt,
    lastSeenAt: canonical.lastSeenAt,
    lastEventTime: canonical.lastEventTime,
    callStartedAt: earliestDate(
      parties
        .map((party) => party.callStartedAt ?? null)
        .filter((value): value is Date => value instanceof Date),
    ),
    lastSequence: canonical.lastSequence,
    direction: canonical.direction,
    statusCode: canonical.statusCode,
    fromPhoneNumber: canonical.fromPhoneNumber ?? targetMatchedParty.fromPhoneNumber,
    fromName: canonical.fromName ?? targetMatchedParty.fromName,
    toPhoneNumber: canonical.toPhoneNumber ?? targetMatchedParty.toPhoneNumber,
    toName: canonical.toName ?? targetMatchedParty.toName,
    normalizedFromPhoneNumber:
      canonical.normalizedFromPhoneNumber ??
      targetMatchedParty.normalizedFromPhoneNumber,
    normalizedToPhoneNumber:
      canonical.normalizedToPhoneNumber ??
      targetMatchedParty.normalizedToPhoneNumber,
    queueCall: parties.some((party) => party.queueCall === true)
      ? true
      : canonical.queueCall,
    missedCall: parties.every((party) => party.missedCall === true)
      ? true
      : canonical.missedCall,
    targetMatched,
    sourceLabel: targetMatchedParty.sourceLabel,
    sourceCompany: targetMatchedParty.sourceCompany,
    routeResolution: targetMatchedParty.routeResolution,
    answered,
    answeredAt,
    terminal,
    terminalStatusCode,
    terminalAt,
    estimatedDurationSeconds,
    decisionStatus: canonical.decisionStatus,
    decisionReason: canonical.decisionReason,
    lastWebhookUuid: canonical.lastWebhookUuid,
    rawLatestParty: canonical.rawLatestParty,
    createdAt: canonical.createdAt,
    updatedAt: canonical.updatedAt,
  };

  const decision = evaluateRingCentralCallCandidate(syntheticCandidate, now);

  const document: RingCentralCallSessionDocument = {
    provider: "ringcentral",
    telephonySessionId,
    sessionId: canonical.sessionId,
    canonicalPartyId: canonical.partyId,
    partyIds: parties.map((party) => party.partyId),
    partyCount: parties.length,
    firstSeenAt: earliestDate(parties.map((party) => party.firstSeenAt)) ?? canonical.firstSeenAt,
    lastSeenAt: latestDate(parties.map((party) => party.lastSeenAt)) ?? canonical.lastSeenAt,
    callStartedAt: syntheticCandidate.callStartedAt,
    direction: canonical.direction,
    statusCode: canonical.statusCode,
    queueCall: syntheticCandidate.queueCall,
    missedCall: syntheticCandidate.missedCall,
    targetMatched,
    sourceLabel: targetMatchedParty.sourceLabel,
    sourceCompany: targetMatchedParty.sourceCompany,
    routeResolution: targetMatchedParty.routeResolution,
    fromPhoneNumber: syntheticCandidate.fromPhoneNumber,
    normalizedFromPhoneNumber: syntheticCandidate.normalizedFromPhoneNumber,
    fromName: syntheticCandidate.fromName,
    toPhoneNumber: syntheticCandidate.toPhoneNumber,
    normalizedToPhoneNumber: syntheticCandidate.normalizedToPhoneNumber,
    toName: syntheticCandidate.toName,
    answered,
    answeredAt,
    terminal,
    terminalStatusCode,
    terminalAt,
    estimatedDurationSeconds,
    decisionStatus: decision.decisionStatus,
    decisionReason: decision.decisionReason,
    wouldCreateCallLead: decision.wouldCreateCallLead,
    ingestEligible: decision.wouldCreateCallLead && terminal,
    leadPreview: decision.leadPreview,
    createdAt: earliestDate(parties.map((party) => party.createdAt)) ?? canonical.createdAt,
    updatedAt: now,
  };

  return { document, decision };
}

function selectCanonicalParty(
  parties: RingCentralCallCandidateDocument[],
): RingCentralCallCandidateDocument {
  return [...parties].sort(compareCanonicalPriority)[0]!;
}

function selectLifecycleParty(
  parties: RingCentralCallCandidateDocument[],
): RingCentralCallCandidateDocument | null {
  const answeredParties = parties.filter((party) => party.answered);
  if (answeredParties.length > 0) {
    return [...answeredParties].sort(compareLifecyclePriority)[0]!;
  }
  return [...parties].sort(compareLifecyclePriority)[0] ?? null;
}

function compareCanonicalPriority(
  left: RingCentralCallCandidateDocument,
  right: RingCentralCallCandidateDocument,
): number {
  return canonicalScore(right) - canonicalScore(left);
}

function compareLifecyclePriority(
  left: RingCentralCallCandidateDocument,
  right: RingCentralCallCandidateDocument,
): number {
  return lifecycleScore(right) - lifecycleScore(left);
}

function canonicalScore(party: RingCentralCallCandidateDocument): number {
  let score = 0;
  if (party.direction === "Inbound") {
    score += 1_000_000;
  }
  if (party.targetMatched && party.sourceCompany) {
    score += 500_000;
  }
  if (party.queueCall === true) {
    score += 100_000;
  }
  if (party.answered) {
    score += 50_000;
  }
  score += Math.min(party.estimatedDurationSeconds ?? 0, 40_000);
  score += Math.min(party.updatedAt.getTime() / 1_000_000, 9_000);
  return score;
}

function lifecycleScore(party: RingCentralCallCandidateDocument): number {
  let score = 0;
  if (party.answered) {
    score += 1_000_000;
  }
  if (party.terminal) {
    score += 500_000;
  }
  if (party.queueCall === true) {
    score += 100_000;
  }
  score += Math.min(party.estimatedDurationSeconds ?? 0, 40_000);
  score += Math.min(party.updatedAt.getTime() / 1_000_000, 9_000);
  return score;
}

function earliestDate(values: Date[]): Date | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((min, value) => (value.getTime() < min.getTime() ? value : min));
}

function latestDate(values: Date[]): Date | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((max, value) => (value.getTime() > max.getTime() ? value : max));
}
