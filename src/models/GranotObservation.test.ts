import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { GranotObservation } from "./GranotObservation";

const capturedAt = new Date("2026-08-17T16:00:00.000Z");

function observation(overrides: Record<string, unknown> = {}) {
  return new GranotObservation({
    receipt_id: new mongoose.Types.ObjectId(),
    schema_version: 1,
    kind: "lead_snapshot",
    normalization_result: "valid",
    captured_at: capturedAt,
    identity: {},
    contact: {},
    move: {},
    priority: { valid: true, raw: "1", canonical: "1" },
    booking_action: {},
    display_money: {},
    agent_identity: {},
    provider_context: {},
    issues: [],
    ...overrides,
  });
}

test("[AC-05] model save and query hooks reject post-insert Observation mutation", async () => {
  const document = observation();
  document.isNew = false;
  await assert.rejects(document.save(), /write-once/);
  const id = new mongoose.Types.ObjectId();
  await assert.rejects(
    GranotObservation.updateOne({ _id: id }, { $set: { normalization_result: "invalid" } }),
    /updated, replaced, or deleted/,
  );
  await assert.rejects(
    GranotObservation.replaceOne({ _id: id }, { kind: "lead_snapshot" }),
    /updated, replaced, or deleted/,
  );
  await assert.rejects(
    GranotObservation.deleteOne({ _id: id }),
    /updated, replaced, or deleted/,
  );
});
