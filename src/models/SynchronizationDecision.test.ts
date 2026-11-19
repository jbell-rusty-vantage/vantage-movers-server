import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { SynchronizationDecision } from "./SynchronizationDecision";

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
