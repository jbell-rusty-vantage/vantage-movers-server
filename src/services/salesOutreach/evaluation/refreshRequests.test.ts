import assert from "node:assert/strict";
import { test } from "node:test";
import { completeConfigurationInput, MemoryEvaluationStore, subjectRow, periodRow, fakeSession } from "./testing";
import { activeInspection } from "../reads/testing";
import { evaluateAndProject, evaluationAdmissionOf, prepareSubjectEvaluation } from "./evaluateJob";

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
