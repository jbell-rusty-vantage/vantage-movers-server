import assert from "node:assert/strict";
import test from "node:test";
import {
  GRANOT_LIFECYCLE_SHADOW_SCRIPT_VERSION,
  assertCheckpointCompatible,
  parseShadowCliOptions,
  runHistoricalShadowCertification,
  type ForbiddenCollectionSnapshot,
  type ShadowCheckpoint,
} from "./granot-lifecycle-shadow.lib.js";

const IDS = ["66c000000000000000000001", "66c000000000000000000002"];
test("[AC-31][AC-35] shadow CLI requires bounded limit and validates resume IDs", () => {
  assert.deepEqual(parseShadowCliOptions(["--limit=2", `--after-id=${IDS[0]}`]), { limit: 2, after_id: IDS[0] });
  assert.throws(() => parseShadowCliOptions([]), /Exactly one --limit/);
  assert.throws(() => parseShadowCliOptions(["--limit=0"]), /integer from 1/);
  assert.throws(() => parseShadowCliOptions(["--limit=2", "--raw"]), /Unknown/);
  assert.throws(() => parseShadowCliOptions(["--limit=2", "--after-id=customer-shaped"]), /valid ObjectId/);
});
test("[AC-31] checkpoint resume cannot move backward or cross environments", () => {
  const checkpoint: ShadowCheckpoint = { script_version: GRANOT_LIFECYCLE_SHADOW_SCRIPT_VERSION, environment_fingerprint: "safe-test", selection_after_id: null, last_completed_receipt_id: IDS[1], completed_count: 2, report_hash: "hash" };
  assert.equal(assertCheckpointCompatible({ checkpoint, environmentFingerprint: "safe-test" }), IDS[1]);
  assert.throws(() => assertCheckpointCompatible({ checkpoint, environmentFingerprint: "safe-test", requestedAfterId: IDS[0] }), /cannot move behind/);
  assert.throws(() => assertCheckpointCompatible({ checkpoint, environmentFingerprint: "different" }), /incompatible environment/);
});
function snapshot(count = 0): ForbiddenCollectionSnapshot { return { booked_leads: { count, state_hash: `hash-${count}` } }; }
test("[AC-31][AC-35] runner persists only historical Decisions and PII-safe distributions", async () => {
  const checkpoints: ShadowCheckpoint[] = [];
  const report = await runHistoricalShadowCertification({
    options: { limit: 2 },
    deps: {
      environmentFingerprint: "safe-test", activationFingerprint: async () => "activation", loadCheckpoint: async () => null,
      saveCheckpoint: async (value) => { checkpoints.push(value); },
      listReceipts: async () => ({ receipts: IDS.map((id) => ({ id, captured_at: new Date("2026-01-01T00:00:00.000Z"), event_class: "lead_created" })), excludedPostCutoffCount: 1 }),
      snapshotForbiddenCollections: async () => snapshot(),
      processReceipt: async (id) => ({ decision_id: `decision-${id}`, outcome: "deferred" }),
      loadDecision: async (decisionId) => ({ decision_id: decisionId, execution_mode: "historical_shadow", outcome: "deferred", reason_code: "historical_shadow", match_method: "none", source_ref: "none", effect_kinds: [] }),
    },
  });
  assert.equal(report.passed, true); assert.equal(report.counts.processed, 2); assert.equal(checkpoints.length, 2);
  assert.deepEqual(report.masked_sample_ids, ["66c0…0001", "66c0…0002"]); assert.equal(JSON.stringify(report).includes(IDS[0]), false);
});
test("[AC-31] runner fails closed on live-shadow promotion and aggregate drift", async () => {
  const base = {
    environmentFingerprint: "safe-test", activationFingerprint: async () => "activation", loadCheckpoint: async () => null,
    saveCheckpoint: async () => undefined,
    listReceipts: async () => ({ receipts: [{ id: IDS[0], captured_at: new Date("2026-01-01T00:00:00.000Z"), event_class: "lead_created" }], excludedPostCutoffCount: 0 }),
    snapshotForbiddenCollections: async () => snapshot(), processReceipt: async () => ({ decision_id: "decision", outcome: "deferred" as const }),
  };
  await assert.rejects(runHistoricalShadowCertification({ options: { limit: 1 }, deps: { ...base, loadDecision: async () => ({ decision_id: "decision", execution_mode: "live_shadow", outcome: "deferred", reason_code: "source_deferred", match_method: "none", source_ref: "none", effect_kinds: [] }) } }), /non-historical Decision/);
  let call = 0;
  const drift = await runHistoricalShadowCertification({ options: { limit: 1 }, deps: { ...base, listReceipts: async () => ({ receipts: [], excludedPostCutoffCount: 0 }), snapshotForbiddenCollections: async () => snapshot(call++), loadDecision: async () => null } });
  assert.equal(drift.passed, false); assert.deepEqual(drift.forbidden_effects.changed_collections, ["booked_leads"]);
});
