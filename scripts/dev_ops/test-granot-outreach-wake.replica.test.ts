/**
 * AC6-WAKE K32 (Attention and Case File spec §8.2) on the csi01 replica.
 *
 * A live Granot Priority receipt processed by `createGranotObservationProcessor` (the production
 * entry point used by the drainer) commits the Lead EntityChange, and right after the commit the
 * `outreach_ensure` job exists with the minute scan's own dedupe key. A replay creates nothing; the
 * next minute-scan pass (`runOutreachEnsureOnce`) hits the same key and creates nothing. With
 * `SALES_INTELLIGENCE_OUTREACH_ENSURE` off, no job row is written by the wake-up.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../src/config/domain/granotLifecycle";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { connectMongo } from "../../src/db";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getEntityChangeModel } from "../../src/models/EntityChange";
import type { GranotObservationDocument } from "../../src/models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../src/models/GranotObservationReceipt";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { normalizeJobNo } from "../../src/services/bookings/bookingIdentity";
import { createGranotObservationProcessor, wakeOutreachAfterGranotApply, type GranotLifecycleProcessorDeps } from "../../src/services/granotLifecycle/processor";
import type { LeadIdentityResult } from "../../src/services/granotLifecycle/identity";
import type { SourcePolicyStore } from "../../src/services/granotLifecycle/sourcePolicy";
import { runOutreachEnsureOnce } from "../../src/services/salesIntelligence/outreach/worker";

const capturedAt = new Date("2026-09-18T16:00:00.000Z");
const COMPANY = "64a000000000000000000001", GRANULARITY = "64a000000000000000000002";
const oid = () => new mongoose.Types.ObjectId();

const policyStore: SourcePolicyStore = {
  async findByNormalizedLabel() {
    return [{ id: "64a000000000000000000010", enabled: true, lifecycle_enabled: true, lifecycle_disposition: "source_scoped_lead", lead_created_policy: "link_only",
      lead_source_company: COMPANY, lifecycle_routes: [{ route_key: "form_any", lead_model: "FormLead", move_type: "any", source_granularity_id: GRANULARITY }],
      lifecycle_policy_version: "granot-lifecycle-source-policy-v1", normalized_granot_label: "synthetic forms" }];
  },
  async findCompany(id) { return { id, active: true }; },
  async findGranularity(id) { return { id, source_company_id: COMPANY, active: true, channel: "form" }; },
};

function observation(job: { raw: string; normalized: string }, priority: string, captured_at = capturedAt): GranotObservationDocument {
  return { _id: oid(), receipt_id: oid(), schema_version: 1, kind: "lead_snapshot", normalization_result: "valid", route_event_class: "lead_created", captured_at,
    source_label_raw: "Synthetic Forms", normalized_source_label: "synthetic forms", identity: { job_no_raw: job.raw, normalized_job_no: job.normalized },
    contact: {}, move: { origin: { state: "NY", zip: "10001" }, destination: { state: "NY", zip: "10002" } }, priority: { valid: true, canonical: priority },
    booking_action: {}, display_money: {}, agent_identity: {}, provider_context: {}, issues: [], createdAt: captured_at, updatedAt: captured_at } as GranotObservationDocument;
}
const identityFor = (leadId: string): LeadIdentityResult => ({ outcome: "linked", reason_code: "record_link_confirmed", match_method: "form_ref_no_exact",
  target: { model: "FormLead", id: leadId }, target_eligibility: "full", candidates: [{ target: { model: "FormLead", id: leadId }, reason_codes: ["form_ref_no_exact"] }] });

async function seedReceipt(o: GranotObservationDocument) {
  await getGranotObservationReceiptModel().create({ _id: o.receipt_id, source_system: "granot", observation_channel: "granot_webhook", captured_at: o.captured_at,
    route_event_class: "lead_created", authentication_method: "header_secret", evidence_version: 2, payload_kind: "object", headers: { "content-type": "application/json" },
    payload: { event_type: "lead_created", priority: "1" }, payload_sha256: String(o._id).padEnd(64, "a"),
    processing: { state: "pending", technical_attempts: 0, match_attempt: 0, next_attempt_at: o.captured_at, manual_requeue_count: 0 }, provider: "granot" });
}
function liveDeps(o: GranotObservationDocument, leadId: string, extra: Partial<GranotLifecycleProcessorDeps> = {}): GranotLifecycleProcessorDeps {
  return { now: () => new Date("2026-09-18T16:05:00.000Z"), flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, shadow_mode: false, lead_writes_enabled: true },
    sourcePolicyStore: policyStore, loadReceipt: async () => ({ _id: o.receipt_id, observation_channel: "granot_webhook", captured_at: o.captured_at, processing: { match_attempt: 0 } }),
    upsertObservation: async () => o, loadActivation: async () => ({ activated_at: new Date("2026-09-17T14:00:00.000Z") }), resolveIdentity: async () => identityFor(leadId), ...extra };
}
async function seedFormLead(id: mongoose.Types.ObjectId, job: { raw: string; normalized: string }) {
  await getFormLeadModel().create({ _id: id, source_company: "synthetic", name: "Submitted Name", phone_number: "5550002222", email: "wake@example.test",
    pickup_zip: "10001", destination_zip: "10002", pickup_state: "NY", delivery_state: "NY", move_date: capturedAt, local: "local", quoted: false,
    granot_priority: "0", job_no: job.raw, normalized_job_no: job.normalized, ingestion_origin: "wordpress_form", move_size: "Studio", domain_revision: 3 });
}

test("AC6-WAKE K32: Granot receipt → outreach_ensure job at commit; the minute scan finds the key", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 180_000 }, async (t) => {
  assert.match(getMongoDatabaseName(), /^testvantagemovers_t4cwake[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  const Jobs = getSalesIntelligenceJobModel(), Changes = getEntityChangeModel();

  const leadId = oid(), raw = `t4c-wake-${leadId}`, job = { raw, normalized: normalizeJobNo(raw)! };
  await seedFormLead(leadId, job);
  const incoming = observation(job, "1");
  await seedReceipt(incoming);
  const published: string[] = [];
  const processor = createGranotObservationProcessor({ ...liveDeps(incoming, String(leadId)),
    // Records the wake-up exactly as the default path does, with the publisher observed (it is a no-op in TEST_MODE anyway: K33).
    wakeOutreach: result => wakeOutreachAfterGranotApply(result, { publish: async (id: string) => { published.push(id); } }) });
  const result = await processor.process({ receipt_id: String(incoming.receipt_id) });
  assert.equal(result.outcome, "applied");
  const changes = await Changes.find({ "entity.model": "FormLead", "entity.id": String(leadId), "provenance.observation_id": incoming._id }).lean();
  assert.ok(changes.length >= 1, "the Priority change committed a Lead EntityChange");
  const keys = changes.map(c => `csi:outreach:entity-change:v2:${c._id}`);
  const jobs = await Jobs.find({ dedupe_key: { $in: keys } }).lean();
  assert.equal(jobs.length, changes.length, "one outreach_ensure job per committed Lead change, present when process() returns");
  for (const row of jobs) {
    assert.equal(row.stage, "outreach_ensure");
    assert.equal(row.subject_key, `outreach-lead:FormLead:${leadId}`);
    assert.equal(row.status, "pending");
  }
  assert.deepEqual(published.sort(), jobs.map(j => String(j._id)).sort(), "each new job was woken");
  console.log(JSON.stringify({ k32: { changes: changes.length, jobs: jobs.map(j => ({ id: String(j._id), dedupe_key: j.dedupe_key, status: j.status, input_refs: j.input_refs })) } }));

  // Replay of the same receipt: the decision exists; the wake-up finds the job and adds nothing.
  const replayed = await processor.process({ receipt_id: String(incoming.receipt_id) });
  assert.equal(replayed.decision_id, result.decision_id);
  assert.equal(await Jobs.countDocuments({ dedupe_key: { $in: keys } }), jobs.length);

  // The next minute-scan pass nominates the same EntityChange and hits the same dedupe key.
  const before = await Jobs.countDocuments({ dedupe_key: { $regex: "^csi:outreach:entity-change:v2:" } });
  const scan = await runOutreachEnsureOnce();
  assert.equal(scan.skipped, false);
  const afterRows = await Jobs.find({ dedupe_key: { $in: keys } }).lean();
  assert.equal(afterRows.length, jobs.length, "the scan created no second job for the change");
  assert.deepEqual(afterRows.map(r => String(r._id)).sort(), jobs.map(j => String(j._id)).sort());
  assert.equal(await Jobs.countDocuments({ dedupe_key: { $regex: "^csi:outreach:entity-change:v2:" } }), before, "no new entity-change job at all");
  console.log(JSON.stringify({ k32_scan: { scanned: scan.scanned, outcomes: "outcomes" in scan ? scan.outcomes : null, statuses: afterRows.map(r => r.status) } }));

  // V-AC N2: a hanging wake-up (injected) holds a real applied receipt for at most the bound.
  {
    const slowLead = oid(), slowRaw = `t4c-wake-slow-${slowLead}`, slowJob = { raw: slowRaw, normalized: normalizeJobNo(slowRaw)! };
    await seedFormLead(slowLead, slowJob);
    const slowObservation = observation(slowJob, "1");
    await seedReceipt(slowObservation);
    const slow = createGranotObservationProcessor({ ...liveDeps(slowObservation, String(slowLead)), wakeOutreachTimeoutMs: 100,
      wakeOutreach: () => new Promise(resolve => setTimeout(resolve, 5_000).unref()) });
    const started = Date.now();
    assert.equal((await slow.process({ receipt_id: String(slowObservation.receipt_id) })).outcome, "applied");
    const waited = Date.now() - started;
    console.log(JSON.stringify({ n2_hanging_wake_ms: waited }));
    assert.ok(waited < 3_000, `processing returned at the bound (${waited} ms), not after the 5 s wake-up`);
  }

  // Flag off (the scan's own gate): the wake-up writes no job row.
  process.env.SALES_INTELLIGENCE_OUTREACH_ENSURE = "false";
  try {
    const otherLead = oid(), otherRaw = `t4c-wake-off-${otherLead}`, otherJob = { raw: otherRaw, normalized: normalizeJobNo(otherRaw)! };
    await seedFormLead(otherLead, otherJob);
    const offObservation = observation(otherJob, "1");
    await seedReceipt(offObservation);
    const off = createGranotObservationProcessor(liveDeps(offObservation, String(otherLead)));
    assert.equal((await off.process({ receipt_id: String(offObservation.receipt_id) })).outcome, "applied");
    const offChanges = await Changes.find({ "entity.id": String(otherLead), "provenance.observation_id": offObservation._id }).lean();
    assert.ok(offChanges.length >= 1);
    assert.equal(await Jobs.countDocuments({ dedupe_key: { $in: offChanges.map(c => `csi:outreach:entity-change:v2:${c._id}`) } }), 0, "flag off: no job row");
  } finally { process.env.SALES_INTELLIGENCE_OUTREACH_ENSURE = "true"; }
});
