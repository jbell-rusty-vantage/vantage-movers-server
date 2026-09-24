/**
 * S6-P5 replica proofs (assignment addendum §2, C1/C2; reconciliation §4.2 C22 and §5 for the S10-4 script),
 * on the csi01 replica in a disposable `testvantagemovers_t3dp5<hex>` database, with ATTENTION_V2,
 * ATTENTION_EVOLUTION, CASE_FILE, PROGRESS_PLAN, MOVE_ASSESSMENT, LEAD_PROGRESS and PRIORITY5_CLOSURE on.
 * Fixed clock: every ensure runs at an explicit ET instant. No job consumer runs: a job row is only counted.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import express, { type Request } from "express";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getCallLeadModel } from "../../src/models/CallLead";
import { getEntityChangeModel } from "../../src/models/EntityChange";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { getSalesIntelligenceAuditEventModel } from "../../src/models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceReviewItemModel } from "../../src/models/SalesIntelligenceReviewItem";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { requireCsiOwner } from "../../src/services/salesIntelligence/auth";
import { computeAdminActorSignature } from "../../src/services/operationsRegistry/trustedActor";
import { ensureLead, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { commandOutreach } from "../../src/services/salesIntelligence/followups/commands";
import { readOutreach } from "../../src/services/salesIntelligence/outreach/reads";
import { publishAttentionSnapshot, readAttention } from "../../src/services/salesIntelligence/outreach/attention";
import { writeFileSync } from "node:fs";
import { newP5Manifest, priority5Report, runPriority5Reconcile, type P5Manifest } from "./lib/priority5-reconcile";
import type { CsiCommand } from "../../src/validation/v1/salesIntelligence";

const ET = (local: string) => new Date(`${local}:00${local >= "2026-11-01T02:00" ? "-05:00" : "-04:00"}`);
const MON_09 = ET("2026-09-21T09:00"), TUE_10 = ET("2026-09-22T10:00"), TUE_11 = ET("2026-09-22T11:00"), WED_10 = ET("2026-09-23T10:00"), WED_14 = ET("2026-09-23T14:00");
const WRITE_METHODS = /^(insert|update|replace|delete|findOneAndUpdate|findOneAndReplace|findOneAndDelete|findAndModify|bulkWrite|createIndex|drop|rename|save|create)/i;

test("S6-P5 Priority 5 closure replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 600000 }, async t => {
  assert.match(getMongoDatabaseName(), /^testvantagemovers_t3dp5[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  for (const flag of ["LEAD_PROGRESS", "PRIORITY5_CLOSURE", "ATTENTION_EVOLUTION", "CASE_FILE", "PROGRESS_PLAN"]) assert.equal(process.env[`SALES_INTELLIGENCE_${flag}`], "true", flag);
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await applyCsiMigration();
  const oid = () => new mongoose.Types.ObjectId();
  const request: Request = Object.assign(Object.create(express.request), { method: "POST", originalUrl: "/api/v1/admin/sales-intelligence/outreach/commands", headers: {},
    vantageAuth: { kind: "user", userId: "synthetic-owner", email: "owner@example.test", roles: ["owner"] } });
  const fields = { adminId: "synthetic-owner", email: "owner@example.test", role: "owner", timestamp: String(Date.now()), requestId: "t3dp5-proof", method: request.method, path: request.originalUrl };
  request.headers = { "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role, "x-vantage-admin-timestamp": fields.timestamp,
    "x-vantage-admin-request-id": fields.requestId, "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!) };
  const actor = requireCsiOwner(request), Records = getOutreachRecordModel(), Actions = getOutreachFollowupModel(), Jobs = getSalesIntelligenceJobModel();
  const Reviews = getSalesIntelligenceReviewItemModel(), Audit = getSalesIntelligenceAuditEventModel();
  type Model = "FormLead" | "CallLead";
  type Ref = { model: Model; id: string; _id: mongoose.Types.ObjectId };
  let serial = 0;
  const revisions = new Map<string, number>();
  const leads = (model: Model) => (model === "FormLead" ? getFormLeadModel() : getCallLeadModel()).collection;
  async function lead(model: Model = "FormLead", extra: Record<string, unknown> = {}): Promise<Ref> {
    const _id = oid();
    await leads(model).insertOne({ _id, timestamp: MON_09, createdAt: MON_09, updatedAt: MON_09, name: `Synthetic P5 ${++serial}`, normalized_phone_number: `120255577${String(serial).padStart(2, "0")}`,
      quoted: false, domain_revision: 0, ...extra } as never);
    return { model, id: String(_id), _id };
  }
  /** An accepted Granot write: canonical value plus the EntityChange the lifecycle command appends. */
  async function accept(ref: Ref, patch: { granot_priority?: string | null; quoted?: boolean }, appliedAt: Date, skipChange = false) {
    const before = await leads(ref.model).findOne({ _id: ref._id });
    const revision = (revisions.get(ref.id) ?? 0) + 1; revisions.set(ref.id, revision);
    await leads(ref.model).updateOne({ _id: ref._id }, { $set: { ...patch, domain_revision: revision } });
    if (skipChange) return null;
    const change = await getEntityChangeModel().collection.insertOne({ entity: { model: ref.model, id: ref.id }, command_execution_id: oid(), command_name: "synchronizeLeadFromGranot",
      provenance: { source_system: "granot", actor: { actor_type: "system", actor_id: "test" }, initiator: { actor_type: "system", actor_id: "test" }, request_id: String(oid()), observation_id: oid(), decision_id: oid() },
      changed_paths: Object.keys(patch).sort(), fields: Object.entries(patch).map(([path, after]) => ({ path, value_mode: "stored", before: before?.[path] ?? null, after })),
      revision_before: revision - 1, revision_after: revision, applied_at: appliedAt } as never);
    return String(change.insertedId);
  }
  const ensure = (ref: Ref, at: Date, changeId: string | null = null) =>
    withTransaction(s => ensureLead({ model: ref.model, id: ref.id }, workerContext(s, String(oid()), at), undefined, { changeId }));
  const record = (ref: Ref) => Records.findOne({ "subject.model": ref.model, "subject.id": ref._id }).lean().orFail();
  const key = (ref: Ref) => `lead:${ref.model}:${ref.id}`;
  const defaults = (recordId: mongoose.Types.ObjectId) => Actions.find({ outreach_record_id: recordId, default_kind: { $type: "string" } }).lean();
  const modelJobs = async () => ({
    // An Owner command's own refresh (`csi:owner-outreach:`) is Owner intent, not an automatic step (as in Team 4's K29).
    number_refresh: await Jobs.countDocuments({ stage: "number_refresh", dedupe_key: { $not: /^csi:owner-outreach:/ } }), analysis: await Jobs.countDocuments({ stage: { $in: ["analysis", "application"] } }),
    move_assessment: await Jobs.countDocuments({ stage: "move_assessment" }), transcription: await Jobs.countDocuments({ stage: "transcription" }) });
  const command = (target: unknown, body: CsiCommand) => commandOutreach({ actor, target_id: String(target), command: body, idempotency_key: String(oid()) });
  const zero = await modelJobs();

  await t.test("C1 + C22: an accepted 5 closes as granot_booked (crm_disposition) with zero model jobs and no default_kind action", async () => {
    const f = await lead();
    await ensure(f, MON_09);
    await ensure(f, TUE_10, await accept(f, { granot_priority: "5", quoted: true }, TUE_10));
    const r = await record(f);
    assert.equal(r.state, "closed"); assert.equal(r.closure_origin, "crm_disposition"); assert.equal(r.closed_reason, "granot_booked");
    assert.equal(+r.closed_at!, +TUE_10, "fixed clock");
    assert.equal(r.lead_progress?.disposition, "crm_booked"); assert.equal(r.lead_progress?.provenance, "accepted"); assert.equal(r.lead_progress?.quoted, true);
    assert.equal((await defaults(r._id)).length, 0, "G8: no quote default although Granot set quoted");
    assert.deepEqual(await modelJobs(), zero, "zero model/paid jobs");
    const read = await readOutreach(String(r._id));
    assert.deepEqual(read?.data.outreach.lead_progress?.closure, { basis: "granot_booked", closed_at: TUE_10.toISOString() });
    assert.equal(read?.data.outreach.lead_progress?.priority_label, "Booked in Granot");
    assert.equal(read?.data.outreach.allowed_actions.find(a => a.action === "reopen")?.enabled, false, "reversible only through the reopen review or an override");
    assert.equal(read?.data.outreach.allowed_actions.find(a => a.action === "override_disposition")?.enabled, true);
    // Closed view: outcome granot_booked with the Priority label; the metrics tile ignores it.
    assert.equal((await publishAttentionSnapshot()).status, "published");
    const closed = await readAttention({ view: "closed", outcome: "granot_booked", limit: 200 });
    const row = closed.data.items.find(item => item.subject_key === key(f));
    assert.equal(row?.outcome?.reason, "granot_booked"); assert.deepEqual(row?.outcome?.priority, { code: "5", label: "Booked in Granot" });
    assert.equal(row?.filter_keys?.outcome, "granot_booked");
    assert.ok(closed.data.metrics); assert.equal(closed.data.metrics.booked_7d, 0, "booked_7d stays official-only");
    // Redelivery writes nothing.
    const revision = r.revision;
    await ensure(f, WED_10, null);
    assert.equal((await record(f)).revision, revision);
  });

  await t.test("C1: an uncertain 5 opens a disposition_review and stays active; nothing is cancelled", async () => {
    const f = await lead("CallLead");
    await ensure(f, MON_09);
    await Actions.create({ outreach_record_id: (await record(f))._id, commitment_key: `p5:${oid()}`, kind: "call", description: "Call back", origin: "owner",
      date_resolution: { precision: "unresolved", timezone: "America/New_York", anchor: MON_09, policy_version: "csi-policy-v1" } });
    await accept(f, { granot_priority: "5" }, TUE_10, true);
    await ensure(f, TUE_10);
    const r = await record(f);
    assert.notEqual(r.state, "closed"); assert.equal(r.lead_progress?.disposition, "crm_booked"); assert.equal(r.lead_progress?.provenance, "uncertain");
    const review = await Reviews.findOne({ subject_key: key(f), cause_kind: "disposition_review" }).lean();
    assert.equal(review?.state, "open");
    assert.equal(await Actions.countDocuments({ outreach_record_id: r._id, status: "open" }), 1, "cancels nothing");
    assert.deepEqual(await modelJobs(), zero);
  });

  await t.test("C1 + C22: 5 → 1 opens one reopen review, stays closed, creates no default; Owner reopen creates no contact by itself", async () => {
    const f = await lead();
    await ensure(f, MON_09);
    await ensure(f, TUE_10, await accept(f, { granot_priority: "5", quoted: true }, TUE_10));
    const change = await accept(f, { granot_priority: "1" }, TUE_11);
    await ensure(f, TUE_11, change); await ensure(f, WED_10, change);
    let r = await record(f);
    assert.equal(r.state, "closed"); assert.equal(r.closed_reason, "granot_booked"); assert.equal(+r.closed_at!, +TUE_10);
    const reviews = await Reviews.find({ subject_key: key(f), cause_kind: "disposition_reopen" }).lean();
    assert.equal(reviews.length, 1); assert.equal(reviews[0]!.state, "open"); assert.equal(String(r.lead_progress?.reopen_review_id), String(reviews[0]!._id));
    assert.equal((await defaults(r._id)).length, 0, "no default while the reopen review is open");
    await command(r._id, { command: "reopen", expected_revision: r.revision, reason: "Granot moved it back to quoted" });
    r = await record(f);
    assert.equal(r.state, "open"); assert.equal(r.closure_origin, null);
    assert.equal((await Reviews.findById(reviews[0]!._id).lean())?.state, "resolved");
    await ensure(f, WED_14, change);
    assert.equal((await defaults(r._id)).length, 0, "Lead progress §3.3: an Owner reopen creates no callback; the same revision never creates a default later");
    assert.deepEqual(await modelJobs(), zero);
  });

  await t.test("C22: 1 → 5 cancels the open quote default through the closure", async () => {
    const f = await lead();
    await ensure(f, MON_09);
    await ensure(f, TUE_10, await accept(f, { granot_priority: "1", quoted: true }, TUE_10));
    const [open] = await defaults((await record(f))._id);
    assert.equal(open?.status, "open"); assert.equal(open?.default_kind, "quote_followup");
    await ensure(f, WED_10, await accept(f, { granot_priority: "5" }, WED_10));
    const r = await record(f);
    assert.equal(r.state, "closed"); assert.equal(r.closed_reason, "granot_booked");
    const [cancelled] = await defaults(r._id);
    assert.equal(cancelled?.status, "cancelled"); assert.equal(cancelled?.cancel_reason, "granot_booked");
    assert.deepEqual(await modelJobs(), zero);
  });

  await t.test("5 ↔ 7 ↔ 8 refreshes closed_reason and keeps closed_at and the closure history", async () => {
    const f = await lead();
    await ensure(f, MON_09);
    await ensure(f, TUE_10, await accept(f, { granot_priority: "5" }, TUE_10));
    for (const [code, reason, at] of [["7", "granot_bad_unusable", TUE_11], ["8", "granot_dead_opportunity", WED_10], ["5", "granot_booked", WED_14]] as const) {
      await ensure(f, at, await accept(f, { granot_priority: code }, at));
      const r = await record(f);
      assert.equal(r.state, "closed"); assert.equal(r.closure_origin, "crm_disposition"); assert.equal(r.closed_reason, reason, `code ${code}`); assert.equal(+r.closed_at!, +TUE_10);
    }
    assert.equal(await Audit.countDocuments({ subject_key: key(f), event_kind: "outreach_closed" }), 1, "one closure; the refreshes are lead_progress_updated");
    assert.ok(await Audit.countDocuments({ subject_key: key(f), event_kind: "lead_progress_updated" }) >= 3);
    assert.deepEqual(await modelJobs(), zero);
  });

  await t.test("C2: the exact Booking upgrades granot_booked to official booked, keeping closed_at; a phone-only Booking never does; cancelled works as today", async () => {
    const f = await lead();
    await ensure(f, MON_09);
    await ensure(f, TUE_10, await accept(f, { granot_priority: "5" }, TUE_10));
    // Phone-only: a Booking on the same phone but another (or no) Lead reference.
    const phoneOnly = await lead();
    await ensure(phoneOnly, MON_09);
    await ensure(phoneOnly, TUE_10, await accept(phoneOnly, { granot_priority: "5" }, TUE_10));
    const phone = (await leads("FormLead").findOne({ _id: phoneOnly._id }))!.normalized_phone_number;
    await db.collection("booked_leads").insertOne({ _id: oid(), lead_model: "FormLead", lead_ref: oid(), normalized_phone_number: phone, job_no: "P5-PHONE", createdAt: TUE_10 });
    await db.collection("booked_leads").insertOne({ _id: oid(), phone_number: phone, job_no: "P5-NOLEAD", createdAt: TUE_10 });
    await ensure(phoneOnly, WED_10);
    const still = await record(phoneOnly);
    assert.equal(still.closure_origin, "crm_disposition"); assert.equal(still.closed_reason, "granot_booked");
    // Exact.
    const jobsBefore = await Jobs.countDocuments({ stage: "number_refresh" });
    await db.collection("booked_leads").insertOne({ _id: oid(), lead_model: "FormLead", lead_ref: f._id, job_no: "P5-EXACT", book_date: WED_10, createdAt: WED_10 });
    await ensure(f, WED_14);
    const r = await record(f);
    assert.equal(r.state, "closed"); assert.equal(r.closure_origin, "official"); assert.equal(r.closed_reason, "booked");
    assert.equal(+r.closed_at!, +TUE_10, "the original closed_at is kept");
    const audit = await Audit.findOne({ subject_key: key(f), event_kind: "outreach_closed" }).sort({ _id: -1 }).lean();
    assert.equal((audit?.current as { upgraded_from?: string }).upgraded_from, "granot_booked");
    assert.equal(await Jobs.countDocuments({ stage: "number_refresh" }), jobsBefore + 1, "the usual official-closure number_refresh (never consumed here)");
    assert.ok(await Jobs.exists({ stage: "number_refresh", dedupe_key: `csi:outreach-closure:${r._id}:${r.revision}` }));
    await ensure(f, WED_14);
    assert.equal(await Jobs.countDocuments({ stage: "number_refresh" }), jobsBefore + 1, "re-ensure is a no-op");
    // Cancelled after granot_booked: today's official closure (closed_at is the cancellation's ensure time).
    const c = await lead();
    await ensure(c, MON_09);
    await ensure(c, TUE_10, await accept(c, { granot_priority: "5" }, TUE_10));
    await db.collection("booked_leads").insertOne({ _id: oid(), lead_model: "FormLead", lead_ref: c._id, job_no: "P5-CANC", cancelled: true, createdAt: WED_10 });
    await ensure(c, WED_14);
    const rc = await record(c);
    assert.equal(rc.closure_origin, "official"); assert.equal(rc.closed_reason, "cancelled"); assert.equal(+rc.closed_at!, +WED_14);
    const cAudit = await Audit.findOne({ subject_key: key(c), event_kind: "outreach_closed" }).sort({ _id: -1 }).lean();
    assert.equal((cAudit?.current as { upgraded_from?: string }).upgraded_from, undefined);
    Object.assign(zero, await modelJobs());
  });

  await t.test("flag off: 5 keeps today's mapping (unmapped; a quoted 5 opens by Quoted work, never closes)", async () => {
    process.env.SALES_INTELLIGENCE_PRIORITY5_CLOSURE = "false";
    try {
      const f = await lead();
      await ensure(f, MON_09);
      await ensure(f, TUE_10, await accept(f, { granot_priority: "5", quoted: true }, TUE_10));
      const r = await record(f);
      assert.equal(r.state, "open"); assert.equal(r.closure_origin, null); assert.equal(r.lead_progress?.disposition, "unmapped"); assert.equal(r.lead_progress?.provenance, "accepted");
      assert.equal(await Reviews.countDocuments({ subject_key: key(f) }), 0);
      assert.equal((await defaults(r._id)).length, 0, "unmapped is not quoted: no default, as today");
    } finally { process.env.SALES_INTELLIGENCE_PRIORITY5_CLOSURE = "true"; }
    assert.deepEqual(await modelJobs(), zero);
  });

  await t.test("S10-4 reconcile: dry run is write-free; apply closes, upgrades with the number_refresh held; re-apply is a no-op; zero claimable paid jobs", async () => {
    // Records as they stand before activation: projected with the flag off.
    process.env.SALES_INTELLIGENCE_PRIORITY5_CLOSURE = "false";
    const accepted = await lead(), uncertain = await lead("CallLead"), upgrade = await lead();
    try {
      await ensure(accepted, MON_09); await ensure(uncertain, MON_09); await ensure(upgrade, MON_09);
      await ensure(accepted, TUE_10, await accept(accepted, { granot_priority: "5", quoted: true }, TUE_10));
      await accept(uncertain, { granot_priority: "5" }, TUE_10, true); await ensure(uncertain, TUE_10);
      assert.equal((await record(accepted)).state, "open"); assert.notEqual((await record(uncertain)).state, "closed");
    } finally { process.env.SALES_INTELLIGENCE_PRIORITY5_CLOSURE = "true"; }
    // One record already closed granot_booked whose exact Booking arrived without an ensure since.
    await ensure(upgrade, TUE_10, await accept(upgrade, { granot_priority: "5" }, TUE_10));
    await db.collection("booked_leads").insertOne({ _id: oid(), lead_model: "FormLead", lead_ref: upgrade._id, job_no: "P5-RECON", book_date: WED_10, createdAt: WED_10 });
    const jsonl: string[] = [];
    const seams = (m: { saved: P5Manifest | null }) => ({ now: () => WED_14, save: async (manifest: P5Manifest) => { m.saved = JSON.parse(JSON.stringify(manifest)); }, log: async (event: string, f: Record<string, unknown> = {}) => { jsonl.push(JSON.stringify({ event, ...f })); } });

    // Dry run: op log and dbHash.
    const ops: string[] = [];
    mongoose.set("debug", (collection: string, method: string) => { ops.push(`${collection}.${method}`); });
    const hashBefore = await db.command({ dbHash: 1 });
    const dryState = { saved: null as P5Manifest | null };
    const dry = await runPriority5Reconcile({ apply: false, page: 2 }, newP5Manifest(getMongoDatabaseName(), false, WED_14), seams(dryState));
    mongoose.set("debug", false);
    const hashAfter = await db.command({ dbHash: 1 });
    const writes = ops.filter(op => WRITE_METHODS.test(op.split(".").at(-1)!));
    assert.deepEqual(writes, [], `dry run issued only reads (${ops.length} ops)`);
    assert.equal(hashAfter.md5, hashBefore.md5, "dbHash identical before/after the dry run");
    assert.ok(dry.finished_at && dryState.saved?.cursor.phase === "done", "the dry run finished and checkpointed");
    console.log(JSON.stringify({ s10_4_dry_run: dry.counts, ops: ops.length, jobs_before: dry.jobs_before, jobs_after: dry.jobs_after }));
    assert.equal(dry.counts.would_close_granot_booked, 2, "this test's and the flag-off subtest's accepted 5, projected before activation");
    assert.equal(dry.counts.uncertain_would_open_review_stays_active, 2, "this test's uncertain 5 and the C1 uncertain 5");
    assert.equal(dry.counts.would_upgrade_to_booked, 1);
    assert.equal(dry.counts.open_actions_would_cancel, 0);
    assert.ok((dry.counts.already_granot_booked ?? 0) >= 3, "earlier subtests' closures are already done");
    assert.deepEqual(dry.jobs_after, dry.jobs_before);
    // T3D_P5_REPORT_DIR=<dir>: the replica dry run and apply reports (S10-4-replica*.md), as the entry point writes them.
    const reportDir = process.env.T3D_P5_REPORT_DIR, reportFlags = { PRIORITY5_CLOSURE: true, LEAD_PROGRESS: true, OUTREACH_ENSURE: true, PROGRESS_PLAN: true, ATTENTION_EVOLUTION: true };
    const header = `> Replica proof (\`test-si-priority5.ts\`): ${ops.length} Mongo ops, ${writes.length} write commands; dbHash ${hashBefore.md5} before = ${hashAfter.md5} after.

`;
    if (reportDir) writeFileSync(`${reportDir}/S10-4-replica.md`, header + priority5Report(dry, "replica", reportFlags));

    // Apply.
    const applyState = { saved: null as P5Manifest | null };
    const applied = await runPriority5Reconcile({ apply: true, page: 2 }, newP5Manifest(getMongoDatabaseName(), true, WED_14), seams(applyState));
    console.log(JSON.stringify({ s10_4_apply: applied.counts, holds: applied.holds, jobs_before: applied.jobs_before, jobs_after: applied.jobs_after }));
    assert.equal(applied.counts.uncertain_review_opened, 1, "the pre-activation uncertain 5 is re-projected and gets its review");
    assert.equal(applied.counts.closed_granot_booked, 2); assert.equal(applied.counts.upgraded_to_booked, 1); assert.equal(applied.counts.held_number_refresh, 1);
    const a = await record(accepted);
    assert.equal(a.state, "closed"); assert.equal(a.closed_reason, "granot_booked"); assert.equal(+a.closed_at!, +WED_14);
    const u = await record(upgrade);
    assert.equal(u.closure_origin, "official"); assert.equal(u.closed_reason, "booked"); assert.equal(+u.closed_at!, +TUE_10);
    assert.notEqual((await record(uncertain)).state, "closed");
    assert.equal((await Reviews.findOne({ subject_key: key(uncertain), cause_kind: "disposition_review" }).lean())?.state, "open");
    const held = await Jobs.findById(applied.holds[0]!.job_id).lean();
    assert.equal(held?.status, "paused"); assert.equal(held?.reason, "operator_hold"); assert.equal(held?.stage, "number_refresh");
    for (const stage of ["number_refresh", "analysis", "application", "move_assessment", "transcription"]) assert.equal(applied.jobs_after![stage], applied.jobs_before![stage], `no claimable ${stage}`);
    assert.equal(applied.jobs_after!.operator_hold, applied.jobs_before!.operator_hold + 1);
    assert.ok(jsonl.some(line => line.includes('"event":"candidate"')));
    if (reportDir) writeFileSync(`${reportDir}/S10-4-replica-apply.md`, priority5Report(applied, "replica", reportFlags));

    // Re-apply: a no-op (dbHash identical apart from nothing; no new job, no new audit row).
    const auditsBefore = await Audit.countDocuments({});
    const reHashBefore = await db.command({ dbHash: 1 });
    const again = await runPriority5Reconcile({ apply: true, page: 2 }, newP5Manifest(getMongoDatabaseName(), true, WED_14), seams({ saved: null }));
    const reHashAfter = await db.command({ dbHash: 1 });
    console.log(JSON.stringify({ s10_4_reapply: again.counts }));
    assert.equal(reHashAfter.md5, reHashBefore.md5, "re-apply writes nothing");
    assert.equal(await Audit.countDocuments({}), auditsBefore);
    assert.equal(again.counts.closed_granot_booked, undefined); assert.equal(again.counts.upgraded_to_booked, undefined); assert.equal(again.holds.length, 0);
    assert.equal(again.counts.unchanged, again.processed);

    // Resume: a manifest cut after the first page continues where it stopped.
    const partial = newP5Manifest(getMongoDatabaseName(), false, WED_14);
    await runPriority5Reconcile({ apply: false, page: 2, limit: 2 }, partial, seams({ saved: null }));
    assert.equal(partial.processed, 2); assert.equal(partial.finished_at, null);
    await runPriority5Reconcile({ apply: false, page: 2 }, partial, seams({ saved: null }));
    assert.equal(partial.processed, dry.processed, "resumed to the end over the same candidates");
    assert.equal(partial.counts.already_granot_booked, (dry.counts.already_granot_booked ?? 0) + 2, "counts accumulate across the resume (the reconcile's two closures are now done)");
    assert.ok(partial.finished_at);
  });
});
