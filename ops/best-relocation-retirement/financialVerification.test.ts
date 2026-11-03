import assert from "node:assert/strict";
import { test } from "node:test";
import type { BestRelocationPlanAction } from "../../src/services/bestRelocationSheetIngest/applicationPlan";
import type { RetirementSourcePlan } from "./sourcePlan";
import { FINANCIAL_VERIFICATION_ACTION_CAP, verifyCanonicalFinancials, type FinancialVerificationDependencies } from "./financialVerification";

function fixture() {
  const actions = [
    { action_key: "book", command: "adopt_existing", classification: "adoption", dataset_key: "booked_deals", stable_source_row_id: "booking:job", content_hash: "book-hash", schema_version: 2, depends_on: [], adopted_entity_refs: [{ model: "BookedLead", id: "b1" }] },
    { action_key: "cancel", command: "create_cancelled_lead", classification: "create", dataset_key: "refunds", stable_source_row_id: "refund:managed", content_hash: "cancel-hash", schema_version: 2, depends_on: ["book"] },
  ] as unknown as BestRelocationPlanAction[];
  const plan = { checksum: "plan-checksum", canonical_plan: { actions }, financial_source_payloads: { book: { total_binder_amount: 1000, deposit_amount: 500 }, cancel: { refund_amount: 100, booked_lead: "$ref:book" } }, target_before: [{ model: "BookedLead", _id: "b1", total_binder_amount: 1000, deposit_amount: 500, cancelled: null }] } as unknown as RetirementSourcePlan;
  const run = { connection_id: "connection", plan_checksum: plan.checksum, status: "completed", approval: { apply_result: { applied: 1, already_applied: 0, conflicts: 0, failures: 0, skipped_dependencies: 0, completed_units: 2 } } };
  const receipts = actions.map((action, index) => ({ dataset_key: action.dataset_key, stable_source_row_id: action.stable_source_row_id, content_hash: action.content_hash, schema_version: action.schema_version, outcome: index ? "applied" : "adopted", resulting_canonical_model: index ? "CancelledLead" : "BookedLead", resulting_canonical_ids: index ? ["c1", "b1"] : ["b1", "form1"] }));
  const rows: Record<string, Record<string, unknown>> = {
    "BookedLead:b1": { _id: "b1", total_binder_amount: 1000, deposit_amount: 500, source: "best_relocation_leads", cancelled: "c1", lead_ref: "form1" },
    "CancelledLead:c1": { _id: "c1", refund_amount: 100, booked_lead: "b1", source: "best_relocation_leads" },
  };
  const membership = new Map([["Booked Deals", new Map([["b1", 1]])], ["Cancelled Deals", new Map([["c1", 1]])]]);
  const deps: FinancialVerificationDependencies = {
    connect: async () => {}, loadRun: async () => run,
    loadReceipts: async (_connection, identities) => receipts.filter((receipt) => identities.some((identity) => identity.stable_source_row_id === receipt.stable_source_row_id)),
    loadEntities: async (model, ids) => ids.flatMap((id) => rows[`${model}:${id}`] ? [rows[`${model}:${id}`]] : []),
  };
  const verify = () => verifyCanonicalFinancials(plan, "run", "connection", membership, deps);
  return { plan, actions, run, receipts, rows, membership, deps, verify };
}

test("adopted payload stripping cannot skip frozen money verification; official linked rows exist exactly once", async () => {
  const f = fixture();
  assert.equal(f.actions[0].command_payload, undefined);
  const result = await f.verify();
  assert.equal(result.complete, true);
  assert.deepEqual(result.discrepancies, []);
  assert.equal(result.counters.receipts_resolved, 2);
  assert.equal(result.counters.monetary_fields_verified, 3);
  assert.deepEqual([result.counters.binder_delta_cents, result.counters.deposit_delta_cents, result.counters.refund_delta_cents], [0, 0, 0]);
  assert.equal(result.counters.expected_binder_cents, 100000);
});

test("mismatched canonical refund/deposit are reported without changing money", async () => {
  const f = fixture();
  f.rows["BookedLead:b1"].deposit_amount = 999;
  f.rows["CancelledLead:c1"].refund_amount = 200;
  const before = structuredClone(f.rows), result = await f.verify();
  assert.equal(result.complete, false);
  assert.ok(result.discrepancies.some((row) => row.reason === "frozen_financial_value_mismatch" && row.field === "refund_amount"));
  assert.equal(result.counters.refund_delta_cents, 10000);
  assert.equal(result.counters.deposit_delta_cents, 49900);
  assert.deepEqual(f.rows, before);
});

test("destination missing/duplicate official rows and changed cancellation links cannot qualify", async () => {
  const f = fixture();
  f.membership.get("Booked Deals")!.set("b1", 2);
  f.membership.get("Cancelled Deals")!.delete("c1");
  f.rows["BookedLead:b1"].cancelled = null;
  const result = await f.verify();
  assert.equal(result.complete, false);
  assert.ok(result.discrepancies.some((row) => row.reason === "official_sheet_membership" && row.id === "b1" && row.count === 2));
  assert.ok(result.discrepancies.some((row) => row.reason === "official_sheet_membership" && row.id === "c1" && row.count === 0));
  assert.ok(result.discrepancies.some((row) => row.reason === "cancellation_booking_link_mismatch"));
});

test("persisted failed/skipped or incompletely processed canonical actions never report complete", async () => {
  for (const key of ["failures", "skipped_dependencies", "conflicts"] as const) {
    const f = fixture(); f.run.approval.apply_result[key] = 1;
    const result = await f.verify();
    assert.equal(result.complete, false);
    assert.ok(result.discrepancies.some((row) => row.reason === `canonical_${key}`));
  }
  const f = fixture(); f.run.approval.apply_result.completed_units = 1;
  assert.ok((await f.verify()).discrepancies.some((row) => row.reason === "canonical_actions_not_all_completed"));
});

test("missing/unsuccessful receipts remain incomplete even when canonical rows happen to exist", async () => {
  const f = fixture(); f.receipts.splice(1, 1);
  assert.ok((await f.verify()).discrepancies.some((row) => row.reason === "financial_receipt_missing"));
  f.receipts[0].outcome = "conflict";
  assert.ok((await f.verify()).discrepancies.some((row) => row.reason === "financial_receipt_not_successful"));
});

test("a frozen financial source conflict is retained as incomplete without an amount mutation", async () => {
  const f = fixture(); f.actions[1].classification = "conflict"; f.actions[1].command = "record_conflict";
  const before = structuredClone(f.rows), result = await f.verify();
  assert.equal(result.complete, false);
  assert.ok(result.discrepancies.some((row) => row.reason === "financial_source_action_conflict"));
  assert.deepEqual(f.rows, before);
});

test("missing frozen payload and missing persisted apply summary fail closed", async () => {
  const f = fixture(); delete f.plan.financial_source_payloads.book;
  f.run.approval.apply_result = {} as typeof f.run.approval.apply_result;
  const result = await f.verify();
  assert.equal(result.complete, false);
  assert.ok(result.discrepancies.some((row) => row.reason === "frozen_financial_payload_missing"));
  assert.ok(result.discrepancies.some((row) => row.reason === "canonical_apply_result_missing_or_invalid"));
});

test("verification uses bounded batches and explicit cap errors", async () => {
  const f = fixture();
  f.deps.loadReceipts = async () => Array.from({ length: 101 }, () => f.receipts[0]);
  await assert.rejects(f.verify(), /receipt_cap_exceeded/);
  f.plan.canonical_plan.actions = Array.from({ length: FINANCIAL_VERIFICATION_ACTION_CAP + 1 }, () => f.actions[0]);
  await assert.rejects(f.verify(), /action_cap_exceeded/);
});

test("a multi-batch financial cohort is fully checked with at most 100 identities per read", async () => {
  const f = fixture(), receiptBatches: number[] = [], entityBatches: number[] = [];
  f.plan.canonical_plan.actions = Array.from({ length: 121 }, (_, index) => ({ ...f.actions[0], action_key: `book-${index}`, stable_source_row_id: `booking:${index}`, content_hash: `hash-${index}` }));
  f.plan.financial_source_payloads = Object.fromEntries(f.plan.canonical_plan.actions.map((action) => [action.action_key, { total_binder_amount: 1, deposit_amount: 2 }]));
  f.plan.target_before = [];
  f.run.approval.apply_result.completed_units = 121;
  f.run.approval.apply_result.applied = 121;
  f.membership.set("Booked Deals", new Map(Array.from({ length: 121 }, (_, index) => [`booking-${index}`, 1])));
  f.deps.loadReceipts = async (_connection, identities) => {
    receiptBatches.push(identities.length);
    return identities.map((identity) => ({ ...identity, outcome: "applied", resulting_canonical_model: "BookedLead", resulting_canonical_ids: [`booking-${identity.stable_source_row_id.split(":")[1]}`] }));
  };
  f.deps.loadEntities = async (_model, ids) => {
    entityBatches.push(ids.length);
    return ids.map((_id) => ({ _id, source: "best_relocation_leads", total_binder_amount: 1, deposit_amount: 2 }));
  };
  const result = await f.verify();
  assert.equal(result.complete, true);
  assert.deepEqual(receiptBatches, [100, 21]);
  assert.deepEqual(entityBatches, [100, 21]);
  assert.equal(result.counters.monetary_fields_verified, 242);
  assert.equal(result.counters.expected_binder_cents, 12100);
});

test("invalid negative financial values cannot qualify even if source and canonical agree", async () => {
  const f = fixture();
  f.plan.financial_source_payloads.cancel.refund_amount = -100;
  f.rows["CancelledLead:c1"].refund_amount = -100;
  assert.ok((await f.verify()).discrepancies.some((row) => row.reason === "frozen_financial_value_mismatch" && row.field === "refund_amount"));
});
