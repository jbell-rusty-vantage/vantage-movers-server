/**
 * LP-05 deterministic rollout rehearsal on the local csi01 replica only.
 *
 * 1. Seeds a synthetic cohort (both Lead types, every disposition, accepted and
 *    uncertain provenance, official/Owner closures, identity conflicts, the
 *    §13.4 buckets) into an isolated database and builds the pre-feature
 *    Outreach baseline with LEAD_PROGRESS off.
 * 2. With LEAD_PROGRESS on, runs `scripts/reconcile-lead-progress.ts` as the
 *    operator would: dry run, `--apply --pilot`, `--apply --resume`, and a
 *    second full apply to prove convergence.
 * 3. Activates AUTO_ATTACH on the replica and runs one attachment lap.
 * 4. Measures the repair sweep lap and writes evidence JSON + Markdown.
 *
 * Zero model calls. Never points at Atlas: the URI is hard-coded to loopback.
 *
 *   node --import tsx scripts/dev_ops/run-lp05-replica.ts
 */
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import express, { type Request } from "express";
import mongoose from "mongoose";

const DATABASE = process.env.LP05_DATABASE ?? `testvantagemovers_lp05${randomBytes(4).toString("hex")}`;
const REPLICA = "mongodb://127.0.0.1:27189/?replicaSet=csi01";
Object.assign(process.env, {
  CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: DATABASE, MONGO_URI: REPLICA,
  SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SHEET_SYNC_MODE: "disabled",
  SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_CAPTURE_CALL_LOG: "false", SALES_INTELLIGENCE_CAPTURE_WEBHOOK: "false",
  SALES_INTELLIGENCE_DIRECTORY_SYNC: "false", SALES_INTELLIGENCE_MEDIA_ENABLED: "false", SALES_INTELLIGENCE_STT_ENABLED: "false",
  SALES_INTELLIGENCE_ATTACHMENT_REFRESH: "true", SALES_INTELLIGENCE_OUTREACH_ENSURE: "true", SALES_INTELLIGENCE_AUTO_ATTACH: "false",
  SALES_INTELLIGENCE_LEAD_PROGRESS: "false", RINGCENTRAL_ACCOUNT_ID: "", CRON_SECRET: "synthetic-cron-secret",
  VANTAGE_API_SECRET: "synthetic-global", VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
});

async function main() {
  const { connectMongo, withTransaction } = await import("../../src/db");
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime");
  const { applyCsiMigration } = await import("../migrations/sales-intelligence.lib");
  const { getFormLeadModel } = await import("../../src/models/FormLead");
  const { getCallLeadModel } = await import("../../src/models/CallLead");
  const { getContactNumberModel } = await import("../../src/models/ContactNumber");
  const { getEntityChangeModel } = await import("../../src/models/EntityChange");
  const { getOutreachRecordModel } = await import("../../src/models/OutreachRecord");
  const { getNumberLeadAttachmentModel } = await import("../../src/models/NumberLeadAttachment");
  const { getSalesIntelligenceReviewItemModel } = await import("../../src/models/SalesIntelligenceReviewItem");
  const { getSalesIntelligenceSyncStateModel } = await import("../../src/models/SalesIntelligenceSyncState");
  const { getSalesIntelligenceJobModel } = await import("../../src/models/SalesIntelligenceJob");
  const { getSalesIntelligenceAuditEventModel } = await import("../../src/models/SalesIntelligenceAuditEvent");
  const { ensureLead, workerContext } = await import("../../src/services/salesIntelligence/outreach/ensure");
  const { runOutreachEnsureOnce } = await import("../../src/services/salesIntelligence/outreach/worker");
  const { runAttachmentRefreshOnce, drainAttachmentRefreshJobs } = await import("../../src/services/salesIntelligence/attachment/refresh");
  const { publishAttentionSnapshot, readAttention } = await import("../../src/services/salesIntelligence/outreach/attention");
  const { commandOutreach, createOwnerFollowup } = await import("../../src/services/salesIntelligence/followups/commands");
  const { requireCsiOwner } = await import("../../src/services/salesIntelligence/auth");
  const { computeAdminActorSignature } = await import("../../src/services/operationsRegistry/trustedActor");
  const { persistLeadAttachments } = await import("../../src/services/salesIntelligence/attachment/store");

  await connectMongo();
  if (getMongoDatabaseName() !== DATABASE) throw new Error("wrong database");
  const db = mongoose.connection.useDb(DATABASE, { useCache: true }).db!;
  if ((await db.admin().command({ hello: 1 })).setName !== "csi01") throw new Error("not the csi01 replica");
  await db.dropDatabase();
  await applyCsiMigration();
  const at = new Date("2026-09-01T12:00:00Z"), oid = () => new mongoose.Types.ObjectId();
  const request: Request = Object.assign(Object.create(express.request), { method: "POST", originalUrl: "/api/v1/admin/sales-intelligence/outreach/commands", headers: {},
    vantageAuth: { kind: "user", userId: "synthetic-owner", email: "owner@example.test", roles: ["owner"] } });
  const fields = { adminId: "synthetic-owner", email: "owner@example.test", role: "owner", timestamp: String(Date.now()), requestId: "lp05", method: request.method, path: request.originalUrl };
  request.headers = { "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role, "x-vantage-admin-timestamp": fields.timestamp,
    "x-vantage-admin-request-id": fields.requestId, "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!) };
  const actor = requireCsiOwner(request);
  type Model = "FormLead" | "CallLead";
  const Changes = getEntityChangeModel();
  let phoneSerial = 100, leadSerial = 0;
  const phone = () => `202555${String(phoneSerial++).padStart(4, "0")}`;
  const cohort: Array<{ model: Model; id: mongoose.Types.ObjectId; tag: string }> = [];
  async function lead(model: Model, tag: string, extra: Record<string, unknown> = {}, options: { priority?: string | null; quoted?: boolean; accepted?: boolean; source?: "granot" | "vantage" } = {}) {
    const _id = oid(), digits = (extra.normalized_phone_number as string | undefined) ?? phone();
    const doc = { _id, timestamp: new Date(+at + leadSerial++ * 60_000), createdAt: at, updatedAt: at, name: `Synthetic ${tag} ${leadSerial}`, normalized_phone_number: digits,
      source_company: extra.source_company ?? "Top10", quoted: options.quoted ?? false, ...(options.priority !== undefined ? { granot_priority: options.priority } : {}), domain_revision: 0, ...extra };
    await (model === "FormLead" ? getFormLeadModel() : getCallLeadModel()).collection.insertOne(doc as never);
    if (options.accepted && (options.priority !== undefined || options.quoted !== undefined)) {
      const patch: Record<string, unknown> = {}; if (options.priority !== undefined) patch.granot_priority = options.priority; if (options.quoted !== undefined) patch.quoted = options.quoted;
      await Changes.collection.insertOne({ entity: { model, id: String(_id) }, command_execution_id: oid(), command_name: "synchronizeLeadFromGranot",
        provenance: { source_system: options.source ?? "granot", actor: { actor_type: "system", actor_id: "seed" }, initiator: { actor_type: "system", actor_id: "seed" }, request_id: String(oid()), observation_id: oid(), decision_id: oid() },
        changed_paths: Object.keys(patch).sort(), fields: Object.entries(patch).map(([path, after]) => ({ path, value_mode: "stored", before: null, after })), revision_before: 0, revision_after: 1, applied_at: new Date(+at + 3_600_000) } as never);
      await (model === "FormLead" ? getFormLeadModel() : getCallLeadModel()).collection.updateOne({ _id }, { $set: { domain_revision: 1 } });
    }
    cohort.push({ model, id: _id, tag });
    return { model, id: String(_id), _id, digits };
  }
  async function number(digits: string) {
    const e164 = `+1${digits}`;
    return getContactNumberModel().create({ e164, national_ten: digits, digits_reversed: digits.split("").reverse().join(""), first_observed_at: at, last_activity_at: at, kind: "external" });
  }
  const seed: Record<string, number> = {};
  const many = async (n: number, fn: () => Promise<unknown>, key: string) => { for (let i = 0; i < n; i++) await fn(); seed[key] = (seed[key] ?? 0) + n; };
  // --- Lead cohort ---
  await many(30, () => lead("FormLead", "unworked"), "form_unworked_no_priority");
  await many(10, () => lead("FormLead", "quoted_history", {}, { quoted: true }), "form_quoted_true_no_change_history");
  await many(10, () => lead("FormLead", "p1", {}, { priority: "1", quoted: true, accepted: true }), "form_priority_1_accepted");
  await many(5, () => lead("FormLead", "p3", {}, { priority: "3", accepted: true }), "form_priority_3_accepted");
  await many(5, () => lead("FormLead", "p1_uncertain", {}, { priority: "1" }), "form_priority_1_uncertain_provenance");
  await many(8, () => lead("FormLead", "p8", {}, { priority: "8", quoted: true, accepted: true }), "form_priority_8_accepted");
  await many(6, () => lead("FormLead", "p7", {}, { priority: "7", accepted: true }), "form_priority_7_accepted");
  await many(4, () => lead("FormLead", "p8_uncertain", {}, { priority: "8" }), "form_priority_8_uncertain_provenance");
  await many(3, () => lead("FormLead", "p5", {}, { priority: "5", quoted: true, accepted: true }), "form_priority_5_quoted_accepted");
  await many(3, () => lead("FormLead", "p9", {}, { priority: "9", accepted: true }), "form_priority_9_accepted");
  await many(2, () => lead("FormLead", "p0", {}, { priority: "0", accepted: true }), "form_priority_0_accepted");
  await many(4, () => lead("FormLead", "booked_flag", { booked: oid() }, { priority: "1", accepted: true }), "form_booked_by_mirror");
  const bookedRowOnly: Array<{ model: Model; _id: mongoose.Types.ObjectId }> = [];
  await many(2, async () => { const l = await lead("FormLead", "booked_row_only", {}, { priority: "1", accepted: true }); bookedRowOnly.push(l); await db.collection("booked_leads").insertOne({ _id: oid(), lead_model: "FormLead", lead_ref: l._id, job_no: `J${leadSerial}`, createdAt: at }); }, "form_booked_by_booked_leads_row_only");
  await many(3, () => lead("FormLead", "duplicate", { duplicate: true }, { priority: "1", accepted: true }), "form_duplicate");
  await many(3, () => lead("FormLead", "bad", { bad_lead: "disconnected" }, { priority: "1", accepted: true }), "form_bad_lead");
  await many(1, () => lead("FormLead", "no_sync", { no_sync: true }, { priority: "1", accepted: true }), "form_no_sync");
  const ownerClosed: Array<{ model: Model; _id: mongoose.Types.ObjectId }> = [];
  await many(2, async () => ownerClosed.push(await lead("FormLead", "owner_closed", {}, { priority: "1", accepted: true })), "form_owner_closed_then_priority_1");
  const alreadyOpen: Array<{ model: Model; _id: mongoose.Types.ObjectId }> = [];
  await many(2, async () => alreadyOpen.push(await lead("FormLead", "already_open", {}, { priority: "1", accepted: true })), "form_already_open_with_call_evidence");
  const withActions: Array<{ model: Model; _id: mongoose.Types.ObjectId }> = [];
  await many(2, async () => withActions.push(await lead("FormLead", "p8_with_actions", {}, { priority: "8", accepted: true })), "form_priority_8_with_open_followups");
  await many(15, () => lead("CallLead", "unworked"), "call_unworked_no_priority");
  await many(5, () => lead("CallLead", "p1", {}, { priority: "1", quoted: true, accepted: true }), "call_priority_1_accepted");
  await many(3, () => lead("CallLead", "p8", {}, { priority: "8", accepted: true }), "call_priority_8_accepted");
  await many(2, () => lead("CallLead", "p7_uncertain", {}, { priority: "7" }), "call_priority_7_uncertain_provenance");
  await many(3, () => lead("CallLead", "p3", {}, { priority: "3", accepted: true }), "call_priority_3_accepted");
  await many(2, () => lead("CallLead", "booked_flag", { booked: oid() }), "call_booked_by_mirror");
  // --- Number identity cohort (§5, §13.4) ---
  const numbers: Array<{ id: mongoose.Types.ObjectId; tag: string }> = [];
  for (let i = 0; i < 3; i++) { const l = await lead("FormLead", "sole_form"); numbers.push({ id: (await number(l.digits))._id, tag: "sole_form" }); }
  for (let i = 0; i < 3; i++) { const l = await lead("CallLead", "sole_call"); numbers.push({ id: (await number(l.digits))._id, tag: "sole_call" }); }
  for (let i = 0; i < 4; i++) { const d = phone(); await lead("FormLead", "form_of_pair", { normalized_phone_number: d }); await lead("CallLead", "call_of_pair", { normalized_phone_number: d }); numbers.push({ id: (await number(d))._id, tag: "one_form_one_call" }); }
  for (let i = 0; i < 3; i++) { const d = phone(); await lead("FormLead", "span_a", { normalized_phone_number: d, source_company: "Top10" }); await lead("FormLead", "span_b", { normalized_phone_number: d, source_company: "TBM" }); numbers.push({ id: (await number(d))._id, tag: "spans_source_companies" }); }
  for (let i = 0; i < 2; i++) { const d = phone(); await lead("FormLead", "dup_target", { normalized_phone_number: d }); await lead("FormLead", "dup_competitor", { normalized_phone_number: d, duplicate: true }); numbers.push({ id: (await number(d))._id, tag: "duplicate_competitor_does_not_block" }); }
  for (let i = 0; i < 2; i++) { const d = phone(); await lead("FormLead", "good_target", { normalized_phone_number: d }); await lead("FormLead", "bad_competitor", { normalized_phone_number: d, bad_lead: "bad_contact" }); numbers.push({ id: (await number(d))._id, tag: "bad_lead_competitor_blocks" }); }
  const protectedPairs: Array<{ numberId: mongoose.Types.ObjectId; leadId: mongoose.Types.ObjectId }> = [];
  for (let i = 0; i < 2; i++) { const l = await lead("FormLead", "protected"); const n = await number(l.digits); protectedPairs.push({ numberId: n._id, leadId: l._id }); numbers.push({ id: n._id, tag: "protected_owner_rejection" }); }
  for (let i = 0; i < 3; i++) numbers.push({ id: (await number(phone()))._id, tag: "no_lead" });
  seed.numbers = numbers.length;
  // --- Pre-feature baseline: Outreach as production has it today (flag off), plus Owner decisions and call evidence ---
  const Records = getOutreachRecordModel();
  for (const item of cohort) await withTransaction(s => ensureLead({ model: item.model, id: String(item.id) }, workerContext(s, String(oid()), at)));
  for (const p of protectedPairs) await getNumberLeadAttachmentModel().create({ contact_number_id: p.numberId, lead_ref: { model: "FormLead", id: p.leadId }, state: "rejected", certainty: "rejected", decided_at: at, decided_by: "synthetic-owner", decision_reason: "Owner rejected", evidence: [] });
  for (const l of ownerClosed) { const r = await Records.findOne({ "subject.id": l._id }).orFail(); await commandOutreach({ actor, target_id: String(r._id), idempotency_key: String(oid()), command: { command: "close", expected_revision: r.revision, reason: "not_sales" } }); }
  for (const l of alreadyOpen) await Records.updateOne({ "subject.id": l._id }, { $set: { state: "open", first_attributable_outbound_at: new Date(+at + 7_200_000) } });
  for (const l of withActions) await withTransaction(async s => { const r = await Records.findOne({ "subject.id": l._id }).session(s).orFail(); await createOwnerFollowup(r, { kind: "call", description: "Promised callback", due_at: new Date(+at + 86_400_000).toISOString() }, workerContext(s, String(oid()), at)); });
  const before = await publishAttentionSnapshot();
  const distribution = async () => { const page = await readAttention({ limit: 200 }); const bands: Record<string, number> = {}, reasons: Record<string, number> = {};
    for (const row of page.data.items) { const key = String(row.derived.attention_band ?? "review_only"); bands[key] = (bands[key] ?? 0) + 1; for (const reason of row.derived.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1; }
    return { total_items: page.data.total_items, bands, reasons }; };
  const baseline = await distribution();
  const closures = async () => Records.aggregate([{ $group: { _id: { state: "$state", origin: "$closure_origin", reason: "$closed_reason" }, n: { $sum: 1 } } }, { $sort: { n: -1 } }]);
  const reviews = async () => getSalesIntelligenceReviewItemModel().aggregate([{ $group: { _id: { kind: "$cause_kind", state: "$state" }, n: { $sum: 1 } } }]);
  const evidence: Record<string, unknown> = { database: DATABASE, seed, baseline: { publish: before, distribution: baseline, closures: await closures() } };
  // --- Feature on: operator runs ---
  process.env.SALES_INTELLIGENCE_LEAD_PROGRESS = "true";
  const run = (label: string, args: string[]) => {
    const started = Date.now();
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/reconcile-lead-progress.ts", ...args], { env: process.env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const lines = result.stdout.split("\n").filter(Boolean);
    const finished = lines.map(line => { try { return JSON.parse(line); } catch { return null; } }).find(row => row?.phase === "finished");
    if (result.status !== 0) console.error(result.stderr.slice(-4000));
    return { label, args, exit: result.status, ms: Date.now() - started, finished, stderr_tail: result.status === 0 ? null : result.stderr.slice(-2000) };
  };
  const dryRun = run("dry_run", []);
  const pilot = run("pilot", ["--apply", "--pilot=20"]);
  const full = run("full_resume", ["--apply", "--resume"]);
  const again = run("converge", ["--apply", "--resume"]);
  evidence.runs = { dryRun, pilot, full, again };
  evidence.after = { distribution: await distribution(), closures: await closures(), reviews: await reviews(), audit_lead_progress_updated: await getSalesIntelligenceAuditEventModel().countDocuments({ event_kind: "lead_progress_updated" }) };
  // Second full apply must converge: no record revision changes.
  const revisionsBefore = new Map((await Records.find({}).select({ revision: 1 }).lean()).map(r => [String(r._id), r.revision]));
  const converge = run("converge_2", ["--apply", "--resume"]);
  const revisionsAfter = new Map((await Records.find({}).select({ revision: 1 }).lean()).map(r => [String(r._id), r.revision]));
  evidence.convergence = { run: converge, records: revisionsBefore.size, changed_revisions: [...revisionsAfter].filter(([id, rev]) => revisionsBefore.get(id) !== rev).length };
  // Owner decisions preserved: owner-closed stays owner-closed; protected rejection untouched; booked_leads row closed as booked.
  evidence.protected = {
    owner_closed: await Promise.all(ownerClosed.map(async l => { const r = await Records.findOne({ "subject.id": l._id }).lean(); return { state: r?.state, origin: r?.closure_origin, disposition: r?.lead_progress?.disposition }; })),
    booked_row_only: await Promise.all(bookedRowOnly.map(async l => { const r = await Records.findOne({ "subject.id": l._id }).lean(); return { state: r?.state, reason: r?.closed_reason, origin: r?.closure_origin }; })),
    already_open_kept: await Promise.all(alreadyOpen.map(async l => (await Records.findOne({ "subject.id": l._id }).lean())?.state)),
    p8_actions: await Promise.all(withActions.map(async l => { const r = await Records.findOne({ "subject.id": l._id }).lean(); const actions = await (await import("../../src/models/OutreachFollowup")).getOutreachFollowupModel().find({ outreach_record_id: r?._id }).lean(); return { state: r?.state, reason: r?.closed_reason, actions: actions.map(a => ({ status: a.status, cancel_reason: a.cancel_reason, completed_at: a.completed_at })) }; })),
    protected_pairs: await Promise.all(protectedPairs.map(async p => (await getNumberLeadAttachmentModel().findOne({ contact_number_id: p.numberId, "lead_ref.id": p.leadId }).lean())?.state)),
  };
  // --- Auto-attach activation on the replica (LP-05): one attachment lap for every Lead, then a Number lap ---
  process.env.SALES_INTELLIGENCE_AUTO_ATTACH = "true";
  const attachStart = Date.now();
  for (const item of cohort) {
    const doc = await (item.model === "FormLead" ? getFormLeadModel() : getCallLeadModel()).findById(item.id).lean();
    if (doc) await withTransaction(s => persistLeadAttachments(doc as never, item.model, s, String(oid()), new Date()));
  }
  await runAttachmentRefreshOnce(); await drainAttachmentRefreshJobs(100);
  evidence.auto_attach = { ms: Date.now() - attachStart,
    edges: await getNumberLeadAttachmentModel().aggregate([{ $group: { _id: { state: "$state", certainty: "$certainty", reason: "$decision_reason" }, n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    by_number_tag: await Promise.all(numbers.map(async n => ({ tag: n.tag, edges: (await getNumberLeadAttachmentModel().find({ contact_number_id: n.id }).lean()).map(e => `${e.lead_ref.model}:${e.state}:${e.decision_reason ?? "-"}`) }))),
    identity_reviews: await getSalesIntelligenceReviewItemModel().countDocuments({ cause_kind: "identity" }) };
  // --- Repair sweep lap (H3/H7): sweeps until the Lead cursors wrap once ---
  const State = getSalesIntelligenceSyncStateModel();
  await State.deleteMany({ scope: { $in: ["outreach_repair:FormLead", "outreach_repair:CallLead"] } });
  const lapStart = Date.now(); let laps = 0;
  for (;;) { laps++; await runOutreachEnsureOnce({ deadline: Date.now() + 60_000 }); const form = await State.findOne({ scope: "outreach_repair:FormLead" }).lean(); const call = await State.findOne({ scope: "outreach_repair:CallLead" }).lean();
    if ((!form?.cursor?.attachment_source_id && !call?.cursor?.attachment_source_id) || laps > 50) break; }
  evidence.repair_lap = { leads: cohort.length, sweeps: laps, ms: Date.now() - lapStart, page: 50, jobs_total: await getSalesIntelligenceJobModel().countDocuments({ stage: "outreach_ensure" }) };
  evidence.final = { publish: await publishAttentionSnapshot(), distribution: await distribution(), closures: await closures(), reviews: await reviews() };
  await mkdir("scripts/dev_ops/output", { recursive: true });
  const file = `scripts/dev_ops/output/lp05-replica-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await writeFile(file, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ phase: "done", file, database: DATABASE }));
  await mongoose.disconnect();
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
