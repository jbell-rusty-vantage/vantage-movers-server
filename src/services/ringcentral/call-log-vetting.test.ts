import assert from "node:assert/strict";
import test from "node:test";
import { buildRingCentralRouteSnapshot } from "../operationsRegistry";
import { qualifiedCallFromCallLog, vetRingCentralCallLogRecord as vetWithSnapshot } from "./call-log-vetting";

const mappings = [
  ["+18883083612", "tbm_prime_leads", "TBM Prime Inbounds"],
  ["+18883971005", "get_movers_leads", "GetMovers Inbounds"],
  ["+18884779232", "main_site", "Main Site Inbounds"],
] as const;
const snapshot = buildRingCentralRouteSnapshot({
  routes: mappings.map(([phone], index) => ({
    _id: `66a00000000000000000000${index + 1}`,
    phone_number: phone,
  })),
  companies: mappings.map(([, slug], index) => ({
    _id: `66b00000000000000000000${index + 1}`,
    company_slug: slug,
    owner_label: slug,
  })),
  granularities: mappings.map(([, , label], index) => ({
    _id: `66c00000000000000000000${index + 1}`,
    source_company: `66b00000000000000000000${index + 1}`,
    granularity_key: `calls_${index}`,
    owner_label: label,
    crm_label: label,
  })),
  assignments: mappings.map((_mapping, index) => ({
    _id: `66d00000000000000000000${index + 1}`,
    route: `66a00000000000000000000${index + 1}`,
    source_company: `66b00000000000000000000${index + 1}`,
    source_granularity: `66c00000000000000000000${index + 1}`,
    effective_from: new Date("2020-01-01T00:00:00.000Z"),
  })),
});
const vetRingCentralCallLogRecord = (record: unknown) =>
  vetWithSnapshot(
    {
      startTime: "2026-06-29T18:00:00.000Z",
      finished: true,
      type: "Voice",
      ...(record as Record<string, unknown>),
    },
    snapshot,
  );

test("rejects an outbound call", () => {
  const vet = vetRingCentralCallLogRecord({
    id: "cl-3",
    direction: "Outbound",
    result: "Completed",
    duration: 300,
    to: { phoneNumber: "+19998887777" },
    from: { phoneNumber: "+18883083612" },
  });

  assert.equal(vet.qualifies, false);
  assert.ok(vet.rejectionReasons.includes("not_inbound"));
  assert.ok(vet.rejectionReasons.includes("target_number_not_matched"));
});

test("rejects a call to an unmapped number", () => {
  const vet = vetRingCentralCallLogRecord({
    id: "cl-4",
    direction: "Inbound",
    result: "Completed",
    duration: 300,
    to: { phoneNumber: "+19998887777" },
    from: { phoneNumber: "+13055553333" },
  });

  assert.equal(vet.qualifies, false);
  assert.ok(vet.rejectionReasons.includes("target_number_not_matched"));
});

const inbound = {
  id: "one-call", telephonySessionId: "one-session", direction: "Inbound",
  result: "Missed", to: { phoneNumber: "+18883083612" },
  from: { phoneNumber: "+13055554444" },
};

test("final parent result survives both transports with same-call answered conflicts", () => {
  const observedAt = new Date("2026-11-01T06:35:00Z");
  for (const result of [" Missed ", "Busy", "Voicemail", "No Answer", "Completed"]) {
    const vet = vetRingCentralCallLogRecord({ ...inbound, result, durationMs: 150000,
      legs: [{ telephonySessionId: "one-session", result: " Answered " }],
    });
    assert.equal(vet.qualifies, true);
    for (const source of ["webhook", "call_log_sync"] as const) {
      const descriptor = qualifiedCallFromCallLog(vet, source, observedAt);
      assert.deepEqual(descriptor.finalCallLogResult, {
        result, observedAt, callLogId: "one-call", answered: true,
      });
      assert.equal(descriptor.answeredAt, null);
      assert.equal(descriptor.startTime, vet.startTime);
    }
  }
});

test("120 seconds qualifies without any answer; precise milliseconds win over rounding", () => {
  for (const result of ["Missed", "Voicemail", "Accepted"]) {
    assert.equal(vetRingCentralCallLogRecord({ ...inbound, result, durationMs: 120000 }).qualifies, true);
  }
  const short = vetRingCentralCallLogRecord({ ...inbound, duration: 120, durationMs: 119999 });
  assert.equal(short.qualifies, false);
  assert.equal(short.durationSeconds, 119.999);
  assert.equal(vetRingCentralCallLogRecord({ ...inbound, duration: 120 }).qualifies, false);
  assert.equal(vetRingCentralCallLogRecord({ ...inbound, duration: 121 }).qualifies, true);
});

test("never borrows duration from parallel legs or a different session", () => {
  const vet = vetRingCentralCallLogRecord({ ...inbound, durationMs: 60000, legs: [
    { duration: 600, result: "Call connected", telephonySessionId: "other-call" },
    { duration: 60, result: "Accepted" },
  ] });
  assert.equal(vet.qualifies, false);
  assert.equal(vet.durationSeconds, 60);
});

test("does not borrow a route or caller from another call's legs", () => {
  const vet = vetRingCentralCallLogRecord({ ...inbound, durationMs: 180000,
    to: { phoneNumber: "+19998887777" }, legs: [
      { direction: "Inbound", from: { phoneNumber: "+13055559999" },
        to: inbound.to, telephonySessionId: "different-session" },
    ] });
  assert.equal(vet.qualifies, false);
  assert.ok(vet.rejectionReasons.includes("target_number_not_matched"));
});

test("missing parent duration, start, identity, or non-finite duration cannot qualify", () => {
  for (const overrides of [
    { duration: undefined, legs: [{ duration: 300 }] },
    { startTime: undefined, durationMs: 300000 },
    { id: undefined, telephonySessionId: undefined, durationMs: 300000 },
    { durationMs: Infinity, duration: 300 },
  ]) assert.equal(vetRingCentralCallLogRecord({ ...inbound, ...overrides }).qualifies, false);
});
