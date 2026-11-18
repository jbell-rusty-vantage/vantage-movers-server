import { assertRefreshRolloutTransition } from "../config/commands";
import assert from "node:assert/strict";
import { test } from "node:test";
import { salesOutreachConfigurationValueSchema } from "../../../validation/v1/salesOutreach";
import { completeConfigurationInput, MemoryEvaluationStore, subjectRow, periodRow, fakeSession } from "./testing";
import { activeInspection } from "../reads/testing";
import { evaluateAndProject, evaluationAdmissionOf, prepareSubjectEvaluation } from "./evaluateJob";

test("refresh rollout is optional without defaults; active requires explicit version, approval and parity references", () => {
  const base = completeConfigurationInput({ cadence_shadow_enabled: true });
  const parsed = salesOutreachConfigurationValueSchema.parse(base);
  assert.equal(Object.hasOwn(parsed, "refresh_requests"), false);
  assert.deepEqual(salesOutreachConfigurationValueSchema.parse(parsed), parsed, "R0 old version shape is unchanged");
  const control = { version: "w2-v1", mode: "active", approval_ref: "reviewed-owner-approval" };
  assert.equal(salesOutreachConfigurationValueSchema.safeParse({ ...base, refresh_requests: control }).success, false);
  assert.equal(salesOutreachConfigurationValueSchema.safeParse({ ...base, refresh_requests: { ...control, parity_ref: "reviewed-shadow-evidence" } }).success, true);
  assert.equal(salesOutreachConfigurationValueSchema.safeParse({ ...base, refresh_requests: { ...control, version: "unknown", parity_ref: "evidence" } }).success, false);
  const active = salesOutreachConfigurationValueSchema.parse({ ...base, refresh_requests: { ...control, parity_ref: "reviewed-shadow-evidence" } });
  assert.throws(() => assertRefreshRolloutTransition(parsed, active), /Invalid|input/i);
  assert.doesNotThrow(() => assertRefreshRolloutTransition({ ...parsed, refresh_requests: { version: "w2-v1", mode: "shadow" } }, active));
});

test("read-only evaluator preview matches actual projected output and never writes", async () => {
  const store = new MemoryEvaluationStore(), subject = subjectRow();
  store.subjects.set(subject.id, subject); store.periods.push(periodRow(subject.id));
  const admission = evaluationAdmissionOf(activeInspection(completeConfigurationInput({ cadence_shadow_enabled: true })));
  assert.ok(admission.ok);
  const now = new Date("2026-10-05T16:00:00Z");
  const preview = await prepareSubjectEvaluation(subject.id, admission.context, now, store, fakeSession);
  assert.ok(preview); assert.deepEqual(store.writes, []); assert.equal(store.projections.size, 0);
  await evaluateAndProject(subject.id, admission.context, now, store, fakeSession);
  const stored = store.projections.get(subject.id)!;
  assert.deepEqual(stored.doc, { ...preview.doc, publication_revision: 1 });
  assert.equal((await prepareSubjectEvaluation(subject.id, admission.context, now, store, fakeSession))?.doc.result_fingerprint, stored.doc.result_fingerprint);
});
