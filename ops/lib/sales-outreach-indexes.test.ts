import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertTargetMatchesDatabase,
  createIndexOptions,
  duplicateProbePipeline,
  parseIndexBuildArgs,
  planIndexBuild,
} from "./sales-outreach-indexes";
import { SALES_OUTREACH_POLICY_PERIOD_INDEXES } from "../../src/models/salesOutreach/policyPeriods";

test("the index build needs a named target and plans by default", () => {
  assert.throws(() => parseIndexBuildArgs([]), /--target/);
  assert.throws(() => parseIndexBuildArgs(["--target="]), /--target/);
  assert.throws(() => parseIndexBuildArgs(["--target=prod db"]), /plain database name/);
  assert.throws(() => parseIndexBuildArgs(["--target=vantagemovers", "--force"]), /Unknown argument/);
  assert.deepEqual(parseIndexBuildArgs(["--target=vantagemovers"]), { target: "vantagemovers", mode: "plan" });
  assert.deepEqual(parseIndexBuildArgs(["--target=vantagemovers", "--apply", "--allow-schema-drift"]), { target: "vantagemovers", mode: "apply" });
  assert.throws(() => assertTargetMatchesDatabase("vantagemovers", "testvantagemovers"), /Refusing/);
  assert.doesNotThrow(() => assertTargetMatchesDatabase("testvantagemovers", "testvantagemovers"));
});

test("the plan is idempotent: identical indexes are skipped, missing ones created, mismatches are conflicts", () => {
  const declared = [{ collection: "sales_outreach_policy_periods", indexes: SALES_OUTREACH_POLICY_PERIOD_INDEXES }];
  const first = planIndexBuild(declared, new Map());
  assert.deepEqual(first.map((a) => a.action), ["create", "create", "create"]);
  const built = new Map([
    [
      "sales_outreach_policy_periods",
      [
        { name: "_id_", key: { _id: 1 } },
        ...SALES_OUTREACH_POLICY_PERIOD_INDEXES.map((i) => ({ ...createIndexOptions(i), key: i.key as Record<string, unknown> })),
      ],
    ],
  ]);
  assert.deepEqual(planIndexBuild(declared, built).map((a) => a.action), ["exists", "exists", "exists"]);
  const drifted = new Map([
    [
      "sales_outreach_policy_periods",
      [
        { name: "sod_period_active_unique", key: { subject_id: 1 }, unique: true },
        { name: "legacy_name", key: { subject_id: 1, transition_key: 1 }, unique: true },
      ],
    ],
  ]);
  const plan = planIndexBuild(declared, drifted);
  assert.deepEqual(plan.map((a) => a.action), ["conflict", "conflict", "create"]);
});

test("the duplicate probe respects a unique index's partial filter", () => {
  const active = SALES_OUTREACH_POLICY_PERIOD_INDEXES[0]!;
  assert.deepEqual(duplicateProbePipeline(active), [
    { $match: { ended_at: null } },
    { $group: { _id: { k0: "$subject_id" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 5 },
  ]);
});
