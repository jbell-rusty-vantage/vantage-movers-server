import assert from "node:assert/strict";
import test from "node:test";
import { ExternalDataConnection } from "../../src/models/ExternalDataConnection";
import { shutdownBestRelocationWithoutIngestion, type BestRelocationShutdownInput } from "./shutdown";
import { assertDeferredFinalIngestionRelease } from "../../src/services/ingestion/finalReconciliationFence";

const input: BestRelocationShutdownInput = { company_id: "600000000000000000000001", source_ids: ["600000000000000000000002"],
  shutdown_id: "shutdown:synthetic-evidence", actor: { actor_type: "owner", actor_role: "owner", actor_id: "owner", actor_label: "Owner", origin: "vantage_admin", request_id: "shutdown-request" } };

test("decoupled shutdown delegates deferred policy cutover and never claims source apply or company deactivation", async () => {
  let calls = 0;
  const result = await shutdownBestRelocationWithoutIngestion(input, { retire: async actual => {
    calls++; assert.deepEqual(actual, { company_id: input.company_id, source_ids: input.source_ids, final_run_id: input.shutdown_id,
      actor: input.actor, reconciliation_status: "deferred" });
    return { cancelled_runs: 3, source_ids: [...input.source_ids] };
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result, { shutdown_id: input.shutdown_id, cancelled_runs: 3, source_ids: input.source_ids,
    reconciliation_status: "pending_owner_review", source_apply_performed: false, source_company_deactivated: false });
});

test("shutdown fails closed before touching persistence for incomplete inventory or non-Owner context", async () => {
  let calls = 0;
  const dependencies = { retire: async () => { calls++; return { cancelled_runs: 0, source_ids: [] }; } };
  for (const patch of [{ shutdown_id: "" }, { source_ids: [] }, { source_ids: [input.source_ids[0]!, input.source_ids[0]!] },
    { company_id: "wrong" }, { actor: { actor_type: "admin" as const, actor_role: "admin" as const, actor_id: "admin", actor_label: "Admin", origin: "vantage_admin" as const, request_id: "shutdown-denied" } }]) {
    await assert.rejects(shutdownBestRelocationWithoutIngestion({ ...input, ...patch }, dependencies));
  }
  assert.equal(calls, 0);
});

test("durable deferred marker remains distinct from final retirement and final-run evidence", () => {
  const connection = new ExternalDataConnection({ key: "best_relocation", workbook_env_keys: { leads: "archive", booked: "archive" },
    created_actor: input.actor, updated_actor: input.actor, application_enabled: false, next_due_at: null,
    retirement_shutdown_at: new Date(), retirement_shutdown_run_id: input.shutdown_id, retirement_ingestion_deferred: true,
    retirement_reconciliation_status: "pending_owner_review" });
  assert.equal(connection.validateSync(), undefined);
  assert.equal(connection.retired_at, null);
  assert.equal(connection.retirement_final_run_id, null);
  assert.equal(connection.retirement_shutdown_run_id, input.shutdown_id);
  assert.equal(connection.retirement_ingestion_deferred, true);
});

test("deferred shutdown denies old approved runs and permits only later exact-checksum Owner release", () => {
  const checksum = "a".repeat(64), held = { retirement_ingestion_deferred: true };
  assert.throws(() => assertDeferredFinalIngestionRelease(held, { plan_checksum: checksum, approval: { final_reconciliation: true } }), /pending_owner_review/);
  assert.throws(() => assertDeferredFinalIngestionRelease(held, { plan_checksum: checksum, approval: { owner_released_deferred_ingestion_checksum: "b".repeat(64) } }), /pending_owner_review/);
  assert.throws(() => assertDeferredFinalIngestionRelease(held, { plan_checksum: null, approval: { owner_released_deferred_ingestion_checksum: null } }), /pending_owner_review/);
  assert.doesNotThrow(() => assertDeferredFinalIngestionRelease(held, { plan_checksum: checksum, approval: { owner_released_deferred_ingestion_checksum: checksum } }));
  assert.doesNotThrow(() => assertDeferredFinalIngestionRelease({ retirement_ingestion_deferred: false }, {}));
  assert.equal(held.retirement_ingestion_deferred, true);
});
