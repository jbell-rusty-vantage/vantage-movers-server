import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getCallLeadModel } from "../../src/models/CallLead";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { csiDataset } from "../../src/config/domain/salesIntelligence";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { getLeadConversationModel } from "../../src/models/LeadConversation";
import { getIntelligenceRunModel } from "../../src/models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../../src/models/IntelligenceFinding";
import { getMoveAssessmentArtifactModel } from "../../src/models/MoveAssessmentArtifact";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceAiReservationModel } from "../../src/models/SalesIntelligenceAiReservation";
import { getSalesIntelligenceAiBudgetModel } from "../../src/models/SalesIntelligenceAiBudget";
import { initializeCsiBudgetPeriod, resumeBudgetPausedJobs } from "../../src/services/salesIntelligence/aiBudget";
import type { BackfillManifest } from "../../src/services/salesIntelligence/assessment/backfill";
import { BackfillRefusal, executeBackfill, isLocalDatabase, parseBackfillArgs, type BackfillSeams } from "../backfill-csi-move-assessment";
import {
  MARK, mockAssessmentModel, seedLead, seedNumber, seedRecord, seedSummaryConversation, defaultAssessment, type LeadModel,
} from "./csi-move-assessment-fixtures";

const MODEL = "openai/gpt-5-mini";
const PERSONAL = "synthetic-personal-value", COMPANY = "synthetic-company-key";
const oid = (value: string) => new mongoose.Types.ObjectId(value);

test("MA-03 assessment-only backfill: inventory, shadow canary, caps, resume, promotion and cost evidence on the csi01 replica", {
  skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 600_000,
}, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(getMongoDatabaseName(), /^testvantagemovers_mabf[a-f0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  assert.equal(process.env.SALES_INTELLIGENCE_MOVE_ASSESSMENT, "false", "the backfill runs with the live flag off (force)");
  await connectMongo();
  const database = getMongoDatabaseName();
  const db = mongoose.connection.useDb(database, { useCache: true }).db!;
  const manifests = Object.fromEntries(["inventory", "main", "second", "budget", "failing", "leadonly"].map(name =>
    [name, `scripts/dev_ops/output/mabf-proof-${database}-${name}.json`])) as Record<string, string>;
  t.after(async () => {
    for (const path of Object.values(manifests)) await rm(path, { force: true });
    await db.dropDatabase(); await mongoose.disconnect();
  });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("External traffic forbidden in the Move assessment backfill replica proof"); });
  const now = new Date(), month = now.toISOString().slice(0, 7);
  await initializeCsiBudgetPeriod({ month, policy_version: "csi-policy-v1", timezone: "UTC", ceiling_cents: 8000,
    period_start: new Date(`${month}-01T00:00:00Z`), period_end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) });

  const Records = getOutreachRecordModel(), Artifacts = getMoveAssessmentArtifactModel(), Jobs = getSalesIntelligenceJobModel();
  const Reservations = getSalesIntelligenceAiReservationModel();
  const at = (day: number) => new Date(`2026-09-${String(day).padStart(2, "0")}T15:00:00Z`);
  const phones: string[] = [];
  const logs: string[] = [];
  const fastForward: BackfillSeams["waitForRetry"] = async jobId => {
    await Jobs.collection.updateOne({ _id: oid(jobId) }, { $set: { next_attempt_at: new Date(Date.now() - 1000) } });
    return true;
  };
  const cli = (args: string[], seams: BackfillSeams = {}) => executeBackfill(args, { log: line => logs.push(line), waitForRetry: fastForward, ...seams });
  const paid = (mode: "--shadow" | "--apply", manifest: string, extra: string[] = []) => [mode, "--manifest", manifest, "--model", MODEL, "--confirm-write", ...extra];
  const caps = (subjects: number, cents: number, attempts: number) =>
    ["--max-subjects", String(subjects), "--max-total-cents", String(cents), "--max-attempts-per-subject", String(attempts)];
  const readManifest = async (path: string) => JSON.parse(await readFile(path, "utf8")) as BackfillManifest;
  const setKeys = (personal: string, company = "") => { process.env.PERSONAL_AI_GATEWAY_API_KEY = personal; process.env.AI_GATEWAY_API_KEY = company; };

  // ── Fixtures ──────────────────────────────────────────────────────────
  type Subject = { key: string; record: string; lead: { model: LeadModel; id: string; _id: mongoose.Types.ObjectId }; number: string };
  const subject = async (model: LeadModel, fields: Record<string, unknown> = {}): Promise<Subject> => {
    const number = await seedNumber();
    phones.push(number.national_ten!);
    const lead = await seedLead(model, number.national_ten!, fields);
    return { key: `lead:${model}:${lead.id}`, record: await seedRecord(lead, String(number._id)), lead, number: String(number._id) };
  };
  const structured = (s: Subject, day: number, overview: string) => seedSummaryConversation(s.number, at(day), { overview, money_and_dates: "Target date October 15." },
    [{ claim: "We are moving in October" }]);
  // The shared fixture's legacy seeder holds one run per database (unique job_id); these seed several.
  let serial = 0;
  const bareConversation = async (s: Subject, when: Date, summary: Record<string, unknown> | null) => {
    const key = `mabf-${++serial}-${Date.now()}`;
    const call = await getCallInteractionModel().create({ provider_account_id: "synthetic", telephony_session_id: key, identity_basis: "telephony_session_id",
      contact_number_id: s.number, direction: "Inbound", started_at: when, first_observed_at: when, last_observed_at: when, terminal: true,
      inbound_route_id: "a".repeat(24), parties: [], recordings: [{ provider_recording_id: key, observed_at: when }] });
    return getLeadConversationModel().create({ provider: "ringcentral", provider_account_id: "synthetic", provider_recording_id: key,
      call_interaction_id: call._id, contact_number_id: s.number, started_at: when, direction: "Inbound", match_method: "number_only",
      match_confidence: "low", state: "transcribed", latest_transcript_version: `mabf-v${serial}`, media_digest_sha256: "b".repeat(64), summary });
  };
  /** A conversation with only a retained completed legacy (pre-structured) run. */
  const legacy = async (s: Subject, day: number, overview: string) => {
    const row = await bareConversation(s, at(day), null);
    await getIntelligenceRunModel().collection.insertOne({ _id: new mongoose.Types.ObjectId(), job_id: new mongoose.Types.ObjectId(), ...csiDataset(),
      conversation_id: row._id, contact_number_id: oid(s.number), subject_key: `conversation:${row._id}`, status: "completed", completed_at: at(day),
      analysis_pipeline: null, purged_at: null, purge_started_at: null,
      output: { schema_version: "csi-envelope-v1", summary: { overview, customer_wanted: "", money_and_dates: "", outcome: "Will call back.", commitments: "",
        discrepancies: "", finding_keys: [] }, findings: [], next_step_suggestion: null, owner_instruction_assessments: [] } } as never);
  };
  /** A conversation whose only retained summary is `LeadConversation.summary` (with model/prompt provenance). */
  const conversationSummary = async (s: Subject, day: number, overview: string) => {
    await bareConversation(s, at(day), { sections: { overview, customer_wanted: "A local move quote." }, text: overview,
      model: "legacy-summary-model", prompt_version: "legacy-v1", created_at: at(day) });
  };
  const s1 = await subject("FormLead", { pickup_city: "Miami", pickup_state: "FL", delivery_city: "Austin", delivery_state: "TX", move_date: new Date("2026-10-15T00:00:00Z"),
    ingestion_origin: "wordpress_form", ingested_move_snapshot: { pickup_city: "Miami", pickup_state: "FL", delivery_city: "Dallas", delivery_state: "TX",
      move_date: new Date("2026-10-01T00:00:00Z"), captured_at: at(1), evidence_status: "captured_at_ingestion" } });
  await structured(s1, 10, `${MARK.segment} Customer is planning a two-bedroom move to Austin.`);
  const purged = await structured(s1, 11, "Purged call.");
  await getLeadConversationModel().collection.updateOne({ _id: purged.conversation._id }, { $set: { content_purged_at: new Date() } });
  const s2 = await subject("CallLead", { pickup_city: "Denver", pickup_state: "CO" }); await legacy(s2, 11, "Legacy: asked about a local move.");
  const s3 = await subject("FormLead", { pickup_city: "Reno", pickup_state: "NV" }); await conversationSummary(s3, 12, "Customer wants a studio move.");
  const s4 = await subject("CallLead", { pickup_city: "Omaha", pickup_state: "NE" }); await structured(s4, 13, "Three-bedroom quote request.");
  const s5 = await subject("FormLead", { pickup_city: "Boise", pickup_state: "ID" }); await legacy(s5, 14, "Legacy: moving in December.");
  const s6 = await subject("CallLead", { pickup_city: "Tulsa", pickup_state: "OK" }); await conversationSummary(s6, 15, "Customer compared two quotes.");
  const s7 = await subject("FormLead", { pickup_city: "Salem", pickup_state: "OR", move_date: new Date("2026-11-01T00:00:00Z") }); await structured(s7, 16, "Customer booked a survey.");
  const leadOnly = await subject("FormLead", { pickup_city: "Tampa", pickup_state: "FL", delivery_city: "Atlanta", delivery_state: "GA", move_size: "Studio" });
  const review = await subject("CallLead"); await structured(review, 8, "Unclear who called.");
  await Records.collection.updateOne({ _id: oid(review.record) }, { $set: { state: "identity_review", state_before_identity_review: "unworked" } });
  const closed = await subject("FormLead"); await structured(closed, 9, "Another company has the job.");
  await Records.collection.updateOne({ _id: oid(closed.record) }, { $set: { state: "closed", closure_origin: "crm_disposition", closed_reason: "granot_dead_opportunity", closed_at: now } });
  const summaryKeys = [s1, s2, s3, s4, s5, s6, s7].map(s => s.key);

  // Provider-facing stages: net-new transcription, summary/findings analysis, application or media work must stay zero.
  const PROVIDER_STAGES = ["recording_discovery", "media", "media_fetch", "transcription", "analysis", "application", "number_refresh"];
  const stageCounts = async () => Object.fromEntries(await Promise.all(PROVIDER_STAGES.map(async stage => [stage, await Jobs.countDocuments({ stage })])));
  const domain = async () => ({ runs: await getIntelligenceRunModel().countDocuments(), findings: await getIntelligenceFindingModel().countDocuments(),
    followups: await getOutreachFollowupModel().countDocuments(), stages: await stageCounts() });
  const baseline = await domain();
  const digest = async () => {
    const names = (await db.listCollections().toArray()).map(c => c.name).sort();
    const hash = createHash("sha256");
    for (const name of names) hash.update(name).update(JSON.stringify(await db.collection(name).find({}).sort({ _id: 1 }).toArray()));
    return hash.digest("hex");
  };
  const noSecrets = (text: string, label: string) => {
    assert.equal(text.includes(PERSONAL), false, `${label}: no key value`);
    assert.equal(text.includes(COMPANY), false, `${label}: no company key value`);
    assert.equal(text.includes(MARK.segment), false, `${label}: no transcript/summary narrative`);
    assert.equal(text.includes(MARK.rationale), false, `${label}: no model rationale`);
    for (const phone of phones) assert.equal(text.includes(phone), false, `${label}: no phone number`);
  };

  await t.test("CLI refuses structurally: modes, manifest location, local database", () => {
    assert.throws(() => parseBackfillArgs(["--shadow", "--apply"]), BackfillRefusal);
    assert.throws(() => parseBackfillArgs(["--concurrency", "5"]), BackfillRefusal);
    assert.equal(parseBackfillArgs([]).mode, "inventory");
    assert.equal(isLocalDatabase(database, process.env.MONGO_URI), true);
    assert.equal(isLocalDatabase("vantagemovers", process.env.MONGO_URI), false);
    assert.equal(isLocalDatabase(database, "mongodb+srv://cluster.example.net/"), false);
  });

  await t.test("inventory is read-only: collection digests unchanged and zero model calls", async () => {
    const mock = await mockAssessmentModel();
    const before = await digest();
    const { inventory } = await cli(["--inventory", "--model", MODEL, "--out", manifests.inventory], { model: mock.model });
    assert.equal(await digest(), before, "no collection changed");
    assert.equal(mock.calls(), 0);
    assert.ok(inventory);
    assert.deepEqual({ summary: inventory.outcomes.eligible_summary, lead_only: inventory.outcomes.eligible_lead_only, ambiguous: inventory.outcomes.ambiguous_subject },
      { summary: 7, lead_only: 1, ambiguous: 1 });
    assert.equal(inventory.scanned, 9, "the closed record is not an open subject");
    assert.equal(inventory.ambiguous_identities, 1);
    assert.deepEqual(inventory.summary_kinds, { structured: 3, legacy: 2, conversation_summary: 2 });
    assert.deepEqual({ retained: inventory.sources.retained, purged: inventory.sources.purged }, { retained: 7, purged: 1 });
    assert.deepEqual(inventory.missing_original_evidence, { form_leads: 5, missing: 4, by_label: { absent: 4 } });
    assert.equal(inventory.estimate.basis, "list_pricing");
    assert.equal(inventory.estimate.summary.subjects, 7);
    assert.equal(inventory.estimate.lead_only.subjects, 1);
    assert.ok(inventory.estimate.summary.input_bytes > 0 && inventory.estimate.summary.input_tokens > 0 && inventory.estimate.summary.cents >= 7);
    noSecrets(await readFile(manifests.inventory, "utf8"), "inventory file");
    noSecrets(logs.join("\n"), "inventory stdout");
  });

  await t.test("a missing personal key fails before any reservation or job, even with a company key present", async () => {
    const before = { reservations: await Reservations.countDocuments(), jobs: await Jobs.countDocuments({ stage: "move_assessment" }) };
    setKeys("", COMPANY);
    try {
      await assert.rejects(cli(paid("--shadow", manifests.main, caps(5, 500, 2))), (error: unknown) =>
        error instanceof BackfillRefusal && /PERSONAL_AI_GATEWAY_API_KEY/.test(error.message));
      setKeys("   ", COMPANY);
      await assert.rejects(cli(paid("--shadow", manifests.main, caps(5, 500, 2))), BackfillRefusal, "whitespace is empty");
      setKeys(PERSONAL, COMPANY);
      await assert.rejects(cli(paid("--shadow", manifests.main, ["--max-subjects", "5", "--max-total-cents", "500"])), /max-attempts-per-subject/);
      await assert.rejects(cli(["--shadow", "--manifest", manifests.main, ...caps(5, 500, 2), "--model", MODEL]), /confirm-write/);
      await assert.rejects(cli(paid("--shadow", "manifest.json", caps(5, 500, 2))), /scripts\/dev_ops\/output/);
    } finally { setKeys(""); }
    assert.deepEqual({ reservations: await Reservations.countDocuments(), jobs: await Jobs.countDocuments({ stage: "move_assessment" }) }, before);
    await assert.rejects(readFile(manifests.main, "utf8"), "no manifest written");
  });

  let main: BackfillManifest;
  await t.test("shadow canary: 7 candidates, max_subjects 5 → 5 admitted, 2 deferred, shadow artifacts only, personal credential everywhere", async () => {
    const mock = await mockAssessmentModel();
    setKeys(PERSONAL, COMPANY);
    try {
      await cli(paid("--shadow", manifests.main, [...caps(5, 500, 2), "--concurrency", "2"]), { model: mock.model });
      assert.equal(process.env.AI_GATEWAY_API_KEY, "", "the runner cleared the company key before the runtime ran");
    } finally { setKeys(""); }
    main = await readManifest(manifests.main);
    assert.equal(main.rows.length, 5);
    assert.equal(main.selection.deferred.length, 2);
    assert.equal(main.selection.candidates, 7);
    assert.deepEqual(new Set([...main.rows.map(r => r.subject_key), ...main.selection.deferred.map(d => d.subject_key)]), new Set(summaryKeys));
    assert.ok(main.rows.every(r => r.canary && r.status === "completed" && r.shadow_artifact_id && r.attempts === 1 && r.usage_complete), JSON.stringify(main.rows.map(r => [r.status, r.reason])));
    assert.equal(mock.calls(), 5);
    assert.deepEqual([main.counters.subjects_admitted, main.counters.attempts_total, main.counters.provider_calls, main.counters.retries], [5, 5, 5, 0]);
    const artifacts = await Artifacts.find({ _id: { $in: main.rows.map(r => oid(r.shadow_artifact_id!)) } }).lean();
    assert.equal(artifacts.length, 5);
    assert.ok(artifacts.every(a => a.shadow === true && a.status === "ready" && a.usage?.credential === "PERSONAL_AI_GATEWAY_API_KEY"));
    assert.equal(await Artifacts.countDocuments({ shadow: false }), 0);
    assert.equal(await Records.countDocuments({ move_assessment: { $ne: null } }), 0, "shadow never publishes");
    const reservations = await Reservations.find({ step: { $regex: "^assessment:" } }).lean();
    assert.equal(reservations.length, 5);
    assert.ok(reservations.every(r => /:PERSONAL_AI_GATEWAY_API_KEY:/.test(r.step) && r.status === "reconciled" && r.usage_complete));
    assert.equal(main.counters.cents_actual, reservations.reduce((sum, r) => sum + (r.actual_cents ?? 0), 0));
    assert.equal(main.counters.cents_reserved, main.counters.cents_actual, "complete usage charges actual cents");
    const jobs = await Jobs.find({ stage: "move_assessment" }).lean();
    assert.ok(jobs.every(job => job.priority === -100 && job.dedupe_key.endsWith(`:backfill:${main.manifest_id}:shadow`)));
    const stored = JSON.stringify([artifacts.map(a => a.usage), reservations, jobs]);
    assert.equal(stored.includes(PERSONAL) || stored.includes(COMPANY), false, "no key value stored");
    noSecrets(await readFile(manifests.main, "utf8"), "manifest");
    const report = JSON.parse(logs.findLast(line => line.startsWith("{\"report\""))!).report;
    assert.deepEqual(report.outcomes, { completed: 5 });
    assert.equal(report.deferred, 2);
    assert.ok(report.reimbursement.includes("credential: PERSONAL_AI_GATEWAY_API_KEY"));
    noSecrets(logs.join("\n"), "stdout");
    // Resume: completed rows are never re-run.
    const again = await mockAssessmentModel();
    setKeys(PERSONAL);
    try { await cli(paid("--shadow", manifests.main, [...caps(5, 500, 2), "--resume"]), { model: again.model }); } finally { setKeys(""); }
    assert.equal(again.calls(), 0);
    const resumed = await readManifest(manifests.main);
    assert.deepEqual(resumed.counters, main.counters, "counters unchanged by a no-op resume");
    assert.deepEqual(resumed.runs.map(r => r.mode), ["shadow", "shadow"]);
    main = resumed;
  });

  await t.test("promotion publishes 5 projections with zero model calls and no new reservations", async () => {
    const mock = await mockAssessmentModel();
    const reservations = await Reservations.countDocuments();
    await cli(["--promote", "--manifest", manifests.main, "--resume", "--confirm-write"], { model: mock.model });
    assert.equal(mock.calls(), 0);
    assert.equal(await Reservations.countDocuments(), reservations);
    const promoted = await readManifest(manifests.main);
    assert.ok(promoted.rows.every(r => r.status === "published" && r.reason === "promoted" && r.artifact_id), JSON.stringify(promoted.rows.map(r => [r.status, r.reason])));
    assert.equal(promoted.counters.promoted, 5);
    for (const row of promoted.rows) {
      const record = await Records.findById(row.outreach_record_id).orFail().lean();
      assert.equal(String(record.move_assessment?.artifact_id), row.artifact_id);
      const live = await Artifacts.findById(row.artifact_id).orFail().lean();
      const shadow = await Artifacts.findById(row.shadow_artifact_id).orFail().lean();
      assert.equal(live.shadow, false);
      assert.equal(live.input_fingerprint, shadow.input_fingerprint);
      assert.deepEqual(live.scores, shadow.scores, "the accepted body is reused, not regenerated");
      assert.equal(live.usage?.attempts, 0);
      assert.equal(record.move_assessment?.move_likelihood, 75);
    }
    // Idempotent: a second promotion changes nothing.
    await cli(["--promote", "--manifest", manifests.main, "--resume", "--confirm-write"], { model: mock.model });
    assert.deepEqual((await readManifest(manifests.main)).counters, promoted.counters);
    assert.equal(mock.calls(), 0);
  });

  await t.test("a changed Lead field between shadow and promotion is stale_input and is not published; apply regenerates it against the same caps", async () => {
    const deferred = main.selection.deferred.map(d => d.subject_key);
    const mock = await mockAssessmentModel();
    setKeys(PERSONAL);
    try { await cli(paid("--shadow", manifests.second, [...caps(2, 100, 2), "--subject-keys", deferred.join(",")]), { model: mock.model }); } finally { setKeys(""); }
    assert.equal(mock.calls(), 2);
    const shadowed = await readManifest(manifests.second);
    const changed = shadowed.rows[0], unchanged = shadowed.rows[1];
    const lead = [s1, s2, s3, s4, s5, s6, s7].find(s => s.key === changed.subject_key)!;
    assert.equal(lead.lead.model === "FormLead" || lead.lead.model === "CallLead", true);
    await (lead.lead.model === "FormLead" ? getFormLeadModel() : getCallLeadModel()).collection
      .updateOne({ _id: lead.lead._id }, { $set: { move_date: new Date("2026-12-24T00:00:00Z") } });
    await cli(["--promote", "--manifest", manifests.second, "--resume", "--confirm-write"], { model: mock.model });
    const promoted = await readManifest(manifests.second);
    const [stale, published] = [promoted.rows.find(r => r.subject_key === changed.subject_key)!, promoted.rows.find(r => r.subject_key === unchanged.subject_key)!];
    assert.deepEqual([stale.status, stale.reason], ["stale_input", "input_changed"]);
    assert.deepEqual([published.status, published.reason], ["published", "promoted"]);
    assert.equal((await Records.findById(stale.outreach_record_id).orFail().lean()).move_assessment, null, "stale shadow data is never published");
    assert.equal(mock.calls(), 2, "promotion made no call");
    // Apply: the changed subject is a new candidate, generated once more and counted against the same manifest caps.
    setKeys(PERSONAL);
    try { await cli(paid("--apply", manifests.second, [...caps(2, 100, 2), "--resume"]), { model: mock.model }); } finally { setKeys(""); }
    const applied = await readManifest(manifests.second);
    const regenerated = applied.rows.find(r => r.subject_key === changed.subject_key)!;
    assert.equal(regenerated.status, "published", JSON.stringify(regenerated));
    assert.equal(mock.calls(), 3);
    assert.deepEqual([applied.counters.subjects_admitted, applied.counters.attempts_total, applied.counters.promoted], [2, 3, 1]);
    assert.ok(applied.counters.cents_reserved >= promoted.counters.cents_reserved);
    assert.equal(String((await Records.findById(regenerated.outreach_record_id).orFail().lean()).move_assessment?.artifact_id), regenerated.artifact_id);
  });

  await t.test("max_total_cents pauses admission mid-run; budget exhaustion pauses the job; resume continues the same work without re-running completed rows", async () => {
    const budget = [await subject("FormLead", { pickup_city: "Provo", pickup_state: "UT" }), await subject("CallLead", { pickup_city: "Waco", pickup_state: "TX" }),
      await subject("FormLead", { pickup_city: "Ogden", pickup_state: "UT" })];
    for (const [index, s] of budget.entries()) await structured(s, 17 + index, `Budget subject ${index}.`);
    const keys = ["--subject-keys", budget.map(s => s.key).join(","), "--hold-cents", "5", "--concurrency", "1"];
    const mock = await mockAssessmentModel();
    setKeys(PERSONAL);
    try { await cli(paid("--apply", manifests.budget, [...caps(3, 8, 2), ...keys]), { model: mock.model }); } finally { setKeys(""); }
    const first = await readManifest(manifests.budget);
    assert.equal(mock.calls(), 2, "2 cents charged per complete attempt; a third 5-cent hold would exceed 8");
    assert.deepEqual(first.rows.map(r => r.status).sort(), ["planned", "published", "published"]);
    assert.equal(first.halt?.reason, "max_total_cents");
    assert.deepEqual([first.counters.subjects_admitted, first.counters.cents_reserved, first.counters.cents_actual], [2, 4, 4]);
    assert.ok(first.rows.every(r => r.hold_cents === 0));
    // Monthly ledger exhausted: the runtime pauses the job before any reservation; the pause is visible in the manifest.
    const Budget = getSalesIntelligenceAiBudgetModel();
    const row = await Budget.findOne({ month }).orFail().lean();
    await Budget.collection.updateOne({ month }, { $set: { ceiling_cents: row.actual_cents + row.reserved_cents } });
    setKeys(PERSONAL);
    try { await cli(paid("--apply", manifests.budget, [...caps(3, 20, 2), ...keys, "--resume"]), { model: mock.model }); } finally { setKeys(""); }
    const paused = await readManifest(manifests.budget);
    const pending = paused.rows.find(r => r.status !== "published")!;
    assert.deepEqual([pending.status, pending.reason], ["paused", "budget_exhausted"]);
    assert.equal(paused.halt?.reason, "paused:budget_exhausted");
    assert.deepEqual(paused.cap_changes.map(c => [c.field, c.from, c.to]), [["max_total_cents", 8, 20]]);
    assert.equal(mock.calls(), 2);
    const job = await Jobs.findById(pending.jobs.apply).orFail().lean();
    assert.deepEqual([job.status, job.reason], ["paused", "budget_exhausted"]);
    // Headroom returns: the system releases the same job and the resume runs it.
    await Budget.collection.updateOne({ month }, { $set: { ceiling_cents: 8000 } });
    await resumeBudgetPausedJobs();
    setKeys(PERSONAL);
    try { await cli(paid("--apply", manifests.budget, [...caps(3, 20, 2), ...keys, "--resume"]), { model: mock.model }); } finally { setKeys(""); }
    const done = await readManifest(manifests.budget);
    assert.equal(mock.calls(), 3, "only the paused subject ran again");
    assert.ok(done.rows.every(r => r.status === "published"), JSON.stringify(done.rows.map(r => [r.status, r.reason])));
    assert.equal(done.rows.find(r => r.subject_key === pending.subject_key)!.jobs.apply, pending.jobs.apply, "the same durable job");
    assert.equal(done.halt, null);
    for (const key of Object.keys(first.counters) as Array<keyof BackfillManifest["counters"]>) {
      assert.ok(paused.counters[key] >= first.counters[key] && done.counters[key] >= paused.counters[key], `counter ${key} never decreases`);
    }
    assert.deepEqual([done.counters.subjects_admitted, done.counters.attempts_total, done.counters.retries], [3, 4, 1]);
  });

  await t.test("max_attempts_per_subject: a failing subject stops after its cap, holds incomplete usage, and the cap persists across resume", async () => {
    const failing = await subject("CallLead", { pickup_city: "Fargo", pickup_state: "ND" });
    await structured(failing, 20, "FAIL-MARKER provider refuses this subject.");
    const mock = await mockAssessmentModel(payload =>
      JSON.stringify(payload).includes("FAIL-MARKER") ? new Error("Synthetic provider failure") : defaultAssessment(payload));
    const args = paid("--shadow", manifests.failing, [...caps(1, 50, 2), "--subject-keys", failing.key, "--hold-cents", "3"]);
    setKeys(PERSONAL);
    try { await cli(args, { model: mock.model }); } finally { setKeys(""); }
    const first = await readManifest(manifests.failing);
    const row = first.rows[0];
    assert.equal(mock.calls(), 2);
    assert.deepEqual([row.status, row.reason, row.attempts, row.provider_calls], ["failed", "assessment_failed:max_attempts_per_subject", 2, 2]);
    assert.equal(row.usage_complete, false);
    assert.deepEqual([first.counters.retries, first.counters.incomplete_attempts, first.counters.cents_reserved, first.counters.cents_incomplete], [1, 2, 6, 6],
      "failed provider attempts stay reserved at the hold");
    assert.equal(first.halt?.reason, "failure");
    setKeys(PERSONAL);
    try { await cli([...args, "--resume"], { model: mock.model }); } finally { setKeys(""); }
    const resumed = await readManifest(manifests.failing);
    assert.equal(mock.calls(), 2, "no third attempt after resume");
    assert.equal(resumed.counters.attempts_total, 2);
    assert.equal(resumed.rows[0].reason, "max_attempts_per_subject");
    const reservations = await Reservations.find({ job_id: oid(row.jobs.shadow!) }).lean();
    assert.equal(reservations.length, 2);
    assert.ok(reservations.every(r => r.status === "reconciled" && !r.usage_complete && /:PERSONAL_AI_GATEWAY_API_KEY:/.test(r.step)));
  });

  await t.test("Lead-only cohort: separate manifest and cost line, never part of the summary cohort", async () => {
    assert.ok(!main.rows.some(r => r.subject_key === leadOnly.key) && !main.selection.deferred.some(d => d.subject_key === leadOnly.key));
    await assert.rejects(cli(["--promote", "--manifest", manifests.main, "--resume", "--confirm-write", "--lead-only-cohort"]), /cohort differs/);
    const mock = await mockAssessmentModel();
    setKeys(PERSONAL);
    try { await cli(paid("--shadow", manifests.leadonly, [...caps(5, 50, 2), "--lead-only-cohort"]), { model: mock.model }); } finally { setKeys(""); }
    const manifest = await readManifest(manifests.leadonly);
    assert.equal(manifest.cohort, "lead_only");
    assert.match(manifest.manifest_id, /^mabf-lo-/);
    assert.deepEqual(manifest.rows.map(r => [r.subject_key, r.status, r.stratum]), [[leadOnly.key, "completed", "FormLead:lead_only"]]);
    assert.equal(mock.calls(), 1);
    assert.equal(mock.payloads[0].subject.no_conversation_evidence, true);
    const artifact = await Artifacts.findById(manifest.rows[0].shadow_artifact_id).orFail().lean();
    assert.deepEqual([artifact.input_mode, artifact.shadow, artifact.usage?.credential], ["lead_only", true, "PERSONAL_AI_GATEWAY_API_KEY"]);
    const report = JSON.parse(logs.findLast(line => line.startsWith("{\"report\""))!).report;
    assert.equal(report.cohort, "lead_only");
    assert.ok(report.reimbursement[0].includes("(cohort lead_only)"));
  });

  await t.test("zero net-new summary/transcription/findings work; every assessment reservation is personal and reconciled", async () => {
    assert.deepEqual(await domain(), baseline, "no IntelligenceRun/Finding/Followup and no non-assessment job created");
    const rows = await Reservations.find({}).lean();
    assert.ok(rows.length >= 11);
    assert.ok(rows.every(r => r.step.startsWith("assessment:") && /:PERSONAL_AI_GATEWAY_API_KEY:/.test(r.step) && r.status === "reconciled"));
    const budget = await getSalesIntelligenceAiBudgetModel().findOne({ month }).orFail().lean();
    assert.equal(budget.reserved_cents, 0, "no stranded hold");
    const jobs = await Jobs.find({ stage: "move_assessment" }).lean();
    assert.ok(jobs.every(job => job.priority === -100), "backfill priority below live work");
    noSecrets(logs.join("\n"), "all stdout");
  });
});
