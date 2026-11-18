/** W2 A proof: synthetic data on a fixed disposable loopback replica, no dotenv/provider calls. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

if (process.argv.length !== 2) throw new Error("No target overrides accepted");
for (const key of Object.keys(process.env))
  if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
const database = `testvantagemovers_capacityw2${randomUUID().replaceAll("-", "")}`;
process.env.DOTENV_CONFIG_PATH = `${__dirname}/.capacity-refresh-no-dotenv.env`;
process.env.MONGO_URI = "mongodb://127.0.0.1:27216/?replicaSet=capacityp1";
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "capacity-w2-replica";
process.env.SHEET_SYNC_MODE = "disabled";

async function main() {
  const { connectMongo, withTransaction } = await import("../../src/db.js");
  const { SALES_OUTREACH_MODEL_REGISTRY } = await import("../../src/models/salesOutreach/registry.js");
  const { getSalesIntelligenceJobModel } = await import("../../src/models/SalesIntelligenceJob.js");
  const { enqueueCsiJob } = await import("../../src/services/salesIntelligence/jobs.js");
  const { mongoDeskSubjectStore } = await import("../../src/services/salesOutreach/subjects/store.js");
  const { refreshLeadForOutreach, runOutreachLeadChangeJob } = await import("../../src/services/salesOutreach/subjects/leadChangeJob.js");
  const { deskConfiguration } = await import("../../src/services/salesOutreach/subjects/testing.js");
  const { fixedConfigurationLoader } = await import("../../src/services/salesOutreach/reads/testing.js");
  await connectMongo();
  const db = mongoose.connection.useDb(database, { useCache: true }).db!;
  const Jobs = getSalesIntelligenceJobModel();
  for (const model of [Jobs, ...SALES_OUTREACH_MODEL_REGISTRY.map(entry => entry.model())]) {
    await model.createCollection(); await model.createIndexes();
  }
  for (const name of ["form_leads", "call_leads", "rep_identity_links", "granot_observations", "contact_numbers"])
    await db.createCollection(name);
  const configuration = deskConfiguration({ transition: { intake_admission_enabled: true, intake_admission_at: "2026-10-01T00:00:00.000Z" } });
  const loader = fixedConfigurationLoader(configuration);
  const now = () => new Date("2026-10-02T15:00:00Z");
  const id = new mongoose.Types.ObjectId();
  const lead = { model: "FormLead" as const, id: String(id) };
  const forms = db.collection("form_leads");
  await forms.insertOne({ _id: id, ingestion_origin: "wordpress_form", timestamp: new Date("2026-10-02T10:00:00Z"),
    createdAt: new Date("2026-10-02T14:00:00Z"), domain_revision: 1, name: "Synthetic capacity proof", granot_priority: "0",
    phone_number: "5550100000", normalized_phone_number: "5550100000",
    last_accepted_granot_observation: { observation_id: new mongoose.Types.ObjectId(), captured_at: new Date("2026-10-02T14:01:00Z") } });
  const initial = await withTransaction(session => refreshLeadForOutreach(lead, configuration, now(), mongoDeskSubjectStore, session));
  assert.equal(initial.evaluation_requested, true);
  const callback = async (receipt: string) => withTransaction(session => enqueueCsiJob({ stage: "outreach_lead_change",
    subject_key: `outreach-lead:FormLead:${id}`, dedupe_key: `sod:lead-change:FormLead:${id}:estimates-refresh:${receipt}`,
    input_revision: 1, input_refs: [String(id)] }, session));
  const run = (jobId: string) => runOutreachLeadChangeJob(jobId, { loader, now, store: mongoDeskSubjectStore });
  await forms.updateOne({ _id: id }, { $set: { last_accepted_granot_observation: {
    observation_id: new mongoose.Types.ObjectId(), captured_at: new Date("2026-10-02T14:30:00Z") } } });
  const first = await callback("fresh");
  const fresh = await run(String(first._id));
  assert.equal(fresh.status, "completed"); assert.equal(fresh.result?.evaluation_requested, true);
  assert.equal(await Jobs.countDocuments({ stage: "outreach_evaluate" }), 2, "one evaluation per changed revision, no receipt duplicate");
  assert.equal(await db.collection("sales_outreach_policy_periods").countDocuments({}), 1, "freshness preserves same-priority period");
  const duplicate = await callback("duplicate");
  const duplicates = await Promise.all([run(String(duplicate._id)), run(String(duplicate._id))]);
  assert.equal(duplicates.filter(result => result.status === "completed").length, 1, "lease admits one duplicate callback");
  assert.equal(await Jobs.countDocuments({ stage: "outreach_evaluate" }), 3, "unchanged callback retains repair evaluation");
  assert.equal((await run(String(duplicate._id))).status, "not_claimable");
  await forms.updateOne({ _id: id }, { $inc: { domain_revision: 1 } });
  const bookkeeping = await callback("bookkeeping");
  const book = await run(String(bookkeeping._id));
  assert.equal(book.result?.outcome, "updated"); assert.equal(book.result?.evaluation_requested, false);
  assert.equal(await Jobs.countDocuments({ stage: "outreach_evaluate" }), 4);
  const before = await db.collection("sales_outreach_subjects").findOne({ lead_id: id });
  await forms.updateOne({ _id: id }, { $set: { name: "Changed" } });
  const failed = await callback("rollback");
  const failedResult = await runOutreachLeadChangeJob(String(failed._id), { loader, now, store: {
    ...mongoDeskSubjectStore, requestEvaluation: async (subjectId, revision, session) => {
      await mongoDeskSubjectStore.requestEvaluation(subjectId, revision, session);
      throw new Error("Injected failure after nomination");
    },
  } });
  assert.equal(failedResult.status, "retry");
  assert.deepEqual(await db.collection("sales_outreach_subjects").findOne({ lead_id: id }), before);
  assert.equal(await Jobs.countDocuments({ stage: "outreach_evaluate" }), 4, "aborted callback rolls back durable nomination");
  await Jobs.updateOne({ _id: failed._id }, { $set: { next_attempt_at: new Date(0) } });
  assert.equal((await run(String(failed._id))).result?.evaluation_requested, true);
  assert.equal(await Jobs.countDocuments({ stage: "outreach_evaluate" }), 5);
  console.log("PASS W2 A: fresh evidence, revision-only suppression, concurrent duplicate lease, unchanged repair, bookkeeping repair, transactional rollback and retry");
  await db.dropDatabase();
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect());
