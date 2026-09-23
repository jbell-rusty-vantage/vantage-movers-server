import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { csiDataset } from "../../src/config/domain/salesIntelligence";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { getLeadConversationModel } from "../../src/models/LeadConversation";
import { getIntelligenceRunModel } from "../../src/models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../../src/models/IntelligenceFinding";
import { getIntelligenceEffectModel } from "../../src/models/IntelligenceEffect";
import { getSalesIntelligenceReviewItemModel } from "../../src/models/SalesIntelligenceReviewItem";
import { intelligenceFindingSchema } from "../../src/validation/intelligence/intelligenceEnvelope.validation";
import { unknownCoverageFixture } from "../../src/services/salesIntelligence/fixtures";
import { currentFindingsResponseSchema, readCurrentFindings } from "../../src/services/salesIntelligence/analysis/currentFindings";
import { MARK, seedLead, seedNumber, seedRecord, seedSummaryConversation } from "./csi-move-assessment-fixtures";

/**
 * S3-FINDINGS replica proof, B20 (data spec §6.11 A, final spec §11.5): a Number with two analysed conversations,
 * each with an older run and a latest run, plus a Number run. `GET /outreach/:id/findings` serves only the latest
 * run's findings per conversation, drops superseded findings unless `include_superseded=true`, keeps retracted
 * findings, never serves a Number run's or an older run's findings, reads through the named indexes, and issues the
 * same queries whether the Number has 6 or 30 findings.
 */
test("S3-FINDINGS current findings on the csi01 replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300_000 }, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(getMongoDatabaseName(), /^testvantagemovers_s3findings[a-f0-9]*$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { mongoose.set("debug", false); await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("External traffic forbidden in the S3-FINDINGS replica proof"); });
  const oid = () => new mongoose.Types.ObjectId();
  const at = (day: number, hour = 15) => new Date(`2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`);
  const deps = { coverage: async () => unknownCoverageFixture };

  // ── Seed ─────────────────────────────────────────────────────────────
  const number = await seedNumber();
  const numberId = String(number._id);
  const lead = await seedLead("FormLead", number.national_ten!);
  const recordId = await seedRecord(lead, numberId);
  const record = await getOutreachRecordModel().findById(recordId).lean();
  assert.ok(record);
  assert.equal(String(record.primary_contact_number_id), numberId);
  const first = await seedSummaryConversation(numberId, at(10), { overview: "First call." }, [{ claim: "We are moving in January" }]);
  const second = await seedSummaryConversation(numberId, at(14), { overview: "Second call." }, [{ claim: "The quote was $4,200", speaker: "rep" }]);
  // Not current: a conversation whose content was purged, and one never analysed.
  const purged = await seedSummaryConversation(numberId, at(12), { overview: "Purged call." });
  const unanalysed = await seedSummaryConversation(numberId, at(13), { overview: "Unanalysed call." });

  const runs = { old1: oid(), new1: oid(), old2: oid(), new2: oid(), purged: oid(), numberRun: oid() };
  const runRow = (_id: mongoose.Types.ObjectId, conversation: mongoose.Types.ObjectId | null, created: Date) => ({ _id, ...csiDataset(), conversation_id: conversation,
    contact_number_id: number._id, outreach_record_id: record._id, subject_key: conversation ? `conversation:${conversation}` : `number:${numberId}`, status: "completed",
    completed_at: created, analysis_pipeline: "csi-analysis-steps-v1", step_artifacts: { summaries: [] }, schema_version: "csi-envelope-v1", prompt_version: "csi-findings-v1",
    model_version: "openai/gpt-5-mini", mode: "initial", revision: 1, input_fingerprint: "synthetic", manifest_snapshot_ids: [], purged_at: null, purge_started_at: null,
    output: { schema_version: "csi-envelope-v1" }, createdAt: created, updatedAt: created });
  await getIntelligenceRunModel().collection.insertMany([
    runRow(runs.old1, first.conversation._id, at(10, 16)), runRow(runs.new1, first.conversation._id, at(11)),
    runRow(runs.old2, second.conversation._id, at(14, 16)), runRow(runs.new2, second.conversation._id, at(15)),
    runRow(runs.purged, purged.conversation._id, at(12, 16)), runRow(runs.numberRun, null, at(16)),
  ] as never[]);
  await getLeadConversationModel().collection.updateOne({ _id: first.conversation._id }, { $set: { latest_completed_run_id: runs.new1 } });
  await getLeadConversationModel().collection.updateOne({ _id: second.conversation._id }, { $set: { latest_completed_run_id: runs.new2 } });
  await getLeadConversationModel().collection.updateOne({ _id: purged.conversation._id }, { $set: { latest_completed_run_id: runs.purged, content_purged_at: at(20) } });
  assert.equal((await getLeadConversationModel().findById(unanalysed.conversation._id).lean())?.latest_completed_run_id ?? null, null);

  // Transcript citation on the summary artifact: its own segments are empty, so the quote comes from the source transcript.
  const cite = (seeded: typeof first) => ({ source: "transcript", snapshot_id: String(seeded.artifact._id), conversation_id: String(seeded.conversation._id),
    transcript_version: seeded.conversation.latest_transcript_version, segment_ids: [1], quote: null });
  const base = { basis: "said_on_call", speaker_ref: null, clarity: "clear", confidence: null };
  const callback = (key: string, claim: string, seeded: typeof first) => intelligenceFindingSchema.parse({ ...base, key, kind: "promised_callback", claim, actor: "rep",
    action_status: "promised", value: { action_kind: "call", description: claim, date_text: "Friday", timezone_text: null, target_followup_id: null }, evidence: [cite(seeded)] });
  const quote = (key: string, seeded: typeof first) => intelligenceFindingSchema.parse({ ...base, key, kind: "quoted_amount", claim: "Quoted $4,200", actor: "rep",
    action_status: null, value: { amount_text: "$4,200", currency: "USD", meaning: "quote_total" }, evidence: [cite(seeded)] });
  const moveFact = (key: string, seeded: typeof first) => intelligenceFindingSchema.parse({ ...base, key, kind: "move_fact", claim: "Moving in January", actor: "customer",
    action_status: null, value: { field: "move_date", stated_value: "January" }, evidence: [cite(seeded)] });
  const ids = { oldOnC1: oid(), oldOnC2: oid(), c1Callback: oid(), c1Superseded: oid(), c1Move: oid(), c2Quote: oid(), c2Retracted: oid(), purgedConv: oid(),
    numberStray: oid(), numberNull: oid(), purgedFinding: oid() };
  const findingRow = (_id: mongoose.Types.ObjectId, run: mongoose.Types.ObjectId, conversation: mongoose.Types.ObjectId | null, assertion: ReturnType<typeof moveFact>,
    over: Record<string, unknown> = {}) => ({ _id, run_id: run, key: assertion.key, kind: assertion.kind, assertion, review_state: "unreviewed", revision: 1, superseded_by: null,
    conversation_id: conversation, contact_number_id: number._id, outreach_record_id: record._id, resolved: null, purged_at: null, createdAt: at(15), updatedAt: at(15), ...over });
  const due = new Date("2026-09-18T14:00:00Z");
  await getIntelligenceFindingModel().collection.insertMany([
    findingRow(ids.oldOnC1, runs.old1, first.conversation._id, callback("o1", "Rep will call Monday (older run)", first)),
    findingRow(ids.oldOnC2, runs.old2, second.conversation._id, quote("o2", second)),
    findingRow(ids.c1Callback, runs.new1, first.conversation._id, callback("f1", "Rep will call back Friday", first), { resolved: { due_at: due, amount_cents: null } }),
    findingRow(ids.c1Superseded, runs.new1, first.conversation._id, callback("f2", "Rep will call Thursday", first), { superseded_by: ids.c1Callback }),
    findingRow(ids.c1Move, runs.new1, first.conversation._id, moveFact("f3", first)),
    findingRow(ids.c2Quote, runs.new2, second.conversation._id, quote("f4", second), { resolved: { due_at: null, amount_cents: 420_000 } }),
    findingRow(ids.c2Retracted, runs.new2, second.conversation._id, callback("f5", "Rep will text tonight", second), { review_state: "retracted", revision: 2 }),
    findingRow(ids.purgedFinding, runs.new2, second.conversation._id, moveFact("f6", second), { purged_at: at(20) }),
    findingRow(ids.purgedConv, runs.purged, purged.conversation._id, moveFact("p1", purged)),
    // A Number run's findings: one that names a conversation, one that does not. Neither is current.
    findingRow(ids.numberStray, runs.numberRun, first.conversation._id, callback("n1", "Number synthesis callback", first)),
    findingRow(ids.numberNull, runs.numberRun, null, moveFact("n2", first)),
  ] as never[]);
  const followupId = oid(), reviewId = oid();
  await getOutreachFollowupModel().collection.insertOne({ _id: followupId, outreach_record_id: record._id, commitment_key: `intelligence:${runs.new1}:f1`, kind: "call",
    description: "Call back Friday", status: "open", due_at: due, revision: 1 } as never);
  const effect = (finding: mongoose.Types.ObjectId, run: mongoose.Types.ObjectId, key: string, effect_kind: string, status: string, reason: string | null,
    target: mongoose.Types.ObjectId) => ({ _id: oid(), run_id: run, finding_id: finding, finding_key: key, effect_kind, target_key: `${effect_kind}:${target}`, target_id: target,
    status, reason, previous: {}, current: {}, applied_at: at(15) });
  await getIntelligenceEffectModel().collection.insertMany([
    effect(ids.c1Callback, runs.new1, "f1", "create_followup", "applied", null, followupId),
    effect(ids.c1Callback, runs.new1, "f1", "supersede", "applied", "superseded_by_later_finding", ids.c1Superseded),
  ] as never[]);
  await getSalesIntelligenceReviewItemModel().collection.insertOne({ _id: reviewId, subject_key: `conversation:${second.conversation._id}`, cause_kind: "unclear_commitment",
    cause_key: `${runs.new2}:f4`, state: "open", evidence_ids: [ids.c2Quote], opened_at: at(15), revision: 1 } as never);

  // ── Query counter (mongoose debug hook: one entry per collection operation) ──
  const counted = async <T>(read: () => Promise<T>) => {
    const ops: string[] = [];
    mongoose.set("debug", (collection: string, method: string) => { ops.push(`${collection}.${method}`); });
    try { return { value: await read(), ops }; } finally { mongoose.set("debug", false); }
  };
  const tally = (ops: string[]) => ops.reduce<Record<string, number>>((acc, op) => ({ ...acc, [op]: (acc[op] ?? 0) + 1 }), {});

  // ── GET /outreach/:id/findings ──
  const read = await counted(() => readCurrentFindings(recordId, { scope: "production" }, deps));
  const response = currentFindingsResponseSchema.parse(read.value);
  const items = response.data.items;
  assert.deepEqual([response.data.reason, response.data.truncated], [null, false]);
  assert.deepEqual(items.map(i => i.id), [ids.c2Retracted, ids.c1Callback, ids.c2Quote, ids.c1Move].map(String),
    "commitments newest call first (retracted kept), then money, then move facts; older-run, superseded, purged, purged-conversation and Number-run findings excluded");
  const byId = new Map(items.map(i => [i.id, i]));
  const cb = byId.get(String(ids.c1Callback))!;
  assert.deepEqual([cb.work_result, cb.work_result_detail, cb.value_line, cb.source_word, cb.action_status_word, cb.run_id, cb.call_at],
    ["applied", "follow-up due Sep 18, 10:00 AM ET", "Due Fri Sep 18, 10:00 AM ET", "Rep said", "Promised", String(runs.new1), at(10).toISOString()]);
  assert.deepEqual(cb.allowed_actions.map(a => [a.action, a.enabled, a.expected_revision]), [["confirm_finding", true, 1], ["correct_finding", true, 1], ["retract_finding", true, 1]]);
  const retracted = byId.get(String(ids.c2Retracted))!;
  assert.deepEqual([retracted.work_result, retracted.review_state, retracted.allowed_actions.some(a => a.enabled)], ["retracted", "retracted", false]);
  assert.deepEqual([byId.get(String(ids.c2Quote))!.work_result, byId.get(String(ids.c2Quote))!.value_line], ["needs_review", "$4,200 · quote total"]);
  const evidence = cb.evidence[0]!;
  assert.deepEqual([evidence.kind, evidence.availability, evidence.speaker], ["transcript_quote", "retained", "customer"]);
  assert.ok(evidence.quote?.includes("customer describes the move"), "the quote comes from the source transcript segment");
  assert.ok(!JSON.stringify(response).includes(String(ids.numberStray)) && !JSON.stringify(response).includes(String(ids.numberNull)), "no Number-run finding id anywhere");
  assert.ok(MARK.segment.length > 0);

  const ops = tally(read.ops);
  assert.deepEqual(ops, {
    "outreach_records.findOne": 1, "contact_numbers.findOne": 1, "lead_conversations.find": 1, "intelligence_findings.find": 1, "intelligence_runs.find": 1,
    "intelligence_effects.find": 1, "sales_intelligence_review_items.find": 1, "intelligence_evidence_snapshots.find": 1, "outreach_followups.find": 1,
    "intelligence_evidence_snapshots.aggregate": 1,
  }, `fixed query shape: ${JSON.stringify(ops)}`);

  // include_superseded=true adds exactly the superseded finding.
  const all = currentFindingsResponseSchema.parse(await readCurrentFindings(recordId, { include_superseded: "true" }, deps)).data.items;
  const superseded = all.find(i => i.id === String(ids.c1Superseded));
  assert.ok(superseded);
  assert.deepEqual([superseded.work_result, superseded.work_result_detail, superseded.superseded_by, all.length], ["superseded", String(ids.c1Callback), String(ids.c1Callback), 5]);

  // Indexes: the conversation read and the finding read use the named indexes.
  const plan = (explain: unknown) => JSON.stringify(explain);
  const conversationPlan = plan(await getLeadConversationModel().find({ contact_number_id: numberId, latest_completed_run_id: { $ne: null }, content_purged_at: null })
    .sort({ started_at: -1, _id: -1 }).limit(201).explain("queryPlanner"));
  assert.match(conversationPlan, /lead_conversation_number_started/);
  assert.doesNotMatch(conversationPlan, /"stage":"SORT"/, "no blocking sort");
  const findingPlan = plan(await getIntelligenceFindingModel().find({ $or: [{ conversation_id: first.conversation._id, run_id: runs.new1 },
    { conversation_id: second.conversation._id, run_id: runs.new2 }], purged_at: null, superseded_by: null }).explain("queryPlanner"));
  assert.match(findingPlan, /csi_finding_conversation/);

  // Twenty-four more current findings with effects: the query shape does not change (no per-finding read).
  const more = Array.from({ length: 24 }, (_, i) => ({ id: oid(), run: i % 2 ? runs.new1 : runs.new2, conv: i % 2 ? first.conversation._id : second.conversation._id,
    assertion: callback(`x${i}`, `Extra callback ${i}`, i % 2 ? first : second) }));
  await getIntelligenceFindingModel().collection.insertMany(more.map(m => findingRow(m.id, m.run, m.conv, m.assertion)) as never[]);
  await getIntelligenceEffectModel().collection.insertMany(more.map(m => effect(m.id, m.run, m.assertion.key, "create_followup", "applied", null, followupId)) as never[]);
  const bigger = await counted(() => readCurrentFindings(recordId, {}, deps));
  assert.equal(currentFindingsResponseSchema.parse(bigger.value).data.items.length, 28);
  assert.deepEqual(tally(bigger.ops), ops, "same queries at 4 and 28 findings");

  // A record with no primary Contact Number: `no_number`, and nothing past the record is read.
  const lonely = await seedLead("FormLead", "2025559999");
  const lonelyId = await seedRecord(lonely, numberId);
  await getOutreachRecordModel().collection.updateOne({ _id: new mongoose.Types.ObjectId(lonelyId) }, { $set: { primary_contact_number_id: null } });
  const none = await counted(() => readCurrentFindings(lonelyId, {}, deps));
  assert.deepEqual(currentFindingsResponseSchema.parse(none.value).data, { items: [], reason: "no_number", truncated: false });
  assert.deepEqual(tally(none.ops), { "outreach_records.findOne": 1 });
  assert.equal(await readCurrentFindings(String(oid()), {}, deps), null, "a missing record is a 404");
});
