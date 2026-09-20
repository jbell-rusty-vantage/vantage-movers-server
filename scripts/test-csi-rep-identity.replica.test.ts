import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import express, { type Request } from "express";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { applyCsiMigration } from "./migrations/sales-intelligence.lib";
import { Agent } from "../src/models/Agent";
import { getRepIdentityLinkModel } from "../src/models/RepIdentityLink";
import { getRingCentralDirectorySnapshotModel } from "../src/models/RingCentralDirectorySnapshot";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceAuditEventModel } from "../src/models/SalesIntelligenceAuditEvent";
import { getCallInteractionModel } from "../src/models/CallInteraction";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getFormLeadModel } from "../src/models/FormLead";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../src/models/OutreachFollowup";
import { getLeadConversationModel } from "../src/models/LeadConversation";
import { requireCsiOwner } from "../src/services/salesIntelligence/auth";
import { computeAdminActorSignature } from "../src/services/operationsRegistry/trustedActor";
import { createRepLink, proposeRepLinks, reviewRepLink } from "../src/services/salesIntelligence/repIdentity/commands";
import { listRepLinks, readRepLink, repLinkDtoSchema } from "../src/services/salesIntelligence/repIdentity/reads";
import { resolveRepIdentities } from "../src/services/salesIntelligence/repIdentity/resolve";
import { runRepIdentityReevaluationJob } from "../src/services/salesIntelligence/repIdentity/worker";
import { scheduleRepIdentityReevaluation } from "../src/services/salesIntelligence/repIdentity/scheduling";
import { ensureInteraction, ensureLead, workerContext } from "../src/services/salesIntelligence/outreach/ensure";
import { runOutreachEnsureJob } from "../src/services/salesIntelligence/outreach/worker";
import { commandOutreach } from "../src/services/salesIntelligence/followups/commands";
import { persistLeadAttachments } from "../src/services/salesIntelligence/attachment/store";
import { loadEligibilityInputs } from "../src/services/salesIntelligence/conversations/eligibility";
import { scheduleTranscriptionJobs } from "../src/services/salesIntelligence/conversations/transcriptionScheduling";
import { dispatchCsiWakeup } from "../src/services/numberActivity/jobDispatch";

test("CSI-10 disposable replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 240000 }, async t => {
  assert.match(getMongoDatabaseName(), /^testvantagemovers_csi10[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo(); const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello:1 })).setName,"csi01"); await applyCsiMigration();
  const oid = () => new mongoose.Types.ObjectId(), at = new Date("2026-09-01T12:00:00Z"), boundary = new Date("2026-09-10T12:00:00Z");
  const request: Request = Object.assign(Object.create(express.request), { method:"POST", originalUrl:"/api/v1/admin/sales-intelligence/reps",
    headers:{}, vantageAuth:{ kind:"user", userId:"synthetic-owner", email:"owner@example.test", roles:["owner"] } });
  const fields = { adminId:"synthetic-owner", email:"owner@example.test", role:"owner", timestamp:String(Date.now()), requestId:"csi10-proof", method:request.method, path:request.originalUrl };
  request.headers = { "x-vantage-admin-user-id":fields.adminId, "x-vantage-admin-email":fields.email, "x-vantage-admin-role":fields.role,
    "x-vantage-admin-timestamp":fields.timestamp, "x-vantage-admin-request-id":fields.requestId,
    "x-vantage-admin-signature":computeAdminActorSignature(fields,process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!) };
  const actor = requireCsiOwner(request), Links = getRepIdentityLinkModel(), Jobs = getSalesIntelligenceJobModel();
  const [alex,jordan] = await Agent.create([{ name:"Alex Reed", normalized_name:"alex reed", name_aliases:["Shared Alias"] },
    { name:"Jordan Lee", normalized_name:"jordan lee", name_aliases:["Shared Alias"] }]);
  const officialAgentsBefore = JSON.stringify(await Agent.find().sort({ _id:1 }).lean());
  const ext = (id: string, name = "Jordan Lee", type = "User") => ({ id, name, type, status:"Enabled", extension_number:id, direct_numbers:["+12025550101"], sms_sender_numbers:[] });
  const extensions = [ext("101"),ext("102","Shared Alias"),ext("103","No Match"),ext("104","Alex Reed"),ext("105","Alex Reed","Department"),ext("106"),ext("107"),ext("108")];
  const snapshot = await getRingCentralDirectorySnapshotModel().create({ provider_account_id:"synthetic", taken_at:at, digest:"synthetic-roster", extensions,
    counts:{ extensions:extensions.length, users:7, departments:1, company_numbers:0, queues:0 } });
  await getRingCentralDirectorySnapshotModel().create({ provider_account_id:"other", taken_at:at, digest:"other-roster", extensions:[ext("101")],
    counts:{ extensions:1, users:1, departments:0, company_numbers:0, queues:0 } });
  const linkInput = (agent_id = String(jordan!._id), rc_extension_id = "101", rc_account_id = "synthetic") => ({ agent_id, rc_extension_id, rc_account_id,
    role_kind:"sales_rep" as const, effective_from:at.toISOString(), effective_to:null as string | null, nudge_channels_allowed:[] });
  const receipt = (result: Awaited<ReturnType<typeof createRepLink>>) => z.object({ link:repLinkDtoSchema }).parse(result.response).link;
  const create = async (link: ReturnType<typeof linkInput>) => receipt(await createRepLink({ actor,idempotency_key:String(oid()),body:{ expected_revision:1,link,reason:"Synthetic Owner proposal" } }));
  const review = async (id: string, expected_revision: number, link: ReturnType<typeof linkInput>, status = "reviewed", key = String(oid())) =>
    reviewRepLink({ actor,id,idempotency_key:key,body:{ expected_revision,link,status,reason:"Synthetic Owner review" } });
  const resolve = (account: string, extension: string, when: Date) => resolveRepIdentities(account,[extension],when);
  const dump = async () => JSON.stringify(await Promise.all((await db.listCollections().toArray()).sort((a,b) => a.name.localeCompare(b.name)).map(async c => [c.name,await db.collection(c.name).find().sort({ _id:1 }).toArray()])));
  try {
    await t.test("proposal run exact remains proposed, ambiguous and unmatched remain visible without invented links", async () => {
      const initial=await listRepLinks({ rc_account_id:"synthetic",limit:100 });
      assert.ok(initial.directory.users.every(user=>user.status==="not_proposed")); assert.equal(await Links.countDocuments(),0);
      const body = { expected_revision:1,rc_account_id:"synthetic",directory_snapshot_id:String(snapshot._id),reason:"Stored evidence" };
      await proposeRepLinks({ actor,idempotency_key:"proposal-1",body });
      assert.equal((await Links.findOne({ rc_extension_id:"101" }))?.status,"proposed");
      assert.equal(await Links.countDocuments({ rc_extension_id:{ $in:["102","103","105"] } }),0);
      const page = await listRepLinks({ rc_account_id:"synthetic",limit:100 });
      assert.equal(page.directory.users.find(u=>u.extension_id==="102")?.status,"ambiguous");
      assert.equal(page.directory.users.find(u=>u.extension_id==="103")?.status,"unmatched");
      assert.equal((await resolve("synthetic","101",boundary)).agent_ids.length,0);
      assert.equal((await listRepLinks({ rc_account_id:"missing",limit:10 })).directory.status,"missing");
    });
    await t.test("review replay, changed payload and stale revision; reruns preserve decisions", async () => {
      const row = await Links.findOne({ rc_account_id:"synthetic",rc_extension_id:"101" }).orFail(), key="review-101";
      const result = await review(String(row._id),row.revision,linkInput(),"reviewed",key);
      assert.deepEqual((await review(String(row._id),row.revision,linkInput(),"reviewed",key)).response,result.response);
      await assert.rejects(review(String(row._id),row.revision,{ ...linkInput(),nudge_channels_allowed:["pager"] } as ReturnType<typeof linkInput>,"reviewed",key),/IDEMPOTENCY_CONFLICT/);
      await assert.rejects(review(String(row._id),row.revision,linkInput()),/REVISION_CONFLICT/);
      const before = JSON.stringify(await Links.findById(row._id).lean());
      await proposeRepLinks({ actor,idempotency_key:"proposal-2",body:{ expected_revision:1,rc_account_id:"synthetic",directory_snapshot_id:String(snapshot._id),reason:"Repeat" } });
      assert.equal(JSON.stringify(await Links.findById(row._id).lean()),before);
    });
    await t.test("non-User target rejects; account scope and multiple extensions per Agent", async () => {
      await assert.rejects(create(linkInput(String(alex!._id),"105")),/IDENTITY_BLOCKED/);
      const other = await create(linkInput(String(alex!._id),"101","other")); assert.equal(other.status,"proposed");
      await review(other.id,other.revision,linkInput(String(alex!._id),"101","other"));
      const second = await Links.findOne({ rc_account_id:"synthetic",rc_extension_id:"106" }).orFail(); await review(String(second._id),second.revision,linkInput(String(jordan!._id),"106"));
      assert.deepEqual((await resolve("synthetic","101",boundary)).agent_ids,[String(jordan!._id)]);
      assert.deepEqual((await resolve("other","101",boundary)).agent_ids,[String(alex!._id)]);
      assert.deepEqual((await resolve("synthetic","106",boundary)).agent_ids,[String(jordan!._id)]);
    });
    await t.test("concurrent competing assignments serialize; historical overlaps reject even without open ends", async () => {
      const row = await Links.findOne({ rc_extension_id:"107" }).orFail();
      const race = await Promise.allSettled([review(String(row._id),row.revision,linkInput(String(alex!._id),"107")),review(String(row._id),row.revision,linkInput(String(jordan!._id),"107"))]);
      assert.equal(race.filter(r=>r.status==="fulfilled").length,1);
      assert.equal(race.filter(r=>r.status==="rejected").length,1);
      const finite = { ...linkInput(String(alex!._id),"103"),effective_to:boundary.toISOString() };
      const historical = await create(finite); await review(historical.id,historical.revision,finite);
      await assert.rejects(create({ ...finite,effective_from:new Date(+at+1).toISOString() }),/IDENTITY_BLOCKED/);
      await assert.rejects(create({ ...finite,effective_to:at.toISOString() }),/Invalid|effective/);
    });
    await t.test("atomic reassignment boundaries and retirement preserve reviewed historical identity", async () => {
      const row=await Links.findOne({ rc_extension_id:"101",rc_account_id:"synthetic" }).orFail();
      const successorInput={ ...linkInput(String(alex!._id)),effective_from:boundary.toISOString() };
      const successor=receipt(await review(String(row._id),row.revision,successorInput));
      assert.deepEqual((await resolve("synthetic","101",new Date(+boundary-1))).agent_ids,[String(jordan!._id)]);
      assert.deepEqual((await resolve("synthetic","101",boundary)).agent_ids,[String(alex!._id)]);
      assert.deepEqual((await resolve("synthetic","101",new Date(+boundary+1))).agent_ids,[String(alex!._id)]);
      const retiredAt=new Date("2026-09-12T12:00:00Z");
      await review(successor.id,successor.revision,{ ...successorInput,effective_to:retiredAt.toISOString() },"retired");
      assert.deepEqual((await resolve("synthetic","101",boundary)).agent_ids,[String(alex!._id)]);
      assert.equal((await resolve("synthetic","101",retiredAt)).agent_ids.length,0);
      const proposal=await Links.findOne({ rc_extension_id:"108" }).orFail();
      await review(String(proposal._id),proposal.revision,{ ...linkInput(String(jordan!._id),"108"),effective_to:boundary.toISOString() },"retired");
      assert.equal((await resolve("synthetic","108",new Date(+at+1))).agent_ids.length,0);
    });
    await t.test("GET services are read-only, paginate, expose unknown metrics", async () => {
      const before=await dump(), list=await listRepLinks({ rc_account_id:"synthetic",limit:2 });
      assert.ok(list.next_cursor); assert.ok(list.directory.next_cursor);
      const detail=await readRepLink(list.items[0]!.id); assert.equal(detail?.link.metrics.interactions_total,null);
      assert.equal(await dump(),before);
    });
    await t.test("incomplete directory blocks Owner creation; retired history is not overwritten by proposal reruns", async () => {
      await getRingCentralDirectorySnapshotModel().create({ provider_account_id:"incomplete",taken_at:at,digest:"incomplete",extensions:[ext("101")],
        counts:{ extensions:2,users:2,departments:0,company_numbers:0,queues:0 } });
      assert.equal((await listRepLinks({ rc_account_id:"incomplete",limit:10 })).directory.status,"incomplete");
      await assert.rejects(create(linkInput(String(alex!._id),"101","incomplete")),/IDENTITY_BLOCKED/);
      const before=JSON.stringify(await Links.find({ rc_extension_id:{ $in:["101","108"] } }).sort({ _id:1 }).lean());
      await proposeRepLinks({ actor,idempotency_key:"proposal-after-retirement",body:{ expected_revision:1,rc_account_id:"synthetic",directory_snapshot_id:String(snapshot._id),reason:"Repeat after retirement" } });
      assert.equal(JSON.stringify(await Links.find({ rc_extension_id:{ $in:["101","108"] } }).sort({ _id:1 }).lean()),before);
    });
    await t.test("unchanged call revision re-evaluates durably; Owner assignments, unassignment, actions and closure survive", async () => {
      const proposal=await Links.findOne({ rc_extension_id:"104" }).orFail();
      const number=await getContactNumberModel().create({ e164:"+12025550110",digits_reversed:"01105552021",first_observed_at:at,last_activity_at:boundary });
      const receiver=oid(), lead={ _id:oid(),timestamp:at,createdAt:at,updatedAt:at,name:"Synthetic identity call",normalized_phone_number:number.e164,receiver_agent:receiver };
      await getFormLeadModel().collection.insertOne(lead);
      await withTransaction(async session=>{ await persistLeadAttachments(lead,"FormLead",session,String(oid()),at); await ensureLead({ model:"FormLead",id:String(lead._id) },workerContext(session,String(oid())),String(number._id)); });
      const call=await getCallInteractionModel().create({ provider_account_id:"synthetic",telephony_session_id:"identity-call",identity_basis:"telephony_session_id",
        contact_number_id:number._id,direction:"Outbound",started_at:new Date(+at+60000),first_observed_at:at,last_observed_at:at,terminal:true,contact_type:"human_conversation",
        parties:[{ role:"user",extension_id:"104",direction:"Outbound",connected:true }] });
      await withTransaction(s=>ensureInteraction(call,workerContext(s,String(oid()))));
      const Records=getOutreachRecordModel(), Actions=getOutreachFollowupModel();
      let record=await Records.findOne({ "subject.id":lead._id }).orFail(); assert.equal(record.responsible_agent_id,null); assert.equal(record.state,"open");
      const action=await Actions.create({ outreach_record_id:record._id,commitment_key:"unknown-promise",kind:"send_estimate",description:"Unknown promising speaker",origin:"rep_promise",due_at:null,source_interaction_id:call._id });
      const commandResult=await review(String(proposal._id),proposal.revision,linkInput(String(alex!._id),"104"));
      const jobId=z.object({ reevaluation_job_id:z.string() }).parse(commandResult.response).reevaluation_job_id;
      const dispatched=await dispatchCsiWakeup({ job_id:jobId }); assert.equal(dispatched.status,"dispatched");
      const reapply=await Jobs.findOne({ stage:"outreach_ensure",input_refs:call._id }).orFail();
      assert.equal((await runOutreachEnsureJob(String(reapply._id))).status,"completed");
      record=await Records.findById(record._id).orFail(); assert.equal(String(record.responsible_agent_id),String(alex!._id));
      assert.equal((await Actions.findById(action._id))?.responsible_agent_id,null);
      await commandOutreach({ actor,target_id:String(action._id),idempotency_key:String(oid()),command:{ command:"patch_followup",expected_revision:action.revision,
        changes:{ responsible_agent_id:String(jordan!._id) },reason:"Owner action assignment" } });
      const ownerActionBefore=JSON.stringify(await Actions.findById(action._id).lean());
      assert.equal((await getCallInteractionModel().findById(call._id))?.projection_revision,call.projection_revision);
      const applied=await getSalesIntelligenceAuditEventModel().find({ event_kind:"outreach_call_applied","current.interaction_id":String(call._id) }).lean(); assert.equal(applied.length,2);
      for (const responsible_agent_id of [String(jordan!._id),null]) {
        record=await Records.findById(record._id).orFail();
        await commandOutreach({ actor,target_id:String(record._id),idempotency_key:String(oid()),command:{ command:"assign",expected_revision:record.revision,responsible_agent_id } });
        // A different identity fingerprint must still preserve explicit Owner null.
        const currentLink=await Links.findById(proposal._id).orFail(); await Links.updateOne({ _id:currentLink._id },{ $inc:{ revision:1 } });
        await withTransaction(s=>ensureInteraction(call,workerContext(s,String(oid()))));
        const updated=await Records.findById(record._id).orFail(); assert.equal(updated.responsible_agent_id ? String(updated.responsible_agent_id):null,responsible_agent_id);
        assert.equal(JSON.stringify(await Actions.findById(action._id).lean()),ownerActionBefore);
      }
      record=await Records.findById(record._id).orFail();
      await commandOutreach({ actor,target_id:String(record._id),idempotency_key:String(oid()),command:{ command:"close",expected_revision:record.revision,reason:"owner_dismissed" } });
      await Links.updateOne({ _id:proposal._id },{ $inc:{ revision:1 } }); await withTransaction(s=>ensureInteraction(call,workerContext(s,String(oid()))));
      assert.equal((await Records.findById(record._id))?.state,"closed"); assert.equal((await Actions.findById(action._id))?.status,"cancelled");
      assert.equal(String((await getFormLeadModel().findById(lead._id))?.receiver_agent),String(receiver));
    });
    await t.test("officially closed work stays closed after reviewed identity is available; source facts unchanged", async () => {
      const number=await getContactNumberModel().create({ e164:"+12025550112",digits_reversed:"21105552021",first_observed_at:at,last_activity_at:boundary });
      const lead={ _id:oid(),timestamp:at,createdAt:at,updatedAt:at,name:"Synthetic closed Lead",normalized_phone_number:number.e164,no_sync:true,receiver_agent:oid() };
      await getFormLeadModel().collection.insertOne(lead);
      const before=JSON.stringify(await getFormLeadModel().findById(lead._id).lean());
      await withTransaction(async session=>{ await persistLeadAttachments(lead,"FormLead",session,String(oid()),at); await ensureLead({ model:"FormLead",id:String(lead._id) },workerContext(session,String(oid())),String(number._id)); });
      const call=await getCallInteractionModel().create({ provider_account_id:"synthetic",telephony_session_id:"closed-identity",identity_basis:"telephony_session_id",contact_number_id:number._id,
        direction:"Inbound",started_at:new Date(+at+60000),first_observed_at:at,last_observed_at:at,terminal:true,contact_type:"human_conversation",parties:[{ role:"user",extension_id:"104",direction:"Inbound",connected:true }] });
      await withTransaction(s=>ensureInteraction(call,workerContext(s,String(oid()))));
      const record=await getOutreachRecordModel().findOne({ "subject.id":lead._id }).orFail(); assert.equal(record.state,"closed"); assert.equal(record.responsible_agent_id,null);
      assert.equal(JSON.stringify(await getFormLeadModel().findById(lead._id).lean()),before);
    });
    await t.test("bounded pages reach deferred eligibility and existing STT scheduler without providers", async () => {
      const number=await getContactNumberModel().create({ e164:"+12025550111",digits_reversed:"11105552021",first_observed_at:at,last_activity_at:boundary });
      const calls=[];
      for(let i=0;i<27;i++) calls.push(await getCallInteractionModel().create({ provider_account_id:"synthetic",telephony_session_id:`page-${i}`,identity_basis:"telephony_session_id",
        contact_number_id:number._id,direction:"Outbound",started_at:new Date(+at+i*1000),first_observed_at:at,last_observed_at:at,terminal:true,
        parties:[{ role:"user",extension_id:"106",direction:"Outbound",connected:false }],recordings:i===26 ? [{ provider_recording_id:"stored-media",observed_at:at }]:[] }));
      const call=calls[26]!, digest="a".repeat(64);
      const conversation=await getLeadConversationModel().create({ provider:"ringcentral",provider_account_id:"synthetic",provider_recording_id:"stored-media",
        call_interaction_id:call._id,contact_number_id:number._id,state:"media_stored",media_digest_sha256:digest,
        started_at:call.started_at,direction:"Outbound",match_method:"number_only",match_confidence:"low",
        next_attempt_at:new Date("2099-01-01T00:00:00Z"),media:{ blob_pathname:"synthetic-private",stored_at:at,purged_at:null } });
      const job=await withTransaction(s=>scheduleRepIdentityReevaluation({ account:"synthetic",extension:"106",from:at,through:boundary,change_id:String(oid()) },s));
      assert.equal(z.object({ scanned:z.number() }).parse(await runRepIdentityReevaluationJob(String(job._id))).scanned,25);
      const continuation=await Jobs.findOne({ stage:"rep_identity_reevaluate","rep_identity_window.change_id":job.rep_identity_window!.change_id,_id:{ $ne:job._id } }).orFail();
      assert.equal(z.object({ scanned:z.number() }).parse(await runRepIdentityReevaluationJob(String(continuation._id))).scanned,2);
      assert.equal((await getLeadConversationModel().findById(conversation._id))?.analysis_eligibility?.eligible,true);
      assert.equal((await withTransaction(s=>loadEligibilityInputs(call,s))).reviewedRepOutbound,true);
      process.env.SALES_INTELLIGENCE_STT_ENABLED="true";
      try { const ids=await scheduleTranscriptionJobs(5,async()=>({ published:false,error_code:null })); assert.equal(ids.length,1); assert.equal(await Jobs.countDocuments({ stage:"transcription",input_refs:conversation._id }),1); }
      finally { process.env.SALES_INTELLIGENCE_STT_ENABLED="false"; }
    });
    await t.test("eligible re-evaluation with empty recordings still enqueues discovery", async () => {
      const number=await getContactNumberModel().create({ e164:"+12025550114",digits_reversed:"41105552021",first_observed_at:at,last_activity_at:boundary });
      const call=await getCallInteractionModel().create({ provider_account_id:"synthetic",telephony_session_id:"empty-recording",identity_basis:"telephony_session_id",
        contact_number_id:number._id,direction:"Outbound",started_at:new Date(+boundary+1000),first_observed_at:at,last_observed_at:at,terminal:true,
        parties:[{ role:"user",extension_id:"106",direction:"Outbound",connected:false }],recordings:[] });
      const job=await withTransaction(s=>scheduleRepIdentityReevaluation({ account:"synthetic",extension:"106",from:boundary,through:new Date(+boundary+5000),change_id:String(oid()) },s));
      assert.equal(z.object({ scanned:z.number() }).parse(await runRepIdentityReevaluationJob(String(job._id))).scanned,1);
      const discovery=await Jobs.findOne({ stage:"recording_discovery",input_refs:call._id }).orFail();
      assert.equal(discovery.dedupe_key.startsWith("csi:rep-discovery:"),true);
      assert.deepEqual(call.recordings,[]);
    });
    await t.test("official Agent records unchanged and flags remain off", async () => {
      assert.equal(JSON.stringify(await Agent.find().sort({ _id:1 }).lean()),officialAgentsBefore);
      assert.equal(process.env.SALES_INTELLIGENCE_NUDGE_ENABLED,"false"); assert.equal(process.env.SALES_INTELLIGENCE_MEDIA_ENABLED,"false"); assert.equal(process.env.SALES_INTELLIGENCE_STT_ENABLED,"false");
    });
  } finally { await db.dropDatabase(); await mongoose.disconnect(); }
});
