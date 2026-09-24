import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { ensureLead, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { ensureNumberReview } from "../../src/services/salesIntelligence/outreach/numberReview";
import { publishAttentionSnapshot, readAttention } from "../../src/services/salesIntelligence/outreach/attention";
import type { AttentionRowDto } from "../../src/services/salesIntelligence/dto";

/**
 * S7-PRIO (assignment addendum §5, E12–E14; acceptance C7): `filter_keys.priority` is `no_lead` for a
 * record with no Lead; the header's `priority_counts` per key and view equal the rows each view returns;
 * the `New` preset (`0` + `not_set`) matches in all three views; `Other` (3, 4, 7, 8, 9) finds 7/8 in Closed.
 */
test("S7-PRIO disposable replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300_000 }, async (t) => {
  assert.equal(getMongoDatabaseName(), "testvantagemovers_t3prio");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await db.dropDatabase();
  await applyCsiMigration();
  const oid = () => new mongoose.Types.ObjectId();
  const Records = getOutreachRecordModel();
  let serial = 0;
  async function leadRecord(code: string | null, closed?: "granot_dead_opportunity" | "granot_bad_unusable" | "booked") {
    const n = ++serial;
    const lead = { _id: oid(), timestamp: new Date(Date.now() - 86_400_000), createdAt: new Date(), updatedAt: new Date(), name: `Synthetic Prio ${n}`, job_no: `T3P-${n}`,
      normalized_phone_number: `555041${String(n).padStart(4, "0")}` };
    await getFormLeadModel().collection.insertOne(lead);
    const record = await withTransaction(session => ensureLead({ model: "FormLead", id: String(lead._id) }, workerContext(session, String(oid()), new Date())));
    const set: Record<string, unknown> = {};
    if (code !== null) set["lead_progress"] = { lead_ref: { model: "FormLead", id: lead._id }, granot_priority: code, quoted: code === "1", disposition: "fresh", work_observed: false,
      basis: null, provenance: "accepted", source_origin: "granot", source_applied_at: new Date(), last_progress_at: new Date(), first_work_observed_at: null,
      closure: null, override: null, reopen_review_id: null, disposition_revision: `r${n}`, explanation: null, no_call_observed: true, projected_at: new Date() };
    if (closed) Object.assign(set, { state: "closed", closed_at: new Date(Date.now() - 3 * 86_400_000), closed_reason: closed, closure_origin: closed === "booked" ? "official" : "crm_disposition" });
    if (Object.keys(set).length) await Records.collection.updateOne({ _id: record!._id }, { $set: set });
    return String(record!._id);
  }
  const ensureNumberFor = (number: { _id: unknown }) => withTransaction(session => ensureNumberReview(String(number._id), "owner_open", workerContext(session, String(oid()), new Date())));
  async function all(query: Record<string, unknown>): Promise<AttentionRowDto[]> {
    const out: AttentionRowDto[] = [];
    let cursor: string | undefined;
    do {
      const page = await readAttention({ limit: 200, ...query, ...(cursor ? { cursor } : {}) } as never);
      out.push(...page.data.items);
      cursor = page.data.cursor ?? undefined;
    } while (cursor);
    return out;
  }
  try {
    for (const code of ["0", "0", "1", "3", "4", "9", null, null]) await leadRecord(code);
    await leadRecord("7", "granot_bad_unusable");
    await leadRecord("8", "granot_dead_opportunity");
    await leadRecord("1", "booked");
    await leadRecord(null, "booked");
    // Two Number-only records (no Lead).
    for (let i = 0; i < 2; i++) await ensureNumberFor(await getContactNumberModel().create({ e164: `+1555042000${i}`, national_ten: `555042000${i}`,
      digits_reversed: `555042000${i}`.split("").reverse().join(""), first_observed_at: new Date(), last_activity_at: new Date(), kind: "external", classification: "customer" }));
    assert.equal((await publishAttentionSnapshot({ attentionV2: true })).status, "published");
    const page = await readAttention({ view: "all_outreach", limit: 1 });
    const counts = page.data.priority_counts!;
    assert.ok(counts, "the header carries priority_counts");

    await t.test("C7: no_lead is its own key; chip counts equal the rows every view returns", async () => {
      const allRows = await all({ view: "all_outreach" });
      const noLead = allRows.filter(r => r.filter_keys?.priority === "no_lead");
      assert.ok(noLead.length >= 1 && noLead.every(r => r.subject.kind === "number_review"));
      for (const [key, bucket] of Object.entries(counts)) {
        assert.equal((await all({ view: "attention", priority: key })).length, bucket.attention, `${key} attention`);
        assert.equal((await all({ view: "all_outreach", priority: key })).length, bucket.active, `${key} active`);
        assert.equal((await all({ view: "closed", priority: key })).length, bucket.closed, `${key} closed`);
      }
      assert.equal(counts["0"]?.active, 2);
      assert.ok((counts["not_set"]?.active ?? 0) >= 2);
      assert.equal(counts["7"]?.closed, 1);
      assert.equal(counts["8"]?.closed, 1);
    });
    await t.test("C7: presets New / Quoted / Other in all three views", async () => {
      const sum = (keys: string[], view: "attention" | "active" | "closed") => keys.reduce((n, k) => n + (counts[k]?.[view] ?? 0), 0);
      for (const [view, bucket] of [["attention", "attention"], ["all_outreach", "active"], ["closed", "closed"]] as const) {
        assert.equal((await all({ view, priority: "0,not_set" })).length, sum(["0", "not_set"], bucket), `New in ${view}`);
        assert.equal((await all({ view, priority: "1" })).length, sum(["1"], bucket), `Quoted in ${view}`);
        assert.equal((await all({ view, priority: ["3", "4", "7", "8", "9"] })).length, sum(["3", "4", "7", "8", "9"], bucket), `Other in ${view}`);
      }
      const closedOther = await all({ view: "closed", priority: "3,4,7,8,9" });
      assert.deepEqual(closedOther.map(r => r.filter_keys?.priority).sort(), ["7", "8"], "Other in Closed shows 7/8");
      assert.equal((await all({ view: "closed", priority: "1" })).length, 1, "Quoted in Closed: only a record that closed while at 1");
    });
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
});
