/** Team 4 AC6-PLAN (Attention evolution spec §8.1): the `publicationDecision` progress branch and the job trigger. Pure. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import { assessmentJobTrigger, publicationDecision, PROGRESS_REPLAN_TRIGGER } from "./runtime";
import type { AssessmentContext } from "./context";

const artifactId = new Types.ObjectId();
const artifact = { _id: artifactId, input_fingerprint: "fp1", context_as_of: new Date("2026-09-22T12:00:00Z"), status: "ready" };
const fresh = { fingerprint: "fp1" } as AssessmentContext;
const current = { state: "open", lead_progress: null, move_assessment: { artifact_id: artifactId, status: "ready", stale: false } };

test("§8.1 a progress re-plan that finds its artifact already current re-applies engagement; every other trigger keeps `current`", () => {
  assert.equal(PROGRESS_REPLAN_TRIGGER, "progress:");
  assert.equal(publicationDecision({ artifact, fresh, record: current, closure: null, trigger: "progress:abc" }), "current_replan");
  assert.equal(publicationDecision({ artifact, fresh, record: current, closure: null }), "current", "no trigger: unchanged");
  for (const trigger of ["summary:x", "change:y", "stale:z", null]) assert.equal(publicationDecision({ artifact, fresh, record: current, closure: null, trigger }), "current");
  // The branch never bypasses a fence: closed, terminal or changed inputs decide first.
  assert.equal(publicationDecision({ artifact, fresh, record: { ...current, state: "closed" }, closure: null, trigger: "progress:abc" }), "fenced");
  assert.equal(publicationDecision({ artifact, fresh: { fingerprint: "fp2" } as AssessmentContext, record: current, closure: null, trigger: "progress:abc" }), "stale_input");
  assert.equal(publicationDecision({ artifact, fresh, record: { ...current, move_assessment: null }, closure: null, trigger: "progress:abc" }), "published");
});

test("the job trigger is read back from the dedupe key; a foreign key yields null", () => {
  assert.equal(assessmentJobTrigger({ subject_key: "lead:FormLead:abc", dedupe_key: "csi:move-assessment:lead:FormLead:abc:progress:rev1" }), "progress:rev1");
  assert.equal(assessmentJobTrigger({ subject_key: "lead:FormLead:abc", dedupe_key: "csi:move-assessment:lead:FormLead:abc:summary:c1" }), "summary:c1");
  assert.equal(assessmentJobTrigger({ subject_key: "lead:FormLead:abc", dedupe_key: "csi:other:lead:FormLead:abc:progress:rev1" }), null);
  assert.equal(assessmentJobTrigger({ subject_key: "lead:FormLead:abc", dedupe_key: null }), null);
});
