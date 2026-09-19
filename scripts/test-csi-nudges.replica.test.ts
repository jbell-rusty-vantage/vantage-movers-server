import assert from "node:assert/strict";
import { test } from "node:test";
import express, { type Request } from "express";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { applyCsiMigration } from "./migrations/sales-intelligence.lib";
import { Agent } from "../src/models/Agent";
import { getRepIdentityLinkModel } from "../src/models/RepIdentityLink";
import { getRingCentralDirectorySnapshotModel } from "../src/models/RingCentralDirectorySnapshot";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getFormLeadModel } from "../src/models/FormLead";
import { getLeadMessageModel } from "../src/models/LeadMessage";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../src/models/OutreachFollowup";
import { getOwnerRepNudgeModel } from "../src/models/OwnerRepNudge";
import { getSalesIntelligenceAuditEventModel } from "../src/models/SalesIntelligenceAuditEvent";
import { getSalesIntelligencePolicyVersionModel } from "../src/models/SalesIntelligencePolicyVersion";
import { getSalesIntelligencePolicyPointerModel } from "../src/models/SalesIntelligencePolicyPointer";
import { getSalesIntelligenceContactRestrictionModel } from "../src/models/SalesIntelligenceContactRestriction";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { requireCsiOwner, csiWorkerActor } from "../src/services/salesIntelligence/auth";
import { computeAdminActorSignature } from "../src/services/operationsRegistry/trustedActor";
import { defaultCsiPolicy } from "../src/services/salesIntelligence/policy";
import { previewNudge, sendNudge, scheduleNudgeRepair } from "../src/services/salesIntelligence/nudges/commands";
import { listNudges } from "../src/services/salesIntelligence/nudges/reads";
import { drainNudgeRepairJobs, runNudgeRepairJob, recoverNudgeRepairJobs } from "../src/services/salesIntelligence/nudges/repair";
import { NudgeProviderError, type NudgeAdapter } from "../src/services/salesIntelligence/nudges/adapters";
import { installTestObservabilitySink } from "../src/services/observability";
import { outreachTimelineSource } from "../src/services/salesIntelligence/outreach/timeline";

test("CSI-14 disposable replica; no providers", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 240000 }, async t => {
  assert.match(getMongoDatabaseName(), /^testvantagemovers_csi14[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  installTestObservabilitySink();
  await connectMongo(); const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01"); await applyCsiMigration();
  const oid = () => new mongoose.Types.ObjectId();
  const request: Request = Object.assign(Object.create(express.request), { method: "POST", originalUrl: "/api/v1/admin/sales-intelligence/nudges", headers: {},
    vantageAuth: { kind: "user", userId: "synthetic-owner", email: "owner@example.test", roles: ["owner"] } });
  const fields = { adminId: "synthetic-owner", email: "owner@example.test", role: "owner", timestamp: String(Date.now()), requestId: "csi14-proof", method: request.method, path: request.originalUrl };
  request.headers = { "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role,
    "x-vantage-admin-timestamp": fields.timestamp, "x-vantage-admin-request-id": fields.requestId,
    "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!) };
  const actor = requireCsiOwner(request), Links = getRepIdentityLinkModel(), Nudges = getOwnerRepNudgeModel(), Records = getOutreachRecordModel();
  const agent = await Agent.create({ name: "Alex Reed", normalized_name: "alex reed" });
  const at = new Date(Date.now() - 86400000);
  const directory = await getRingCentralDirectorySnapshotModel().create({ provider_account_id: "synthetic", taken_at: at, digest: "csi14-directory",
    extensions: [
      { id: "101", type: "User", name: "Alex Reed", status: "Enabled", extension_number: "101", direct_numbers: ["+12025550199"], sms_sender_numbers: [] },
      { id: "102", type: "User", name: "Joshua L", status: "Enabled", extension_number: "102", direct_numbers: ["+12025550188"], sms_sender_numbers: [] },
    ],
    counts: { extensions: 2, users: 2, departments: 0, company_numbers: 0, queues: 0 } });
  const link = await Links.create({ agent_id: agent._id, agent_name_snapshot: "Alex Reed", rc_account_id: "synthetic", rc_extension_id: "101", rc_extension_number: "101",
    rc_direct_numbers: ["+12025550199"], rc_team_messaging_person_id: "101", role_kind: "sales_rep", status: "reviewed", effective_from: at,
    reviewed_at: at, reviewed_by: actor.id, nudge_channels_allowed: ["team_messaging", "sms_to_rep", "pager"] });
  await getSalesIntelligencePolicyVersionModel().create({ version: "nudge-test-v1", policy: { ...defaultCsiPolicy(), version: "nudge-test-v1", enabled_capabilities: ["nudges"] }, actor, effective_at: at });
  await getSalesIntelligencePolicyPointerModel().create({ key: "active", version: "nudge-test-v1" });
  let serial = 0, submits = 0, chats = 0, receipts = 0;
  const adapter: NudgeAdapter = {
    async resolveDirect() { chats++; return { id: "chat-101", type: "Direct", members: ["100", "101"] }; },
    async submit() { submits++; return { id: `receipt-${submits}`, status: 200 }; },
    async receipt() { receipts++; return true; },
  };
  const fixture = async () => {
    const number = await getContactNumberModel().create({ e164: `+120255501${String(++serial).padStart(2, "0")}`, digits_reversed: String(serial), first_observed_at: at, last_activity_at: at });
    const lead = { _id: oid(), timestamp: at, name: "Taylor Morgan", normalized_phone_number: number.e164, source_company_label_snapshot: "Synthetic source" };
    await getFormLeadModel().collection.insertOne(lead);
    const record = await Records.create({ subject: { kind: "lead", model: "FormLead", id: lead._id }, primary_contact_number_id: number._id,
      state: "unworked", trigger_kind: "lead_arrival", trigger_at: at, first_action_due_at: new Date(Date.now() + 86400000), policy_version: "nudge-test-v1" });
    const body = { expected_revision: record.revision, expected_rep_revision: 1, nudge: { outreach_record_id: String(record._id), rc_account_id: "synthetic", rc_extension_id: "101",
      rep_identity_link_id: String(link._id), channel: "team_messaging" as "team_messaging" | "pager" | "sms_to_rep", template_key: "review_context", template_version: 1, purpose: "review_context" as "review_context" | "call_suggestion", allow_pager_fallback: false } };
    return { number, lead, record, body, input: { actor, idempotency_key: String(oid()), body } };
  };
  const dump = async () => JSON.stringify(await Promise.all((await db.listCollections().toArray()).sort((a,b) => a.name.localeCompare(b.name)).map(async c => [c.name, await db.collection(c.name).find().sort({ _id: 1 }).toArray()])));
  try {
    await t.test("preview masks, permits future work, and performs no mutations; GET is pure", async () => {
      const f = await fixture(), before = await dump(), sent = submits;
      const preview = await previewNudge(f.input); assert.match(preview.data.body, /Taylor M\./); assert.ok(!preview.data.body.includes(f.number.e164)); assert.equal(preview.data.authorizes_send, false);
      await listNudges({ limit: 20 }); assert.equal(await dump(), before); assert.equal(submits, sent); assert.equal(chats, 0);
    });
    await t.test("Owner-only, flags, strict schema, idempotency and revisions", async () => {
      const f = await fixture();
      await assert.rejects(sendNudge({ ...f.input, actor: csiWorkerActor(String(oid())) }, { adapter }), /OWNER_REQUIRED/);
      await assert.rejects(previewNudge({ ...f.input, idempotency_key: "" }), /INVALID_INPUT/);
      await assert.rejects(previewNudge({ ...f.input, body: { ...f.body, chat_id: "arbitrary" } }));
      for (const patch of [{ expected_revision: 2 }, { expected_rep_revision: 2 }]) await assert.rejects(previewNudge({ ...f.input, body: { ...f.body, ...patch } }), /REVISION_CONFLICT/);
      process.env.SALES_INTELLIGENCE_NUDGE_ENABLED = "false";
      await assert.rejects(previewNudge(f.input), /FEATURE_DISABLED/); await listNudges({ limit: 20 });
      assert.equal((await drainNudgeRepairJobs()).status, "disabled"); process.env.SALES_INTELLIGENCE_NUDGE_ENABLED = "true";
    });
    await t.test("proposal/name, retired, future, finite, wrong-account and non-sales links fail", async () => {
      const f = await fixture();
      for (const patch of [{ status: "proposed" }, { status: "retired" }, { effective_from: new Date(Date.now() + 60000) },
        { effective_to: new Date(Date.now() - 1) }, { effective_to: new Date(Date.now() + 60000) }, { role_kind: "manager" }, { rc_account_id: "other" }]) {
        await Links.updateOne({ _id: link._id }, { $set: patch }); await assert.rejects(previewNudge(f.input), /IDENTITY_BLOCKED/);
        await Links.updateOne({ _id: link._id }, { $set: { status: "reviewed", effective_from: at, effective_to: null, role_kind: "sales_rep", rc_account_id: "synthetic" } });
      }
      await getRingCentralDirectorySnapshotModel().collection.updateOne({ _id: directory._id }, { $set: { "extensions.0.type": "Department", "counts.users": 1 } });
      await assert.rejects(previewNudge(f.input), /IDENTITY_BLOCKED/);
      await getRingCentralDirectorySnapshotModel().collection.updateOne({ _id: directory._id }, { $set: { "extensions.0.type": "User", "counts.users": 2 } });
      await Agent.updateOne({ _id: agent._id }, { $set: { active: false } });
      await previewNudge(f.input);
      await Agent.updateOne({ _id: agent._id }, { $set: { active: true } });
      const conflict = await Links.create({ ...(await Links.findById(link._id).lean()), _id: oid(), effective_to: new Date(Date.now() + 60000) });
      await previewNudge(f.input);
      await Links.deleteOne({ _id: conflict._id });
    });
    await t.test("same concurrent command produces one submission and accurate audit, unchanged work", async () => {
      const f = await fixture(), before = JSON.stringify(await Records.findById(f.record._id).lean()), start = submits;
      const results = await Promise.all([sendNudge(f.input, { adapter }), sendNudge(f.input, { adapter }), sendNudge(f.input, { adapter })]);
      assert.equal(submits, start + 1); assert.equal(new Set(results.map(r => r.nudge.id)).size, 1);
      assert.equal((await sendNudge(f.input, { adapter })).nudge.status, "sent"); assert.equal(submits, start + 1);
      await assert.rejects(sendNudge({ ...f.input, body: { ...f.body, nudge: { ...f.body.nudge, body: "Different content" } } }, { adapter }), /IDEMPOTENCY_CONFLICT/);
      assert.equal(await getSalesIntelligenceAuditEventModel().countDocuments({ event_kind: "nudge_sent", "current.nudge_id": results[0]!.nudge.id }), 1);
      assert.equal(JSON.stringify(await Records.findById(f.record._id).lean()), before);
      const timeline = await outreachTimelineSource({ number_id: String(f.number._id), e164: f.number.e164, national_ten: f.number.e164.slice(2), cursor: null, limit: 20 });
      assert.equal(timeline.filter(event => event.kind === "nudge" && event.detail.event_kind === "nudge_sent").length, 1);
    });
    await t.test("identity retirement after preview and during chat resolution never submits", async () => {
      const f = await fixture(); await previewNudge(f.input); const start = submits;
      const result = await sendNudge(f.input, { adapter: { ...adapter, async resolveDirect(r) {
        await Links.updateOne({ _id: link._id }, { $set: { status: "retired", effective_to: new Date() }, $inc: { revision: 1 } }); return adapter.resolveDirect(r);
      } } });
      assert.equal(result.nudge.status, "failed"); assert.equal(result.nudge.error_code, "REVISION_CONFLICT"); assert.equal(submits, start);
      await Links.updateOne({ _id: link._id }, { $set: { status: "reviewed", effective_to: null, revision: 1 } });
    });
    await t.test("closed cannot send; restriction permits review context but blocks call suggestions", async () => {
      const f = await fixture(); await Records.updateOne({ _id: f.record._id }, { $set: { state: "closed" } }); await assert.rejects(previewNudge(f.input), /NUDGE_NOT_ACTIONABLE/);
      await Records.updateOne({ _id: f.record._id }, { $set: { state: "unworked" } });
      await getContactNumberModel().updateOne({ _id: f.number._id }, { $set: { "contact_eligibility.state": "suppressed" } });
      await previewNudge(f.input); f.body.nudge.purpose = "call_suggestion"; f.body.nudge.template_key = "call_suggestion";
      await assert.rejects(previewNudge(f.input), /CONTACT_RESTRICTED/);
      await getContactNumberModel().updateOne({ _id: f.number._id }, { $set: { "contact_eligibility.state": "allowed" } });
      const restriction = await getSalesIntelligenceContactRestrictionModel().create({ contact_number_id: f.number._id, channels: ["call"], origin: "owner", actor });
      await assert.rejects(previewNudge(f.input), /CONTACT_RESTRICTED/);
      f.body.nudge.purpose = "review_context"; f.body.nudge.template_key = "review_context";
      const before = JSON.stringify(await getSalesIntelligenceContactRestrictionModel().findById(restriction._id).lean());
      assert.equal((await sendNudge(f.input, { adapter })).nudge.status, "sent");
      assert.equal(JSON.stringify(await getSalesIntelligenceContactRestrictionModel().findById(restriction._id).lean()), before);
      const blocked = submits;
      for (const body of ["Please call the customer now.", "Alex, call the customer tomorrow.", "Please urgently call the customer."]) {
        await assert.rejects(previewNudge({ ...f.input, body: { ...f.body, nudge: { ...f.body.nudge, body } } }), /NUDGE_NOT_ACTIONABLE/);
        await assert.rejects(sendNudge({ ...f.input, idempotency_key: String(oid()), body: { ...f.body, nudge: { ...f.body.nudge, body } } }, { adapter }), /NUDGE_NOT_ACTIONABLE/);
      }
      assert.equal(submits, blocked);
    });
    await t.test("snoozed call is suppressed, independent unsnoozed call remains eligible", async () => {
      const f = await fixture(); f.body.nudge.purpose = "call_suggestion"; f.body.nudge.template_key = "call_suggestion";
      const a = await getOutreachFollowupModel().create({ outreach_record_id: f.record._id, commitment_key: String(oid()), kind: "call", description: "Call", origin: "owner", snoozed_until: new Date(Date.now() + 86400000) });
      await assert.rejects(previewNudge(f.input), /NUDGE_NOT_ACTIONABLE/);
      const b = await getOutreachFollowupModel().create({ outreach_record_id: f.record._id, commitment_key: String(oid()), kind: "call", description: "Other call", origin: "owner", due_at: new Date(Date.now() + 3600000) });
      await previewNudge(f.input);
      await assert.rejects(previewNudge({ ...f.input, body: { ...f.body, nudge: { ...f.body.nudge, followup_id: String(a._id) } } }), /NUDGE_NOT_ACTIONABLE/);
      await previewNudge({ ...f.input, body: { ...f.body, nudge: { ...f.body.nudge, followup_id: String(b._id) } } });
    });
    await t.test("destination guards Contact Number, Lead snapshots and Lead Message to; missing evidence blocks", async () => {
      const f = await fixture();
      await Links.updateOne({ _id: link._id }, { $set: { rc_direct_numbers: [f.number.e164] } }); await assert.rejects(previewNudge(f.input), /NUDGE_DESTINATION_IS_CUSTOMER/);
      await Links.updateOne({ _id: link._id }, { $set: { rc_direct_numbers: ["+12025550199"] } });
      await getFormLeadModel().collection.updateOne({ _id: f.lead._id }, { $set: { granot_contact_snapshot: { phone_number: "(202) 555-0199" } } }); await assert.rejects(previewNudge(f.input), /NUDGE_DESTINATION_IS_CUSTOMER/);
      await getFormLeadModel().collection.updateOne({ _id: f.lead._id }, { $unset: { granot_contact_snapshot: "" } });
      await getLeadMessageModel().collection.insertOne({ _id: oid(), form_lead: f.lead._id, to: "+12025550199" } as never); await assert.rejects(previewNudge(f.input), /NUDGE_DESTINATION_IS_CUSTOMER/);
      await getLeadMessageModel().collection.deleteMany({ form_lead: f.lead._id });
      await getFormLeadModel().collection.updateOne({ _id: f.lead._id }, { $unset: { normalized_phone_number: "" } }); await assert.rejects(previewNudge(f.input), /NUDGE_DESTINATION_EVIDENCE_INCOMPLETE/);
    });
    await t.test("owner body rejects full formatted customer numbers and bad templates", async () => {
      const f = await fixture();
      for (const body of [f.number.e164, f.number.e164.slice(2), `(202) 555-01${String(serial).padStart(2,"0")}`, "x".repeat(1001)])
        await assert.rejects(previewNudge({ ...f.input, body: { ...f.body, nudge: { ...f.body.nudge, body } } }));
      await assert.rejects(previewNudge({ ...f.input, body: { ...f.body, nudge: { ...f.body.nudge, template_version: 2 } } }), /INVALID_INPUT/);
      const sent = await sendNudge({ ...f.input, body: { ...f.body, nudge: { ...f.body.nudge, body: "Please review this internal context." } } }, { adapter }); assert.equal(sent.nudge.body_as_sent, "Please review this internal context.");
    });
    await t.test("direct chat mismatch fails; optional channels default off; fallback only definitive chat failure", async () => {
      const f = await fixture(), start = submits;
      const bad = await sendNudge(f.input, { adapter: { ...adapter, async resolveDirect() { return { id: "bad", type: "Direct", members: ["100", "999"] }; } } }); assert.equal(bad.nudge.status, "failed"); assert.equal(submits, start);
      f.body.nudge.channel = "pager"; await assert.rejects(previewNudge({ ...f.input, idempotency_key: String(oid()) }), /NUDGE_CONFIGURATION_UNAVAILABLE/);
      process.env.SALES_INTELLIGENCE_NUDGE_PAGER_ENABLED = "true";
      f.body.nudge.channel = "team_messaging"; f.body.nudge.allow_pager_fallback = true;
      const fallback = await sendNudge({ ...f.input, idempotency_key: String(oid()) }, { adapter: { ...adapter, async resolveDirect() { throw new NudgeProviderError("chat_rejected", true); } } }); assert.equal(fallback.nudge.status, "fallback_sent");
      const uncertain = await sendNudge({ ...f.input, idempotency_key: String(oid()) }, { adapter: { ...adapter, async submit() { submits++; throw new NudgeProviderError("delivery_uncertain"); } } }); assert.equal(uncertain.nudge.status, "unknown_delivery");
      assert.equal(submits, start + 2); process.env.SALES_INTELLIGENCE_NUDGE_PAGER_ENABLED = "false";
    });
    await t.test("pending command replay does not submit; provider acceptance timeout is not retry permission", async () => {
      const f = await fixture(); let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let entered!: () => void; const started = new Promise<void>(r => { entered = r; });
      const initial = sendNudge(f.input, { adapter: { ...adapter, async submit() { submits++; entered(); await gate; throw new NudgeProviderError("delivery_uncertain"); } } });
      await started; const before = submits; const replay = await sendNudge(f.input, { adapter }); assert.equal(replay.nudge.status, "pending"); assert.equal(submits, before);
      release(); assert.equal((await initial).nudge.status, "unknown_delivery"); assert.equal((await sendNudge(f.input, { adapter })).nudge.status, "unknown_delivery"); assert.equal(submits, before);
    });
    await t.test("SMS requires explicit opt-in and submits from configured JWT DID; work and official facts stay unchanged", async () => {
      const f = await fixture(); f.body.nudge.channel = "sms_to_rep";
      await assert.rejects(previewNudge(f.input), /NUDGE_CONFIGURATION_UNAVAILABLE/);
      process.env.SALES_INTELLIGENCE_NUDGE_SMS_ENABLED = "true"; process.env.SALES_INTELLIGENCE_NUDGE_SENDER_DID = "+12025550198";
      const snapshots = async () => JSON.stringify(await Promise.all([Agent.find().lean(), Links.find().lean(), getRingCentralDirectorySnapshotModel().find().lean(),
        Records.findById(f.record._id).lean(), getOutreachFollowupModel().find({outreach_record_id:f.record._id}).lean(), getFormLeadModel().findById(f.lead._id).lean()]));
      const before = await snapshots();
      const result = await sendNudge(f.input, {adapter:{...adapter,async submit(input){assert.equal(input.senderDid,"+12025550198");assert.equal(input.destination,"+12025550199");return adapter.submit(input);}}});
      assert.equal(result.nudge.status,"sent");assert.equal(await snapshots(),before);
      process.env.SALES_INTELLIGENCE_NUDGE_SMS_ENABLED="false";
    });
    await t.test("provider acceptance followed by receipt persistence failure is unknown, replay never resubmits", async () => {
      const f=await fixture(), before=submits, originalUpdate=Nudges.updateOne.bind(Nudges);
      const mock=t.mock.method(Nudges,"updateOne",((filter:unknown, update:{$set?:{provider_message_id?:string}},options:unknown)=>{
        if(update?.$set?.provider_message_id)throw new Error("synthetic receipt persistence crash");
        return originalUpdate(filter as never,update,options as never);
      }) as typeof Nudges.updateOne);
      try {const result=await sendNudge(f.input,{adapter});assert.equal(result.nudge.status,"unknown_delivery");assert.equal(submits,before+1);}
      finally{mock.mock.restore();}
      await sendNudge(f.input,{adapter});assert.equal(submits,before+1);
    });
    await t.test("directory User without a reviewed link is a valid destination; proposed links never invent one", async () => {
      const f = await fixture();
      const unmatched = { ...f.body, expected_rep_revision: undefined, nudge: { ...f.body.nudge, rc_extension_id: "102", channel: "pager" as const, allow_pager_fallback: false } };
      delete (unmatched as { expected_rep_revision?: number }).expected_rep_revision;
      delete (unmatched.nudge as { rep_identity_link_id?: string }).rep_identity_link_id;
      await assert.rejects(previewNudge({ ...f.input, body: unmatched }), /NUDGE_CONFIGURATION_UNAVAILABLE/);
      process.env.SALES_INTELLIGENCE_NUDGE_PAGER_ENABLED = "true";
      const preview = await previewNudge({ ...f.input, body: unmatched });
      assert.match(preview.data.body, /^Joshua /);
      assert.equal(preview.data.recipient.rep_identity_link_id, null);
      assert.equal(preview.data.expected_rep_revision, null);
      assert.ok(!preview.data.allowed_channels.includes("team_messaging"));
      assert.equal((await sendNudge({ actor: f.input.actor, idempotency_key: String(oid()), body: unmatched }, { adapter })).nudge.status, "sent");
      assert.equal(await Links.countDocuments({ rc_extension_id: "102" }), 0);
      process.env.SALES_INTELLIGENCE_NUDGE_PAGER_ENABLED = "false";
    });
    await t.test("reviewed link may restrict snapshot channels and never enlarge them", async () => {
      const f = await fixture();
      await Links.updateOne({ _id: link._id }, { $set: { nudge_channels_allowed: ["team_messaging"], rc_team_messaging_person_id: "101" } });
      process.env.SALES_INTELLIGENCE_NUDGE_PAGER_ENABLED = "true";
      f.body.nudge.channel = "pager";
      await assert.rejects(previewNudge(f.input), /NUDGE_CONFIGURATION_UNAVAILABLE/);
      f.body.nudge.channel = "team_messaging";
      await previewNudge(f.input);
      await Links.updateOne({ _id: link._id }, { $set: { nudge_channels_allowed: ["team_messaging", "sms_to_rep", "pager"] } });
      process.env.SALES_INTELLIGENCE_NUDGE_PAGER_ENABLED = "false";
    });
    await t.test("per-User rolling limit reserves concurrent pending/failed/unknown attempts", async () => {
      const f = await fixture(); const count = await Nudges.countDocuments({ rc_account_id: "synthetic", rc_extension_id: "101" }); process.env.SALES_INTELLIGENCE_NUDGE_PER_REP_PER_HOUR = String(count + 1);
      const result = await Promise.allSettled([sendNudge(f.input, { adapter }), sendNudge({ ...f.input, idempotency_key: String(oid()) }, { adapter })]);
      assert.equal(result.filter(r => r.status === "fulfilled").length, 1); assert.ok(result.some(r => r.status === "rejected" && String(r.reason).includes("RATE_LIMITED"))); process.env.SALES_INTELLIGENCE_NUDGE_PER_REP_PER_HOUR = "100";
    });
    await t.test("repair crash windows, exact receipt only, duplicate repair and expired worker lease", async () => {
      const seed = await fixture(); const result = await sendNudge(seed.input, { adapter }); const original = await Nudges.findById(result.nudge.id).lean().orFail();
      const before = submits;
      for (const scenario of ["before", "legacy_before", "accepted_no_receipt", "accepted_receipt", "similar_text", "expired_lease", "denied_receipt"]) {
        const id = oid(), old = new Date(Date.now() - 180000);
        await Nudges.collection.insertOne({ ...original, _id: id, idempotency_key: String(id), status: "pending", revision: 1, createdAt: old, send_expires_at: old,
          submission_started_at: scenario.endsWith("before") ? null : old, provider_message_id: ["accepted_receipt", "expired_lease", "denied_receipt"].includes(scenario) ? "exact-id" : null, sent_at: null });
        if (scenario === "legacy_before") await Nudges.collection.updateOne({ _id: id }, { $unset: { revision: "", command_id: "", authorized_command: "", submission_started_at: "", send_expires_at: "" } });
        const job = await withTransaction(s => scheduleNudgeRepair(String(id), s, old));
        if (scenario === "expired_lease") await getSalesIntelligenceJobModel().updateOne({ _id: job._id }, { $set: { status: "leased", lease_owner: "dead-process", leased_until: old, lease_epoch: 4, attempts: 1 } });
        const repairAdapter = scenario === "denied_receipt" ? {...adapter,async receipt(){throw new NudgeProviderError("provider_unavailable",true);}} : adapter;
        await Promise.all([runNudgeRepairJob(String(job._id), repairAdapter), runNudgeRepairJob(String(job._id), repairAdapter)]);
        const row = await Nudges.findById(id).lean().orFail(); assert.equal(row.status, scenario.endsWith("before") ? "failed" : ["accepted_receipt", "expired_lease"].includes(scenario) ? "sent" : "unknown_delivery");
        if (scenario === "legacy_before") assert.equal(row.revision, 2);
      }
      assert.equal(submits, before); assert.ok(receipts >= 2);
      assert.ok((await listNudges({ limit: 1 })).data.next_cursor);
      const old=new Date(Date.now()-180000);
      for(let i=0;i<27;i++){const id=oid();await Nudges.collection.insertOne({...original,_id:id,idempotency_key:String(id),status:"pending",createdAt:old,send_expires_at:old,submission_started_at:null,provider_message_id:null});}
      assert.equal(await recoverNudgeRepairJobs(100),25);
      const drain=await drainNudgeRepairJobs(100,adapter);assert.ok(drain.outcomes.length<=5);assert.equal(submits,before);
    });
  } finally { await db.dropDatabase(); await mongoose.disconnect(); }
});
