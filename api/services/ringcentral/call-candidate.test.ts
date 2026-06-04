import assert from "node:assert/strict";
import test from "node:test";
import {
  RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE,
  SOURCE_LABEL_TO_COMPANY,
  resolveRingCentralInboundSource,
} from "./call-lead-sources";
import { buildRingCentralCandidateDocument } from "./call-candidate-store";
import {
  CALL_LEAD_MINIMUM_ANSWERED_SECONDS,
  evaluateRingCentralCallCandidate,
} from "./call-candidate-evaluator";
import type { RingCentralCallCandidateDocument } from "./call-candidate-types";
import { normalizePhoneNumberToE164Like } from "./phone-normalization";
import { normalizeRingCentralWebhookPayload } from "./webhook-event-normalizer";

const sampleAnsweredInboundEvent = {
  uuid: "2763839469580530009",
  event:
    "/restapi/v1.0/account/62948571023/extension/584528022/telephony/sessions",
  timestamp: "2026-06-02T19:58:43.612Z",
  subscriptionId: "45951d0b-a3e1-489b-ae02-2730efae316c",
  ownerId: "62948571023",
  body: {
    sequence: 13,
    sessionId: "2206229126023",
    telephonySessionId: "s-a785c4a03ca73z19e89ea934az3e86a110000",
    serverId: "10.120.92.74.TAM",
    eventTime: "2026-06-02T19:58:43.532Z",
    parties: [
      {
        accountId: "62948571023",
        extensionId: "584528022",
        id: "p-a785c4a03ca73z19e89ea934az3e86a110000-3",
        direction: "Inbound",
        to: {
          phoneNumber: "+18883164387",
          name: "10BEST LANDING",
          extensionId: "63298993023",
          deviceId: "803088504023",
        },
        from: {
          phoneNumber: "+12095831618",
          name: "10BEST LANDING - 12095831618",
        },
        status: {
          code: "Answered",
          rcc: false,
        },
        queueCall: true,
        missedCall: false,
        standAlone: false,
        uiCallInfo: {
          primary: {
            type: "QueueName",
            value: "10BEST LANDING",
          },
          additional: {
            type: "CallerIdNumber",
            value: "12095831618",
          },
        },
      },
    ],
    origin: {
      type: "Call",
    },
  },
};

test("normalizePhoneNumberToE164Like handles common RingCentral number shapes", () => {
  assert.equal(normalizePhoneNumberToE164Like("(888) 316-4387"), "+18883164387");
  assert.equal(normalizePhoneNumberToE164Like("888-308-3612"), "+18883083612");
  assert.equal(normalizePhoneNumberToE164Like("+18887240625"), "+18887240625");
  assert.equal(normalizePhoneNumberToE164Like("12095831618"), "+12095831618");
  assert.equal(normalizePhoneNumberToE164Like("   "), null);
});

test("RingCentral inbound target numbers resolve to configured source metadata", () => {
  assert.deepEqual(resolveRingCentralInboundSource("(888) 316-4387"), {
    sourceLabel: "10best Inbounds",
    sourceCompany: "10best_leads",
  });
  assert.equal(resolveRingCentralInboundSource("+15555555555"), null);
});

test("RingCentral source labels are consistent with source company mapping", () => {
  for (const source of Object.values(RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE)) {
    assert.equal(SOURCE_LABEL_TO_COMPANY[source.sourceLabel], source.sourceCompany);
  }
});

test("normalizer emits one target-matched party event from sample webhook payload", () => {
  const events = normalizeRingCentralWebhookPayload(
    sampleAnsweredInboundEvent,
    new Date("2026-06-02T19:58:43.693Z"),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.webhookUuid, "2763839469580530009");
  assert.equal(events[0]?.telephonySessionId, sampleAnsweredInboundEvent.body.telephonySessionId);
  assert.equal(events[0]?.partyId, sampleAnsweredInboundEvent.body.parties[0].id);
  assert.equal(events[0]?.direction, "Inbound");
  assert.equal(events[0]?.statusCode, "Answered");
  assert.equal(events[0]?.normalizedFromPhoneNumber, "+12095831618");
  assert.equal(events[0]?.normalizedToPhoneNumber, "+18883164387");
  assert.equal(events[0]?.targetMatched, true);
  assert.equal(events[0]?.sourceLabel, "10best Inbounds");
  assert.equal(events[0]?.sourceCompany, "10best_leads");
});

test("candidate folding preserves answeredAt from an older delayed event", () => {
  const disconnectedPayload = structuredClone(sampleAnsweredInboundEvent);
  disconnectedPayload.uuid = "later-disconnected";
  disconnectedPayload.body.sequence = 20;
  disconnectedPayload.body.eventTime = "2026-06-02T20:00:43.532Z";
  disconnectedPayload.body.parties[0].status.code = "Disconnected";

  const answeredPayload = structuredClone(sampleAnsweredInboundEvent);
  answeredPayload.uuid = "delayed-answered";
  answeredPayload.body.sequence = 13;
  answeredPayload.body.eventTime = "2026-06-02T19:58:43.532Z";
  answeredPayload.body.parties[0].status.code = "Answered";

  const disconnectedEvent = normalizeRingCentralWebhookPayload(
    disconnectedPayload,
    new Date("2026-06-02T20:00:44.000Z"),
  )[0]!;
  const answeredEvent = normalizeRingCentralWebhookPayload(
    answeredPayload,
    new Date("2026-06-02T20:00:45.000Z"),
  )[0]!;

  const afterDisconnect = buildRingCentralCandidateDocument(
    null,
    disconnectedEvent,
    new Date("2026-06-02T20:00:44.000Z"),
  );
  const afterDelayedAnswer = buildRingCentralCandidateDocument(
    afterDisconnect,
    answeredEvent,
    new Date("2026-06-02T20:00:45.000Z"),
  );

  assert.equal(afterDelayedAnswer.lastSequence, 20);
  assert.equal(afterDelayedAnswer.statusCode, "Disconnected");
  assert.equal(afterDelayedAnswer.answered, true);
  assert.equal(
    afterDelayedAnswer.answeredAt?.toISOString(),
    "2026-06-02T19:58:43.532Z",
  );
  assert.equal(
    afterDelayedAnswer.terminalAt?.toISOString(),
    "2026-06-02T20:00:43.532Z",
  );
});

test("sample answered inbound event is pending immediately and qualifies after elapsed buffer", () => {
  const answeredAt = new Date("2026-06-02T19:58:43.532Z");
  const candidate = buildCandidate({ answered: true, answeredAt });

  const immediateDecision = evaluateRingCentralCallCandidate(
    candidate,
    new Date("2026-06-02T19:58:43.693Z"),
  );
  assert.equal(immediateDecision.wouldCreateCallLead, false);
  assert.equal(immediateDecision.decisionStatus, "pending_buffer");
  assert.equal(immediateDecision.decisionReason, "answered_but_under_120_seconds");

  const qualifiedDecision = evaluateRingCentralCallCandidate(
    candidate,
    new Date(answeredAt.getTime() + (CALL_LEAD_MINIMUM_ANSWERED_SECONDS + 1) * 1000),
  );
  assert.equal(qualifiedDecision.wouldCreateCallLead, true);
  assert.equal(qualifiedDecision.decisionStatus, "qualified");
  assert.equal(
    qualifiedDecision.decisionReason,
    "inbound_target_answered_over_120s_webhook_elapsed_best_effort",
  );
});

test("evaluator rejects outbound calls", () => {
  const decision = evaluateRingCentralCallCandidate(
    buildCandidate({ direction: "Outbound", targetMatched: false }),
  );
  assert.equal(decision.wouldCreateCallLead, false);
  assert.equal(decision.decisionStatus, "rejected");
  assert.equal(decision.decisionReason, "not_inbound");
});

test("evaluator rejects inbound calls to unknown numbers", () => {
  const decision = evaluateRingCentralCallCandidate(
    buildCandidate({
      targetMatched: false,
      sourceLabel: null,
      sourceCompany: null,
      normalizedToPhoneNumber: "+15555555555",
    }),
  );
  assert.equal(decision.decisionStatus, "rejected");
  assert.equal(decision.decisionReason, "target_number_not_matched");
});

test("evaluator keeps live inbound target calls candidate until answered", () => {
  const decision = evaluateRingCentralCallCandidate(
    buildCandidate({ answered: false, answeredAt: null }),
  );
  assert.equal(decision.decisionStatus, "candidate");
  assert.equal(decision.decisionReason, "inbound_target_waiting_for_answer");
});

test("evaluator rejects terminal inbound target calls that were not answered", () => {
  const decision = evaluateRingCentralCallCandidate(
    buildCandidate({
      answered: false,
      answeredAt: null,
      terminal: true,
      terminalStatusCode: "Missed",
      missedCall: true,
    }),
  );
  assert.equal(decision.decisionStatus, "rejected");
  assert.equal(decision.decisionReason, "not_answered");
});

test("evaluator distinguishes live and terminal answered calls under 120 seconds", () => {
  const answeredAt = new Date("2026-06-02T19:58:43.000Z");
  const liveDecision = evaluateRingCentralCallCandidate(
    buildCandidate({ answered: true, answeredAt }),
    new Date(answeredAt.getTime() + 30_000),
  );
  assert.equal(liveDecision.decisionStatus, "pending_buffer");

  const terminalDecision = evaluateRingCentralCallCandidate(
    buildCandidate({
      answered: true,
      answeredAt,
      terminal: true,
      terminalAt: new Date(answeredAt.getTime() + 30_000),
      terminalStatusCode: "Disconnected",
    }),
  );
  assert.equal(terminalDecision.decisionStatus, "rejected");
  assert.equal(terminalDecision.decisionReason, "under_120_seconds");
});

test("evaluator qualifies inbound target calls answered over 120 seconds", () => {
  const answeredAt = new Date("2026-06-02T19:58:43.000Z");
  const decision = evaluateRingCentralCallCandidate(
    buildCandidate({
      answered: true,
      answeredAt,
      terminal: true,
      terminalAt: new Date(answeredAt.getTime() + 121_000),
      terminalStatusCode: "Disconnected",
    }),
  );

  assert.equal(decision.wouldCreateCallLead, true);
  assert.equal(decision.decisionStatus, "qualified");
  assert.equal(decision.leadPreview?.estimatedDurationSeconds, 121);
});

test("evaluator rejects missed calls without answered evidence", () => {
  const decision = evaluateRingCentralCallCandidate(
    buildCandidate({ answered: false, answeredAt: null, missedCall: true }),
  );
  assert.equal(decision.decisionStatus, "rejected");
  assert.equal(decision.decisionReason, "not_answered");
});

function buildCandidate(
  overrides: Partial<RingCentralCallCandidateDocument> = {},
): RingCentralCallCandidateDocument {
  const now = new Date("2026-06-02T19:58:43.532Z");
  return {
    provider: "ringcentral",
    telephonySessionId: "s-a785c4a03ca73z19e89ea934az3e86a110000",
    sessionId: "2206229126023",
    partyId: "p-a785c4a03ca73z19e89ea934az3e86a110000-3",
    firstSeenAt: now,
    lastSeenAt: now,
    lastEventTime: now,
    lastSequence: 13,
    direction: "Inbound",
    statusCode: "Answered",
    fromPhoneNumber: "+12095831618",
    fromName: "10BEST LANDING - 12095831618",
    toPhoneNumber: "+18883164387",
    toName: "10BEST LANDING",
    normalizedFromPhoneNumber: "+12095831618",
    normalizedToPhoneNumber: "+18883164387",
    queueCall: true,
    missedCall: false,
    targetMatched: true,
    sourceLabel: "10best Inbounds",
    sourceCompany: "10best_leads",
    answered: true,
    answeredAt: now,
    terminal: false,
    terminalStatusCode: null,
    terminalAt: null,
    estimatedDurationSeconds: null,
    decisionStatus: "pending_buffer",
    decisionReason: null,
    lastWebhookUuid: "2763839469580530009",
    rawLatestParty: sampleAnsweredInboundEvent.body.parties[0],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
