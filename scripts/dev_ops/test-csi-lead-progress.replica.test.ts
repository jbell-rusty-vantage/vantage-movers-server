import assert from "node:assert/strict";
import { test } from "node:test";
import express, { type Request } from "express";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getCallLeadModel } from "../../src/models/CallLead";
import { getEntityChangeModel } from "../../src/models/EntityChange";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { getNumberLeadAttachmentModel } from "../../src/models/NumberLeadAttachment";
import { getSalesIntelligenceAuditEventModel } from "../../src/models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceReviewItemModel } from "../../src/models/SalesIntelligenceReviewItem";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceSyncStateModel } from "../../src/models/SalesIntelligenceSyncState";
import { requireCsiOwner } from "../../src/services/salesIntelligence/auth";
import { computeAdminActorSignature } from "../../src/services/operationsRegistry/trustedActor";
import { ensureInteraction, ensureLead, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { drainOutreachEnsureJobs, runOutreachEnsureOnce } from "../../src/services/salesIntelligence/outreach/worker";
import { commandOutreach } from "../../src/services/salesIntelligence/followups/commands";
import { readOutreach } from "../../src/services/salesIntelligence/outreach/reads";
import { publishAttentionSnapshot, readAttention } from "../../src/services/salesIntelligence/outreach/attention";
import { createOwnerFollowup } from "../../src/services/salesIntelligence/followups/commands";
import type { CsiCommand } from "../../src/validation/v1/salesIntelligence";

test("LP-01/03/06 disposable replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300000 }, async t => {
  assert.match(getMongoDatabaseName(), /^testvantagemovers_lp01[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await applyCsiMigration();
  const at = new Date("2026-09-01T12:00:00Z"), oid = () => new mongoose.Types.ObjectId();
  const request: Request = Object.assign(Object.create(express.request), { method: "POST", originalUrl: "/api/v1/admin/sales-intelligence/outreach/commands", headers: {},
    vantageAuth: { kind: "user", userId: "synthetic-owner", email: "owner@example.test", roles: ["owner"] } });
  const fields = { adminId: "synthetic-owner", email: "owner@example.test", role: "owner", timestamp: String(Date.now()), requestId: "lp01-proof", method: request.method, path: request.originalUrl };
  request.headers = { "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role, "x-vantage-admin-timestamp": fields.timestamp,
    "x-vantage-admin-request-id": fields.requestId, "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!) };
  const actor = requireCsiOwner(request), Records = getOutreachRecordModel(), Actions = getOutreachFollowupModel(), Changes = getEntityChangeModel(), Audit = getSalesIntelligenceAuditEventModel();
  let serial = 0, revisions = new Map<string, number>();
  type Model = "FormLead" | "CallLead";
  async function lead(model: Model, extra: Record<string, unknown> = {}) {
    const _id = oid();
    const doc = { _id, timestamp: at, createdAt: at, updatedAt: at, name: `Synthetic LP-01 ${++serial}`, normalized_phone_number: `120255502${String(serial).padStart(2, "0")}`,
      quoted: false, domain_revision: 0, ...extra };
    await (model === "FormLead" ? getFormLeadModel() : getCallLeadModel()).collection.insertOne(doc as never);
    return { model, id: String(_id), _id };
  }
  const leadDoc = (ref: { model: Model; _id: mongoose.Types.ObjectId }) => (ref.model === "FormLead" ? getFormLeadModel() : getCallLeadModel()).collection.findOne({ _id: ref._id });
  /** Accepted canonical write: set the values on the Lead and append the EntityChange the command would have written. */
  async function accept(ref: { model: Model; id: string; _id: mongoose.Types.ObjectId }, patch: { granot_priority?: string | null; quoted?: boolean }, options: { source?: "granot" | "vantage"; applied_at?: Date; skipChange?: boolean } = {}) {
    const before = await leadDoc(ref);
    const revision = (revisions.get(ref.id) ?? 0) + 1; revisions.set(ref.id, revision);
    await (ref.model === "FormLead" ? getFormLeadModel() : getCallLeadModel()).collection.updateOne({ _id: ref._id }, { $set: { ...patch, domain_revision: revision } });
    if (options.skipChange) return null;
    const changeFields = Object.entries(patch).map(([path, after]) => ({ path, value_mode: "stored", before: before?.[path] ?? null, after }));
    const change = await Changes.collection.insertOne({ entity: { model: ref.model, id: ref.id }, command_execution_id: oid(), command_name: options.source === "vantage" ? "updateSourceOwnedLead" : "synchronizeLeadFromGranot",
      provenance: { source_system: options.source ?? "granot", actor: { actor_type: "system", actor_id: "test" }, initiator: { actor_type: "system", actor_id: "test" }, request_id: String(oid()), ...(options.source === "vantage" ? {} : { observation_id: oid(), decision_id: oid() }) },
      changed_paths: Object.keys(patch).sort(), fields: changeFields, revision_before: revision - 1, revision_after: revision, applied_at: options.applied_at ?? new Date() } as never);
    return String(change.insertedId);
  }
  const ensure = (ref: { model: Model; id: string }, changeId: string | null = null, numberId?: string) => withTransaction(s => ensureLead(ref, workerContext(s, String(oid())), numberId, { changeId }));
  const record = (ref: { model: Model; _id: mongoose.Types.ObjectId }) => Records.findOne({ "subject.model": ref.model, "subject.id": ref._id }).orFail();
  const audits = (ref: { model: Model; id: string }, kind: string) => Audit.countDocuments({ subject_key: `lead:${ref.model}:${ref.id}`, event_kind: kind });
  const command = (target: unknown, body: CsiCommand, key = String(oid())) => commandOutreach({ actor, target_id: String(target), command: body, idempotency_key: key });
  const publish = async () => { const out = await publishAttentionSnapshot(); assert.equal(out.status, "published"); return readAttention({ limit: 200 }); };
  const rowFor = (page: Awaited<ReturnType<typeof readAttention>>, ref: { model: Model; id: string }) => page.data.items.find(r => r.subject_key === `lead:${ref.model}:${ref.id}`);

  await t.test("case 1/2: accepted Priority 1 or Quoted opens an Unworked Lead into Band 5 without inventing calls; identical redelivery writes nothing", async () => {
    const form = await lead("FormLead"), call = await lead("CallLead");
    await ensure(form); await ensure(call);
    let before = await publish();
    assert.equal(rowFor(before, form)?.derived.attention_band, 2);
    const initialAudits = await audits(form, "lead_progress_updated");
    const changeId = await accept(form, { granot_priority: "1" });
    await ensure(form, changeId);
    const r = await record(form);
    assert.equal(r.state, "open"); assert.equal(r.lead_progress?.work_observed, true); assert.equal(r.lead_progress?.basis, "priority_assigned");
    assert.equal(String(r.lead_progress?.source_change_id), changeId); assert.equal(r.lead_progress?.provenance, "accepted"); assert.equal(r.lead_progress?.source_origin, "granot");
    assert.equal(r.first_attributable_outbound_at, null); assert.equal(r.first_human_conversation_at, null); assert.equal(r.last_meaningful_contact_at, null); assert.equal(r.responsible_agent_id, null);
    const revision = r.revision, audited = await audits(form, "lead_progress_updated");
    assert.equal(audited, initialAudits + 1, "one accepted change, one progress audit effect");
    await ensure(form, changeId); await ensure(form, null);
    assert.equal((await record(form)).revision, revision, "identical redelivery: no save"); assert.equal(await audits(form, "lead_progress_updated"), audited, "no new audit row");
    const quotedChange = await accept(call, { quoted: true });
    await ensure(call, quotedChange);
    assert.equal((await record(call)).state, "open"); assert.equal((await record(call)).lead_progress?.basis, "quoted");
    const after = await publish();
    for (const ref of [form, call]) {
      const row = rowFor(after, ref)!;
      assert.equal(row.derived.attention_band, 5, `${ref.model} reaches Band 5`); assert.ok(row.derived.reasons.includes("no_call_observed"));
      assert.equal(row.outreach?.lead_progress?.priority_label, ref.model === "FormLead" ? "Quoted" : "Not set");
      assert.equal(row.outreach?.lead_progress?.explanation, ref.model === "FormLead" ? "Lead updated in Granot · No next step set" : "Quoted · No next step set");
      assert.equal(row.sort_keys?.last_lead_progress, row.outreach?.lead_progress?.last_progress_at);
      assert.equal(row.sort_keys?.lead_received, row.outreach?.trigger_at);
    }
    before = after;
  });

  await t.test("case 3/17: 1 → 8 keeps Quoted, closes by CRM dead opportunity, cancels (never fulfils) the open action; 7 the same; official flags untouched", async () => {
    for (const [code, basis] of [["8", "granot_dead_opportunity"], ["7", "granot_bad_unusable"]] as const) {
      const form = await lead("FormLead");
      await ensure(form, await accept(form, { granot_priority: "1", quoted: true }));
      await withTransaction(async s => { const r = await Records.findById((await record(form))._id).session(s).orFail(); await createOwnerFollowup(r, { kind: "send_estimate", description: "Send estimate", due_at: null }, workerContext(s, String(oid()))); });
      const changeId = await accept(form, { granot_priority: code });
      await ensure(form, changeId);
      const r = await record(form);
      assert.equal(r.state, "closed"); assert.equal(r.closure_origin, "crm_disposition"); assert.equal(r.closed_reason, basis);
      assert.equal(r.lead_progress?.quoted, true, "stored Quoted is retained"); assert.equal(r.lead_progress?.work_observed, true, "earlier work is history");
      const actions = await Actions.find({ outreach_record_id: r._id }).lean();
      assert.equal(actions.length, 1); assert.equal(actions[0]!.status, "cancelled"); assert.equal(actions[0]!.cancel_reason, basis); assert.equal(actions[0]!.completed_at, null);
      const doc = await leadDoc(form);
      assert.equal(doc?.bad_lead ?? null, null); assert.equal(doc?.duplicate ?? false, false); assert.equal(doc?.booked ?? null, null);
      const page = await publish();
      assert.equal(rowFor(page, form), undefined, "closed work leaves active bands and totals");
      const read = await readOutreach(String(r._id));
      assert.equal(read?.data.outreach.lead_progress?.closure?.basis, basis);
      assert.equal(read?.data.outreach.allowed_actions.find(a => a.action === "reopen")?.enabled, false);
      assert.deepEqual(read?.data.outreach.allowed_actions.find(a => a.action === "reopen")?.blocker_codes, ["CRM_DISPOSITION_CLOSED"]);
      assert.equal(read?.data.outreach.allowed_actions.find(a => a.action === "override_disposition")?.enabled, true);
    }
  });

  await t.test("explicit 0, unmapped 5/9 and quoted=false never mark worked; 0 after 1 keeps the earlier work", async () => {
    const form = await lead("FormLead");
    for (const code of ["0", "5", "9"]) { await ensure(form, await accept(form, { granot_priority: code })); assert.equal((await record(form)).state, "unworked", `code ${code}`); }
    await ensure(form, await accept(form, { quoted: false, granot_priority: "0" }, { source: "vantage" }));
    assert.equal((await record(form)).state, "unworked");
    await ensure(form, await accept(form, { granot_priority: "1" }));
    assert.equal((await record(form)).state, "open");
    await ensure(form, await accept(form, { granot_priority: "0" }));
    const r = await record(form);
    assert.equal(r.state, "open"); assert.equal(r.lead_progress?.disposition, "fresh"); assert.equal(r.lead_progress?.work_observed, true);
  });

  await t.test("case 18: 7 → 8 → 1 queues one deduplicated reopen review, stays closed until Owner reopen; reopen revives no action", async () => {
    const form = await lead("FormLead");
    await ensure(form, await accept(form, { granot_priority: "1" }));
    await withTransaction(async s => { const r = await Records.findById((await record(form))._id).session(s).orFail(); await createOwnerFollowup(r, { kind: "call", description: "Call back", due_at: null }, workerContext(s, String(oid()))); });
    await ensure(form, await accept(form, { granot_priority: "7" }));
    await ensure(form, await accept(form, { granot_priority: "8" }));
    let r = await record(form);
    assert.equal(r.closed_reason, "granot_dead_opportunity"); assert.equal(r.state, "closed");
    const reopenChange = await accept(form, { granot_priority: "1" });
    await ensure(form, reopenChange); await ensure(form, reopenChange);
    r = await record(form);
    assert.equal(r.state, "closed", "a later nonterminal code does not reopen by itself");
    const reviews = await getSalesIntelligenceReviewItemModel().find({ subject_key: `lead:FormLead:${form.id}`, cause_kind: "disposition_reopen" }).lean();
    assert.equal(reviews.length, 1); assert.equal(reviews[0]!.state, "open"); assert.equal(String(r.lead_progress?.reopen_review_id), String(reviews[0]!._id));
    const read = await readOutreach(String(r._id));
    assert.equal(read?.data.outreach.allowed_actions.find(a => a.action === "reopen")?.enabled, true);
    await command(r._id, { command: "reopen", expected_revision: r.revision, reason: "Owner reopens after Granot moved it back to quoted" });
    r = await record(form);
    assert.equal(r.state, "open"); assert.equal(r.closure_origin, null); assert.equal(r.lead_progress?.reopen_review_id, null);
    assert.equal((await getSalesIntelligenceReviewItemModel().findById(reviews[0]!._id).lean())?.state, "resolved");
    assert.equal((await Actions.countDocuments({ outreach_record_id: r._id, status: "open" })), 0, "reopen revives no cancelled action");
    assert.equal((await Actions.countDocuments({ outreach_record_id: r._id, status: "cancelled" })), 1);
  });

  await t.test("case 18: revision-scoped Owner override reopens under 8, survives identical redelivery, expires on 7 and never bypasses official closure", async () => {
    const form = await lead("FormLead");
    await ensure(form, await accept(form, { granot_priority: "8" }));
    let r = await record(form);
    assert.equal(r.state, "closed");
    await assert.rejects(command(r._id, { command: "reopen", expected_revision: r.revision, reason: "Try to reopen while still dead" }), { code: "CRM_DISPOSITION_CLOSED" });
    await assert.rejects(command(r._id, { command: "override_disposition", expected_revision: r.revision, reason: "Stale revision", disposition_revision: "stale" }), { code: "REVISION_CONFLICT" });
    await command(r._id, { command: "override_disposition", expected_revision: r.revision, reason: "Customer called back, Owner keeps working it", disposition_revision: r.lead_progress!.disposition_revision });
    r = await record(form);
    assert.equal(r.state, "open"); assert.equal(r.lead_progress?.override?.reason, "Customer called back, Owner keeps working it");
    assert.equal(await Audit.countDocuments({ subject_key: `lead:FormLead:${form.id}`, event_kind: "override_disposition" }), 1);
    await ensure(form, await accept(form, { granot_priority: "8" }));
    r = await record(form);
    assert.equal(r.state, "open", "identical redelivery keeps the override"); assert.ok(r.lead_progress?.override);
    await ensure(form, await accept(form, { granot_priority: "7" }));
    r = await record(form);
    assert.equal(r.state, "closed", "a semantic disposition change expires the override"); assert.equal(r.lead_progress?.override, null); assert.equal(r.closed_reason, "granot_bad_unusable");
    // Official closure always wins: an override cannot reopen a booked Lead.
    const booked = await lead("FormLead", { booked: oid() });
    await ensure(booked, await accept(booked, { granot_priority: "8" }));
    r = await record(booked);
    assert.equal(r.closure_origin, "official"); assert.equal(r.closed_reason, "booked");
    assert.equal((await readOutreach(String(r._id)))?.data.outreach.allowed_actions.find(a => a.action === "override_disposition")?.enabled, false);
  });

  await t.test("§6: a terminal Priority of uncertain provenance opens a disposition review, blocks new sales execution and cancels nothing", async () => {
    const form = await lead("FormLead", { granot_priority: "8" });
    await ensure(form);
    const r = await record(form);
    assert.equal(r.state, "unworked"); assert.equal(r.lead_progress?.provenance, "uncertain"); assert.equal(r.lead_progress?.disposition, "crm_dead");
    const review = await getSalesIntelligenceReviewItemModel().findOne({ subject_key: `lead:FormLead:${form.id}`, cause_kind: "disposition_review" }).lean();
    assert.ok(review && review.state === "open");
    const read = await readOutreach(String(r._id));
    assert.ok(read?.data.outreach.derived.call_blockers.includes("disposition_review"));
    for (const action of ["create_followup", "set_waiting", "start_call"]) {
      const availability = read?.data.outreach.allowed_actions.find(a => a.action === action);
      assert.equal(availability?.enabled, false, `${action} disabled under review`); assert.ok(availability?.blocker_codes.includes("DISPOSITION_REVIEW"));
    }
    await assert.rejects(command(r._id, { command: "create_followup", expected_revision: r.revision, outreach_record_id: String(r._id), action: { kind: "call", description: "Call the customer", due_at: null } }), { code: "DISPOSITION_REVIEW" });
    // Once an accepted change vouches for the value the review resolves and the record closes.
    await ensure(form, await accept(form, { granot_priority: "8" }));
    assert.equal((await record(form)).state, "closed");
    assert.equal((await getSalesIntelligenceReviewItemModel().findById(review!._id).lean())?.state, "resolved");
  });

  await t.test("case 5 / H1a: call correction replay cannot return a Lead with valid progress to Unworked; identity resolution restores Open", async () => {
    const form = await lead("FormLead");
    const n = await getContactNumberModel().create({ e164: `+1202555${String(1000 + serial).slice(-4)}`, digits_reversed: `n${serial}x`, first_observed_at: at, last_activity_at: at });
    await getNumberLeadAttachmentModel().create({ contact_number_id: n._id, lead_ref: { model: "FormLead", id: form._id }, state: "attached", certainty: "likely",
      evidence: [{ source: "lead_phone_live", field_path: "normalized_phone_number", observed_at: at, window_from: new Date(+at - 3600000), window_to: new Date(+at + 86400000) }] });
    await ensure(form, await accept(form, { granot_priority: "1" }), String(n._id));
    assert.equal((await record(form)).state, "open");
    const c = await getCallInteractionModel().create({ provider_account_id: "synthetic", telephony_session_id: String(oid()), identity_basis: "telephony_session_id", contact_number_id: n._id, direction: "Outbound",
      started_at: new Date(+at + 60000), first_observed_at: at, last_observed_at: at, terminal: true, contact_type: "unknown", contact_type_basis: "owner", parties: [] });
    await withTransaction(s => ensureInteraction(c, workerContext(s, String(oid()))));
    const r = await record(form);
    assert.equal(r.state, "open", "the no-calls-remain branch respects Lead progress");
    await withTransaction(async s => { const row = await Records.findById(r._id).session(s).orFail(); row.state_before_identity_review = "unworked"; row.state = "identity_review"; await row.save({ session: s }); });
    await withTransaction(async s => { const row = await Records.findById(r._id).session(s).orFail(); const { restoreFromIdentityReview } = await import("../../src/services/salesIntelligence/outreach/ensure"); restoreFromIdentityReview(row); await row.save({ session: s }); });
    assert.equal((await record(form)).state, "open", "leaving identity review includes progress instead of returning to Unworked");
  });

  await t.test("case 10/§11: no Number still opens Band 5; an exact booked_leads row closes work even when the Lead mirror is delayed", async () => {
    const call = await lead("CallLead");
    await ensure(call, await accept(call, { granot_priority: "3" }));
    let r = await record(call);
    assert.equal(r.state, "open"); assert.equal(r.primary_contact_number_id, null); assert.equal(r.lead_progress?.disposition, "rep_discretion");
    assert.equal(rowFor(await publish(), call)?.derived.attention_band, 5);
    await db.collection("booked_leads").insertOne({ _id: oid(), lead_model: "CallLead", lead_ref: call._id, job_no: "LP01", createdAt: new Date() });
    await ensure(call);
    r = await record(call);
    assert.equal(r.state, "closed"); assert.equal(r.closed_reason, "booked"); assert.equal(r.closure_origin, "official");
    // Owner commands re-check the authoritative Booking first and answer with the official closure instead of acting.
    const blocked = await command(r._id, { command: "reopen", expected_revision: r.revision, reason: "Booked work stays closed" });
    assert.equal((blocked.response as { blocked?: string }).blocked, "official_closure");
    assert.equal((await record(call)).state, "closed");
  });

  await t.test("case 4: an overdue rep callback outranks Band 5; progress does not fulfil an estimate; Owner close wins over later progress", async () => {
    const form = await lead("FormLead");
    await ensure(form, await accept(form, { granot_priority: "1" }));
    await withTransaction(async s => { const r = await Records.findById((await record(form))._id).session(s).orFail(); const ctx = workerContext(s, String(oid()));
      const row = await createOwnerFollowup(r, { kind: "call", description: "Promised callback", due_at: new Date(+at + 3600000).toISOString() }, ctx);
      row.origin = "rep_promise"; await row.save({ session: s }); await createOwnerFollowup(r, { kind: "send_estimate", description: "Send estimate", due_at: null }, ctx, "estimate"); });
    await ensure(form, await accept(form, { quoted: true }));
    const page = await publish();
    assert.equal(rowFor(page, form)?.derived.attention_band, 1);
    assert.equal((await Actions.countDocuments({ outreach_record_id: (await record(form))._id, status: "open" })), 2, "a quote flag fulfils no estimate");
    const r = await record(form);
    await command(r._id, { command: "close", expected_revision: r.revision, reason: "lost" });
    await ensure(form, await accept(form, { granot_priority: "3" }));
    const closed = await record(form);
    assert.equal(closed.state, "closed"); assert.equal(closed.closure_origin, "owner"); assert.equal(closed.lead_progress?.disposition, "rep_discretion");
  });

  await t.test("H2/H3: a commit-lagged change behind the cursor is still enqueued; a create raises the attachment job; the flag-on repair key follows Priority", async () => {
    const State = getSalesIntelligenceSyncStateModel(), Jobs = getSalesIntelligenceJobModel();
    const form = await lead("FormLead");
    const now = new Date();
    await State.updateOne({ scope: "outreach_entity_changes" }, { $set: { "cursor.entity_change_applied_at": now, "cursor.entity_change_id": oid() } }, { upsert: true });
    const lagged = await accept(form, { granot_priority: "1" }, { applied_at: new Date(+now - 30_000) });
    await Changes.collection.insertOne({ entity: { model: "FormLead", id: form.id }, command_execution_id: oid(), command_name: "createFormLead", provenance: { source_system: "vantage", actor: {}, initiator: {} },
      changed_paths: ["normalized_phone_number", "quoted"], fields: [{ path: "quoted", value_mode: "stored", after: false }], revision_before: 0, revision_after: 99, applied_at: new Date(+now + 1000) } as never);
    const scan = await runOutreachEnsureOnce({ deadline: Date.now() + 30_000 });
    assert.equal(scan.skipped, false);
    assert.ok(await Jobs.exists({ dedupe_key: `csi:outreach:entity-change:v2:${lagged}` }), "the commit-lagged change was enqueued from the re-scan window");
    assert.ok(await Jobs.exists({ subject_key: `attachment-lead:FormLead:${form.id}` }), "the create raised an attachment-lead job");
    const started = Date.now();
    await drainOutreachEnsureJobs(50, { deadline: Date.now() + 30_000 });
    const r = await record(form);
    assert.equal(r.state, "open"); assert.equal(String(r.lead_progress?.source_change_id), lagged, "the job carried the exact change id");
    const publishedAt = Date.now(); const page = await publish();
    assert.equal(rowFor(page, form)?.derived.attention_band, 5);
    console.log(JSON.stringify({ h7: { change_to_record_saved_ms: publishedAt - started, change_to_attention_visible_ms: Date.now() - started } }));
  });

  await t.test("§14.1: time sorts order the whole snapshot globally, nulls last both ways, and a cursor from another sort is rejected", async () => {
    const page = await readAttention({ limit: 200, sort: "last_lead_progress" });
    const keys = page.data.items.map(r => r.sort_keys?.last_lead_progress ?? null);
    const values = keys.filter((k): k is string => k !== null), nulls = keys.length - values.length;
    assert.deepEqual(values, [...values].sort().reverse(), "newest first"); assert.ok(keys.slice(keys.length - nulls).every(k => k === null), "nulls last");
    assert.equal(page.data.sort, "last_lead_progress"); assert.equal(page.data.direction, "desc");
    const asc = await readAttention({ limit: 200, sort: "last_lead_progress", direction: "asc" });
    const ascValues = asc.data.items.map(r => r.sort_keys?.last_lead_progress).filter((k): k is string => Boolean(k));
    assert.deepEqual(ascValues, [...ascValues].sort()); assert.equal(asc.data.items.at(-1)?.sort_keys?.last_lead_progress ?? null, nulls ? null : ascValues.at(-1));
    const first = await readAttention({ limit: 1, sort: "lead_received" });
    assert.ok(first.data.cursor);
    await assert.rejects(readAttention({ limit: 1, sort: "last_human_contact", cursor: first.data.cursor! }), { code: "INVALID_INPUT" });
    await assert.rejects(readAttention({ limit: 1, sort: "lead_received", direction: "asc", cursor: first.data.cursor! }), { code: "INVALID_INPUT" });
    const second = await readAttention({ limit: 1, sort: "lead_received", cursor: first.data.cursor! });
    assert.notEqual(second.data.items[0]?.subject_key, first.data.items[0]?.subject_key);
    const attention = await readAttention({ limit: 200 });
    assert.deepEqual(attention.data.items.map(r => r.derived.attention_band), [...attention.data.items.map(r => r.derived.attention_band)].sort((a, b) => (a ?? 8) - (b ?? 8)), "Attention order is unchanged");
  });

  await db.dropDatabase();
  await mongoose.disconnect();
});
