import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getSalesIntelligenceAttentionSnapshotModel } from "../../src/models/SalesIntelligenceAttentionSnapshot";
import { ensureLead, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { attentionMetrics, publishAttentionSnapshot, readAttention } from "../../src/services/salesIntelligence/outreach/attention";
import { decodeAttentionIndex } from "../../src/services/salesIntelligence/outreach/attentionIndex";
import { attentionSchema as adminAttentionSchema } from "../../src/services/salesIntelligence/outreach/attention.adminSchema.fixture";
import type { AttentionRowDto } from "../../src/services/salesIntelligence/dto";

/**
 * S2-DESK (data spec §3.4–§3.7, acceptance B6/B7): publish → read on the replica
 * with SALES_INTELLIGENCE_ATTENTION_V2 off and on. Off must be today's desk for
 * the production Admin (its schema parses every response and no closed row reaches
 * the default or all-Outreach views); on adds the closed partition, header metrics
 * and the index array, and the read materializes only the page.
 */
const DAY = 86_400_000;
type Read = Awaited<ReturnType<typeof readAttention>>;

test("S2-DESK disposable replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300_000 }, async (t) => {
  assert.equal(getMongoDatabaseName(), "testvantagemovers_s2desk");
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await db.dropDatabase();
  await applyCsiMigration();
  const oid = () => new mongoose.Types.ObjectId();
  const Records = getOutreachRecordModel();
  const Snapshots = getSalesIntelligenceAttentionSnapshotModel();
  const now = Date.now();

  /** One Form Lead subject created through `ensureLead`; a Booking (and Cancellation) written first closes it officially at `closeAt`. */
  async function subject(i: number, options: { receivedAgo: number; booking?: { afterMs: number; cancelAfterMs?: number }; closeAfterMs?: number }) {
    const timestamp = new Date(now - options.receivedAgo);
    const lead = { _id: oid(), timestamp, createdAt: timestamp, updatedAt: timestamp, name: `Synthetic S2 ${i}`, job_no: `S2-${i}`, normalized_phone_number: `+1555030${String(i).padStart(4, "0")}`,
      pickup_city: "Boston", pickup_state: "MA", delivery_city: "Austin", delivery_state: "TX", move_date: new Date("2026-12-15T00:00:00Z"), receiver_agent: oid() };
    await getFormLeadModel().collection.insertOne(lead);
    if (options.booking) {
      const booking = { _id: oid(), lead_model: "FormLead", lead_ref: lead._id, agent: oid(), book_date: new Date(+timestamp + options.booking.afterMs), job_no: lead.job_no, total_binder_amount: 2100 };
      await db.collection("booked_leads").insertOne(booking);
      if (options.booking.cancelAfterMs) await db.collection("cancelled_leads").insertOne({ _id: oid(), booked_lead: booking._id, cancel_date: new Date(+timestamp + options.booking.cancelAfterMs), reason: "Synthetic: moving later" });
    }
    const at = new Date(+timestamp + (options.closeAfterMs ?? 60_000));
    await withTransaction(session => ensureLead({ model: "FormLead", id: String(lead._id) }, workerContext(session, String(oid()), at)));
    const record = await Records.findOne({ "subject.id": lead._id }).orFail().lean();
    return { lead, record, key: `lead:FormLead:${lead._id}` };
  }
  async function all(query: Record<string, unknown>): Promise<{ rows: AttentionRowDto[]; pages: Read[] }> {
    const rows: AttentionRowDto[] = [], pages: Read[] = [];
    let cursor: string | undefined;
    do {
      const page = await readAttention({ ...query, ...(cursor ? { cursor } : {}) });
      assert.equal(page.data.status, "ready");
      pages.push(page);
      rows.push(...page.data.items);
      cursor = page.data.cursor ?? undefined;
    } while (cursor);
    return { rows, pages };
  }
  const keys = (rows: readonly AttentionRowDto[]) => rows.map(r => r.subject_key).sort();

  try {
    const open = [];
    for (let i = 0; i < 6; i++) open.push(await subject(i, { receivedAgo: (i + 1) * 3_600_000 + (i < 2 ? 8 * DAY : 0) }));
    // B6: booked 8 days after trigger_at (Booking first, so ensure closes it officially), closed 2 days ago.
    const booked = await subject(10, { receivedAgo: 10 * DAY, booking: { afterMs: 8 * DAY }, closeAfterMs: 8 * DAY + 3_600_000 });
    // B6: booked day 5, cancelled day 9.
    const cancelled = await subject(11, { receivedAgo: 20 * DAY, booking: { afterMs: 5 * DAY, cancelAfterMs: 9 * DAY }, closeAfterMs: 9 * DAY + 3_600_000 });
    // Booked and closed 100 days ago: outside the 90-day partition.
    const old = await subject(12, { receivedAgo: 200 * DAY, booking: { afterMs: 100 * DAY }, closeAfterMs: 100 * DAY });
    // Owner closure 2 days ago, and a command-path `lead_unavailable` closure (not an outcome).
    const owner = await subject(13, { receivedAgo: 5 * DAY });
    await Records.collection.updateOne({ _id: owner.record._id }, { $set: { state: "closed", closed_reason: "Customer asked us to stop", closure_origin: "owner", closed_at: new Date(now - 2 * DAY) } });
    const unavailable = await subject(14, { receivedAgo: 4 * DAY });
    await Records.collection.updateOne({ _id: unavailable.record._id }, { $set: { state: "closed", closed_reason: "lead_unavailable", closure_origin: "official", closed_at: new Date(now - DAY) } });
    for (const s of [booked, cancelled, old]) assert.equal((await Records.findById(s.record._id).lean())?.state, "closed", `${s.key} closed by ensure`);
    const openKeys = open.map(s => s.key).sort();

    let offDefault: string[] = [], offAll: string[] = [];
    await t.test("flag off: today's desk; no closed partition, no metrics, no index; the production Admin parses every response", async () => {
      const published = await publishAttentionSnapshot({ attentionV2: false });
      assert.equal(published.status, "published");
      assert.equal("closed_items" in published, false);
      const header = await Snapshots.findOne({ snapshot_id: (published as { snapshot_id: string }).snapshot_id }).lean();
      assert.equal(header?.metrics ?? null, null);
      assert.equal(header?.index_gzip_base64 ?? null, null);
      const def = await all({});
      const everything = await all({ view: "all_outreach", limit: 3 });
      offDefault = keys(def.rows);
      offAll = keys(everything.rows);
      assert.deepEqual(offAll, openKeys, "closed records never reach all_outreach");
      for (const page of [...def.pages, ...everything.pages]) {
        assert.equal("metrics" in page.data, false, "flag-off page carries no metrics key");
        adminAttentionSchema.parse(JSON.parse(JSON.stringify({ ok: true, ...page })));
      }
      assert.deepEqual(keys((await all({ view: "closed" })).rows), [], "view=closed is empty without the partition");
      // S2 filters are additive reads and work with the flag off (rows carry filter_keys).
      assert.deepEqual(keys((await all({ view: "all_outreach", received_from: new Date(now - DAY).toISOString() })).rows), open.slice(2).map(s => s.key).sort());
    });

    let v2SnapshotId = "";
    await t.test("flag on: closed partition (B6), metrics (B7), index; default views unchanged", async () => {
      const published = await publishAttentionSnapshot({ attentionV2: true }) as { status: string; snapshot_id: string; closed_items: number };
      assert.equal(published.status, "published");
      v2SnapshotId = published.snapshot_id;
      assert.equal(published.closed_items, 3, "booked, cancelled, owner; not the 100-day booking nor lead_unavailable");
      const def = await all({}), everything = await all({ view: "all_outreach" });
      assert.deepEqual(keys(def.rows), offDefault, "attention view identical to flag off");
      assert.deepEqual(keys(everything.rows), offAll, "all_outreach identical to flag off");
      for (const page of [...def.pages, ...everything.pages]) adminAttentionSchema.parse(JSON.parse(JSON.stringify({ ok: true, ...page })));
      const closed = await all({ view: "closed" });
      assert.deepEqual(keys(closed.rows), [booked.key, cancelled.key, owner.key].sort());
      for (const page of closed.pages) adminAttentionSchema.parse(JSON.parse(JSON.stringify({ ok: true, ...page })));
      const byKey = new Map(closed.rows.map(r => [r.subject_key, r]));
      const b = byKey.get(booked.key)!, c = byKey.get(cancelled.key)!, o = byKey.get(owner.key)!;
      assert.equal(b.partition, "closed");
      assert.equal(b.in_attention, false);
      assert.deepEqual(b.allowed_actions, []);
      assert.deepEqual(b.outreach?.followups, []);
      assert.deepEqual(b.outreach?.allowed_actions, []);
      assert.equal(b.outcome?.reason, "booked");
      assert.equal(b.outcome?.time_to_close_ms, 8 * DAY, "B6: book_date - trigger_at");
      assert.equal(b.sort_keys?.time_to_close, 8 * DAY);
      assert.equal(b.outcome?.booking?.total_binder_amount, 2100);
      assert.equal(c.outcome?.reason, "cancelled");
      assert.equal(c.outcome?.time_to_close_ms, 9 * DAY, "B6: cancel_date - trigger_at");
      assert.equal(c.outcome?.cancellation?.reason, "Synthetic: moving later");
      assert.equal(o.outcome?.reason, "owner");
      assert.equal(o.outcome?.note, "Customer asked us to stop");
      assert.equal(o.outcome?.time_to_close_ms, 3 * DAY, "closed_at - trigger_at");
      // Sorts and filters of the closed view over the index.
      assert.deepEqual((await all({ view: "closed", sort: "time_to_close" })).rows.map(r => r.subject_key), [o, b, c].map(r => r.subject_key), "3d, 8d, 9d");
      assert.deepEqual((await all({ view: "closed" })).rows.map(r => r.subject_key)[2], cancelled.key, "default sort closed desc: the oldest closure last");
      assert.deepEqual(keys((await all({ view: "closed", outcome: "booked" })).rows), [booked.key]);
      assert.deepEqual(keys((await all({ view: "closed", closed_from: new Date(now - 7 * DAY).toISOString() })).rows), [booked.key, owner.key].sort());
      // B7: header metrics equal a direct recount over the same snapshot (+ the DB for Leads received).
      const page = def.pages[0]!;
      const metrics = page.data.metrics!;
      assert.ok(metrics, "flag-on page carries metrics");
      assert.equal(metrics.as_of, page.as_of, "metrics are computed at the snapshot as_of");
      const snapshotRows = [...everything.rows, ...closed.rows];
      const recount = attentionMetrics(snapshotRows, await Records.countDocuments({ purged_at: null, trigger_kind: "lead_arrival", trigger_at: { $gte: new Date(Date.parse(page.as_of) - 7 * DAY) } }), new Date(page.as_of));
      assert.deepEqual(metrics, recount);
      assert.equal(metrics.leads_received_7d, 4 + 2, "four open Leads within 7d, the owner (5d) and lead_unavailable (4d) closures; not the 8d-old Leads");
      assert.equal(metrics.booked_7d, 1);
      assert.equal(metrics.booked_7d_median_days, 8);
      assert.equal(metrics.not_called_yet, def.rows.filter(r => r.derived.attention_band === 2).length);
      // Index: one entry per stored row, naming the row's position.
      const header = await Snapshots.findOne({ snapshot_id: v2SnapshotId }).lean();
      const index = decodeAttentionIndex(header!.index_gzip_base64!);
      assert.equal(index.length, header!.counts.total_items);
      assert.equal(index.filter(e => e.partition === "closed").length, 3);
    });

    await t.test("paging: every view pages without repeats or skips; cursors bind the new params", async () => {
      for (const query of [{ view: "closed", limit: 1 }, { view: "all_outreach", limit: 2, sort: "last_call" }, { view: "all_outreach", limit: 4, sort: "interactions", direction: "asc" }, { limit: 1, unassigned: "false" }]) {
        const paged = await all(query);
        const whole = await all({ ...query, limit: 200 });
        assert.deepEqual(paged.rows.map(r => r.subject_key), whole.rows.map(r => r.subject_key), JSON.stringify(query));
        assert.equal(new Set(paged.rows.map(r => r.subject_key)).size, paged.rows.length);
      }
      const first = await readAttention({ view: "closed", limit: 1 });
      await assert.rejects(() => readAttention({ view: "closed", limit: 1, outcome: "booked", cursor: first.data.cursor! }), /INVALID_INPUT/);
    });

    await t.test("chunked layout: the read loads only the chunks the page names and returns the same pages", async () => {
      const published = await publishAttentionSnapshot({ attentionV2: true, layout: "chunked", chunkBytes: 12_000 }) as { status: string; snapshot_id: string };
      assert.equal(published.status, "published");
      const header = await Snapshots.findOne({ snapshot_id: published.snapshot_id }).lean();
      assert.ok((header?.counts.chunks ?? 0) >= 3, `several chunks (${header?.counts.chunks})`);
      assert.equal(header?.rows_gzip_base64 ?? null, null);
      const loads: number[] = [];
      mongoose.set("debug", (collection: string, method: string, filter: unknown) => {
        if (collection === "sales_intelligence_attention_snapshots" && method === "find") loads.push(((filter as { chunk_index?: { $in?: unknown[] } }).chunk_index?.$in ?? [NaN]).length);
      });
      let one: Read;
      try { one = await readAttention({ view: "closed", limit: 1 }); } finally { mongoose.set("debug", false); }
      assert.deepEqual(loads, [1], "one chunk sibling read, naming one chunk");
      assert.equal(one.data.total_items, 3);
      assert.deepEqual(keys((await all({ view: "closed", limit: 2 })).rows), [booked.key, cancelled.key, owner.key].sort());
      assert.deepEqual(keys((await all({ view: "all_outreach", limit: 2 })).rows), offAll);
    });

    await t.test("a snapshot published before S2 (no index, no filter_keys) is still read", async () => {
      const header = await Snapshots.findOne({ snapshot_id: v2SnapshotId }).lean();
      // Rewrite a copy as a pre-S2 snapshot: strip the S2 row fields and header fields, newest as_of.
      const { decompressAttentionRows, compressAttentionRows } = await import("../../src/services/salesIntelligence/outreach/attention");
      const rows = (decompressAttentionRows(header!.rows_gzip_base64!) as Record<string, unknown>[]).filter(r => r.partition !== "closed")
        .map(({ partition: _p, filter_keys: _f, outcome: _o, ...r }) => ({ ...r, sort_keys: (({ closed: _c, time_to_close: _t, ...k }) => k)(r.sort_keys as Record<string, unknown>) }));
      const legacyId = `outreach:legacy-${oid()}`;
      await Snapshots.collection.insertOne({ snapshot_id: legacyId, owner_id: "system", filter_digest: header!.filter_digest, policy_version: header!.policy_version, deployment: header!.deployment,
        database: header!.database, as_of: new Date(), expires_at: null, chunk_index: null, parent_snapshot_id: null, rows: [], rows_gzip_base64: compressAttentionRows(rows), counts: { total_items: rows.length } });
      const page = await all({ view: "all_outreach" });
      assert.equal(page.pages[0]!.data.snapshot_id, legacyId);
      assert.deepEqual(keys(page.rows), offAll);
      assert.equal("metrics" in page.pages[0]!.data, false);
      assert.deepEqual(keys((await all({ view: "all_outreach", has_recording: "false" })).rows), [], "an S2 filter never matches a pre-S2 row");
    });
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
});
