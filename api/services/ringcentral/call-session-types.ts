import type {
  CandidateDecision,
  RingCentralDecisionStatus,
} from "./call-candidate-types";
import type { SourceCompany } from "./call-lead-sources";

/**
 * Session-level aggregate for a single RingCentral telephony session.
 *
 * One inbound call produces several parties (queue, agent, etc.). The
 * per-party `RingCentralCallCandidateDocument` rows remain the raw building
 * blocks; this document rolls them up to the `telephonySessionId` so the lead
 * pipeline reasons about "one call = one decision = at most one lead" rather
 * than per-party candidates.
 */
export type RingCentralCallSessionDocument = {
  provider: "ringcentral";

  telephonySessionId: string;
  sessionId: string | null;

  canonicalPartyId: string | null;
  partyIds: string[];
  partyCount: number;

  firstSeenAt: Date;
  lastSeenAt: Date;

  direction: string | null;
  statusCode: string | null;
  queueCall: boolean | null;
  missedCall: boolean | null;

  targetMatched: boolean;
  sourceLabel: string | null;
  sourceCompany: SourceCompany | null;

  fromPhoneNumber: string | null;
  normalizedFromPhoneNumber: string | null;
  fromName: string | null;

  toPhoneNumber: string | null;
  normalizedToPhoneNumber: string | null;
  toName: string | null;

  answered: boolean;
  answeredAt: Date | null;

  terminal: boolean;
  terminalStatusCode: string | null;
  terminalAt: Date | null;

  estimatedDurationSeconds: number;

  decisionStatus: RingCentralDecisionStatus;
  decisionReason: string;
  wouldCreateCallLead: boolean;

  /**
   * True only when the session both qualifies and has reached a terminal
   * status, i.e. the call is over and its answered duration is final. The
   * webhook path only ingests leads when this is true so durations are
   * accurate; the cron path independently catches anything missed.
   */
  ingestEligible: boolean;

  leadPreview: CandidateDecision["leadPreview"];

  createdAt: Date;
  updatedAt: Date;
};

export type RingCentralCallSessionDecisionDocument = {
  provider: "ringcentral";
  telephonySessionId: string;
  sessionId: string | null;
  canonicalPartyId: string | null;
  decisionStatus: RingCentralDecisionStatus;
  decisionReason: string;
  wouldCreateCallLead: boolean;
  ingestEligible: boolean;
  estimatedDurationSeconds: number;
  previousDecisionStatus: RingCentralDecisionStatus | null;
  createdAt: Date;
};

export type RingCentralCallSessionAggregateResult = {
  document: RingCentralCallSessionDocument;
  decision: CandidateDecision;
};
