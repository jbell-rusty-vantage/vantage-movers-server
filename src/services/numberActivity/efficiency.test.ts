import assert from "node:assert/strict";
import test from "node:test";
import { CALL_INTERACTION_INDEXES } from "../../models/CallInteraction";
import { SALES_INTELLIGENCE_JOB_INDEXES } from "../../models/salesIntelligence/infrastructure";
import {
  CALL_LEAD_ATTACHMENT_PHONE_PATHS,
  FORM_LEAD_ATTACHMENT_PHONE_PATHS,
  leadPhoneMatchClauses,
} from "../../models/leadContactPhoneIndexes";

/**
 * CSI-14 efficiency contracts. These are the invariants the recommendation
 * turns on, expressed where they can be checked without a replica set.
 */

const indexNames = (indexes: readonly { name: string }[]) => indexes.map((i) => i.name);
const keyOf = (indexes: readonly { name: string; key: object }[], name: string) =>
  indexes.find((i) => i.name === name)?.key;

test("every Lead contact path is a lookup clause on both models", () => {
  const form = leadPhoneMatchClauses("FormLead", ["5550100200"]);
  assert.deepEqual(form, FORM_LEAD_ATTACHMENT_PHONE_PATHS.map((p) => ({ [p]: "5550100200" })));

  const call = leadPhoneMatchClauses("CallLead", ["5550100200"]);
  assert.equal(call.length, CALL_LEAD_ATTACHMENT_PHONE_PATHS.length);
  assert.ok(
    CALL_LEAD_ATTACHMENT_PHONE_PATHS.includes("ringcentral.original_caller.normalized_phone_number"),
    "the RingCentral original caller is a Call Lead contact path",
  );
  assert.deepEqual(leadPhoneMatchClauses("FormLead", []), [], "no digits means no clauses");
  assert.deepEqual(leadPhoneMatchClauses("FormLead", ["  "]), []);
});

test("the job claim is index-served and the retired discovery index is gone (14 §7, SLIM-06)", () => {
  assert.equal(indexNames(CALL_INTERACTION_INDEXES).includes("call_interaction_discovery_state"), false);

  // The claim leads with the dataset and stage, then sorts
  // `priority desc, next_attempt_at asc, _id asc`.
  assert.deepEqual(keyOf(SALES_INTELLIGENCE_JOB_INDEXES, "csi_job_claim"), {
    deployment: 1,
    database: 1,
    stage: 1,
    status: 1,
    priority: -1,
    next_attempt_at: 1,
    _id: 1,
  });

  const ttl = SALES_INTELLIGENCE_JOB_INDEXES.find((i) => i.name === "csi_job_completed_ttl");
  assert.deepEqual(ttl?.key, { completed_at: 1 }, "TTL keys off a field only completion writes");
  assert.ok((ttl?.expireAfterSeconds ?? 0) > 0, "completed queue rows are not kept forever");
});
