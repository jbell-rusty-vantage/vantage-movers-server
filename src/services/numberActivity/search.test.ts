import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { CsiError } from "../salesIntelligence/auth";
import { toNumberSearchItem, type ContactNumberLean } from "./contactNumbers";
import { NUMBER_DTO_FIXTURES, numberSearchItemDtoSchema } from "./dto";
import {
  buildNumberSearchFilter,
  buildSortedNumberSearchFilter,
  canonicalNumberSort,
  decodeNumberSortCursor,
  NUMBER_SORT_CANDIDATE_CAP,
  NUMBER_SORT_FIELDS,
  NUMBER_SORT_INDEXES,
  numberFilterHint,
  numberSearchDigest,
  numberSearchQuerySchema,
  pageNumberSearch,
  parseSearchTerm,
  resolveNumberSort,
  sortedNumberMongoSort,
  sortFieldValue,
  type NumberRowSource,
  type NumberSortCursor,
  type NumberSortSpec,
} from "./search";

/**
 * Data spec §4.2 (S2-NUMBERS): `last_call` / `first_call` aliases, the
 * `interactions` count sort with two-segment paging, and the `has_recording` /
 * `has_outreach` filters. The in-memory source mirrors the Mongo semantics the
 * Numbers filters use (null/missing equality, type-bracketed comparisons).
 */

type Row = ContactNumberLean & { purged_at: Date | null };
const query = (input: Record<string, unknown>) => numberSearchQuerySchema.parse(input);
const isInvalid = (e: unknown) => e instanceof CsiError && e.code === "INVALID_INPUT";

function pathValue(row: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), row);
}
function scalar(v: unknown): number | string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (v instanceof mongoose.Types.ObjectId) return v.toHexString();
  return v as number | string;
}
/** Keeps Date and number apart so a Date operand never matches a count (Mongo type bracketing). */
function kindOf(v: unknown): string {
  return v instanceof Date ? "date" : typeof v;
}
function matches(row: unknown, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$and") return (cond as Array<Record<string, unknown>>).every((f) => matches(row, f));
    if (key === "$or") return (cond as Array<Record<string, unknown>>).some((f) => matches(row, f));
    const raw = pathValue(row, key);
    if (Array.isArray(raw)) return raw.some((element) => matches({ [key]: element }, { [key]: cond }));
    const actual = scalar(raw);
    if (cond && typeof cond === "object" && !(cond instanceof Date) && !(cond instanceof mongoose.Types.ObjectId)) {
      return Object.entries(cond as Record<string, unknown>).every(([op, operand]) => {
        if (op === "$regex") return typeof actual === "string" && new RegExp(operand as string).test(actual);
        const o = scalar(operand);
        if (op === "$ne") return actual !== o;
        if (op === "$in") return (operand as unknown[]).map(scalar).includes(actual);
        if (actual === null || o === null || kindOf(raw) !== kindOf(operand)) return false;
        if (op === "$lt") return actual < o;
        if (op === "$gt") return actual > o;
        if (op === "$lte") return actual <= o;
        if (op === "$gte") return actual >= o;
        throw new Error(`unsupported ${op}`);
      });
    }
    return actual === scalar(cond);
  });
}
function compareBy(sort: Record<string, 1 | -1>) {
  return (a: unknown, b: unknown) => {
    for (const [path, dir] of Object.entries(sort)) {
      const x = scalar(pathValue(a, path));
      const y = scalar(pathValue(b, path));
      if (x === y) continue;
      if (x === null) return -dir;
      if (y === null) return dir;
      return x < y ? -dir : dir;
    }
    return 0;
  };
}
function memorySource(rows: Row[], counted?: number): NumberRowSource & { hints: Array<string | undefined> } {
  const source = {
    hints: [] as Array<string | undefined>,
    find: async (filter: Record<string, unknown>, sort: Record<string, 1 | -1>, limit: number, hint?: string) => {
      source.hints.push(hint);
      return rows.filter((r) => matches(r, filter)).sort(compareBy(sort)).slice(0, limit);
    },
    count: async (filter: Record<string, unknown>, limit: number) =>
      counted ?? Math.min(limit, rows.filter((r) => matches(r, filter)).length),
  };
  return source;
}

const oid = (n: number) => new mongoose.Types.ObjectId(n.toString(16).padStart(24, "0"));
const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n, 12));

/**
 * 30 external Numbers plus hygiene/purged decoys. `interactions` has ties, zeros,
 * explicit nulls (`null`) and missing keys (`undefined`); recordings and Outreach
 * counts vary independently so the filters narrow to distinct sets.
 */
const INTERACTIONS: Array<number | null | undefined> = [
  5, 0, 3, null, 3, 12, 0, undefined, 1, 5, 5, 0, 7, null, 2, 3, undefined, 12, 1, 0, 9, 5, null, 4, 0, 6, 3, undefined, 8, 1,
];
function fixture(): Row[] {
  const rows: Row[] = INTERACTIONS.map((n, i) => {
    const rollups: Record<string, unknown> = {
      inbound_total: 1,
      outbound_total: 0,
      human_conversations_total: 0,
      last_inbound_at: null,
      last_outbound_at: null,
      attached_lead_count: 0,
      candidate_lead_count: 0,
      open_outreach_count: 0,
      recordings_total: i % 3 === 0 ? 2 : 0,
      conversations_analyzed_total: i % 6 === 0 ? 1 : 0,
      last_analyzed_at: i % 6 === 0 ? day(i) : null,
      outreach_records_total: i % 4 === 0 ? 1 : 0,
    };
    if (n !== undefined) rollups.interactions_total = n;
    if (i === 29) delete rollups.recordings_total; // pre-sweep row: missing is "no recording"
    return {
      _id: oid(0x200 + i),
      revision: 1,
      e164: `+1555010${String(400 + i).padStart(4, "0")}`,
      national_ten: `555010${String(400 + i).padStart(4, "0")}`,
      digits_reversed: "x",
      kind: "external",
      classification: "unknown",
      contact_eligibility: { state: "allowed" },
      provider_names: [],
      search_terms: ["synthetic s2"],
      first_observed_at: day(i % 7),
      last_activity_at: day(40 + (i % 5)),
      rollups: rollups as unknown as ContactNumberLean["rollups"],
      running_summary: null,
      purged_at: null,
    };
  });
  rows.push({ ...rows[0]!, _id: oid(0x900), kind: "extension" }, { ...rows[5]!, _id: oid(0x901), purged_at: day(0) });
  return rows;
}
function expectedOrder(rows: Row[], spec: NumberSortSpec, keep: (r: Row) => boolean = () => true): string[] {
  const field = NUMBER_SORT_FIELDS[spec.sort];
  const dir = spec.direction === "desc" ? -1 : 1;
  const live = rows.filter((r) => r.kind === "external" && !r.purged_at && keep(r));
  const valued = live.filter((r) => pathValue(r, field) != null).sort(compareBy({ [field]: dir, _id: dir }));
  const empty = live.filter((r) => pathValue(r, field) == null).sort(compareBy({ _id: dir }));
  return [...valued, ...empty].map((r) => String(r._id));
}
async function pageAll(rows: Row[], input: Record<string, unknown>, limit: number, source = memorySource(rows)) {
  const seen: string[] = [];
  const cursors: NumberSortCursor[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 100; guard += 1) {
    const q = query({ ...input, limit, ...(cursor ? { cursor } : {}) });
    const result = await pageNumberSearch(q, parseSearchTerm(q.q), source);
    assert.equal(result.applied.sort, q.sort ?? "last_activity", "the page echoes the requested sort name");
    seen.push(...result.page.map((r) => String(r._id)));
    if (!result.next) return { seen, cursors };
    cursors.push(JSON.parse(Buffer.from(result.next, "base64url").toString("utf8")) as NumberSortCursor);
    cursor = result.next;
  }
  throw new Error("pager did not terminate");
}

test("S2 query schema: new sorts and the two Analysis filters parse; booleans are query-string safe", () => {
  for (const sort of ["last_call", "first_call", "interactions"]) assert.equal(query({ sort }).sort, sort);
  assert.equal(query({}).has_recording, false);
  assert.equal(query({}).has_outreach, false);
  assert.equal(query({ has_recording: "true" }).has_recording, true);
  assert.equal(query({ has_recording: "false" }).has_recording, false, "`false` never inverts to true");
  assert.equal(query({ has_outreach: true }).has_outreach, true);
  assert.throws(() => query({ has_recording: "yes" }));
  assert.throws(() => query({ has_outreach: "1" }));
  assert.throws(() => query({ sort: "calls" }));
});

test("S2 aliases: last_call is last_activity and first_call is first_observed (field, index, canonical cursor sort)", () => {
  assert.equal(canonicalNumberSort("last_call"), "last_activity");
  assert.equal(canonicalNumberSort("first_call"), "first_observed");
  assert.equal(canonicalNumberSort("interactions"), "interactions");
  assert.equal(NUMBER_SORT_FIELDS.last_call, NUMBER_SORT_FIELDS.last_activity);
  assert.equal(NUMBER_SORT_FIELDS.first_call, NUMBER_SORT_FIELDS.first_observed);
  assert.equal(NUMBER_SORT_INDEXES.interactions, "contact_number_kind_interactions");
  const q = query({ sort: "last_call" });
  assert.equal(
    numberSearchDigest(q, resolveNumberSort(q)),
    numberSearchDigest(query({ sort: "last_activity" }), { sort: "last_activity", direction: "desc" }),
    "an alias and its canonical sort share one digest",
  );
  assert.notEqual(
    numberSearchDigest(query({ sort: "interactions" }), { sort: "interactions", direction: "desc" }),
    numberSearchDigest(query({ sort: "last_activity" }), { sort: "last_activity", direction: "desc" }),
  );
  assert.deepEqual(sortedNumberMongoSort({ sort: "first_call", direction: "asc" }, "value"), { first_observed_at: 1, _id: 1 });
});

for (const [alias, canonical] of [["last_call", "last_activity"], ["first_call", "first_observed"]] as const) {
  for (const direction of ["desc", "asc"] as const) {
    test(`S2 ${alias} ${direction} pages exactly like ${canonical}, and cursors cross between the two names`, async () => {
      const rows = fixture();
      const expected = expectedOrder(rows, { sort: canonical, direction });
      assert.equal(expected.length, 30);
      for (const limit of [1, 7, 30, 50]) {
        const a = await pageAll(rows, { sort: alias, direction }, limit);
        const c = await pageAll(rows, { sort: canonical, direction }, limit);
        assert.deepEqual(a.seen, expected, `${alias} limit ${limit}`);
        assert.deepEqual(c.seen, expected, `${canonical} limit ${limit}`);
        assert.ok(a.cursors.every((x) => x.sort === canonical && typeof x.value === "string"), "cursor sort is canonical, value is ISO");
      }
      const first = await pageNumberSearch(query({ sort: alias, direction, limit: 7 }), { kind: "none" }, memorySource(rows));
      const cont = await pageNumberSearch(query({ sort: canonical, direction, limit: 7, cursor: first.next! }), { kind: "none" }, memorySource(rows));
      assert.deepEqual(cont.page.map((r) => String(r._id)), expected.slice(7, 14), "alias cursor continues under the canonical name");
      const back = await pageNumberSearch(query({ sort: alias, direction, limit: 7, cursor: cont.next! }), { kind: "none" }, memorySource(rows));
      assert.deepEqual(back.page.map((r) => String(r._id)), expected.slice(14, 21), "and back");
    });
  }
}

test("S2 last_call desc accepts the legacy {last_activity_at, id} cursor; first_call and interactions do not", async () => {
  const rows = fixture();
  const legacy = await pageNumberSearch(query({ limit: 7 }), { kind: "none" }, memorySource(rows));
  const cont = await pageNumberSearch(query({ sort: "last_call", limit: 7, cursor: legacy.next! }), { kind: "none" }, memorySource(rows));
  assert.deepEqual(cont.page.map((r) => String(r._id)), expectedOrder(rows, { sort: "last_activity", direction: "desc" }).slice(7, 14));
  for (const sort of ["first_call", "interactions"]) {
    await assert.rejects(pageNumberSearch(query({ sort, limit: 7, cursor: legacy.next! }), { kind: "none" }, memorySource(rows)), isInvalid, sort);
  }
  await assert.rejects(pageNumberSearch(query({ sort: "last_call", direction: "asc", limit: 7, cursor: legacy.next! }), { kind: "none" }, memorySource(rows)), isInvalid);
});

for (const direction of ["desc", "asc"] as const) {
  test(`S2 interactions ${direction}: numeric keyset, ties on _id, zeros are values, null and missing last, no repeats or skips`, async () => {
    const rows = fixture();
    const expected = expectedOrder(rows, { sort: "interactions", direction });
    assert.equal(expected.length, 30);
    assert.equal(new Set(expected).size, 30);
    const tail = expected.slice(-6).map((id) => pathValue(rows.find((r) => String(r._id) === id)!, "rollups.interactions_total") ?? null);
    assert.deepEqual(tail, [null, null, null, null, null, null], "3 null + 3 missing are the null segment in both directions");
    const zeros = expected.filter((id) => pathValue(rows.find((r) => String(r._id) === id)!, "rollups.interactions_total") === 0);
    assert.equal(zeros.length, 5);
    for (const limit of [1, 2, 7, 24, 25, 30, 200]) {
      const { seen, cursors } = await pageAll(rows, { sort: "interactions", direction }, limit);
      assert.deepEqual(seen, expected, `limit ${limit}`);
      for (const c of cursors) {
        assert.equal(c.sort, "interactions");
        if (c.segment === "value") assert.equal(typeof c.value, "number", "numeric cursor value, not a date");
        else assert.equal(c.value, null);
      }
    }
    // A page boundary exactly on a zero keeps the cursor in the value segment.
    const zeroIdx = expected.findIndex((id) => pathValue(rows.find((r) => String(r._id) === id)!, "rollups.interactions_total") === 0);
    const atZero = await pageNumberSearch(query({ sort: "interactions", direction, limit: zeroIdx + 1 }), { kind: "none" }, memorySource(rows));
    const c = JSON.parse(Buffer.from(atZero.next!, "base64url").toString("utf8")) as NumberSortCursor;
    assert.deepEqual([c.segment, c.value], ["value", 0], "a zero count is the value segment, never mistaken for null");
  });
}

test("S2 interactions filter: value segment $ne null with a numeric keyset; null segment on _id", () => {
  const q = query({ sort: "interactions", direction: "desc" });
  const applied = { sort: "interactions", direction: "desc" } as const;
  assert.deepEqual(buildSortedNumberSearchFilter(q, applied, "value", null).$and, [{ "rollups.interactions_total": { $ne: null } }]);
  const paged = buildSortedNumberSearchFilter(q, applied, "value", { segment: "value", value: 3, id: "cccccccccccccccccccccccc" });
  const keyset = (paged.$and as Array<Record<string, unknown>>)[1]!.$or as Array<Record<string, unknown>>;
  assert.deepEqual(keyset[0], { "rollups.interactions_total": { $lt: 3 } });
  assert.deepEqual(keyset[1]!["rollups.interactions_total"], 3);
  assert.deepEqual(buildSortedNumberSearchFilter(q, applied, "null", null).$and, [{ "rollups.interactions_total": null }]);
  assert.deepEqual(sortedNumberMongoSort(applied, "value"), { "rollups.interactions_total": -1, _id: -1 });
  assert.equal(sortFieldValue({ rollups: { interactions_total: 0 } } as unknown as ContactNumberLean, "interactions"), 0);
  assert.equal(sortFieldValue({ rollups: {} } as unknown as ContactNumberLean, "interactions"), null);
});

test("S2 cursor value is typed by sort: a date on interactions or a number on a time sort is INVALID_INPUT", async () => {
  const rows = fixture();
  const q = query({ sort: "interactions", limit: 7 });
  const page = await pageNumberSearch(q, { kind: "none" }, memorySource(rows));
  const decoded = JSON.parse(Buffer.from(page.next!, "base64url").toString("utf8")) as NumberSortCursor;
  assert.equal(typeof decoded.value, "number");
  assert.deepEqual(decodeNumberSortCursor(page.next!, q, resolveNumberSort(q)), decoded);
  const tampered = (patch: Record<string, unknown>) => Buffer.from(JSON.stringify({ ...decoded, ...patch })).toString("base64url");
  for (const bad of [
    tampered({ value: "2026-09-01T12:00:00.000Z" }),
    tampered({ value: "5" }),
    tampered({ value: null }),
    tampered({ segment: "null" }),
    tampered({ sort: "first_observed" }),
    tampered({ sort: "last_call" }),
  ]) {
    assert.throws(() => decodeNumberSortCursor(bad, q, resolveNumberSort(q)), isInvalid);
  }
  const t = query({ sort: "first_call", limit: 7 });
  const timePage = await pageNumberSearch(t, { kind: "none" }, memorySource(rows));
  const td = JSON.parse(Buffer.from(timePage.next!, "base64url").toString("utf8")) as NumberSortCursor;
  const numericOnTime = Buffer.from(JSON.stringify({ ...td, value: 5 })).toString("base64url");
  assert.throws(() => decodeNumberSortCursor(numericOnTime, t, resolveNumberSort(t)), isInvalid);
  // An interactions cursor never continues a different sort, direction or filter set.
  for (const other of [{ sort: "interactions", direction: "asc" }, { sort: "last_call" }, { sort: "interactions", has_recording: "true" }, { sort: "interactions", has_outreach: "true" }]) {
    const oq = query({ ...other, limit: 7, cursor: page.next! });
    await assert.rejects(pageNumberSearch(oq, { kind: "none" }, memorySource(rows)), isInvalid, JSON.stringify(other));
  }
});

test("S2 has_recording / has_outreach: residual > 0 predicates, bound into the digest only when set", () => {
  const plain = buildNumberSearchFilter(query({}), null);
  assert.equal(plain["rollups.recordings_total"], undefined);
  assert.equal(plain["rollups.outreach_records_total"], undefined);
  const both = buildNumberSearchFilter(query({ has_recording: "true", has_outreach: "true", active_from: "2026-09-01T00:00:00.000Z" }), null);
  assert.deepEqual(both["rollups.recordings_total"], { $gt: 0 });
  assert.deepEqual(both["rollups.outreach_records_total"], { $gt: 0 });
  assert.deepEqual(both.last_activity_at, { $gte: new Date("2026-09-01T00:00:00.000Z") });
  assert.equal(both.kind, "external", "kind stays the index prefix");
  const spec: NumberSortSpec = { sort: "interactions", direction: "desc" };
  const d = (input: Record<string, unknown>) => numberSearchDigest(query({ sort: "interactions", ...input }), spec);
  assert.equal(d({ has_recording: "false", has_outreach: "false" }), d({}), "false/absent leave the pre-S2 digest unchanged");
  assert.notEqual(d({ has_recording: "true" }), d({}));
  assert.notEqual(d({ has_outreach: "true" }), d({}));
  assert.notEqual(d({ has_recording: "true" }), d({ has_outreach: "true" }));
});

test("S2 filters narrow every sort and page exactly (value and null segments), including the legacy path", async () => {
  const rows = fixture();
  const hasRec = (r: Row) => ((r.rollups as { recordings_total?: number }).recordings_total ?? 0) > 0;
  const hasOut = (r: Row) => ((r.rollups as { outreach_records_total?: number }).outreach_records_total ?? 0) > 0;
  for (const [input, keep] of [
    [{ has_recording: "true" }, hasRec],
    [{ has_outreach: "true" }, hasOut],
    [{ has_recording: "true", has_outreach: "true" }, (r: Row) => hasRec(r) && hasOut(r)],
  ] as const) {
    for (const sort of ["interactions", "last_call", "first_call"] as const) {
      for (const direction of ["desc", "asc"] as const) {
        const expected = expectedOrder(rows, { sort, direction }, keep);
        assert.ok(expected.length > 0 && expected.length < 30, JSON.stringify(input));
        const { seen } = await pageAll(rows, { ...input, sort, direction }, 3);
        assert.deepEqual(seen, expected, `${JSON.stringify(input)} ${sort} ${direction}`);
      }
    }
    const legacy: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 40; guard += 1) {
      const q = query({ ...input, limit: 4, ...(cursor ? { cursor } : {}) });
      const r = await pageNumberSearch(q, { kind: "none" }, memorySource(rows));
      legacy.push(...r.page.map((x) => String(x._id)));
      if (!r.next) break;
      cursor = r.next;
    }
    assert.deepEqual(legacy, expectedOrder(rows, { sort: "last_activity", direction: "desc" }, keep), "historical path honours the filters");
  }
  // Row 29 has no recordings_total key at all: it never matches has_recording.
  const { seen } = await pageAll(rows, { has_recording: "true", sort: "interactions" }, 50);
  assert.equal(seen.includes(String(oid(0x200 + 29))), false);
});

test("S2 filter hint: an unsearched has_recording/has_outreach request reads through the sort's kind index; q and unfiltered requests are unchanged", async () => {
  const rows = fixture();
  const none = { kind: "none" } as const;
  assert.equal(numberFilterHint(query({ has_recording: "true" }), "interactions", none), "contact_number_kind_interactions");
  assert.equal(numberFilterHint(query({ has_outreach: "true" }), "last_call", none), "contact_number_kind_activity");
  assert.equal(numberFilterHint(query({ has_outreach: "true" }), "first_call", none), "contact_number_kind_first_observed");
  assert.equal(numberFilterHint(query({ has_outreach: "true" }), "last_human_conversation", none), "contact_number_kind_human_conversation");
  assert.equal(numberFilterHint(query({}), "interactions", none), undefined);
  assert.equal(numberFilterHint(query({ has_recording: "true", q: "synthetic" }), "interactions", parseSearchTerm("synthetic")), undefined);
  const sorted = memorySource(rows);
  await pageAll(rows, { sort: "interactions", has_recording: "true" }, 7, sorted);
  assert.ok(sorted.hints.length > 0 && sorted.hints.every((h) => h === "contact_number_kind_interactions"), "both segments, every page");
  const legacy = memorySource(rows);
  const r = await pageNumberSearch(query({ has_outreach: "true", limit: 3 }), none, legacy);
  assert.equal(r.hint, "contact_number_kind_activity");
  assert.deepEqual(legacy.hints, ["contact_number_kind_activity"], "the historical path is hinted only when filtered");
  const plain = memorySource(rows);
  await pageNumberSearch(query({ limit: 3 }), none, plain);
  await pageAll(rows, { sort: "interactions" }, 7, plain);
  assert.ok(plain.hints.every((h) => h === undefined));
});

test("S2 interactions under q: planner-sorted under the cap; above it every page hints contact_number_kind_interactions", async () => {
  const rows = fixture();
  const expected = expectedOrder(rows, { sort: "interactions", direction: "asc" });
  const under = memorySource(rows);
  assert.deepEqual((await pageAll(rows, { sort: "interactions", direction: "asc", q: "synthetic" }, 7, under)).seen, expected);
  assert.ok(under.hints.every((h) => h === undefined));
  const over = memorySource(rows, NUMBER_SORT_CANDIDATE_CAP + 1);
  assert.deepEqual((await pageAll(rows, { sort: "interactions", direction: "asc", q: "synthetic" }, 7, over)).seen, expected);
  assert.ok(over.hints.length > 0 && over.hints.every((h) => h === "contact_number_kind_interactions"));
  const lastCall = memorySource(rows, NUMBER_SORT_CANDIDATE_CAP + 1);
  await pageAll(rows, { sort: "last_call", q: "synthetic" }, 7, lastCall);
  assert.ok(lastCall.hints.every((h) => h === undefined), "last_call keeps the activity path: no candidate count, no hint");
});

test("S2 row DTO: rollups carry recordings, analysed conversations, last analysed and Outreach totals; defaults on pre-sweep rows", () => {
  const rows = fixture();
  const item = toNumberSearchItem(rows[0]!, { kind: "none" });
  assert.equal(item.rollups.recordings_total, 2);
  assert.equal(item.rollups.conversations_analyzed_total, 1);
  assert.equal(item.rollups.last_analyzed_at, day(0).toISOString());
  assert.equal(item.rollups.outreach_records_total, 1);
  assert.equal(item.rollups.interactions_total, 5, "existing fields are kept");
  const bare = toNumberSearchItem({ ...rows[1]!, rollups: { interactions_total: 2 } as unknown as ContactNumberLean["rollups"] }, { kind: "none" });
  assert.equal(bare.rollups.recordings_total, 0);
  assert.equal(bare.rollups.conversations_analyzed_total, 0);
  assert.equal(bare.rollups.last_analyzed_at, null);
  assert.equal(bare.rollups.outreach_records_total, 0);
  // Older fixtures without the new keys still parse (additive, optional in the schema).
  numberSearchItemDtoSchema.parse(NUMBER_DTO_FIXTURES.searchItem);
  assert.throws(() => numberSearchItemDtoSchema.parse({ ...NUMBER_DTO_FIXTURES.searchItem, rollups: { ...NUMBER_DTO_FIXTURES.searchItem.rollups, recordings_total: -1 } }));
});
