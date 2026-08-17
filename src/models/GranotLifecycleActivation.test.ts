import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  GRANOT_LIFECYCLE_ACTIVATION_COLLECTION,
  GRANOT_LIFECYCLE_ACTIVATION_INDEXES,
  GRANOT_LIFECYCLE_ACTIVATION_MODEL_NAME,
  GranotLifecycleActivation,
  getGranotLifecycleActivationModel,
} from "./GranotLifecycleActivation";

function activation(overrides: Record<string, unknown> = {}) {
  return new GranotLifecycleActivation({
    key: "granot_lifecycle",
    activated_at: new Date("2026-08-17T16:00:00.000Z"),
    activated_by: {
      actor_type: "owner",
      actor_id: "owner-1",
      actor_label: "Owner",
      actor_role: "owner",
      request_id: "req-activation-1",
      origin: "vantage_admin",
    },
    reason: "Synthetic activation for local classification proof",
    processor_version: "granot-lifecycle-processor-v1",
    ...overrides,
  });
}

test("[AC-31] Activation model is write-once with a unique key index", () => {
  assert.equal(GranotLifecycleActivation.modelName, GRANOT_LIFECYCLE_ACTIVATION_MODEL_NAME);
  assert.equal(
    GranotLifecycleActivation.collection.collectionName,
    GRANOT_LIFECYCLE_ACTIVATION_COLLECTION,
  );
  assert.equal(
    getGranotLifecycleActivationModel().modelName,
    GRANOT_LIFECYCLE_ACTIVATION_MODEL_NAME,
  );
  const indexes = GranotLifecycleActivation.schema.indexes() as Array<
    [Record<string, unknown>, Record<string, unknown>]
  >;
  const unique = GRANOT_LIFECYCLE_ACTIVATION_INDEXES[0];
  const declared = indexes.find(([, options]) => options.name === unique.name);
  assert.ok(declared);
  assert.deepEqual(declared?.[0], unique.key);
  assert.equal(declared?.[1].unique, true);
});

test("[AC-31] Activation rejects unknown keys and post-insert mutation", async () => {
  await activation().validate();
  await assert.rejects(activation({ key: "other" }).validate(), /key|enum/);
  const document = activation();
  document.isNew = false;
  await assert.rejects(document.save(), /write-once/);
  const id = new mongoose.Types.ObjectId();
  await assert.rejects(
    GranotLifecycleActivation.updateOne({ _id: id }, { $set: { reason: "edited" } }),
    /updated, replaced, deleted, or upserted/,
  );
  await assert.rejects(
    GranotLifecycleActivation.findOneAndUpdate(
      { key: "granot_lifecycle" },
      { $set: { processor_version: "x" } },
      { upsert: true },
    ),
    /updated, replaced, deleted, or upserted/,
  );
  await assert.rejects(GranotLifecycleActivation.deleteOne({ _id: id }), /updated, replaced, deleted/);
});
