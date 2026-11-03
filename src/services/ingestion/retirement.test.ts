import assert from "node:assert/strict";
import { test } from "node:test";
import { granotCreationRetired, BEST_RELOCATION_RETIRED_LABELS } from "../../models/bestRelocationRetirement";
import { validateGranotCrmSourceSemantics } from "../../models/granotCrmSourceSemantics";
import { resolveSourcePolicy, type SourcePolicyStore, type SourcePolicyRow } from "../granotLifecycle/sourcePolicy";
import { publishIngestionWakeup } from "./queue";
import { runBestRelocationIngestionWorker } from "./worker";

const row: SourcePolicyRow = { id: "source", enabled: true, lifecycle_enabled: true,
 lifecycle_disposition: "source_scoped_lead", lead_created_policy: "create_if_missing",
 lead_source_company: "company", lifecycle_policy_version: "old/v1",
 lifecycle_routes: [{ route_key: "form", lead_model: "FormLead", move_type: "any", source_granularity_id: "feed" }] };
function store(source: SourcePolicyRow, company: { company_slug?: string; granot_creation_retired_at?: Date } = {}): SourcePolicyStore {
 return { findByNormalizedLabel: async () => [source],
 findCompany: async () => ({ id: "company", active: true, ...company }),
 findGranularity: async () => ({ id: "feed", active: true, source_company_id: "company", channel: "form" }) };
}
test("stale Granot creates become link-only for every exact Best Relocation route, preserving linking", async () => {
 for (const label of BEST_RELOCATION_RETIRED_LABELS) {
  const policy = await resolveSourcePolicy({ source_label: label.toUpperCase() }, store(row));
  assert.equal(policy.ok, true);
  if (policy.ok) { assert.equal(policy.snapshot.lead_created_policy, "link_only"); assert.equal(policy.snapshot.selected_lead_model, "FormLead"); }
 }
});
test("canonical company and durable source IDs stay fenced after source-label edits; other companies can create", async () => {
 for (const context of [{ company_slug: "best_relocation_leads" }, { granot_creation_retired_at: new Date() }]) {
  const policy = await resolveSourcePolicy({ source_label: "renamed" }, store(row, context));
  assert.ok(policy.ok); assert.equal(policy.snapshot.lead_created_policy, "link_only");
 }
 const retired = await resolveSourcePolicy({ source_label: "renamed" }, store({ ...row, granot_creation_retired_at: new Date() }));
 assert.ok(retired.ok); assert.equal(retired.snapshot.lead_created_policy, "link_only");
 const unrelated = await resolveSourcePolicy({ source_label: "Other forms" }, store(row));
 assert.ok(unrelated.ok); assert.equal(unrelated.snapshot.lead_created_policy, "create_if_missing");
 assert.equal(granotCreationRetired({ granot_label: "Best Relocation Forms Other" }), false);
});
test("Setup and seed semantic validation cannot restore Best Relocation create-if-missing", () => {
 const result = validateGranotCrmSourceSemantics({ ...row, granot_label: "BestRelocation Forms", lifecycle_enabled: true });
 assert.equal(result.ok, false);
 const renamed = validateGranotCrmSourceSemantics({ ...row, granot_label: "renamed" }, { company: { id: "company", active: true, company_slug: "best_relocation_leads" } });
 assert.equal(renamed.ok, false);
});
test("old environment flags cannot wake retired scheduled/queued ingestion", async () => {
 process.env.BEST_RELOCATION_INGEST_ENABLED = "true";
 assert.deepEqual(await runBestRelocationIngestionWorker(), { claimed: false, status: "retired" });
 assert.equal(await publishIngestionWakeup({ reason: "retry", run_hint: "old-run" }), false);
});
