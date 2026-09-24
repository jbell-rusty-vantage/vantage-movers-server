import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { installFakeMongo } from "../story/fakeMongo.fixtures";
import { S4_COLLECTIONS, type S4Docs } from "../story/timeline.fixtures";
import type { StoryEvent } from "../story/types";
import { collapseGranotEntries, granotChangeText, granotHistory, mergeGranotHistory, readAcceptedObservations, type GranotHistoryEntry } from "./granotHistory";

/**
 * K7 (spec §4.14) and the §4.4 reader rules: accepted observations only, Job Number match first and
 * phone only without a Job Number, newest 50 per Lead, last known value per field, money-less
 * observations never erase an estimate, one-hour collapse, and the Priority merge with `entity_changes`.
 */
const O = (hex: string) => new mongoose.Types.ObjectId(hex.padStart(24, "0"));
const LEAD = { model: "FormLead" as const, id: "6b9000000000000000000002" };
const AS_OF = new Date("2026-09-23T20:10:00.000Z");
function emptyDocs(): S4Docs { return Object.fromEntries(S4_COLLECTIONS.map(name => [name, []])) as unknown as S4Docs; }
function observation(n: number, at: string, extra: Record<string, unknown> = {}) {
  return { _id: O(`c1${String(n).padStart(4, "0")}`), receipt_id: O(`c2${String(n).padStart(4, "0")}`), schema_version: 1, kind: "lead_snapshot", normalization_result: "valid",
    normalized_source_label: "top10", captured_at: new Date(at), createdAt: new Date(Date.parse(at) + 5_000), identity: { job_no_raw: "84521", normalized_job_no: "84521" },
    contact: { normalized_phone: "7575550143" }, move: { move_date: new Date("2026-10-10T00:00:00.000Z"), estimated_cubic_feet: 540, service_type_raw: "Long distance" },
    priority: { raw: "1", canonical: "1", valid: true }, booking_action: {}, display_money: { estimate: { raw: "7100.00" } }, agent_identity: { rep_raw: "JBELL", user_raw: "JBELL" },
    ...extra };
}

test("K7: the last known estimate survives a newer observation without money; invalid and unsupported never appear", async t => {
  const docs = emptyDocs();
  docs.observations.push(
    observation(1, "2026-09-17T15:20:00.000Z"),
    observation(2, "2026-09-22T19:02:00.000Z", { display_money: { estimate: { raw: "6600.00" } } }),
    observation(3, "2026-09-22T21:00:00.000Z", { display_money: {} }),
    observation(4, "2026-09-22T22:00:00.000Z", { normalization_result: "invalid", display_money: { estimate: { raw: "9999.00" } } }),
    observation(5, "2026-09-22T23:00:00.000Z", { normalization_result: "unsupported", priority: { raw: "8", canonical: "8", valid: true } }),
    observation(6, "2026-09-22T23:30:00.000Z", { normalization_result: "valid_with_issues", display_money: {}, move: { move_date: new Date("2026-10-12T00:00:00.000Z"), estimated_cubic_feet: 540, service_type_raw: "Long distance" } }),
    observation(7, "2026-09-24T12:00:00.000Z", { display_money: { estimate: { raw: "5000.00" } } }), // after as_of
  );
  installFakeMongo(t, docs);
  const [source] = await readAcceptedObservations([{ ref: LEAD, normalized_job_no: "84521", normalized_phone: "7575550143" }], AS_OF);
  assert.equal(source!.basis, "job_no");
  assert.deepEqual(source!.observations.map(o => o.id.slice(-2)), ["01", "02", "03", "06"], "accepted only, oldest first, nothing after as_of");
  const history = granotHistory(source!);
  assert.equal(history.last_known.estimate?.value, "6600.00", "a money-less newest observation never erases the estimate");
  assert.equal(history.last_known.estimate?.captured_at, "2026-09-22T19:02:00.000Z");
  assert.equal(history.last_known.estimate?.previous?.value, "7100.00");
  assert.equal(history.last_known.move_date?.value, "2026-10-12");
  assert.equal(history.last_known.move_date?.previous?.value, "2026-10-10");
  assert.equal(history.newest?.id.slice(-2), "06");
  assert.deepEqual(history.entries.map(e => [e.baseline, e.changes.map(granotChangeText).join(", ")]), [
    [true, "Priority 1 Quoted, estimate $7,100, move date Oct 10, 2026, 540 cu ft, service Long distance, Granot user JBELL, Granot rep JBELL"],
    [false, "estimate $7,100 → $6,600"],
    [false, "move date Oct 10, 2026 → Oct 12, 2026"],
  ]);
  assert.ok(!JSON.stringify(history).includes("9999"), "the invalid observation's estimate never appears");
  assert.ok(!history.entries.some(e => e.changes.some(c => c.field === "priority" && c.to === "8")), "the unsupported observation's Priority never appears");
});

test("K7: a Job Number Lead never matches by phone; a Lead without one matches by phone", async t => {
  const docs = emptyDocs();
  docs.observations.push(
    observation(1, "2026-09-17T15:20:00.000Z", { identity: { job_no_raw: "99999", normalized_job_no: "99999" } }), // same phone, another job
    observation(2, "2026-09-18T15:20:00.000Z", { identity: {} }),
  );
  installFakeMongo(t, docs);
  const [withJob, withoutJob, nothing] = await readAcceptedObservations([
    { ref: LEAD, normalized_job_no: "84521", normalized_phone: "7575550143" },
    { ref: { model: "FormLead", id: "6b9000000000000000000009" }, normalized_job_no: null, normalized_phone: "7575550143" },
    { ref: { model: "CallLead", id: "6b9000000000000000000010" }, normalized_job_no: null, normalized_phone: null },
  ], AS_OF);
  assert.deepEqual(withJob!.observations, [], "the other job's observation shares the phone but is never read");
  assert.equal(withoutJob!.basis, "phone");
  assert.equal(withoutJob!.observations.length, 2);
  assert.deepEqual([nothing!.basis, nothing!.observations.length], ["none", 0]);
});

test("newest 50 per Lead; the bound marks truncation", async t => {
  const docs = emptyDocs();
  for (let n = 1; n <= 55; n++) docs.observations.push(observation(n, new Date(Date.parse("2026-08-01T12:00:00.000Z") + n * 7_200_000).toISOString(),
    { display_money: { estimate: { raw: String(7000 + n) } } }));
  installFakeMongo(t, docs);
  const [source] = await readAcceptedObservations([{ ref: LEAD, normalized_job_no: "84521", normalized_phone: null }], AS_OF);
  assert.equal(source!.observations.length, 50);
  assert.equal(source!.truncated, true);
  assert.equal(source!.observations[0]!.id.slice(-2), "06", "the oldest five fall off");
  assert.equal(granotHistory(source!).truncated, true);
});

test("consecutive changes within one hour collapse to first-from / last-to; a change that returns is dropped", () => {
  const base = (at: string, changes: GranotHistoryEntry["changes"], baseline = false): GranotHistoryEntry =>
    ({ lead_ref: LEAD, observation_ids: [at], happened_at: at, to_at: at, observed_at: at, baseline, changes, rep: "JBELL" });
  const collapsed = collapseGranotEntries([
    base("2026-09-17T15:00:00.000Z", [{ field: "estimate", from: "7100", to: "7000" }]),
    base("2026-09-17T15:30:00.000Z", [{ field: "estimate", from: "7000", to: "6600" }, { field: "priority", from: "1", to: "2" }]),
    base("2026-09-17T15:50:00.000Z", [{ field: "priority", from: "2", to: "1" }]),
    base("2026-09-17T18:00:00.000Z", [{ field: "estimate", from: "6600", to: "6500" }]),
  ]);
  assert.equal(collapsed.length, 2);
  assert.deepEqual(collapsed[0]!.changes, [{ field: "estimate", from: "7100", to: "6600" }]);
  assert.equal(collapsed[0]!.to_at, "2026-09-17T15:50:00.000Z");
  assert.deepEqual(collapsed[0]!.observation_ids.length, 3);
});

test("the entity_changes Priority line stays and gains the observation's other fields within the slack window", () => {
  const change: StoryEvent = { id: "granot_priority_changed:c", kind: "granot_priority_changed", happened_at: "2026-09-17T15:20:00.000Z", observed_at: "2026-09-17T15:21:00.000Z",
    subject_key: `lead:FormLead:${LEAD.id}`, actor: { kind: "granot", agent_id: null, name: "JBELL", identity_status: null }, record: { record_type: "story_event", record_id: "granot_priority_changed:c" },
    sentence: "", detail: { lead_ref: LEAD, from: "0", to: "1" }, evidence_refs: ["change:c"] };
  const baseline: GranotHistoryEntry = { lead_ref: LEAD, observation_ids: ["o1"], happened_at: "2026-09-17T15:20:00.000Z", to_at: "2026-09-17T15:20:00.000Z", observed_at: null,
    baseline: true, changes: [{ field: "priority", from: null, to: "1" }, { field: "estimate", from: null, to: "7100.00" }, { field: "rep_raw", from: null, to: "JBELL" }], rep: "JBELL" };
  const later: GranotHistoryEntry = { ...baseline, observation_ids: ["o2"], happened_at: "2026-09-22T19:02:00.000Z", to_at: "2026-09-22T19:02:00.000Z", baseline: false,
    changes: [{ field: "estimate", from: "7100.00", to: "6600.00" }] };
  const merged = mergeGranotHistory([change], [baseline, later]);
  assert.deepEqual(merged.events[0]!.detail.granot_fields, [{ field: "estimate", from: null, to: "7100.00" }]);
  assert.ok(merged.events[0]!.evidence_refs.includes("observation:o1"));
  assert.deepEqual(merged.history.map(h => h.observation_ids[0]), ["o2"], "the baseline folded into the Priority line; the later estimate change stays");
  const far = mergeGranotHistory([{ ...change, happened_at: "2026-09-10T15:20:00.000Z" }], [baseline]);
  assert.equal(far.history.length, 1, "outside GRANOT_CHANGE_SLACK_MS nothing merges");
  assert.equal(far.events[0]!.detail.granot_fields, undefined);
});
