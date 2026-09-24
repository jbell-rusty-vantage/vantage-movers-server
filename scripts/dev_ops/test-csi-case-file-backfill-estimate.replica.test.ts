/**
 * AC7-BACKFILL (Attention and Case File spec §10): `backfill-csi-context-refresh.ts --layout case_file --estimate`
 * on the csi01 replica. Proves the arithmetic on a fixed fixture and that the estimate writes nothing
 * (Mongo op log = reads only; dbHash identical; no manifest file).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { csiDataset } from "../../src/config/domain/salesIntelligence";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getLeadConversationModel } from "../../src/models/LeadConversation";
import { getIntelligenceEvidenceSnapshotModel } from "../../src/models/IntelligenceEvidenceSnapshot";
import { getIntelligenceRunModel } from "../../src/models/IntelligenceRun";
import { getSalesIntelligenceAiReservationModel } from "../../src/models/SalesIntelligenceAiReservation";
// The script first: it loads the analysis worker graph in the order the runtime does (structuredPrompt alone hits an import cycle).
import { CASE_FILE_FINDINGS_PROMPT_VERSION, CASE_FILE_SUMMARY_PROMPT_VERSION, estimateCaseFileBackfill, summaryCacheKey } from "./backfill-csi-context-refresh";
import { STRUCTURED_PIPELINE, SUMMARY_PROMPT_VERSION } from "../../src/services/salesIntelligence/analysis/structuredPrompt";

const WRITE_METHODS = /^(insert|update|replace|delete|findOneAndUpdate|findOneAndReplace|findOneAndDelete|findAndModify|bulkWrite|createIndex|drop|rename)/i;
const MODEL = "openai/gpt-5.6-luna";
const oid = () => new mongoose.Types.ObjectId();

test("AC7-BACKFILL --estimate: cohort, re-summaries and projected cost; writes nothing", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 120_000 }, async (t) => {
  assert.match(getMongoDatabaseName(), /^testvantagemovers_t4cbf[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await applyCsiMigration()).ready, true);
  const dataset = csiDataset(), at = new Date("2026-09-17T14:04:00Z");
  const numbers = getContactNumberModel().collection, conversations = getLeadConversationModel().collection;
  const snapshots = getIntelligenceEvidenceSnapshotModel().collection, runs = getIntelligenceRunModel().collection;
  const reservations = getSalesIntelligenceAiReservationModel().collection;
  const number = async (classification = "customer") => (await numbers.insertOne({ e164: `+1757555${Math.floor(Math.random() * 9000 + 1000)}`, kind: "external",
    classification, revision: 1, digits_reversed: "x", country: "US", purged_at: null, content_purge_pending: false })).insertedId;
  const conversation = async (numberId: mongoose.Types.ObjectId, version: string) => (await conversations.insertOne({ provider: "ringcentral", provider_account_id: "synthetic", provider_recording_id: `rec-${version}`, contact_number_id: numberId, started_at: at,
    latest_transcript_version: version, content_purged_at: null, analysis_eligibility: { status: "eligible" } })).insertedId;
  const summarySnapshot = (conversationId: mongoose.Types.ObjectId, artifactKey: string) => snapshots.insertOne({ ...dataset, source_type: "summary",
    artifact_key: artifactKey, conversation_id: conversationId, purged_at: null });

  // N1: selected. c1 has a v2 summary with a reservation; c2 only a transcript (400 chars); c3 already has a v3 summary (cache hit).
  const n1 = await number();
  const c1 = await conversation(n1, "t1"), c2 = await conversation(n1, "t2"), c3 = await conversation(n1, "t3");
  const v2 = summaryCacheKey(String(c1), "t1", SUMMARY_PROMPT_VERSION, MODEL);
  await summarySnapshot(c1, v2);
  await summarySnapshot(c2, summaryCacheKey(String(c2), "t2", SUMMARY_PROMPT_VERSION, MODEL));
  await summarySnapshot(c3, summaryCacheKey(String(c3), "t3", CASE_FILE_SUMMARY_PROMPT_VERSION, MODEL));
  await snapshots.insertOne({ ...dataset, source_type: "transcript", conversation_id: c2, transcript_version: "t2", purged_at: null,
    segments: [{ sid: 1, text: "a".repeat(250) }, { sid: 2, text: "b".repeat(150) }] });
  await reservations.insertOne({ reservation_id: "r-sum-c1", stage: "analysis", step: `summary:${v2}:invocation:1`, observed_steps: 1, input_tokens: 12_000, output_tokens: 1_500, model_version: MODEL });
  const run = (await runs.insertOne({ ...dataset, job_id: oid(), subject_key: `number:${n1}`, analysis_pipeline: STRUCTURED_PIPELINE, status: "completed", prompt_version: "sales_intelligence_analyze_v4" })).insertedId;
  await reservations.insertOne({ reservation_id: "r-find-n1", stage: "analysis", run_id: run, step: "findings:k1:invocation:1", observed_steps: 1, input_tokens: 30_000, output_tokens: 3_000, model_version: MODEL });
  // V-AC N4: N1's open records: one with a generated assessment (20 000 / 2 000 tokens), one never assessed (median), one in identity review (skips).
  const records = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!.collection("outreach_records");
  const rec = async (state: string) => (await records.insertOne({ subject: { kind: "lead", model: "FormLead", id: oid(), contact_number_id: null }, primary_contact_number_id: n1, state })).insertedId;
  const assessed = await rec("open");
  await rec("unworked");
  await rec("identity_review");
  await rec("closed");
  await mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!.collection("move_assessment_artifacts").insertOne({ ...dataset, outreach_record_id: assessed, shadow: false,
    subject_key: "lead:FormLead:x", input_fingerprint: "fp", schema_version: "move-assessment-v1", status: "ready", usage: { input_tokens: 20_000, output_tokens: 2_000 } });
  // N2: excluded (company). N3: already has a completed Case File (v5) number run.
  const n2 = await number("company");
  await summarySnapshot(await conversation(n2, "t4"), "k-n2");
  const n3 = await number();
  await summarySnapshot(await conversation(n3, "t5"), "k-n3");
  await runs.insertOne({ ...dataset, job_id: oid(), subject_key: `number:${n3}`, analysis_pipeline: STRUCTURED_PIPELINE, status: "completed", prompt_version: CASE_FILE_FINDINGS_PROMPT_VERSION });

  const ops: string[] = [];
  mongoose.set("debug", (collection: string, method: string) => { ops.push(`${collection}.${method}`); });
  const before = await db.command({ dbHash: 1 });
  const estimate = await estimateCaseFileBackfill({ limit: 1000, model: MODEL });
  mongoose.set("debug", false);
  const after = await db.command({ dbHash: 1 });
  console.log(JSON.stringify({ estimate, ops: ops.length, methods: [...new Set(ops.map(o => o.split(".").at(-1)))].sort() }));
  assert.deepEqual(ops.filter(op => WRITE_METHODS.test(op.split(".").at(-1)!)), [], "reads only");
  assert.equal(after.md5, before.md5, "dbHash identical");

  assert.equal(estimate.cohort.numbers_selected, 1);
  assert.deepEqual(estimate.cohort.numbers_skipped, { number_excluded: 1, already_current: 1 });
  assert.deepEqual(estimate.summaries, { conversations: 3, re_summaries: 2, v3_cache_hits: 1, from_reservation: 1, from_transcript_length: 1, unknown: 0,
    input_tokens: 12_000 + 100 + 2_500, output_tokens: 1_500 + 1_500 });
  assert.deepEqual(estimate.findings, { numbers: 1, from_reservation: 1, defaulted: 0, input_tokens: 30_000, output_tokens: 3_000 });
  assert.deepEqual({ ...estimate.assessments, billed_to: undefined }, { subjects: 2, skipped_identity_review: 1, from_artifact: 1, defaulted: 1, input_tokens: 40_000, output_tokens: 4_000, billed_to: undefined });
  assert.equal(estimate.pricing.source, "env");
  // (14 600 × 100 + 3 000 × 400) / 1e6 = 2.66; (30 000 × 100 + 3 000 × 400) / 1e6 = 4.2
  // Assessments: (40 000 × 100 + 4 000 × 400) / 1e6 = 5.6; conservative = 2.66 × 1.1 + (4.2 + 5.6) × 1.5 = 17.63
  assert.deepEqual(estimate.projected_cents, { summaries: 2.66, findings: 4.2, assessments: 5.6, total: 12.46, conservative_total: 17.63 });
  assert.equal(estimate.findings_prompt_version, "sales_intelligence_analyze_v5");
  assert.equal(estimate.summary_prompt_version, "csi-summary-v3");
});
