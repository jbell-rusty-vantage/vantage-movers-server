import assert from "node:assert/strict";
import test from "node:test";
import { WEBHOOK_EVENT_RETENTION_SECONDS } from "../ringcentral/webhook-capture";
import { CAPTURE_RECEIPT_RETENTION_DAYS, isRoutineEvaluationKey, routineJobExpiry, routineJobSubjectMatches } from "./routineJobExpiry";

const subject = "a".repeat(24);
const key = `sod:lead-change:FormLead:${"b".repeat(24)}:estimates-refresh:${"c".repeat(24)}`;
const completed = new Date("2026-11-18T00:00:00.000Z");
const refresh = { outcome: "unchanged", subject_id: subject, reason: null, status: "active", admission: null };
const evaluation = { outcome: "updated", subject_id: subject, publication_revision: 2, next_evaluation_at: completed.toISOString() };
const evaluate = (cause: string, result: unknown) => routineJobExpiry("outreach_evaluate", `sod:evaluate:${subject}:${cause}`, result, completed);
test("admission, repair, malformed, extra and mismatched evidence keeps the ordinary retention window", () => {
  for (const result of [{...refresh, admission: "intake"}, {...refresh, outcome: "not_admitted"}, {...refresh, reason: "held"}, {...refresh, outcome: "updated", reason: "repeated_priority"}, {...refresh, extra: true}])
    assert.equal(routineJobExpiry("outreach_lead_change", key, result, completed), undefined);
  for (const cause of ["policy:2", "nudge", "estimates-refresh:unknown", "due:0", "coverage:fax:12:1234", "due:12:extra"])
    assert.equal(evaluate(cause, evaluation), undefined);
  // Sweep wakes: the projection moves past the key's instant, so the key never recurs after its evaluation.
  for (const cause of ["due:1763600400001", "coverage:call:12:1234", "coverage:sms:12:1234"])
    assert.equal(evaluate(cause, { ...evaluation, outcome: "unchanged" })?.toISOString(), "2026-11-21T00:00:00.000Z");
  assert.equal(isRoutineEvaluationKey(`sod:evaluate:${subject}:due:1763600400001`, subject), false, "sweep wakes never enter the refresh coalescer");
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

test("a capture receipt outlives its stored webhook receipt, and only when every session projected", () => {
  assert.equal(CAPTURE_RECEIPT_RETENTION_DAYS * 86_400, WEBHOOK_EVENT_RETENTION_SECONDS, "a purged key must never meet a re-ensurable receipt");
  const receipt = "d".repeat(24), uuid = "0f1e2d3c-aaaa-bbbb-cccc-111122223333";
  const session = { telephony_session_id: "s-1", ok: true, interaction_id: "e".repeat(24), contact_number_id: null,
    projection_revision: 3, noop: false, created: true, newly_terminal: true, jobs: 1 };
  const clean = { receipt_id: receipt, receipt_uuid: uuid, sessions: 1, ok: 1, failed: 0, results: [session], call_log_refresh: ["s-1"] };
  const byUuid = `csi:capture_projection:receipt:${uuid}`, byId = `csi:capture_projection:receipt_id:${receipt}`;
  const ttl = (key: string, result: unknown, owner: string) =>
    routineJobExpiry("capture_projection", key, result, completed, owner)?.toISOString();
  assert.equal(ttl(byUuid, clean, `webhook_receipt:${uuid}`), "2026-11-25T00:00:00.000Z");
  assert.equal(ttl(byId, { ...clean, receipt_uuid: null }, `webhook_receipt:${receipt}`), "2026-11-25T00:00:00.000Z");
  assert.equal(ttl(byUuid, { ...clean, sessions: 0, ok: 0, results: [], call_log_refresh: [] }, `webhook_receipt:${uuid}`), "2026-11-25T00:00:00.000Z");
  for (const [key, result, owner] of [
    [byUuid, { ...clean, ok: 0, failed: 1, results: [{ telephony_session_id: "s-1", ok: false, error_code: "account_unresolved" }] }, `webhook_receipt:${uuid}`],
    [byUuid, { ...clean, sessions: 2 }, `webhook_receipt:${uuid}`],
    [byUuid, { ...clean, receipt_uuid: "other" }, `webhook_receipt:${uuid}`],
    [byUuid, clean, "webhook_receipt:other"],
    [byId, clean, `webhook_receipt:${receipt}`],
    [byUuid, { ...clean, extra: true }, `webhook_receipt:${uuid}`],
  ] as const) assert.equal(ttl(key, result, owner), undefined);
  assert.equal(routineJobSubjectMatches("capture_projection", byId, `webhook_receipt:${receipt}`, [receipt]), true);
  assert.equal(routineJobSubjectMatches("capture_projection", byId, `webhook_receipt:${receipt}`, ["f".repeat(24)]), false);
});
