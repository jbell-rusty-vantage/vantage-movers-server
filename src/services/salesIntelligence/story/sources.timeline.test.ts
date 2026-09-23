import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { compareTimelineOrder, isAfterStoryCursor, keysetScan, timelineKindOrder, TIMELINE_KIND_ORDER, type SourceResult, type StoryCursor } from "./sources";
import type { StoryEvent, StoryEventKind } from "./types";

/**
 * Pure proof of the timeline keyset (data spec §5.3): in-memory "collections" evaluated with the
 * same window filters Mongo receives, paged at a small limit, concatenate to the unpaged list.
 * The replica test (`scripts/dev_ops/test-si-timeline.replica.test.ts`) repeats this over the
 * real readers (B12).
 */
type Row = { _id: mongoose.Types.ObjectId; at: Date; kind: StoryEventKind; offset: number };
const T0 = Date.parse("2026-09-01T12:00:00.000Z");
const HOUR = 3_600_000;
const hex = (n: number) => n.toString(16).padStart(24, "0");

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** Evaluates the two window shapes `keysetScan` builds: `{f: {$lte}}` and `{$and: [{f: {$lte}}, {$or: [{f: {$lt}}, {f, _id: {$lt}}]}]}`. */
function matches(row: Row, window: Record<string, unknown>): boolean {
  const lte = (clause: Record<string, unknown>) => +row.at <= +((clause.at as { $lte: Date }).$lte);
  if ("$and" in window) {
    const [upper, keyset] = window.$and as [Record<string, unknown>, { $or: Array<Record<string, unknown>> }];
    if (!lte(upper)) return false;
    return keyset.$or.some(c => (c.at as { $lt?: Date }).$lt ? +row.at < +(c.at as { $lt: Date }).$lt
      : +row.at === +(c.at as Date) && row._id.toHexString() < (c._id as { $lt: mongoose.Types.ObjectId }).$lt.toHexString());
  }
  return lte(window);
}
function collection(rows: Row[]) {
  const sorted = [...rows].sort((a, b) => +b.at - +a.at || (a._id.toHexString() < b._id.toHexString() ? 1 : -1));
  return async (window: Record<string, unknown>, batch: number) => sorted.filter(r => matches(r, window)).slice(0, batch);
}
const toEvent = (row: Row): StoryEvent => ({
  id: `${row.kind}:${row._id.toHexString()}`, kind: row.kind, happened_at: new Date(+row.at + row.offset).toISOString(), observed_at: row.at.toISOString(),
  subject_key: "number:x", actor: { kind: "vantage", agent_id: null, name: null, identity_status: null },
  record: { record_type: "story_event", record_id: `${row.kind}:${row._id.toHexString()}` }, sentence: "", detail: {}, evidence_refs: [],
});

type FakeSource = { rows: Row[]; aheadMs: number; slackBeforeMs: number; tieSafe?: boolean; fanout?: (row: Row) => Row[] };
const AS_OF = new Date(T0 + 400 * HOUR);

async function page(sources: FakeSource[], limit: number, after: StoryCursor | null): Promise<StoryEvent[]> {
  const accept = (e: StoryEvent) => Date.parse(e.happened_at) <= +AS_OF && isAfterStoryCursor(e, after);
  const results: SourceResult[] = await Promise.all(sources.map(s => keysetScan<Row>({
    query: collection(s.rows), field: "at", indexed: r => r.at, toEvents: rows => rows.flatMap(r => (s.fanout ? s.fanout(r) : [r]).map(toEvent)),
    accept, limit, aheadMs: s.aheadMs, tieSafe: s.tieSafe,
    upper: new Date(Math.min(+AS_OF, after ? Date.parse(after.happened_at) : Infinity) + s.slackBeforeMs) })));
  const seen = new Set<string>();
  const all = results.flatMap(r => r.events).filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true))).sort(compareTimelineOrder);
  return all.slice(0, limit + 1);
}

async function pageAll(sources: FakeSource[], limit: number) {
  const out: StoryEvent[] = [];
  let after: StoryCursor | null = null;
  for (let i = 0; i < 500; i++) {
    const events = await page(sources, limit, after);
    const shown = events.slice(0, limit);
    out.push(...shown);
    if (events.length <= limit) return out;
    const last = shown[shown.length - 1]!;
    after = { happened_at: last.happened_at, kind_order: timelineKindOrder(last.kind), id: last.id };
  }
  throw new Error("did not terminate");
}

function world(seed: number): FakeSource[] {
  const r = rng(seed);
  let n = 1;
  const rows = (count: number, kind: StoryEventKind, offset: () => number, sameInstant = 0.2): Row[] => {
    const out: Row[] = [];
    let last = T0;
    for (let i = 0; i < count; i++) {
      // Some rows share an instant with the previous row so ties exercise kind_order and id.
      const at = r() < sameInstant ? last : T0 + Math.floor(r() * 380) * HOUR + Math.floor(r() * 3) * 60_000;
      last = at;
      out.push({ _id: new mongoose.Types.ObjectId(hex(n++)), at: new Date(at), kind, offset: offset() });
    }
    return out;
  };
  return [
    { rows: rows(120, "call", () => 0), aheadMs: 0, slackBeforeMs: 0, tieSafe: true },
    // Granot: happened = captured ≤ applied, up to 24 h earlier (source 6).
    { rows: rows(60, "granot_priority_changed", () => -Math.floor(r() * 24 * HOUR)), aheadMs: 0, slackBeforeMs: 24 * HOUR },
    // Lead Messages: sent_at within 1 h before and 24 h after createdAt (source 12).
    { rows: rows(50, "lead_message_sent", () => Math.floor((r() * 25 - 1) * HOUR)), aheadMs: 24 * HOUR, slackBeforeMs: HOUR },
    // Audit: several story kinds from one source at the same instants (not tie-safe).
    { rows: rows(70, "assigned", () => 0, 0.5).map((row, i) => ({ ...row, kind: (["assigned", "owner_note", "closed", "waiting_set"] as const)[i % 4] })), aheadMs: 0, slackBeforeMs: 0 },
    // Conversations: two events per row at the same time (recorded + analyzed).
    { rows: rows(30, "conversation_recorded", () => 0), aheadMs: 0, slackBeforeMs: 0,
      fanout: row => [row, { ...row, kind: "conversation_analyzed" }] },
  ];
}

test("timeline kind_order is the data spec §5.2 row number", () => {
  assert.equal(timelineKindOrder("lead_received"), 1);
  assert.equal(timelineKindOrder("call"), 3);
  assert.equal(timelineKindOrder("granot_priority_changed"), 6);
  assert.equal(timelineKindOrder("followup_snoozed"), 9);
  assert.equal(timelineKindOrder("lead_message_sent"), 12);
  assert.equal(timelineKindOrder("something_new"), 99);
  assert.ok(Object.values(TIMELINE_KIND_ORDER).every(v => v >= 1 && v <= 12));
});

test("timeline order: happened_at desc, kind_order asc, id desc; the cursor is exclusive", () => {
  const e = (kind: string, id: string, at: string) => ({ kind, id, happened_at: at });
  const a = e("call", "call:b", "2026-09-02T00:00:00.000Z"), b = e("lead_received", "lead_received:a", "2026-09-01T00:00:00.000Z");
  assert.ok(compareTimelineOrder(a, b) < 0, "newer first");
  const same1 = e("lead_received", "lead_received:z", "2026-09-01T00:00:00.000Z"), same2 = e("call", "call:a", "2026-09-01T00:00:00.000Z");
  assert.ok(compareTimelineOrder(same1, same2) < 0, "same instant: row 1 before row 3");
  const hi = e("call", "call:b", "2026-09-01T00:00:00.000Z"), lo = e("call", "call:a", "2026-09-01T00:00:00.000Z");
  assert.ok(compareTimelineOrder(hi, lo) < 0, "same instant and row: higher id first");
  const cursor: StoryCursor = { happened_at: hi.happened_at, kind_order: 3, id: hi.id };
  assert.equal(isAfterStoryCursor(hi, cursor), false);
  assert.equal(isAfterStoryCursor(lo, cursor), true);
  assert.equal(isAfterStoryCursor(same1, cursor), false);
  assert.equal(isAfterStoryCursor(a, cursor), false);
  assert.equal(isAfterStoryCursor(b, { ...cursor, happened_at: "2026-09-03T00:00:00.000Z" }), true);
});

test("B12 (pure): paged at limit 7 the concatenation equals the unpaged list, slack sources included", async () => {
  for (const seed of [1, 7, 42, 2026]) {
    const sources = world(seed);
    const total = sources.reduce((n, s) => n + s.rows.length * (s.fanout ? 2 : 1), 0);
    assert.ok(total >= 300, `seed ${seed}: ${total} events`);
    const unpaged = (await page(sources, 10_000, null)).map(e => e.id);
    assert.equal(unpaged.length, new Set(unpaged).size);
    const paged = (await pageAll(sources, 7)).map(e => e.id);
    assert.deepEqual(paged, unpaged, `seed ${seed}`);
    const paged50 = (await pageAll(sources, 50)).map(e => e.id);
    assert.deepEqual(paged50, unpaged, `seed ${seed} limit 50`);
  }
});

test("keysetScan: slack rows before the cursor never cost an event (a later batch is read)", async () => {
  // 10 lead messages created at the same hour, sent 20 h later; 10 more created 30 h earlier, sent at once.
  const rows: Row[] = [];
  for (let i = 0; i < 10; i++) rows.push({ _id: new mongoose.Types.ObjectId(hex(100 + i)), at: new Date(T0 + 40 * HOUR), kind: "lead_message_sent", offset: 20 * HOUR });
  for (let i = 0; i < 10; i++) rows.push({ _id: new mongoose.Types.ObjectId(hex(200 + i)), at: new Date(T0 + 10 * HOUR + i * 60_000), kind: "lead_message_sent", offset: 0 });
  const after: StoryCursor = { happened_at: new Date(T0 + 30 * HOUR).toISOString(), kind_order: 12, id: "lead_message_sent:zzz" };
  const result = await keysetScan<Row>({ query: collection(rows), field: "at", indexed: r => r.at, toEvents: rs => rs.map(toEvent),
    accept: e => isAfterStoryCursor(e, after), limit: 3, aheadMs: 24 * HOUR, upper: new Date(T0 + 41 * HOUR) });
  // The first batch is all slack rows (created inside the window, sent after the cursor); the scan reads on.
  assert.equal(result.events.length, 4);
  assert.ok(result.events.every(e => Date.parse(e.happened_at) < T0 + 30 * HOUR));
  assert.equal(result.truncated, false);
});
