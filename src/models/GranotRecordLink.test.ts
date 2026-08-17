import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  GRANOT_RECORD_LINK_COLLECTION,
  GRANOT_RECORD_LINK_INDEXES,
  GRANOT_RECORD_LINK_MODEL_NAME,
  GranotRecordLink,
  assertAllowlistedRecordLinkRefreshUpdate,
  getGranotRecordLinkModel,
} from "./GranotRecordLink";

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

test("[AC-32] Record Link model declares the three named indexes including partial unique job", () => {
  assert.equal(GranotRecordLink.modelName, GRANOT_RECORD_LINK_MODEL_NAME);
  assert.equal(GranotRecordLink.collection.collectionName, GRANOT_RECORD_LINK_COLLECTION);
  assert.equal(getGranotRecordLinkModel().modelName, GRANOT_RECORD_LINK_MODEL_NAME);
  const indexes = GranotRecordLink.schema.indexes() as Array<
    [Record<string, unknown>, Record<string, unknown>]
  >;
  for (const expected of GRANOT_RECORD_LINK_INDEXES) {
    const declared = indexes.find(([, options]) => options.name === expected.name);
    assert.ok(declared, expected.name);
    assert.deepEqual(declared?.[0], expected.key);
    if ("unique" in expected) {
      assert.equal(declared?.[1].unique, true);
      assert.deepEqual(declared?.[1].partialFilterExpression, expected.partialFilterExpression);
    }
  }
});

test("[AC-32] Record Link establishment defaults and snapshot normalize back to the Job Number", async () => {
  const document = link();
  await document.validate();
  assert.equal(document.provider, "granot");
  assert.equal(document.state, "active");
  assert.equal(document.disputed, false);
  assert.equal(document.domain_revision, 0);
  assert.equal(document.lead_ref, undefined);
  assert.equal(document.booking_ref, undefined);
  await assert.rejects(
    link({ job_no_snapshot: "other-job" }).validate(),
    /normalize back/,
  );
});

test("[AC-32] disputed active links remain lookup-visible and refresh updates are allowlisted", () => {
  const disputed = link({ disputed: true });
  assert.equal(disputed.state, "active");
  assert.equal(disputed.disputed, true);
  assertAllowlistedRecordLinkRefreshUpdate({
    $set: {
      last_observation_id: new mongoose.Types.ObjectId(),
      last_observed_at: new Date(),
    },
    $inc: { domain_revision: 1 },
  });
  assert.throws(
    () => assertAllowlistedRecordLinkRefreshUpdate({ $set: { disputed: true } }),
    /cannot update disputed/,
  );
  assert.throws(
    () => assertAllowlistedRecordLinkRefreshUpdate({ $setOnInsert: { state: "active" } }),
    /upsert-after-existence/,
  );
});

test("[AC-32] Record Link query hooks reject replace and delete", async () => {
  const id = new mongoose.Types.ObjectId();
  await assert.rejects(GranotRecordLink.replaceOne({ _id: id }, { provider: "granot" }), /replaced or deleted/);
  await assert.rejects(GranotRecordLink.deleteOne({ _id: id }), /replaced or deleted/);
});
