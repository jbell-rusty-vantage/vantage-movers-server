import assert from "node:assert/strict";
import test from "node:test";
import { resolveRingCentralInboundSource } from "./call-lead-sources";
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

test("RingCentral inbound target numbers resolve to configured source metadata", () => {
  assert.deepEqual(resolveRingCentralInboundSource("(888) 316-4387"), {
    sourceLabel: "10best Inbounds",
    sourceCompany: "tbm_leads",
  });
  assert.deepEqual(resolveRingCentralInboundSource("(888) 397-1005"), {
    sourceLabel: "GetMovers Inbounds",
    sourceCompany: "get_movers_leads",
  });
  assert.equal(resolveRingCentralInboundSource("+15555555555"), null);
});

test("normalizer uses an explicit provider call start and never notification time", () => {
  const payload = structuredClone(sampleAnsweredInboundEvent);
  Object.assign(payload.body.parties[0], {
    startTime: "2026-06-02T19:55:00.000Z",
  });
  const event = normalizeRingCentralWebhookPayload(
    payload,
    new Date("2026-06-02T20:01:00.000Z"),
  )[0]!;

  assert.equal(event.callStartedAt?.toISOString(), "2026-06-02T19:55:00.000Z");
  assert.notEqual(event.callStartedAt?.toISOString(), payload.body.eventTime);
});
