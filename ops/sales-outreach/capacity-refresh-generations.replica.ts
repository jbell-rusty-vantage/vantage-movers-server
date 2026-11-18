/** W2 B synthetic replica proof. Never loads credentials or sends external effects. */
import assert from "node:assert/strict";
import { mock } from "node:test";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { BSON } from "mongodb";
if (process.argv.length !== 2) throw new Error("No target overrides accepted");
for (const key of Object.keys(process.env))
  if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
const database = `testvantagemovers_w2gen${randomUUID().replaceAll("-", "")}`;
process.env.DOTENV_CONFIG_PATH = `${__dirname}/.capacity-generations-no-dotenv.env`;
process.env.MONGO_URI = "mongodb://127.0.0.1:27216/?replicaSet=capacityp1";
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "capacity-w2gen-replica";
process.env.SHEET_SYNC_MODE = "disabled";
const noFetch = mock.method(globalThis, "fetch", async () => { throw new Error("External fetch forbidden"); });

async function main() {
  const { connectMongo, withTransaction } = await import("../../src/db.js");
  const { SALES_OUTREACH_MODEL_REGISTRY } = await import("../../src/models/salesOutreach/registry.js");
  const { getSalesIntelligenceJobModel } = await import("../../src/models/SalesIntelligenceJob.js");
  const { getSalesOutreachRefreshRequestModel } = await import("../../src/models/salesOutreach/refreshRequests.js");
  const { mongoDeskSubjectStore } = await import("../../src/services/salesOutreach/subjects/store.js");
  const { refreshLeadForOutreach } = await import("../../src/services/salesOutreach/subjects/leadChangeJob.js");
  const { deskConfiguration } = await import("../../src/services/salesOutreach/subjects/testing.js");
  const { fixedConfigurationLoader } = await import("../../src/services/salesOutreach/reads/testing.js");
  const { completeConfigurationInput } = await import("../../src/services/salesOutreach/evaluation/testing.js");
  const { requestSubjectRefresh, claimSubjectRefresh, completeSubjectRefresh, enqueueOutreachWork } = await import("../../src/services/salesOutreach/evaluation/refreshRequests.js");
  const { evaluationJob, evaluateAndProject, evaluationAdmissionOf, drainOutreachEvaluateJobs } = await import("../../src/services/salesOutreach/evaluation/evaluateJob.js");
  const { mongoEvaluationStore } = await import("../../src/services/salesOutreach/evaluation/store.js");
  const { salesOutreachConfigurationLoader } = await import("../../src/services/salesOutreach/config/load.js");
  const { runSubjectRefresh, drainSubjectRefreshes, takeSingleSlotRefreshTurn } = await import("../../src/services/salesOutreach/evaluation/refreshWorker.js");
  await connectMongo();
  const db = mongoose.connection.useDb(database, { useCache: true }).db!;
  const hello = await db.admin().command({ hello: 1 });
  assert.equal(hello.setName, "capacityp1"); assert.equal(hello.isWritablePrimary, true);
  const hosts = [...hello.hosts, ...(hello.passives ?? []), ...(hello.arbiters ?? []), hello.me, hello.primary].filter(Boolean);
  assert.ok(hosts.every(host => /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)));
  assert.match(db.databaseName, /^testvantagemovers_w2gen[a-f0-9]{32}$/);
  try {
    const beforeInstall = deskConfiguration({ ...completeConfigurationInput({ cadence_shadow_enabled: true }), refresh_requests: { version: "w2-v1", mode: "shadow", approval_ref: "synthetic" } });
    await getSalesOutreachRefreshRequestModel().createCollection();
    const defaultConfig = deskConfiguration(completeConfigurationInput({ cadence_shadow_enabled: true }));
    const disabledLoader = mock.method(salesOutreachConfigurationLoader, "inspect", async () => defaultConfig);
    try {
      assert.equal(await takeSingleSlotRefreshTurn().catch(() => false), false);
      assert.equal(await db.listCollections({ name: "sales_outreach_refresh_drain_control" }).hasNext(), false);
      assert.equal((await drainSubjectRefreshes()).skipped, "disabled", "absent rollout and empty unindexed collection do not break legacy drain");
    } finally { disabledLoader.mock.restore(); }
    await assert.rejects(withTransaction(session => requestSubjectRefresh(evaluationJob(new mongoose.Types.ObjectId().toHexString(), "missing-index"), beforeInstall, session)), /INDEX_REQUIRED|index/i);
    for (const model of [getSalesIntelligenceJobModel(), ...SALES_OUTREACH_MODEL_REGISTRY.map(entry => entry.model())]) {
      await model.createCollection(); await model.createIndexes();
    }
    for (const name of ["form_leads", "call_leads", "rep_identity_links", "granot_observations", "contact_numbers", "entity_changes", "sales_intelligence_contact_restrictions", "sales_intelligence_sync_state", "agents"])
      await db.createCollection(name);
    const base = { ...completeConfigurationInput({ cadence_shadow_enabled: true }), transition: { intake_admission_enabled: true, intake_admission_at: "2026-10-01T00:00:00.000Z" } };
    const plain = deskConfiguration(base), shadow = deskConfiguration({ ...base, refresh_requests: { version: "w2-v1", mode: "shadow", approval_ref: "synthetic" } });
    const active = deskConfiguration({ ...base, refresh_requests: { version: "w2-v1", mode: "active", approval_ref: "synthetic", parity_ref: "synthetic-parity" } });
    const now = new Date("2026-10-02T15:00:00Z"), id = new mongoose.Types.ObjectId();
    const lead = { model: "FormLead" as const, id: String(id) }, forms = db.collection("form_leads");
    await forms.insertOne({ _id: id, ingestion_origin: "wordpress_form", timestamp: new Date("2026-10-02T10:00:00Z"),
      createdAt: new Date("2026-10-02T14:00:00Z"), domain_revision: 1, name: "Synthetic generation proof", granot_priority: "0",
      phone_number: "5550100000", normalized_phone_number: "5550100000",
      last_accepted_granot_observation: { observation_id: new mongoose.Types.ObjectId(), captured_at: new Date("2026-10-02T14:01:00Z") } });
    const seed = await withTransaction(session => refreshLeadForOutreach(lead, plain, now, mongoDeskSubjectStore, session));
    const subjectId = seed.subject_id!;
    const request = (configuration = shadow, cause = "same-cause") => withTransaction(session => requestSubjectRefresh(evaluationJob(subjectId, cause), configuration, session));
    const Requests = getSalesOutreachRefreshRequestModel();
    await request(); await request();
    assert.equal((await Requests.findOne().lean())?.requested_generation, 2, "equal fingerprints still advance generation");
    const claim = (await claimSubjectRefresh())!; assert.ok(claim);
    await request(shadow, "arrived-during-completion");
    await withTransaction(session => completeSubjectRefresh(claim, { input: "test", output: "test", requirements: "test", parity: "not_observed" }, session));
    const advanced = await Requests.findOne().lean();
    assert.equal(advanced?.consumed_generation, 2); assert.equal(advanced?.requested_generation, 3); assert.equal(advanced?.pending, true);
    const dead = (await claimSubjectRefresh())!; assert.ok(dead);
    await Requests.updateOne({ _id: dead._id }, { $set: { lease_until: new Date(0) } });
    const replacement = (await claimSubjectRefresh())!; assert.ok(replacement);
    assert.equal(replacement.lease_epoch, dead.lease_epoch + 1);
    await assert.rejects(withTransaction(session => completeSubjectRefresh(dead, { input: "test", output: "test", requirements: "test", parity: "match" }, session)), /LEASE_LOST|lease/i);
    const admission = evaluationAdmissionOf(plain); assert.ok(admission.ok);
    await withTransaction(session => evaluateAndProject(subjectId, admission.context, now, mongoEvaluationStore, session));
    const snapshot = async () => {
      const data: Record<string, string> = {};
      for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
        if (name === "sales_outreach_refresh_requests") continue;
        data[name] = BSON.EJSON.stringify(await db.collection(name).find({}).sort({ _id: 1 }).toArray(), { relaxed: false });
      }
      return data;
    };
    const before = await snapshot();
    const preview = await runSubjectRefresh(replacement, fixedConfigurationLoader(shadow), now);
    assert.equal(preview.status, "completed"); assert.equal(preview.parity, "match");
    assert.deepEqual(await snapshot(), before, "shadow changes no non-request collection");
    // Exercise the normally effectful Pool dependency with a missing duty and unsnapshotted contact.
    const pool = deskConfiguration({ ...base, pool: { enabled: true, admission_enabled: false, policy_version: "pool-test", approval_ref: "synthetic" },
      refresh_requests: { version: "w2-v1", mode: "shadow", approval_ref: "synthetic" } });
    await db.collection("sales_outreach_pool_work").insertOne({ subject_id: new mongoose.Types.ObjectId(subjectId), lead_model: "FormLead", lead_id: id,
      active: true, episodes: [{ started_at: new Date(+now - 30 * 60000), ended_at: null, observation_id: new mongoose.Types.ObjectId() }],
      policy_version: "pool-test", approval_ref: "synthetic", revision: 1, accepted_observation_id: new mongoose.Types.ObjectId(), lead_revision_seen: 1 });
    const actor = new mongoose.Types.ObjectId();
    await db.collection("agents").insertOne({ _id: actor, updatedAt: new Date(+now - 86400000) });
    const contact = { _id: new mongoose.Types.ObjectId(), subject_id: new mongoose.Types.ObjectId(subjectId), source_kind: "call", source_id: new mongoose.Types.ObjectId(),
      channel: "call", direction: "outbound", kind: "attempt", event_at: now, verification: "confirmed", actor_agent_id: actor,
      goal_agent_id: null, restricted_at_contact: false, exclusion_reason: null, revision: 1 };
    await db.collection("sales_outreach_contact_events").insertOne(contact);
    const poolAdmission = evaluationAdmissionOf(pool); assert.ok(poolAdmission.ok);
    await withTransaction(session => evaluateAndProject(subjectId, poolAdmission.context, now, mongoEvaluationStore, session));
    await db.collection("sales_outreach_pool_duties").deleteMany({});
    await db.collection("sales_outreach_contact_events").updateOne({ _id: contact._id }, { $unset: { pool_caller_eligibility: 1 } });
    await request(pool, "pool-shadow");
    const poolClaim = (await claimSubjectRefresh())!;
    const poolBefore = await snapshot();
    const poolPreview = await runSubjectRefresh(poolClaim, fixedConfigurationLoader(pool), now);
    assert.equal(poolPreview.status, "completed"); assert.equal(poolPreview.parity, "match", "read-only Pool output matches the legacy evaluator");
    assert.deepEqual(await snapshot(), poolBefore, "Pool shadow cannot materialize duties, bump work, snapshot contacts or retain performance");
    await db.collection("sales_outreach_pool_work").deleteMany({});
    await db.collection("sales_outreach_contact_events").deleteMany({});
    // Queue delivery is absent: claim directly from durable Mongo state.
    await request(active, "lost-wake");
    await forms.updateOne({ _id: id }, { $set: { name: "Changed before rollback drain" } });
    await withTransaction(session => refreshLeadForOutreach(lead, plain, now, mongoDeskSubjectStore, session));
    const pendingActive = (await claimSubjectRefresh())!;
    assert.equal((await runSubjectRefresh(pendingActive, fixedConfigurationLoader(plain), now)).status, "completed", "active request drains after rollout removal");
    assert.equal((await Requests.findOne().lean())?.pending, false);
    assert.equal(await claimSubjectRefresh(), null);
    // A shadow claim cannot consume active work arriving after it; rollout removal keeps that work real.
    await request(shadow, "shadow-before-active");
    const claimedShadow = (await claimSubjectRefresh())!;
    await request(active, "active-after-shadow-claim");
    const toggleBefore = await snapshot();
    assert.equal((await runSubjectRefresh(claimedShadow, fixedConfigurationLoader(plain), now)).mode, "shadow");
    assert.deepEqual(await snapshot(), toggleBefore);
    const remainingActive = (await claimSubjectRefresh())!;
    assert.equal(remainingActive.requires_projection, true);
    assert.equal((await runSubjectRefresh(remainingActive, fixedConfigurationLoader(plain), now)).mode, "active");
    await request(active, "active-before-shadow");
    const claimedActive = (await claimSubjectRefresh())!;
    await request(shadow, "shadow-after-active-claim");
    assert.equal((await runSubjectRefresh(claimedActive, fixedConfigurationLoader(shadow), now)).mode, "active");
    assert.equal((await Requests.findOne().lean())?.pending, true);
    const compatibleDrain = (await claimSubjectRefresh())!;
    assert.equal(compatibleDrain.requires_projection, false);
    const shadowAfterActive = await snapshot();
    assert.equal((await runSubjectRefresh(compatibleDrain, fixedConfigurationLoader(plain), now)).mode, "shadow");
    assert.deepEqual(await snapshot(), shadowAfterActive);
    assert.equal((await Requests.findOne().lean())?.requires_projection, false);
    // Ordered canonical transitions are never replaced by the request generation state.
    for (const [priority, minute] of [["5", 10], ["0", 20]] as const) {
      await forms.updateOne({ _id: id }, { $set: { granot_priority: priority, last_accepted_granot_observation: {
        observation_id: new mongoose.Types.ObjectId(), captured_at: new Date(+now + minute * 60000) } } });
      await withTransaction(session => refreshLeadForOutreach(lead, plain, new Date(+now + minute * 60000), mongoDeskSubjectStore, session));
      await request(shadow, `priority:${priority}`);
    }
    assert.equal((await db.collection("sales_outreach_subjects").findOne({ _id: new mongoose.Types.ObjectId(subjectId) }))?.status, "closed", "0-to-5-to-0 never reopens immutable closure");
    assert.deepEqual((await db.collection("sales_outreach_policy_periods").find({}).sort({ started_at: 1 }).toArray()).map(row => row.workflow), ["new", "closed"]);
    const beforeInvalidators = (await Requests.findOne().lean())!.requested_generation;
    for (const cause of ["policy", "assignment", "rep_identity", "contact", "coverage", "clock", "priority_uncertain", "pool_hold", "same_priority_fresh_evidence"])
      await request(shadow, cause);
    assert.equal((await Requests.findOne().lean())!.requested_generation, beforeInvalidators + 9, "no invalidator or equal request fingerprint is cached away");
    const Jobs = getSalesIntelligenceJobModel();
    const beforeJobs = await Jobs.countDocuments();
    const configMock = mock.method(salesOutreachConfigurationLoader, "inspect", async () => active);
    try {
      assert.equal(await withTransaction(session => enqueueOutreachWork(evaluationJob(subjectId, "active-producer"), session)), null);
      assert.equal(await Jobs.countDocuments(), beforeJobs, "active producer creates no per-cause CSI row");
      configMock.mock.mockImplementation(async () => shadow);
      assert.ok(await withTransaction(session => enqueueOutreachWork(evaluationJob(subjectId, "shadow-producer"), session)));
      assert.equal(await Jobs.countDocuments(), beforeJobs + 1, "shadow producer retains legacy queue work");
    } finally { configMock.mock.restore(); }
    const recoveryInspect = mock.method(salesOutreachConfigurationLoader, "inspect", async () => plain);
    const recoveryRequire = mock.method(salesOutreachConfigurationLoader, "requireActive", async () => plain);
    try {
      const recovered = await drainSubjectRefreshes(1, 10_000);
      assert.equal(recovered.outcomes.completed, 1, "actual bounded Mongo recovery drains without any queue wake");
      assert.equal((await Requests.findOne().lean())?.pending, false);
      const { enqueueCsiJob } = await import("../../src/services/salesIntelligence/jobs.js");
      for (let i = 0; i < 4; i++) await withTransaction(session => enqueueCsiJob(evaluationJob(subjectId, `fairness:${i}`), session));
      const completedBefore = await Jobs.countDocuments({ status: "completed" });
      let refreshCompletions = 0;
      for (let i = 0; i < 8; i++) {
        await request(active, `rollback-fairness:${i}`);
        const beforeConsumed = (await Requests.findOne().lean())!.consumed_generation;
        const result = await drainOutreachEvaluateJobs({ max: 1 }, { now: () => now, publishLive: async () => undefined });
        assert.equal(result.jobs, 1, "both real workers share one slot");
        if ((await Requests.findOne().lean())!.consumed_generation > beforeConsumed) refreshCompletions++;
      }
      assert.equal(refreshCompletions, 4, "durable turns recover active-origin work with rollout removed");
      assert.equal(await Jobs.countDocuments({ status: "completed" }) - completedBefore, 4, "legacy backlog also progresses");
      assert.equal(await db.collection("sales_outreach_refresh_drain_control").countDocuments(), 1);

    } finally { recoveryInspect.mock.restore(); recoveryRequire.mock.restore(); }
    // Evaluation evidence may use an historical as-of timestamp, but it must
    // never keep an actually expired generation claim alive.
    await request(shadow, "expired-historical-as-of");
    const expiredAsOf = (await claimSubjectRefresh())!; assert.ok(expiredAsOf);
    await Requests.updateOne({ _id: expiredAsOf._id }, { $set: { lease_until: new Date(Date.now() - 1_000) } });
    assert.equal((await runSubjectRefresh(expiredAsOf, fixedConfigurationLoader(shadow), now)).status, "lease_lost");
    const afterExpiredAsOf = await Requests.findById(expiredAsOf._id).lean();
    assert.equal(afterExpiredAsOf?.consumed_generation, expiredAsOf.consumed_generation,
      "expired completion never consumes its requested generation");
    assert.equal(afterExpiredAsOf?.pending, true, "expired work remains available for recovery");
    assert.equal(noFetch.mock.callCount(), 0);
    console.log("PASS W2 B: conservative generations, request during completion, worker death/expired lease, stale-owner refusal, lost-wake Mongo recovery, shadow whole-database no-write parity, rollout-off drain, ordered 0-to-5-to-0 closure");
  } finally { assert.match(db.databaseName, /^testvantagemovers_w2gen[a-f0-9]{32}$/); await db.dropDatabase(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { noFetch.mock.restore(); await mongoose.disconnect(); });
