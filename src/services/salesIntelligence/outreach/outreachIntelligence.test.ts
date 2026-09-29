import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { getGranotObservationModel } from "../../../models/GranotObservation";
import { getSalesIntelligenceAttentionSnapshotModel } from "../../../models/SalesIntelligenceAttentionSnapshot";
import { ambiguousReviewFixture, unknownCoverageFixture, undatedFollowupFixture } from "../fixtures";
import type { AttentionFilterKeysDto, AttentionRowDto } from "../dto";
import { readJobMoveObservations, type JobMoveObservation } from "../story/granot";
import { outreachMove, outreachMoveSummary } from "./facts";
import { ATTENTION_CAPABILITIES, attentionQuerySchema, attentionWorkKeys, attentionFollowupCounts, clearParsedAttentionSnapshots, compressAttentionRows, readAttention } from "./attention";
import { attentionIndexEntry, entryMatchesAttentionQuery, moveLocationMatches, resolvedMoveWindow } from "./attentionIndex";
import { closedHistoryQuerySchema } from "./closedHistory";

process.env.TEST_MODE = "true";
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "isolated";
const NOW = new Date("2026-09-30T02:00:00Z"), A = "a".repeat(24), B = "b".repeat(24);
const report: JobMoveObservation = { _id: new mongoose.Types.ObjectId(), captured_at: NOW, identity: { normalized_job_no: "JOB1" }, basis: "job_no",
  move: { move_date: new Date("2026-10-02T00:00:00Z"), granot_move_size_raw: "3 BR", estimated_cubic_feet: 600, origin: { city: "Boston", state: "MA", zip: "02118" } },
  display_money: { estimate: { raw: "$3,500.00" }, payment: { raw: "$500" }, balance: { raw: "$3,000" } } };

test("OI-S1 canonical date, partial route, money provenance and absent estimates", () => {
  const form = outreachMove({ move_date: new Date("2026-10-01T00:00:00Z"), move_size: "2 Bedrooms", cubic_feet: 400 }, "FormLead", report);
  assert.equal(form.date, "2026-10-01"); assert.equal(form.date_source, "lead"); assert.equal(form.size, "2 Bedrooms"); assert.equal(form.volume_ft3, 400);
  const call = outreachMove({}, "CallLead", report);
  assert.equal(call.date, "2026-10-02"); assert.equal(call.date_source, "granot"); assert.equal(call.delivery, null);
  assert.deepEqual(call.estimate, { display: "$3,500.00", observed_at: NOW.toISOString() });
  assert.equal(outreachMove({}, "CallLead", { ...report, display_money: {} }).estimate, null);
  assert.equal(outreachMove(null, null).date, null);
  const detail = outreachMoveSummary(call, report);
  assert.deepEqual(detail.estimate, call.estimate); assert.equal(detail.granot?.payment, "$500"); assert.equal(detail.granot?.observation_id, String(report._id));
});

test("OI-S1 move endpoints never mix a Lead place with a different Granot place", () => {
  const withOrigin = (origin: { city?: string; state?: string; zip?: string }) => ({ ...report, move: { ...report.move, origin } });
  // Same place: the Lead's city/state are completed with the report's ZIP.
  assert.deepEqual(outreachMove({ pickup_city: "boston", pickup_state: "ma" }, "FormLead", report).pickup, { city: "boston", state: "ma", zip: "02118" });
  // Different city: the Lead endpoint stays as the Lead has it; no foreign ZIP.
  assert.deepEqual(outreachMove({ pickup_city: "Austin", pickup_state: "TX" }, "FormLead", report).pickup, { city: "Austin", state: "TX", zip: null });
  // ZIP+4 on either side still names the same place.
  assert.deepEqual(outreachMove({ pickup_zip: "02118-1234" }, "FormLead", withOrigin({ city: "Boston", state: "MA", zip: "02118" })).pickup, { city: "Boston", state: "MA", zip: "02118-1234" });
  // No Lead endpoint: the report's endpoint as a whole.
  assert.deepEqual(outreachMove({}, "CallLead", report).pickup, { city: "Boston", state: "MA", zip: "02118" });
});

test("OI-S1 batched reader selects accepted exact jobs only, with no phone fallback", async t => {
  let calls = 0;
  t.mock.method(getGranotObservationModel(), "aggregate", (pipeline: Record<string, unknown>[]) => {
    calls++; assert.deepEqual(pipeline[0], { $match: { "identity.normalized_job_no": { $in: ["JOB1", "JOB2"] }, normalization_result: { $in: ["valid", "valid_with_issues"] }, captured_at: { $lte: NOW } } });
    assert.ok(!JSON.stringify(pipeline).includes("phone"));
    return Promise.resolve([{ _id: "JOB1", observation: report }]);
  });
  const rows = await readJobMoveObservations(["JOB1", "JOB2", "JOB1"], NOW);
  assert.equal(calls, 1); assert.equal(rows.get("JOB1")?.basis, "job_no"); assert.equal(rows.get("JOB2"), undefined);
  await readJobMoveObservations([], NOW); assert.equal(calls, 1);
});

const keys = (over: Partial<AttentionFilterKeysDto> = {}): AttentionFilterKeysDto => ({ band: 4, needs_review: false, state: "open", agents: [A, B], responsible: A,
  followup_agents: [B], followup_counts: [{ agent_id: B, actions: 2, overdue: 2, due_today: 2 }], attachment: "lead", priority: "1", has_recording: false, has_assessment: false, newer_call: false, ti: null, ml: null,
  received_at: null, move_date: "2026-09-29", outcome: null, closed_at: null,
  work: { overdue_followup: true, due_today: true, no_next_step: false, blocked: false },
  loc: { pickup: { city_lc: "boston", state_uc: "MA", zip5: "02118" }, delivery: { city_lc: "austin", state_uc: "TX", zip5: "78701" } }, ...over });
function row(i: number, over: Partial<AttentionFilterKeysDto> = {}): AttentionRowDto {
  const filter_keys = keys(over);
  return { ...ambiguousReviewFixture, subject_key: `lead:FormLead:${String(i).padStart(24, "0")}`, filter_keys,
    sort_keys: { next_action_due: null, lead_received: null, last_human_contact: null, last_lead_progress: null, move_date: filter_keys.move_date }, partition: "active", in_attention: true };
}
const matches = (query: Record<string, unknown>, over: Partial<AttentionFilterKeysDto> = {}) => entryMatchesAttentionQuery(attentionIndexEntry(row(1, over), 0), attentionQuerySchema.parse(query), { as_of: NOW });

test("OI-S2 date fixture, inclusive windows, DST and real calendar validation", () => {
  const window = (query: Record<string, unknown>, at = NOW) => resolvedMoveWindow(attentionQuerySchema.parse(query), at);
  assert.deepEqual(window({ move_date_mode: "today" }), { reference_date: "2026-09-29", from: "2026-09-29", through: "2026-09-29" });
  assert.equal(window({ move_date_mode: "future" }).from, "2026-09-30");
  assert.equal(window({ move_date_mode: "within", move_days: 7 }).through, "2026-10-06");
  assert.deepEqual(window({ move_date_mode: "within", move_days: 0 }), window({ move_date_mode: "today" }));
  for (const at of [new Date("2026-03-08T06:59:00Z"), new Date("2026-03-08T07:01:00Z")]) assert.equal(window({ move_date_mode: "tomorrow" }, at).from, "2026-03-09");
  assert.equal(window({ move_date_mode: "within", move_days: 1 }, new Date("2028-02-28T17:00:00Z")).through, "2028-02-29");
  assert.equal(matches({ move_date_mode: "future" }), false); assert.equal(matches({ move_date_mode: "today_onward" }), true);
  assert.equal(matches({ move_date_mode: "unknown" }, { move_date: null }), true);
  assert.equal(matches({ move_date_mode: "range", move_from: "2026-09-29", move_through: "2026-09-29" }), true);
  for (const query of [{ move_date_mode: "exact", move_on: "2026-02-30" }, { move_date_mode: "range", move_from: "2026-10-01", move_through: "2026-09-29" },
    { move_date_mode: "today", move_date_passed: "true" }, { move_date_mode: "within", move_days: 367 }, { move_date_mode: "today", move_days: 1 }, { move_on: "2026-09-29" }, { move_date_mode: "within" }]) {
    assert.equal(attentionQuerySchema.safeParse(query).success, false, JSON.stringify(query));
  }
});

test("OI-S2 strict assignment differs from involvement, work is OR and locations never mix endpoints", () => {
  assert.equal(matches({ assigned_agent_id: B }), false); assert.equal(matches({ agent_id: B }), true);
  assert.equal(matches({ relationship: "assigned", agent: A }), true); assert.equal(matches({ relationship: "followup", agent: B }), true);
  assert.equal(matches({ assignment: "unassigned" }, { responsible: null }), true);
  assert.equal(matches({ unassigned: "true" }, { responsible: null }), false);
  assert.equal(matches({ work: "blocked,no_next_step" }), false); assert.equal(matches({ work: "blocked,overdue_followup" }), true);
  const mixed = { followup_agents: [A, B], followup_counts: [{ agent_id: A, actions: 1, overdue: 0, due_today: 0 }, { agent_id: B, actions: 2, overdue: 2, due_today: 2 }] };
  assert.equal(matches({ followup_agent_id: A, work: "overdue_followup" }, mixed), false);
  assert.equal(matches({ relationship: "followup", agent: B, work: "overdue_followup" }, mixed), true);
  assert.equal(matches({ assigned_agent_id: A, work: "overdue_followup" }, mixed), true, "record assignment sees overdue work owned by any rep");
  assert.equal(matches({ followup_agent_id: A, work: "no_next_step" }, mixed), false);
  assert.equal(matches({ loc_city: "BOST", loc_state: "tx" }), false);
  assert.equal(matches({ loc_city: "AUST", loc_side: "pickup" }), false);
  assert.equal(matches({ loc_city: "AUST", loc_side: "delivery", loc_zip: "78701" }), true);
  assert.equal(matches({ loc_city: "austin" }, { loc: { pickup: null, delivery: null } }), false);
  assert.equal(attentionQuerySchema.safeParse({ assigned_agent_id: A, assignment: "unassigned" }).success, false);
  const query = closedHistoryQuerySchema.parse({ move_date_mode: "today", assigned_agent_id: A, loc_state: "ma" });
  assert.equal(moveLocationMatches(keys(), query, NOW), true);
  for (const invalid of [{ move_date_mode: "exact" }, { move_date_mode: "within" }, { move_date_mode: "range", move_from: "2026-10-01", move_through: "2026-09-29" },
    { assigned_agent_id: A, assignment: "unassigned" }, { move_date_mode: "exact", move_on: "2026-02-30" }]) {
    assert.equal(closedHistoryQuerySchema.safeParse(invalid).success, false, JSON.stringify(invalid));
  }
  assert.equal(ATTENTION_CAPABILITIES.closed_history.work, false);
});

const mockQuery = (value: unknown) => { const chain = { select: () => chain, sort: () => chain, lean: async () => value }; return chain; };
test("OI-S2 day-precision due_today uses contractual ET day despite wait opening and snooze", () => {
  const action = { ...undatedFollowupFixture, due_at: "2026-09-30T00:00:00Z", base_attention_due_at: "2026-09-30T12:00:00Z",
    attention_due_at: "2026-10-01T12:00:00Z", snoozed_until: "2026-10-01T12:00:00Z",
    date_resolution: { precision: "day" as const, timezone: "America/New_York", assumption: "End of sales day", anchor: NOW.toISOString(), policy_version: "v1" } };
  const derived = { call_blockers: [], action_facts: [{ id: action.id, overdue: false, contractual_overdue: true, attention_due_at: action.attention_due_at, call_allowed: true }] };
  assert.deepEqual(attentionWorkKeys([action], derived, NOW), { overdue_followup: false, due_today: true, no_next_step: false, blocked: false });
  assert.equal(attentionWorkKeys([action], derived, new Date("2026-09-30T16:00:00Z")).due_today, false);
  assert.deepEqual(attentionFollowupCounts([action], derived, NOW), [{ agent_id: null, actions: 1, overdue: 0, due_today: 1 }]);
});

test("OI-S2 rolling deployment keeps old reads but reports missing query keys as pending, not zero", async t => {
  clearParsedAttentionSnapshots();
  const snapshot = { _id: "old", snapshot_id: "outreach:old", as_of: NOW, expires_at: null, rows: [ambiguousReviewFixture] };
  t.mock.method(getSalesIntelligenceAttentionSnapshotModel(), "findOne", () => mockQuery(snapshot));
  const deps = { now: NOW, coverage: async () => unknownCoverageFixture };
  assert.equal((await readAttention({}, deps)).data.status, "ready");
  const page = await readAttention({ work: "overdue_followup" }, deps);
  assert.equal(page.data.status, "pending_projection"); assert.equal(page.data.total_items, null);
  assert.equal(page.data.pending_reason, "snapshot_missing_query_keys");
});

test("OI-S2 pinned read filters and pages >200 tied/null rows without loss; cursor and rep scope stay bound", async t => {
  clearParsedAttentionSnapshots();
  const rows = Array.from({ length: 605 }, (_, i) => row(i + 1, { move_date: i % 3 === 0 ? null : "2026-10-01", responsible: i % 4 === 0 ? B : A, agents: i % 4 === 0 ? [B] : [A] }));
  const snapshot = { _id: "fake", snapshot_id: "outreach:oi", as_of: NOW, expires_at: null, rows: [], rows_gzip_base64: compressAttentionRows(rows) };
  t.mock.method(getSalesIntelligenceAttentionSnapshotModel(), "findOne", (filter: Record<string, unknown>) => {
    if (filter.snapshot_id === "outreach:expired") return mockQuery(null);
    return mockQuery(snapshot);
  });
  const deps = { now: NOW, coverage: async () => unknownCoverageFixture };
  const params = { view: "all_outreach", sort: "move_date", assigned_agent_id: A, snapshot_id: snapshot.snapshot_id, limit: 73 } as const;
  const ids: string[] = []; let cursor: string | undefined;
  do { const page = await readAttention({ ...params, cursor }, deps); ids.push(...page.data.items.map(item => item.subject_key)); cursor = page.data.cursor ?? undefined;
    assert.equal(page.data.total_items, rows.filter(item => item.filter_keys?.responsible === A).length);
  } while (cursor);
  const expected = rows.filter(item => item.filter_keys?.responsible === A).sort((a, b) => Number(a.filter_keys?.move_date == null) - Number(b.filter_keys?.move_date == null) || a.subject_key.localeCompare(b.subject_key)).map(item => item.subject_key);
  assert.deepEqual(ids, expected); assert.equal(new Set(ids).size, ids.length);
  const first = await readAttention(params, deps);
  await assert.rejects(readAttention({ ...params, loc_city: "changed", cursor: first.data.cursor! }, deps), { code: "INVALID_INPUT" });
  await assert.rejects(readAttention({ ...params, snapshot_id: "outreach:expired" }, deps), { code: "ATTENTION_SNAPSHOT_EXPIRED" });
  await assert.rejects(readAttention({ relationship: "assigned", agent: B }, { ...deps, scope: { agent_id: A } }), { code: "INVALID_INPUT" });
  const rep = await readAttention({ view: "all_outreach", assigned_agent_id: B, agent_id: B }, { ...deps, scope: { agent_id: A } });
  assert.equal(rep.data.total_items, 0);
});
