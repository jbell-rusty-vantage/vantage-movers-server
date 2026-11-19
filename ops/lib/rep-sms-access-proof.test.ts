import assert from "node:assert/strict";
import { test } from "node:test";
import { dryValidateSubscriptionBody, judgeMailbox, judgeProof } from "./rep-sms-access-proof";

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
