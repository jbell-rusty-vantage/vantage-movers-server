import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { numberDetailDtoSchema } from "../salesIntelligence/dto";
import { CsiError } from "../salesIntelligence/auth";
import {
  NUMBER_DETAIL_READ_ONLY_FIELDS,
  NUMBER_DTO_FIXTURES,
  numberDetailReadDtoSchema,
  numberSearchItemDtoSchema,
  numberTimelineEventDtoSchema,
  type NumberTimelineEventDto,
} from "./dto";
import { attachedForItem, type ContactNumberLean } from "./contactNumbers";
import {
  buildNumberSearchFilter,
  buildSortedNumberSearchFilter,
  decodeNumberCursor,
  decodeNumberSortCursor,
  encodeNumberCursor,
  escapeRegex,
  NUMBER_SORT_CANDIDATE_CAP,
  NUMBER_SORT_FIELDS,
  NUMBER_SORT_INDEXES,
  numberSearchDigest,
  numberSearchQuerySchema,
  pageNumberSearch,
  parseSearchTerm,
  resolveNumberSort,
  sortedNumberMongoSort,
  type NumberRowSource,
  type NumberSortCursor,
  type NumberSortSpec,
} from "./search";
import {
  compareTimelineEvents,
  decodeTimelineCursor,
  encodeTimelineCursor,
  isAfterCursor,
  keysetAfterCursor,
  mergeTimeline,
} from "./timeline";

const ID_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const ID_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const ID_C = "cccccccccccccccccccccccc";
const T1 = "2026-09-17T14:00:00.000Z";
const T0 = "2026-09-17T13:00:00.000Z";

const query = (input: Record<string, unknown>) => numberSearchQuerySchema.parse(input);

test("parseSearchTerm: e164, suffix, term and formatting", () => {
  assert.deepEqual(parseSearchTerm(undefined), { kind: "none" });
  assert.deepEqual(parseSearchTerm("   "), { kind: "none" });
  assert.deepEqual(parseSearchTerm("5550100200"), { kind: "e164", e164: "+15550100200", reversed: "0020010555" });
  assert.deepEqual(parseSearchTerm("+1 555 010 0200"), { kind: "e164", e164: "+15550100200", reversed: "00200105551" });
  assert.deepEqual(parseSearchTerm("(555) 010-0200"), { kind: "e164", e164: "+15550100200", reversed: "0020010555" }, "formatted ten digits is an exact number");
  assert.deepEqual(parseSearchTerm("0200"), { kind: "suffix", reversed: "0020" });
  assert.deepEqual(parseSearchTerm("010-0200"), { kind: "suffix", reversed: "0020010" }, "seven digits is a suffix");
  assert.deepEqual(parseSearchTerm("smith"), { kind: "term", term: "smith" });
  assert.deepEqual(parseSearchTerm("  Smith  "), { kind: "term", term: "smith" });
  assert.deepEqual(parseSearchTerm("42"), { kind: "term", term: "42" }, "one or two digits is too short for a suffix");
  assert.deepEqual(parseSearchTerm("JOB-1234"), { kind: "term", term: "job-1234" }, "letters plus digits is a term (Job Numbers)");
});

test("term regex characters are escaped and anchored as a prefix", () => {
  assert.equal(escapeRegex("a.b*c(d)[e]^$|?+{}\\"), "a\\.b\\*c\\(d\\)\\[e\\]\\^\\$\\|\\?\\+\\{\\}\\\\");
  const filter = buildNumberSearchFilter(query({ q: "o'neil (jr.)" }), null);
  assert.deepEqual(filter.search_terms, { $regex: "^o'neil \\(jr\\.\\)" });
  assert.equal(new RegExp((filter.search_terms as { $regex: string }).$regex).test("o'neil (jr.) moving"), true);
  assert.equal(new RegExp((filter.search_terms as { $regex: string }).$regex).test("xo'neil (jr.)"), false, "anchored prefix");
  assert.equal(new RegExp((filter.search_terms as { $regex: string }).$regex).test("o'neil xjrx)"), false, "dot and parens are literal");
});

test("number cursor round trip; garbage is INVALID_INPUT", () => {
  const cursor = { last_activity_at: T1, id: ID_A };
  const encoded = encodeNumberCursor(cursor);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/, "base64url");
  assert.deepEqual(decodeNumberCursor(encoded), cursor);
  for (const garbage of ["", "not-a-cursor", Buffer.from("{}").toString("base64url"), Buffer.from('{"last_activity_at":"x","id":"y"}').toString("base64url"), Buffer.from(JSON.stringify({ ...cursor, extra: 1 })).toString("base64url")]) {
    assert.throws(() => decodeNumberCursor(garbage), (e: unknown) => e instanceof CsiError && e.code === "INVALID_INPUT", `garbage: ${garbage}`);
  }
});

test("buildNumberSearchFilter: hygiene, attachment, range, term and keyset cursor", () => {
  assert.deepEqual(buildNumberSearchFilter(query({}), null), { kind: "external", purged_at: null });
  assert.deepEqual(buildNumberSearchFilter(query({ hygiene: "true" }), null), { kind: { $ne: "external" }, purged_at: null });
  assert.deepEqual(buildNumberSearchFilter(query({ hygiene: "false" }), null), { kind: "external", purged_at: null }, "?hygiene=false must not invert the default");
  assert.deepEqual(buildNumberSearchFilter(query({ hygiene: false }), null), { kind: "external", purged_at: null });
  assert.throws(() => query({ hygiene: "0" }), "only true/false are accepted; 0/off are not coerced");
  assert.throws(() => query({ hygiene: "off" }));
  assert.deepEqual(buildNumberSearchFilter(query({ classification: "customer" }), null), { kind: "external", classification: { $in: ["customer"] }, purged_at: null });
  assert.deepEqual(buildNumberSearchFilter(query({ classification: ["company", "customer"] }), null).classification, { $in: ["company", "customer"] });
  assert.deepEqual(query({ classification: ["customer", "company", "customer"] }).classification, ["company", "customer"]);
  assert.equal(query({}).classification, undefined);

  const linked = buildNumberSearchFilter(query({ attachment: "linked" }), null);
  assert.deepEqual(linked.$and, [{ $or: [{ "rollups.attached_lead_count": { $gt: 0 } }, { "rollups.candidate_lead_count": { $gt: 0 } }] }]);
  const unlinked = buildNumberSearchFilter(query({ attachment: "unlinked" }), null);
  assert.equal(unlinked["rollups.attached_lead_count"], 0);
  assert.equal(unlinked["rollups.candidate_lead_count"], 0);
  assert.equal(unlinked.$and, undefined);

  const ranged = buildNumberSearchFilter(query({ active_from: T0, active_to: T1 }), null);
  assert.deepEqual(ranged.last_activity_at, { $gte: new Date(T0), $lte: new Date(T1) });
  assert.deepEqual(buildNumberSearchFilter(query({ active_from: T0 }), null).last_activity_at, { $gte: new Date(T0) });

  // Digit input matches exact E.164 OR the same digits as a suffix, so a
  // pasted number with a wrong country prefix is a hit, not a search miss.
  const digits = buildNumberSearchFilter(query({ q: "5550100200" }), null).$and as Array<Record<string, unknown>>;
  assert.deepEqual(digits, [{ $or: [{ e164: "+15550100200" }, { digits_reversed: { $regex: "^0020010555" } }] }]);
  assert.equal(buildNumberSearchFilter(query({ q: "5550100200" }), null).e164, undefined, "the exact match moved into the $or");
  assert.deepEqual(buildNumberSearchFilter(query({ q: "0200" }), null).digits_reversed, { $regex: "^0020" });

  const paged = buildNumberSearchFilter(query({ attachment: "linked", active_to: T1 }), { last_activity_at: T1, id: ID_B });
  const and = paged.$and as Array<Record<string, unknown>>;
  assert.equal(and.length, 2, "attachment $or and cursor $or are separate $and members");
  const keyset = and[1]!.$or as Array<Record<string, unknown>>;
  assert.deepEqual(keyset[0], { last_activity_at: { $lt: new Date(T1) } });
  assert.deepEqual((keyset[1] as { last_activity_at: Date }).last_activity_at, new Date(T1));
  assert.equal(String((keyset[1] as { _id: { $lt: unknown } })._id.$lt), ID_B);
  assert.deepEqual(paged.last_activity_at, { $lte: new Date(T1) }, "range stays on the field; the cursor does not overwrite it");
});

const event = (over: Partial<NumberTimelineEventDto> & Pick<NumberTimelineEventDto, "id" | "kind" | "happened_at">): NumberTimelineEventDto => ({
  observed_at: over.happened_at,
  subject_key: `number:${ID_A}`,
  description: "synthetic",
  evidence_refs: [],
  detail: {},
  ...over,
});

test("timeline total order: happened_at desc, kind asc, id desc; isAfterCursor is strict", () => {
  const newer = event({ id: ID_A, kind: "interaction", happened_at: T1 });
  const older = event({ id: ID_C, kind: "interaction", happened_at: T0 });
  const sameTimeConversation = event({ id: ID_A, kind: "conversation", happened_at: T1 });
  const sameTimeLowerId = event({ id: "999999999999999999999999", kind: "interaction", happened_at: T1 });
  assert.ok(compareTimelineEvents(newer, older) < 0, "newer first");
  assert.ok(compareTimelineEvents(older, newer) > 0);
  assert.ok(compareTimelineEvents(sameTimeConversation, newer) < 0, "same instant: kind ascending (conversation < interaction)");
  assert.ok(compareTimelineEvents(newer, sameTimeLowerId) < 0, "same instant and kind: higher id first");
  assert.equal(compareTimelineEvents(newer, { ...newer }), 0);

  const cursor = { happened_at: T1, kind: "interaction", id: ID_A };
  assert.equal(isAfterCursor(newer, cursor), false, "the cursor row itself is excluded");
  assert.equal(isAfterCursor(older, cursor), true);
  assert.equal(isAfterCursor(sameTimeLowerId, cursor), true, "same instant, same kind, lower id comes after");
  assert.equal(isAfterCursor(sameTimeConversation, cursor), false, "same instant, earlier kind comes before");
  assert.equal(isAfterCursor(event({ id: ID_A, kind: "lead_message", happened_at: T1 }), cursor), true, "same instant, later kind comes after");
  assert.equal(isAfterCursor(event({ id: "000000000000000000000000", kind: "conversation", happened_at: "2026-09-17T14:00:00.001Z" }), cursor), false, "one millisecond newer is before");

  const cursorRound = encodeTimelineCursor(cursor);
  assert.deepEqual(decodeTimelineCursor(cursorRound), cursor);
  assert.throws(() => decodeTimelineCursor("garbage"), (e: unknown) => e instanceof CsiError && e.code === "INVALID_INPUT");
  assert.throws(() => decodeTimelineCursor(Buffer.from('{"happened_at":"nope","kind":"x","id":"y"}').toString("base64url")), (e: unknown) => e instanceof CsiError && e.code === "INVALID_INPUT");
});

test("keysetAfterCursor mirrors isAfterCursor for a fixed kind", () => {
  const cursor = { happened_at: T1, kind: "interaction", id: ID_B };
  const at = new Date(T1);
  assert.deepEqual(keysetAfterCursor(null, "interaction", "started_at", "_id", String), {});
  assert.deepEqual(keysetAfterCursor(cursor, "conversation", "started_at", "_id", String), { started_at: { $lt: at } }, "earlier kind: only strictly older rows");
  assert.deepEqual(keysetAfterCursor(cursor, "lead_message", "happened_at", "_id", String), { happened_at: { $lte: at } }, "later kind: same instant allowed");
  assert.deepEqual(keysetAfterCursor(cursor, "interaction", "started_at", "_id", String), {
    $or: [{ started_at: { $lt: at } }, { started_at: at, _id: { $lt: ID_B } }],
  });
});

test("mergeTimeline: k-way merge, dedupe on (kind,id), cursor only when more remain", () => {
  const a = event({ id: ID_A, kind: "interaction", happened_at: T1 });
  const b = event({ id: ID_B, kind: "lead_message", happened_at: T1 });
  const c = event({ id: ID_C, kind: "conversation", happened_at: T1 });
  const d = event({ id: ID_A, kind: "lead_message", happened_at: T0 });
  const duplicateOfA = event({ id: ID_A, kind: "interaction", happened_at: T1, description: "duplicate from a second source" });

  const full = mergeTimeline([[a, d], [b], [c, duplicateOfA]], 10);
  assert.deepEqual(full.items.map((e) => `${e.kind}:${e.id}`), [`conversation:${ID_C}`, `interaction:${ID_A}`, `lead_message:${ID_B}`, `lead_message:${ID_A}`]);
  assert.equal(full.items[1]!.description, "synthetic", "first occurrence wins the dedupe");
  assert.equal(full.cursor, null, "everything fit: no cursor");

  const page = mergeTimeline([[a, d], [b], [c]], 2);
  assert.deepEqual(page.items.map((e) => e.id), [ID_C, ID_A]);
  assert.ok(page.cursor);
  assert.deepEqual(decodeTimelineCursor(page.cursor!), { happened_at: T1, kind: "interaction", id: ID_A });
  const rest = [a, b, c, d].filter((e) => isAfterCursor(e, decodeTimelineCursor(page.cursor!)));
  assert.deepEqual(rest.map((e) => `${e.kind}:${e.id}`).sort(), [`lead_message:${ID_A}`, `lead_message:${ID_B}`], "the remaining rows are exactly those after the cursor");

  assert.deepEqual(mergeTimeline([], 5), { items: [], cursor: null });
  assert.deepEqual(mergeTimeline([[a], [a]], 1), { items: [a], cursor: null }, "duplicates do not fabricate a next page");
});

test("NUMBER_DTO_FIXTURES parse against their schemas; CSI-01 detail data is a subset of the CSI-04 detail data", () => {
  numberSearchItemDtoSchema.parse(NUMBER_DTO_FIXTURES.searchItem);
  numberDetailReadDtoSchema.parse(NUMBER_DTO_FIXTURES.detail);
  numberTimelineEventDtoSchema.parse(NUMBER_DTO_FIXTURES.timelineInteraction);
  numberTimelineEventDtoSchema.parse(NUMBER_DTO_FIXTURES.timelineLeadMessage);

  const data: Record<string, unknown> = { ...NUMBER_DTO_FIXTURES.detail.data };
  for (const field of NUMBER_DETAIL_READ_ONLY_FIELDS) delete data[field];
  const base = numberDetailDtoSchema.parse({ ...NUMBER_DTO_FIXTURES.detail, data });
  assert.deepEqual(Object.keys(base.data).sort(), Object.keys(data).sort(), "stripping the B-only fields yields exactly the frozen CSI-01 shape");
  const baseKeys = Object.keys(numberDetailDtoSchema.shape.data.shape);
  const readKeys = Object.keys(numberDetailReadDtoSchema.shape.data.shape);
  for (const key of baseKeys) assert.ok(readKeys.includes(key), `CSI-04 detail keeps CSI-01 key ${key}`);
  assert.deepEqual(readKeys.filter((k) => !baseKeys.includes(k)).sort(), [...NUMBER_DETAIL_READ_ONLY_FIELDS].sort());

  assert.throws(() => numberSearchItemDtoSchema.parse({ ...NUMBER_DTO_FIXTURES.searchItem, search_terms: ["leak"] }), "search item is strict: search_terms is detail-only");
  assert.throws(() => numberTimelineEventDtoSchema.parse({ ...NUMBER_DTO_FIXTURES.timelineInteraction, body: "x" }), "timeline events are strict");
});

// ---------------------------------------------------------------------------
// LP-06 Numbers time sorts (§14.2, acceptance 25): pure pager over an in-memory source
// ---------------------------------------------------------------------------

type Row = ContactNumberLean & { purged_at: Date | null };

function pathValue(row: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), row);
}
function scalar(v: unknown): number | string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (v instanceof mongoose.Types.ObjectId) return v.toHexString();
  return v as number | string;
}
/** Mongo semantics for the operators the Numbers filters use: null/missing equality, $ne, $lt/$gt (type-bracketed), $in, $and/$or. */
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
        if (actual === null || o === null || typeof actual !== typeof o) return false;
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
      if (x === null) return -dir; // null sorts lowest, as in Mongo
      if (y === null) return dir;
      return x < y ? -dir : dir;
    }
    return 0;
  };
}
function memorySource(rows: Row[], counted?: number): NumberRowSource & { calls: number } {
  const source = {
    calls: 0,
    find: async (filter: Record<string, unknown>, sort: Record<string, 1 | -1>, limit: number) => {
      source.calls += 1;
      return rows.filter((r) => matches(r, filter)).sort(compareBy(sort)).slice(0, limit);
    },
    count: async (filter: Record<string, unknown>, limit: number) =>
      counted ?? Math.min(limit, rows.filter((r) => matches(r, filter)).length),
  };
  return source;
}

const oid = (n: number) => new mongoose.Types.ObjectId(n.toString(16).padStart(24, "0"));
const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n, 12));
/** 14 external numbers (plus hygiene and purged decoys): ties on every sort field, 5 with no human conversation. */
function sortFixture(): Row[] {
  const human = [3, null, 7, 7, null, 1, 9, null, 2, 7, null, 5, null, 4];
  const firstObserved = [4, 2, 2, 8, 1, 6, 2, 3, 9, 5, 7, 1, 6, 10];
  const lastActivity = [3, 5, 5, 1, 9, 2, 5, 8, 7, 4, 6, 0, 2, 11];
  const rows: Row[] = human.map((h, i) => ({
    _id: oid(0x100 + i),
    revision: 1,
    e164: `+1555010${String(300 + i).padStart(4, "0")}`,
    national_ten: `555010${String(300 + i).padStart(4, "0")}`,
    digits_reversed: "x",
    kind: "external",
    classification: "unknown",
    contact_eligibility: { state: "allowed" },
    provider_names: [],
    search_terms: i % 2 ? ["synthetic odd"] : ["synthetic even"],
    first_observed_at: day(firstObserved[i]!),
    last_activity_at: day(20 + lastActivity[i]!),
    rollups: {
      interactions_total: 1,
      inbound_total: 1,
      outbound_total: 0,
      human_conversations_total: h === null ? 0 : 1,
      last_inbound_at: null,
      last_outbound_at: null,
      last_human_conversation_at: h === null ? null : day(h),
      attached_lead_count: 0,
      candidate_lead_count: 0,
      open_outreach_count: 0,
    },
    running_summary: null,
    purged_at: null,
  }));
  rows.push({ ...rows[0]!, _id: oid(0x900), kind: "extension" }, { ...rows[1]!, _id: oid(0x901), purged_at: day(0) });
  return rows;
}
function expectedOrder(rows: Row[], spec: NumberSortSpec): string[] {
  const field = NUMBER_SORT_FIELDS[spec.sort];
  const dir = spec.direction === "desc" ? -1 : 1;
  const live = rows.filter((r) => r.kind === "external" && !r.purged_at);
  const valued = live.filter((r) => pathValue(r, field) != null).sort(compareBy({ [field]: dir, _id: dir }));
  const empty = live.filter((r) => pathValue(r, field) == null).sort(compareBy({ _id: dir }));
  return [...valued, ...empty].map((r) => String(r._id));
}
async function pageAll(rows: Row[], input: Record<string, unknown>, limit: number) {
  const source = memorySource(rows);
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard += 1) {
    const q = query({ ...input, limit, ...(cursor ? { cursor } : {}) });
    const result = await pageNumberSearch(q, parseSearchTerm(q.q), source);
    seen.push(...result.page.map((r) => String(r._id)));
    if (!result.next) return { seen, source };
    cursor = result.next;
  }
  throw new Error("pager did not terminate");
}
const isInvalid = (e: unknown) => e instanceof CsiError && e.code === "INVALID_INPUT";

test("LP-06 query schema: sort and direction are optional enums; unknown values are rejected", () => {
  assert.equal(query({}).sort, undefined, "no default is materialized, so the historical path stays byte-identical");
  assert.equal(query({}).direction, undefined);
  assert.deepEqual(resolveNumberSort(query({})), { sort: "last_activity", direction: "desc" });
  assert.deepEqual(resolveNumberSort(query({ sort: "first_observed" })), { sort: "first_observed", direction: "desc" });
  assert.deepEqual(resolveNumberSort(query({ direction: "asc" })), { sort: "last_activity", direction: "asc" });
  assert.throws(() => query({ sort: "lead_progress" }), "no Lead progress sort on Numbers");
  assert.throws(() => query({ sort: "updatedAt" }));
  assert.throws(() => query({ direction: "up" }));
});

test("LP-06 sorted filter: value segment is non-null with a directional keyset; null segment keys on _id; range survives", () => {
  const q = query({ sort: "last_human_conversation", direction: "asc", active_from: T0 });
  const first = buildSortedNumberSearchFilter(q, { sort: "last_human_conversation", direction: "asc" }, "value", null);
  assert.deepEqual(first.last_activity_at, { $gte: new Date(T0) }, "the activity range is not overwritten");
  assert.deepEqual(first.$and, [{ "rollups.last_human_conversation_at": { $ne: null } }]);
  const paged = buildSortedNumberSearchFilter(q, { sort: "last_human_conversation", direction: "asc" }, "value", {
    segment: "value",
    value: T1,
    id: ID_B,
  });
  const keyset = (paged.$and as Array<Record<string, unknown>>)[1]!.$or as Array<Record<string, unknown>>;
  assert.deepEqual(keyset[0], { "rollups.last_human_conversation_at": { $gt: new Date(T1) } }, "asc pages upward");
  assert.equal(String((keyset[1] as { _id: { $gt: unknown } })._id.$gt), ID_B);
  const nulls = buildSortedNumberSearchFilter(q, { sort: "first_observed", direction: "desc" }, "null", { segment: "null", value: null, id: ID_C });
  assert.deepEqual(nulls.$and, [{ first_observed_at: null }, { _id: { $lt: new mongoose.Types.ObjectId(ID_C) } }]);
  const enteringNulls = buildSortedNumberSearchFilter(q, { sort: "first_observed", direction: "desc" }, "null", {
    segment: "value",
    value: T1,
    id: ID_C,
  });
  assert.deepEqual(enteringNulls.$and, [{ first_observed_at: null }], "leaving the value segment starts the null segment from its beginning");
  assert.deepEqual(sortedNumberMongoSort({ sort: "first_observed", direction: "asc" }, "value"), { first_observed_at: 1, _id: 1 });
  assert.deepEqual(sortedNumberMongoSort({ sort: "last_human_conversation", direction: "desc" }, "null"), { _id: -1 });
});

for (const sort of ["last_activity", "last_human_conversation", "first_observed"] as const) {
  for (const direction of ["desc", "asc"] as const) {
    test(`LP-06 ${sort} ${direction}: global order across pages, ties on _id, nulls last, each row once`, async () => {
      const rows = sortFixture();
      const expected = expectedOrder(rows, { sort, direction });
      assert.equal(expected.length, 14);
      for (const limit of [1, 4, 5, 14, 50]) {
        const { seen } = await pageAll(rows, { sort, direction }, limit);
        assert.deepEqual(seen, expected, `limit ${limit}`);
      }
      if (sort === "last_human_conversation") {
        const tail = expected.slice(-5).map((id) => rows.find((r) => String(r._id) === id)!.rollups.last_human_conversation_at);
        assert.deepEqual(tail, [null, null, null, null, null], "the five nulls are last in this direction too");
      }
    });
  }
}

test("LP-06 historical path: no sort/direction keeps one query, the legacy cursor and last_activity desc", async () => {
  const rows = sortFixture();
  const source = memorySource(rows);
  const first = await pageNumberSearch(query({ limit: 4 }), { kind: "none" }, source);
  assert.equal(source.calls, 1);
  assert.deepEqual(
    first.page.map((r) => String(r._id)),
    expectedOrder(rows, { sort: "last_activity", direction: "desc" }).slice(0, 4),
  );
  const legacy = decodeNumberCursor(first.next!);
  assert.deepEqual(Object.keys(legacy).sort(), ["id", "last_activity_at"], "legacy cursor shape is unchanged");
  // An explicitly sorted cursor is not a legacy cursor.
  const sorted = await pageNumberSearch(query({ limit: 4, sort: "last_activity" }), { kind: "none" }, memorySource(rows));
  await assert.rejects(pageNumberSearch(query({ limit: 4, cursor: sorted.next! }), { kind: "none" }, source), isInvalid);
  // A legacy cursor continues an explicit last_activity desc listing, and only that one.
  const cont = await pageNumberSearch(
    query({ limit: 4, sort: "last_activity", direction: "desc", cursor: first.next! }),
    { kind: "none" },
    memorySource(rows),
  );
  assert.deepEqual(
    cont.page.map((r) => String(r._id)),
    expectedOrder(rows, { sort: "last_activity", direction: "desc" }).slice(4, 8),
  );
  assert.throws(() => decodeNumberSortCursor(first.next!, query({ sort: "first_observed" }), { sort: "first_observed", direction: "desc" }), isInvalid);
  assert.throws(() => decodeNumberSortCursor(first.next!, query({ direction: "asc" }), { sort: "last_activity", direction: "asc" }), isInvalid);
});

test("LP-06 cursor binds sort, direction and filters; garbage and tampering are INVALID_INPUT", async () => {
  const rows = sortFixture();
  const base = { sort: "first_observed", direction: "asc", classification: "unknown", limit: 3 } as const;
  const page = await pageNumberSearch(query(base), { kind: "none" }, memorySource(rows));
  const cursor = page.next!;
  const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as NumberSortCursor;
  assert.deepEqual(Object.keys(decoded).sort(), ["digest", "direction", "id", "segment", "sort", "v", "value"]);
  assert.equal(decoded.segment, "value");
  assert.deepEqual(decodeNumberSortCursor(cursor, query(base), { sort: "first_observed", direction: "asc" }), decoded);
  for (const other of [
    { ...base, sort: "last_activity" },
    { ...base, sort: "last_human_conversation" },
    { ...base, direction: "desc" },
    { ...base, classification: "customer" },
    { ...base, q: "synthetic" },
    { ...base, hygiene: "true" },
    { ...base, attachment: "linked" },
    { ...base, active_from: T0 },
  ]) {
    const q = query(other);
    await assert.rejects(pageNumberSearch({ ...q, cursor }, parseSearchTerm(q.q), memorySource(rows)), isInvalid, JSON.stringify(other));
  }
  const q = query(base);
  assert.equal(
    numberSearchDigest({ ...q, limit: 200 }, resolveNumberSort(q)),
    numberSearchDigest(q, resolveNumberSort(q)),
    "limit is not part of the digest",
  );
  const tampered = (patch: Record<string, unknown>) => Buffer.from(JSON.stringify({ ...decoded, ...patch })).toString("base64url");
  for (const bad of [
    "garbage",
    tampered({ sort: "last_human_conversation" }),
    tampered({ segment: "null" }),
    tampered({ value: null }),
    tampered({ digest: "0".repeat(16) }),
    tampered({ v: 3 }),
    tampered({ extra: 1 }),
  ]) {
    assert.throws(() => decodeNumberSortCursor(bad, q, resolveNumberSort(q)), isInvalid);
  }
  // A null-segment cursor records no value and resumes inside the null segment.
  const p1 = await pageNumberSearch(query({ sort: "last_human_conversation", limit: 11 }), { kind: "none" }, memorySource(rows));
  const c1 = JSON.parse(Buffer.from(p1.next!, "base64url").toString("utf8")) as NumberSortCursor;
  assert.equal(c1.segment, "null");
  assert.equal(c1.value, null);
});

test("LP-06 q-filtered non-activity sort: planner-sorted under the cap; above it every page hints the sort index and keeps the requested order", async () => {
  const rows = sortFixture();
  const q = { sort: "first_observed", direction: "asc", q: "synthetic" } as const;
  const expected = expectedOrder(rows, { sort: "first_observed", direction: "asc" });
  const under = await pageAll(rows, q, 4);
  assert.deepEqual(under.seen, expected);

  const base = memorySource(rows, NUMBER_SORT_CANDIDATE_CAP + 1);
  const hints: Array<string | undefined> = [];
  const over: NumberRowSource = {
    count: base.count,
    find: async (f, sort, limit, hint) => {
      hints.push(hint);
      return base.find(f, sort, limit);
    },
  };
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 20; guard += 1) {
    const parsedQuery = query({ ...q, limit: 4, ...(cursor ? { cursor } : {}) });
    const result = await pageNumberSearch(parsedQuery, parseSearchTerm(parsedQuery.q), over);
    assert.deepEqual(result.applied, { sort: "first_observed", direction: "asc" }, "the requested order is never swapped");
    assert.equal(result.hint, NUMBER_SORT_INDEXES.first_observed);
    seen.push(...result.page.map((r) => String(r._id)));
    if (!result.next) break;
    cursor = result.next;
  }
  assert.deepEqual(seen, expected, "hinted pages are the same global order");
  assert.ok(hints.length > 0 && hints.every((h) => h === "contact_number_kind_first_observed"), "both segments are hinted on every page");
  // Unfiltered or last_activity requests never pay for the candidate count.
  let counted = 0;
  const probe = memorySource(rows);
  const countingProbe: NumberRowSource = {
    find: probe.find,
    count: async (f, l) => {
      counted += 1;
      return probe.count(f, l);
    },
  };
  await pageNumberSearch(query({ sort: "first_observed" }), { kind: "none" }, countingProbe);
  await pageNumberSearch(query({ sort: "last_activity", direction: "asc", q: "synthetic" }), parseSearchTerm("synthetic"), countingProbe);
  assert.equal(counted, 0);
});

test("LP-06 DTO: rollups expose last_human_conversation_at; attached_lead_progress is resolved-only for Lead fields", () => {
  const item = NUMBER_DTO_FIXTURES.searchItem;
  numberSearchItemDtoSchema.parse({ ...item, rollups: { ...item.rollups, last_human_conversation_at: null } });
  numberSearchItemDtoSchema.parse({ ...item, rollups: { ...item.rollups, last_human_conversation_at: T1 } });
  const leadRef = { model: "FormLead", id: ID_A } as const;
  const resolved = { status: "resolved", lead_ref: leadRef, lead_progress: null, booking: { id: ID_B, cancelled: false }, outreach_state: "open" } as const;
  numberSearchItemDtoSchema.parse({ ...item, attached_lead_progress: resolved });
  numberSearchItemDtoSchema.parse({ ...item, attached_lead_progress: { status: "multiple" } });
  numberSearchItemDtoSchema.parse({ ...item, attached_lead_progress: { status: "none" } });
  assert.throws(() => numberSearchItemDtoSchema.parse({ ...item, attached_lead_progress: { status: "multiple", lead_ref: leadRef } }), "no merged Lead on multiple");
  assert.throws(() => numberSearchItemDtoSchema.parse({ ...item, attached_lead_progress: { status: "none", booking: null } }));
  assert.throws(() => numberSearchItemDtoSchema.parse({ ...item, attached_lead_progress: { status: "resolved" } }), "resolved names its Lead");
  assert.deepEqual(attachedForItem({ status: "multiple", lead_ref: leadRef, booking: null }), { status: "multiple" }, "the mapper strips Lead fields from non-resolved statuses");
  assert.deepEqual(attachedForItem({ status: "resolved", lead_ref: leadRef }), {
    status: "resolved",
    lead_ref: leadRef,
    lead_progress: null,
    booking: null,
    outreach_state: null,
  });
});
