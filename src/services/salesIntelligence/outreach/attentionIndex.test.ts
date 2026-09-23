import assert from "node:assert/strict";
import { test } from "node:test";
import { payloadHash } from "../transactions";
import { attentionRowDtoSchema, type AttentionFilterKeysDto, type AttentionRowDto } from "../dto";
import { attentionCursorDigest, attentionMetrics, attentionQuerySchema, rowMatchesAttentionQuery, sortAttentionRows } from "./attention";
import { addDays, attentionIndexEntry, decodeAttentionIndex, encodeAttentionIndex, entryMatchesAttentionQuery } from "./attentionIndex";
import { attentionSchema as adminAttentionSchema } from "./attention.adminSchema.fixture";

/**
 * S2-DESK (data spec §3.4–§3.7): B5 every final spec §7.3 / §8 parameter over
 * `rowMatchesAttentionQuery`, the sorts, the query contract, the cursor digest,
 * B7 metrics and the index round trip. Every time boundary is a fixed clock.
 */
const A = "a".repeat(24), B = "b".repeat(24);
const AS_OF = new Date("2026-09-23T15:00:00Z"); // 11:00 ET
const ctx = { as_of: AS_OF };
const parse = (input: Record<string, unknown>) => attentionQuerySchema.parse(input);
const KEYS: AttentionFilterKeysDto = { band: 4, needs_review: false, state: "open", agents: [A], attachment: "lead", priority: "1", has_recording: true,
  has_assessment: true, newer_call: false, ti: 60, ml: 40, received_at: "2026-09-20T12:00:00.000Z", move_date: "2026-09-30", outcome: null, closed_at: null };
let serial = 0;
function row(keys: Partial<AttentionFilterKeysDto> = {}, over: Record<string, unknown> = {}): AttentionRowDto {
  const filter_keys = { ...KEYS, ...keys };
  return { subject_key: `lead:FormLead:${String(++serial).padStart(24, "0")}`, subject: { kind: "lead", model: "FormLead", id: String(serial).padStart(24, "0") },
    outreach: null, allowed_actions: [], derived: { attention_band: filter_keys.band, review_badges: filter_keys.needs_review ? ["x"] : [], reasons: [] },
    sort_keys: {}, in_attention: true, partition: "active", filter_keys, ...over } as unknown as AttentionRowDto;
}
const closedRow = (keys: Partial<AttentionFilterKeysDto> = {}) => row({ band: null, state: "closed", outcome: "booked", closed_at: "2026-09-19T16:00:00.000Z", ...keys }, { partition: "closed", in_attention: false });

test("B5: every desk parameter filters on filter_keys (table-driven)", () => {
  type Case = [string, Record<string, unknown>, Partial<AttentionFilterKeysDto>, boolean];
  const cases: Case[] = [
    ["empty query", {}, {}, true],
    ["band hit", { band: "4" }, {}, true], ["band miss", { band: "1,2" }, {}, false], ["band null never matches", { band: "4" }, { band: null }, false],
    ["state hit", { state: "open" }, {}, true], ["state miss", { state: "unworked" }, {}, false],
    ["needs_review true", { needs_review: "true" }, { needs_review: true }, true], ["needs_review false", { needs_review: "false" }, { needs_review: true }, false],
    ["agent assigned/promised/owned hit", { agent_id: [B, A] }, {}, true], ["agent miss", { agent_id: B }, {}, false],
    ["unassigned true on empty agents", { unassigned: "true" }, { agents: [] }, true], ["unassigned true on assigned", { unassigned: "true" }, {}, false],
    ["unassigned false on assigned", { unassigned: "false" }, {}, true], ["unassigned false on empty", { unassigned: "false" }, { agents: [] }, false],
    ["attachment lead", { attachment: "lead" }, {}, true], ["attachment none vs lead", { attachment: "none" }, {}, false], ["attachment none", { attachment: "none" }, { attachment: "none" }, true],
    ["priority code hit", { priority: "1,5" }, {}, true], ["priority code miss", { priority: "5" }, {}, false],
    ["priority not_set matches null", { priority: "not_set" }, { priority: null }, true], ["priority not_set skips a code", { priority: "not_set" }, {}, false],
    ["priority code skips null", { priority: "1" }, { priority: null }, false],
    ["has_recording true", { has_recording: "true" }, {}, true], ["has_recording false", { has_recording: "false" }, {}, false],
    ["has_assessment true", { has_assessment: "true" }, {}, true], ["has_assessment false on none", { has_assessment: "false" }, { has_assessment: false }, true],
    ["newer_call true on false", { newer_call: "true" }, {}, false], ["newer_call true", { newer_call: "true" }, { newer_call: true }, true],
    ["ti_min equal", { ti_min: "60" }, {}, true], ["ti_min above", { ti_min: "75" }, {}, false], ["ti_min null", { ti_min: "0" }, { ti: null }, false],
    ["ml_min below", { ml_min: "25" }, {}, true], ["ml_min above", { ml_min: "50" }, {}, false], ["ml_min null", { ml_min: "0" }, { ml: null }, false],
    ["received_from inclusive", { received_from: "2026-09-20T12:00:00.000Z" }, {}, true], ["received_from after", { received_from: "2026-09-20T12:00:00.001Z" }, {}, false],
    ["received_to exclusive", { received_to: "2026-09-20T12:00:00.000Z" }, {}, false], ["received_to after", { received_to: "2026-09-21T00:00:00Z" }, {}, true],
    ["received range with offset", { received_from: "2026-09-20T08:00:00-04:00", received_to: "2026-09-20T09:00:00-04:00" }, {}, true],
    ["received bound on null", { received_from: "2020-01-01T00:00:00Z" }, { received_at: null }, false],
    ["move_date_within 7 (in)", { move_date_within: "7" }, {}, true], ["move_date_within 6 (out)", { move_date_within: "6" }, {}, false],
    ["move_date_within today", { move_date_within: "0" }, { move_date: "2026-09-23" }, true], ["move_date_within past", { move_date_within: "30" }, { move_date: "2026-09-22" }, false],
    ["move_date_within null", { move_date_within: "30" }, { move_date: null }, false],
    ["move_date_passed true on past", { move_date_passed: "true" }, { move_date: "2026-09-22" }, true], ["move_date_passed true on today", { move_date_passed: "true" }, { move_date: "2026-09-23" }, false],
    ["move_date_passed false on future", { move_date_passed: "false" }, {}, true], ["move_date_passed null", { move_date_passed: "false" }, { move_date: null }, false],
    ["freshness fresh", { freshness: "fresh" }, {}, true],
  ];
  for (const [name, query, keys, expected] of cases) assert.equal(rowMatchesAttentionQuery(row(keys), parse(query), ctx), expected, name);

  const closedCases: Case[] = [
    ["closed view, no filter", {}, {}, true], ["outcome hit", { outcome: "booked,cancelled" }, {}, true], ["outcome miss", { outcome: "owner" }, {}, false],
    ["closed_from inclusive", { closed_from: "2026-09-19T16:00:00Z" }, {}, true], ["closed_from after", { closed_from: "2026-09-19T16:00:01Z" }, {}, false],
    ["closed_to exclusive", { closed_to: "2026-09-19T16:00:00Z" }, {}, false], ["closed last 7d", { closed_from: new Date(+AS_OF - 7 * 86_400_000).toISOString() }, {}, true],
    ["rep filter in closed", { agent_id: A }, {}, true], ["received in closed", { received_to: "2026-09-01T00:00:00Z" }, {}, false],
  ];
  for (const [name, query, keys, expected] of closedCases) assert.equal(rowMatchesAttentionQuery(closedRow(keys), parse({ view: "closed", ...query }), ctx), expected, name);
});

test("B5: views partition the snapshot; closed rows never reach attention or all_outreach", () => {
  const active = row(), notInAttention = row({}, { in_attention: false }), badgeClosed = row({ state: "closed", needs_review: true }), closed = closedRow();
  const matches = (r: AttentionRowDto, q: Record<string, unknown>) => rowMatchesAttentionQuery(r, parse(q), ctx);
  assert.deepEqual([active, notInAttention, badgeClosed, closed].map(r => matches(r, {})), [true, false, true, false], "attention");
  assert.deepEqual([active, notInAttention, badgeClosed, closed].map(r => matches(r, { view: "all_outreach" })), [true, true, false, false], "all_outreach");
  assert.deepEqual([active, notInAttention, badgeClosed, closed].map(r => matches(r, { view: "all_outreach", state: "closed" })), [false, false, true, false], "all_outreach + state=closed");
  assert.deepEqual([active, notInAttention, badgeClosed, closed].map(r => matches(r, { view: "closed" })), [false, false, false, true], "closed");
  // A pre-S2 row (no filter_keys, no partition) keeps the legacy predicate and never matches an S2 parameter.
  const legacy = { ...row(), filter_keys: undefined, partition: undefined, outreach: { state: "open", assignment: { agent: { id: A } }, followups: [{ assignment: { agent: null }, promised_by: { id: B } }] } } as unknown as AttentionRowDto;
  assert.equal(matches(legacy, {}), true);
  assert.equal(matches(legacy, { agent_id: B }), true, "legacy promised_by match");
  assert.equal(matches(legacy, { band: "4", state: "open" }), true);
  assert.equal(matches(legacy, { has_recording: "false" }), false);
  assert.equal(matches(legacy, { view: "closed" }), false);
});

test("move_date filters use the ET calendar day of the snapshot as_of (fixed clocks across ET midnight)", () => {
  const due = row({ move_date: "2026-09-23" });
  const at = (iso: string) => ({ as_of: new Date(iso) });
  const passed = parse({ move_date_passed: "true" }), within0 = parse({ move_date_within: "0" });
  // 23:30 ET on Sep 23 is 03:30Z on Sep 24: still Sep 23 in New York.
  assert.equal(rowMatchesAttentionQuery(due, passed, at("2026-09-24T03:30:00Z")), false);
  assert.equal(rowMatchesAttentionQuery(due, within0, at("2026-09-24T03:30:00Z")), true);
  // 00:00 ET Sep 24 (04:00Z, EDT): the move date has passed.
  assert.equal(rowMatchesAttentionQuery(due, passed, at("2026-09-24T03:59:59.999Z")), false);
  assert.equal(rowMatchesAttentionQuery(due, passed, at("2026-09-24T04:00:00Z")), true);
  assert.equal(rowMatchesAttentionQuery(due, within0, at("2026-09-24T04:00:00Z")), false);
  // Upper bound: today + n inclusive, across a month end.
  const oct1 = row({ move_date: "2026-10-01" });
  assert.equal(rowMatchesAttentionQuery(oct1, parse({ move_date_within: "7" }), at("2026-09-24T03:59:00Z")), false, "Sep 23 + 7 = Sep 30");
  assert.equal(rowMatchesAttentionQuery(oct1, parse({ move_date_within: "7" }), at("2026-09-24T04:00:00Z")), true, "Sep 24 + 7 = Oct 1");
  // DST end: Nov 1 2026 00:00 EDT is 04:00Z; Nov 2 00:00 EST is 05:00Z.
  const nov1 = row({ move_date: "2026-11-01" });
  assert.equal(rowMatchesAttentionQuery(nov1, passed, at("2026-11-02T04:30:00Z")), false);
  assert.equal(rowMatchesAttentionQuery(nov1, passed, at("2026-11-02T05:00:00Z")), true);
  assert.equal(addDays("2026-12-28", 7), "2027-01-04");
  assert.throws(() => rowMatchesAttentionQuery(due, passed), /as_of/);
});

test("query contract: closed-only params and sorts, rep_unread (Phase 5), priority codes, no defaults for new params", () => {
  assert.throws(() => parse({ outcome: "booked" }));
  assert.throws(() => parse({ closed_from: "2026-09-01T00:00:00Z", view: "all_outreach" }));
  assert.throws(() => parse({ sort: "closed" }));
  assert.throws(() => parse({ sort: "time_to_close", view: "attention" }));
  assert.throws(() => parse({ rep_unread: "true" }), "rep_unread is Phase 5 and rejected as unknown");
  assert.throws(() => parse({ received_from: "yesterday" }));
  assert.throws(() => parse({ ti_min: "101" }));
  assert.throws(() => parse({ priority: "5;drop" }));
  assert.deepEqual(parse({ view: "closed", outcome: ["cancelled", "booked"], sort: "time_to_close" }).outcome, ["booked", "cancelled"]);
  assert.deepEqual(parse({ priority: "not_set,3" }).priority, ["3", "not_set"]);
  assert.deepEqual(parse({ sort: "last_call" }).sort, "last_call");
  assert.deepEqual(Object.keys(parse({})).sort(), ["limit", "sort", "view"], "S2 adds no default keys");
});

test("cursor digest: old shapes still resolve; every new parameter is bound", () => {
  const digest = (input: Record<string, unknown>) => {
    const { cursor, limit, direction, ...rest } = parse(input);
    void cursor; void limit;
    return attentionCursorDigest({ ...rest, direction: direction ?? "asc" });
  };
  assert.equal(digest({}), payloadHash({}), "default request keeps the pre-sort filters shape");
  assert.equal(digest({ band: "1" }), payloadHash({ band: [1] }));
  assert.equal(digest({ sort: "lead_received", direction: "desc" }), payloadHash({ sort: "lead_received", direction: "desc", view: "attention" }), "LP-06 shape");
  const params: Record<string, unknown>[] = [{ unassigned: "true" }, { attachment: "none" }, { priority: "3" }, { has_recording: "true" }, { has_assessment: "false" }, { newer_call: "true" },
    { ti_min: "50" }, { ml_min: "25" }, { received_from: "2026-09-01T00:00:00Z" }, { received_to: "2026-09-01T00:00:00Z" }, { move_date_within: "7" }, { move_date_passed: "true" },
    { sort: "last_call" }, { sort: "interactions" }, { view: "closed" }, { view: "closed", outcome: "booked" }, { view: "closed", closed_from: "2026-09-01T00:00:00Z" },
    { view: "closed", closed_to: "2026-09-01T00:00:00Z" }, { view: "closed", sort: "closed" }, { view: "closed", sort: "time_to_close" }];
  const seen = new Set([digest({})]);
  for (const p of params) {
    const d = digest(p);
    assert.ok(!seen.has(d), `${JSON.stringify(p)} changes the digest`);
    seen.add(d);
  }
});

test("S2 sorts: last_call / interactions desc, closed desc, time_to_close asc; nulls last both ways, ties on subject_key", () => {
  const r = (key: string, sort_keys: Record<string, unknown>) => ({ subject_key: key, sort_keys }) as unknown as AttentionRowDto;
  const rows = [r("d", { last_call: null, interactions: null, closed: "2026-09-20T00:00:00.000Z", time_to_close: 5 }), r("b", { last_call: "2026-09-22T00:00:00.000Z", interactions: 3, closed: null, time_to_close: null }),
    r("a", { last_call: "2026-09-22T00:00:00.000Z", interactions: 10, closed: "2026-09-21T00:00:00.000Z", time_to_close: 5 }), r("c", { last_call: "2026-09-21T00:00:00.000Z", interactions: 2, closed: "2026-09-19T00:00:00.000Z", time_to_close: 1 })];
  const order = (sort: Parameters<typeof sortAttentionRows>[1], direction: "asc" | "desc") => sortAttentionRows(rows, sort, direction).map(x => x.subject_key).join("");
  assert.equal(order("last_call", "desc"), "abcd");
  assert.equal(order("last_call", "asc"), "cabd");
  assert.equal(order("interactions", "desc"), "abcd");
  assert.equal(order("interactions", "asc"), "cbad");
  assert.equal(order("closed", "desc"), "adcb");
  assert.equal(order("time_to_close", "asc"), "cadb");
  assert.equal(order("time_to_close", "desc"), "adcb");
});

test("B7: metrics equal a direct recount over the same rows (fixed clock, 7-day boundaries)", () => {
  const DAY = 86_400_000;
  const edge = new Date(+AS_OF - 7 * DAY).toISOString(), justOut = new Date(+AS_OF - 7 * DAY - 1).toISOString();
  const facts = (over: Record<string, unknown>) => ({ newer_call_since_assessment: false, conversations_total: 0, ...over });
  const active = (band: number | null, f: Record<string, unknown>, status: string | null, state = "open") => ({ ...row({ band }), derived: { attention_band: band, reasons: [] },
    outreach: { state, facts: facts(f), move_assessment: status ? { status } : null } }) as unknown as AttentionRowDto;
  const booked = (closed_at: string, ms: number | null, reason = "booked") => ({ ...closedRow(), outcome: { reason, closed_at, time_to_close_ms: ms } }) as unknown as AttentionRowDto;
  const rows = [
    active(1, {}, null), active(1, { conversations_total: 2 }, "pending"), active(2, { newer_call_since_assessment: true }, "ready"), active(2, { conversations_total: 1 }, "ready"),
    active(null, { conversations_total: 1 }, null), active(null, { conversations_total: 1 }, "not_applicable"), active(1, { conversations_total: 3 }, null, "closed"),
    booked(edge, 8 * DAY + 5), booked(new Date(+AS_OF - DAY).toISOString(), 2 * DAY), booked(new Date(+AS_OF - 2 * DAY).toISOString(), 3 * DAY + 1), booked(new Date(+AS_OF - 3 * DAY).toISOString(), 30 * DAY),
    booked(justOut, 1), booked(new Date(+AS_OF - DAY).toISOString(), 4 * DAY, "cancelled"), booked(new Date(+AS_OF - DAY).toISOString(), null),
  ];
  const metrics = attentionMetrics(rows, 17, AS_OF);
  // Direct recount, written independently of attentionMetrics.
  const activeRows = rows.filter(x => x.partition !== "closed" && x.outreach?.state !== "closed");
  const inWindow = rows.filter(x => x.partition === "closed" && x.outcome?.reason === "booked" && +new Date(x.outcome.closed_at) >= +AS_OF - 7 * DAY);
  const ms = inWindow.map(x => x.outcome!.time_to_close_ms).filter((v): v is number => v != null).sort((a, b) => a - b);
  const median = (ms[1]! + ms[2]!) / 2;
  assert.deepEqual(metrics, {
    as_of: AS_OF.toISOString(), leads_received_7d: 17,
    not_called_yet: activeRows.filter(x => x.derived.attention_band === 2).length,
    callbacks_overdue: activeRows.filter(x => x.derived.attention_band === 1).length,
    awaiting_assessment: activeRows.filter(x => x.outreach!.facts!.newer_call_since_assessment || ((x.outreach!.facts!.conversations_total ?? 0) >= 1 && ["pending", "not_assessed", undefined].includes(x.outreach!.move_assessment?.status))).length,
    booked_7d: inWindow.length, booked_7d_median_days: Math.floor(median / DAY),
  });
  assert.equal(metrics.callbacks_overdue, 2, "the badge-only closed row is not an active tile row");
  assert.equal(metrics.awaiting_assessment, 3);
  assert.equal(metrics.booked_7d, 5, "closed_at exactly as_of - 7d is inside; 1 ms earlier is outside; cancelled is not booked");
  assert.equal(metrics.booked_7d_median_days, 5, "median of 2d, 3d+1ms, 8d+5ms, 30d = 5.5d, rounded down");
  assert.equal(attentionMetrics([], 0, AS_OF).booked_7d_median_days, null, "no booking: unknown, never zero");
});

test("D9 index: round trip, positions and chunk indexes; legacy rows index with the legacy keys", () => {
  const rows = [row(), closedRow(), row({ band: 1 })];
  const entries = rows.map((r, i) => attentionIndexEntry(r, i % 2, i === 0 ? null : 1));
  const decoded = decodeAttentionIndex(encodeAttentionIndex(entries));
  assert.deepEqual(decoded, entries);
  assert.deepEqual(decoded.map(e => [e.partition, e.chunk_index, e.position]), [["active", null, 0], ["closed", 1, 1], ["active", 1, 0]]);
  assert.equal(entryMatchesAttentionQuery(decoded[1]!, parse({ view: "closed", outcome: "booked" }), ctx), true);
  assert.ok(Buffer.byteLength(JSON.stringify(entries[0])) < 700, "an entry stays in the few-hundred-byte range");
});

test("flag-off compatibility: an S2 page (flag off) parses with the production Admin's attentionSchema (539a628)", () => {
  // A flag-off S2 row carries the additive `partition` and `filter_keys`; the page carries no `metrics`. The server-side
  // row schema is strict, so the row is first proven to be a valid S2 row. (The replica test parses a real flag-off read.)
  const derived = { overdue: false, no_owner: false, no_next_action: false, cooldown: false, attention_band: 4, reasons: [], review_item_ids: [], call_blockers: [], age_wall_ms: 0, age_staffed_ms: 0, policy_version: "p" };
  const item = attentionRowDtoSchema.parse({ ...row(), derived, outreach: null, sort_keys: { next_action_due: null, lead_received: null, last_human_contact: null, last_lead_progress: null, last_call: null, interactions: 3 } });
  const withRow = { as_of: AS_OF.toISOString(), coverage: { known_through: null, gaps: [], ai_paused: false, capabilities: {} },
    data: { items: [item], snapshot_id: "outreach:x", cursor: null, total_items: 1, reason_counts: {}, status: "ready", stale: false, sort: "attention", direction: "asc", view: "attention", freshness: "all" } };
  const parsed = adminAttentionSchema.parse(withRow);
  assert.equal(parsed.data.items.length, 1);
  assert.equal("filter_keys" in parsed.data.items[0]!, false, "the Admin strips unknown keys");
});
