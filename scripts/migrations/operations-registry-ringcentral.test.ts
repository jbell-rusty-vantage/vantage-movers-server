import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRingCentralBackfillPlan,
  type RingCentralBackfillSnapshot,
} from "./operations-registry-ringcentral.lib";

function fixture(): RingCentralBackfillSnapshot {
  return {
    static_mappings: [{
      phone_number: "(888) 316-4387",
      source_company: "tbm_leads",
      source_label: "10best Inbounds",
    }],
    companies: [{
      id: "66a000000000000000000001",
      company_slug: "tbm_leads",
      active: true,
      default_call_granularity: "66a000000000000000000002",
      embedded_call_numbers: [{
        granularity_key: "tbm_calls",
        phone_numbers: ["+18883164387"],
      }],
    }],
    granularities: [{
      id: "66a000000000000000000002",
      source_company: "66a000000000000000000001",
      granularity_key: "tbm_calls",
      channel: "call",
      crm_label: "10best Inbounds",
      active: true,
    }],
    routes: [],
    assignments: [],
  };
}

test("M5 plan consolidates static and embedded candidates deterministically", () => {
  const first = buildRingCentralBackfillPlan(fixture());
  const second = buildRingCentralBackfillPlan(fixture());
  assert.equal(first.conflicts.length, 0);
  assert.equal(first.mappings.length, 1);
  assert.deepEqual(first.mappings[0]?.provenance, ["embedded", "static"]);
  assert.equal(first.routes[0]?.action, "create");
  assert.equal(first.routes[0]?.assignment_action, "create");
  assert.equal(first.mapping_checksum, second.mapping_checksum);
});

test("M5 plan blocks one number targeting different granularities", () => {
  const snapshot = fixture();
  snapshot.granularities.push({
    id: "66a000000000000000000003",
    source_company: "66a000000000000000000001",
    granularity_key: "other_calls",
    channel: "call",
    crm_label: "Other Calls",
    active: true,
  });
  snapshot.companies[0]!.embedded_call_numbers.push({
    granularity_key: "other_calls",
    phone_numbers: ["+18883164387"],
  });
  const plan = buildRingCentralBackfillPlan(snapshot);
  assert.ok(
    plan.conflicts.some((conflict) =>
      conflict.code === "number_assignment_conflict"
    ),
  );
});

test("M5 rerun recognizes an already-active exact mapping", () => {
  const snapshot = fixture();
  snapshot.routes.push({
    id: "66a000000000000000000004",
    phone_number: "+18883164387",
    active: true,
    validation_status: "valid",
  });
  snapshot.assignments.push({
    id: "66a000000000000000000005",
    route: "66a000000000000000000004",
    source_granularity: "66a000000000000000000002",
  });
  const plan = buildRingCentralBackfillPlan(snapshot);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.routes[0]?.action, "noop");
  assert.equal(plan.routes[0]?.assignment_action, "noop");
});
