import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import type {
  GranotBookingAction,
  GranotObservationKind,
  NormalizationIssueCode,
  NormalizationResult,
} from "../services/granotLifecycle/types";
import {
  GRANOT_BOOKING_ACTIONS,
  NORMALIZATION_ISSUE_CODES,
  NORMALIZATION_RESULTS,
  OBSERVATION_KINDS,
} from "./granotLifecycleSchemas";
import {
  GRANOT_OBSERVATION_COLLECTION,
  GRANOT_OBSERVATION_INDEXES,
  GRANOT_OBSERVATION_MODEL_NAME,
  GranotObservation,
  getGranotObservationModel,
} from "./GranotObservation";

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

test("[AC-05] Observation model uses the named collection and mongoose name", () => {
  assert.equal(GranotObservation.modelName, GRANOT_OBSERVATION_MODEL_NAME);
  assert.equal(GranotObservation.modelName, "GranotObservation");
  assert.equal(GranotObservation.collection.collectionName, GRANOT_OBSERVATION_COLLECTION);
  assert.equal(GranotObservation.collection.collectionName, "granot_observations");
  assert.equal(getGranotObservationModel().modelName, GRANOT_OBSERVATION_MODEL_NAME);
});

test("[AC-05][AC-06][AC-25][AC-29] declares exactly six named indexes and unique receipt_id only", () => {
  assert.equal(GRANOT_OBSERVATION_INDEXES.length, 6);
  const indexes = GranotObservation.schema.indexes() as Array<
    [Record<string, unknown>, Record<string, unknown>]
  >;
  const uniqueNames: string[] = [];
  for (const expected of GRANOT_OBSERVATION_INDEXES) {
    const declared = indexes.find(([, options]) => options.name === expected.name);
    assert.ok(declared, expected.name);
    assert.deepEqual(declared?.[0], expected.key);
    if ("unique" in expected) {
      assert.equal(declared?.[1].unique, true);
      uniqueNames.push(expected.name);
    } else {
      assert.notEqual(declared?.[1].unique, true);
    }
  }
  assert.deepEqual(uniqueNames, ["granot_observation_receipt_id_unique"]);
  assert.ok(
    indexes.every(([, options]) => options.expireAfterSeconds == null),
  );
});

test("[AC-05][AC-06][AC-25] frozen Observation enums are not widened", () => {
  const kinds: readonly GranotObservationKind[] = OBSERVATION_KINDS;
  const results: readonly NormalizationResult[] = NORMALIZATION_RESULTS;
  const issues: readonly NormalizationIssueCode[] = NORMALIZATION_ISSUE_CODES;
  const actions: readonly GranotBookingAction[] = GRANOT_BOOKING_ACTIONS;
  assert.deepEqual(kinds, ["lead_snapshot", "booking_action_snapshot"]);
  assert.deepEqual(results, ["valid", "valid_with_issues", "invalid", "unsupported"]);
  assert.deepEqual(actions, ["booked", "release"]);
  assert.ok(!issues.includes("invented_issue" as NormalizationIssueCode));
  assert.equal(issues.includes("granot_agent_identity_conflict"), true);
});

test("[AC-05] Observation documents reject unknown kinds, results, and issue codes", async () => {
  await observation().validate();
  await assert.rejects(
    observation({ kind: "priority_snapshot" }).validate(),
    /kind|enum/,
  );
  await assert.rejects(
    observation({ normalization_result: "normalized" }).validate(),
    /normalization_result|enum/,
  );
  await assert.rejects(
    observation({
      issues: [{ code: "invented_issue", severity: "error" }],
    }).validate(),
    /code|enum/,
  );
  await assert.rejects(
    observation({ booking_action: { normalized: "released" } }).validate(),
    /normalized|enum/,
  );
});

test("[AC-05] Observation documents omit processing, target, policy, and effect fields", async () => {
  const document = observation();
  await document.validate();
  const json = document.toObject() as Record<string, unknown>;
  for (const forbidden of [
    "processing",
    "target",
    "desired_state",
    "source_policy",
    "quoted",
    "granot_priority",
    "decision_id",
    "lifecycle_status",
  ]) {
    assert.equal(forbidden in json, false, forbidden);
  }
  assert.equal(document.granot_crm_source_id, undefined);
});

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
