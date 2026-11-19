import assert from "node:assert/strict";
import test from "node:test";
import { isRoutineEvaluationKey, routineJobExpiry } from "./routineJobExpiry";

const subject = "a".repeat(24);
const key = `sod:lead-change:FormLead:${"b".repeat(24)}:estimates-refresh:${"c".repeat(24)}`;
const completed = new Date("2026-11-18T00:00:00.000Z");
const refresh = { outcome: "unchanged", subject_id: subject, reason: null, status: "active", admission: null };
const evaluation = { outcome: "updated", subject_id: subject, publication_revision: 2, next_evaluation_at: completed.toISOString() };
const evaluate = (cause: string, result: unknown) => routineJobExpiry("outreach_evaluate", `sod:evaluate:${subject}:${cause}`, result, completed);
test("admission, repair, malformed, extra and mismatched evidence keeps the ordinary retention window", () => {
  for (const result of [{...refresh, admission: "intake"}, {...refresh, outcome: "not_admitted"}, {...refresh, reason: "held"}, {...refresh, outcome: "updated", reason: "repeated_priority"}, {...refresh, extra: true}])
    assert.equal(routineJobExpiry("outreach_lead_change", key, result, completed), undefined);
  for (const cause of ["coverage:call:12:1234", "policy:2", "nudge", "estimates-refresh:unknown"])
    assert.equal(evaluate(cause, evaluation), undefined);
  for (const result of [undefined, {...evaluation, subject_id: "0".repeat(24)}, {...evaluation, publication_revision: 0}, {...evaluation, next_evaluation_at: "unknown"}])
    assert.equal(evaluate("r2", result), undefined);
  assert.equal(routineJobExpiry("outreach_lead_change", key.replace("estimates-refresh", "admission"), refresh, completed), undefined);
});

test("only matching terminal call revisions, contact evaluations and rep-day recounts expire", () => {
  const source = `call:${subject}`;
  const callKey = `sod:contact_change:${source}:r2`;
  const counts = { derived: 1, changed: 1, missing: 0, evaluations: 2, rep_days: 2 };
  const day = `${subject}:2026-11-18`;
  const dayKey = `sod:rep-day:${day}:0123456789abcdef`;
  const recounted = { outcome: "written", publication_revision: 1 };
  const evalKey = `sod:evaluate:${subject}:r2:contacts:0123456789abcdef`;
  const ttl = (stage: string, key: string, result: unknown, owner: string) =>
    routineJobExpiry(stage, key, result, completed, owner)?.toISOString();
  for (const [stage, key, result, owner] of [
    ["outreach_contact_change", callKey, counts, source],
    ["outreach_rep_day", dayKey, recounted, "outreach-rep-day:" + day],
    ["outreach_evaluate", evalKey, evaluation, "outreach-subject:" + subject],
  ] as const) {
    assert.equal(ttl(stage, key, result, owner), "2026-11-21T00:00:00.000Z");
    assert.equal(ttl(stage, key, result, "wrong"), undefined);
    assert.equal(ttl(stage, key, { ...result, repair: true }, owner), undefined);
  }
  for (const [revision, result] of [
    ["r0", counts], ["admit:subject", counts], ["r2", { ...counts, missing: 1 }],
    ["r2", { ...counts, rep_days: 3 }], ["r2", { ...counts, derived: 0 }],
  ] as const) assert.equal(ttl("outreach_contact_change", `sod:contact_change:${source}:${revision}`, result, source), undefined);
  assert.equal(ttl("outreach_contact_change", callKey.replace("call:", "sms:"), counts, source.replace("call:", "sms:")), undefined);
  assert.equal(ttl("outreach_rep_day", dayKey, { outcome: "no_activity", publication_revision: null }, "outreach-rep-day:" + day), undefined);
  assert.equal(isRoutineEvaluationKey(evalKey, subject), false);
});
