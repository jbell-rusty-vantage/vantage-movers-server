import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { CALL_INTERACTION_INDEXES } from "../src/models/CallInteraction";
import { CONTACT_NUMBER_INDEXES } from "../src/models/ContactNumber";
import { NUMBER_LEAD_ATTACHMENT_INDEXES } from "../src/models/NumberLeadAttachment";
import { REP_IDENTITY_LINK_INDEXES } from "../src/models/RepIdentityLink";
import { ENTITY_CHANGE_INDEXES } from "../src/models/EntityChange";
import { SALES_INTELLIGENCE_JOB_INDEXES, getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { SALES_INTELLIGENCE_SYNC_STATE_INDEXES } from "../src/models/SalesIntelligenceSyncState";
import { SALES_INTELLIGENCE_CONTACT_RESTRICTION_INDEXES } from "../src/models/SalesIntelligenceContactRestriction";
import { searchNumberActivity, numberSearchQuerySchema } from "../src/services/numberActivity/search";
import { getContactNumberDetail } from "../src/services/numberActivity/contactNumbers";
import { getNumberTimeline } from "../src/services/numberActivity/timeline";
import { LEAD_CHANGE_SCOPE, scanLeadChangesForAttachments, wakeLeadAttachmentsAfterChange } from "../src/services/salesIntelligence/attachment/leadTrigger";
import { leadAttachmentJobInput } from "../src/services/salesIntelligence/attachment/sources";
import { enqueueCsiJob } from "../src/services/salesIntelligence/jobs";

/**
 * SLIM-05 replica proof on the csi01 loopback replica: Number list, detail and timeline read only retained
 * deterministic collections (every retired Outreach/analysis/conversation/assessment/Attention collection is
 * absent before and after), resolve none / one / several attached Leads with the official Booking and
 * Cancellation state, and attribute a call to the reviewed rep at the call time. The Lead → attachment trigger
 * raises one job per Lead fingerprint from the post-commit wake-up and the durable EntityChange scan alike.
 */
const RETIRED = ["outreach_records", "outreach_followups", "outreach_band_transitions", "outreach_rep_days", "lead_conversations", "intelligence_runs",
  "intelligence_evidence_snapshots", "intelligence_submissions", "intelligence_findings", "intelligence_effects", "intelligence_owner_assessments",
  "move_assessment_artifacts", "sales_intelligence_attention_snapshots", "sales_intelligence_attention_artifacts", "sales_intelligence_ai_budget",
  "sales_intelligence_ai_reservations", "operational_events"];
const oid = () => new mongoose.Types.ObjectId();
const at = (iso: string) => new Date(iso);

test("Numbers reads and the Lead attachment trigger work with every retired collection absent", {
  skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300_000,
}, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.equal(getMongoDatabaseName(), "testvantagemovers_numbersslim");
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  await db.dropDatabase();
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  t.mock.method(globalThis, "fetch", async () => { throw new Error("External traffic forbidden in the Numbers replica proof"); });
  for (const [collection, indexes] of [["contact_numbers", CONTACT_NUMBER_INDEXES], ["call_interactions", CALL_INTERACTION_INDEXES],
    ["number_lead_attachments", NUMBER_LEAD_ATTACHMENT_INDEXES], ["rep_identity_links", REP_IDENTITY_LINK_INDEXES], ["entity_changes", ENTITY_CHANGE_INDEXES],
    ["sales_intelligence_jobs", SALES_INTELLIGENCE_JOB_INDEXES], ["sales_intelligence_sync_state", SALES_INTELLIGENCE_SYNC_STATE_INDEXES],
    ["sales_intelligence_contact_restrictions", SALES_INTELLIGENCE_CONTACT_RESTRICTION_INDEXES]] as const)
    for (const { key, ...options } of indexes as ReadonlyArray<{ key: Record<string, 1 | -1>; name: string; unique?: boolean }>)
      await db.collection(collection).createIndex(key, { ...options, unique: Boolean(options.unique) });

  // ── Seed: four Numbers ────────────────────────────────────────────────
  const account = "800000000001";
  const leadA = oid(), leadB = oid(), leadC = oid(), booking = oid(), cancellation = oid(), agent = oid();
  await db.collection("form_leads").insertMany([
    { _id: leadA, name: "Jane Synthetic", job_no: "J-100", source_company_label_snapshot: "Top10", timestamp: at("2026-09-01T12:00:00Z"), normalized_phone_number: "5550100201" },
    { _id: leadB, name: "Bob Synthetic", job_no: "J-200", timestamp: at("2026-09-02T12:00:00Z"), duplicate: true },
  ]);
  await db.collection("call_leads").insertOne({ _id: leadC, name: "Cal Synthetic", job_no: "J-300", timestamp: at("2026-09-03T12:00:00Z") });
  await db.collection("booked_leads").insertOne({ _id: booking, lead_model: "FormLead", lead_ref: leadA, book_date: at("2026-09-05T12:00:00Z") });
  await db.collection("cancelled_leads").insertOne({ _id: cancellation, booked_lead: booking, cancel_date: at("2026-09-06T12:00:00Z") });
  const number = (n: number, extra: Record<string, unknown> = {}) => ({ _id: oid(), revision: 1, e164: `+1555010020${n}`, national_ten: `555010020${n}`,
    digits_reversed: `${n}0200105551`, country: "US", kind: "external", classification: "unknown", contact_eligibility: { state: "allowed" },
    provider_names: [], search_terms: ["synthetic slim"], first_observed_at: at("2026-09-01T00:00:00Z"), last_activity_at: at(`2026-09-1${n}T00:00:00Z`),
    rollups: { interactions_total: 1, inbound_total: 1, outbound_total: 0, human_conversations_total: 0, last_inbound_at: null, last_outbound_at: null,
      last_human_conversation_at: null, attached_lead_count: 0, candidate_lead_count: 0, recordings_total: 0,
      // Stored before the slimming: retired rollups must never reach a DTO.
      open_outreach_count: 2, outreach_records_total: 3, conversations_analyzed_total: 1, last_analyzed_at: at("2026-09-09T00:00:00Z") },
    running_summary: { text: "retired summary text", run_id: oid(), evidence_digest: "x", computed_at: at("2026-09-09T00:00:00Z") }, purged_at: null, ...extra });
  const none = number(1), resolved = number(2), multiple = number(3), restricted = number(4);
  await db.collection("contact_numbers").insertMany([none, resolved, multiple, restricted]);
  const edge = (numberId: unknown, model: string, id: unknown, state: string) => ({ _id: oid(), contact_number_id: numberId, lead_ref: { model, id }, state,
    certainty: state === "attached" ? "exact" : "likely", revision: 1, evidence: [], history: [], lead_snapshot: { name: "Snapshot", job_no: "S-1" }, decided_at: null });
  await db.collection("number_lead_attachments").insertMany([
    edge(resolved._id, "FormLead", leadA, "attached"), edge(resolved._id, "CallLead", leadC, "candidate"),
    edge(multiple._id, "FormLead", leadB, "attached"), edge(multiple._id, "CallLead", leadC, "attached"),
    edge(restricted._id, "FormLead", leadB, "candidate"),
  ]);
  await db.collection("sales_intelligence_contact_restrictions").insertOne({ _id: oid(), contact_number_id: restricted._id, channels: ["call"], until: null,
    origin: "intelligence", actor: { kind: "system", id: "csi" }, run_id: oid(), finding_id: oid(), state: "active", revision: 1 });
  await db.collection("rep_identity_links").insertOne({ _id: oid(), revision: 1, agent_id: agent, agent_name_snapshot: "Dana Rep", rc_account_id: account,
    rc_extension_id: "e1", role_kind: "sales_rep", status: "reviewed", effective_from: at("2026-09-01T00:00:00Z"), effective_to: null,
    reviewed_at: at("2026-09-01T00:00:00Z"), reviewed_by: "owner" });
  await db.collection("call_interactions").insertOne({ _id: oid(), provider: "ringcentral", provider_account_id: account, contact_number_id: resolved._id,
    merged_into_id: null, direction: "Inbound", provider_result: "Call connected", provider_connected: true, contact_type: "unknown", duration_seconds: 95,
    terminal: true, call_log_state: "settled", started_at: at("2026-09-12T15:00:00Z"), answered_at: at("2026-09-12T15:00:05Z"), ended_at: at("2026-09-12T15:01:40Z"),
    company_e164: "+18885550100", parties: [{ role: "external", connected: true }, { role: "user", connected: true, extension_id: "e1", extension_number: "101" }],
    legs: [{ leg_type: "Accept", direction: "Inbound", result: "Accepted", start_time: at("2026-09-12T15:00:00Z"), duration_seconds: 95, extension_id: "e1" }],
    legs_overflow_count: 0, recordings: [{ provider_recording_id: "rec-1", recording_type: "Automatic" }], sources: ["webhook"], projection_revision: 2,
    last_observed_at: at("2026-09-12T15:02:00Z"), transfer: false, queue_fanout: false });

  // ── Reads ─────────────────────────────────────────────────────────────
  const page = await searchNumberActivity(numberSearchQuerySchema.parse({ q: "synthetic slim", limit: 10 }), { hasCallsDefault: false });
  const byId = new Map(page.data.items.map(item => [item.id, item]));
  assert.equal(page.data.items.length, 4);
  assert.deepEqual(byId.get(String(none._id))!.attached_lead, { status: "none" });
  assert.deepEqual(byId.get(String(multiple._id))!.attached_lead, { status: "multiple" }, "several attached Leads never pick one");
  assert.deepEqual(byId.get(String(restricted._id))!.attached_lead, { status: "none" }, "a candidate never lends its Lead");
  assert.deepEqual(byId.get(String(resolved._id))!.attached_lead, { status: "resolved", lead_ref: { model: "FormLead", id: String(leadA) },
    lead_display: { name: "Jane Synthetic", job_no: "J-100", source_company: "Top10" },
    official: { status: "cancelled", booking_id: String(booking), cancellation_id: String(cancellation) } });
  for (const item of page.data.items) assert.ok(!("outreach_records_total" in item.rollups) && !("open_outreach_count" in item.rollups));
  assert.deepEqual(Object.keys(page.coverage.capabilities).sort(), ["call_log", "webhook"]);

  const detail = await getContactNumberDetail(String(restricted._id));
  assert.ok(detail);
  assert.deepEqual(detail.data.restrictions.map(r => [r.origin, r.state, r.channels]), [["intelligence", "active", ["call"]]]);
  assert.equal(detail.data.connections.candidate, 1);
  assert.ok(!("running_analysis" in detail.data) && !("outreach_records" in detail.data) && !("review_items" in detail.data));
  const resolvedDetail = await getContactNumberDetail(String(resolved._id));
  assert.equal(resolvedDetail!.data.attached_lead.status, "resolved");
  assert.equal(resolvedDetail!.data.attachments.length, 2);

  const timeline = await getNumberTimeline(String(resolved._id), { limit: 10 });
  assert.equal(timeline!.data.items.length, 1);
  const call = timeline!.data.items[0]!;
  assert.equal(call.kind, "interaction");
  assert.deepEqual(call.detail.rep, { status: "reviewed", agent_id: String(agent), agent_name: "Dana Rep", extension_id: "e1", extension_number: "101" });
  assert.equal((call.detail.legs as unknown[]).length, 1);
  assert.deepEqual(call.detail.recording_ids, ["rec-1"]);

  const afterReads = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name));
  for (const name of RETIRED) assert.equal(afterReads.has(name), false, `${name} absent after the reads`);

  // ── Lead → attachment trigger ─────────────────────────────────────────
  const observation = oid();
  const change = (lead: mongoose.Types.ObjectId, revisionBefore: number, paths: string[], appliedAt: Date, provenance: Record<string, unknown> = {}) => ({
    _id: oid(), entity: { model: "FormLead", id: String(lead) }, command_execution_id: oid(), command_name: "synthetic", provenance,
    changed_paths: paths, fields: paths.map(path => ({ path })), revision_before: revisionBefore, revision_after: revisionBefore + 1, applied_at: appliedAt });
  const Jobs = getSalesIntelligenceJobModel();
  const leadJobs = () => Jobs.countDocuments({ subject_key: `attachment-lead:FormLead:${leadA}` });
  await db.collection("entity_changes").insertMany([
    change(leadA, 0, ["name", "normalized_phone_number"], new Date(), { observation_id: observation }),
    change(leadA, 1, ["booked"], new Date(), { observation_id: observation }),
  ]);
  const woke = await wakeLeadAttachmentsAfterChange({ observation_id: String(observation), target: { model: "FormLead", id: String(leadA) } }, { enabled: () => true });
  assert.equal(woke.job_ids.length, 1, "two changes with one fingerprint: one runnable job, one wake-up");
  assert.equal(await leadJobs(), 1);
  const replay = await wakeLeadAttachmentsAfterChange({ observation_id: String(observation), target: { model: "FormLead", id: String(leadA) } }, { enabled: () => true });
  assert.equal(await leadJobs(), 1, "a replayed observation creates no work");
  assert.ok(replay.job_ids.length <= 1);
  const lead = await db.collection("form_leads").findOne({ _id: leadA });
  const expected = leadAttachmentJobInput("FormLead", String(leadA), lead as never);
  assert.equal((await Jobs.findOne({ subject_key: `attachment-lead:FormLead:${leadA}` }).lean())!.dedupe_key, expected.dedupe_key,
    "the wake-up raises the same identity as the watermark backstop");

  // Durable scan: the first pass seeds its cursor; a later commit is nominated once; an unrelated edit nominates nothing.
  const first = await scanLeadChangesForAttachments();
  assert.ok((await db.collection("sales_intelligence_sync_state").findOne({ scope: LEAD_CHANGE_SCOPE }))?.cursor);
  assert.equal(await leadJobs(), 1, `the scan re-raises the same job identity (${first.nominated} nominations, no new row)`);
  await db.collection("form_leads").updateOne({ _id: leadA }, { $set: { normalized_phone_number: "5550100299" } });
  await db.collection("entity_changes").insertMany([
    change(leadA, 2, ["normalized_phone_number"], new Date(Date.now() + 1_000)),
    change(leadA, 3, ["cpl"], new Date(Date.now() + 2_000)),
  ]);
  const second = await scanLeadChangesForAttachments(new Date(Date.now() + 5_000));
  assert.equal(await leadJobs(), 2, "a phone change is a new fingerprint: one new job");
  const third = await scanLeadChangesForAttachments(new Date(Date.now() + 10_000));
  assert.equal(await leadJobs(), 2, "re-scanning the commit-lag window creates nothing new");
  assert.ok(second.scanned >= 2 && third.nominated >= 0);
  // A pre-existing job with today's identity is a dedupe hit, never a conflict.
  await withTransaction(session => enqueueCsiJob(leadAttachmentJobInput("FormLead", String(leadA), { ...(lead as object), normalized_phone_number: "5550100299" } as never), session));
  assert.equal(await leadJobs(), 2);
  const stages = await Jobs.distinct("stage");
  assert.deepEqual(stages, ["attachment_refresh"], "the trigger nominates no Outreach, discovery or analysis stage");
  const afterTrigger = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name));
  for (const name of RETIRED) assert.equal(afterTrigger.has(name), false, `${name} absent after the trigger`);
});
