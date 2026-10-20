import assert from "node:assert/strict";
import test from "node:test";
import { buildRingCentralRouteSnapshot } from "../operationsRegistry";
import { qualifyWebhookCallFromCallLog } from "./webhook-call-log-qualification";
import type { RingCentralQualifiedCall } from "./ringcentral-call-lead-ingest.service";

const snapshot = buildRingCentralRouteSnapshot({
  routes: [{ _id: "route", phone_number: "+18883083612" }],
  companies: [{ _id: "company", company_slug: "tbm_prime_leads", owner_label: "TBM Prime" }],
  granularities: [{ _id: "granularity", source_company: "company", granularity_key: "calls", owner_label: "Calls", crm_label: "TBM Prime Inbounds" }],
  assignments: [{ _id: "assignment", route: "route", source_company: "company", source_granularity: "granularity", effective_from: new Date("2020-01-01") }],
});
const call = {
  id: "call-one", telephonySessionId: "session-one", sessionId: "provider-session",
  startTime: "2026-10-20T12:00:00.000Z", direction: "Inbound", result: "Voicemail",
  type: "Voice", finished: true, duration: 171, durationMs: 170530,
  from: { phoneNumber: "+13055550101" }, to: { phoneNumber: "+18883083612" },
};

async function run(records: unknown[]) {
  const ingested: RingCentralQualifiedCall[] = [];
  const action = await qualifyWebhookCallFromCallLog("session-one", {
    readRecords: async (id) => { assert.equal(id, "session-one"); return records; },
    loadSnapshot: async () => snapshot,
    ingest: async (qualified) => {
      ingested.push(qualified);
      return { action: "dry_run", duplicate: false, duplicateReason: null, callLeadId: null,
        telephonySessionId: qualified.telephonySessionId, callLogId: qualified.callLogId, convergenceOutcome: "not_found" };
    },
  });
  return { action, ingested };
}

test("webhook uses final caller record, preserving caller and precise elapsed/end time without answering", async () => {
  const { action, ingested } = await run([call]);
  assert.equal(action, "dry_run");
  assert.equal(ingested.length, 1);
  assert.equal(ingested[0]!.durationSeconds, 170.53);
  assert.equal(ingested[0]!.terminalAt?.toISOString(), "2026-10-20T12:02:50.530Z");
  assert.equal(ingested[0]!.callerPhoneNumber, "+13055550101");
  assert.equal(ingested[0]!.answeredAt, null);
  assert.equal(ingested[0]!.callLogId, "call-one");
  assert.equal(ingested[0]!.ingestionSource, "webhook");
});

test("queue disconnect/voicemail wake cannot ingest unfinished or unavailable caller logs", async () => {
  for (const records of [[], [{ ...call, finished: false }], [{ ...call, finished: undefined }]]) {
    const result = await run(records);
    assert.equal(result.action, "awaiting_final_call_log");
    assert.equal(result.ingested.length, 0);
  }
  assert.equal((await run([call])).ingested.length, 1);
});

test("cannot use another session's record even for the same caller", async () => {
  assert.equal((await run([{ ...call, telephonySessionId: "other-call" }])).ingested.length, 0);
});

test("two short calls from the same caller never add up", async () => {
  assert.equal((await run([
    { ...call, durationMs: 70000 },
    { ...call, id: "call-two", telephonySessionId: "other-call", durationMs: 70000 },
  ])).ingested.length, 0);
});

test("ambiguous qualified parent records cannot mint from a first-match guess", async () => {
  assert.equal((await run([call, { ...call, id: "other-parent" }])).ingested.length, 0);
});

test("precise threshold is inclusive and rounded 120 cannot admit 119.999", async () => {
  assert.equal((await run([{ ...call, duration: 120, durationMs: 119999 }])).ingested.length, 0);
  assert.equal((await run([{ ...call, duration: 120, durationMs: 120000 }])).ingested.length, 1);
});
