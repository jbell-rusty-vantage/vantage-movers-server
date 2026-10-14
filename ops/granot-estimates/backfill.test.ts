import assert from "node:assert/strict";
import { test } from "node:test";
import { windows, reviewChecksum, reportSummary, shouldRefreshManifest } from "./backfill";
import { ownerApi } from "./api-client";

test("backfill windows cover inclusive dates across leap year and month boundaries without overlap", () => {
  assert.deepEqual(windows("02/27/2024", "03/08/2024"), [{ from: "02/27/2024", to: "03/04/2024" }, { from: "03/05/2024", to: "03/08/2024" }]);
  for (const days of [0, -1, 8, NaN]) assert.throws(() => windows("10/01/2026", "10/14/2026", days));
  assert.throws(() => windows("02/29/2026", "03/01/2026"));
  assert.throws(() => windows("10/14/2026", "10/01/2026"));
});

test("review checksum binds exact action ids, preview checksum, identity and date scope", () => {
  const manifest = { version: 1 as const, from: "10/01/2026", to: "10/07/2026", created_at: "2026-10-14", entries: [{ window: { from: "10/01/2026", to: "10/07/2026" }, run_id: "a".repeat(24), checksum: "b".repeat(64), selected_action_ids: ["one"] }] };
  const original = reviewChecksum(manifest);
  assert.equal(reviewChecksum({ ...manifest, entries: [{ ...manifest.entries[0]!, status: "applying", approved: true }] }), original);
  assert.notEqual(reviewChecksum({ ...manifest, entries: [{ ...manifest.entries[0]!, selected_action_ids: ["two"] }] }), original);
  assert.notEqual(reviewChecksum({ ...manifest, entries: [{ ...manifest.entries[0]!, checksum: "c".repeat(64) }] }), original);
});

test("backfill client refuses arbitrary hosts, mutation paths and GET bodies before using credentials", async () => {
  await assert.rejects(ownerApi("POST", "/api/v1/admin/form-leads", {}), /allowlist/);
  await assert.rejects(ownerApi("GET", "https://attacker.test/path"), /allowlist/);
  await assert.rejects(ownerApi("GET", "/api/v1/admin/form-leads", {}), /GET cannot/);
});

test("preview reporting deduplicates normalized Jobs across windows and records matching/held scope without raw identities", () => {
  const summary = reportSummary([
    { action_id: "one", source_label: "Synthetic", classification: "update", report_identity: { version: 1, normalized_job_sha256: "a".repeat(64), lead_model: "CallLead", match_method: "call_job_no_exact" } },
    { action_id: "repeat", source_label: "Synthetic", classification: "update", report_identity: { version: 1, normalized_job_sha256: "a".repeat(64), lead_model: "CallLead", match_method: "source_scoped_contact" } },
    { action_id: "held", source_label: "Other", classification: "conflict", reason: "job_number_conflict", report_identity: { version: 1, normalized_job_sha256: "b".repeat(64), lead_model: "FormLead" } },
  ]);
  assert.equal(summary.row_count, 3);
  assert.equal(summary.unique_normalized_job_count, 2);
  assert.deepEqual(summary.match_method_counts, { call_job_no_exact: 1, source_scoped_contact: 1, not_matched: 1 });
  assert.deepEqual(summary.held_reasons_by_source, { Other: { job_number_conflict: 1 } });
  assert.deepEqual(summary.held_reasons_by_model, { FormLead: { job_number_conflict: 1 } });
  assert.equal(JSON.stringify(summary).includes("a".repeat(64)), false);
  const legacy = reportSummary([{ action_id: "old", classification: "update" }]);
  assert.equal(legacy.identity_metadata_complete, false);
  assert.equal(legacy.unique_normalized_job_count, null);
  assert.deepEqual(legacy.match_method_counts, { unavailable: 1 });
});

test("apply reads authoritative receipts initially, every ten batches and at its final budget", () => {
  assert.deepEqual(Array.from({ length: 24 }, (_, pass) => pass).filter((pass) => shouldRefreshManifest(pass, "apply", 23)), [0, 10, 20, 23]);
  assert.equal(shouldRefreshManifest(0, "verify"), true);
  assert.equal(shouldRefreshManifest(800, "apply"), true);
  assert.equal(shouldRefreshManifest(799, "apply"), false);
});
