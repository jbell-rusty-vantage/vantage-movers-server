import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import {
  buildSortedNumberSearchFilter,
  mongoNumberRowSource,
  NUMBER_SORT_CANDIDATE_CAP,
  NUMBER_SORT_FIELDS,
  NUMBER_SORT_INDEXES,
  numberFilterHint,
  numberSearchQuerySchema,
  pageNumberSearch,
  parseSearchTerm,
  searchNumberActivity,
  sortedNumberMongoSort,
  type NumberSortCursor,
} from "../../src/services/numberActivity/search";
import type { NumberSearchSort } from "../../src/services/numberActivity/dto";

/**
 * S2-NUMBERS replica proof (data spec §4.2, acceptance B9). 130 external
 * Numbers with interaction counts that tie, are zero, are null or are missing;
 * every sort x direction is paged at limit 7 through `searchNumberActivity`
 * (the route's read, DTO-parsed) and the concatenation must equal the full
 * expected order with no repeat or skip across the value and null segments.
 */
const enabled = process.env.CSI_REPLICA_TEST === "true";
const N = 130;
const day = (n: number) => new Date(Date.UTC(2026, 7, 1 + n, 12));

type Seed = Record<string, unknown> & { _id: mongoose.Types.ObjectId; rollups: Record<string, unknown> };

/** Deterministic, with ties everywhere. `undefined` = key missing. */
function interactionsFor(i: number): number | null | undefined {
  if (i % 13 === 0) return undefined;
  if (i % 11 === 0) return null;
  return (i * 7) % 9; // 0..8: zeros and many ties
}

function seedRows(): Seed[] {
  return Array.from({ length: N }, (_, i) => {
    const rollups: Record<string, unknown> = {
      inbound_total: 1,
      outbound_total: 0,
      human_conversations_total: 0,
      last_inbound_at: null,
      last_outbound_at: null,
      last_human_conversation_at: null,
      attached_lead_count: 0,
      candidate_lead_count: 0,
      open_outreach_count: 0,
      recordings_total: i % 3 === 0 ? 2 : 0,
      conversations_analyzed_total: i % 6 === 0 ? 1 : 0,
      last_analyzed_at: i % 6 === 0 ? day(i % 20) : null,
      outreach_records_total: i % 5 === 0 ? 1 : 0,
    };
    const n = interactionsFor(i);
    if (n !== undefined) rollups.interactions_total = n;
    if (i % 17 === 0) delete rollups.recordings_total; // pre-sweep row
    const ten = `555017${String(i).padStart(4, "0")}`;
    return {
      _id: new mongoose.Types.ObjectId(),
      revision: 1,
      e164: `+1${ten}`,
      national_ten: ten,
      digits_reversed: ten.split("").reverse().join("") + "1",
      kind: "external",
      classification: "unknown",
      contact_eligibility: { state: "allowed" },
      provider_names: [],
      search_terms: ["s2numbers synthetic"],
      first_observed_at: day(i % 10),
      last_activity_at: day(30 + (i % 8)),
      rollups,
      running_summary: null,
      purged_at: null,
      createdAt: day(0),
      updatedAt: day(0),
    };
  });
}

const valueAt = (row: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), row);
const num = (v: unknown) => (v instanceof Date ? v.getTime() : (v as number));

function expected(rows: Seed[], sort: NumberSearchSort, direction: "asc" | "desc", keep: (r: Seed) => boolean = () => true): string[] {
  const field = NUMBER_SORT_FIELDS[sort];
  const dir = direction === "desc" ? -1 : 1;
  const byId = (a: Seed, b: Seed) => dir * (String(a._id) < String(b._id) ? -1 : String(a._id) > String(b._id) ? 1 : 0);
  const live = rows.filter(keep);
  const valued = live.filter((r) => valueAt(r, field) != null).sort((a, b) => dir * (num(valueAt(a, field)) - num(valueAt(b, field))) || byId(a, b));
  const empty = live.filter((r) => valueAt(r, field) == null).sort(byId);
  return [...valued, ...empty].map((r) => String(r._id));
}

const hasStage = (plan: unknown, stage: string): boolean =>
  Boolean(
    plan &&
      typeof plan === "object" &&
      ((plan as { stage?: string }).stage === stage ||
        Object.values(plan as object).some((v) => (Array.isArray(v) ? v.some((x) => hasStage(x, stage)) : hasStage(v, stage)))),
  );
const indexNames = (plan: unknown): string[] => {
  if (!plan || typeof plan !== "object") return [];
  const own = (plan as { indexName?: string }).indexName;
  return [...(own ? [own] : []), ...Object.values(plan as object).flatMap((v) => (Array.isArray(v) ? v.flatMap(indexNames) : indexNames(v)))];
};

test("S2-NUMBERS isolated replica proof (B9)", { skip: !enabled, timeout: 240_000 }, async (t) => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(getMongoDatabaseName(), /^testvantagemovers_s2numbers[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  const ContactNumber = getContactNumberModel();
  const indexes = (await ContactNumber.collection.indexes()).map((i) => i.name);
  assert.ok(indexes.includes("contact_number_kind_interactions"), "migration built the interactions index");

  const rows = seedRows();
  // Raw insert: Mongoose defaults would turn missing/null counts into 0.
  await ContactNumber.collection.insertMany(rows as never[]);
  await ContactNumber.collection.insertMany([
    { ...rows[1]!, _id: new mongoose.Types.ObjectId(), e164: "+15550179998", kind: "extension" },
    { ...rows[2]!, _id: new mongoose.Types.ObjectId(), e164: "+15550179999", purged_at: day(1) },
  ] as never[]);
  const counts = {
    missing: rows.filter((r) => !("interactions_total" in r.rollups)).length,
    null: rows.filter((r) => r.rollups.interactions_total === null).length,
    zero: rows.filter((r) => r.rollups.interactions_total === 0).length,
  };
  assert.ok(counts.missing >= 5 && counts.null >= 5 && counts.zero >= 5, JSON.stringify(counts));
  t.diagnostic(`seeded ${N} external Numbers (+2 decoys); interactions missing=${counts.missing} null=${counts.null} zero=${counts.zero}`);

  const pageThrough = async (input: Record<string, unknown>, limit: number) => {
    const seen: string[] = [];
    const cursors: NumberSortCursor[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 200; guard += 1) {
      // String values, as the route's `req.query` delivers them.
      const q = numberSearchQuerySchema.parse({ ...input, limit: String(limit), ...(cursor ? { cursor } : {}) });
      const page = await searchNumberActivity(q);
      assert.equal(page.data.sort?.sort, input.sort, "the page echoes the requested sort name");
      for (const item of page.data.items) {
        assert.equal(typeof item.rollups.recordings_total, "number");
        assert.equal(typeof item.rollups.outreach_records_total, "number");
        assert.equal(typeof item.rollups.conversations_analyzed_total, "number");
        assert.ok(item.rollups.last_analyzed_at === null || typeof item.rollups.last_analyzed_at === "string");
      }
      seen.push(...page.data.items.map((i) => i.id));
      cursor = page.data.cursor;
      if (!cursor) return { seen, cursors };
      cursors.push(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as NumberSortCursor);
    }
    throw new Error("pager did not terminate");
  };

  try {
    await t.test("B9: interactions desc/asc at limit 7 concatenate to the full order, value then null segment, no repeat or skip", async () => {
      for (const direction of ["desc", "asc"] as const) {
        const want = expected(rows, "interactions", direction);
        assert.equal(want.length, N);
        const { seen, cursors } = await pageThrough({ sort: "interactions", direction }, 7);
        assert.equal(new Set(seen).size, seen.length, `${direction}: no repeats`);
        assert.deepEqual(seen, want, `${direction}: exact order, no skips`);
        const segments = cursors.map((c) => c.segment);
        assert.ok(segments.includes("value") && segments.includes("null"), "paging crossed from the value into the null segment");
        assert.equal(segments.indexOf("null"), segments.lastIndexOf("value") + 1, "value cursors, then null cursors");
        for (const c of cursors) {
          assert.equal(c.sort, "interactions");
          if (c.segment === "value") assert.equal(typeof c.value, "number");
        }
        const tail = seen.slice(-(counts.missing + counts.null)).map((id) => rows.find((r) => String(r._id) === id)!.rollups.interactions_total ?? null);
        assert.ok(tail.every((v) => v === null), "null and missing are last in both directions");
        t.diagnostic(`interactions ${direction}: ${seen.length} rows over ${cursors.length + 1} pages`);
      }
    });

    await t.test("B9: last_call and first_call (and their canonical names) page exactly at limit 7, cursors cross names", async () => {
      for (const [alias, canonical] of [["last_call", "last_activity"], ["first_call", "first_observed"]] as const) {
        for (const direction of ["desc", "asc"] as const) {
          const want = expected(rows, canonical, direction);
          const a = await pageThrough({ sort: alias, direction }, 7);
          assert.equal(new Set(a.seen).size, N);
          assert.deepEqual(a.seen, want, `${alias} ${direction}`);
          assert.ok(a.cursors.every((c) => c.sort === canonical && typeof c.value === "string"));
          // Mint under the alias, continue under the canonical name.
          const q1 = numberSearchQuerySchema.parse({ sort: alias, direction, limit: "7" });
          const p1 = await searchNumberActivity(q1);
          const q2 = numberSearchQuerySchema.parse({ sort: canonical, direction, limit: "7", cursor: p1.data.cursor! });
          const p2 = await searchNumberActivity(q2);
          assert.deepEqual(p2.data.items.map((i) => i.id), want.slice(7, 14));
        }
      }
    });

    await t.test("filters: has_recording / has_outreach narrow every sort exactly; missing recordings_total never matches", async () => {
      const hasRec = (r: Seed) => ((r.rollups.recordings_total as number | undefined) ?? 0) > 0;
      const hasOut = (r: Seed) => ((r.rollups.outreach_records_total as number | undefined) ?? 0) > 0;
      for (const [input, keep] of [
        [{ has_recording: "true" }, hasRec],
        [{ has_outreach: "true" }, hasOut],
        [{ has_recording: "true", has_outreach: "true" }, (r: Seed) => hasRec(r) && hasOut(r)],
        [{ has_recording: "false", has_outreach: "false" }, () => true],
      ] as const) {
        for (const sort of ["interactions", "last_call", "first_call"] as const) {
          for (const direction of ["desc", "asc"] as const) {
            const want = expected(rows, sort, direction, keep);
            const { seen } = await pageThrough({ ...input, sort, direction }, 7);
            assert.deepEqual(seen, want, `${JSON.stringify(input)} ${sort} ${direction}`);
          }
        }
        t.diagnostic(`${JSON.stringify(input)} -> ${rows.filter(keep).length} Numbers`);
      }
      // Historical request (no sort) honours the filters too.
      const legacy = await searchNumberActivity(numberSearchQuerySchema.parse({ has_recording: "true", limit: "200" }));
      assert.deepEqual(legacy.data.items.map((i) => i.id), expected(rows, "last_activity", "desc", hasRec));
      // A filtered cursor does not continue an unfiltered listing.
      const f1 = await searchNumberActivity(numberSearchQuerySchema.parse({ sort: "interactions", has_outreach: "true", limit: "3" }));
      await assert.rejects(
        searchNumberActivity(numberSearchQuerySchema.parse({ sort: "interactions", limit: "3", cursor: f1.data.cursor! })),
        (e: unknown) => (e as { code?: string }).code === "INVALID_INPUT",
      );
    });

    await t.test("hint above the q candidate cap keeps the interactions order on the real index", async () => {
      const real = mongoNumberRowSource();
      const forced = { find: real.find, count: async () => NUMBER_SORT_CANDIDATE_CAP + 1 };
      for (const direction of ["desc", "asc"] as const) {
        const seen: string[] = [];
        let cursor: string | undefined;
        for (let guard = 0; guard < 40; guard += 1) {
          const sq = numberSearchQuerySchema.parse({ sort: "interactions", direction, q: "s2numbers", limit: 7, ...(cursor ? { cursor } : {}) });
          const result = await pageNumberSearch(sq, parseSearchTerm(sq.q), forced);
          assert.equal(result.hint, NUMBER_SORT_INDEXES.interactions);
          seen.push(...result.page.map((r) => String(r._id)));
          if (!result.next) break;
          cursor = result.next;
        }
        assert.deepEqual(seen, expected(rows, "interactions", direction), `hinted ${direction}`);
      }
    });

    await t.test("explain: interactions value segment uses contact_number_kind_interactions with no blocking SORT (both directions, with filters)", async () => {
      for (const input of [{}, { has_recording: "true" }, { has_outreach: "true", has_recording: "true" }]) {
        for (const direction of ["desc", "asc"] as const) {
          const q = numberSearchQuerySchema.parse({ sort: "interactions", direction, ...input });
          const applied = { sort: "interactions", direction } as const;
          // Exactly the hint the pager passes for this request (none when unfiltered).
          const hint = numberFilterHint(q, "interactions", parseSearchTerm(q.q));
          assert.equal(hint, Object.keys(input).length ? "contact_number_kind_interactions" : undefined);
          for (const position of [null, { segment: "value" as const, value: 4, id: String(rows[40]!._id) }]) {
            const cursor = ContactNumber.collection
              .find(buildSortedNumberSearchFilter(q, applied, "value", position))
              .sort(sortedNumberMongoSort(applied, "value"))
              .limit(8);
            if (hint) cursor.hint(hint);
            const plan = (await cursor.explain("executionStats")) as { queryPlanner: { winningPlan: unknown } };
            const winning = plan.queryPlanner.winningPlan;
            assert.equal(hasStage(winning, "SORT"), false, `${JSON.stringify(input)} ${direction}: no in-memory SORT ${JSON.stringify(winning)}`);
            assert.deepEqual([...new Set(indexNames(winning))], ["contact_number_kind_interactions"], `${JSON.stringify(input)} ${direction}`);
          }
        }
      }
      for (const [sort, index] of [["last_call", "contact_number_kind_activity"], ["first_call", "contact_number_kind_first_observed"]] as const) {
        for (const direction of ["desc", "asc"] as const) {
          const q = numberSearchQuerySchema.parse({ sort, direction });
          const applied = { sort, direction };
          const plan = (await ContactNumber.collection
            .find(buildSortedNumberSearchFilter(q, applied, "value", null))
            .sort(sortedNumberMongoSort(applied, "value"))
            .limit(8)
            .explain("executionStats")) as { queryPlanner: { winningPlan: unknown } };
          assert.equal(hasStage(plan.queryPlanner.winningPlan, "SORT"), false, `${sort} ${direction}`);
          assert.ok(indexNames(plan.queryPlanner.winningPlan).includes(index), `${sort} ${direction} on ${index}`);
          // Filtered and positioned: the pager's hint keeps the same index and no SORT.
          const fq = numberSearchQuerySchema.parse({ sort, direction, has_recording: "true", has_outreach: "true" });
          const hint = numberFilterHint(fq, sort, parseSearchTerm(undefined));
          assert.equal(hint, index);
          const fplan = (await ContactNumber.collection
            .find(buildSortedNumberSearchFilter(fq, applied, "value", { segment: "value", value: day(33).toISOString(), id: String(rows[40]!._id) }))
            .sort(sortedNumberMongoSort(applied, "value"))
            .limit(8)
            .hint(hint!)
            .explain("executionStats")) as { queryPlanner: { winningPlan: unknown } };
          assert.equal(hasStage(fplan.queryPlanner.winningPlan, "SORT"), false, `filtered ${sort} ${direction}`);
          assert.deepEqual([...new Set(indexNames(fplan.queryPlanner.winningPlan))], [index]);
        }
      }
      t.diagnostic("explain: interactions value segment IXSCAN contact_number_kind_interactions, no SORT stage (6 shapes x 2 positions)");
    });
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
});
