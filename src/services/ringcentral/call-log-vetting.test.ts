import assert from "node:assert/strict";
import test from "node:test";
import { buildRingCentralRouteSnapshot } from "../operationsRegistry";
import { vetRingCentralCallLogRecord as vetWithSnapshot } from "./call-log-vetting";

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
      ...(record as Record<string, unknown>),
    },
    snapshot,
  );

test("qualifies an inbound answered call over 120s to a mapped toll-free", () => {
  const vet = vetRingCentralCallLogRecord({
    id: "cl-1",
    sessionId: "sess-1",
    telephonySessionId: "tcl-1",
    startTime: "2026-06-03T18:00:00.000Z",
    direction: "Inbound",
    type: "Voice",
    result: "Completed",
    duration: 180,
    to: { phoneNumber: "+18883083612", name: "TBM Prime Inbounds" },
    from: { phoneNumber: "+13055551111", name: "Caller" },
  });

  assert.equal(vet.qualifies, true);
  assert.equal(vet.sourceCompany, "tbm_prime_leads");
  assert.equal(vet.sourceLabel, "TBM Prime Inbounds");
  assert.equal(vet.callerPhoneNumber, "+13055551111");
  assert.equal(vet.durationSeconds, 180);
  assert.deepEqual(vet.rejectionReasons, []);
});

test("qualifies a GetMovers inbound call log record", () => {
  const vet = vetRingCentralCallLogRecord({
    id: "cl-getmovers-1",
    sessionId: "sess-getmovers-1",
    telephonySessionId: "tcl-getmovers-1",
    startTime: "2026-06-29T18:00:00.000Z",
    direction: "Inbound",
    type: "Voice",
    result: "Completed",
    duration: 180,
    to: { phoneNumber: "+18883971005", name: "GetMovers Inbounds" },
    from: { phoneNumber: "+13055559999", name: "Caller" },
  });

  assert.equal(vet.qualifies, true);
  assert.equal(vet.sourceCompany, "get_movers_leads");
  assert.equal(vet.sourceLabel, "GetMovers Inbounds");
  assert.equal(vet.targetPhoneNumber, "+18883971005");
  assert.deepEqual(vet.rejectionReasons, []);
});

test("rejects a call under 120 seconds", () => {
  const vet = vetRingCentralCallLogRecord({
    id: "cl-2",
    direction: "Inbound",
    result: "Completed",
    duration: 45,
    to: { phoneNumber: "+18883083612" },
    from: { phoneNumber: "+13055552222" },
  });

  assert.equal(vet.qualifies, false);
  assert.ok(vet.rejectionReasons.includes("under_120_seconds"));
});

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

test("rejects a missed (unanswered) call", () => {
  const vet = vetRingCentralCallLogRecord({
    id: "cl-5",
    direction: "Inbound",
    result: "Missed",
    duration: 0,
    to: { phoneNumber: "+18883083612" },
    from: { phoneNumber: "+13055554444" },
  });

  assert.equal(vet.qualifies, false);
  assert.ok(vet.rejectionReasons.includes("not_answered"));
});

test("matches target number across call legs and picks the inbound caller", () => {
  const vet = vetRingCentralCallLogRecord({
    id: "cl-6",
    direction: "Inbound",
    result: "Completed",
    duration: 200,
    from: { phoneNumber: "+13055555555" },
    to: { phoneNumber: "+18005550000" },
    legs: [
      {
        direction: "Inbound",
        result: "Completed",
        duration: 200,
        to: { phoneNumber: "+18884779232", name: "Main Site Inbounds" },
        from: { phoneNumber: "+13055555555" },
      },
    ],
  });

  assert.equal(vet.qualifies, true);
  assert.equal(vet.sourceCompany, "main_site");
  assert.equal(vet.targetPhoneNumber, "+18884779232");
});
