import assert from "node:assert/strict";
import test from "node:test";
import { BSON, ObjectId } from "mongodb";
import { payloadHash } from "../transactions";
import { verdictOf, type Effects } from "./evidence";
import { decodePack, encodePack, packHoldsExactly } from "./pack";

const dataset = { deployment: "csi-test", database: "testvantagemovers" };
const subject = "a".repeat(24), call = "c".repeat(24), receipt = "d".repeat(24);
const completed = new Date("2026-11-20T01:00:00.000Z");
function job(stage: string, dedupe_key: string, subject_key: string, ref: string, result: unknown) {
  const input = { stage, subject_key, input_revision: 1, input_refs: [ref] };
  return { _id: new ObjectId(), ...dataset, ...input, dedupe_key, result, status: "completed", completed_at: completed,
    payload_hash: payloadHash({ ...dataset, ...input }) };
}
const effects = (projection: number, callRevision: number): Effects => ({
  projections: new Map([[subject, { publication_revision: projection, computed_as_of: completed }]]),
  repDays: new Map(), calls: new Map([[call, callRevision]]), contactEvents: new Set(), subjectLeads: new Map(),
});
const evaluation = { outcome: "updated", subject_id: subject, publication_revision: 5, next_evaluation_at: null };
const capture = { receipt_id: receipt, receipt_uuid: null, sessions: 1, ok: 1, failed: 0, call_log_refresh: [],
  results: [{ telephony_session_id: "s", ok: true, interaction_id: call, contact_number_id: null, projection_revision: 3, noop: false, created: false, newly_terminal: true, jobs: 0 }] };

test("a job retires only when its routine result's lifecycle effect is in the business record", () => {
  const due = job("outreach_evaluate", `sod:evaluate:${subject}:due:1763600400000`, `outreach-subject:${subject}`, subject, evaluation);
  const policy = job("outreach_evaluate", `sod:evaluate:${subject}:policy:abc`, `outreach-subject:${subject}`, subject, evaluation);
  const cap = job("capture_projection", `csi:capture_projection:receipt_id:${receipt}`, `webhook_receipt:${receipt}`, receipt, capture);
  const day = job("outreach_rep_day", `sod:rep-day:${subject}:2026-11-19:0123456789abcdef`, `outreach-rep-day:${subject}:2026-11-19`, subject,
    { outcome: "written", publication_revision: 2 });
  const forged = { ...due, payload_hash: "0".repeat(64) };
  for (const [doc, facts, expected] of [
    [due, effects(5, 3), { verdict: "retire", purge_at: new Date("2026-11-23T01:00:00.000Z") }],
    [due, effects(4, 3), { verdict: "hold", reason: "outreach_evaluate:effect_missing" }],
    [cap, effects(5, 3), { verdict: "retire", purge_at: new Date("2026-11-27T01:00:00.000Z") }],
    [cap, effects(5, 2), { verdict: "hold", reason: "capture_projection:effect_missing" }],
    [day, effects(5, 3), { verdict: "hold", reason: "outreach_rep_day:effect_missing" }],
    [policy, effects(9, 9), { verdict: "keep", reason: "ordinary_window" }],
    [forged, effects(9, 9), { verdict: "keep", reason: "ordinary_window" }],
  ] as const) assert.deepEqual(verdictOf(doc, facts), expected, doc.dedupe_key);
});

test("a pack read back from storage must hold every original row byte for byte", () => {
  const rows = [{ a: 1 }, { a: 2 }, { a: 3 }].map((v) => {
    const doc = { _id: new ObjectId(), ...v };
    return { raw: Buffer.from(BSON.serialize(doc)), id: String(doc._id) };
  });
  const pack = encodePack(rows);
  assert.equal(packHoldsExactly(pack, rows), true);
  assert.deepEqual(decodePack(pack).map((r) => r.id), rows.map((r) => r.id).sort());
  assert.equal(packHoldsExactly(encodePack(rows.slice(1)), rows), false, "a missing row fails");
  const tampered = [{ ...rows[0]!, raw: Buffer.from(BSON.serialize({ _id: new ObjectId(rows[0]!.id), a: 9 })) }, ...rows.slice(1)];
  assert.equal(packHoldsExactly(encodePack(tampered), rows), false, "changed bytes fail");
  assert.equal(packHoldsExactly(Buffer.from("not a pack"), rows), false, "unreadable bytes fail");
});
