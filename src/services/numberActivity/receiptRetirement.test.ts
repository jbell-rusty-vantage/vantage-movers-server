import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import type { Effects } from "../salesIntelligence/retirement/evidence";
import { payloadHash } from "../salesIntelligence/transactions";
import { receiptVerdict } from "./receiptRetirement";

const dataset = { deployment: "csi-test", database: "testvantagemovers" };
const call = "c".repeat(24);
const completed = new Date("2026-11-20T01:00:00.000Z");
const receipt = { _id: new ObjectId(), uuid: "u-1", receivedAt: new Date(+completed - 1000), telephonySessionId: "s" };
const key = "csi:capture_projection:receipt:u-1";
const input = { stage: "capture_projection", subject_key: "webhook_receipt:u-1", input_revision: 1, input_refs: [String(receipt._id)] };
const result = { receipt_id: String(receipt._id), receipt_uuid: "u-1", sessions: 1, ok: 1, failed: 0, call_log_refresh: [],
  results: [{ telephony_session_id: "s", ok: true, interaction_id: call, contact_number_id: null, projection_revision: 3, noop: false, created: false, newly_terminal: true, jobs: 0 }] };
const full = { _id: new ObjectId(), ...dataset, ...input, dedupe_key: key, result, status: "completed", completed_at: completed, lease_epoch: 1, reason: null,
  payload_hash: payloadHash({ ...dataset, ...input }) };
const compactedAt = new Date(+completed + 6 * 60_000);
const compacted = { _id: full._id, ...dataset, ...input, dedupe_key: key, status: "completed", completed_at: completed, record_kind: "completion_receipt", updatedAt: compactedAt };
const pack = { first_id: full._id, last_id: full._id, first_completed_at: completed, last_completed_at: completed, created_at: compactedAt, retire: 1 };
const effects = (revision: number): Effects => ({ projections: new Map(), repDays: new Map(), calls: new Map([[call, revision]]), contactEvents: new Set(), subjectLeads: new Map() });

test("a receipt retires only when its own capture job completed and its effect is proven", () => {
  for (const [name, job, facts, packs, expected] of [
    ["full job, every call at its revision", full, effects(3), [], { verdict: "retire" }],
    ["full job, a call behind its revision", full, effects(2), [], { verdict: "hold", reason: "capture_projection:effect_missing" }],
    ["full job with a failed session", { ...full, result: { ...result, ok: 0, failed: 1 } }, effects(3), [], { verdict: "hold", reason: "capture_not_routine" }],
    ["no job", null, effects(3), [], { verdict: "hold", reason: "job_missing" }],
    ["job still pending", { ...full, status: "pending" }, effects(3), [], { verdict: "hold", reason: "job_not_completed" }],
    ["job belongs to an earlier delivery", { ...full, input_refs: [String(new ObjectId())] }, effects(3), [], { verdict: "hold", reason: "job_other_receipt" }],
    ["compacted by the retirement worker", compacted, effects(0), [pack], { verdict: "retire" }],
    ["compacted on the spot (switch off)", { ...compacted, updatedAt: completed }, effects(0), [pack], { verdict: "hold", reason: "job_receipt_unproven" }],
    ["compacted, catalog pack covers other jobs", compacted, effects(0), [{ ...pack, first_id: new ObjectId(), last_id: new ObjectId() }], { verdict: "hold", reason: "job_receipt_unproven" }],
  ] as const) {
    const jobs = new Map(job ? [[key, job as never]] : []);
    assert.deepEqual(receiptVerdict(receipt, jobs, facts, packs as never), expected, name);
  }
});
