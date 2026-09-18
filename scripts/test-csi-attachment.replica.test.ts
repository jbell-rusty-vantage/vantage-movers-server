import assert from "node:assert/strict";
import { test } from "node:test";
import express, { type Request } from "express";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { applyCsiMigration } from "./migrations/sales-intelligence.lib";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getCallInteractionModel } from "../src/models/CallInteraction";
import { getFormLeadModel } from "../src/models/FormLead";
import { getCallLeadModel } from "../src/models/CallLead";
import { getNumberLeadAttachmentModel } from "../src/models/NumberLeadAttachment";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceSyncStateModel } from "../src/models/SalesIntelligenceSyncState";
import { requireCsiOwner } from "../src/services/salesIntelligence/auth";
import { computeAdminActorSignature } from "../src/services/operationsRegistry/trustedActor";
import { persistLeadAttachments, attachmentPolicyInput } from "../src/services/salesIntelligence/attachment/store";
import { commandAttachment } from "../src/services/salesIntelligence/attachment/commands";
import { listAttachments } from "../src/services/salesIntelligence/attachment/reads";
import { resolveAtInteraction } from "../src/services/salesIntelligence/attachment/suggest";
import { runAttachmentRefreshJob, drainAttachmentRefreshJobs, runAttachmentRefreshOnce } from "../src/services/salesIntelligence/attachment/refresh";
import { loadLead, type LeadSource } from "../src/services/salesIntelligence/attachment/sources";
import { enqueueCsiJob, claimCsiJob, completeCsiJob } from "../src/services/salesIntelligence/jobs";
import { dispatchCsiWakeup } from "../src/services/numberActivity/jobDispatch";
import { loadEligibilityInputs } from "../src/services/salesIntelligence/conversations/eligibility";

test("CSI-05 disposable replica: attachment only", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 240000 }, async t => {
  assert.equal(process.env.TEST_MODE, "true"); assert.match(getMongoDatabaseName(), /^testvantagemovers_csi05[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await applyCsiMigration();
  const Numbers = getContactNumberModel(), Edges = getNumberLeadAttachmentModel(), Jobs = getSalesIntelligenceJobModel();
  const at = new Date("2026-09-01T12:00:00Z");
  const request: Request = Object.assign(Object.create(express.request), { method: "POST", originalUrl: "/api/v1/admin/sales-intelligence/attachments/attach",
    headers: {}, vantageAuth: { kind: "user", userId: "synthetic-owner", email: "owner@example.test", roles: ["owner"] } });
  const fields = { adminId: "synthetic-owner", email: "owner@example.test", role: "owner", timestamp: String(Date.now()), requestId: "csi05-proof", method: request.method, path: request.originalUrl };
  request.headers = { "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role,
    "x-vantage-admin-timestamp": fields.timestamp, "x-vantage-admin-request-id": fields.requestId,
    "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!) };
  const actor = requireCsiOwner(request);
  let serial = 0;
  const number = () => Numbers.create({ e164: `+120255501${String(++serial).padStart(2, "0")}`, digits_reversed: `n${serial}`, first_observed_at: at, last_activity_at: at });
  async function lead(phone: string, timestamp = at, model: "FormLead" | "CallLead" = "FormLead", extra = {}) {
    const row = { _id: new mongoose.Types.ObjectId(), timestamp, createdAt: timestamp, updatedAt: timestamp, name: "Synthetic CSI-05", normalized_phone_number: phone,
      ingested_contact_snapshot: { normalized_phone_number: phone, captured_at: timestamp }, ...extra };
    if (model === "FormLead") await getFormLeadModel().collection.insertOne(row); else await getCallLeadModel().collection.insertOne(row);
    return row;
  }
  const persist = (row: LeadSource, model: "FormLead" | "CallLead" = "FormLead") => withTransaction(s => persistLeadAttachments(row, model, s, "a".repeat(24), at));
  const edge = (id: mongoose.Types.ObjectId) => Edges.findOne({ "lead_ref.id": id }).lean().orFail();
  const attach = async (id: mongoose.Types.ObjectId, key: string, expected?: number) => {
    const row = await edge(id);
    return commandAttachment({ actor, idempotency_key: key, command: { command: "attach_lead", contact_number_id: String(row.contact_number_id),
      lead_ref: { model: row.lead_ref.model, id: String(id) }, expected_revision: expected ?? row.revision, reason: "Synthetic Owner evidence" } });
  };
  const snapshot = async () => JSON.stringify(await Promise.all((await db.listCollections().toArray()).sort((a,b) => a.name.localeCompare(b.name))
    .map(async c => [c.name, await db.collection(c.name).find().sort({ _id: 1 }).toArray()])));
  try {
    await t.test("unique pair, duplicate refresh, snapshots/search; resolve numbers without creating", async () => {
      const n = await number(), l = await lead(n.e164);
      await persist(l); const before = await edge(l._id); const beforeNumber = await Numbers.findById(n._id).lean();
      await persist(l); const after = await edge(l._id);
      assert.deepEqual(await Numbers.findById(n._id).lean(), beforeNumber);
      assert.equal(after.state, "candidate"); assert.equal(after.certainty, "likely");
      assert.equal(after.revision, before.revision); assert.deepEqual(after.history, before.history);
      assert.equal(after.evidence.length, before.evidence.length);
      assert.ok((await Numbers.findById(n._id))?.search_terms.includes("synthetic csi-05"));
      const count = await Numbers.countDocuments(); await persist(await lead("2025550199")); assert.equal(await Numbers.countDocuments(), count);
    });
    await t.test("concurrent different-pair refresh fan-in; event-time independent historical moves", async () => {
      const n = await number(), a = await lead(n.e164), b = await lead(n.e164), c = await lead(n.e164, new Date("2026-12-01"));
      await Promise.all([persist(a), persist(b)]); await persist(c);
      assert.equal((await edge(a._id)).state, "ambiguous"); assert.equal((await edge(b._id)).state, "ambiguous"); assert.equal((await edge(c._id)).state, "candidate");
      const rows = await Edges.find({ contact_number_id: n._id }).lean();
      const identity = { id: "i", provider_account_id: "a", call_log_ids: [], started_at: at };
      assert.equal(resolveAtInteraction(rows.map(attachmentPolicyInput), identity).lead_effects_allowed, false);
      assert.equal(resolveAtInteraction(rows.map(attachmentPolicyInput), { ...identity, started_at: new Date("2026-12-01") }).lead_ref?.id, String(c._id));
    });
    await t.test("Owner wins concurrent refresh; CAS and idempotency conflicts; reviewed snapshot frozen", async () => {
      const n = await number(), l = await lead(n.e164); await persist(l); const rev = (await edge(l._id)).revision;
      await Promise.all([attach(l._id, "owner-race", rev), persist(l)]);
      const reviewed = await edge(l._id); assert.equal(reviewed.certainty, "owner_confirmed");
      const replay = await attach(l._id, "owner-race", rev); assert.equal(replay.replayed, true);
      await assert.rejects(attach(l._id, "owner-race", reviewed.revision), /IDEMPOTENCY_CONFLICT/);
      await assert.rejects(attach(l._id, "stale", rev), /REVISION_CONFLICT/);
      await persist({ ...l, name: "Changed later" }); assert.deepEqual(await edge(l._id), reviewed);
    });
    await t.test("rejection durable, detached history retained and identity reevaluated", async () => {
      const n = await number(), l = await lead(n.e164); await persist(l); await attach(l._id, "attach-detach");
      let row = await edge(l._id);
      await commandAttachment({ actor, attachment_id: String(row._id), idempotency_key: "detach", command: { command: "detach_attachment", expected_revision: row.revision, reason: "Reevaluate" } });
      row = await edge(l._id); assert.equal(row.state, "candidate"); assert.equal(row.history.length, 3);
      assert.equal(resolveAtInteraction([attachmentPolicyInput(row)], { id: "i", started_at: at, provider_account_id: "a", call_log_ids: [] }).certainty, "likely");
      await commandAttachment({ actor, attachment_id: String(row._id), idempotency_key: "reject", command: { command: "reject_attachment", expected_revision: row.revision, reason: "Unrelated" } });
      const rejected = await edge(l._id); await persist(l); assert.deepEqual(await edge(l._id), rejected);
    });
    await t.test("exact Call Log/session identity stays interaction-scoped through CSI-11", async () => {
      const n = await number();
      const call = await getCallInteractionModel().create({ contact_number_id: n._id, provider: "ringcentral", provider_account_id: "800000000001",
        telephony_session_id: "csi05-exact", call_log_ids: ["csi05-log"], direction: "Inbound", started_at: at, first_observed_at: at, last_observed_at: at, identity_basis: "telephony_session_id" });
      const l = await lead(n.e164, at, "CallLead", { ringcentral: { telephony_session_id: "csi05-exact" } });
      await persist(l, "CallLead"); assert.equal((await edge(l._id)).certainty, "exact");
      const f = await lead(n.e164); await persist(f);
      const current = await withTransaction(s => loadEligibilityInputs(call, s)); assert.equal(current.leads.length, 1); assert.equal(current.leads[0]?.id, String(l._id));
      const later = await getCallInteractionModel().create({ contact_number_id: n._id, provider: "ringcentral", provider_account_id: "800000000001",
        telephony_session_id: "csi05-later", direction: "Inbound", started_at: at, first_observed_at: at, last_observed_at: at, identity_basis: "telephony_session_id" });
      assert.equal((await withTransaction(s => loadEligibilityInputs(later, s))).ambiguous, true);
      await drainAttachmentRefreshJobs(100);
      assert.ok(await Jobs.exists({ stage: "recording_discovery", input_refs: call._id, dedupe_key: /attachment:/ }));
    });
    await t.test("B job dispatch creates bounded scan jobs; current documents, no payload trust", async () => {
      const n = await number(), l = await lead(n.e164);
      const call = await getCallInteractionModel().create({ contact_number_id: n._id, provider: "ringcentral", provider_account_id: "800000000001",
        telephony_session_id: "csi05-wakeup", direction: "Inbound", started_at: at, first_observed_at: at, last_observed_at: at, identity_basis: "telephony_session_id" });
      const job = await withTransaction(s => enqueueCsiJob({ stage: "attachment_refresh", dedupe_key: `csi:attachment_refresh:number:${n._id}:1`,
        subject_key: `number:${n._id}`, input_revision: 1, input_refs: [String(call._id)] }, s));
      assert.equal((await dispatchCsiWakeup({ job_id: String(job._id), lead_id: String(l._id) })).status, "invalid_payload");
      const result = await dispatchCsiWakeup({ job_id: String(job._id) }); assert.equal(result.status, "dispatched");
      await drainAttachmentRefreshJobs(100); assert.equal((await edge(l._id)).state, "candidate");
      assert.equal((await runAttachmentRefreshJob(String(job._id))).status, "not_claimable");
    });
    await t.test("watermark tie pagination beyond batch; lease contention, stage separation and rollback", async () => {
      const many = Array.from({ length: 205 }, () => ({ _id: new mongoose.Types.ObjectId(), timestamp: at, updatedAt: at, createdAt: at }));
      await getFormLeadModel().collection.insertMany(many);
      const first = await runAttachmentRefreshOnce(); assert.ok(first.scanned <= 500);
      await runAttachmentRefreshOnce();
      for (const row of many) assert.ok(await Jobs.exists({ subject_key: `attachment-lead:FormLead:${row._id}` }));
      await getSalesIntelligenceSyncStateModel().updateOne({ scope: "attachment_suggest" }, { $set: { leased_until: new Date(Date.now() + 10000), lease_owner: "other" } });
      assert.equal((await runAttachmentRefreshOnce()).reason, "lease_held");
      const wrong = await withTransaction(s => enqueueCsiJob({ stage: "outreach_ensure", subject_key: "other", dedupe_key: "other", input_revision: 1 }, s));
      assert.equal((await runAttachmentRefreshJob(String(wrong._id))).status, "not_claimable");
      const job = await withTransaction(s => enqueueCsiJob({ stage: "attachment_refresh", subject_key: "expired", dedupe_key: "expired", input_revision: 1 }, s));
      const claimed = await claimCsiJob("expired", String(job._id), 300000, "attachment_refresh");
      await Jobs.updateOne({ _id: job._id }, { $set: { leased_until: new Date(0) } });
      await assert.rejects(completeCsiJob({ job_id: String(job._id), owner: "expired", epoch: claimed!.lease_epoch }, async s => {
        await Numbers.updateMany({}, { $set: { search_terms: ["must-rollback"] } }, { session: s });
      }), /LEASE_LOST/);
      assert.equal(await Numbers.countDocuments({ search_terms: "must-rollback" }), 0);
    });
    await t.test("Owner competing Attached requires review; independent CAS contenders cannot both win", async () => {
      const n = await number(), a = await lead(n.e164), b = await lead(n.e164); await persist(a); await persist(b);
      await attach(a._id, "competing-a"); await attach(b._id, "competing-b");
      const rows = await Edges.find({ contact_number_id: n._id }).lean();
      assert.equal(resolveAtInteraction(rows.map(attachmentPolicyInput), { id: "i", started_at: at, provider_account_id: "a", call_log_ids: [] }).blocked_reason, "competing_attached");
      const row = await edge(a._id);
      const commands = await Promise.allSettled(["one", "two"].map(key => commandAttachment({ actor, attachment_id: String(row._id), idempotency_key: `cas-${key}`,
        command: { command: "reject_attachment", expected_revision: row.revision, reason: "Synthetic competing edit" } })));
      assert.equal(commands.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(commands.filter(r => r.status === "rejected").length, 1);
    });
    await t.test("later contact snapshot preserves original evidence; adopted Call Log identity is exact", async () => {
      const original = await number(), later = await number(), l = await lead(original.e164); await persist(l);
      const oldEvidence = (await edge(l._id)).evidence;
      await persist({ ...l, normalized_phone_number: later.e164, updatedAt: new Date("2026-09-05"),
        granot_contact_snapshot: { phone_number: later.e164, captured_at: new Date("2026-09-05") } });
      const edges = await Edges.find({ "lead_ref.id": l._id }).lean(); assert.equal(edges.length, 2);
      assert.deepEqual(edges.find(e => String(e.contact_number_id) === String(original._id))!.evidence, oldEvidence);
      const newEdge = edges.find(e => String(e.contact_number_id) === String(later._id))!;
      assert.equal(resolveAtInteraction([attachmentPolicyInput(newEdge)], { id: "i", started_at: at, provider_account_id: "a", call_log_ids: [] }).lead_effects_allowed, false);
      assert.ok(newEdge.evidence.some(e => e.field_path === "granot_contact_snapshot.phone_number"));
      const adoptedNumber = await number();
      const interaction = await getCallInteractionModel().create({ contact_number_id: adoptedNumber._id, provider: "ringcentral", provider_account_id: "800000000001",
        telephony_session_id: "adopted", call_log_ids: ["adopted-log"], direction: "Inbound", started_at: at, first_observed_at: at, last_observed_at: at, identity_basis: "telephony_session_id" });
      const adopted = await lead(adoptedNumber.e164, at, "CallLead", { ingestion_origin: "granot_lead_created", ringcentral: { call_log_id: "adopted-log" } });
      await persist(adopted, "CallLead"); assert.ok((await edge(adopted._id)).evidence.some(e => e.source === "ringcentral_call_adoption"));
      const originalJob = await withTransaction(s => enqueueCsiJob({ stage: "recording_discovery", dedupe_key: "original-discovery", subject_key: `interaction:${interaction._id}`, input_revision: 1,
        input_refs: [String(interaction._id)] }, s));
      await Jobs.updateOne({ _id: originalJob._id }, { $set: { status: "completed", completed_at: new Date() } });
      await attach(adopted._id, "adopted-owner");
      // Earlier watermark jobs intentionally exceed a drain budget; target the durable change intents directly.
      for (const hook of await Jobs.find({ stage: "attachment_refresh", subject_key: `attachment-change:${adoptedNumber._id}` })) {
        assert.equal((await runAttachmentRefreshJob(String(hook._id))).status, "completed");
      }
      assert.equal((await Jobs.findById(originalJob._id))?.status, "completed");
      assert.ok(await Jobs.exists({ stage: "recording_discovery", input_refs: interaction._id, dedupe_key: /attachment:/ }));
    });
    await t.test("GET and flag-off cron/worker/command do not mutate any collection or official records", async () => {
      const n = await Numbers.findOne().orFail(); const before = await snapshot();
      const page = await listAttachments({ contact_number_id: String(n._id), limit: 1 }); assert.ok(page.items.length);
      assert.equal(await snapshot(), before);
      process.env.SALES_INTELLIGENCE_ATTACHMENT_REFRESH = "false";
      assert.equal((await runAttachmentRefreshOnce()).reason, "disabled"); assert.equal((await runAttachmentRefreshJob()).status, "disabled");
      await assert.rejects(commandAttachment({ actor, idempotency_key: "off", command: { command: "attach_lead", contact_number_id: String(n._id),
        lead_ref: page.items[0]!.lead_ref, expected_revision: 1, reason: "Off" } }), /FEATURE_DISABLED/);
      assert.equal(await snapshot(), before);
      assert.equal(await db.collection("entity_changes").countDocuments(), 0);
      assert.equal(await db.collection("outreach_records").countDocuments(), 0);
      assert.equal(await Jobs.countDocuments({ stage: { $in: ["analysis", "transcription", "media_fetch"] } }), 0);
      // loadLead is a read; missing rows never mint official records.
      assert.equal(await withTransaction(s => loadLead({ model: "CallLead", id: String(new mongoose.Types.ObjectId()) }, s)), null);
    });
  } finally { await db.dropDatabase(); await mongoose.disconnect(); }
});
