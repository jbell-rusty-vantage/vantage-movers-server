import assert from "node:assert/strict";
import test from "node:test";
import { buildHistoricalManifest, parseHistoricalManifest } from "./manifest";
import { assertApplyAuthorized, assertRollbackAuthorized } from "./targetGuard";
import { createHistoricalMigrationRunner, requireHistoricalMigrationContext } from "./migrationContext";
import type { BuildHistoricalManifestInput } from "./manifest";

function input(): BuildHistoricalManifestInput {
  const time = "2026-07-31T12:00:00.000Z";
  return {
    manifest_id: "manifest-1",
    created_at: time,
    planning_timestamp: time,
    git_sha: "abc123",
    target_database: "vantagemovers",
    target_cluster_fingerprint: "cluster",
    source_inventory_checksum: "inventory",
    source_snapshot_hash: "source",
    historical_snapshot_hash: "historical",
    production_snapshot_hash: "production",
    target_collection_checksums: {},
    policy_hashes: {},
    decision_bundle_hash: "",
    expected_indexes: [],
    expected_counts: { customers: { before: 0, inserts: 1, after: 1 } },
    operations: [{ migration_key: "customer:job:P1", order: 20, action: "insert", model: "Customer", collection: "customers", target_id: "507f1f77bcf86cd799439011", provenance: [], document: { full_name: "Jane / John", normalized_name: "jane / john", createdAt: { $date: time }, updatedAt: { $date: time } }, precondition: { _id: { $exists: false } } }],
    conflicts: [],
    quarantine: [],
    decisions: { schema_version: "1.0.0", decisions: [] },
  };
}

test("manifest bytes and hash are stable for identical reviewed inputs", () => {
  const first = buildHistoricalManifest(input());
  const second = buildHistoricalManifest(input());
  assert.deepEqual(first, second);
  assert.deepEqual(parseHistoricalManifest(JSON.stringify(first)), first);
});

test("manifest identity is deterministic when the caller does not supply one", () => {
  const withoutId = { ...input(), manifest_id: undefined };
  const first = buildHistoricalManifest(withoutId);
  const second = buildHistoricalManifest(withoutId);
  assert.equal(first.manifest_id, second.manifest_id);
  assert.equal(first.manifest_hash, second.manifest_hash);
});

test("manifest parser rejects modified bytes", () => {
  const manifest = buildHistoricalManifest(input());
  assert.throws(() => parseHistoricalManifest(JSON.stringify({ ...manifest, git_sha: "changed" })), /hash mismatch/);
});

test("rehearsal and production target guards fail closed", () => {
  const manifest = buildHistoricalManifest(input());
  assert.throws(() => assertApplyAuthorized(manifest, "testvantagemovers", { apply: false, production_apply: false, target: "testvantagemovers" }), /dry-run by default/);
  assert.doesNotThrow(() => assertApplyAuthorized(manifest, "testvantagemovers", { apply: true, production_apply: false, target: "testvantagemovers" }));
  assert.throws(() => assertApplyAuthorized(manifest, "vantagemovers", { apply: true, production_apply: true, target: "vantagemovers" }), /authorization failed/);
  assert.doesNotThrow(() => assertApplyAuthorized(manifest, "vantagemovers", { apply: true, production_apply: true, target: "vantagemovers", database_confirmation: "vantagemovers", manifest_hash_confirmation: manifest.manifest_hash, git_sha: manifest.git_sha, backup_id: "backup-1", restore_test_evidence: "restore-tested", rehearsal_evidence: { manifest_hash: manifest.manifest_hash, first_apply_verified: true, second_apply_noop: true, rollback_verified: true }, human_confirmation: `APPLY ${manifest.manifest_hash} TO vantagemovers` }));
  assert.throws(() => assertRollbackAuthorized("vantagemovers", manifest.manifest_hash, true, "vantagemovers"), /exact database, manifest hash/);
  assert.doesNotThrow(() => assertRollbackAuthorized("vantagemovers", manifest.manifest_hash, true, "vantagemovers", manifest.manifest_hash, `ROLLBACK ${manifest.manifest_hash} FROM vantagemovers`));
});

test("migration context cannot be enabled outside the canonical local adapter", async () => {
  assert.throws(() => createHistoricalMigrationRunner("src/routes/v1.routes.ts"), /restricted/);
  const runner = createHistoricalMigrationRunner("C:/repo/scripts/historical_production_db_staged_merge_ingestion/apply.ts");
  await runner.run("hash", new Date("2026-07-31T12:00:00.000Z"), async () => {
    const context = requireHistoricalMigrationContext();
    assert.equal(context.suppress_sheet_sync, true);
    assert.equal(context.suppress_crm, true);
    assert.equal(context.suppress_messages, true);
    assert.equal(context.suppress_notifications, true);
    assert.equal(context.suppress_observability, true);
    assert.equal(context.suppress_enrichment, true);
  });
});
