import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { GranotLifecycleActivation } from "./GranotLifecycleActivation";

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
