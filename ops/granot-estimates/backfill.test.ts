import assert from "node:assert/strict";
import { test } from "node:test";
import { windows, reviewChecksum } from "./backfill";
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
