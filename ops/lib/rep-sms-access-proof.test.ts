import assert from "node:assert/strict";
import { test } from "node:test";
import { dryValidateSubscriptionBody, judgeMailbox, judgeProof, probeEndpoints } from "./rep-sms-access-proof";

const SINCE = new Date("2026-10-05T04:00:00.000Z");

test("E01 probes are GETs on the rep's own mailbox paths only (message-store, message-sync FSync recordCount=1, outbound sample)", () => {
  assert.deepEqual(probeEndpoints("101", SINCE), {
    message_store: "/restapi/v1.0/account/~/extension/101/message-store?messageType=SMS&perPage=1",
    message_sync: "/restapi/v1.0/account/~/extension/101/message-sync?syncType=FSync&messageType=SMS&recordCount=1",
    outbound_sample: "/restapi/v1.0/account/~/extension/101/message-store?messageType=SMS&direction=Outbound&dateFrom=2026-10-05T04%3A00%3A00.000Z&perPage=25",
  });
  assert.throws(() => probeEndpoints("1/../2", SINCE));
});

const okAnswers = {
  message_store: { status: 200, body: { records: [] } },
  message_sync: { status: 200, body: { syncInfo: { syncToken: "never-printed" } } },
  outbound_sample: { status: 200, body: { records: [{ direction: "Outbound", messageStatus: "Sent", subject: "secret" }, { direction: "Outbound", messageStatus: "Queued" }] } },
};

test("E01 verdict: pass needs 200s + a sync token for every mailbox, one Sent outbound SMS, and a valid subscription body", () => {
  const good = judgeMailbox({ extension_id: "101", ...okAnswers });
  assert.deepEqual(good, {
    extension_id: "101",
    message_store_ok: true,
    message_sync_ok: true,
    sync_token_returned: true,
    outbound_sms_seen: 2,
    outbound_sent_or_delivered: 1,
    failures: [],
  });
  assert.equal(JSON.stringify(good).includes("never-printed"), false, "the token is never part of the verdict");
  assert.equal(JSON.stringify(good).includes("secret"), false, "no message body");
  const body = dryValidateSubscriptionBody(["101"], "https://example.test/api/webhooks/ringcentral");
  assert.equal(judgeProof([good], body).verdict, "pass");

  const forbidden = judgeMailbox({ extension_id: "102", ...okAnswers, message_store: { status: 403, body: null }, message_sync: { status: 403, body: null } });
  assert.deepEqual(forbidden.failures, ["message-store: HTTP 403", "message-sync: HTTP 403"]);
  const proof = judgeProof([good, forbidden], body);
  assert.equal(proof.verdict, "fail");
  assert.equal(proof.access_proven, false);

  const quiet = judgeMailbox({ extension_id: "101", ...okAnswers, outbound_sample: { status: 200, body: { records: [] } } });
  const noSms = judgeProof([quiet], body);
  assert.equal(noSms.verdict, "fail");
  assert.ok(noSms.notes.some((n) => n.includes("have a rep send one")));
  assert.equal(judgeProof([], dryValidateSubscriptionBody([], "https://x.test")).verdict, "fail");
});

test("E01 step 4: the subscription body is validated locally and never carries a real token", () => {
  const body = dryValidateSubscriptionBody(["102", "101"], "https://example.test/hook");
  assert.equal(body.valid, true);
  assert.deepEqual(body.body.eventFilters, [
    "/restapi/v1.0/account/~/extension/101/message-store?type=SMS",
    "/restapi/v1.0/account/~/extension/102/message-store?type=SMS",
  ]);
  assert.equal(body.body.expiresIn, 315_360_000);
  assert.equal(dryValidateSubscriptionBody(["101"], "http://example.test").valid, false);
});
