import assert from "node:assert/strict";
import test from "node:test";
import { applyBestRelocationPlan } from "./applyPlan";
import { computeChecksum, createBestRelocationIngestionActor } from "../durableWork";
import { InMemoryLeaseStore } from "../durableWork/testing";
import { type BestRelocationApplicationPlan, type BestRelocationPlanAction } from "../bestRelocationSheetIngest/applicationPlan";
import type { CanonicalCommandContext } from "../domainCommands/types";

for (const severity of ["blocking", "warning"] as const) test(`final apply ${severity} conflict propagates dependency outcome without attempting blocked commands`, async () => {
  const base: BestRelocationPlanAction = {
    action_key: "synthetic:conflict", command: "record_conflict", classification: "conflict",
    dataset_key: "forms", stable_source_row_id: "synthetic:conflict", content_hash: "a".repeat(64),
    schema_profile: "forms:v2", schema_version: 2, depends_on: [],
    provenance: { workbook_id: "synthetic", workbook_title: "Synthetic", tab: "Forms", sheet_row: 2, source_row_key: "synthetic", raw: {} },
    conflict: { type: "canonical_divergence", severity },
  };
  const dependent: BestRelocationPlanAction = { ...base, action_key: "synthetic:dependent", stable_source_row_id: "synthetic:dependent", command: "create_form_lead", classification: "create", conflict: undefined, depends_on: [base.action_key], command_payload: { name: "Synthetic" } };
  delete dependent.conflict;
  const child: BestRelocationPlanAction = { ...dependent, action_key: "synthetic:child", stable_source_row_id: "synthetic:child", depends_on: [dependent.action_key] };
  const independent: BestRelocationPlanAction = { ...dependent, action_key: "synthetic:independent", stable_source_row_id: "synthetic:independent", depends_on: [] };
  const plan: BestRelocationApplicationPlan = {
    adapter_key: "best_relocation", schema_version: 2, trigger: "manual", cutoff: "2026-04-30T04:00:00Z", timezone: "America/New_York", source_read_through: "2026-11-03T12:00:00Z",
    source_snapshot: { leads: { id: "synthetic", title: "Synthetic" }, booked: { id: "synthetic", title: "Synthetic" } }, calibration_version: "best-relocation-conservative-v2",
    actions: [base, dependent, child, independent], counters: {}, warnings: [],
  };
  const checksum = computeChecksum({ checksum_version: 1, artifact_kind: "ingestion_plan", schema_version: 2, payload: plan });
  const leaseStore = new InMemoryLeaseStore(), now = new Date("2026-11-03T12:00:00Z");
  const lease = await leaseStore.acquire({ scope: "ingestion:best_relocation:apply", owner: "synthetic", ttl_ms: 60_000, now });
  assert.ok(lease);
  const calls: string[] = [], failedKeys: string[][] = [];
  const result = await applyBestRelocationPlan({
    plan, checksum, final_reconciliation: { run_id: "synthetic", plan_checksum: checksum }, run_id: "synthetic", connection_id: "synthetic",
    actor: createBestRelocationIngestionActor("synthetic"),
    initiator: { actor_type: "owner", actor_id: "synthetic", actor_label: "Synthetic", actor_role: "owner", request_id: "synthetic", origin: "vantage_admin" },
    lease, leaseStore, now: () => now, assertApplicationEnabled: async () => undefined,
    commands: { createFormLead: async ({ context }: { context: CanonicalCommandContext }) => {
      calls.push(context.idempotency_key);
      return { status: "applied", entity_refs: [{ model: "FormLead", id: "507f1f77bcf86cd799439011" }], warnings: [] };
    } } as unknown as Parameters<typeof applyBestRelocationPlan>[0]["commands"],
    persistence: { appendSourceReceipt: async () => ({ id: "synthetic", inserted: true }), openIngestionConflict: async () => ({ id: "synthetic", inserted: true }),
      isIngestionConflictDispositioned: async () => false, preallocateReceiptId: () => "507f1f77bcf86cd799439099", resolvedActionIdsForRun: async () => new Map() },
    onCheckpoint: async checkpoint => { failedKeys.push(checkpoint.failed_action_keys); },
  });
  assert.equal(result.conflicts, 1);
  assert.equal(result.failures, 0);
  assert.equal(result.skipped_dependencies, severity === "blocking" ? 2 : 0);
  assert.deepEqual(calls, severity === "blocking" ? [independent.action_key] : [dependent.action_key, child.action_key, independent.action_key]);
  assert.deepEqual(failedKeys.at(-1), severity === "blocking" ? [base.action_key, dependent.action_key, child.action_key] : []);
});
