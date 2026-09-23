import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { z } from "zod";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getNumberTimeline } from "../../src/services/numberActivity/timeline";
import { timelineV2PageDtoSchema, type TimelineV2EventDto } from "../../src/services/numberActivity/dto";
import { readNumberTimelineV2, readOutreachTimeline } from "../../src/services/salesIntelligence/outreach/timelineRead";
import { compareTimelineOrder } from "../../src/services/salesIntelligence/story/sources";
import { S4_AS_OF, S4_IDS, seedS4Timeline } from "./lib/si-timeline-seed";

/**
 * S4-TIMELINE replica proof (runner: `scripts/dev_ops/test-si-timeline.ts`).
 *
 * Mode `seed` (default, `testvantagemovers_s4timeline`): drops, migrates and seeds the deterministic
 * S4 data, then proves B12 (cursor exactness over every source, slack sources with out-of-order times),
 * B13 (Priority pairing), the three reader fixes, D4, D6, the kinds filter and both DTO shapes.
 * Mode `finalui` (`SI_TIMELINE_MODE=finalui`, read only): repeats B12 on the S0 seed subjects that carry
 * `timeline_300` / `calls_50`.
 */
const enabled = process.env.CSI_REPLICA_TEST === "true";
const mode = process.env.SI_TIMELINE_MODE === "finalui" ? "finalui" : "seed";
/** The S4 seed reads at its fixed `as_of`; the S0 seed is relative to its own seed time, so it reads at the run time. */
const asOf = mode === "finalui" ? new Date() : S4_AS_OF;
const now = () => asOf;
const coverage = { known_through: asOf.toISOString(), gaps: [], capabilities: {}, ai_paused: false };

type Reader = (cursor: string | undefined, limit: number) => Promise<{ items: TimelineV2EventDto[]; cursor: string | null } | null>;
async function pageAll(read: Reader, limit: number) {
  const items: TimelineV2EventDto[] = [];
  let cursor: string | undefined;
  let pages = 0;
  for (;;) {
    const page = await read(cursor, limit);
    assert.ok(page, "subject resolves");
    assert.ok(page.items.length <= limit);
    items.push(...page.items);
    pages++;
    if (!page.cursor) break;
    assert.equal(page.items.length, limit, "a page with a cursor is full");
    cursor = page.cursor;
    assert.ok(pages < 2000, "terminates");
  }
  return { items, pages };
}
const ids = (items: TimelineV2EventDto[]) => items.map(e => `${e.kind}:${e.id}`);
const countBy = (items: TimelineV2EventDto[]) => items.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {});

/** B12: the concatenation at `limit=7` equals the list read in pages of 200; no repeats, total order. */
async function assertExact(label: string, read: Reader, minimum: number) {
  const big = await pageAll(read, 200);
  const small = await pageAll(read, 7);
  assert.ok(big.items.length >= minimum, `${label}: ${big.items.length} events, expected ≥ ${minimum}`);
  assert.equal(new Set(ids(big.items)).size, big.items.length, `${label}: no repeats`);
  assert.deepEqual(ids(small.items), ids(big.items), `${label}: limit 7 concatenation equals the pages of 200`);
  for (let i = 1; i < big.items.length; i++) assert.ok(compareTimelineOrder(big.items[i - 1]!, big.items[i]!) < 0, `${label}: strictly ordered at ${i}`);
  return big.items;
}

/** The production admin's `timelineSchema` shape (`vantage-admin/lib/api/salesIntelligence.ts`, admin 539a628). */
const adminTimelineSchema = z.object({ as_of: z.string(), coverage: z.object({ known_through: z.string().nullable(), gaps: z.array(z.object({ from: z.string(), to: z.string(), reason: z.string() })), ai_paused: z.boolean() }),
  data: z.object({ number_id: z.string(), items: z.array(z.object({ id: z.string(), kind: z.string(), happened_at: z.string(), observed_at: z.string(), description: z.string(),
    evidence_refs: z.array(z.string()), detail: z.record(z.string(), z.json()) })), cursor: z.string().nullable() }) });

test("S4-TIMELINE replica proof", { skip: !enabled, timeout: 900_000 }, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(getMongoDatabaseName(), /^testvantagemovers_[a-z0-9]+$/);
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  const numberReader = (id: string, kinds: string[] | null = null): Reader => (cursor, limit) => readNumberTimelineV2(id, { cursor, limit, kinds }, { now, coverage }).then(page => page?.data ?? null);
  const outreachReader = (id: string, kinds: string[] | null = null): Reader => (cursor, limit) => readOutreachTimeline(id, { cursor, limit, kinds }, { now, coverage }).then(page => page?.data ?? null);

  if (mode === "finalui") {
    const rows = await db.collection("si_seed_manifest").find({ states: { $in: ["timeline_300", "calls_50"] } }).toArray();
    assert.ok(rows.length >= 2, "the S0 seed carries timeline_300 and calls_50 subjects");
    for (const row of rows) {
      const label = String(row.label);
      await t.test(`B12 final-UI ${label}: Number and Outreach scopes`, async () => {
        const all = await assertExact(`${label} number`, numberReader(String(row.contact_number_id)), row.states.includes("timeline_300") ? 300 : 50);
        console.log(`# ${label} number scope: ${all.length} events ${JSON.stringify(countBy(all))}`);
        if (row.outreach_record_id) {
          const scoped = await assertExact(`${label} outreach`, outreachReader(String(row.outreach_record_id)), 50);
          console.log(`# ${label} outreach scope: ${scoped.length} events`);
        }
        const calls = await assertExact(`${label} calls`, numberReader(String(row.contact_number_id), ["call"]), 50);
        assert.ok(calls.every(e => e.kind === "call"));
      });
    }
    await mongoose.disconnect();
    return;
  }

  await db.dropDatabase();
  const migration = await applyCsiMigration();
  assert.ok(migration.ready, "CSI index inventory applied");
  const counts = await seedS4Timeline(db);
  console.log(`# seeded ${JSON.stringify(counts)}`);
  const n1 = String(S4_IDS.n1), recordA = String(S4_IDS.recordA);
  let n1Events: TimelineV2EventDto[] = [];

  await t.test("B12 Number scope: ≥ 300 mixed events, every source, limit 7 = pages of 200", async () => {
    n1Events = await assertExact("N1", numberReader(n1), 300);
    const byKind = countBy(n1Events);
    console.log(`# N1 ${n1Events.length} events ${JSON.stringify(byKind)}`);
    for (const kind of ["lead_received", "call_qualified", "call", "conversation_analyzed", "conversation_recorded", "assessment_published", "granot_priority_changed",
      "quoted_changed", "granot_observed", "number_attached", "followup_created", "followup_completed", "followup_cancelled", "followup_superseded", "assigned", "owner_note",
      "closed", "reopened", "waiting_set", "review_opened", "review_resolved", "restriction_set", "nudge_sent", "followup_snoozed", "call_started", "call_ended",
      "analysis_submitted", "owner_correction", "booking_recorded", "cancellation_recorded", "lead_message_sent"]) assert.ok((byKind[kind] ?? 0) > 0, `kind ${kind} present`);
    // Independent counts from the source collections.
    assert.equal(byKind.call, await db.collection("call_interactions").countDocuments({ contact_number_id: S4_IDS.n1, merged_into_id: null, purged_at: null }));
    const messages = await db.collection("lead_messages").countDocuments({ $or: [{ to: { $in: ["+13055550101", "3055550101", "13055550101"] } },
      { "lead_ref.id": { $in: [S4_IDS.leadA, S4_IDS.leadB] } }] });
    assert.equal(byKind.lead_message_sent, messages);
    assert.equal(byKind.followup_created, await db.collection("outreach_followups").countDocuments({ outreach_record_id: { $in: [S4_IDS.recordA, S4_IDS.recordB] } }));
    assert.equal(byKind.conversation_recorded, 1, "only the standalone conversation; the others fold into their call");
    assert.equal(byKind.lead_received, 2, "the rejected Lead is not in scope");
    assert.ok(n1Events.some(e => e.kind === "number_attached" && e.detail.state === "rejected"), "the rejection itself is an event");
  });

  await t.test("B12 Outreach scope and kinds[]=call (Calls tab)", async () => {
    const scoped = await assertExact("record A", outreachReader(recordA), 150);
    const byKind = countBy(scoped);
    assert.equal(byKind.lead_received, 1);
    assert.equal(byKind.call, countBy(n1Events).call, "the primary Number's calls");
    assert.ok(!scoped.some(e => e.subject_key === `lead:CallLead:${S4_IDS.leadB}` && e.kind === "followup_created"), "Lead B's work is not on Lead A's record");
    assert.ok(scoped.every(e => e.job_no === null), "scope outreach never prefixes a Job");
    const calls = await assertExact("N1 calls", numberReader(n1, ["call"]), 100);
    assert.deepEqual(ids(calls), ids(n1Events.filter(e => e.kind === "call")), "the Calls tab is the call subsequence of the timeline");
    const mixed = await assertExact("N1 messages+changes", numberReader(n1, ["lead_message_sent", "granot_priority_changed", "quoted_changed"]), 50);
    assert.deepEqual(ids(mixed), ids(n1Events.filter(e => ["lead_message_sent", "granot_priority_changed", "quoted_changed"].includes(e.kind))));
    const leadOnly = await pageAll(outreachReader(String(S4_IDS.recordL)), 7);
    assert.ok(leadOnly.items.some(e => e.kind === "lead_message_sent") && leadOnly.items.every(e => e.kind !== "call"), "a Lead-only record reads its Lead's messages, no calls");
  });

  await t.test("B13: paired Priority change shows captured_at / applied_at; unpaired shows applied_at twice", async () => {
    const paired = n1Events.find(e => e.id === `granot_priority_changed:${S4_IDS.pairedChange}`)!;
    const unpaired = n1Events.find(e => e.id === `granot_priority_changed:${S4_IDS.unpairedChange}`)!;
    const change = await db.collection("entity_changes").findOne({ _id: S4_IDS.pairedChange });
    const observation = await db.collection("granot_observations").findOne({ _id: S4_IDS.pairedObservation });
    assert.equal(paired.happened_at, (observation!.captured_at as Date).toISOString());
    assert.equal(paired.observed_at, (change!.applied_at as Date).toISOString());
    assert.equal(paired.recorded_late, true, "applied 3 h 12 min after capture");
    const unpairedRow = await db.collection("entity_changes").findOne({ _id: S4_IDS.unpairedChange });
    assert.equal(unpaired.happened_at, (unpairedRow!.applied_at as Date).toISOString());
    assert.equal(unpaired.observed_at, unpaired.happened_at);
    assert.equal(unpaired.recorded_late, false);
    assert.match(paired.title, /^Granot Priority \d/);
  });

  await t.test("reader fixes: audit-timed cancel, undated Booking; D6 first_observed_at; chips and actions", async () => {
    const cancelled = n1Events.find(e => e.id === `followup_cancelled:${S4_IDS.cancelledFollowupWithAudit}`)!;
    const audit = await db.collection("sales_intelligence_audit_events").findOne({ _id: S4_IDS.cancelAudit });
    assert.equal(cancelled.happened_at, (audit!.happened_at as Date).toISOString(), "timed by the audit row, not updatedAt");
    const noAudit = n1Events.find(e => e.kind === "followup_cancelled" && e.detail.followup_id === String(new mongoose.Types.ObjectId(`f2${(9).toString(16).padStart(22, "0")}`)));
    if (noAudit) {
      const row = await db.collection("outreach_followups").findOne({ _id: new mongoose.Types.ObjectId(String(noAudit.detail.followup_id)) });
      assert.equal(noAudit.happened_at, (row!.updatedAt as Date).toISOString(), "no audit row: updatedAt fallback");
    }
    const undated = n1Events.find(e => e.id === `booking_recorded:${S4_IDS.bookingNoDate}`)!;
    assert.ok(undated, "a Booking with a null book_date is on the timeline");
    assert.equal(undated.happened_at, undated.observed_at);
    assert.equal(undated.recorded_late, false);
    assert.equal(undated.detail.book_date_missing, true);
    assert.equal(undated.title, "Booked · binder $800 · Marcus Bell");
    for (const call of n1Events.filter(e => e.kind === "call").slice(0, 40)) {
      const row = await db.collection("call_interactions").findOne({ _id: new mongoose.Types.ObjectId(call.call!.interaction_id) });
      assert.equal(call.observed_at, (row!.first_observed_at as Date).toISOString(), "D6: observed_at = first_observed_at");
      assert.equal(call.recorded_late, +row!.first_observed_at - +row!.started_at > 3_600_000);
      assert.equal(call.chips.includes("Recording"), (row!.recordings as unknown[]).length > 0);
    }
    const analyzed = n1Events.find(e => e.kind === "call" && e.call?.recording_state === "analyzed")!;
    assert.ok(analyzed.chips.includes("Analyzed"));
    assert.equal(analyzed.action?.kind, "open_conversation");
    const reviewed = n1Events.find(e => e.kind === "call" && e.call?.rep?.status === "reviewed")!;
    assert.equal(reviewed.call?.rep?.name, "Dana Reyes");
    const proposed = n1Events.find(e => e.kind === "call" && e.call?.rep?.status === "proposed")!;
    assert.equal(proposed.call?.rep?.name, null, "no name before review");
    const lead = n1Events.find(e => e.kind === "lead_received" && e.subject_key === `lead:FormLead:${S4_IDS.leadA}`)!;
    assert.equal(lead.job_no, "5590101", "multi-Lead Number: Job prefix");
    assert.ok(n1Events.filter(e => e.routine).every(e => ["conversation_recorded", "granot_observed", "analysis_submitted"].includes(e.kind)));
  });

  await t.test("D4: the legacy conversation scan stays on by default and can be turned off", async () => {
    const legacyId = String(S4_IDS.legacyConversation);
    const readAll = async (legacyConversations?: boolean) => {
      const out: string[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await getNumberTimeline(n1, { cursor, limit: 200 }, { coverage, ...(legacyConversations === undefined ? {} : { legacyConversations }) });
        out.push(...page!.data.items.filter(e => e.kind === "conversation").map(e => e.id));
        if (!page!.data.cursor) return out;
        cursor = page!.data.cursor;
      }
    };
    const byDefault = await readAll(), on = await readAll(true), off = await readAll(false);
    assert.ok(byDefault.includes(legacyId), "default: fallback on (current behaviour)");
    assert.deepEqual(byDefault, on);
    assert.ok(!off.includes(legacyId), "gate off: no legacy scan");
    assert.equal(on.length - off.length, 1);
  });

  await t.test("DTO shapes: v1 unchanged for the admin; v2 still parses with the admin's timelineSchema", async () => {
    const v1 = await getNumberTimeline(n1, { limit: 50 }, { coverage, now });
    assert.doesNotThrow(() => adminTimelineSchema.parse(JSON.parse(JSON.stringify(v1))));
    assert.ok(v1!.data.items.every(e => ["interaction", "lead_message", "conversation", "owner_note", "assignment", "restriction", "review", "nudge", "followup"].includes(e.kind)),
      "flag off keeps the v1 kinds");
    const v2 = await readNumberTimelineV2(n1, { limit: 50 }, { now, coverage });
    assert.doesNotThrow(() => timelineV2PageDtoSchema.parse(v2));
    assert.doesNotThrow(() => adminTimelineSchema.parse(JSON.parse(JSON.stringify(v2))));
    assert.equal(v2!.data.number_id, n1);
    assert.deepEqual(v2!.data.coverage.truncated_sources, []);
    assert.equal(await readNumberTimelineV2(String(new mongoose.Types.ObjectId()), {}, { now, coverage }), null);
    assert.equal(await readOutreachTimeline("not-an-id", {}, { now, coverage }), null);
  });

  await t.test("bounded reads: a deep page issues no more queries than the first", async () => {
    let queries = 0;
    mongoose.set("debug", () => { queries++; });
    try {
      const first = await readNumberTimelineV2(n1, { limit: 50 }, { now, coverage });
      const firstQueries = queries;
      queries = 0;
      let cursor = first!.data.cursor!;
      for (let i = 0; i < 3; i++) cursor = (await readNumberTimelineV2(n1, { limit: 50, cursor }, { now, coverage }))!.data.cursor!;
      queries = 0;
      await readNumberTimelineV2(n1, { limit: 50, cursor }, { now, coverage });
      console.log(`# mongoose operations: first page ${firstQueries}, fifth page ${queries}`);
      assert.ok(queries <= firstQueries + 6, `deep page ${queries} vs first ${firstQueries}`);
      assert.ok(firstQueries < 60, "no per-event query");
    } finally { mongoose.set("debug", false); }
  });

  await mongoose.disconnect();
});
