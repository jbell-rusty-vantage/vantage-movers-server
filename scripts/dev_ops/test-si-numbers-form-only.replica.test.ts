import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getSalesIntelligenceJobModel } from "../../src/models/salesIntelligence/infrastructure";
import { EMPTY_DIRECTORY_LOOKUP } from "../../src/services/numberActivity/directory";
import {
  buildNumberSearchFilter,
  buildSortedNumberSearchFilter,
  numberFilterHint,
  numberSearchQuerySchema,
  parseSearchTerm,
  searchNumberActivity,
  sortedNumberMongoSort,
  withResolvedHasCalls,
} from "../../src/services/numberActivity/search";
import { numberSearchPageDtoSchema } from "../../src/services/numberActivity/dto";
import { ensureFormLeadContactNumber } from "../../src/services/salesIntelligence/attachment/formLeadNumber";
import type { LeadSource } from "../../src/services/salesIntelligence/attachment/sources";
import { numberSearchSchema as adminNumberSearchSchema } from "./lib/si-contract-schemas";
import { renderStampReport, runStampFormCreatedNumbers } from "./lib/stamp-form-created-numbers";

/**
 * S5c-NUMBERS replica proof (reconciliation addendum §3.5; C21, C25).
 *
 * Seed: call-created Numbers (with calls; zero, null and missing counts), Form-created Numbers made by
 * the live writer `ensureFormLeadContactNumber` (so `created_via` + the create audit are real), "legacy"
 * form Numbers (created by the writer, then `created_via` unset: what the backfill wrote before G7),
 * one of which has had a call since, a zero-call Number with a Form Lead edge and no audit (fallback
 * basis), and a reused call Number. Duplicates, Bad Leads and no-phone Leads create nothing.
 *
 * Every DB write command is counted through driver command monitoring (`monitorCommands`).
 */
const enabled = process.env.CSI_REPLICA_TEST === "true";
const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n, 12));
const NOW = new Date("2026-09-24T15:00:00.000Z");
const WRITE_COMMANDS = new Set(["insert", "update", "delete", "findAndModify", "createIndexes", "create", "drop", "dropDatabase", "dropIndexes", "renameCollection"]);

const hasStage = (plan: unknown, stage: string): boolean =>
  Boolean(plan && typeof plan === "object" && ((plan as { stage?: string }).stage === stage ||
    Object.values(plan as object).some((v) => (Array.isArray(v) ? v.some((x) => hasStage(x, stage)) : hasStage(v, stage)))));
const indexNames = (plan: unknown): string[] => {
  if (!plan || typeof plan !== "object") return [];
  const own = (plan as { indexName?: string }).indexName;
  return [...(own ? [own] : []), ...Object.values(plan as object).flatMap((v) => (Array.isArray(v) ? v.flatMap(indexNames) : indexNames(v)))];
};

type Raw = Record<string, unknown> & { _id: mongoose.Types.ObjectId; last_activity_at: Date; rollups: Record<string, unknown> };
function rawNumber(i: number, interactions: number | null | undefined, extra: Record<string, unknown> = {}): Raw {
  const ten = `555031${String(i).padStart(4, "0")}`;
  const rollups: Record<string, unknown> = {
    inbound_total: 0, outbound_total: 0, human_conversations_total: 0, last_inbound_at: null, last_outbound_at: null,
    last_human_conversation_at: null, attached_lead_count: 0, candidate_lead_count: 0, open_outreach_count: 0,
    recordings_total: 0, conversations_analyzed_total: 0, last_analyzed_at: null, outreach_records_total: 0,
  };
  if (interactions !== undefined) rollups.interactions_total = interactions;
  return {
    _id: new mongoose.Types.ObjectId(), revision: 1, e164: `+1${ten}`, national_ten: ten, digits_reversed: `+1${ten}`.replace("+", "").split("").reverse().join(""),
    country: "US", kind: "external", classification: "unknown", contact_eligibility: { state: "allowed" }, provider_names: [],
    search_terms: ["formonly synthetic"], first_observed_at: day(i % 9), last_activity_at: day(10 + (i % 11)), rollups,
    running_summary: null, purged_at: null, createdAt: day(0), updatedAt: day(0), ...extra,
  };
}
const lead = (phone: string | null, ts: Date, extra: Partial<LeadSource> = {}): LeadSource =>
  ({ _id: new mongoose.Types.ObjectId(), timestamp: ts, normalized_phone_number: phone, duplicate: false, bad_lead: null, ...extra }) as LeadSource;

test("S5c-NUMBERS isolated replica proof (C21, C25)", { skip: !enabled, timeout: 600_000 }, async (t) => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(getMongoDatabaseName(), /^testvantagemovers_t3cnumbers[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  // Own connection with command monitoring; `connectMongo` reuses it through the shared cache.
  await mongoose.connect(process.env.MONGO_URI!, { dbName: getMongoDatabaseName(), monitorCommands: true, serverSelectionTimeoutMS: 5_000 });
  (globalThis as { __mongooseCache?: unknown }).__mongooseCache = { conn: mongoose, promise: Promise.resolve(mongoose) };
  const writes: string[] = [];
  let recording = false;
  mongoose.connection.getClient().on("commandStarted", (event) => {
    if (recording && WRITE_COMMANDS.has(event.commandName)) writes.push(`${event.commandName}:${String((event.command as Record<string, unknown>)[event.commandName])}`);
  });
  const recordWrites = async <T>(fn: () => Promise<T>): Promise<{ value: T; writes: string[] }> => {
    writes.length = 0;
    recording = true;
    try { return { value: await fn(), writes: [...writes] }; } finally { recording = false; }
  };
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  const Numbers = getContactNumberModel();
  const Jobs = getSalesIntelligenceJobModel();

  // ── Seed ──────────────────────────────────────────────────────────────────────────────────────
  const calls: Raw[] = [];
  for (let i = 0; i < 24; i += 1) calls.push(rawNumber(i, i % 6 === 0 ? 0 : i % 7 === 0 ? null : i % 11 === 0 ? undefined : 1 + (i % 4)));
  await Numbers.collection.insertMany([...calls, rawNumber(90, 3, { kind: "extension" }), rawNumber(91, 2, { purged_at: day(1) })] as never[]);
  const ensure = (l: LeadSource) => withTransaction((session) =>
    ensureFormLeadContactNumber(l, session, new mongoose.Types.ObjectId().toString(), NOW, { directory: EMPTY_DIRECTORY_LOOKUP }));
  const fresh: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const r = await ensure(lead(`20255510${String(i).padStart(2, "0")}`, day(12 + i)));
    assert.equal(r.action, "created");
    if (r.action === "created") fresh.push(r.number_id);
  }
  const legacy: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const r = await ensure(lead(`20255520${String(i).padStart(2, "0")}`, day(5 + i)));
    assert.equal(r.action, "created");
    if (r.action === "created") legacy.push(r.number_id);
  }
  // What the backfill wrote before G7: the create audit, no `created_via`. One has had a call since.
  await Numbers.collection.updateMany({ _id: { $in: legacy.map((id) => new mongoose.Types.ObjectId(id)) } }, { $unset: { created_via: "" } });
  await Numbers.collection.updateOne({ _id: new mongoose.Types.ObjectId(legacy[0]!) }, { $set: { "rollups.interactions_total": 2, last_activity_at: day(30) } });
  // Fallback basis: zero calls, a Form Lead edge, no create audit.
  const fallback = rawNumber(80, 0);
  await Numbers.collection.insertOne(fallback as never);
  await db.collection("number_lead_attachments").insertOne({ contact_number_id: fallback._id, lead_ref: { model: "FormLead", id: new mongoose.Types.ObjectId() },
    state: "attached", certainty: "exact", revision: 1, createdAt: day(0), updatedAt: day(0) });
  const numbersBeforeSkips = await Numbers.countDocuments({});
  // Reuse: a Form Lead on an existing call Number's phone leaves it untouched (still `call`).
  const reusedPhone = String(calls[1]!.national_ten);
  const reused = await ensure(lead(reusedPhone, day(3)));
  assert.equal(reused.action, "reused");
  const skipped = await Promise.all([
    ensure(lead("2025559900", day(1), { duplicate: true })),
    ensure(lead("2025559901", day(1), { bad_lead: "fake_info" })),
    ensure(lead(null, day(1))),
    ensure(lead("12", day(1))),
  ]);
  assert.deepEqual(skipped.map((s) => s.action === "skipped" ? s.reason : s.action), ["duplicate", "bad_lead", "no_phone", "no_phone"]);
  assert.equal(await Numbers.countDocuments({}), numbersBeforeSkips, "duplicates, Bad Leads and no-phone Leads create no Number");
  const reusedRow = await Numbers.collection.findOne({ _id: calls[1]!._id });
  assert.equal(reusedRow?.created_via, undefined, "a reused Number is not stamped");
  const freshRows = await Numbers.collection.find({ _id: { $in: fresh.map((id) => new mongoose.Types.ObjectId(id)) } }).toArray();
  assert.ok(freshRows.every((r) => r.created_via === "form_lead" && r.rollups.interactions_total === 0), "the writer sets form_lead on create, zero rollups");
  const jobsAtStart = await Jobs.countDocuments({});

  const allExternal = (await Numbers.collection.find({ kind: "external", purged_at: null }, { projection: { _id: 1, last_activity_at: 1, rollups: 1 } })
    .sort({ last_activity_at: -1, _id: -1 }).toArray()) as unknown as Raw[];
  const withCalls = allExternal.filter((r) => typeof r.rollups.interactions_total === "number" && (r.rollups.interactions_total as number) > 0);
  const ids = (rows: Raw[]) => rows.map((r) => String(r._id));
  t.diagnostic(`seeded ${allExternal.length} external Numbers; ${withCalls.length} with a call; fresh form ${fresh.length}, legacy form ${legacy.length}, fallback 1`);

  const search = (input: Record<string, unknown>, flagOn: boolean) =>
    searchNumberActivity(numberSearchQuerySchema.parse(input), { now: () => NOW, hasCallsDefault: flagOn });
  const pageAll = async (input: Record<string, unknown>, flagOn: boolean, limit = 3) => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 200; guard += 1) {
      const page = await search({ ...input, limit: String(limit), ...(cursor ? { cursor } : {}) }, flagOn);
      seen.push(...page.data.items.map((i) => i.id));
      cursor = page.data.cursor;
      if (!cursor) return seen;
    }
    throw new Error("pager did not terminate");
  };

  try {
    await t.test("C21: flag on hides form-only Numbers; include_form_only and explicit has_calls=false show them; echo + DTO fields", async () => {
      const on = await search({ limit: "200" }, true);
      assert.deepEqual(on.data.items.map((i) => i.id), ids(withCalls), "flag on: only Numbers with a call, historical order");
      for (const id of fresh) assert.ok(!on.data.items.some((i) => i.id === id), "a fresh form-only Number is hidden");
      assert.ok(on.data.items.some((i) => i.id === legacy[0]), "a form-created Number with a call since is listed");
      assert.deepEqual(on.data.filters, { has_calls: true });
      assert.ok(on.data.items.every((i) => i.has_calls === true));
      const lifted = await search({ limit: "200", include_form_only: "true" }, true);
      assert.deepEqual(lifted.data.items.map((i) => i.id), ids(allExternal), "include_form_only: every Number");
      assert.deepEqual(lifted.data.filters, { has_calls: false });
      assert.deepEqual((await search({ limit: "200", has_calls: "false" }, true)).data.items.map((i) => i.id), ids(allExternal));
      assert.deepEqual((await search({ limit: "200", has_calls: "true" }, false)).data.items.map((i) => i.id), ids(withCalls), "explicit true, flag off");
      const byId = new Map(lifted.data.items.map((i) => [i.id, i]));
      for (const id of fresh) assert.deepEqual([byId.get(id)!.created_via, byId.get(id)!.has_calls], ["form_lead", false]);
      assert.equal(byId.get(legacy[1]!)!.created_via, "call", "unstamped legacy form Number reads as call until S10-1");
      assert.equal(byId.get(String(calls[1]!._id))!.created_via, "call");
      assert.equal(byId.get(String(calls[0]!._id))!.has_calls, false, "zero count");
      assert.equal(byId.get(String(calls[7]!._id))!.has_calls, false, "null count");
      assert.equal(byId.get(String(calls[11]!._id))!.has_calls, false, "missing count");
      // Production Admin (vantage-admin@539a628 `numberSearchSchema`) parses flag-on and flag-off pages.
      for (const page of [on, lifted, await search({ limit: "200" }, false)]) {
        assert.equal(adminNumberSearchSchema.safeParse(page).success, true);
        numberSearchPageDtoSchema.parse(page);
      }
    });

    await t.test("C21: flag off is the base code's page (d57c4e2): same items, order, cursors; only created_via/has_calls added", async () => {
      const baseDir = process.env.SI_NUMBERS_BASE_DIR;
      assert.ok(baseDir, "runner extracts the base src");
      const base = (await import(pathToFileURL(resolve(baseDir, "src/services/numberActivity/search.ts")).href)) as {
        numberSearchQuerySchema: typeof numberSearchQuerySchema; searchNumberActivity: (q: unknown, deps: { now: () => Date }) => Promise<unknown>;
      };
      // Proof this is the base module, not the new one: the base query schema is strict and has no has_calls.
      assert.equal((base.numberSearchQuerySchema as unknown as { safeParse(v: unknown): { success: boolean } }).safeParse({ has_calls: "true" }).success, false);
      const strip = (page: unknown) => {
        const copy = JSON.parse(JSON.stringify(page)) as { data: { items: Array<Record<string, unknown>>; filters?: unknown } };
        assert.equal(copy.data.filters, undefined, "flag off, no param: no filters echo");
        for (const item of copy.data.items) {
          assert.ok("created_via" in item && "has_calls" in item);
          delete item.created_via;
          delete item.has_calls;
        }
        return copy;
      };
      let compared = 0;
      for (const input of [{}, { sort: "interactions", direction: "asc" }, { sort: "first_call" }, { q: "formonly" }, { sort: "last_human_conversation", direction: "desc" }]) {
        let cursor: string | null = null;
        for (let guard = 0; guard < 50; guard += 1) {
          const params: Record<string, unknown> = { ...input, limit: "4", ...(cursor ? { cursor } : {}) };
          const mine: Awaited<ReturnType<typeof search>> = await search(params, false);
          const theirs = await base.searchNumberActivity(base.numberSearchQuerySchema.parse(params), { now: () => NOW });
          assert.deepEqual(strip(mine), theirs, `${JSON.stringify(params)}`);
          compared += 1;
          cursor = mine.data.cursor;
          if (!cursor) break;
        }
      }
      t.diagnostic(`flag-off pages identical to base (modulo the two additive item fields): ${compared} pages`);
    });

    await t.test("C21: pagination with the flag on has no repeats or skips (legacy, interactions, first_call, last_call asc)", async () => {
      for (const input of [{}, { sort: "interactions", direction: "desc" }, { sort: "interactions", direction: "asc" }, { sort: "first_call" }, { sort: "last_call", direction: "asc" }]) {
        const seen = await pageAll(input, true);
        assert.equal(new Set(seen).size, seen.length, `${JSON.stringify(input)}: no repeats`);
        assert.deepEqual([...seen].sort(), ids(withCalls).sort(), `${JSON.stringify(input)}: exactly the Numbers with a call`);
        const lifted = await pageAll({ ...input, include_form_only: "true" }, true);
        assert.equal(new Set(lifted).size, lifted.length);
        assert.equal(lifted.length, allExternal.length);
      }
    });

    await t.test("explain: the has_calls default is index-served (kind_activity / kind_interactions), no blocking SORT", async () => {
      const shapes: Array<[Record<string, unknown>, string]> = [[{}, "contact_number_kind_activity"], [{ sort: "interactions" }, "contact_number_kind_interactions"],
        [{ sort: "interactions", direction: "asc" }, "contact_number_kind_interactions"], [{ sort: "first_call" }, "contact_number_kind_first_observed"]];
      for (const [input, index] of shapes) {
        const q = withResolvedHasCalls(numberSearchQuerySchema.parse(input), true);
        const hint = numberFilterHint(q, (q.sort ?? "last_activity"), parseSearchTerm(undefined));
        assert.equal(hint, index);
        const applied = { sort: q.sort ?? "last_activity", direction: q.direction ?? "desc" } as const;
        const cursor = q.sort
          ? Numbers.collection.find(buildSortedNumberSearchFilter(q, applied, "value", null)).sort(sortedNumberMongoSort(applied, "value"))
          : Numbers.collection.find(buildNumberSearchFilter(q, null)).sort({ last_activity_at: -1, _id: -1 });
        const plan = (await cursor.limit(51).hint(hint!).explain("executionStats")) as { queryPlanner: { winningPlan: unknown } };
        assert.equal(hasStage(plan.queryPlanner.winningPlan, "SORT"), false, `${JSON.stringify(input)} no SORT`);
        assert.deepEqual([...new Set(indexNames(plan.queryPlanner.winningPlan))], [index], JSON.stringify(input));
      }
      // Unhinted, the planner's own choice for the default shape (reported, not asserted: tiny collection).
      const unhinted = (await Numbers.collection.find(buildNumberSearchFilter(withResolvedHasCalls(numberSearchQuerySchema.parse({}), true), null))
        .sort({ last_activity_at: -1, _id: -1 }).limit(51).explain("queryPlanner")) as { queryPlanner: { winningPlan: unknown } };
      t.diagnostic(`unhinted default plan indexes: ${[...new Set(indexNames(unhinted.queryPlanner.winningPlan))].join(",")}; hinted: contact_number_kind_activity, no SORT`);
    });

    await t.test("C25 / S10-1: stamp dry run is write-free; apply (interrupted + resume) stamps; re-apply is a no-op; zero jobs", async () => {
      const dir = mkdtempSync(join(tmpdir(), "t3c-stamp-"));
      const opts = { database: getMongoDatabaseName(), checkpointPath: join(dir, "cp.json"), now: () => new Date() };
      const dry = await recordWrites(() => runStampFormCreatedNumbers({ ...opts, apply: false, jsonlPath: join(dir, "dry.jsonl"), pageSize: 5 }));
      assert.deepEqual(dry.writes, [], "dry run: zero DB write commands");
      const c = dry.value.counts;
      assert.equal(c.match_audit, 3);
      assert.equal(c.match_audit_has_calls_since, 1);
      assert.equal(c.already_stamped_audit, 4);
      assert.equal(c.match_fallback_zero_calls_form_edge, 1);
      assert.equal(c.fallback_reported_not_stamped, 1);
      assert.equal(c.would_stamp, 3);
      assert.equal(c.numbers_scanned, await Numbers.countDocuments({}));
      assert.deepEqual([dry.value.jobs.created_during_run, dry.value.jobs.touching_stamped], [0, 0]);
      assert.equal(await Numbers.countDocuments({ created_via: "form_lead" }), 4, "nothing stamped by the dry run");
      t.diagnostic(`dry run counts: ${JSON.stringify(c)}`);

      // Interrupted apply: the first 20 Numbers (by _id) only, then --resume finishes from the checkpoint.
      const first = await runStampFormCreatedNumbers({ ...opts, apply: true, jsonlPath: join(dir, "a1.jsonl"), pageSize: 5, limit: 20 });
      const cp = JSON.parse(readFileSync(opts.checkpointPath, "utf8")) as { after: string; done?: boolean };
      assert.equal(first.counts.numbers_scanned, 20);
      const resumed = await runStampFormCreatedNumbers({ ...opts, apply: true, resume: true, jsonlPath: join(dir, "a2.jsonl"), pageSize: 5 });
      assert.equal(resumed.resumed_from, cp.after);
      assert.equal(resumed.counts.numbers_scanned, await Numbers.countDocuments({}), "cumulative counts: every Number scanned once across both runs");
      assert.equal(resumed.counts.stamped, 3);
      const legacyRows = await Numbers.collection.find({ _id: { $in: legacy.map((id) => new mongoose.Types.ObjectId(id)) } }).toArray();
      assert.ok(legacyRows.every((r) => r.created_via === "form_lead"), "legacy form Numbers stamped");
      assert.equal((await Numbers.collection.findOne({ _id: fallback._id }))?.created_via, undefined, "fallback not stamped without --include-fallback");
      assert.equal(await Numbers.countDocuments({ created_via: "call" }), 0, "call Numbers stay absent (= call)");
      assert.equal(await Numbers.countDocuments({ created_via: "form_lead" }), 7);

      const again = await recordWrites(() => runStampFormCreatedNumbers({ ...opts, apply: true, jsonlPath: join(dir, "a3.jsonl"), pageSize: 5 }));
      assert.deepEqual(again.writes, [], "re-apply: zero DB write commands");
      assert.equal(again.value.counts.stamped ?? 0, 0);
      assert.equal(again.value.counts.already_stamped_audit, 7);

      const withFallback = await runStampFormCreatedNumbers({ ...opts, apply: true, includeFallback: true, jsonlPath: join(dir, "a4.jsonl"), pageSize: 5 });
      assert.equal(withFallback.counts.stamped, 1);
      assert.equal((await Numbers.collection.findOne({ _id: fallback._id }))?.created_via, "form_lead");
      assert.equal(await Jobs.countDocuments({}), jobsAtStart, "zero jobs created by the stamp (and no model calls: none can run without a job)");
      const report = renderStampReport(resumed, "replica", "stamp-form-created-numbers.ts --apply --resume");
      assert.match(report, /zero jobs, zero model calls/);
      assert.match(report, /\| `match_audit` \| 3 \|/);

      // After S10-1 the list reads the stamp.
      const page = await search({ limit: "200", include_form_only: "true" }, true);
      assert.equal(page.data.items.find((i) => i.id === legacy[1])!.created_via, "form_lead");
    });
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
});
