import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  SYNCHRONIZATION_EFFECT_KINDS,
  SYNCHRONIZATION_OUTCOMES,
  SYNCHRONIZATION_REASON_CODES,
} from "./granotLifecycleSchemas";
import {
  SYNCHRONIZATION_DECISION_COLLECTION,
  SYNCHRONIZATION_DECISION_INDEXES,
  SYNCHRONIZATION_DECISION_MODEL_NAME,
  SynchronizationDecision,
  getSynchronizationDecisionModel,
} from "./SynchronizationDecision";

function decision(overrides: Record<string, unknown> = {}) {
  return new SynchronizationDecision({
    observation_id: new mongoose.Types.ObjectId(),
    attempt: 1,
    execution_mode: "historical_shadow",
    outcome: "policy_blocked",
    reason_code: "historical_shadow",
    decided_at: new Date("2026-08-17T16:00:00.000Z"),
    ...overrides,
  });
}

test("[AC-02] Decision model uses the named collection and four named indexes", () => {
  assert.equal(SynchronizationDecision.modelName, SYNCHRONIZATION_DECISION_MODEL_NAME);
  assert.equal(
    SynchronizationDecision.collection.collectionName,
    SYNCHRONIZATION_DECISION_COLLECTION,
  );
  assert.equal(getSynchronizationDecisionModel().modelName, SYNCHRONIZATION_DECISION_MODEL_NAME);
  assert.equal(SYNCHRONIZATION_DECISION_INDEXES.length, 4);
  const indexes = SynchronizationDecision.schema.indexes() as Array<
    [Record<string, unknown>, Record<string, unknown>]
  >;
  for (const expected of SYNCHRONIZATION_DECISION_INDEXES) {
    const declared = indexes.find(([, options]) => options.name === expected.name);
    assert.ok(declared, expected.name);
    assert.deepEqual(declared?.[0], expected.key);
    if ("unique" in expected) {
      assert.equal(declared?.[1].unique, true);
    }
  }
});

test("[AC-02] Decision defaults empty arrays and rejects invented outcomes", async () => {
  const document = decision();
  await document.validate();
  assert.deepEqual(document.candidates, []);
  assert.deepEqual(document.evaluated_gates, []);
  assert.deepEqual(document.effects, []);
  await assert.rejects(decision({ attempt: 0 }).validate(), /attempt/);
  await assert.rejects(decision({ outcome: "blocked" }).validate(), /outcome|enum/);
  assert.ok(!SYNCHRONIZATION_OUTCOMES.includes("blocked" as never));
  assert.ok(SYNCHRONIZATION_REASON_CODES.includes("historical_shadow"));
  assert.ok(SYNCHRONIZATION_EFFECT_KINDS.includes("record_link_established"));
});

test("[AC-02] Decision documents omit copied contact and payload fields", async () => {
  const document = decision();
  await document.validate();
  const json = document.toObject() as Record<string, unknown>;
  for (const forbidden of ["payload", "headers", "contact", "phone", "email", "source_label"]) {
    assert.equal(forbidden in json, false, forbidden);
  }
});

test("[AC-02] Decision save and query hooks reject post-insert mutation", async () => {
  const document = decision();
  document.isNew = false;
  await assert.rejects(document.save(), /write-once/);
  const id = new mongoose.Types.ObjectId();
  await assert.rejects(
    SynchronizationDecision.updateOne({ _id: id }, { $set: { outcome: "linked" } }),
    /updated, replaced, or deleted/,
  );
  await assert.rejects(SynchronizationDecision.deleteOne({ _id: id }), /updated, replaced, or deleted/);
});
