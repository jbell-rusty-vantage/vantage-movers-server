import type { RingCentralRouteResolution } from "../operationsRegistry";

export type RingCentralDecisionStatus =
  | "not_candidate"
  | "candidate"
  | "pending_buffer"
  | "qualified"
  | "rejected"
  | "needs_review";

export type NormalizedRingCentralPartyEvent = {
  provider: "ringcentral";

  webhookUuid: string | null;
  subscriptionId: string | null;
  event: string | null;
  ownerId: string | null;

  timestamp: Date | null;
  eventTime: Date | null;
  callStartedAt?: Date | null;
  receivedAt: Date;

  sequence: number | null;
  sessionId: string | null;
  telephonySessionId: string;
  partyId: string;

  direction: "Inbound" | "Outbound" | string | null;
  statusCode: string | null;

  fromPhoneNumber: string | null;
  fromName: string | null;

  toPhoneNumber: string | null;
  toName: string | null;

  normalizedFromPhoneNumber: string | null;
  normalizedToPhoneNumber: string | null;

  queueCall: boolean | null;
  missedCall: boolean | null;

  uiPrimaryType: string | null;
  uiPrimaryValue: string | null;
  uiAdditionalType: string | null;
  uiAdditionalValue: string | null;

  targetMatched: boolean;
  sourceLabel: string | null;
  sourceCompany: string | null;
  routeResolution: RingCentralRouteResolution | null;

  rawParty: unknown;
};

export type RingCentralWebhookEventDocument = {
  provider: "ringcentral";
  receivedAt: Date;
  validationTokenPresent: boolean;
  headers: Record<string, string | string[] | undefined>;
  rawBody: unknown;

  uuid?: string | null;
  subscriptionId?: string | null;
  event?: string | null;
  timestamp?: string | null;
  ownerId?: string | null;

  telephonySessionId?: string | null;
  sessionId?: string | null;
  sequence?: number | null;
};

export type RingCentralCallCandidateDocument = {
  provider: "ringcentral";

  telephonySessionId: string;
  sessionId: string | null;
  partyId: string;

  firstSeenAt: Date;
  lastSeenAt: Date;
  lastEventTime: Date | null;
  callStartedAt?: Date | null;
  lastSequence: number | null;

  direction: string | null;
  statusCode: string | null;

  fromPhoneNumber: string | null;
  fromName: string | null;
  toPhoneNumber: string | null;
  toName: string | null;

  normalizedFromPhoneNumber: string | null;
  normalizedToPhoneNumber: string | null;

  queueCall: boolean | null;
  missedCall: boolean | null;

  targetMatched: boolean;
  sourceLabel: string | null;
  sourceCompany: string | null;
  routeResolution?: RingCentralRouteResolution | null;

  answered: boolean;
  answeredAt: Date | null;

  terminal: boolean;
  terminalStatusCode: string | null;
  terminalAt: Date | null;

  estimatedDurationSeconds: number | null;

  decisionStatus: RingCentralDecisionStatus;
  decisionReason: string | null;

  lastWebhookUuid: string | null;
  rawLatestParty: unknown;

  createdAt: Date;
  updatedAt: Date;
};

export type CandidateDecision = {
  wouldCreateCallLead: boolean;
  decisionStatus: RingCentralDecisionStatus;
  decisionReason: string;
  leadPreview: null | {
    provider: "ringcentral";
    sourceCompany: string;
    sourceLabel: string;
    routeResolution: RingCentralRouteResolution;
    callerPhoneNumber: string;
    callerName: string | null;
    targetPhoneNumber: string;
    targetName: string | null;
    telephonySessionId: string;
    sessionId: string | null;
    partyId: string;
    answeredAt: Date;
    terminalAt: Date | null;
    estimatedDurationSeconds: number;
    qualificationReason: "inbound_target_answered_over_120s";
  };
};

export type RingCentralCallCandidateDecisionDocument = CandidateDecision & {
  provider: "ringcentral";
  telephonySessionId: string;
  sessionId: string | null;
  partyId: string;
  candidateUpdatedAt: Date;
  createdAt: Date;
};
