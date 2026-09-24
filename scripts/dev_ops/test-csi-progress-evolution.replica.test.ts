/**
 * Team 4 AC5-PROGRESS replica proofs (Attention evolution spec §7.1, §7.3), with
 * SALES_INTELLIGENCE_ATTENTION_EVOLUTION and LEAD_PROGRESS on. Run by `pnpm test:csi:lead-progress:replica`
 * after the LP-01 suite, in its own database `testvantagemovers_t4b<hex>`.
 *
 * K25 (one default per disposition revision; not for uncertain provenance or rep discretion; band 4
 * when due), K26 (superseded by an LLM callback, an assessment engagement step and an Owner
 * follow-up), K28 (accepted progress resets going cold), K29 (no model job from any automatic step).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import express, { type Request } from "express";
import mongoose from "mongoose";
process.env.SALES_INTELLIGENCE_ATTENTION_EVOLUTION = "true";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getEntityChangeModel } from "../../src/models/EntityChange";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { getRepIdentityLinkModel } from "../../src/models/RepIdentityLink";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getIntelligenceRunModel } from "../../src/models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../../src/models/IntelligenceFinding";
import { requireCsiOwner } from "../../src/services/salesIntelligence/auth";
import { computeAdminActorSignature } from "../../src/services/operationsRegistry/trustedActor";
import { persistLeadAttachments } from "../../src/services/salesIntelligence/attachment/store";
import { ensureLead, workerContext, progressDefaultKey } from "../../src/services/salesIntelligence/outreach/ensure";
import { applyOutreachEffect, outreachEffectInputSchema } from "../../src/services/salesIntelligence/outreach/effects";
import { applyAssessmentEngagement } from "../../src/services/salesIntelligence/assessment/engagement";
import { commandOutreach } from "../../src/services/salesIntelligence/followups/commands";
import { deriveOutreachFacts, loadOutreachInputs, readOutreach } from "../../src/services/salesIntelligence/outreach/reads";
import { resolvePolicy } from "../../src/services/salesIntelligence/policy";
import { readCaptureCoverage } from "../../src/services/numberActivity/coverage";
import { addStaffedMinutes } from "../../src/services/salesIntelligence/outreach/staffing";
import { dispositionRevision } from "../../src/services/salesIntelligence/outreach/leadProgress";
import type { CsiCommand } from "../../src/validation/v1/salesIntelligence";

const ET = (local: string) => new Date(`${local}:00${local >= "2026-11-01T02:00" ? "-05:00" : "-04:00"}`);
const MON_09 = ET("2026-09-21T09:00");

test("Team 4 AC5-PROGRESS default next step replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300000 }, async t => {
  assert.match(getMongoDatabaseName(), /^testvantagemovers_t4b[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  assert.equal(process.env.SALES_INTELLIGENCE_LEAD_PROGRESS, "true");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await applyCsiMigration();
  const oid = () => new mongoose.Types.ObjectId();
  const request: Request = Object.assign(Object.create(express.request), { method: "POST", originalUrl: "/api/v1/admin/sales-intelligence/outreach/commands", headers: {},
    vantageAuth: { kind: "user", userId: "synthetic-owner", email: "owner@example.test", roles: ["owner"] } });
  const fields = { adminId: "synthetic-owner", email: "owner@example.test", role: "owner", timestamp: String(Date.now()), requestId: "t4b-proof", method: request.method, path: request.originalUrl };
  request.headers = { "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role, "x-vantage-admin-timestamp": fields.timestamp,
    "x-vantage-admin-request-id": fields.requestId, "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!) };
  const actor = requireCsiOwner(request), Records = getOutreachRecordModel(), Actions = getOutreachFollowupModel(), Jobs = getSalesIntelligenceJobModel();
  const jordan = oid();
  await getRepIdentityLinkModel().create({ agent_id: jordan, agent_name_snapshot: "Jordan", rc_account_id: "synthetic", rc_extension_id: "101", role_kind: "sales_rep", status: "reviewed", effective_from: ET("2026-01-01T09:00") });
  let serial = 0, revision = 0;
  async function fixture(options: { agent?: boolean } = {}) {
    const n = await getContactNumberModel().create({ e164: `+120255504${String(++serial).padStart(2, "0")}`, digits_reversed: `t4b${serial}`, first_observed_at: MON_09, last_activity_at: MON_09 });
    const lead = { _id: oid(), timestamp: MON_09, createdAt: MON_09, updatedAt: MON_09, name: `Synthetic T4B ${serial}`, normalized_phone_number: n.e164,
      ingested_contact_snapshot: { normalized_phone_number: n.e164, captured_at: MON_09 }, quoted: false, domain_revision: 0 };
    await getFormLeadModel().collection.insertOne(lead);
    await withTransaction(async session => {
      await ensureLead({ model: "FormLead", id: String(lead._id) }, workerContext(session, String(oid()), MON_09), String(n._id));
      await persistLeadAttachments(lead, "FormLead", session, String(oid()), MON_09);
    });
    const record = await Records.findOne({ "subject.id": lead._id }).orFail();
    // An assigned record, so band 6 (missing responsibility) never masks the band under test.
    if (options.agent !== false) await Records.collection.updateOne({ _id: record._id }, { $set: { responsible_agent_id: jordan, assignment: { origin: "first_conversation", assigned_at: MON_09 } } });
    return { n, lead, record, ref: { model: "FormLead" as const, id: String(lead._id), _id: lead._id } };
  }
  /** An accepted Granot write: the canonical Lead value plus the EntityChange the lifecycle command appends. */
  async function accept(ref: { id: string; _id: mongoose.Types.ObjectId }, patch: { granot_priority?: string | null; quoted?: boolean }, appliedAt: Date, skipChange = false) {
    const before = await getFormLeadModel().collection.findOne({ _id: ref._id });
    await getFormLeadModel().collection.updateOne({ _id: ref._id }, { $set: { ...patch, domain_revision: ++revision } });
    if (skipChange) return null;
    const change = await getEntityChangeModel().collection.insertOne({ entity: { model: "FormLead", id: ref.id }, command_execution_id: oid(), command_name: "synchronizeLeadFromGranot",
      provenance: { source_system: "granot", actor: { actor_type: "system", actor_id: "test" }, initiator: { actor_type: "system", actor_id: "test" }, request_id: String(oid()), observation_id: oid(), decision_id: oid() },
      changed_paths: Object.keys(patch).sort(), fields: Object.entries(patch).map(([path, after]) => ({ path, value_mode: "stored", before: before?.[path] ?? null, after })),
      revision_before: revision - 1, revision_after: revision, applied_at: appliedAt } as never);
    return String(change.insertedId);
  }
  const ensure = (ref: { id: string }, changeId: string | null = null) => withTransaction(s => ensureLead({ model: "FormLead", id: ref.id }, workerContext(s, String(oid())), undefined, { changeId }));
  const coverage = await readCaptureCoverage(), policy = await resolvePolicy();
  async function deriveAt(recordId: unknown, now: Date) {
    const record = await Records.findById(recordId).lean().orFail();
    return deriveOutreachFacts(record, await loadOutreachInputs(record, now), { now, policy, coverage });
  }
  const defaults = (recordId: unknown) => Actions.find({ outreach_record_id: recordId, default_kind: "quote_followup" }).lean();
  const automaticJobs = async () => ({ number_refresh: await Jobs.countDocuments({ stage: "number_refresh", dedupe_key: { $not: /^csi:owner-outreach:/ } }),
    move_assessment: await Jobs.countDocuments({ stage: "move_assessment" }), analysis: await Jobs.countDocuments({ stage: { $in: ["analysis", "application"] } }) });
  const zeroModel = await automaticJobs();
  const QUOTED_AT = ET("2026-09-23T11:00");

  await t.test("K25 accepted 0 → 1 opens the record with one default (+1440 staffed min, day precision); no band until due, then band 4; re-delivery creates nothing", async () => {
    const f = await fixture();
    const change = await accept(f.ref, { granot_priority: "1" }, QUOTED_AT);
    await ensure(f.ref, change);
    const record = await Records.findById(f.record._id).lean().orFail();
    assert.equal(record.state, "open"); assert.equal(record.lead_progress?.disposition, "quoted"); assert.equal(record.lead_progress?.provenance, "accepted");
    const rows = await defaults(f.record._id);
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.kind, "call"); assert.equal(row.origin, "system_default"); assert.equal(row.description, "Follow up on the quote"); assert.equal(row.status, "open");
    assert.equal(row.date_resolution?.precision, "day"); assert.equal(String(row.responsible_agent_id), String(jordan));
    assert.equal(row.commitment_key, progressDefaultKey(f.record._id, dispositionRevision("1")));
    assert.equal(+row.due_at!, +addStaffedMinutes(QUOTED_AT, 1440, policy)); assert.equal(+row.due_at!, +ET("2026-09-25T11:00"), "1440 staffed minutes = two 12-hour staffed days");
    assert.equal(String(record.next_action?.followup_id), String(row._id));
    assert.equal((await deriveAt(f.record._id, ET("2026-09-25T10:59"))).attention_band, null, "no band until due");
    const due = await deriveAt(f.record._id, ET("2026-09-25T11:00"));
    assert.equal(due.attention_band, 4); assert.ok(due.reasons.includes("followups_due")); assert.ok(!due.reasons.includes("promised_callback_overdue"));
    await ensure(f.ref, change); await ensure(f.ref, null);
    assert.equal((await defaults(f.record._id)).length, 1, "re-delivery creates nothing");
    const dto = (await readOutreach(String(f.record._id)))!.data.outreach.followups.find(a => a.id === String(row._id))!;
    assert.equal(dto.default_kind, "quote_followup");
  });

  await t.test("K25 1 → 3 → 1 in the same revision creates nothing new; rep_discretion is a band 5 reason; uncertain provenance creates nothing", async () => {
    const f = await fixture();
    await ensure(f.ref, await accept(f.ref, { granot_priority: "1" }, QUOTED_AT));
    const [first] = await defaults(f.record._id);
    // The default was done (e.g. a call); nothing open remains.
    await Actions.collection.updateOne({ _id: first!._id }, { $set: { status: "completed", disposition: "completed", completed_at: ET("2026-09-23T12:00") } });
    await ensure(f.ref, await accept(f.ref, { granot_priority: "3" }, ET("2026-09-23T13:00")));
    const discretion = await deriveAt(f.record._id, ET("2026-09-23T14:00"));
    assert.equal(discretion.attention_band, 5); assert.ok(discretion.reasons.includes("rep_discretion"));
    assert.equal((await defaults(f.record._id)).length, 1, "rep_discretion creates no action");
    await ensure(f.ref, await accept(f.ref, { granot_priority: "1" }, ET("2026-09-23T15:00")));
    assert.equal((await defaults(f.record._id)).length, 1, "the same disposition revision (Priority 1) never creates a second default");
    const uncertain = await fixture();
    await accept(uncertain.ref, { granot_priority: "1" }, QUOTED_AT, true);
    await ensure(uncertain.ref, null);
    const u = await Records.findById(uncertain.record._id).lean().orFail();
    assert.equal(u.lead_progress?.provenance, "uncertain"); assert.equal(u.state, "unworked");
    assert.equal((await defaults(uncertain.record._id)).length, 0);
    // An already open record whose disposition changes to Quoted gets the default too; one with an open action does not.
    const open = await fixture();
    await Records.collection.updateOne({ _id: open.record._id }, { $set: { state: "open" } });
    await ensure(open.ref, await accept(open.ref, { granot_priority: "1" }, QUOTED_AT));
    assert.equal((await defaults(open.record._id)).length, 1);
    const busy = await fixture();
    await Actions.create({ outreach_record_id: busy.record._id, commitment_key: `t4b:${oid()}`, kind: "send_estimate", description: "Send estimate", origin: "rep_promise", responsible_agent_id: jordan,
      date_resolution: { precision: "unresolved", timezone: "America/New_York", anchor: MON_09, policy_version: "csi-policy-v1" } });
    await ensure(busy.ref, await accept(busy.ref, { granot_priority: "1" }, QUOTED_AT));
    assert.equal((await defaults(busy.record._id)).length, 0, "an open action of any kind: no default");
  });

  await t.test("K26 the default is superseded by an LLM callback, an assessment engagement step and an Owner follow-up", async () => {
    // LLM: a conversation run's create_followup effect.
    const llm = await fixture();
    await ensure(llm.ref, await accept(llm.ref, { granot_priority: "1" }, QUOTED_AT));
    const source = await getCallInteractionModel().create({ provider_account_id: "synthetic", telephony_session_id: String(oid()), identity_basis: "telephony_session_id", contact_number_id: llm.n._id,
      direction: "Outbound", started_at: ET("2026-09-23T16:00"), first_observed_at: ET("2026-09-23T16:00"), last_observed_at: ET("2026-09-23T16:00"), terminal: true, provider_connected: true,
      contact_type: "human_conversation", parties: [{ role: "user", extension_id: "101", direction: "Outbound", connected: true }] });
    const run_id = oid(), finding_id = oid(), current = await Records.findById(llm.record._id).orFail();
    await getIntelligenceRunModel().collection.insertOne({ _id: run_id, subject_key: `lead:FormLead:${llm.lead._id}`, contact_number_id: llm.n._id, job_id: oid() } as never);
    await getIntelligenceFindingModel().collection.insertOne({ _id: finding_id, run_id, key: "promise" } as never);
    const applied = await withTransaction(s => applyOutreachEffect(outreachEffectInputSchema.parse({ run_id: String(run_id), finding_id: String(finding_id), finding_key: "promise",
      outreach_record_id: String(current._id), interaction_id: String(source._id), expected_revision: current.revision, kind: "create_followup", action_kind: "call",
      description: "Call Friday at 10", origin: "rep_promise", promising_agent_id: String(jordan), clear: true, history_complete: true, date: { exact: ET("2026-09-25T10:00").toISOString() } }),
    workerContext(s, String(oid()))));
    assert.equal(applied.status, "applied");
    let [d] = await defaults(llm.record._id);
    assert.equal(d!.status, "superseded"); assert.equal(d!.cancel_reason, "superseded_by_specific_plan");
    const dto = (await readOutreach(String(llm.record._id)))!.data.outreach.followups.find(a => a.id === String(d!._id))!;
    assert.equal(dto.cancel_reason, "superseded_by_specific_plan"); assert.equal(dto.status, "superseded");
    // Assessment: an accepted artifact's planned rep step.
    const assessed = await fixture();
    await ensure(assessed.ref, await accept(assessed.ref, { granot_priority: "1" }, QUOTED_AT));
    const latest = "2026-09-23T20:00:00.000Z";
    const evidence = [{ id: "e1", kind: "said_on_call", speaker: "rep", call_at: latest, lineage: [],
      locator: { source: "summary_artifact", snapshot_id: "s1", content_digest: "d1", conversation_id: "c1", transcript_version: "v1", section: "said_on_call.0" } }];
    const result = await withTransaction(s => applyAssessmentEngagement({ _id: oid(), job_id: oid(), latest_conversation_at: new Date(latest), contact_number_id: assessed.n._id,
      engagement: { work_status: "worked_with_next_step", rationale: "Rep spoke with the customer.", evidence_ids: ["e1"], evidence, promised_callbacks: [],
        next_steps: [{ action: "send_estimate", owner: "rep", description: "Send the written estimate", date: null, date_text: "tomorrow", status: "planned", evidence_ids: ["e1"], evidence }] } },
    String(assessed.record._id), s, ET("2026-09-23T20:05")));
    assert.equal(result.followup_ids.length, 1);
    [d] = await defaults(assessed.record._id);
    assert.equal(d!.status, "superseded"); assert.equal(d!.cancel_reason, "superseded_by_specific_plan");
    // Owner: a create_followup command.
    const owned = await fixture();
    await ensure(owned.ref, await accept(owned.ref, { granot_priority: "1" }, QUOTED_AT));
    const r = await Records.findById(owned.record._id).orFail();
    await commandOutreach({ actor, target_id: String(r._id), idempotency_key: String(oid()), command: { command: "create_followup", expected_revision: r.revision, outreach_record_id: String(r._id),
      action: { kind: "send_estimate", description: "Email the estimate", due_at: null } } as CsiCommand });
    [d] = await defaults(owned.record._id);
    assert.equal(d!.status, "superseded"); assert.equal(d!.cancel_reason, "superseded_by_specific_plan");
    const owner = await Records.findById(owned.record._id).lean().orFail();
    assert.ok(owner.last_activity_at && +owner.last_activity_at > +QUOTED_AT, "an Owner command is activity");
  });

  await t.test("K28 accepted progress resets going cold (last_activity_at = the accepted progress time)", async () => {
    const f = await fixture();
    await Records.collection.updateOne({ _id: f.record._id }, { $set: { state: "open", last_meaningful_contact_at: ET("2026-09-15T10:00"), last_activity_at: ET("2026-09-15T10:00") } });
    assert.ok((await deriveAt(f.record._id, ET("2026-09-23T12:00"))).reasons.includes("going_cold"));
    // Priority 3 (rep discretion): accepted progress without a default action.
    await ensure(f.ref, await accept(f.ref, { granot_priority: "3" }, ET("2026-09-23T11:00")));
    const r = await Records.findById(f.record._id).lean().orFail();
    assert.equal(+r.last_activity_at!, +ET("2026-09-23T11:00"));
    const after = await deriveAt(f.record._id, ET("2026-09-23T12:00"));
    assert.ok(!after.reasons.includes("going_cold")); assert.equal(after.attention_band, 5); assert.ok(after.reasons.includes("rep_discretion"));
  });

  await t.test("K29 zero model calls: the automatic steps enqueued no number_refresh, analysis or move_assessment job", async () => {
    assert.deepEqual(await automaticJobs(), zeroModel);
  });
});
