import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCallBackfill, CALL_BACKFILL_FROM, callBackfillPlanChecksum, planCallBackfill,
  recoverCallBackfillObservation, verifyCallBackfill,
  callBackfillTotals,
  type CallBackfillDependencies,
} from "./callBackfill";
import type { DurableActor } from "../../src/services/durableWork/types";
import { selectCallBackfillIndexes } from "./callBackfillScan";

const observed = new Date("2026-11-03T12:00:00Z");
const owner: DurableActor = { actor_type: "owner", actor_id: "owner-id", actor_label: "Owner", actor_role: "owner", request_id: "synthetic-backfill", origin: "vantage_admin" };
function saved(id: string, arrival = "2026-11-01T06:30:00Z") {
  return { _id: id, domain_revision: 0, source_company: "synthetic", source_granularity_id: "scope",
    timestamp: new Date("2026-11-01T01:30:00Z"), duplicate: false, form_fill: false,
    ringcentral: { telephony_session_id: `session-${id}`, ingestion_source: "webhook",
      qualification_reason: "call_log_inbound_target_answered_over_120s", duration_seconds: 150,
      start_time: new Date(arrival),
    } };
}
function record(id: string, startTime = "2026-11-01T06:30:00Z") {
  return { id: `log-${id}`, telephonySessionId: `session-${id}`, startTime,
    finished: true, type: "Voice", direction: "Inbound", result: "Missed", durationMs: 150000,
    from: { phoneNumber: "+15550001111" }, to: { phoneNumber: "+15550002222" } };
}
function deps(rows: ReturnType<typeof saved>[]): Partial<CallBackfillDependencies> {
  return {
    connect: async () => undefined, database: () => "testvantagemovers", scopes: async () => ["scope"],
    page: async ({ kind, cursor }) => !cursor && kind === "primary" ? rows : [],
    load: async (id) => rows.find(row => row._id === id) ?? null,
    hasEligibleForm: async () => false, liveRate: async () => 100,
    providerAccount: async () => "synthetic-account",
    providerRecords: async (row) => ({ records: [record(row._id)], complete: true }),
  };
}

test("backfill preserves historical qualification and recovers exact final data with no active route", () => {
  const row = saved("one");
  const result = recoverCallBackfillObservation(row, [record("one")], observed);
  assert.equal(result.observation?.finalCallLogResult?.result, "Missed");
  assert.equal(result.observation?.finalCallLogResult?.answered, false);
  assert.equal(result.observation?.startTime?.toISOString(), "2026-11-01T06:30:00.000Z");
  assert.equal(row.ringcentral.qualification_reason, "call_log_inbound_target_answered_over_120s");
  assert.equal(recoverCallBackfillObservation(row, [record("one"), record("one")], observed).unresolved, "ambiguous_call_log_identity");
  assert.equal(recoverCallBackfillObservation(row, [record("other")], observed).unresolved, "call_log_not_found");
  assert.equal(recoverCallBackfillObservation(row, [{ ...record("one"), finished: false }], observed).unresolved, "final_caller_result_unconfirmed");
  assert.equal(recoverCallBackfillObservation(row, [record("one", "2026-11-01T05:30:00Z")], observed).unresolved, "provider_arrival_conflict");
});

test("fixed New York boundary includes both DST hours and boundary audit without copying contacts", async () => {
  const rows = [saved("first", "2026-11-01T05:30:00Z"), saved("second"), saved("old", "2026-11-01T03:59:59Z")];
  const boundary = saved("boundary");
  boundary.timestamp = new Date("2026-10-01T01:30:00Z");
  const plan = await planCallBackfill({ through: observed.toISOString(), deploymentId: "optimization-qualified" }, {
    ...deps(rows),
    page: async ({ kind, cursor, from, limit }) => {
      assert.equal(from.toISOString(), CALL_BACKFILL_FROM);
      assert.equal(limit, 100);
      return cursor ? [] : kind === "primary" ? rows : [boundary];
    },
    providerRecords: async (row) => ({ records: [record(row._id, row.ringcentral.start_time.toISOString())], complete: true }),
    hasEligibleForm: async (row) => row._id === "first",
  });
  assert.equal(plan.from, "2026-11-01T04:00:00.000Z");
  assert.equal(plan.items.length, 3);
  assert.equal(plan.items[0]?.desired.disposition, "duplicate_calls");
  assert.equal(plan.items[1]?.desired.disposition, "bad_call_leads");
  assert.equal(plan.totals.after_billable, 0);
  assert.equal(plan.totals.billing_live_cost_delta, -300);
  assert.equal(plan.timestamp_discrepancies.find(row => row.lead_id === "boundary")?.outside_widened_range, true);
  assert.equal(callBackfillPlanChecksum(plan), plan.checksum);
  assert.ok(!JSON.stringify(plan).includes("phone_number"));
});

test("provider unavailable remains unresolved while independent Form Fill still reclassifies", async () => {
  const plan = await planCallBackfill({ through: observed.toISOString(), deploymentId: "qualified" }, {
    ...deps([saved("one")]), hasEligibleForm: async () => true,
    providerAccount: async () => { throw new Error("synthetic auth unavailable"); },
    providerRecords: async () => { throw new Error("must not call unverified account"); },
  });
  assert.deepEqual(plan.items[0]?.unresolved, ["provider_account_unverified"]);
  assert.equal(plan.items[0]?.desired.disposition, "duplicate_calls");
  const verification = await verifyCallBackfill(plan, { readMembership: async () => ({ calls: 0, duplicate_calls: 1, bad_call_leads: 0 }) }, {
    ...deps([{ ...saved("one"), form_fill: true }]),
  });
  assert.equal(verification.complete, false);
  assert.equal(verification.mismatches.length, 0);
});

test("apply repairs Form facts before result/projection, replay reprojects without repeat domain writes", async () => {
  const row = saved("one");
  const dependencies = { ...deps([row]), hasEligibleForm: async () => true };
  const plan = await planCallBackfill({ through: observed.toISOString(), deploymentId: "qualified" }, dependencies);
  const events: string[] = [], formCommands = new Set<string>();
  let resultWrites = 0;
  const applyDeps: Partial<CallBackfillDependencies> = {
    ...dependencies,
    repairForm: async (input) => {
      if (!formCommands.has(input.context.idempotency_key)) {
        row.form_fill = true; row.domain_revision++; formCommands.add(input.context.idempotency_key); events.push("form");
      }
      return { status: "applied", entity_refs: [], warnings: [] };
    },
    persistResult: async (observation) => {
      if (!(row.ringcentral as any).final_result) {
        Object.assign(row.ringcentral, { final_result: observation.finalCallLogResult!.result,
          final_result_answered: false, final_result_call_log_id: observation.callLogId,
          call_log_id: observation.callLogId, final_result_observed_at: observed });
        row.domain_revision++; resultWrites++; events.push("result");
      }
      return row._id;
    },
    reproject: async () => { events.push("projection"); },
  };
  const options = { checksum: plan.checksum, expectedDatabase: "testvantagemovers", owner, assertLease: async () => undefined };
  assert.deepEqual((await applyCallBackfill(plan, options, applyDeps)).conflicts, []);
  assert.deepEqual((await applyCallBackfill(plan, options, applyDeps)).conflicts, []);
  assert.deepEqual(events, ["form", "result", "projection", "projection"]);
  assert.equal(resultWrites, 1);
  await assert.rejects(applyCallBackfill(plan, { ...options, checksum: "bad" }, applyDeps), /checksum/);
  const verification = await verifyCallBackfill(plan, { readMembership: async () => ({ calls: 0, duplicate_calls: 2, bad_call_leads: 0 }) }, applyDeps);
  assert.equal(verification.complete, false);
  assert.ok(verification.mismatches.some(row => row.reason === "duplicate_calls_physical_membership"));
});

test("only verified installed timestamp and complete source indexes may drive the bounded scan", () => {
  const indexes = [{ name: "_id_", key: { _id: 1 } },
    { name: "call_lead_overview_timestamp_receiver", key: { timestamp: 1, receiver_agent: 1 } },
    { name: "source_granularity_id_1", key: { source_granularity_id: 1 } }];
  assert.deepEqual(selectCallBackfillIndexes(indexes), { primary: "call_lead_overview_timestamp_receiver", boundary: "source_granularity_id_1" });
  assert.throws(() => selectCallBackfillIndexes(indexes.filter(index => index.name !== "call_lead_overview_timestamp_receiver")), /index_missing/);
  assert.throws(() => selectCallBackfillIndexes(indexes.map(index => index.name === "source_granularity_id_1" ? { ...index, sparse: true } : index)), /index_missing/);
});

test("verification re-enumerates coverage and rejects omitted or late-arriving Calls without provider reads", async () => {
  const rows = [saved("one", "2026-11-01T15:00:00Z")];
  const dependencies = { ...deps(rows), providerAccount: async () => { throw new Error("verification must not read provider"); }, providerRecords: async () => { throw new Error("verification must not read provider"); } };
  const plan = await planCallBackfill({ through: observed.toISOString(), deploymentId: "qualified" }, dependencies);
  rows.push(saved("late", "2026-11-01T16:00:00Z"));
  const membership = { readMembership: async () => ({ calls: 1, duplicate_calls: 0, bad_call_leads: 0 }) };
  const verified = await verifyCallBackfill(plan, membership, dependencies);
  assert.equal(verified.complete, false);
  assert.ok(verified.mismatches.some(item => item.lead_id === "late" && item.reason === "coverage_candidate_missing_from_plan"));
  const empty = { ...plan, items: [], totals: callBackfillTotals([]) };
  empty.checksum = callBackfillPlanChecksum(empty);
  const omitted = await verifyCallBackfill(empty, membership, dependencies);
  assert.equal(omitted.complete, false);
  assert.equal(omitted.coverage.observed, 2);
  assert.equal(omitted.mismatches.filter(item => item.reason === "coverage_candidate_missing_from_plan").length, 2);
  rows.splice(0, 1);
  const missing = await verifyCallBackfill(plan, membership, dependencies);
  assert.ok(missing.mismatches.some(item => item.lead_id === "one" && item.reason === "planned_candidate_outside_current_cohort"));
});

test("pre-release legacy billing delta remains separate from qualified baseline and new disposition", async () => {
  const row = saved("unsupported") as any;
  delete row.ringcentral;
  let pricedAt: Date | undefined;
  const plan = await planCallBackfill({ through: observed.toISOString(), deploymentId: "qualified" }, {
    ...deps([row]), liveRate: async (_row, day) => { pricedAt = day; return 100; },
    providerAccount: async () => { throw new Error("unqualified call cannot claim provider qualification"); },
  });
  assert.equal(plan.totals.legacy_billable, 1);
  assert.equal(plan.totals.qualified_baseline_billable, 0);
  assert.equal(plan.totals.after_billable, 0);
  assert.equal(plan.totals.billing_live_cost_delta, -100);
  assert.ok(pricedAt instanceof Date);
  assert.equal(plan.items[0]?.arrival, null);
  assert.equal(plan.items[0]?.qualified, false);
});
