/**
 * Team 4 AC3/AC4/AC5-ACTIVITY replica proofs (Attention evolution spec §5–§7), with
 * SALES_INTELLIGENCE_ATTENTION_EVOLUTION on. Run by `pnpm test:csi:outreach:replica` after the CSI-06
 * suite, in its own database `testvantagemovers_t4a<hex>`. Real projections, real jobs
 * (`runOutreachEnsureJob`), fixed call times (ET, Mon–Sat 08:00–20:00 staffed).
 *
 * K14 (publish order), K15, K16, K19–K24 (the retry chain through `runOutreachEnsureJob`), K23,
 * K27, K28 (attempt reset, `unreached`), K29 (no `number_refresh` / `move_assessment` job from any
 * automatic step), idempotency: re-delivery, projection replay and out-of-order calls.
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
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { getRepIdentityLinkModel } from "../../src/models/RepIdentityLink";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceReviewItemModel } from "../../src/models/SalesIntelligenceReviewItem";
import { getIntelligenceRunModel } from "../../src/models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../../src/models/IntelligenceFinding";
import { requireCsiOwner } from "../../src/services/salesIntelligence/auth";
import { computeAdminActorSignature } from "../../src/services/operationsRegistry/trustedActor";
import { persistLeadAttachments } from "../../src/services/salesIntelligence/attachment/store";
import { ensureLead, ensureInteraction, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { runOutreachEnsureJob, outreachRepairNomination } from "../../src/services/salesIntelligence/outreach/worker";
import { applyOutreachEffect, outreachEffectInputSchema } from "../../src/services/salesIntelligence/outreach/effects";
import { commandOutreach } from "../../src/services/salesIntelligence/followups/commands";
import { enqueueCsiJob } from "../../src/services/salesIntelligence/jobs";
import { deriveOutreachFacts, loadOutreachInputs, readOutreach } from "../../src/services/salesIntelligence/outreach/reads";
import { publishAttentionSnapshot, readAttention } from "../../src/services/salesIntelligence/outreach/attention";
import { resolvePolicy } from "../../src/services/salesIntelligence/policy";
import { readCaptureCoverage } from "../../src/services/numberActivity/coverage";
import { addStaffedMinutes } from "../../src/services/salesIntelligence/outreach/staffing";
import type { CsiCommand } from "../../src/validation/v1/salesIntelligence";

const ET = (local: string) => new Date(`${local}:00${local >= "2026-11-01T02:00" ? "-05:00" : "-04:00"}`);
const MON_09 = ET("2026-09-21T09:00"), TUE_10 = ET("2026-09-22T10:00"), WED_15 = ET("2026-09-23T15:00");

test("Team 4 AC3/AC4/AC5 attention evolution replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300000 }, async t => {
  assert.match(getMongoDatabaseName(), /^testvantagemovers_t4a[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await applyCsiMigration();
  const oid = () => new mongoose.Types.ObjectId();
  const request: Request = Object.assign(Object.create(express.request), { method: "POST", originalUrl: "/api/v1/admin/sales-intelligence/outreach/commands", headers: {},
    vantageAuth: { kind: "user", userId: "synthetic-owner", email: "owner@example.test", roles: ["owner"] } });
  const fields = { adminId: "synthetic-owner", email: "owner@example.test", role: "owner", timestamp: String(Date.now()), requestId: "t4a-proof", method: request.method, path: request.originalUrl };
  request.headers = { "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role, "x-vantage-admin-timestamp": fields.timestamp,
    "x-vantage-admin-request-id": fields.requestId, "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!) };
  const actor = requireCsiOwner(request), Records = getOutreachRecordModel(), Actions = getOutreachFollowupModel(), Jobs = getSalesIntelligenceJobModel();
  const jordan = oid(), casey = oid();
  for (const [agent, ext, name] of [[jordan, "101", "Jordan"], [casey, "102", "Casey"]] as const)
    await getRepIdentityLinkModel().create({ agent_id: agent, agent_name_snapshot: name, rc_account_id: "synthetic", rc_extension_id: ext, role_kind: "sales_rep", status: "reviewed", effective_from: ET("2026-01-01T09:00") });
  let serial = 0;
  async function fixture(options: { timestamp?: Date; before?: (numberId: mongoose.Types.ObjectId) => Promise<unknown> } = {}) {
    const timestamp = options.timestamp ?? MON_09;
    const n = await getContactNumberModel().create({ e164: `+120255503${String(++serial).padStart(2, "0")}`, digits_reversed: `t4a${serial}`, first_observed_at: timestamp, last_activity_at: timestamp });
    await options.before?.(n._id);
    const lead = { _id: oid(), timestamp, createdAt: timestamp, updatedAt: timestamp, name: `Synthetic T4A ${serial}`, normalized_phone_number: n.e164,
      ingested_contact_snapshot: { normalized_phone_number: n.e164, captured_at: timestamp }, receiver_agent: oid() };
    await getFormLeadModel().collection.insertOne(lead);
    await withTransaction(async session => {
      await ensureLead({ model: "FormLead", id: String(lead._id) }, workerContext(session, String(oid()), timestamp), String(n._id));
      await persistLeadAttachments(lead, "FormLead", session, String(oid()), timestamp);
    });
    const record = await Records.findOne({ "subject.id": lead._id }).orFail();
    return { n, lead, record };
  }
  const repLeg = (ext: string, direction: "Inbound" | "Outbound") => [{ role: "user", extension_id: ext, direction, connected: true }];
  const call = (number: mongoose.Types.ObjectId, started_at: Date, kind: "attempt" | "outbound_human" | "inbound_human" | "voicemail" | "connected_unknown", ext = "101") =>
    getCallInteractionModel().create({ provider_account_id: "synthetic", telephony_session_id: String(oid()), identity_basis: "telephony_session_id", contact_number_id: number,
      direction: kind === "inbound_human" ? "Inbound" : "Outbound", started_at, ended_at: new Date(+started_at + 120_000), first_observed_at: started_at, last_observed_at: started_at, terminal: true,
      // "connected_unknown" is what capture really writes for a connected call (V-AC B1): only analysis or the Owner sets human_conversation.
      provider_connected: kind !== "attempt", contact_type: kind === "attempt" || kind === "connected_unknown" ? "unknown" : kind === "voicemail" ? "voicemail" : "human_conversation",
      parties: repLeg(ext, kind === "inbound_human" ? "Inbound" : "Outbound"), ...(kind === "inbound_human" ? { inbound_route_id: oid() } : {}) });
  /** The production path: one `outreach_ensure` job per call, run through `runOutreachEnsureJob`. */
  async function viaJob(c: { _id: unknown; contact_number_id?: unknown }, tag = "1") {
    const job = await withTransaction(s => enqueueCsiJob({ stage: "outreach_ensure", subject_key: `number:${c.contact_number_id}`, dedupe_key: `csi:t4a:interaction:${c._id}:${tag}`,
      input_revision: 1, input_refs: [String(c._id)] }, s));
    assert.equal((await runOutreachEnsureJob(String(job._id))).status, "completed");
  }
  const promise = (recordId: unknown, over: Record<string, unknown> = {}) => Actions.create({ outreach_record_id: recordId, commitment_key: `t4a:${oid()}`, kind: "call", description: "Call back Wednesday 3 PM",
    origin: "rep_promise", requested_by: "rep", due_at: WED_15, base_attention_due_at: WED_15, responsible_agent_id: jordan, promised_by_agent_id: jordan,
    date_resolution: { precision: "exact", timezone: "America/New_York", anchor: TUE_10, policy_version: "csi-policy-v1" }, ...over });
  const coverage = await readCaptureCoverage(), policy = await resolvePolicy();
  async function deriveAt(recordId: unknown, now: Date) {
    const record = await Records.findById(recordId).lean().orFail();
    return deriveOutreachFacts(record, await loadOutreachInputs(record, now), { now, policy, coverage });
  }
  const chainOf = (recordId: unknown) => Actions.find({ outreach_record_id: recordId }).sort({ _id: 1 }).lean();
  const jobCounts = async () => ({ number_refresh: await Jobs.countDocuments({ stage: "number_refresh" }), move_assessment: await Jobs.countDocuments({ stage: "move_assessment" }) });
  const command = (target: unknown, body: CsiCommand) => commandOutreach({ actor, target_id: String(target), command: body, idempotency_key: String(oid()) });
  const zeroModel = await jobCounts();
  try {

  await t.test("K22/K24 retry chain through runOutreachEnsureJob: no_answer → retry 1 → retry 2 → promise_unreached; re-delivery, replay and out-of-order add nothing", async () => {
    const f = await fixture();
    const root = await promise(f.record._id);
    const c1 = await call(f.n._id, ET("2026-09-23T15:05"), "attempt");
    await viaJob(c1);
    let chain = await chainOf(f.record._id);
    assert.equal(chain.length, 2);
    assert.equal(chain[0]!.status, "completed"); assert.equal(chain[0]!.disposition, "no_answer");
    const r1 = chain[1]!;
    assert.equal(r1.origin, "system_default"); assert.equal(r1.kind, "call"); assert.equal(r1.description, "Try again: promised callback not reached");
    assert.equal(r1.commitment_key, `retry:${root._id}:1`); assert.deepEqual({ ...r1.promise_chain, root_id: String(r1.promise_chain!.root_id) }, { root_id: String(root._id), root_origin: "rep_promise", attempt: 1 });
    assert.equal(String(r1.supersedes_id), String(root._id)); assert.equal(String(r1.responsible_agent_id), String(jordan));
    assert.equal(+r1.due_at!, +addStaffedMinutes(c1.started_at, 120, policy)); assert.equal(r1.date_resolution?.precision, "exact");
    const band1 = await deriveAt(f.record._id, ET("2026-09-23T17:30"));
    assert.equal(band1.attention_band, 1); assert.ok(band1.reasons.includes("promised_by:rep"));
    // Re-delivery of the same call (a second job): the applied-call audit fence makes it a no-op.
    await viaJob(c1, "redelivery");
    assert.equal((await chainOf(f.record._id)).length, 2);
    // Projection replay of the same call (revision bump): the retry is anchored at that call, so it cannot complete it.
    await getCallInteractionModel().updateOne({ _id: c1._id }, { $inc: { projection_revision: 1 } });
    await viaJob(c1, "replay");
    chain = await chainOf(f.record._id);
    assert.equal(chain.length, 2); assert.equal(chain[1]!.status, "open");
    // Out of order: an older attempt (before the promise was due, after it was made) arriving late completes nothing new.
    const early = await call(f.n._id, ET("2026-09-22T11:00"), "attempt");
    await viaJob(early);
    assert.equal((await chainOf(f.record._id)).length, 2);
    const c2 = await call(f.n._id, ET("2026-09-23T17:10"), "voicemail");
    await viaJob(c2);
    chain = await chainOf(f.record._id);
    assert.equal(chain.length, 3); assert.equal(chain[1]!.status, "completed"); assert.equal(chain[1]!.disposition, "left_voicemail");
    assert.equal(chain[2]!.commitment_key, `retry:${root._id}:2`); assert.equal(chain[2]!.promise_chain?.attempt, 2); assert.equal(String(chain[2]!.supersedes_id), String(chain[1]!._id));
    const c3 = await call(f.n._id, ET("2026-09-23T19:15"), "attempt");
    await viaJob(c3);
    chain = await chainOf(f.record._id);
    assert.equal(chain.length, 3, "no retry after callback_max_retries"); assert.equal(chain[2]!.status, "completed");
    const unreached = await deriveAt(f.record._id, ET("2026-09-24T10:00"));
    assert.equal(unreached.attention_band, 4); assert.ok(unreached.reasons.includes("promise_unreached"));
    await viaJob(c3, "redelivery");
    assert.equal((await chainOf(f.record._id)).length, 3);
    // The detail DTO carries the chain fields additively.
    const detail = await readOutreach(String(f.record._id));
    const dto = detail!.data.outreach.followups.find(a => a.id === String(chain[2]!._id))!;
    assert.deepEqual(dto.promise_chain, { root_id: String(root._id), root_origin: "rep_promise", attempt: 2 });
    assert.equal(dto.supersedes_id, String(chain[1]!._id));
    assert.equal(typeof detail!.data.outreach.last_activity_at, "string");
    assert.equal(detail!.data.outreach.last_attributable_outbound_at, ET("2026-09-23T19:15").toISOString());
  });

  await t.test("K22 spoke_with_customer ends the chain; K21 an inbound conversation completes a promise as customer_called; K19 50 min early completes, 70 min does not", async () => {
    const spoke = await fixture();
    const root = await promise(spoke.record._id);
    await viaJob(await call(spoke.n._id, ET("2026-09-23T15:05"), "attempt"));
    await viaJob(await call(spoke.n._id, ET("2026-09-23T17:00"), "outbound_human"));
    const chain = await chainOf(spoke.record._id);
    assert.equal(chain.length, 2); assert.equal(chain[1]!.status, "completed"); assert.equal(chain[1]!.disposition, "spoke_with_customer");
    assert.equal(String(chain[1]!.promise_chain?.root_id), String(root._id));
    const inbound = await fixture();
    await promise(inbound.record._id);
    await viaJob(await call(inbound.n._id, ET("2026-09-22T16:00"), "inbound_human"));
    const called = await chainOf(inbound.record._id);
    assert.equal(called.length, 1); assert.equal(called[0]!.status, "completed"); assert.equal(called[0]!.disposition, "customer_called");
    const early50 = await fixture();
    await promise(early50.record._id, { origin: "customer_request", requested_by: "customer", promised_by_agent_id: null });
    await viaJob(await call(early50.n._id, ET("2026-09-23T13:50"), "attempt"));
    assert.equal((await chainOf(early50.record._id))[0]!.status, "open", "70 staffed min early");
    await viaJob(await call(early50.n._id, ET("2026-09-23T14:10"), "attempt"));
    const done = await chainOf(early50.record._id);
    assert.equal(done[0]!.status, "completed", "50 staffed min early"); assert.equal(done[1]!.promise_chain?.root_origin, "customer_request");
  });

  await t.test("K23 an Owner re-date of the root keeps the chain; a new LLM callback supersedes the open retry", async () => {
    const f = await fixture();
    const root = await promise(f.record._id);
    const redate = await command(root._id, { command: "patch_followup", expected_revision: root.revision, changes: { due_at: ET("2026-09-23T17:00").toISOString() }, reason: "Customer asked for later" } as CsiCommand);
    assert.ok(redate);
    await viaJob(await call(f.n._id, ET("2026-09-23T16:30"), "attempt"));
    let chain = await chainOf(f.record._id);
    assert.equal(chain.length, 2); assert.equal(chain[0]!.status, "completed"); assert.equal(chain[1]!.commitment_key, `retry:${root._id}:1`);
    // The LLM callback: a conversation run's create_followup effect on the latest call.
    // The source call of the new promise; not replayed through ensure here, so the open retry stays open until the effect.
    const source = await call(f.n._id, ET("2026-09-23T18:00"), "outbound_human");
    const run_id = oid(), finding_id = oid(), current = await Records.findById(f.record._id).orFail();
    await getIntelligenceRunModel().collection.insertOne({ _id: run_id, subject_key: `lead:FormLead:${f.lead._id}`, contact_number_id: f.n._id, job_id: oid() } as never);
    await getIntelligenceFindingModel().collection.insertOne({ _id: finding_id, run_id, key: "promise" } as never);
    const before = await jobCounts();
    const applied = await withTransaction(s => applyOutreachEffect(outreachEffectInputSchema.parse({ run_id: String(run_id), finding_id: String(finding_id), finding_key: "promise",
      outreach_record_id: String(current._id), interaction_id: String(source._id), expected_revision: current.revision, kind: "create_followup", action_kind: "call",
      description: "Call Friday at 10", origin: "rep_promise", promising_agent_id: String(jordan), clear: true, history_complete: true, date: { exact: ET("2026-09-25T10:00").toISOString() } }),
    workerContext(s, String(oid()))));
    assert.equal(applied.status, "applied");
    chain = await chainOf(f.record._id);
    const retry = chain.find(a => a.commitment_key === `retry:${root._id}:1`)!;
    assert.equal(retry.status, "superseded"); assert.equal(retry.cancel_reason, "superseded_by_specific_plan");
    assert.equal(chain.filter(a => a.status === "open").length, 1);
    assert.deepEqual(await jobCounts(), before, "an LLM effect enqueues no model job");
  });

  await t.test("K27 first_attempts: one reviewed rep ×2 assigns; two reps never; a later conversation replaces it; the Owner is never replaced", async () => {
    const one = await fixture();
    await viaJob(await call(one.n._id, ET("2026-09-21T10:00"), "attempt"));
    assert.equal((await Records.findById(one.record._id).orFail()).responsible_agent_id, null, "one attempt is not enough");
    await viaJob(await call(one.n._id, ET("2026-09-21T14:00"), "attempt"));
    let r = await Records.findById(one.record._id).orFail();
    assert.equal(String(r.responsible_agent_id), String(jordan)); assert.equal(r.assignment?.origin, "first_attempts");
    // A conversation with another reviewed rep is stronger evidence (rank 40 > 10).
    await viaJob(await call(one.n._id, ET("2026-09-22T10:00"), "outbound_human", "102"));
    r = await Records.findById(one.record._id).orFail();
    assert.equal(String(r.responsible_agent_id), String(casey)); assert.equal(r.assignment?.origin, "first_conversation");
    const two = await fixture();
    await viaJob(await call(two.n._id, ET("2026-09-21T10:00"), "attempt", "101"));
    await viaJob(await call(two.n._id, ET("2026-09-21T14:00"), "attempt", "102"));
    await viaJob(await call(two.n._id, ET("2026-09-21T16:00"), "attempt", "101"));
    assert.equal((await Records.findById(two.record._id).orFail()).responsible_agent_id, null);
    const owned = await fixture();
    await command(owned.record._id, { command: "assign", expected_revision: (await Records.findById(owned.record._id).orFail()).revision, responsible_agent_id: String(casey), reason: "Owner" } as CsiCommand);
    await viaJob(await call(owned.n._id, ET("2026-09-21T10:00"), "attempt"));
    await viaJob(await call(owned.n._id, ET("2026-09-21T11:00"), "attempt"));
    await viaJob(await call(owned.n._id, ET("2026-09-21T12:00"), "outbound_human"));
    r = await Records.findById(owned.record._id).orFail();
    assert.equal(String(r.responsible_agent_id), String(casey)); assert.equal(r.assignment?.origin, "owner");
  });

  await t.test("K15 no_callback_after_inbound at 240 staffed min; K28 an attempt resets going cold and unreached fires at 2×", async () => {
    const inbound = await fixture();
    await viaJob(await call(inbound.n._id, ET("2026-09-23T10:00"), "inbound_human"));
    let r = await Records.findById(inbound.record._id).lean().orFail();
    assert.equal(+r.last_inbound_human_at!, +ET("2026-09-23T10:00")); assert.equal(r.state, "open");
    assert.ok(!(await deriveAt(inbound.record._id, ET("2026-09-23T13:59"))).reasons.includes("no_callback_after_inbound"));
    const due = await deriveAt(inbound.record._id, ET("2026-09-23T14:00"));
    assert.equal(due.attention_band, 4); assert.ok(due.reasons.includes("no_callback_after_inbound"));
    await viaJob(await call(inbound.n._id, ET("2026-09-23T14:30"), "attempt"));
    assert.ok(!(await deriveAt(inbound.record._id, ET("2026-09-23T15:00"))).reasons.includes("no_callback_after_inbound"), "an outbound attempt clears it");
    const cold = await fixture();
    await viaJob(await call(cold.n._id, ET("2026-09-21T10:00"), "outbound_human", "102"));
    assert.ok((await deriveAt(cold.record._id, ET("2026-09-24T12:00"))).reasons.includes("going_cold"));
    await viaJob(await call(cold.n._id, ET("2026-09-24T09:00"), "attempt", "102"));
    await viaJob(await call(cold.n._id, ET("2026-09-25T09:00"), "attempt", "102"));
    r = await Records.findById(cold.record._id).lean().orFail();
    assert.equal(+r.last_activity_at!, +ET("2026-09-25T09:00"));
    const reset = await deriveAt(cold.record._id, ET("2026-09-25T18:00"));
    assert.ok(!reset.reasons.includes("going_cold"), "the attempt resets going cold"); assert.ok(reset.reasons.includes("unreached"));
  });

  await t.test("K16 called_before_form: a rep call 6 days before the form sets prior_contact_at; 8 days does not; null path without a Number", async () => {
    const six = await fixture({ timestamp: ET("2026-09-28T12:00"), before: n => call(n, ET("2026-09-22T12:00"), "attempt") });
    assert.equal(+(await Records.findById(six.record._id).lean().orFail()).prior_contact_at!, +ET("2026-09-22T12:00"));
    assert.ok((await deriveAt(six.record._id, ET("2026-09-28T12:05"))).reasons.includes("called_before_form"));
    const eight = await fixture({ timestamp: ET("2026-09-30T12:00"), before: n => call(n, ET("2026-09-22T12:00"), "attempt") });
    assert.equal((await Records.findById(eight.record._id).lean().orFail()).prior_contact_at, null);
    // A Lead with no Number at creation: the facts are computed with nulls (never a missing field that re-queries).
    const bare = { _id: oid(), timestamp: MON_09, createdAt: MON_09, updatedAt: MON_09, name: "Synthetic T4A bare" };
    await getFormLeadModel().collection.insertOne(bare);
    await withTransaction(s => ensureLead({ model: "FormLead", id: String(bare._id) }, workerContext(s, String(oid()), MON_09)));
    const b = await Records.findOne({ "subject.id": bare._id }).lean().orFail();
    assert.deepEqual([b.last_inbound_human_at, b.last_attributable_outbound_at, b.prior_contact_at, b.last_activity_at], [null, null, null, null]);
  });

  await t.test("§5.4 repair backfill: a legacy record without the facts gets one distinct repair nomination, then today's key", async () => {
    const f = await fixture();
    await Records.collection.updateOne({ _id: f.record._id }, { $unset: { last_inbound_human_at: 1, last_attributable_outbound_at: 1, prior_contact_at: 1, last_activity_at: 1 } });
    const legacy = await Records.findById(f.record._id).lean().orFail();
    const nomination = outreachRepairNomination("OutreachRecord", legacy)!;
    assert.match(nomination.dedupe_key, /:contact-facts-v1$/);
    const job = await withTransaction(s => enqueueCsiJob(nomination, s));
    assert.equal((await runOutreachEnsureJob(String(job._id))).status, "completed");
    const repaired = await Records.findById(f.record._id).lean().orFail();
    assert.notEqual(repaired.last_activity_at, undefined); assert.equal(repaired.prior_contact_at, null);
    assert.doesNotMatch(outreachRepairNomination("OutreachRecord", repaired)!.dedupe_key, /contact-facts/);
  });

  await t.test("K14 publish: a new Form Lead is band 2 new_not_yet_due and sorts after an overdue no_call_yet", async () => {
    const now = Date.now();
    const fresh = await fixture({ timestamp: new Date(now - 40_000) });
    const old = await fixture({ timestamp: new Date(now - 3 * 86_400_000) });
    assert.equal((await publishAttentionSnapshot()).status, "published");
    const page = await readAttention({ limit: 200 });
    const keys = page.data.items.map(row => row.subject_key);
    const freshKey = `lead:FormLead:${fresh.lead._id}`, oldKey = `lead:FormLead:${old.lead._id}`;
    const freshRow = page.data.items.find(row => row.subject_key === freshKey)!, oldRow = page.data.items.find(row => row.subject_key === oldKey)!;
    assert.equal(freshRow.derived.attention_band, 2); assert.equal(freshRow.derived.reasons[0], "new_not_yet_due"); assert.equal(freshRow.sort_keys?.band2_due_rank, 1);
    assert.equal(oldRow.derived.attention_band, 2); assert.equal(oldRow.derived.reasons[0], "no_call_yet"); assert.equal(oldRow.sort_keys?.band2_due_rank, 0);
    assert.ok(keys.indexOf(oldKey) < keys.indexOf(freshKey), "no_call_yet before new_not_yet_due");
    const band2 = page.data.items.filter(row => row.derived.attention_band === 2).map(row => row.sort_keys?.band2_due_rank ?? 0);
    assert.deepEqual(band2, [...band2].sort((a, b) => a - b), "every band 2 row is ordered by its rank");
  });

  await t.test("V-AC B1 capture reality: a connected call first projects `unknown`; no retry until classified; classified human re-marks the callback reached", async () => {
    const f = await fixture();
    const root = await promise(f.record._id);
    const c1 = await call(f.n._id, ET("2026-09-23T15:05"), "connected_unknown");
    await viaJob(c1);
    let chain = await chainOf(f.record._id);
    assert.equal(chain.length, 1, "no retry for an unclassified connected call");
    assert.equal(chain[0]!.status, "completed"); assert.equal(chain[0]!.disposition, "connected_contact_unknown");
    assert.ok(!(await deriveAt(f.record._id, ET("2026-09-24T10:00"))).reasons.includes("promise_unreached"), "an unclassified call never reaches promise_unreached");
    // Transcription + analysis classify it a human conversation (what applyUnboundContactTypeEffect does: new projection revision, then ensure).
    await getCallInteractionModel().updateOne({ _id: c1._id }, { $set: { contact_type: "human_conversation", contact_type_basis: `finding:${oid()}` }, $inc: { projection_revision: 1 } });
    await viaJob(c1, "classified");
    chain = await chainOf(f.record._id);
    assert.equal(chain.length, 1); assert.equal(chain[0]!.disposition, "spoke_with_customer", "the kept promise is re-marked reached");
    const d = await deriveAt(f.record._id, ET("2026-09-23T18:00"));
    assert.ok(!d.reasons.includes("promised_callback_overdue") && !d.reasons.includes("promise_unreached"));
    // Re-delivery of the classified revision and a later unanswered attempt create nothing.
    await viaJob(c1, "classified-redelivery");
    await viaJob(await call(f.n._id, ET("2026-09-23T18:10"), "attempt"));
    chain = await chainOf(f.record._id);
    assert.equal(chain.length, 1); assert.equal(String(chain[0]!._id), String(root._id));
  });

  await t.test("V-AC B1 a connected call classified NOT human creates the retry then (once); a legacy retry is superseded when the call turns out human", async () => {
    const f = await fixture();
    const root = await promise(f.record._id);
    const c1 = await call(f.n._id, ET("2026-09-23T15:05"), "connected_unknown");
    await viaJob(c1);
    assert.equal((await chainOf(f.record._id)).length, 1);
    await getCallInteractionModel().updateOne({ _id: c1._id }, { $set: { contact_type_basis: `finding:${oid()}` }, $inc: { projection_revision: 1 } });
    await viaJob(c1, "classified-unknown");
    await viaJob(c1, "classified-unknown-redelivery");
    let chain = await chainOf(f.record._id);
    assert.equal(chain.length, 2); assert.equal(chain[1]!.commitment_key, `retry:${root._id}:1`); assert.equal(+chain[1]!.due_at!, +addStaffedMinutes(c1.started_at, 120, policy));
    // A retry that exists when the same call is later re-classified human (e.g. created before this fix) is superseded, and the root re-marked reached.
    await getCallInteractionModel().updateOne({ _id: c1._id }, { $set: { contact_type: "human_conversation", contact_type_basis: "owner" }, $inc: { projection_revision: 1 } });
    await viaJob(c1, "classified-human");
    chain = await chainOf(f.record._id);
    assert.equal(chain[0]!.disposition, "spoke_with_customer");
    assert.equal(chain[1]!.status, "superseded"); assert.equal(chain[1]!.cancel_reason, "reached_on_classification");
    assert.equal(chain.filter(a => a.status === "open").length, 0);
  });

  await t.test("T4-VAC-A4 R-S1 classification flips are symmetric: conversation → not re-opens the miss and its retry once; → conversation again restores it", async () => {
    const f = await fixture();
    const root = await promise(f.record._id);
    const c1 = await call(f.n._id, ET("2026-09-23T15:05"), "connected_unknown");
    await viaJob(c1);
    const classify = async (contact_type: "human_conversation" | "unknown", basis: string, tag: string) => {
      await getCallInteractionModel().updateOne({ _id: c1._id }, { $set: { contact_type, contact_type_basis: basis }, $inc: { projection_revision: 1 } });
      await viaJob(c1, tag);
    };
    const brief = async () => (await chainOf(f.record._id)).map(a => `${a.commitment_key.startsWith("retry:") ? a.commitment_key.split(":").slice(0, 1).concat(a.commitment_key.split(":").slice(2)).join(":") : "root"}/${a.status}/${a.disposition ?? a.cancel_reason ?? ""}`);
    await classify("human_conversation", `finding:${oid()}`, "human-1");
    assert.deepEqual(await brief(), ["root/completed/spoke_with_customer"]);
    await classify("unknown", "owner", "not-1");
    assert.deepEqual(await brief(), ["root/completed/connected_contact_unknown", "retry:1/open/"]);
    const d = await deriveAt(f.record._id, ET("2026-09-23T18:00"));
    assert.equal(d.attention_band, 1, "the promise was not reached after all: the retry is due");
    await viaJob(c1, "not-1-redelivery");
    assert.deepEqual(await brief(), ["root/completed/connected_contact_unknown", "retry:1/open/"], "re-delivery changes nothing");
    await classify("human_conversation", "owner", "human-2");
    assert.deepEqual(await brief(), ["root/completed/spoke_with_customer", "retry:1/superseded/reached_on_classification"]);
    await classify("unknown", "owner", "not-2");
    assert.deepEqual(await brief(), ["root/completed/connected_contact_unknown", "retry:1/open/"], "the same retry (same key) comes back, never a second one");
    assert.equal((await chainOf(f.record._id)).filter(a => a.commitment_key === `retry:${root._id}:1`).length, 1);
  });

  await t.test("T4-VAC-A4 R-N2 a late not-a-conversation classification applies the attempts already made after the call", async () => {
    const f = await fixture();
    const root = await promise(f.record._id);
    const c1 = await call(f.n._id, ET("2026-09-23T15:05"), "connected_unknown");
    await viaJob(c1);
    await viaJob(await call(f.n._id, ET("2026-09-23T17:30"), "attempt"));
    assert.equal((await chainOf(f.record._id)).length, 1, "the 17:30 attempt has nothing to complete yet");
    await getCallInteractionModel().updateOne({ _id: c1._id }, { $set: { contact_type_basis: `finding:${oid()}` }, $inc: { projection_revision: 1 } });
    await viaJob(c1, "classified-unknown");
    const chain = await chainOf(f.record._id);
    assert.deepEqual(chain.map(a => [a.commitment_key.replace(String(root._id), "root"), a.status, a.disposition]), [
      [chain[0]!.commitment_key.replace(String(root._id), "root"), "completed", "connected_contact_unknown"],
      ["retry:root:1", "completed", "no_answer"],
      ["retry:root:2", "open", null]]);
    assert.equal(+chain[1]!.completed_at!, +ET("2026-09-23T17:30"), "the attempt already made counts as retry 1");
    assert.equal(+chain[2]!.due_at!, +addStaffedMinutes(ET("2026-09-23T17:30"), 120, policy), "retry 2 is anchored at that attempt");
    const d = await deriveAt(f.record._id, ET("2026-09-23T18:00"));
    assert.ok(!d.reasons.includes("promised_callback_overdue"), "no stale overdue retry after the rep already tried again");
    await viaJob(c1, "classified-unknown-redelivery");
    assert.equal((await chainOf(f.record._id)).length, 3);
  });

  await t.test("V-AC S1 flag off → on: facts written while the flag was off are recomputed (stamp ≠ revision) before they drive a reason", async () => {
    const f = await fixture();
    await viaJob(await call(f.n._id, ET("2026-09-21T10:00"), "inbound_human"));
    let record = await Records.findById(f.record._id).lean().orFail();
    assert.equal(record.contact_facts_revision, record.revision, "flag-on writes stamp the facts");
    process.env.SALES_INTELLIGENCE_ATTENTION_EVOLUTION = "false";
    try { await viaJob(await call(f.n._id, ET("2026-09-21T11:00"), "attempt")); } finally { process.env.SALES_INTELLIGENCE_ATTENTION_EVOLUTION = "true"; }
    record = await Records.findById(f.record._id).lean().orFail();
    assert.equal(record.last_attributable_outbound_at, null, "the flag-off write left the facts stale");
    assert.notEqual(record.contact_facts_revision, record.revision, "and the stamp shows it");
    // The repair lap nominates the stale record once and recomputes it.
    const nomination = outreachRepairNomination("OutreachRecord", record)!;
    assert.match(nomination.dedupe_key, /:contact-facts-v1$/);
    const job = await withTransaction(s => enqueueCsiJob(nomination, s));
    assert.equal((await runOutreachEnsureJob(String(job._id))).status, "completed");
    record = await Records.findById(f.record._id).lean().orFail();
    assert.equal(+record.last_attributable_outbound_at!, +ET("2026-09-21T11:00"));
    assert.equal(record.contact_facts_revision, record.revision);
    assert.doesNotMatch(outreachRepairNomination("OutreachRecord", record)!.dedupe_key, /contact-facts/);
    assert.ok(!(await deriveAt(f.record._id, ET("2026-09-21T16:00"))).reasons.includes("no_callback_after_inbound"), "no false reason after the recompute");
    // The same staleness is also repaired by the next call on the record (ensureInteraction recomputes before applying).
    process.env.SALES_INTELLIGENCE_ATTENTION_EVOLUTION = "false";
    try { await viaJob(await call(f.n._id, ET("2026-09-22T10:00"), "attempt")); } finally { process.env.SALES_INTELLIGENCE_ATTENTION_EVOLUTION = "true"; }
    await viaJob(await call(f.n._id, ET("2026-09-22T12:00"), "voicemail"));
    record = await Records.findById(f.record._id).lean().orFail();
    assert.equal(+record.last_attributable_outbound_at!, +ET("2026-09-22T12:00")); assert.equal(record.contact_facts_revision, record.revision);
  });

  await t.test("V-AC S5 the seven policy fields cannot be persisted while ATTENTION_EVOLUTION is off", async () => {
    const { commandCsiSettings } = await import("../../src/services/salesIntelligence/settings");
    const { defaultCsiPolicy } = await import("../../src/services/salesIntelligence/policy");
    const base = { ...defaultCsiPolicy() };
    const { getSalesIntelligencePolicyPointerModel } = await import("../../src/models/SalesIntelligencePolicyPointer");
    const revisionNow = async () => (await getSalesIntelligencePolicyPointerModel().findOne({ key: "active" }).lean())?.revision ?? 1;
    const send = async (policy: Record<string, unknown>) => commandCsiSettings({ actor, idempotency_key: String(oid()),
      command: { command: "update_settings", expected_revision: await revisionNow(), reason: "Team 4 S5 proof", policy } });
    process.env.SALES_INTELLIGENCE_ATTENTION_EVOLUTION = "false";
    try {
      await assert.rejects(send({ ...base, callback_max_retries: 3 }), (error: { code?: string; issues?: Array<{ path: string; code: string }> }) =>
        error.code === "INVALID_INPUT" && error.issues?.[0]?.path === "policy.callback_max_retries" && error.issues[0].code === "requires_attention_evolution");
      await send(base);   // a policy without them is accepted as before
    } finally { process.env.SALES_INTELLIGENCE_ATTENTION_EVOLUTION = "true"; }
    const { resolvePolicy: current } = await import("../../src/services/salesIntelligence/policy");
    assert.equal("callback_max_retries" in (await current()), false);
    await send({ ...base, callback_max_retries: 3 });
    assert.equal((await current()).callback_max_retries, 3, "accepted with the flag on");
    await send(base);   // restore the defaults for anything after this subtest
  });

  await t.test("K29 zero model calls: no automatic step above enqueued a number_refresh or move_assessment job", async () => {
    const after = await jobCounts();
    // The only number_refresh rows are the Owner commands' own (patch/assign), which predate this plan.
    const owner = await Jobs.countDocuments({ stage: "number_refresh", dedupe_key: /^csi:owner-outreach:/ });
    assert.equal(after.number_refresh - zeroModel.number_refresh, owner);
    assert.equal(after.move_assessment, zeroModel.move_assessment);
    assert.equal(await getSalesIntelligenceReviewItemModel().countDocuments({ cause_kind: "completion_target" }), 0);
  });
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
});
