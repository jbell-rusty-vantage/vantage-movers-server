import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { csiDataset } from "../../src/config/domain/salesIntelligence";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getNumberLeadAttachmentModel } from "../../src/models/NumberLeadAttachment";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getContactNumberDetail, toNumberSearchItem, type ContactNumberLean } from "../../src/services/numberActivity/contactNumbers";
import { numberDetailReadDtoSchema, numberSearchItemDtoSchema } from "../../src/services/numberActivity/dto";
import { loadAttachedLeadProgressForNumbers } from "../../src/services/salesIntelligence/outreach/reads";

/**
 * S4-NUMBER (data spec V15, §7 D2; final spec §9.1, D5, A19 server half) on the disposable replica:
 * a Number with one attached Lead shows that Outreach's scores on its row; a Number with two attached
 * Leads never shows a score. `GET /numbers/:id` reads the pending-assessment set once (`distinct`),
 * never one `exists` per Outreach record, and stays parseable by the current detail schema.
 */
test("S4-NUMBER disposable replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300_000 }, async () => {
  assert.equal(getMongoDatabaseName(), "testvantagemovers_s4number");
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await db.dropDatabase();
  await applyCsiMigration();
  const oid = () => new mongoose.Types.ObjectId();
  const now = new Date();
  const Numbers = getContactNumberModel(), Attachments = getNumberLeadAttachmentModel(), Records = getOutreachRecordModel(), Jobs = getSalesIntelligenceJobModel();

  async function number(e164: string, outreachTotal: number) {
    const doc = new Numbers({ e164, national_ten: e164.slice(2), digits_reversed: [...e164.slice(2)].reverse().join(""), classification: "customer",
      first_observed_at: new Date(+now - 10 * 86_400_000), last_activity_at: new Date(+now - 3_600_000),
      rollups: { interactions_total: 6, human_conversations_total: 2, recordings_total: 2, outreach_records_total: outreachTotal } }).toObject();
    await Numbers.collection.insertOne(doc as never);
    return doc;
  }
  async function leadWithOutreach(numberId: mongoose.Types.ObjectId, i: number, projection: Record<string, unknown> | null) {
    const leadId = oid();
    await getFormLeadModel().collection.insertOne({ _id: leadId, timestamp: now, createdAt: now, updatedAt: now, name: `Synthetic S4N ${i}`, job_no: `S4N-${i}`,
      pickup_city: "Boston", pickup_state: "MA", delivery_city: "Austin", delivery_state: "TX", move_date: new Date(+now + 30 * 86_400_000) } as never);
    await Attachments.create({ contact_number_id: numberId, lead_ref: { model: "FormLead", id: leadId }, state: "attached", certainty: "exact",
      evidence: [{ source: "owner_attach", field_path: "owner", observed_at: now }], revision: 1 });
    const record = new Records({ subject: { kind: "lead", model: "FormLead", id: leadId }, primary_contact_number_id: numberId, state: "unworked",
      trigger_kind: "lead_arrival", trigger_at: new Date(+now - 86_400_000), policy_version: 1, move_assessment: projection }).toObject();
    await Records.collection.insertOne(record as never);
    return { leadId, record, key: `lead:FormLead:${leadId}` };
  }
  const ready = (ti: number, ml: number) => ({ artifact_id: oid(), status: "ready", transaction_intent: ti, move_likelihood: ml, transaction_intent_confidence: "medium",
    move_likelihood_confidence: "high", context_as_of: now, latest_conversation_at: null, stale: false, stale_reason: null, published_at: now, conflict_targets: [] });

  const single = await number("+16175554001", 1);
  const one = await leadWithOutreach(single._id, 1, ready(75, 100));
  const double = await number("+16175554002", 2);
  const two = [await leadWithOutreach(double._id, 2, ready(60, 50)), await leadWithOutreach(double._id, 3, null)];
  // Queued assessment for the second Lead of the two-Lead Number (Pending on its Outreach, never on the Number row).
  await Jobs.collection.insertOne({ _id: oid(), ...csiDataset(), stage: "move_assessment", status: "pending", subject_key: two[1]!.key, createdAt: now, updatedAt: now } as never);

  // V15 / D5 on the Numbers row.
  const attached = await loadAttachedLeadProgressForNumbers([String(single._id), String(double._id)], now);
  const rowOne = toNumberSearchItem(single as unknown as ContactNumberLean, { kind: "none" }, attached.get(String(single._id)));
  numberSearchItemDtoSchema.parse(rowOne);
  assert.equal(rowOne.attached_lead_progress?.status, "resolved");
  assert.equal(rowOne.attached_lead_progress?.lead_status, "open");
  assert.equal(rowOne.attached_lead_progress?.move_assessment?.transaction_intent, 75, "one Lead: that Outreach's scores");
  assert.equal(rowOne.attached_lead_progress?.move_assessment?.move_likelihood, 100);
  assert.equal(rowOne.attached_lead_progress?.outreach_records_total, 1);
  const rowTwo = toNumberSearchItem(double as unknown as ContactNumberLean, { kind: "none" }, attached.get(String(double._id)));
  numberSearchItemDtoSchema.parse(rowTwo);
  assert.deepEqual(rowTwo.attached_lead_progress, { status: "multiple", outreach_records_total: 2 }, "A19 server half: two Leads → no score, no Lead fields");

  // D2 on the detail: one `distinct` on the jobs collection, no per-record `exists`/`findOne`.
  const jobOps: string[] = [];
  mongoose.set("debug", (collection: string, method: string) => { if (collection === Jobs.collection.collectionName) jobOps.push(method); });
  try {
    const detailTwo = await getContactNumberDetail(String(double._id), { now: () => now });
    assert.ok(detailTwo);
    numberDetailReadDtoSchema.parse(detailTwo);
    assert.equal(detailTwo.data.outreach_records.length, 2);
    const byLead = new Map(detailTwo.data.outreach_records.map(o => [o.subject.kind === "lead" ? o.subject.id : "", o.move_assessment]));
    assert.equal(byLead.get(String(two[0]!.leadId))?.transaction_intent, 60, "each Outreach keeps its own scores on the detail");
    assert.equal(byLead.get(String(two[1]!.leadId))?.status, "pending", "the pending set reaches the record");
    assert.equal(detailTwo.data.connections.attached, 2);
    assert.deepEqual(jobOps.filter(m => m !== "distinct" && m !== "countDocuments"), [], "no per-record jobs exists/findOne");
    assert.equal(jobOps.filter(m => m === "distinct").length, 1, "one pending-assessment distinct");
    jobOps.length = 0;
    const detailOne = await getContactNumberDetail(String(single._id), { now: () => now });
    assert.ok(detailOne);
    assert.equal(detailOne.data.outreach_records[0]?.move_assessment?.transaction_intent, 75);
    assert.equal(jobOps.filter(m => m === "distinct").length, 1);
    assert.equal(detailOne.data.outreach_records[0]?.id, String(one.record._id));
  } finally {
    mongoose.set("debug", false);
    await db.dropDatabase();
    await mongoose.disconnect();
  }
});
