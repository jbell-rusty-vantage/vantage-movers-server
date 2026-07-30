import assert from "node:assert/strict";
import test from "node:test";
import { aggregateRingCentralCallSession } from "./call-session-aggregator";
import { CALL_LEAD_MINIMUM_ANSWERED_SECONDS } from "./call-candidate-evaluator";
import type { RingCentralCallCandidateDocument } from "./call-candidate-types";

const SESSION_ID = "s-aggregate-test";
const ANSWERED_AT = new Date("2026-06-03T18:00:00.000Z");

function party(
  overrides: Partial<RingCentralCallCandidateDocument> = {},
): RingCentralCallCandidateDocument {
  const now = ANSWERED_AT;
  return {
    provider: "ringcentral",
    telephonySessionId: SESSION_ID,
    sessionId: "sess-1",
    partyId: "p-default",
    firstSeenAt: now,
    lastSeenAt: now,
    lastEventTime: now,
    lastSequence: 1,
    direction: "Inbound",
    statusCode: "Answered",
    fromPhoneNumber: "+12095551234",
    fromName: "Caller",
    toPhoneNumber: "+18883164387",
    toName: "10BEST LANDING",
    normalizedFromPhoneNumber: "+12095551234",
    normalizedToPhoneNumber: "+18883164387",
    queueCall: false,
    missedCall: false,
    targetMatched: true,
    sourceLabel: "10best Inbounds",
    sourceCompany: "tbm_leads",
    routeResolution: {
      route_id: "66a000000000000000000001",
      assignment_id: "66a000000000000000000002",
      normalized_target_number: "+18883164387",
      company_id: "66a000000000000000000003",
      company_slug: "tbm_leads",
      company_label_snapshot: "10 Best",
      granularity_id: "66a000000000000000000004",
      granularity_key: "tbm_calls",
      granularity_label_snapshot: "10best Inbounds",
      crm_label_snapshot: "10best Inbounds",
    },
    answered: true,
    answeredAt: now,
    terminal: false,
    terminalStatusCode: null,
    terminalAt: null,
    estimatedDurationSeconds: null,
    decisionStatus: "candidate",
    decisionReason: null,
    lastWebhookUuid: "uuid",
    rawLatestParty: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("aggregates a multi-party session and qualifies the canonical queue party over 120s", () => {
  const terminalAt = new Date(ANSWERED_AT.getTime() + 121_000);
  const queueParty = party({
    partyId: "p-queue",
    queueCall: true,
    answered: true,
    answeredAt: ANSWERED_AT,
    terminal: true,
    terminalStatusCode: "Disconnected",
    terminalAt,
  });
  const agentParty = party({
    partyId: "p-agent",
    queueCall: false,
    targetMatched: false,
    sourceLabel: null,
    sourceCompany: null,
    answered: true,
    answeredAt: ANSWERED_AT,
    terminal: true,
    terminalStatusCode: "Disconnected",
    terminalAt,
  });

  const { document } = aggregateRingCentralCallSession(
    [agentParty, queueParty],
    new Date(terminalAt.getTime() + 1_000),
  );

  assert.equal(document.canonicalPartyId, "p-queue");
  assert.equal(document.partyCount, 2);
  assert.equal(document.decisionStatus, "qualified");
  assert.equal(document.wouldCreateCallLead, true);
  assert.equal(document.ingestEligible, true);
  assert.equal(document.sourceCompany, "tbm_leads");
  assert.equal(document.estimatedDurationSeconds, 121);
});

test("uses answered agent lifecycle timing when the target queue leg disconnects early", () => {
  const queueTerminalAt = new Date(ANSWERED_AT.getTime() + 10_000);
  const agentTerminalAt = new Date(ANSWERED_AT.getTime() + 181_000);
  const queueParty = party({
    partyId: "p-queue",
    queueCall: true,
    answered: false,
    answeredAt: null,
    terminal: true,
    terminalStatusCode: "Disconnected",
    terminalAt: queueTerminalAt,
    estimatedDurationSeconds: 0,
  });
  const agentParty = party({
    partyId: "p-agent",
    queueCall: true,
    targetMatched: false,
    sourceLabel: null,
    sourceCompany: null,
    answered: true,
    answeredAt: ANSWERED_AT,
    terminal: true,
    terminalStatusCode: "Disconnected",
    terminalAt: agentTerminalAt,
    estimatedDurationSeconds: 181,
  });

  const { document } = aggregateRingCentralCallSession(
    [queueParty, agentParty],
    new Date(agentTerminalAt.getTime() + 1_000),
  );

  assert.equal(document.canonicalPartyId, "p-queue");
  assert.equal(document.sourceCompany, "tbm_leads");
  assert.equal(document.terminalAt?.toISOString(), agentTerminalAt.toISOString());
  assert.equal(document.estimatedDurationSeconds, 181);
  assert.equal(document.decisionStatus, "qualified");
  assert.equal(document.ingestEligible, true);
});

test("rejects a session that disconnected under 120 seconds", () => {
  const terminalAt = new Date(ANSWERED_AT.getTime() + 30_000);
  const { document } = aggregateRingCentralCallSession([
    party({
      partyId: "p-short",
      queueCall: true,
      terminal: true,
      terminalStatusCode: "Disconnected",
      terminalAt,
    }),
  ]);

  assert.equal(document.decisionStatus, "rejected");
  assert.equal(document.decisionReason, "under_120_seconds");
  assert.equal(document.ingestEligible, false);
});

test("a live (non-terminal) call over 120s qualifies but is not ingest-eligible", () => {
  const now = new Date(ANSWERED_AT.getTime() + (CALL_LEAD_MINIMUM_ANSWERED_SECONDS + 5) * 1000);
  const { document } = aggregateRingCentralCallSession(
    [party({ partyId: "p-live", queueCall: true, terminal: false })],
    now,
  );

  assert.equal(document.wouldCreateCallLead, true);
  assert.equal(document.terminal, false);
  assert.equal(document.ingestEligible, false);
});

test("an outbound-only session is not a lead", () => {
  const { document } = aggregateRingCentralCallSession([
    party({
      partyId: "p-out",
      direction: "Outbound",
      targetMatched: false,
      sourceLabel: null,
      sourceCompany: null,
      queueCall: false,
    }),
  ]);

  assert.equal(document.decisionStatus, "rejected");
  assert.equal(document.decisionReason, "not_inbound");
});
