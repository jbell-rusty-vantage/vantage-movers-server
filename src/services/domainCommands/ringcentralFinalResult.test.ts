import assert from "node:assert/strict";
import test from "node:test";
import { planRingCentralFinalResultUpdate } from "./ringcentralFinalResult";
import { buildEntityChangeFields } from "./entityChange";
import type { RingCentralQualifiedCall } from "../ringcentral/ringcentral-call-lead-ingest.service";

const start = new Date("2026-11-01T06:30:00.000Z");
const observedAt = new Date("2026-11-01T06:35:00.000Z");
const call = {
  telephonySessionId: "caller-session", callLogId: "parent-log", startTime: start,
  finalCallLogResult: { result: " Missed ", answered: false, callLogId: "parent-log", observedAt },
} as RingCentralQualifiedCall;
const qualified = {
  telephony_session_id: "caller-session", ingestion_source: "webhook",
  qualification_reason: "call_log_inbound_target_answered_over_120s", duration_seconds: 150,
};
const lead = { _id: "lead-id", ringcentral: qualified };

test("final result adds exact parent evidence and arrival without rewriting historical qualification", () => {
  const patch = planRingCentralFinalResultUpdate(lead, call)!;
  assert.deepEqual(patch, {
    "ringcentral.final_result": " Missed ",
    "ringcentral.final_result_observed_at": observedAt,
    "ringcentral.final_result_answered": false,
    "ringcentral.final_result_call_log_id": "parent-log",
    "ringcentral.call_log_id": "parent-log",
    "ringcentral.start_time": start,
  });
  assert.equal(lead.ringcentral, qualified);
});

test("identical final evidence polls are no-ops; parent correction preserves answered conflict", () => {
  const saved = { ...lead, ringcentral: {
    ...qualified, start_time: start, call_log_id: "parent-log",
    final_result: " Missed ", final_result_answered: false,
    final_result_call_log_id: "parent-log", final_result_observed_at: observedAt,
  } };
  assert.deepEqual(planRingCentralFinalResultUpdate(saved, { ...call,
    finalCallLogResult: { ...call.finalCallLogResult!, observedAt: new Date("2026-11-01T07:00:00Z") },
  }), { "ringcentral.final_result_observed_at": new Date("2026-11-01T07:00:00Z") });
  const patch = planRingCentralFinalResultUpdate(saved, { ...call,
    finalCallLogResult: { ...call.finalCallLogResult!, answered: true, observedAt: new Date("2026-11-01T07:01:00Z") },
  })!;
  assert.equal(patch["ringcentral.final_result_answered"], true);
  assert.equal(patch["ringcentral.start_time"], undefined);
});

test("provisional, unqualified, other-session and stale facts cannot overwrite final evidence", () => {
  assert.equal(planRingCentralFinalResultUpdate(lead, { ...call, finalCallLogResult: undefined }), null);
  assert.equal(planRingCentralFinalResultUpdate({ ...lead, ringcentral: {} }, call), null);
  assert.equal(planRingCentralFinalResultUpdate(lead, { ...call, telephonySessionId: "other-session" }), null);
  assert.equal(planRingCentralFinalResultUpdate({ ...lead, ringcentral: {
    ...qualified, final_result_observed_at: new Date("2026-11-01T07:00:00Z"),
  } }, call), null);
  assert.equal(planRingCentralFinalResultUpdate(lead, { ...call,
    finalCallLogResult: { ...call.finalCallLogResult!, callLogId: "leg-log" },
  }), null);
});

test("final result correction audit stores reproducible result and identity values", () => {
  const patch = planRingCentralFinalResultUpdate(lead, call)!;
  const fields = buildEntityChangeFields(Object.entries(patch).map(([path, after]) => ({ path, after })));
  assert.ok(fields.every((field) => field.value_mode === "stored"));
});


test("a newer identical observation fences delayed changed results and ties", () => {
  const saved = { ...lead, ringcentral: { ...qualified, start_time: start, call_log_id: "parent-log",
    final_result: " Missed ", final_result_answered: false, final_result_call_log_id: "parent-log",
    final_result_observed_at: new Date("2026-11-01T08:05:00Z") } };
  const observe = (time: string, result = " Missed ") => ({ ...call, finalCallLogResult: {
    ...call.finalCallLogResult!, result, observedAt: new Date(`2026-11-01T${time}Z`) } });
  const watermark = planRingCentralFinalResultUpdate(saved, observe("08:07:00"))!;
  saved.ringcentral.final_result_observed_at = watermark["ringcentral.final_result_observed_at"] as Date;
  assert.equal(planRingCentralFinalResultUpdate(saved, observe("08:06:00", "Accepted")), null);
  assert.equal(planRingCentralFinalResultUpdate(saved, observe("08:07:00", "Accepted")), null);
  assert.ok(planRingCentralFinalResultUpdate(saved, observe("08:08:00", "Accepted")));
});
