import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { GranotRecordLink, assertAllowlistedRecordLinkRefreshUpdate } from "./GranotRecordLink";

function link(overrides: Record<string, unknown> = {}) {
  return new GranotRecordLink({
    provider: "granot",
    normalized_job_no: "SYNTHETIC JOB 100",
    job_no_snapshot: "synthetic-job-100",
    state: "active",
    disputed: false,
    established_by_decision_id: new mongoose.Types.ObjectId(),
    established_at: new Date("2026-08-17T16:00:00.000Z"),
    last_observation_id: new mongoose.Types.ObjectId(),
    last_observed_at: new Date("2026-08-17T16:00:00.000Z"),
    domain_revision: 0,
    ...overrides,
  });
}

test("[AC-23][AC-32] disputed active links remain lookup-visible and correction supersession is narrowly allowlisted", () => {
  const disputed = link({ disputed: true });
  assert.equal(disputed.state, "active");
  assert.equal(disputed.disputed, true);
  assertAllowlistedRecordLinkRefreshUpdate({
    $set: {
      last_observation_id: new mongoose.Types.ObjectId(),
      last_observed_at: new Date(),
      lead_ref: { model: "FormLead", id: new mongoose.Types.ObjectId() },
      disputed: true,
      dispute_reason: "source_scope_conflict",
    },
    $inc: { domain_revision: 1 },
  });
  assertAllowlistedRecordLinkRefreshUpdate({ $set: { state: "superseded", superseded_by: new mongoose.Types.ObjectId() } });
  assert.throws(
    () => assertAllowlistedRecordLinkRefreshUpdate({ $set: { state: "active" } }),
    /atomically set superseded/,
  );
  assert.throws(
    () => assertAllowlistedRecordLinkRefreshUpdate({ $set: { booking_ref: new mongoose.Types.ObjectId() } }),
    /cannot update booking_ref/,
  );
  assert.throws(
    () => assertAllowlistedRecordLinkRefreshUpdate({ $setOnInsert: { state: "active" } }),
    /upsert-after-existence/,
  );
});
