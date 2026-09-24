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
import { getRepIdentityLinkModel } from "../../src/models/RepIdentityLink";
import { applyInteractionObservation } from "../../src/services/numberActivity/persistInteraction";
import { callLogRecord, SYNTHETIC_ACCOUNT_ID, SYNTHETIC_COMPANY_DID, SYNTHETIC_USER_EXTENSION, syntheticDirectory } from "../../src/services/numberActivity/fixtures";
import { ensureLead, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { publishAttentionSnapshot, readAttention } from "../../src/services/salesIntelligence/outreach/attention";
import { readOutreach } from "../../src/services/salesIntelligence/outreach/reads";
import { readCaptureCoverage } from "../../src/services/numberActivity/coverage";
import type { AttentionRowDto } from "../../src/services/salesIntelligence/dto";

/**
 * S5c-LIVE (reconciliation addendum §3.2, G3; acceptance C18): `live_call` is set from a
 * `terminal: false` call on the record's primary Number that started in the last 4 h, on the
 * published row, its `filter_keys` and the live detail; null after a settle, after 4 h, for a
 * monitoring leg or an Internal call; independent of `call_progress`. The publish adds one batched
 * `call_interactions.find` per page and the count doesn't grow with rows.
 */
const READ_METHODS = new Set(["find", "findOne", "aggregate", "distinct", "countDocuments", "estimatedDocumentCount", "count"]);
const MIN = 60_000;

test("S5c-LIVE disposable replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300_000 }, async (t) => {
  assert.equal(getMongoDatabaseName(), "testvantagemovers_t3live");
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await db.dropDatabase();
  await applyCsiMigration();
  const oid = () => new mongoose.Types.ObjectId();
  const directory = syntheticDirectory();
  const Records = getOutreachRecordModel(), Numbers = getContactNumberModel(), Interactions = getCallInteractionModel();

  let serial = 0;
  const applyCall = (customer: string, startTime: Date) => {
    const n = ++serial;
    const company = { phoneNumber: SYNTHETIC_COMPANY_DID, name: SYNTHETIC_USER_EXTENSION.name, extensionId: SYNTHETIC_USER_EXTENSION.id, extensionNumber: SYNTHETIC_USER_EXTENSION.number };
    return applyInteractionObservation(SYNTHETIC_ACCOUNT_ID, { kind: "call_log", proof_ref: `call_log:cl-t3l-${n}`,
      record: callLogRecord({ id: `cl-t3l-${n}`, telephonySessionId: `s-t3l-${n}`, direction: "Outbound", result: "No Answer", startTime, duration: 30,
        from: company, to: { phoneNumber: customer } }) as never },
    { now: () => new Date(+startTime + 120_000), directory, resolveRoute: () => null });
  };
  async function subject(i: number) {
    const customer = `+1555031${String(i).padStart(4, "0")}`;
    await applyCall(customer, new Date(Date.now() - 2 * 86_400_000 + i * MIN));
    const number = await Numbers.findOne({ e164: customer }).orFail().lean();
    const lead = { _id: oid(), timestamp: new Date(Date.now() - 3 * 86_400_000), createdAt: new Date(), updatedAt: new Date(), name: `Synthetic Live ${i}`, job_no: `T3L-${i}`,
      normalized_phone_number: customer.slice(2), pickup_city: "Boston", pickup_state: "MA", delivery_city: "Austin", delivery_state: "TX" };
    await getFormLeadModel().collection.insertOne(lead);
    await withTransaction(session => ensureLead({ model: "FormLead", id: String(lead._id) }, workerContext(session, String(oid()), new Date()), String(number._id)));
    return { lead, number, record: await Records.findOne({ "subject.id": lead._id }).orFail().lean() };
  }
  /** A call telephony still reports (webhook-only, `terminal: false`), cloned from the Number's settled call. */
  async function liveCall(numberId: unknown, startedAt: Date, extra: Record<string, unknown> = {}) {
    const base = await Interactions.findOne({ contact_number_id: numberId }).lean();
    const { _id: _ignored, ...rest } = base!;
    const _id = oid();
    await Interactions.collection.insertOne({ ...rest, _id, telephony_session_id: `live-${String(_id)}`, call_log_id: null, call_log_ids: [], started_at: startedAt,
      answered_at: null, ended_at: null, duration_seconds: null, provider_result: null, terminal: false, terminal_at: null, call_log_state: null, sources: ["webhook"],
      first_observed_at: startedAt, last_observed_at: startedAt, provider_account_id: SYNTHETIC_ACCOUNT_ID,
      parties: [{ role: "external", direction: "Outbound", e164: rest.external_e164, connected: false },
        { role: "user", direction: "Outbound", extension_id: SYNTHETIC_USER_EXTENSION.id, extension_number: SYNTHETIC_USER_EXTENSION.number, connected: true }], ...extra } as never);
    return String(_id);
  }
  async function rows(): Promise<AttentionRowDto[]> {
    const out: AttentionRowDto[] = [];
    let cursor: string | undefined;
    do {
      const page = await readAttention({ view: "all_outreach", limit: 200, ...(cursor ? { cursor } : {}) });
      out.push(...page.data.items);
      cursor = page.data.cursor ?? undefined;
    } while (cursor);
    return out;
  }
  const rowFor = async (leadId: unknown) => (await rows()).find(r => r.subject_key === `lead:FormLead:${String(leadId)}`)!;
  async function countReads<T>(work: () => Promise<T>) {
    const byCollection: Record<string, number> = {};
    let reads = 0;
    mongoose.set("debug", (collection: string, method: string) => {
      if (!READ_METHODS.has(method)) return;
      reads++;
      byCollection[`${collection}.${method}`] = (byCollection[`${collection}.${method}`] ?? 0) + 1;
    });
    try { return { result: await work(), reads, byCollection }; } finally { mongoose.set("debug", false); }
  }

  try {
    const seeded = [];
    for (let i = 0; i < 6; i++) seeded.push(await subject(i));
    const [a, b, c, d] = seeded as [typeof seeded[number], typeof seeded[number], typeof seeded[number], typeof seeded[number]];

    await t.test("C18: a terminal:false call on the primary Number within 4 h sets live_call on the row, filter_keys and the detail", async () => {
      const liveId = await liveCall(a.number._id, new Date(Date.now() - 7 * MIN));
      assert.equal((await publishAttentionSnapshot()).status, "published");
      const row = await rowFor(a.lead._id);
      assert.equal(row.outreach?.live_call?.interaction_id, liveId);
      assert.equal(row.outreach?.live_call?.direction, "Outbound");
      assert.equal(row.outreach?.live_call?.rep.kind, "unreviewed", "no reviewed link for the synthetic extension");
      assert.match(row.outreach?.live_call?.rep.text ?? "", /^ext .+ \(identity not reviewed/);
      assert.equal(row.filter_keys?.live_call, true);
      assert.equal(row.outreach?.call_progress ?? null, null, "the Owner's manual call_progress is independent");
      const other = await rowFor(b.lead._id);
      assert.equal(other.outreach?.live_call, null);
      assert.equal(other.filter_keys?.live_call, false);
      const detail = await readOutreach(String(a.record._id));
      assert.equal(detail?.data.outreach.live_call?.interaction_id, liveId, "the detail computes it at read time");
    });

    await t.test("C18: a reviewed rep identity names the rep (Case File §4.5 clause)", async () => {
      await getRepIdentityLinkModel().create({ agent_id: oid(), agent_name_snapshot: "Dana Reyes", rc_account_id: SYNTHETIC_ACCOUNT_ID, rc_extension_id: SYNTHETIC_USER_EXTENSION.id,
        rc_extension_number: SYNTHETIC_USER_EXTENSION.number, rc_extension_name_snapshot: "Dana Reyes", role_kind: "sales_rep", status: "reviewed", proposal_basis: "exact_full_name",
        effective_from: new Date(Date.now() - 400 * 86_400_000), reviewed_by: "owner@example.test", reviewed_at: new Date(Date.now() - 399 * 86_400_000),
        history: [{ at: new Date(), by: "owner@example.test", change: "reviewed" }] });
      const detail = await readOutreach(String(a.record._id));
      assert.equal(detail?.data.outreach.live_call?.rep.kind, "reviewed");
      assert.equal(detail?.data.outreach.live_call?.rep.name, "Dana Reyes");
    });

    await t.test("C18: call_progress and live_call are both carried", async () => {
      await Records.collection.updateOne({ _id: a.record._id }, { $set: { call_progress: { state: "in_progress", started_at: new Date(), started_by: "owner@example.test",
        ended_at: null, ended_by: null, note: null } } });
      const detail = await readOutreach(String(a.record._id));
      assert.equal(detail?.data.outreach.call_progress?.state, "in_progress");
      assert.ok(detail?.data.outreach.live_call);
      await Records.collection.updateOne({ _id: a.record._id }, { $unset: { call_progress: "" } });
    });

    await t.test("C18: null after settle, after 4 h, for a monitoring leg and for an Internal call", async () => {
      const settled = await liveCall(b.number._id, new Date(Date.now() - 20 * MIN));
      await Interactions.collection.updateOne({ _id: new mongoose.Types.ObjectId(settled) }, { $set: { terminal: true, call_log_state: "settled" } });
      await liveCall(c.number._id, new Date(Date.now() - 4 * 3_600_000 - MIN));
      await liveCall(d.number._id, new Date(Date.now() - 5 * MIN), { monitoring: true });
      await liveCall(seeded[4]!.number._id, new Date(Date.now() - 5 * MIN), { direction: "Internal" });
      assert.equal((await publishAttentionSnapshot()).status, "published");
      for (const s of [b, c, d, seeded[4]!]) {
        const row = await rowFor(s.lead._id);
        assert.equal(row.outreach?.live_call, null, String(s.lead.job_no));
        assert.equal(row.filter_keys?.live_call, false);
      }
      await Interactions.collection.updateOne({ contact_number_id: a.number._id, terminal: false }, { $set: { terminal: true, call_log_state: "settled" } });
      assert.equal((await publishAttentionSnapshot()).status, "published");
      assert.equal((await rowFor(a.lead._id)).outreach?.live_call, null, "settled: no longer live");
    });

    await t.test("C18: one batched live-call read per publish page; reads don't grow with rows", async () => {
      await liveCall(a.number._id, new Date(Date.now() - 3 * MIN));
      assert.equal((await publishAttentionSnapshot()).status, "published");
      await readCaptureCoverage();
      const first = await countReads(() => publishAttentionSnapshot());
      for (let i = 6; i < 40; i++) {
        const s = await subject(i);
        if (i % 7 === 0) await liveCall(s.number._id, new Date(Date.now() - 2 * MIN));
      }
      await readCaptureCoverage();
      const second = await countReads(() => publishAttentionSnapshot());
      assert.equal(first.byCollection["call_interactions.find"], 1, "one live-call $in per page");
      assert.deepEqual(second.byCollection, first.byCollection, "per-collection read counts don't grow with rows");
      console.log(`# publish reads: 6 records → ${first.reads}, 40 records → ${second.reads}`, JSON.stringify(second.byCollection));
      const live = (await rows()).filter(r => r.filter_keys?.live_call);
      assert.equal(live.length, 1 + [7, 14, 21, 28, 35].length);
    });
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
});
