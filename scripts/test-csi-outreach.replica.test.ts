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
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../src/models/OutreachFollowup";
import { getNumberLeadAttachmentModel } from "../src/models/NumberLeadAttachment";
import { getRepIdentityLinkModel } from "../src/models/RepIdentityLink";
import { getSalesIntelligenceContactRestrictionModel } from "../src/models/SalesIntelligenceContactRestriction";
import { getSalesIntelligenceReviewItemModel } from "../src/models/SalesIntelligenceReviewItem";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../src/models/IntelligenceFinding";
import { getLeadConversationModel } from "../src/models/LeadConversation";
import { requireCsiOwner } from "../src/services/salesIntelligence/auth";
import { computeAdminActorSignature } from "../src/services/operationsRegistry/trustedActor";
import { persistLeadAttachments } from "../src/services/salesIntelligence/attachment/store";
import { commandAttachment } from "../src/services/salesIntelligence/attachment/commands";
import { ensureLead, ensureInteraction, workerContext } from "../src/services/salesIntelligence/outreach/ensure";
import { runOutreachEnsureJob, runOutreachEnsureOnce } from "../src/services/salesIntelligence/outreach/worker";
import { applyOutreachEffect, outreachEffectInputSchema } from "../src/services/salesIntelligence/outreach/effects";
import { commandOutreach } from "../src/services/salesIntelligence/followups/commands";
import { readOutreach } from "../src/services/salesIntelligence/outreach/reads";
import { getContactNumberDetail } from "../src/services/numberActivity/contactNumbers";
import { getNumberTimeline } from "../src/services/numberActivity/timeline";
import { enqueueCsiJob, claimCsiJob, completeCsiJob } from "../src/services/salesIntelligence/jobs";
import { dispatchCsiWakeup } from "../src/services/numberActivity/jobDispatch";
import { getEntityChangeModel } from "../src/models/EntityChange";
import { publishAttentionSnapshot, readAttention } from "../src/services/salesIntelligence/outreach/attention";
import type { CsiCommand } from "../src/validation/v1/salesIntelligence";

test("CSI-06 disposable replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 240000 }, async t => {
  assert.match(getMongoDatabaseName(), /^testvantagemovers_csi06[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01"); await applyCsiMigration();
  const at = new Date("2026-09-01T12:00:00Z"), oid = () => new mongoose.Types.ObjectId();
  const request: Request = Object.assign(Object.create(express.request), { method: "POST", originalUrl: "/api/v1/admin/sales-intelligence/outreach/commands",
    headers: {}, vantageAuth: { kind: "user", userId: "synthetic-owner", email: "owner@example.test", roles: ["owner"] } });
  const fields = { adminId: "synthetic-owner", email: "owner@example.test", role: "owner", timestamp: String(Date.now()), requestId: "csi06-proof", method: request.method, path: request.originalUrl };
  request.headers = { "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role,
    "x-vantage-admin-timestamp": fields.timestamp, "x-vantage-admin-request-id": fields.requestId,
    "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!) };
  const actor = requireCsiOwner(request), Records = getOutreachRecordModel(), Actions = getOutreachFollowupModel();
  let serial = 0;
  async function fixture(extra = {}) {
    const n = await getContactNumberModel().create({ e164: `+120255501${String(++serial).padStart(2,"0")}`, digits_reversed: `n${serial}`, first_observed_at: at, last_activity_at: at });
    const lead = { _id: oid(), timestamp: at, createdAt: at, updatedAt: at, name: "Synthetic CSI-06", normalized_phone_number: n.e164,
      ingested_contact_snapshot: { normalized_phone_number: n.e164, captured_at: at }, receiver_agent: oid(), ...extra };
    await getFormLeadModel().collection.insertOne(lead);
    await withTransaction(async session => { await ensureLead({ model: "FormLead", id: String(lead._id) }, workerContext(session, String(oid()), at), String(n._id));
      await persistLeadAttachments(lead, "FormLead", session, String(oid()), at); });
    const record = await Records.findOne({ "subject.id": lead._id }).orFail();
    return { n, lead, record };
  }
  async function call(number: mongoose.Types.ObjectId, options: Record<string, unknown> = {}) {
    return getCallInteractionModel().create({ provider_account_id: "synthetic", telephony_session_id: String(oid()), identity_basis: "telephony_session_id",
      contact_number_id: number, direction: "Inbound", started_at: new Date(+at + 60000), first_observed_at: at, last_observed_at: at,
      terminal: true, inbound_route_id: oid(), parties: [], ...options });
  }
  const user = (direction = "Outbound") => [{ role: "user", extension_id: "101", direction, connected: true }];
  const processCall = (c: Awaited<ReturnType<typeof call>>) => withTransaction(s => ensureInteraction(c, workerContext(s, String(oid()), new Date("2026-09-02T12:00:00Z"))));
  const current = (id: unknown) => Records.findById(id).orFail();
  async function command(target: unknown, body: CsiCommand, key = String(oid())) { return commandOutreach({ actor, target_id: String(target), command: body, idempotency_key: key }); }
  const alex = oid(), jordan = oid(), casey = oid();
  await getRepIdentityLinkModel().create({ agent_id: jordan, agent_name_snapshot: "Jordan", rc_account_id: "synthetic", rc_extension_id: "101", role_kind: "sales_rep", status: "reviewed", effective_from: at });
  async function effect(f: Awaited<ReturnType<typeof fixture>>, c: Awaited<ReturnType<typeof call>>, overrides: Record<string, unknown> = {}) {
    const run_id = oid(), finding_id = oid(), r = await current(f.record._id);
    await getIntelligenceRunModel().collection.insertOne({ _id: run_id, subject_key: `lead:FormLead:${f.lead._id}`, contact_number_id: f.n._id, job_id: oid() } as never);
    await getIntelligenceFindingModel().collection.insertOne({ _id: finding_id, run_id, key: "promise" } as never);
    return outreachEffectInputSchema.parse({ run_id: String(run_id), finding_id: String(finding_id), finding_key: "promise", outreach_record_id: String(r._id), interaction_id: String(c._id), expected_revision: r.revision,
      kind: "create_followup", action_kind: "call", description: "Call Friday", origin: "rep_promise", promising_agent_id: String(jordan), clear: true, history_complete: true,
      date: { exact: "2026-09-04T16:00:00Z" }, ...overrides });
  }
  const apply = (e: ReturnType<typeof outreachEffectInputSchema.parse>) => withTransaction(s => applyOutreachEffect(e, workerContext(s, String(oid()))));
  const snapshot = async () => JSON.stringify(await Promise.all((await db.listCollections().toArray()).sort((a,b) => a.name.localeCompare(b.name)).map(async c => [c.name, await db.collection(c.name).find().sort({ _id: 1 }).toArray()])));
  try {
    await t.test("CSI-13 repeated source commitment survives changed speaker certainty without duplication", async () => {
      const f = await fixture(), c = await call(f.n._id, { direction: "Outbound", parties: user() });
      assert.equal((await apply(await effect(f, c))).status, "applied");
      assert.equal((await apply(await effect(f, c, { promising_agent_id: null }))).status, "no_change");
      assert.equal(await Actions.countDocuments({ source_interaction_id: c._id, origin: "rep_promise" }), 1);
      assert.equal((await Actions.findOne({ source_interaction_id: c._id, origin: "rep_promise" }).orFail()).source_finding_ids.length, 2);
      assert.equal((await apply(await effect(f, c, { description: "A potentially different callback" }))).status, "needs_review");
      assert.equal(await Actions.countDocuments({ source_interaction_id: c._id, origin: "rep_promise" }), 1);
    });
    await t.test("CSI-13 conversation authority rejects candidates and foreign pointers, accepts current Owner attachment", async () => {
      const f = await fixture(), c = await call(f.n._id);
      const conversation = await getLeadConversationModel().create({ provider: "ringcentral", provider_account_id: "synthetic", provider_recording_id: String(oid()),
        call_interaction_id: c._id, contact_number_id: f.n._id, started_at: c.started_at, direction: "Inbound", match_method: "number_only", match_confidence: "low", state: "transcribed" });
      const e = await effect(f, c);
      await getIntelligenceRunModel().collection.updateOne({ _id: new mongoose.Types.ObjectId(e.run_id) }, { $set: {
        subject_key: `conversation:${conversation._id}`, conversation_id: conversation._id, outreach_record_id: f.record._id } });
      await assert.rejects(apply(e), /EVIDENCE_SCOPE_INVALID/);
      const edge = await getNumberLeadAttachmentModel().findOne({ "lead_ref.id": f.lead._id }).orFail();
      await commandAttachment({ actor, idempotency_key: String(oid()), command: { command: "attach_lead", expected_revision: edge.revision,
        contact_number_id: String(f.n._id), lead_ref: { model: "FormLead", id: String(f.lead._id) }, reason: "Synthetic reviewed attachment" } });
      const foreign = await fixture();
      await assert.rejects(apply({ ...e, outreach_record_id: String(foreign.record._id) }), /EVIDENCE_SCOPE_INVALID/);
      assert.equal((await apply({ ...e, expected_revision: (await current(f.record._id)).revision })).status, "applied");
    });
    await t.test("inbound human opens; missed does not; no-answer/voicemail exact outcomes", async () => {
      const f = await fixture(); const missed = await call(f.n._id); await processCall(missed);
      assert.equal((await current(f.record._id)).state, "unworked");
      const human = await call(f.n._id, { started_at: new Date(+at + 120000), contact_type: "human_conversation", parties: user("Inbound") }); await processCall(human);
      const r = await current(f.record._id); assert.equal(r.state, "open"); assert.equal(+r.last_meaningful_contact_at!, +human.started_at);
      assert.equal(String(r.responsible_agent_id), String(jordan));
      assert.equal(await Actions.countDocuments({ outreach_record_id: r._id, status: "open" }), 0);
      const g = await fixture(); const outbound = await call(g.n._id, { direction: "Outbound", parties: user(), contact_type: "voicemail" }); await processCall(outbound);
      assert.equal((await current(g.record._id)).state, "open"); assert.equal((await current(g.record._id)).last_meaningful_contact_at, null);
    });
    await t.test("duplicate misses keep first deadline, late callback resolves and older miss cannot resurrect", async () => {
      const f = await fixture(); const first = await call(f.n._id); await processCall(first);
      const initial = await Actions.findOne({ outreach_record_id: f.record._id }).orFail();
      const later = await call(f.n._id, { started_at: new Date(+at + 300000) }); await processCall(later); await processCall(later);
      const updated = await Actions.findById(initial._id).orFail(); assert.equal(+updated.due_at!, +initial.due_at!); assert.equal(updated.trigger_interaction_ids.length, 2);
      const callback = await call(f.n._id, { started_at: new Date(+at + 600000), direction: "Outbound", parties: user() }); await processCall(callback);
      assert.equal((await Actions.findById(initial._id))?.disposition, "no_answer");
      await processCall(await call(f.n._id, { started_at: new Date(+at + 400000) }));
      assert.equal(await Actions.countDocuments({ outreach_record_id: f.record._id, status: "open" }), 0);
    });
    await t.test("three actions including undated; individual completion and snooze contracts", async () => {
      const f = await fixture();
      for (const [kind, due] of [["call", "2026-09-04T16:00:00Z"], ["send_estimate", "2026-09-02T16:00:00Z"], ["check_availability", null]] as const) {
        const r = await current(f.record._id); await command(r._id, { command: "create_followup", expected_revision: r.revision, outreach_record_id: String(r._id), action: { kind, description: kind, due_at: due } });
      }
      const rows = await Actions.find({ outreach_record_id: f.record._id }); assert.equal(rows.length, 3);
      const undated = rows.find(a => !a.due_at)!;
      await assert.rejects(command(undated._id, { command: "snooze_followup", expected_revision: undated.revision, until: "2027-01-01T12:00:00Z", reason: "Later" }), /INVALID_INPUT/);
      const a = rows.find(a => a.kind === "call")!;
      await command(a._id, { command: "snooze_followup", expected_revision: a.revision, until: "2027-01-01T12:00:00Z", reason: "Later" });
      const snoozed = await Actions.findById(a._id).orFail(); assert.equal(+snoozed.due_at!, +a.due_at!);
      await command(a._id, { command: "complete_followup", expected_revision: snoozed.revision, disposition: "no_answer" });
      assert.equal(await Actions.countDocuments({ outreach_record_id: f.record._id, status: "open" }), 2);
    });
    await t.test("Alex/Jordan/Casey, duplicate apply, repeated promise, Owner correction beats applying run", async () => {
      const f = await fixture(); await command(f.record._id, { command: "assign", expected_revision: f.record.revision, responsible_agent_id: String(alex) });
      const c = await call(f.n._id, { duration_seconds: 20, contact_type: "human_conversation", parties: user("Inbound") });
      const e = await effect(f,c); const first = await apply(e); assert.equal(first.status, "applied"); assert.deepEqual(await apply(e), first);
      const a = await Actions.findById(first.target_id).orFail(); assert.equal(String(a.responsible_agent_id), String(jordan)); assert.equal(String((await current(f.record._id)).responsible_agent_id), String(alex));
      await command(a._id, { command: "patch_followup", expected_revision: a.revision, changes: { responsible_agent_id: String(casey), due_at: "2026-09-05T17:00:00Z" }, reason: "Owner correction" });
      const repeated = await effect(f,c); assert.equal((await apply(repeated)).status, "no_change"); assert.equal(await Actions.countDocuments({ outreach_record_id: f.record._id }), 1);
      const stale = await effect(f,c, { kind: "revise_followup", target_followup_id: String(a._id), expected_action_revision: a.revision });
      assert.equal((await apply(stale)).status, "blocked_owner"); assert.equal(String((await Actions.findById(a._id))?.responsible_agent_id), String(casey));
      assert.equal(String((await getFormLeadModel().findById(f.lead._id).lean())?.receiver_agent), String(f.lead.receiver_agent));
    });
    await t.test("unknown promising rep remains unassigned despite overall owner; voicemail never human", async () => {
      const f = await fixture(); await command(f.record._id, { command: "assign", expected_revision: f.record.revision, responsible_agent_id: String(alex) });
      const c = await call(f.n._id, { contact_type: "voicemail", provider_connected: true });
      const e = await effect(f,c, { origin: "rep_promise", promising_agent_id: null, date: {} });
      const result = await apply(e), a = await Actions.findById(result.target_id).orFail(); assert.equal(a.responsible_agent_id, null); assert.equal(a.due_at, null);
      assert.equal((await current(f.record._id)).last_meaningful_contact_at, null);
    });
    await t.test("concurrent Owner date correction and worker revision serialize without losing the Owner instruction", async () => {
      const f = await fixture(), c = await call(f.n._id, { parties: user("Inbound") });
      const created = await apply(await effect(f,c)), action = await Actions.findById(created.target_id).orFail();
      const later = await call(f.n._id, { parties: user("Inbound"), started_at: new Date("2026-09-02T16:00:00Z") });
      const update = await effect(f,later, { kind: "revise_followup", target_followup_id: String(action._id), expected_action_revision: action.revision, date: { exact: "2026-09-05T16:00:00Z" } });
      const correction = (revision: number) => command(action._id, { command: "patch_followup", expected_revision: revision, changes: { due_at: "2026-09-06T17:00:00Z", responsible_agent_id: String(casey) }, reason: "Owner correction racing extraction" });
      const [ownerResult, workerResult] = await Promise.allSettled([correction(action.revision), apply(update)]);
      assert.equal(workerResult.status, "fulfilled");
      if (ownerResult.status === "rejected") {
        assert.match(String(ownerResult.reason), /REVISION_CONFLICT/);
        await correction((await Actions.findById(action._id).orFail()).revision);
      }
      await apply(update);
      const final = await Actions.findById(action._id).orFail();
      assert.equal(final.due_at?.toISOString(), "2026-09-06T17:00:00.000Z"); assert.equal(String(final.responsible_agent_id), String(casey));
      assert.equal((await apply(await effect(f,later, { kind: "revise_followup", target_followup_id: String(action._id), expected_action_revision: final.revision }))).status, "blocked_owner");
    });
    await t.test("official closure while identity blocked wins over attach; cancellations retained", async () => {
      const f = await fixture();
      await command(f.record._id, { command: "create_followup", expected_revision: f.record.revision, outreach_record_id: String(f.record._id), action: { kind: "call", description: "Call", due_at: null } });
      await Records.updateOne({ _id: f.record._id }, { $set: { state: "identity_review", state_before_identity_review: "open" } });
      await getFormLeadModel().collection.updateOne({ _id: f.lead._id }, { $set: { booked: oid() } });
      const edge = await getNumberLeadAttachmentModel().findOne({ "lead_ref.id": f.lead._id }).orFail();
      await commandAttachment({ actor, idempotency_key: String(oid()), command: { command: "attach_lead", expected_revision: edge.revision, contact_number_id: String(f.n._id), lead_ref: { model: "FormLead", id: String(f.lead._id) }, reason: "Owner identity" } });
      const closed = await current(f.record._id); assert.equal(closed.state, "closed"); assert.equal(closed.closed_reason, "booked"); assert.equal(closed.state_before_identity_review, null);
      assert.equal(await Actions.countDocuments({ outreach_record_id: closed._id, status: "cancelled" }), 1);
      const reopened = await command(closed._id, { command: "reopen", expected_revision: closed.revision, reason: "Try" }); assert.equal(reopened.response && (reopened.response as { blocked: string }).blocked, "official_closure");
    });
    await t.test("closed work new request stays Closed and review; no Number Review evasion", async () => {
      const f = await fixture({ booked: oid() });
      const c = await call(f.n._id, { started_at: new Date("2026-10-01T12:00:00Z") }); await processCall(c);
      assert.equal((await current(f.record._id)).state, "closed");
      assert.equal(await Records.countDocuments({ "subject.contact_number_id": f.n._id }), 0);
      assert.ok(await getSalesIntelligenceReviewItemModel().exists({ subject_key: `lead:FormLead:${f.lead._id}`, cause_kind: "closed_work_request" }));
    });
    await t.test("restriction pauses Owner callback without rewriting it; review dismissal cannot lift", async () => {
      const f = await fixture(); await command(f.record._id, { command: "create_followup", expected_revision: f.record.revision, outreach_record_id: String(f.record._id), action: { kind: "call", description: "Owner callback", due_at: "2026-09-04T16:00:00Z" } });
      const before = await Actions.findOne({ outreach_record_id: f.record._id }).lean();
      const c = await call(f.n._id); const pause = await effect(f,c, { kind: "pause_channel", channels: ["call"], date: {} });
      const paused = await apply(pause); assert.deepEqual(await apply(pause), paused);
      assert.ok(await getSalesIntelligenceContactRestrictionModel().exists({ _id: paused.target_id }));
      assert.deepEqual(await Actions.findOne({ outreach_record_id: f.record._id }).lean(), before);
      const detail = await readOutreach(String(f.record._id)); assert.ok(detail?.data.outreach.derived.call_blockers.includes("restriction"));
      const review = await getSalesIntelligenceReviewItemModel().findOne({ subject_key: `number:${f.n._id}`, cause_kind: "restriction" }).orFail();
      await assert.rejects(command(review._id, { command: "resolve_review", expected_revision: review.revision, resolution: "no_action", completed_command_id: null, reason: "Dismiss" }), /ILLEGAL_TRANSITION/);
      const restriction = await getSalesIntelligenceContactRestrictionModel().findOne({ contact_number_id: f.n._id }).orFail();
      await command(restriction._id, { command: "resolve_restriction", expected_revision: restriction.revision, resolution: "lift", channels: ["call"], until: null, reason: "Owner resolved" });
      assert.equal((await current(f.record._id)).state, "unworked");
    });
    await t.test("Owner note no implied contact/work; CAS race and durable idempotent response", async () => {
      const f = await fixture(), key = String(oid()); const body = { command: "add_note" as const, expected_revision: f.record.revision, text: "Context only" };
      const first = await command(f.record._id, body, key); assert.equal((await command(f.record._id, body, key)).replayed, true);
      assert.equal((await current(f.record._id)).state, "unworked"); assert.equal((await current(f.record._id)).last_meaningful_contact_at, null);
      await assert.rejects(command(f.record._id, { ...body, text: "Changed" }, key), /IDEMPOTENCY_CONFLICT/);
      const r = await current(f.record._id); const results = await Promise.allSettled([command(r._id, { command: "assign", expected_revision: r.revision, responsible_agent_id: String(alex) }), command(r._id, { command: "assign", expected_revision: r.revision, responsible_agent_id: String(casey) })]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.ok(first.response);
    });
    await t.test("registered worker, duplicate wake-up, stage and expired-lease fences; flags off", async () => {
      const f = await fixture(), c = await call(f.n._id, { direction: "Outbound", parties: user() });
      const job = await withTransaction(s => enqueueCsiJob({ stage: "outreach_ensure", subject_key: `number:${f.n._id}`, dedupe_key: `csi:outreach_ensure:interaction:${c._id}:1`, input_revision: 1, input_refs: [String(c._id)] }, s));
      const result = await dispatchCsiWakeup({ job_id: String(job._id) }); assert.equal(result.status, "dispatched"); assert.equal((await runOutreachEnsureJob(String(job._id))).status, "not_claimable");
      const queued = await withTransaction(s => enqueueCsiJob({ stage: "outreach_ensure", subject_key: "test", dedupe_key: String(oid()), input_revision: 1, input_refs: [String(c._id)] }, s));
      const lease = await claimCsiJob("proof", String(queued._id), 300000, "outreach_ensure"); assert.ok(lease);
      await getSalesIntelligenceJobModel().updateOne({ _id: queued._id }, { $set: { leased_until: new Date(0) } });
      await assert.rejects(completeCsiJob({ job_id: String(queued._id), owner: "proof", epoch: lease.lease_epoch }, async s => { await Records.updateOne({ _id: f.record._id }, { $set: { state: "closed" } }, { session: s }); }), /LEASE_LOST/);
      assert.equal((await current(f.record._id)).state, "open");
      process.env.SALES_INTELLIGENCE_OUTREACH_ENSURE = "false"; const before = await snapshot(); assert.equal((await runOutreachEnsureOnce()).reason, "disabled"); assert.equal(await snapshot(), before); process.env.SALES_INTELLIGENCE_OUTREACH_ENSURE = "true";
    });
    await t.test("GET does not mutate and Number detail returns plural Outreach DTOs", async () => {
      const f = await fixture(); await command(f.record._id, { command: "add_note", expected_revision: f.record.revision, text: "Context for timeline" });
      const before = await snapshot(); const detail = await getContactNumberDetail(String(f.n._id));
      const timeline = await getNumberTimeline(String(f.n._id), { limit: 50 });
      assert.ok(timeline?.data.items.some(e => e.kind === "owner_note" && JSON.stringify(e.detail).includes("Context for timeline")));
      assert.equal(detail?.data.outreach_records.length, 1); await readOutreach(String(f.record._id)); assert.equal(await snapshot(), before);
    });
    await t.test("two callbacks from one source with distinct dates stay independently addressable", async () => {
      const f = await fixture(), c = await call(f.n._id, { parties: user("Inbound") });
      const first = await apply(await effect(f,c));
      const second = await apply(await effect(f,c, { date: { exact: "2026-09-05T16:00:00Z" }, description: "Second callback Saturday" }));
      assert.notEqual(first.target_id, second.target_id);
      const action = await Actions.findById(first.target_id).orFail();
      await command(action._id, { command: "patch_followup", expected_revision: action.revision, changes: { due_at: "2026-09-06T16:00:00Z" }, reason: "Owner date" });
      assert.equal((await apply(await effect(f,c))).target_id, first.target_id);
      assert.equal(await Actions.countDocuments({ outreach_record_id: f.record._id }), 2);
      await processCall(await call(f.n._id, { direction: "Outbound", parties: user(), started_at: new Date("2026-09-07T16:00:00Z") }));
      assert.equal(await Actions.countDocuments({ outreach_record_id: f.record._id, status: "open" }), 2, "ambiguous call cannot complete two independent callbacks");
      assert.ok(await getSalesIntelligenceReviewItemModel().exists({ subject_key: `lead:FormLead:${f.lead._id}`, cause_kind: "completion_target" }));
    });
    await t.test("wait callback keeps Jordan, independent estimate remains active; expiry never rewaits", async () => {
      const f = await fixture(); await command(f.record._id, { command: "mark_worked", expected_revision: f.record.revision });
      const c = await call(f.n._id, { parties: user("Inbound"), contact_type: "human_conversation" });
      const wait = await apply(await effect(f,c, { action_kind: "wait", origin: "customer_wait", date: { exact: "2026-09-03T12:00:00Z" } }));
      let r = await current(f.record._id);
      await command(r._id, { command: "create_followup", expected_revision: r.revision, outreach_record_id: String(r._id), action: { kind: "send_estimate", description: "Estimate", due_at: null } });
      r = await current(r._id); assert.equal(r.state, "open");
      const missed = await call(f.n._id, { started_at: new Date("2026-09-02T13:00:00Z") }); await processCall(missed);
      assert.equal((await Actions.findById(wait.target_id))?.disposition, "customer_called");
      const episode = await Actions.findOne({ outreach_record_id: r._id, status: "open", missed_episode_key: { $ne: null } }).orFail();
      assert.equal(String(episode.responsible_agent_id), String(jordan)); assert.equal(await Actions.countDocuments({ outreach_record_id: r._id, kind: "send_estimate", status: "open" }), 1);
    });
    await t.test("permanent suppression blocks reopen; ordinary close/reopen never revives cancelled action", async () => {
      const f = await fixture(); await command(f.record._id, { command: "close", expected_revision: f.record.revision, reason: "suppressed" });
      const r = await current(f.record._id);
      await assert.rejects(command(r._id, { command: "reopen", expected_revision: r.revision, reason: "Try" }), /ILLEGAL_TRANSITION/);
      const g = await fixture(); await command(g.record._id, { command: "create_followup", expected_revision: g.record.revision, outreach_record_id: String(g.record._id), action: { kind: "call", description: "Call", due_at: null } });
      let other = await current(g.record._id); await command(other._id, { command: "close", expected_revision: other.revision, reason: "owner_dismissed" });
      other = await current(other._id); await command(other._id, { command: "reopen", expected_revision: other.revision, reason: "New request" });
      assert.equal(await Actions.countDocuments({ outreach_record_id: other._id, status: "cancelled" }), 1); assert.equal(await Actions.countDocuments({ outreach_record_id: other._id, status: "open" }), 0);
    });
    await t.test("Owner contact-type correction is immediate while AI off; unknown retracts contact stamp", async () => {
      const f = await fixture(), c = await call(f.n._id, { provider_connected: true, parties: user("Inbound") }); await processCall(c);
      await command(c._id, { command: "set_contact_type", expected_revision: c.projection_revision, contact_type: "human_conversation", reason: "Owner witnessed conversation" });
      assert.equal((await current(f.record._id)).state, "open"); assert.ok((await current(f.record._id)).last_meaningful_contact_at);
      const corrected = await getCallInteractionModel().findById(c._id).orFail();
      await command(c._id, { command: "set_contact_type", expected_revision: corrected.projection_revision, contact_type: "unknown", reason: "Correct evidence" });
      assert.equal((await current(f.record._id)).last_meaningful_contact_at, null);
    });
    await t.test("fulfilled source commitment dedupes after completion evidence changes; old promise after Booking is blocked", async () => {
      const f = await fixture(), source = await call(f.n._id, { parties: user("Inbound") });
      const made = await apply(await effect(f, source));
      await processCall(await call(f.n._id, { direction: "Outbound", parties: user(), started_at: new Date("2026-09-04T16:01:00Z") }));
      assert.equal((await Actions.findById(made.target_id))?.status, "completed");
      assert.equal((await apply(await effect(f, source))).status, "no_change"); assert.equal(await Actions.countDocuments({ outreach_record_id: f.record._id }), 1);
      await getFormLeadModel().collection.updateOne({ _id: f.lead._id }, { $set: { booked: oid() } });
      assert.equal((await apply(await effect(f, source))).status, "blocked_closed"); assert.equal((await current(f.record._id)).state, "closed");
    });
    await t.test("old mapped missed traffic creates Number Review without age expiry; ambiguous Lead does not", async () => {
      const n = await getContactNumberModel().create({ e164: "+12025550198", digits_reversed: "98105552021", first_observed_at: at, last_activity_at: at });
      await processCall(await call(n._id));
      const r = await Records.findOne({ "subject.contact_number_id": n._id }).orFail(); assert.equal(r.trigger_kind, "unanswered_inbound");
      assert.equal(await Actions.countDocuments({ outreach_record_id: r._id, status: "open" }), 1);
      const f = await fixture(); const other = { ...f.lead, _id: oid() }; await getFormLeadModel().collection.insertOne(other);
      await withTransaction(s => persistLeadAttachments(other, "FormLead", s, String(oid()), at)); await processCall(await call(f.n._id));
      assert.equal(await Records.countDocuments({ "subject.contact_number_id": f.n._id }), 0); assert.equal((await current(f.record._id)).state, "identity_review");
    });
    await t.test("EntityChange applied_at source closes No-Sync Lead without updating source timestamp", async () => {
      const f = await fixture(); await getFormLeadModel().collection.updateOne({ _id: f.lead._id }, { $set: { no_sync: true } });
      const applied = new Date();
      await getEntityChangeModel().collection.insertOne({ _id: oid(), entity: { model: "FormLead", id: String(f.lead._id) }, command_execution_id: oid(), command_name: "synthetic", changed_paths: ["no_sync"], fields: [], revision_before: 1, revision_after: 2, applied_at: applied } as never);
      await runOutreachEnsureOnce(); assert.equal((await current(f.record._id)).closed_reason, "no_sync");
      assert.equal(+(await getFormLeadModel().findById(f.lead._id).lean())!.updatedAt!, +at);
    });
    await t.test("watermark baseline/recovery scans execute without providers", async () => { const result = await runOutreachEnsureOnce(); assert.equal(result.skipped, false); assert.ok(result.scanned > 0); });
    await t.test("Attention immutable pagination, one row per subject, all reads remain read-only", async () => {
      assert.equal((await publishAttentionSnapshot()).status, "published"); const before = await snapshot();
      const first = await readAttention({ limit: 1 }); assert.equal(first.data.status, "ready"); assert.ok(first.data.cursor);
      const next = await readAttention({ limit: 200, cursor: first.data.cursor! });
      const keys = [...first.data.items, ...next.data.items].map(r => r.subject_key); assert.equal(new Set(keys).size, keys.length);
      assert.equal(next.as_of, first.as_of); assert.equal(await snapshot(), before);
      await assert.rejects(readAttention({ limit: 1, cursor: first.data.cursor!, band: 1 }), /INVALID_INPUT/);
    });
  } finally { await db.dropDatabase(); await mongoose.disconnect(); }
});
