import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { applyInteractionObservation } from "../../src/services/numberActivity/persistInteraction";
import { at, callLogRecord, SYNTHETIC_ACCOUNT_ID, SYNTHETIC_COMPANY_DID, SYNTHETIC_USER_EXTENSION, syntheticDirectory } from "../../src/services/numberActivity/fixtures";
import { ensureLead, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { publishAttentionSnapshot, readAttention } from "../../src/services/salesIntelligence/outreach/attention";
import { readOutreach } from "../../src/services/salesIntelligence/outreach/reads";
import { readCaptureCoverage } from "../../src/services/numberActivity/coverage";
import type { AttentionRowDto } from "../../src/services/salesIntelligence/dto";

/**
 * S1-FACTS (data spec §3.3, acceptance B2/B3): the Attention publish freezes
 * `facts` computed from the primary Number's rollups as capture maintains them,
 * and the publish's reads stay batched per page (no read grows with the rows).
 */
const READ_METHODS = new Set(["find", "findOne", "aggregate", "distinct", "countDocuments", "estimatedDocumentCount", "count"]);

test("S1-FACTS disposable replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300_000 }, async (t) => {
  assert.equal(getMongoDatabaseName(), "testvantagemovers_s1facts");
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await db.dropDatabase();
  await applyCsiMigration();
  const oid = () => new mongoose.Types.ObjectId();
  const directory = syntheticDirectory();
  const Records = getOutreachRecordModel();
  const Numbers = getContactNumberModel();
  const Interactions = getCallInteractionModel();

  let serial = 0;
  const applyCall = (customer: string, direction: "Inbound" | "Outbound", startTime: Date) => {
    const n = ++serial;
    const company = { phoneNumber: SYNTHETIC_COMPANY_DID, name: SYNTHETIC_USER_EXTENSION.name, extensionId: SYNTHETIC_USER_EXTENSION.id, extensionNumber: SYNTHETIC_USER_EXTENSION.number };
    return applyInteractionObservation(SYNTHETIC_ACCOUNT_ID, { kind: "call_log", proof_ref: `call_log:cl-s1f-${n}`,
      record: callLogRecord({ id: `cl-s1f-${n}`, telephonySessionId: `s-s1f-${n}`, direction, result: direction === "Inbound" ? "Missed" : "No Answer", startTime, duration: 30,
        from: direction === "Inbound" ? { phoneNumber: customer } : company, to: direction === "Inbound" ? company : { phoneNumber: customer } }) as never },
    { now: () => new Date(+startTime + 120_000), directory, resolveRoute: () => null });
  };
  /** One Form Lead subject; with a Number, `calls` Call Log observations through capture (which maintains the rollups). */
  async function subject(i: number, options: { calls?: number } = {}) {
    const calls = options.calls ?? 0;
    const customer = `+1555020${String(i).padStart(4, "0")}`;
    for (let k = 0; k < calls; k++) await applyCall(customer, k % 2 ? "Outbound" : "Inbound", at(-86_400 + i * 60 + k * 900));
    const number = calls ? await Numbers.findOne({ e164: customer }).orFail().lean() : null;
    const lead = { _id: oid(), timestamp: at(-90_000), createdAt: at(-90_000), updatedAt: at(-90_000), name: `Synthetic S1 ${i}`, job_no: `S1-${i}`,
      normalized_phone_number: customer, pickup_city: "Boston", pickup_state: "MA", delivery_city: "Austin", delivery_state: "TX",
      move_date: new Date("2026-10-15T00:00:00Z"), receiver_agent: oid() };
    await getFormLeadModel().collection.insertOne(lead);
    await withTransaction(session => ensureLead({ model: "FormLead", id: String(lead._id) }, workerContext(session, String(oid()), at(-80_000)), number ? String(number._id) : undefined));
    if (i % 10 === 3) {
      // Written after the record exists so it stays open: exercises the widened booking, cancellation and agents reads.
      const booking = { _id: oid(), lead_model: "FormLead", lead_ref: lead._id, agent: oid(), agent_name_snapshot: "Synthetic Agent", book_date: at(-3_600), job_no: lead.job_no, total_binder_amount: 1200 };
      await db.collection("booked_leads").insertOne(booking);
      await db.collection("cancelled_leads").insertOne({ _id: oid(), booked_lead: booking._id, cancel_date: at(-600), reason: "Synthetic reason" });
    }
    return { lead, number, record: await Records.findOne({ "subject.id": lead._id }).orFail().lean() };
  }
  async function rows(): Promise<AttentionRowDto[]> {
    const out: AttentionRowDto[] = [];
    let cursor: string | undefined;
    do {
      const page = await readAttention({ view: "all_outreach", limit: 200, ...(cursor ? { cursor } : {}) });
      assert.equal(page.data.status, "ready");
      out.push(...page.data.items);
      cursor = page.data.cursor ?? undefined;
    } while (cursor);
    return out;
  }
  /** Mongoose's collection debug hook sees Model reads and the `useDb().collection()` reads alike. */
  async function countReads<T>(work: () => Promise<T>): Promise<{ result: T; reads: number; byCollection: Record<string, number> }> {
    const byCollection: Record<string, number> = {};
    let reads = 0;
    mongoose.set("debug", (collection: string, method: string) => {
      if (!READ_METHODS.has(method)) return;
      reads++;
      byCollection[`${collection}.${method}`] = (byCollection[`${collection}.${method}`] ?? 0) + 1;
    });
    try {
      return { result: await work(), reads, byCollection };
    } finally {
      mongoose.set("debug", false);
    }
  }

  try {
    const seeded: Array<Awaited<ReturnType<typeof subject>>> = [];
    for (let i = 0; i < 10; i++) seeded.push(await subject(i, { calls: i % 5 === 0 ? 0 : 1 + (i % 3) }));

    let first: Awaited<ReturnType<typeof countReads>> | null = null;
    await t.test("B2: facts.last_call_at equals the newest canonical started_at of the primary Number for every row", async () => {
      // Warm publish: Capture Coverage is cached per process, so the measured publishes below compare like with like.
      assert.equal((await publishAttentionSnapshot()).status, "published");
      await readCaptureCoverage();
      first = await countReads(() => publishAttentionSnapshot());
      assert.equal((first.result as { status: string }).status, "published");
      const published = await rows();
      assert.equal(published.length, 10);
      let withNumber = 0;
      for (const row of published) {
        const facts = row.outreach?.facts;
        assert.ok(facts, `${row.subject_key} carries facts`);
        const numberId = row.outreach?.primary_number?.id ?? null;
        if (!numberId) {
          assert.equal(facts.last_call_at, null);
          assert.equal(facts.calls_total, null, "no Number: null, never 0");
          assert.equal(row.sort_keys?.interactions, null);
          continue;
        }
        withNumber++;
        const newest = await Interactions.findOne({ contact_number_id: numberId, merged_into_id: null }).sort({ started_at: -1 }).lean();
        assert.equal(facts.last_call_at, newest?.started_at.toISOString() ?? null, row.subject_key);
        assert.equal(facts.calls_total, await Interactions.countDocuments({ contact_number_id: numberId, merged_into_id: null }));
        assert.equal(row.sort_keys?.last_call, facts.last_call_at);
        assert.equal(row.sort_keys?.interactions, facts.calls_total);
        assert.deepEqual(facts.route, { pickup_city: "Boston", pickup_state: "MA", delivery_city: "Austin", delivery_state: "TX", move_date: "2026-10-15", source: "lead" });
        // The admin still reads `latest_number_call` (D1 deferred); it names the same call.
        assert.equal(row.outreach?.latest_number_call?.happened_at, facts.last_call_at);
        if (row.outreach?.lead_display?.job_no === "S1-3") assert.deepEqual(row.outreach.related_record_links.map(link => link.model).sort(), ["BookedLead", "CancelledLead", "FormLead"]);
      }
      assert.equal(withNumber, 8);
    });

    await t.test("B3: a new call on an assessed Number flips newer_call_since_assessment on the next publish", async () => {
      const target = seeded.find(s => s.number)!;
      const covered = (await Interactions.findOne({ contact_number_id: target.number!._id, merged_into_id: null }).sort({ started_at: -1 }).lean())!.started_at;
      await Records.collection.updateOne({ _id: target.record._id }, { $set: { move_assessment: { artifact_id: oid(), status: "ready", transaction_intent: 50, move_likelihood: 75,
        transaction_intent_confidence: "medium", move_likelihood_confidence: "high", context_as_of: covered, latest_conversation_at: covered, input_fingerprint: "fp-s1",
        schema_version: "move-assessment-v1", stale: false, stale_reason: null, published_at: covered, conflict_targets: ["move_date"], eligibility_revision: target.record.revision } } });
      const key = `lead:FormLead:${target.lead._id}`;
      const rowFor = async () => (await rows()).find(r => r.subject_key === key)!;
      assert.equal((await publishAttentionSnapshot()).status, "published");
      const before = await rowFor();
      assert.equal(before.outreach?.facts?.newer_call_since_assessment, false);
      assert.equal(before.outreach?.facts?.details_disagree, true, "conflict_targets includes move_date");
      await applyCall(target.number!.e164, "Outbound", new Date(+covered + 3_600_000));
      assert.equal((await publishAttentionSnapshot()).status, "published");
      const after = await rowFor();
      assert.equal(after.outreach?.facts?.newer_call_since_assessment, true);
      assert.equal(after.outreach?.facts?.last_call_at, new Date(+covered + 3_600_000).toISOString());
      // The live detail computes the same facts at request time.
      const live = await readOutreach(String(target.record._id));
      assert.equal(live?.data.outreach.facts?.newer_call_since_assessment, true);
      assert.equal(live?.data.outreach.facts?.last_call_at, after.outreach?.facts?.last_call_at);
      assert.equal(after.outreach?.move_assessment?.stale, false, "move date 2026-10-15 is ahead");
      // RD2 / S3-PRES contract: a passed Lead move date makes the same row's assessment stale on read.
      await getFormLeadModel().collection.updateOne({ _id: target.lead._id }, { $set: { move_date: new Date("2026-09-01T00:00:00Z") } });
      assert.equal((await publishAttentionSnapshot()).status, "published");
      const passed = await rowFor();
      assert.equal(passed.outreach?.facts?.move_date_passed, true);
      assert.equal(passed.outreach?.move_assessment?.stale, true);
      assert.equal(passed.outreach?.move_assessment?.stale_reason, "move_date_passed");
      await getFormLeadModel().collection.updateOne({ _id: target.lead._id }, { $set: { move_date: new Date("2026-10-15T00:00:00Z") } });
    });

    await t.test("publish reads are batched per page: 10 vs 60 records issue the same number of reads", async () => {
      for (let i = 10; i < 60; i++) seeded.push(await subject(i, { calls: i % 5 === 0 ? 0 : 1 + (i % 3) }));
      assert.ok(first);
      // Capture Coverage is a publish-wide read with a short memo; refresh it so both measurements hit the memo.
      await readCaptureCoverage();
      const second = await countReads(() => publishAttentionSnapshot());
      assert.equal((second.result as { status: string }).status, "published");
      assert.equal((await rows()).length, 60);
      assert.deepEqual(second.byCollection, first!.byCollection, "per-collection read counts do not grow with rows");
      assert.equal(second.reads, first!.reads);
      console.log(`# publish reads: 10 records → ${first!.reads}, 60 records → ${second.reads}`, JSON.stringify(second.byCollection));
    });
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
});
