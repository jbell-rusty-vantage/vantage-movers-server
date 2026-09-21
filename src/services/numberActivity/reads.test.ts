import assert from "node:assert/strict";
import { test } from "node:test";
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
import {
  buildNumberSearchFilter,
  decodeNumberCursor,
  encodeNumberCursor,
  escapeRegex,
  numberSearchQuerySchema,
  parseSearchTerm,
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
  assert.deepEqual(buildNumberSearchFilter(query({ classification: "customer" }), null), { kind: "external", classification: "customer", purged_at: null });

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
