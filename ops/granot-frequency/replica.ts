/** Isolated joined cadence proof. Never loads dotenv or provider credentials. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import mongoose from 'mongoose';
const database = `testvantagemovers_frequency${process.pid}`;
for (const key of Object.keys(process.env)) if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|REDIS|UPSTASH|GOOGLE|SHEET|GRANOT|TWILIO|SENDGRID|MONGO|DOTENV/i.test(key)) delete process.env[key];
const missingEnv = `${__dirname}/.never-load.env`;
assert.equal(existsSync(missingEnv), false);
Object.assign(process.env, { TEST_MODE: 'true', TEST_MONGO_DATABASE_NAME: database, DOTENV_CONFIG_PATH: missingEnv,
  MONGO_URI: 'mongodb://127.0.0.1:27189/?replicaSet=csi01', SHEET_SYNC_MODE: 'queued',
  TEST_MASTER_LEADS_SHEET_ID: 'synthetic-frequency-master', TEST_MASTER_BOOKED_SHEET_ID: 'synthetic-frequency-booked',
  SALES_INTELLIGENCE_DEPLOYMENT_ID: 'frequency-proof' });

async function main() {
  await import('../test-setup.js');
  const { connectMongo, withTransaction } = await import('../../src/db.js');
  const { getCallLeadModel } = await import('../../src/models/CallLead.js');
  const { getFormLeadModel } = await import('../../src/models/FormLead.js');
  const { getEntityChangeModel } = await import('../../src/models/EntityChange.js');
  const { DomainCommandExecution } = await import('../../src/models/DomainCommandExecution.js');
  const { SheetSyncJob } = await import('../../src/models/SheetSyncJob.js');
  const { getSalesIntelligenceJobModel } = await import('../../src/models/SalesIntelligenceJob.js');
  const { getSalesIntelligenceSyncStateModel } = await import('../../src/models/SalesIntelligenceSyncState.js');
  const { SALES_OUTREACH_MODEL_REGISTRY } = await import('../../src/models/salesOutreach/registry.js');
  const { getSalesOutreachSubjectModel, getSalesOutreachPolicyPeriodModel } = await import('../../src/models/salesOutreach/index.js');
  const { mirrorFormLeadToCallSibling } = await import('../../src/services/granotLifecycle/callLeadFormSibling.js');
  const { planJobWrites } = await import('../../src/services/sheetSync/drainer/jobPlanner.js');
  const { mongoDeskSubjectStore } = await import('../../src/services/salesOutreach/subjects/store.js');
  const { refreshLeadForOutreach, runOutreachLeadChangeJob } = await import('../../src/services/salesOutreach/subjects/leadChangeJob.js');
  const { scanOutreachLeadChanges, mongoOutreachFeedStore, OUTREACH_LEAD_CHANGE_SCOPE, leadChangeJobInput } = await import('../../src/services/salesOutreach/subjects/feed.js');
  const { deskConfiguration } = await import('../../src/services/salesOutreach/subjects/testing.js');
  const { fixedConfigurationLoader } = await import('../../src/services/salesOutreach/reads/testing.js');
  const { enqueueCsiJob } = await import('../../src/services/salesIntelligence/jobs.js');
  await connectMongo();
  assert.equal(mongoose.connection.host, '127.0.0.1'); assert.equal(mongoose.connection.name, database);
  assert.equal((await mongoose.connection.db!.admin().command({ hello: 1 })).setName, 'csi01');
  const Calls = getCallLeadModel(), Forms = getFormLeadModel(), Changes = getEntityChangeModel(), Jobs = getSalesIntelligenceJobModel(), State = getSalesIntelligenceSyncStateModel();
  const Subjects = getSalesOutreachSubjectModel(), Periods = getSalesOutreachPolicyPeriodModel();
  try {
    for (const model of [Calls, Forms, Changes, Jobs, State, DomainCommandExecution, SheetSyncJob, ...SALES_OUTREACH_MODEL_REGISTRY.map(entry => entry.model())]) { await model.createCollection(); await model.createIndexes(); }
    const config = deskConfiguration({ transition: { intake_admission_enabled: true, intake_admission_at: '2026-10-01T00:00:00Z' } });
    const loader = fixedConfigurationLoader(config), oid = () => new mongoose.Types.ObjectId();
    const formId = oid(), callId = oid(), company = oid(), now = new Date();
    const form = { _id: formId, domain_revision: 1, name: 'Synthetic Pair', source_company: 'main_site', lead_source_company: company,
      ingestion_origin: 'wordpress_form', timestamp: new Date('2026-11-04T10:00:00Z'), createdAt: new Date('2026-11-04T15:00:00Z'),
      duplicate: false, job_no: 'P1234567', normalized_job_no: 'P1234567', granot_priority: '0',
      phone_number: '5550100000', normalized_phone_number: '5550100000',
      last_accepted_granot_observation: { observation_id: oid(), captured_at: new Date('2026-11-04T15:00:01Z') } };
    await Forms.collection.insertOne(form);
    await Calls.collection.insertOne({ ...form, _id: callId, ingestion_origin: 'ringcentral', domain_revision: 0,
      form_fill: true, no_sync: true, granot_priority: '2', ringcentral: { ingestion_source: 'call_log_sync',
        qualification_reason: 'call_log_inbound_target_elapsed_at_least_120s', duration_seconds: 150, call_log_id: 'synthetic-pair' },
      sheet_sync: [{ target: 'master_duplicate_calls', status: 'synced', row_number: 2 }] });
    const ref = { model: 'FormLead' as const, id: String(formId) };
    const first = await withTransaction(session => refreshLeadForOutreach(ref, config, now, mongoDeskSubjectStore, session));
    assert.equal(first.status, 'review'); assert.equal(await Periods.countDocuments(), 0);
    await withTransaction(session => enqueueCsiJob(leadChangeJobInput(ref, 1), session));
    const revisionJob = await Jobs.findOne({ dedupe_key: leadChangeJobInput(ref, 1).dedupe_key }).lean();
    await runOutreachLeadChangeJob(String(revisionJob!._id), { loader });
    assert.equal((await Jobs.findById(revisionJob!._id).lean())?.status, 'completed');
    // An exported receiver change nominates a generic canonical update despite Duplicate-only metadata.
    const agentId = oid();
    await Forms.collection.updateOne({ _id: formId }, { $set: { receiver_agent: agentId, receiver_agent_name_snapshot: 'Synthetic Rep', receiver_agent_source: 'granot_username_match' } });
    const mirror = await mirrorFormLeadToCallSibling(String(formId), { kind: 'owner_backfill', run_id: 'synthetic-frequency' });
    assert.equal(mirror.outcome, 'updated'); assert.equal(mirror.sheet, true);
    const sheetJob = await SheetSyncJob.findOne({ entity_id: String(callId) }); assert.ok(sheetJob);
    const writes = (await planJobWrites(sheetJob)).flatMap(plan => plan.writes);
    assert.deepEqual(writes.filter(write => write.op === 'upsert').map(write => write.tabName), ['Duplicate Calls']);
    const counts = [await Changes.countDocuments(), await SheetSyncJob.countDocuments(), await DomainCommandExecution.countDocuments()];
    assert.equal((await mirrorFormLeadToCallSibling(String(formId), { kind: 'owner_backfill', run_id: 'synthetic-frequency' })).outcome, 'already_current');
    assert.deepEqual([await Changes.countDocuments(), await SheetSyncJob.countDocuments(), await DomainCommandExecution.countDocuments()], counts);
    const change = await Changes.findOne({ command_name: 'mirrorFormLeadToCallSibling' }).lean(); assert.ok(change);
    // Failure after nominations but before cursor commit rolls the entire transaction back.
    await assert.rejects(scanOutreachLeadChanges(new Date(), { loader, store: { ...mongoOutreachFeedStore,
      writeTailCursor: async () => { throw new Error('synthetic-cursor-crash'); } } }), /synthetic-cursor-crash/);
    assert.equal(await Jobs.countDocuments({ dedupe_key: /:related:/ }), 0);
    assert.equal(await State.countDocuments({ scope: OUTREACH_LEAD_CHANGE_SCOPE }), 0);
    await scanOutreachLeadChanges(new Date(), { loader });
    const related = await Jobs.findOne({ dedupe_key: /:related:/ }).lean(); assert.ok(related);
    assert.deepEqual(related.input_refs.map(String), [String(formId), String(callId)]);
    assert.ok(await State.exists({ scope: OUTREACH_LEAD_CHANGE_SCOPE }));
    // A worker restart after the cursor committed finds the durable job.
    assert.equal((await runOutreachLeadChangeJob(String(related._id), { loader })).result?.status, 'active');
    assert.equal(await Periods.countDocuments({ subject_id: first.subject_id }), 1);
    const before = await Subjects.findById(first.subject_id).lean();
    const periods = await Periods.find().lean();
    await scanOutreachLeadChanges(new Date(), { loader });
    assert.equal(await Jobs.countDocuments({ dedupe_key: /:related:/ }), 1);
    assert.equal((await runOutreachLeadChangeJob(String(related._id), { loader })).status, 'not_claimable');
    assert.deepEqual(await Periods.find().lean(), periods);
    assert.equal((await Subjects.findById(first.subject_id).lean())?.revision, before?.revision);
    assert.equal((await Forms.findById(formId).lean())?.domain_revision, 1, 'no fabricated Form revision');
    for (const scenario of [
      { name:'normal', target:'master_calls', noSync:false, formFill:false, expected:'Calls' },
      { name:'bad', target:'master_bad_calls', noSync:true, formFill:false, expected:'Bad Call Leads' },
      { name:'hidden', target:'master_calls', noSync:true, formFill:false, expected:null },
      { name:'undelivered', target:null, noSync:false, formFill:true, expected:null },
      { name:'priority-only', target:'master_duplicate_calls', noSync:false, formFill:true, expected:null },
      { name:'unadmitted', target:'master_calls', noSync:false, formFill:false, expected:null },
    ]) {
      const fid = oid(), cid = oid(), job = `P${String(fid).slice(-7)}`.toUpperCase();
      const receiver = { receiver_agent:agentId, receiver_agent_name_snapshot:'Synthetic Rep', receiver_agent_source:'granot_username_match' };
      await Forms.collection.insertOne({ ...form, _id:fid, job_no:job, normalized_job_no:job, ...receiver });
      await Calls.collection.insertOne({ ...form, _id:cid, job_no:job, normalized_job_no:job, domain_revision:0,
        granot_priority:'2', form_fill:scenario.formFill, no_sync:scenario.noSync,
        ...(scenario.name === 'priority-only' ? receiver : {}),
        ringcentral: scenario.name === 'unadmitted' ? null : {
          ingestion_source:'call_log_sync', qualification_reason:'call_log_inbound_target_elapsed_at_least_120s', duration_seconds:150,
          call_log_id:`proof-${cid}`, ...(scenario.name === 'bad' ? {start_time:new Date('2026-11-04T07:00:00Z'), final_result:'Missed', final_result_answered:false, final_result_call_log_id:`proof-${cid}`, final_result_observed_at:now} : {}),
        },
        sheet_sync:scenario.target ? [{target:scenario.target,status:'synced',row_number:3}] : [],
      });
      const result = await mirrorFormLeadToCallSibling(String(fid), {kind:'owner_backfill',run_id:'synthetic-frequency'});
      assert.equal(result.sheet, scenario.expected !== null, scenario.name);
      const intent = await SheetSyncJob.findOne({entity_id:String(cid)});
      if (scenario.expected) {
        assert.ok(intent);
        assert.deepEqual((await planJobWrites(intent)).flatMap(plan => plan.writes).filter(write => write.op === 'upsert').map(write => write.tabName), [scenario.expected]);
      } else assert.equal(intent, null);
    }
    console.log('PASS joined pair: real mirror/outbox/exclusive planner, no-op write counts, held Form, completed revision, cursor rollback, committed wake recovery, replay, stable period');
  } finally { assert.equal(mongoose.connection.name, database); await mongoose.connection.db!.dropDatabase(); await mongoose.disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

