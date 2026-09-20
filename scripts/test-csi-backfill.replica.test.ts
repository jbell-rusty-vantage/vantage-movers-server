import assert from "node:assert/strict";
import { test } from "node:test";
import express, { type Request } from "express";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { CSI_BACKFILL_JOB_PRIORITY } from "../src/config/domain/salesIntelligence";
import { applyCsiMigration } from "./migrations/sales-intelligence.lib";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceSyncStateModel } from "../src/models/SalesIntelligenceSyncState";
import { getSalesIntelligenceSyncWindowModel } from "../src/models/SalesIntelligenceSyncWindow";
import { getCallInteractionModel } from "../src/models/CallInteraction";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getFormLeadModel } from "../src/models/FormLead";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../src/models/OutreachFollowup";
import { getSalesIntelligenceAuditEventModel } from "../src/models/SalesIntelligenceAuditEvent";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../src/models/IntelligenceFinding";
import { claimCsiJob, enqueueCsiJob } from "../src/services/salesIntelligence/jobs";
import { readBackfillCoverage } from "../src/services/salesIntelligence/backfill/coverage";
import { commandPlanBackfill } from "../src/services/salesIntelligence/backfill/plan";
import { runBackfillStepOnce } from "../src/services/salesIntelligence/backfill/step";
import { runBackfillActivationJob, drainBackfillActivationJobs } from "../src/services/salesIntelligence/backfill/worker";
import { claimWindowWork, commitWindowPage } from "../src/services/salesIntelligence/backfill/windowWork";
import { requireCsiOwner } from "../src/services/salesIntelligence/auth";
import { CALL_LOG_BACKFILL_STREAM } from "../src/services/salesIntelligence/backfill/windows";
import { syntheticDirectory, inboundConnectedCallLog, SYNTHETIC_ACCOUNT_ID } from "../src/services/numberActivity/fixtures";
import { applyInteractionObservation } from "../src/services/numberActivity/persistInteraction";
import { RingCentralApiError } from "../src/services/ringcentral/client";
import { computeAdminActorSignature } from "../src/services/operationsRegistry/trustedActor";
import { drainAttachmentRefreshJobs } from "../src/services/salesIntelligence/attachment/refresh";
import { persistLeadAttachments } from "../src/services/salesIntelligence/attachment/store";
import { ensureLead, ensureInteraction, workerContext } from "../src/services/salesIntelligence/outreach/ensure";
import { applyOutreachEffect, outreachEffectInputSchema } from "../src/services/salesIntelligence/outreach/effects";
import { readOutreach } from "../src/services/salesIntelligence/outreach/reads";

// No network provider can be reached accidentally by this suite.
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Unexpected network access in synthetic CSI-15 proof"); };
test("CSI-15 backfill synthetic replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300_000 }, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(getMongoDatabaseName(), /^testvantagemovers_csi15[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); globalThis.fetch = originalFetch; });
  assert.equal((await applyCsiMigration()).ready, true);
  const Window = getSalesIntelligenceSyncWindowModel(), Jobs = getSalesIntelligenceJobModel();
  const request: Request = Object.assign(Object.create(express.request), { method: "POST", originalUrl: "/api/v1/admin/sales-intelligence/backfill", headers: {},
    vantageAuth: { kind: "user", userId: "synthetic-owner", email: "owner@example.test", roles: ["owner"] } });
  const fields = { adminId: "synthetic-owner", email: "owner@example.test", role: "owner", timestamp: String(Date.now()), requestId: "csi15-proof", method: request.method, path: request.originalUrl };
  request.headers = { "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role,
    "x-vantage-admin-timestamp": fields.timestamp, "x-vantage-admin-request-id": fields.requestId,
    "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!) };
  const actor = requireCsiOwner(request), oid = () => new mongoose.Types.ObjectId();
  const from = "2026-09-10T00:00:00.000Z", to = "2026-09-11T00:00:00.000Z";
  const body = { from, to, reason: "Synthetic isolated proof", expected_revision: 1 };
  const plan = (key: string, command = body) => commandPlanBackfill({ actor, idempotency_key: key, command });
  const now = new Date("2026-09-19T12:00:00Z");
  const deps = { now: () => now, configuredAccountId: SYNTHETIC_ACCOUNT_ID, directory: async () => syntheticDirectory(), resolveRoute: () => null };
  async function cleanWork() { await Window.deleteMany({}); await Jobs.deleteMany({}); await db.collection("sales_intelligence_sync_state").deleteMany({ scope: "backfill" }); }
  async function window(extra = {}) { return Window.create({ stream: CALL_LOG_BACKFILL_STREAM, window_from: new Date(from), window_to: new Date(to), ...extra }); }
  t.beforeEach(async () => { process.env.SALES_INTELLIGENCE_BACKFILL_DAYS = "7"; await cleanWork(); });
  const providerError = (status: number) => new RingCentralApiError("synthetic", status, "synthetic", "/fake", "GET", {});

  await t.test("Owner planning is durable, idempotent, range capped and disabled by day count zero", async () => {
    process.env.SALES_INTELLIGENCE_BACKFILL_DAYS = "0";
    const disabled = await plan("disabled"); assert.equal(disabled.response.available, false); assert.equal(await Window.countDocuments(), 0);
    process.env.SALES_INTELLIGENCE_BACKFILL_DAYS = "2";
    const first = await plan("first", { ...body, from: "2026-09-01T00:00:00.000Z" });
    assert.equal(first.replayed, false); assert.equal(first.response.windows_planned, 2); assert.equal(first.response.window_from, "2026-09-09T00:00:00.000Z");
    const again = await plan("first", { ...body, from: "2026-09-01T00:00:00.000Z" });
    assert.equal(again.replayed, true); assert.deepEqual(again.response, first.response); assert.equal(await Window.countDocuments(), 2);
    await assert.rejects(plan("first", { ...body, reason: "changed" }), /IDEMPOTENCY_CONFLICT/);
    await assert.rejects(plan("overlap", { ...body, to: "2026-09-10T12:00:00.000Z" }), /IDEMPOTENCY_CONFLICT/);
    process.env.SALES_INTELLIGENCE_BACKFILL_DAYS = "7"; await cleanWork();
  });
  await t.test("page checkpoint survives restart and expired lease; stale page never commits", async () => {
    const w = await window(); const pages: number[] = [];
    const fetchPage = async ({ page }: { page: number }) => { pages.push(page); return page === 1 ? [inboundConnectedCallLog("checkpoint", { startTime: new Date("2026-09-10T10:00:00Z") })] : []; };
    const first = await runBackfillStepOnce({ ...deps, perPage: 1, fetchPage }); assert.equal(first.status, "partial");
    assert.equal((await Window.findById(w._id))?.checkpoint_page, 1);
    await Jobs.deleteMany({}); // Simulate lost capture wake-ups; no queue is authoritative.
    const lease = await claimWindowWork({ window_id: String(w._id), owner: "crashed", ttl_ms: 1000, now }); assert.ok(lease);
    const resumeAt = new Date(+now + 2000);
    const last = await runBackfillStepOnce({ ...deps, now: () => resumeAt, perPage: 1, fetchPage });
    assert.equal(last.status, "complete"); assert.deepEqual(pages, [1, 2]);
    assert.equal(await commitWindowPage(lease, resumeAt, { checkpoint_page: 99, records: 99, status: "complete", last_error_code: null }), false);
    const final = await Window.findById(w._id).orFail(); assert.equal(final.checkpoint_page, 2); assert.equal(final.pages_done, 2);
    assert.equal(await Jobs.countDocuments({ stage: "backfill", input_refs: String(w._id) }), 1);
    assert.equal(await getCallInteractionModel().countDocuments({ telephony_session_id: "checkpoint" }), 1);
    await cleanWork();
  });
  await t.test("partial page persistence replays idempotently after failure without skipping the failed record", async () => {
    const w = await window(); let writes = 0;
    const rows = ["partial-a", "partial-b"].map(id => inboundConnectedCallLog(id, { startTime: new Date("2026-09-10T10:00:00Z") }));
    const fetchPage = async ({ page }: { page: number }) => page === 1 ? rows : [];
    const apply: typeof applyInteractionObservation = async (...args) => {
      if (++writes === 2) throw new Error("synthetic process interruption after first durable row");
      return applyInteractionObservation(...args);
    };
    const failed = await runBackfillStepOnce({ ...deps, perPage: 2, fetchPage, apply });
    assert.equal(failed.status, "partial"); assert.equal((await Window.findById(w._id))?.checkpoint_page, 0);
    assert.equal(await getCallInteractionModel().countDocuments({ telephony_session_id: { $in: ["partial-a", "partial-b"] } }), 1);
    await Window.updateOne({ _id: w._id }, { $set: { retry_after_until: null } });
    const resumed = await runBackfillStepOnce({ ...deps, perPage: 2, fetchPage });
    assert.equal(resumed.error_code, null, JSON.stringify(resumed)); assert.equal(resumed.status, "partial");
    assert.equal((await Window.findById(w._id))?.checkpoint_page, 1);
    assert.equal((await runBackfillStepOnce({ ...deps, perPage: 2, fetchPage })).status, "complete");
    assert.equal(await getCallInteractionModel().countDocuments({ telephony_session_id: { $in: ["partial-a", "partial-b"] } }), 2);
    assert.equal((await Window.findById(w._id))?.checkpoint_page, 2);
  });
  await t.test("Coverage uses stored counts and explicit gaps while completed watermark never regresses", async () => {
    const unknown = await readBackfillCoverage(); assert.equal(unknown.planned, null); assert.equal(unknown.failed, null);
    await window(); assert.equal((await runBackfillStepOnce({ ...deps, fetchPage: async () => [] })).status, "complete");
    const complete = await readBackfillCoverage(); assert.equal(complete.complete, 1); assert.equal(complete.known_complete_through, to);
    await window({ window_from: new Date("2026-09-08T00:00:00Z"), window_to: new Date("2026-09-09T00:00:00Z") });
    let coverage = await readBackfillCoverage(); assert.equal(coverage.planned, 1); assert.equal(coverage.known_complete_through, to);
    assert.ok(coverage.gaps.some(g => g.reason === "planned")); assert.ok(coverage.gaps.some(g => g.reason === "unplanned_range"));
    await Jobs.deleteMany({});
    assert.equal((await runBackfillStepOnce({ ...deps, fetchPage: async () => [] })).status, "complete");
    coverage = await readBackfillCoverage(); assert.equal(coverage.complete, 2); assert.equal(coverage.known_complete_through, to);
  });
  await t.test("lease loss during provider page leaves checkpoint replayable", async () => {
    const w = await window(); let clock = new Date(now);
    const result = await runBackfillStepOnce({ ...deps, now: () => clock, leaseTtlMs: 1000, fetchPage: async () => { clock = new Date(+clock + 2000); return []; } });
    assert.equal(result.error_code, "lease_lost"); assert.equal((await Window.findById(w._id))?.checkpoint_page, 0);
    assert.equal((await runBackfillStepOnce({ ...deps, now: () => clock, fetchPage: async () => [] })).status, "complete"); await cleanWork();
  });
  await t.test("default-priority live jobs defer historical capture and explicit historical analysis claims", async () => {
    await window();
    const liveState = await getSalesIntelligenceSyncStateModel().create({ scope: "call_log_all_directions", lease_owner: "live-reconcile", lease_epoch: 1, leased_until: new Date(+now + 60_000), known_complete_through: new Date("2026-09-18T00:00:00Z") });
    const before = await getSalesIntelligenceSyncStateModel().findById(liveState._id).lean();
    assert.equal((await runBackfillStepOnce({ ...deps, fetchPage: async () => { assert.fail("live reconcile lease must win"); } })).skip_reason, "live_priority");
    assert.deepEqual(await getSalesIntelligenceSyncStateModel().findById(liveState._id).lean(), before);
    await getSalesIntelligenceSyncStateModel().deleteOne({ _id: liveState._id });
    const live = await withTransaction(s => enqueueCsiJob({ stage: "analysis", subject_key: "live", dedupe_key: "live", input_revision: 1, input_refs: [] }, s, now));
    const historical = await withTransaction(s => enqueueCsiJob({ stage: "analysis", subject_key: "historical", dedupe_key: "historical", input_revision: 1, input_refs: [], priority: CSI_BACKFILL_JOB_PRIORITY }, s, now));
    assert.equal((await runBackfillStepOnce({ ...deps, fetchPage: async () => { assert.fail("must yield before provider"); } })).skip_reason, "live_priority");
    assert.equal(await claimCsiJob("history", String(historical._id), 60_000, "analysis"), null);
    assert.equal(String((await claimCsiJob("live", undefined, 60_000, "analysis"))?._id), String(live._id)); await cleanWork();
  });
  await t.test("Retry-After and permissions preserve eight-failure allowance; only genuine failures dead-letter", async () => {
    const w = await window(); const throttle = Object.assign(providerError(429), { retryAfterMs: 7_200_000 });
    const result = await runBackfillStepOnce({ ...deps, fetchPage: async () => { throw throttle; } }); assert.equal(result.throttled, true);
    let saved = await Window.findById(w._id).orFail(); assert.equal(saved.attempts, 0); assert.equal(+saved.retry_after_until!, +now + 7_200_000);
    await runBackfillStepOnce({ ...deps, fetchPage: async () => { assert.fail("Retry-After must prevent fetch"); } });
    const after = new Date(+now + 7_200_001);
    assert.equal((await runBackfillStepOnce({ ...deps, now: () => after, fetchPage: async () => { throw providerError(403); } })).error_code, "provider_permission_denied");
    saved = await Window.findById(w._id).orFail(); assert.equal(saved.attempts, 0); assert.equal(saved.permission_paused, true);
    await runBackfillStepOnce({ ...deps, now: () => after, fetchPage: async () => { assert.fail("permission needs explicit resume"); } });
    await plan("permission-resume"); assert.equal((await Window.findById(w._id))?.permission_paused, false);
    for (let attempt = 1; attempt <= 8; attempt++) {
      await Window.updateOne({ _id: w._id }, { $set: { retry_after_until: null } });
      const failed = await runBackfillStepOnce({ ...deps, now: () => after, fetchPage: async () => { throw new Error("synthetic transient"); } });
      assert.equal(failed.status, attempt === 8 ? "failed" : "partial");
      assert.equal((await Window.findById(w._id))?.attempts, attempt); assert.equal((await Window.findById(w._id))?.checkpoint_page, 0);
    }
    await plan("failure-resume"); assert.equal((await Window.findById(w._id))?.attempts, 0); await cleanWork();
  });

  let serial = 0;
  async function number() { return getContactNumberModel().create({ e164: `+1202555${String(++serial).padStart(4,"0")}`, digits_reversed: `proof${serial}`, first_observed_at: new Date(from), last_activity_at: new Date(from) }); }
  async function call(n: mongoose.Types.ObjectId, extra = {}) { return getCallInteractionModel().create({ provider_account_id: "synthetic", telephony_session_id: String(oid()), identity_basis: "telephony_session_id", contact_number_id: n,
    started_at: new Date("2026-09-10T10:00:00Z"), first_observed_at: now, last_observed_at: now, direction: "Inbound", terminal: true, inbound_route_id: oid(), sources: ["backfill"], parties: [], ...extra }); }
  await t.test("Mongo repairs lost activation wake-up and more than eight continuations do not consume retries", async () => {
    const w = await window({ status: "complete", activation_status: "pending", completed_at: now });
    const n = await number();
    for (let i = 0; i < 91; i++) await call(n._id, { direction: "Internal", started_at: new Date(+new Date(from) + i * 1000) });
    process.env.SALES_INTELLIGENCE_OUTREACH_ENSURE = "false";
    assert.deepEqual((await drainBackfillActivationJobs()).outcomes, ["disabled"]); assert.equal(await Jobs.countDocuments(), 0);
    process.env.SALES_INTELLIGENCE_OUTREACH_ENSURE = "true";
    const results = await drainBackfillActivationJobs(20);
    assert.ok(results.outcomes.filter(x => x === "continued").length > 8, JSON.stringify(results));
    assert.equal((await Window.findById(w._id))?.activation_status, "complete");
    const job = await Jobs.findOne({ stage: "backfill", input_refs: String(w._id) }).orFail(); assert.equal(job.status, "completed"); assert.ok(job.attempts <= 1);
    assert.equal((await runBackfillActivationJob(String(job._id))).status, "not_claimable"); await cleanWork();
  });
  await t.test("incomplete later history prevents repair scan from activating old missed calls", async () => {
    await window({ status: "partial" }); const n = await number(), c = await call(n._id);
    await withTransaction(s => ensureInteraction(c, workerContext(s, String(oid()), now)));
    assert.equal(await getOutreachRecordModel().countDocuments({ primary_contact_number_id: n._id }), 0); await cleanWork();
  });
  await t.test("historical activation waits for real attachment scans; a later callback prevents missed-call overdue", async () => {
    const w = await window({ status: "complete", activation_status: "pending", completed_at: now });
    const n = await number(), missed = await call(n._id);
    const callback = await call(n._id, { direction: "Outbound", started_at: new Date("2026-09-10T14:00:00Z"), parties: [{ role: "user", extension_id: "101", direction: "Outbound", connected: true }] });
    await withTransaction(s => enqueueCsiJob({ stage: "attachment_refresh", subject_key: `number:${n._id}`, dedupe_key: `attachment-proof:${n._id}`, input_revision: 1, input_refs: [String(missed._id)] }, s));
    await withTransaction(s => ensureInteraction(missed, workerContext(s, String(oid()), now)));
    assert.equal(await getOutreachRecordModel().countDocuments({ primary_contact_number_id: n._id }), 0);
    process.env.SALES_INTELLIGENCE_ATTACHMENT_REFRESH = "true";
    const scan = await drainAttachmentRefreshJobs(20); assert.ok(scan.outcomes.includes("completed"));
    assert.equal(await Jobs.countDocuments({ stage: "attachment_refresh", status: { $ne: "completed" } }), 0);
    await drainBackfillActivationJobs(30);
    assert.equal((await Window.findById(w._id))?.activation_status, "complete");
    const record = await getOutreachRecordModel().findOne({ primary_contact_number_id: n._id }).orFail();
    const episode = await getOutreachFollowupModel().findOne({ outreach_record_id: record._id, missed_episode_key: String(n._id) }).orFail();
    assert.equal(episode.status, "completed"); assert.equal(+episode.completed_at!, +callback.started_at);
    assert.equal(await getOutreachFollowupModel().countDocuments({ outreach_record_id: record._id, status: "open" }), 0);
    const audit = await getSalesIntelligenceAuditEventModel().findOne({ "invalidation.target_id": String(episode._id), event_kind: "missed_call_episode" }).orFail();
    assert.equal(+audit.happened_at, +missed.started_at);
  });
  async function leadFixture(extra = {}) {
    const n = await number(); const lead = { _id: oid(), timestamp: new Date(from), createdAt: new Date(from), updatedAt: new Date(from), name: "Synthetic backfill", normalized_phone_number: n.e164,
      ingested_contact_snapshot: { normalized_phone_number: n.e164, captured_at: new Date(from) }, ...extra };
    await getFormLeadModel().collection.insertOne(lead);
    await withTransaction(async s => { await ensureLead({ model: "FormLead", id: String(lead._id) }, workerContext(s, String(oid()), now), String(n._id)); await persistLeadAttachments(lead, "FormLead", s, String(oid()), now); });
    const record = await getOutreachRecordModel().findOne({ "subject.id": lead._id }).orFail(); return { n, lead, record };
  }
  await t.test("later callback fulfills an old promise before publication and audit keeps source time", async () => {
    const f = await leadFixture(); const old = await call(f.n._id);
    const later = await call(f.n._id, { direction: "Outbound", started_at: new Date("2026-09-10T14:00:00Z"), parties: [{ role: "user", extension_id: "101", direction: "Outbound", connected: true }] });
    await withTransaction(s => ensureInteraction(later, workerContext(s, String(oid()), now)));
    const run = oid(), finding = oid();
    await getIntelligenceRunModel().collection.insertOne({ _id: run, subject_key: `lead:FormLead:${f.lead._id}`, contact_number_id: f.n._id, job_id: oid() } as never);
    await getIntelligenceFindingModel().collection.insertOne({ _id: finding, run_id: run, key: "old-promise" } as never);
    const record = await getOutreachRecordModel().findById(f.record._id).orFail();
    const input = outreachEffectInputSchema.parse({ run_id: String(run), finding_id: String(finding), finding_key: "old-promise", outreach_record_id: String(record._id), interaction_id: String(old._id), expected_revision: record.revision,
      kind: "create_followup", action_kind: "call", description: "Historical callback", origin: "rep_promise", promising_agent_id: null, clear: true, history_complete: true, date: { exact: "2026-09-10T12:00:00Z" } });
    const result = await withTransaction(s => applyOutreachEffect(input, workerContext(s, String(oid()), now)));
    assert.equal(result.status, "applied"); const action = await getOutreachFollowupModel().findById(result.target_id).orFail();
    assert.equal(action.status, "completed"); assert.equal(+action.completed_at!, +later.started_at);
    assert.equal(await getOutreachFollowupModel().countDocuments({ outreach_record_id: record._id, status: "open" }), 0);
    const audit = await getSalesIntelligenceAuditEventModel().findOne({ "invalidation.target_id": String(action._id), event_kind: "intelligence_followup_created" }).orFail();
    assert.equal(+audit.happened_at, +old.started_at);
    const read = await readOutreach(String(record._id)); assert.equal(read?.data.outreach.derived.overdue, false);
  });
  for (const closure of ["booked", "cancelled"] as const) await t.test(`official ${closure} closes historical work without fresh overdue`, async () => {
    const f = await leadFixture({ [closure]: oid() }); const old = await call(f.n._id);
    await withTransaction(s => ensureInteraction(old, workerContext(s, String(oid()), now)));
    const row = await getOutreachRecordModel().findById(f.record._id).orFail(); assert.equal(row.state, "closed");
    assert.equal(await getOutreachFollowupModel().countDocuments({ outreach_record_id: row._id, status: "open" }), 0);
    const read = await readOutreach(String(row._id));
    assert.equal(read?.data.outreach.derived.overdue, false);
    assert.equal(read?.data.outreach.derived.reasons.includes("going_cold"), false);
    assert.equal(await getOutreachRecordModel().countDocuments({ "subject.kind": "number_review", primary_contact_number_id: f.n._id }), 0);
  });
});







