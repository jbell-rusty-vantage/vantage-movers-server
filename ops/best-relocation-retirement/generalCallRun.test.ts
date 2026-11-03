import assert from "node:assert/strict";
import test from "node:test";
import { applyGeneralCallRun, verifyGeneralCallRun, generalCallRunScope,
  type GeneralCallRunDependencies, type GeneralCallRunInput, type GeneralCallRunLedger, type GeneralCallRunLedgerStore } from "./generalCallRun";
import { planCallBackfill, callBackfillPlanChecksum, type CallBackfillDependencies } from "./callBackfill";
import type { DurableActor } from "../../src/services/durableWork/types";

const deployment = "a".repeat(40), through = "2026-11-03T21:00:00.000Z";
const owner: DurableActor = { actor_type: "owner", actor_id: "test-owner", actor_role: "owner", actor_label: "Owner", origin: "vantage_admin", request_id: "test-general" };
function saved(id: string) {
  return { _id: id, domain_revision: 0, source_company: "synthetic", source_granularity_id: "scope", timestamp: new Date("2026-11-02T10:00:00Z"), form_fill: false,
    ringcentral: { ingestion_source: "call_log_sync", qualification_reason: "call_log_inbound_target_answered_over_120s", duration_seconds: 120,
      call_log_id: id, start_time: new Date("2026-11-02T15:00:00Z") } };
}
async function fixture() {
  const rows = [saved("one")], records = new Map<string, GeneralCallRunLedger & { unrelated: string }>();
  let projections = 0, revisions = 0;
  const commands = new Set<string>();
  const ledger: GeneralCallRunLedgerStore = {
    async bind(scope, binding, now) {
      if (!records.has(scope)) records.set(scope, { scope, unrelated: "cursor-preserved", general_call_backfill: { ...binding, created_at: now } });
      return structuredClone(records.get(scope)!);
    },
    async read(scope) { return records.has(scope) ? structuredClone(records.get(scope)!) : null; },
    async patch(scope, binding, patch) {
      const record = records.get(scope), state = record?.general_call_backfill;
      if (!state || Object.entries(binding).some(([key, value]) => (state as Record<string, unknown>)[key] !== value)) return false;
      Object.assign(state, structuredClone(patch)); return true;
    },
  };
  const callDependencies: Partial<CallBackfillDependencies> = {
    connect: async () => undefined, database: () => "testvantagemovers", scopes: async () => ["scope"],
    page: async ({ kind, cursor }) => kind === "primary" && !cursor ? rows : [],
    load: async id => rows.find(row => row._id === id) ?? null,
    hasEligibleForm: async () => true, liveRate: async () => 100,
    providerAccount: async () => { throw new Error("no_provider_in_test"); },
    providerRecords: async () => { throw new Error("no_provider_in_test"); },
    repairForm: async input => {
      if (!commands.has(input.context.idempotency_key)) {
        commands.add(input.context.idempotency_key); rows[0]!.form_fill = true; rows[0]!.domain_revision++; revisions++;
      }
      return { status: "applied", entity_refs: [], warnings: [] };
    },
    reproject: async () => { projections++; },
  };
  const plan = await planCallBackfill({ through, deploymentId: deployment }, callDependencies);
  const input: GeneralCallRunInput = { plan, checksum: plan.checksum, expectedDatabase: "testvantagemovers", deploymentId: deployment,
    runId: "synthetic-general-run", owner, assertLease: async () => undefined };
  const deps: Partial<GeneralCallRunDependencies> = { ledger, callDependencies, connect: async () => undefined,
    database: () => "testvantagemovers", now: () => new Date("2026-11-03T22:00:00Z") };
  const readMembership = async () => ({ calls: 0, duplicate_calls: 1, bad_call_leads: 0 });
  return { rows, records, ledger, callDependencies, input, deps, readMembership, counts: () => ({ projections, revisions }) };
}

test("standalone apply/replay binds one frozen plan, preserves other state, and reprojects without repeat revision", async () => {
  const f = await fixture();
  const first = await applyGeneralCallRun(f.input, f.deps);
  assert.deepEqual(first.conflicts, []);
  assert.equal(first.ledger_scope, generalCallRunScope(f.input.runId));
  assert.equal((await verifyGeneralCallRun({ ...f.input, readMembership: f.readMembership }, f.deps)).complete, true);
  await applyGeneralCallRun(f.input, f.deps);
  assert.equal(f.records.get(first.ledger_scope)?.general_call_backfill?.verification_summary, null);
  const verified = await verifyGeneralCallRun({ ...f.input, readMembership: f.readMembership }, f.deps);
  assert.equal(verified.complete, true);
  assert.deepEqual(f.counts(), { projections: 2, revisions: 1 });
  const state = f.records.get(first.ledger_scope)!;
  assert.equal(state.unrelated, "cursor-preserved");
  assert.equal(state.general_call_backfill?.plan_checksum, f.input.checksum);
  assert.equal(state.general_call_backfill?.verification_summary?.complete, true);
  assert.equal(f.records.size, 1);
});

test("checksum, database, deployment, actor, and immutable watermark rebinding fail before domain work", async () => {
  const f = await fixture();
  for (const patch of [{ checksum: "bad" }, { expectedDatabase: "another" }, { deploymentId: "b".repeat(40) },
    { owner: { ...owner, actor_type: "system" as const, actor_role: "system" as const, origin:"vantage_admin" as const } }, { runId: "bad.run" }]) {
    await assert.rejects(applyGeneralCallRun({ ...f.input, ...patch }, f.deps), /general_call_run_/);
  }
  assert.equal(f.records.size, 0);
  await applyGeneralCallRun(f.input, f.deps);
  const changed = { ...f.input.plan, through: "2026-11-03T22:00:00.000Z" };
  changed.checksum = callBackfillPlanChecksum(changed);
  await assert.rejects(applyGeneralCallRun({ ...f.input, plan: changed, checksum: changed.checksum }, f.deps), /immutable_binding_mismatch/);
  await assert.rejects(verifyGeneralCallRun({ ...f.input, plan: changed, checksum: changed.checksum, readMembership: f.readMembership }, f.deps), /immutable_binding_mismatch/);
  assert.deepEqual(f.counts(), { projections: 1, revisions: 1 });
});

test("verify requires the same plan's completed apply ledger and never creates one", async () => {
  const f = await fixture();
  await assert.rejects(verifyGeneralCallRun({ ...f.input, readMembership: f.readMembership }, f.deps), /binding_mismatch/);
  assert.equal(f.records.size, 0);
  const broken = { ...f.deps, callDependencies: { ...f.callDependencies, reproject: async () => { throw new Error("projection_failed"); } } };
  await assert.rejects(applyGeneralCallRun(f.input, broken), /projection_failed/);
  assert.equal(f.records.get(generalCallRunScope(f.input.runId))?.general_call_backfill?.applied, false);
  await assert.rejects(verifyGeneralCallRun({ ...f.input, readMembership: f.readMembership }, f.deps), /apply_required/);
  await applyGeneralCallRun(f.input, f.deps);
  assert.deepEqual(f.counts(), { projections: 1, revisions: 1 });
});

test("independent coverage/membership failures persist incomplete evidence rather than completion", async () => {
  const f = await fixture();
  await applyGeneralCallRun(f.input, f.deps);
  f.rows.push(saved("late"));
  const result = await verifyGeneralCallRun({ ...f.input, readMembership: async () => ({ calls: 1, duplicate_calls: 1, bad_call_leads: 0 }) }, f.deps);
  assert.equal(result.complete, false);
  assert.ok(result.mismatches.some(row => row.reason === "coverage_candidate_missing_from_plan"));
  assert.ok(result.mismatches.some(row => row.reason === "calls_physical_membership"));
  assert.equal(f.records.get(generalCallRunScope(f.input.runId))?.general_call_backfill?.verification_summary?.complete, false);
});

test("lease or ledger compare-and-set loss prevents domain work", async () => {
  const f = await fixture();
  await assert.rejects(applyGeneralCallRun({ ...f.input, assertLease: async () => { throw new Error("lease_lost"); } }, f.deps), /lease_lost/);
  assert.equal(f.records.size, 0);
  await assert.rejects(applyGeneralCallRun(f.input, { ...f.deps, ledger: { ...f.ledger, patch: async () => false } }), /binding_changed/);
  assert.deepEqual(f.counts(), { projections: 0, revisions: 0 });
});
