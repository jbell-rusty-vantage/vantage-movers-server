import assert from "node:assert/strict";
import test from "node:test";
import { isRoutineEvaluationKey, routineJobExpiry } from "./routineJobExpiry";

const subject = "a".repeat(24);
const key = `sod:lead-change:FormLead:${"b".repeat(24)}:estimates-refresh:${"c".repeat(24)}`;
const completed = new Date("2026-11-18T00:00:00.000Z");
const refresh = { outcome: "unchanged", subject_id: subject, reason: null, status: "active", admission: null };
const evaluation = { outcome: "updated", subject_id: subject, publication_revision: 2, next_evaluation_at: completed.toISOString() };
const evaluate = (cause: string, result: unknown) => routineJobExpiry("outreach_evaluate", `sod:evaluate:${subject}:${cause}`, result, completed);
test("only known revision and receipt evaluations and known receipt refresh results expire after three days", () => {
  for (const expiry of [evaluate("r4", evaluation), evaluate("estimates-refresh:" + key, evaluation), routineJobExpiry("outreach_lead_change", key, refresh, completed)]) {
    assert.equal(expiry?.toISOString(), "2026-11-21T00:00:00.000Z");
  }
});
test("admission, repair, malformed, extra and mismatched evidence keeps the ordinary retention window", () => {
  for (const result of [{...refresh, admission: "intake"}, {...refresh, outcome: "not_admitted"}, {...refresh, reason: "held"}, {...refresh, outcome: "updated", reason: "repeated_priority"}, {...refresh, extra: true}])
    assert.equal(routineJobExpiry("outreach_lead_change", key, result, completed), undefined);
  for (const cause of ["coverage:call:12:1234", "policy:2", "nudge", "estimates-refresh:unknown"])
    assert.equal(evaluate(cause, evaluation), undefined);
  for (const result of [undefined, {...evaluation, subject_id: "0".repeat(24)}, {...evaluation, publication_revision: 0}, {...evaluation, next_evaluation_at: "unknown"}])
    assert.equal(evaluate("r2", result), undefined);
  assert.equal(routineJobExpiry("outreach_lead_change", key.replace("estimates-refresh", "admission"), refresh, completed), undefined);
});

test("only subject-matched revision and Estimates receipt identities can coalesce", () => {
  const compose = (cause: string) => `sod:evaluate:${subject}:${cause}`;
  for (const cause of ["r12", "estimates-refresh:" + key, "estimates-refresh:" + key.replace("FormLead", "CallLead")]) {
    assert.equal(isRoutineEvaluationKey(compose(cause), subject), true);
    assert.equal(isRoutineEvaluationKey(compose(cause), "f".repeat(24)), false);
  }
  for (const cause of ["due:123", "coverage:call:1:2", "policy:abc", "r1:contacts:abcd", "assignment:l1", "plan:r1",
    "restriction:abc:r1", "unknown", "r0", "estimates-refresh:unknown"]) {
    assert.equal(isRoutineEvaluationKey(compose(cause), subject), false);
  }
  assert.equal(isRoutineEvaluationKey(compose("r1"), undefined), false);
});
