import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { csiDataset } from "../../src/config/domain/salesIntelligence";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { getIntelligenceRunModel } from "../../src/models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../../src/models/IntelligenceFinding";
import { getIntelligenceEffectModel } from "../../src/models/IntelligenceEffect";
import { getIntelligenceEvidenceSnapshotModel } from "../../src/models/IntelligenceEvidenceSnapshot";
import { getMoveAssessmentArtifactModel } from "../../src/models/MoveAssessmentArtifact";
import { getSalesIntelligenceReviewItemModel } from "../../src/models/SalesIntelligenceReviewItem";
import { getSalesIntelligenceAuditEventModel } from "../../src/models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceOwnerInstructionModel } from "../../src/models/SalesIntelligenceOwnerInstruction";
import { intelligenceEnvelopeSchema } from "../../src/validation/intelligence/intelligenceEnvelope.validation";
import { payloadHash } from "../../src/services/salesIntelligence/transactions";
import { unknownCoverageFixture } from "../../src/services/salesIntelligence/fixtures";
import { moveViewsForLead } from "../../src/services/salesIntelligence/assessment/views";
import {
  assessmentSectionSchema, evidenceSectionSchema, outreachAssessmentDtoSchema, runPresentationSchema,
} from "../../src/services/salesIntelligence/assessment/dto";
import { readAssessment, readAssessmentEvidence, readOutreachAssessment, readRunPresentation } from "../../src/services/salesIntelligence/assessment/reads";
import { RECORD_FIXTURES, summaryMoveEvidence } from "../../src/services/salesIntelligence/assessment/presentation.fixtures";
import { seedLead, seedNumber, seedRecord, seedSummaryConversation } from "./csi-move-assessment-fixtures";

/**
 * S3-PRES replica proof (data spec §6.2, §6.5, §6.11 B–D): one structured run with findings, effects, review items,
 * an applied-suggestion audit row, prior findings of all five relations, a story discrepancy and an Owner instruction,
 * plus a published Move assessment artifact. The route read functions run against Mongo on csi01; every DTO is
 * parsed with the server schema, and a mongoose query counter proves the query shape does not grow with findings.
 */
test("S3-PRES presentation contract on the csi01 replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300_000 }, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(getMongoDatabaseName(), /^testvantagemovers_s3pres[a-f0-9]*$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { mongoose.set("debug", false); await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("External traffic forbidden in the S3-PRES replica proof"); });
  const oid = () => new mongoose.Types.ObjectId();
  const at = (day: number, hour = 15) => new Date(`2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`);
  const deps = { coverage: async () => unknownCoverageFixture };

  // ── Seed ─────────────────────────────────────────────────────────────
  const number = await seedNumber();
  const numberId = String(number._id);
  const lead = await seedLead("FormLead", number.national_ten!, { pickup_city: "Austin", pickup_state: "TX", pickup_zip: "78701", delivery_city: "Denver",
    delivery_state: "CO", destination_zip: "80202", move_date: new Date("2026-01-15T00:00:00Z"), move_size: "2 Bedroom", ingestion_origin: "granot_lead_created",
    booked: null, cancelled: null, ingested_move_snapshot: { pickup_city: "Austin", pickup_state: "TX", pickup_zip: "78701", delivery_city: "Boulder", delivery_state: "CO",
      destination_zip: "80301", move_date: new Date("2026-01-10T00:00:00Z"), move_size: "1 Bedroom", captured_at: at(1), evidence_status: "captured_at_ingestion" } });
  const recordId = await seedRecord(lead, numberId);
  const record = await getOutreachRecordModel().findById(recordId).lean();
  assert.ok(record);
  const subject = `lead:FormLead:${lead.id}`;
  const seeded = await seedSummaryConversation(numberId, at(10), { overview: "Customer is moving a two-bedroom to Denver.", money_and_dates: "Quoted $4,200 for mid January." },
    [{ claim: "We are moving in January", speaker: "customer" }]);
  const conversationId = String(seeded.conversation._id);
  // Real transcripts carry provider timing; give the source transcript three timed segments and the summary artifact csi-summary-v2 move evidence.
  await getIntelligenceEvidenceSnapshotModel().collection.updateOne({ _id: seeded.transcript._id }, { $set: { segments: [
    { sid: 1, start_ms: 12_000, end_ms: 15_000, timing_source: "provider", speaker: "customer", text: "We are moving to Denver in January." },
    { sid: 5, start_ms: 40_000, end_ms: 44_000, timing_source: "provider", speaker: "rep", text: "The quote is forty-two hundred." },
    { sid: 6, start_ms: 50_000, end_ms: 52_000, timing_source: "provider", speaker: "customer", text: "We have a piano." }] } });
  const summaryResponse = JSON.parse(JSON.stringify(seeded.artifact.response));
  summaryResponse.analysis_summary.move_evidence = summaryMoveEvidence();
  await getIntelligenceEvidenceSnapshotModel().collection.updateOne({ _id: seeded.artifact._id }, { $set: { response: summaryResponse, content_digest: payloadHash(summaryResponse) } });
  const summaryId = String(seeded.artifact._id), summaryDigest = payloadHash(summaryResponse);
  // A newer call after the assessment's covered conversation.
  await seedSummaryConversation(numberId, at(14), { overview: "Short follow-up call." });

  // Structured run: context snapshot with one record of every type, findings, effects, relations, discrepancy.
  const runId = oid(), priorRunId = oid(), contextId = oid(), commandId = oid(), instructionId = oid();
  const runSubject = `conversation:${conversationId}`;
  const records = RECORD_FIXTURES.map(r => r.record_type === "lead" ? { ...r, record_id: lead.id } : r);
  const contextResponse = { page: { records, next_cursor: null, complete: true, missing_ranges: [] }, coverage: { known_through: null, gaps: [], capabilities: {}, ai_paused: false },
    allowed_followup_ids: [], instructions: [], speaker_refs: [] };
  await getIntelligenceEvidenceSnapshotModel().collection.insertOne({ _id: contextId, ...csiDataset(), run_id: runId, source_type: "context", artifact_key: `ctx:${runId}`,
    source_id: String(runId), arguments: {}, response: contextResponse, content_digest: payloadHash(contextResponse), retrieved_at: at(10, 16), happened_at: at(10, 16),
    subject_key: runSubject, completeness: { complete: true, missing_ranges: [] }, segments: [] } as never);
  const t1 = { source: "transcript", snapshot_id: summaryId, conversation_id: conversationId, transcript_version: seeded.conversation.latest_transcript_version, segment_ids: [1], quote: null };
  const rec = (record_type: string, record_id: string) => ({ source: "vantage_record", snapshot_id: String(contextId), record_type, record_id, field_paths: ["status"] });
  const recordRefs = records.map(r => rec(r.record_type, r.record_id));
  const storyEvent = records.find(r => r.record_type === "story_event")!.record_id;
  const prior = { superseded: oid(), fulfilled: oid(), contradicted: oid(), still_true: oid(), cannot_determine: oid() };
  const action = (description: string, date_text: string | null) => ({ action_kind: "call", description, date_text, timezone_text: null, target_followup_id: null });
  const base = { basis: "said_on_call", speaker_ref: null, clarity: "clear", confidence: null };
  const envelope = intelligenceEnvelopeSchema.parse({ schema_version: "csi-envelope-v1",
    summary: { overview: "Customer is moving in January and asked for a callback.", customer_wanted: "A quote", money_and_dates: "$4,200", outcome: "Callback promised",
      commitments: "Call back Friday", discrepancies: "Says the estimate text never arrived", finding_keys: ["f1"] },
    findings: [
      { ...base, key: "f1", kind: "move_fact", claim: "Moving in January", actor: "customer", action_status: null, value: { field: "move_date", stated_value: "January" },
        evidence: [t1, ...recordRefs.slice(0, 10)] },
      { ...base, key: "f2", kind: "promised_callback", claim: "Rep will call back Friday", actor: "rep", action_status: "promised", value: action("Call back Friday", "Friday"),
        evidence: [t1, ...recordRefs.slice(10)] },
      { ...base, key: "f3", kind: "quoted_amount", claim: "Quoted $4,200", actor: "rep", action_status: null, value: { amount_text: "$4,200", currency: "USD", meaning: "quote_total" },
        evidence: [t1] },
    ],
    next_step_suggestion: { ...action("Send the written estimate", null), action_kind: "send_estimate", rationale: "Customer asked for it in writing", finding_keys: ["f3"] },
    owner_instruction_assessments: [{ instruction_id: String(instructionId), instruction_revision: 2, assessment: "agrees", reason: "The call confirms January.", finding_keys: ["f1"] }],
    prior_finding_relations: [
      { prior_finding_id: String(prior.superseded), relation: "superseded", by_finding_key: "f2", evidence: [t1], note: "Rescheduled to Friday" },
      { prior_finding_id: String(prior.fulfilled), relation: "fulfilled", by_finding_key: "f2", evidence: [t1], note: null },
      { prior_finding_id: String(prior.contradicted), relation: "contradicted", by_finding_key: "f1", evidence: [t1], note: "Date moved" },
      { prior_finding_id: String(prior.still_true), relation: "still_true", by_finding_key: null, evidence: [t1], note: null },
      { prior_finding_id: String(prior.cannot_determine), relation: "cannot_determine", by_finding_key: null, evidence: [], note: null },
    ],
    story_discrepancies: [{ story_event_id: storyEvent, claim: "Customer says the estimate text never arrived", evidence: [t1] }],
  });
  await getIntelligenceRunModel().collection.insertOne({ _id: runId, ...csiDataset(), conversation_id: seeded.conversation._id, contact_number_id: number._id,
    outreach_record_id: record._id, subject_key: runSubject, status: "completed", completed_at: at(10, 17), analysis_pipeline: "csi-analysis-steps-v1",
    step_artifacts: { summaries: [summaryId], context: String(contextId), context_digest: payloadHash(contextResponse) }, schema_version: "csi-envelope-v1",
    prompt_version: "csi-findings-v1", model_version: "openai/gpt-5-mini", mode: "initial", revision: 1, input_fingerprint: "synthetic", manifest_snapshot_ids: [],
    purged_at: null, purge_started_at: null, output: envelope, createdAt: at(10, 16), updatedAt: at(10, 17) } as never);
  await getSalesIntelligenceOwnerInstructionModel().collection.insertOne({ _id: instructionId, instruction_id: instructionId, revision: 2, subject_key: subject, field: "assertion",
    prior: {}, current: { review_state: "corrected", replacement: null, reason: "The move is in January, not March" }, actor: { kind: "owner", id: "owner" }, happened_at: at(9), state: "active" } as never);
  const priorAssertion = (claim: string) => ({ ...envelope.findings[1], key: `p-${claim}`, claim });
  const priorRows = Object.entries(prior).map(([relation, id]) => ({ _id: id, run_id: priorRunId, key: `p-${relation}`, kind: "promised_callback", revision: 1,
    assertion: priorAssertion(`Earlier ${relation}`), review_state: "unreviewed", superseded_by: null, conversation_id: seeded.conversation._id,
    contact_number_id: number._id, purged_at: null, createdAt: at(5), updatedAt: at(5) }));
  await getIntelligenceFindingModel().collection.insertMany(priorRows as never[]);
  const findingIds = { f1: oid(), f2: oid(), f3: oid() };
  const due = new Date("2026-09-11T14:00:00Z");
  await getIntelligenceFindingModel().collection.insertMany(envelope.findings.map(f => ({ _id: findingIds[f.key as keyof typeof findingIds], run_id: runId, key: f.key, kind: f.kind,
    assertion: f, review_state: "unreviewed", revision: 1, superseded_by: null, conversation_id: seeded.conversation._id, contact_number_id: number._id, outreach_record_id: record._id,
    resolved: { due_at: f.key === "f2" ? due : null, amount_cents: f.key === "f3" ? 420_000 : null }, purged_at: null, createdAt: at(10, 17), updatedAt: at(10, 17) })) as never[]);
  await getIntelligenceFindingModel().collection.updateOne({ _id: prior.superseded }, { $set: { superseded_by: findingIds.f2 } });
  const followupId = oid(), appliedFollowupId = oid();
  await getOutreachFollowupModel().collection.insertMany([
    { _id: followupId, outreach_record_id: record._id, commitment_key: `intelligence:${runId}:f2`, kind: "call", description: "Call back Friday", status: "open", due_at: due, revision: 0 },
    { _id: appliedFollowupId, outreach_record_id: record._id, commitment_key: `owner:${commandId}:action`, kind: "send_estimate", description: "Send the written estimate",
      status: "open", due_at: new Date("2026-09-12T15:00:00Z"), revision: 0 },
  ] as never[]);
  const effect = (finding: mongoose.Types.ObjectId, key: string, effect_kind: string, status: string, reason: string | null, target: mongoose.Types.ObjectId) =>
    ({ _id: oid(), run_id: runId, finding_id: finding, finding_key: key, effect_kind, target_key: `${effect_kind}:${target}`, target_id: target, status, reason,
      previous: {}, current: {}, applied_at: at(10, 17) });
  const reviewContradiction = oid(), reviewFulfilled = oid(), reviewDisputed = oid();
  await getIntelligenceEffectModel().collection.insertMany([
    effect(findingIds.f2, "f2", "supersede", "applied", "superseded_by_later_finding", prior.superseded),
    effect(findingIds.f2, "f2", "create_followup", "applied", null, followupId),
    effect(findingIds.f1, "f1", "open_review", "needs_review", "prior_finding_contradicted", reviewContradiction),
  ] as never[]);
  await getSalesIntelligenceReviewItemModel().collection.insertMany([
    { _id: reviewContradiction, subject_key: runSubject, cause_kind: "prior_contradiction", cause_key: String(prior.contradicted), state: "open",
      evidence_ids: [prior.contradicted, findingIds.f1], opened_at: at(10, 17), revision: 0 },
    { _id: reviewFulfilled, subject_key: runSubject, cause_kind: "prior_fulfilled_unclaimed", cause_key: String(prior.fulfilled), state: "open",
      evidence_ids: [prior.fulfilled, findingIds.f2], opened_at: at(10, 17), revision: 0 },
    { _id: reviewDisputed, subject_key: runSubject, cause_kind: "record_disputed_on_call", cause_key: storyEvent, state: "open",
      evidence_ids: Object.values(findingIds), opened_at: at(10, 17), revision: 0 },
  ] as never[]);
  await getSalesIntelligenceAuditEventModel().collection.insertOne({ _id: oid(), semantic_key: `${commandId}:analysis:${runId}:2`, subject_key: runSubject,
    event_kind: "analysis.suggestion_applied", command_id: commandId, actor: { kind: "owner", id: "owner" }, happened_at: at(11), recorded_at: at(11), prior: {},
    current: { suggestion_output_digest: payloadHash(envelope.next_step_suggestion) }, invalidation: { kind: "analysis", target_id: String(runId), subject_key: runSubject, revision: 2 } } as never);

  // Published Move assessment artifact citing said_on_call, every move_evidence entry, Lead views, official state and the correction.
  const leadRow = await getFormLeadModel().findById(lead.id).lean();
  const views = moveViewsForLead(leadRow as never, "FormLead");
  const summaryLocator = (section: string) => ({ source: "summary_artifact", snapshot_id: summaryId, content_digest: summaryDigest, conversation_id: conversationId,
    transcript_version: seeded.conversation.latest_transcript_version, section });
  const cite = (id: string, kind: string, locator: Record<string, unknown>) => ({ id, kind, locator, speaker: null, call_at: at(10).toISOString(), lineage: [] });
  const saidRef = cite("e1", "said_on_call", summaryLocator("said_on_call.0"));
  const moveRefs = [0, 1, 2].map(i => cite(`e${2 + i}`, "move_evidence", summaryLocator(`move_evidence.${i}`)));
  const leadRefs = [cite("e5", "lead_current", { source: "lead", model: "FormLead", id: lead.id, view: "current", field_path: "move_date" }),
    cite("e6", "lead_ingested", { source: "lead", model: "FormLead", id: lead.id, view: "ingested", field_path: "ingested_move_snapshot.delivery" }),
    cite("e7", "official_state", { source: "official", model: "FormLead", id: lead.id, field_path: "booked" }),
    cite("e8", "owner_correction", { source: "owner_correction", instruction_id: String(instructionId), revision: 2 })];
  const artifactId = oid();
  await getMoveAssessmentArtifactModel().collection.insertOne({ _id: artifactId, ...csiDataset(), status: "ready", shadow: false, subject_key: subject,
    outreach_record_id: record._id, contact_number_id: number._id, schema_version: "move-assessment-v1", rubric_version: "move-rubric-v1",
    prompt_version: "csi-move-assessment-v1", prompt_digest: "pd", schema_digest: "sd", model_version: "openai/gpt-5-mini", input_fingerprint: "fp",
    input_mode: "summaries", generated_at: at(12), context_as_of: at(12), latest_conversation_at: at(10), published_at: at(12), createdAt: at(12), updatedAt: at(12),
    scores: { move_likelihood: { level: "strong", confidence: "medium", rationale: "Definite January move", conditions: [], score: 75, evidence: [saidRef, ...moveRefs] },
      transaction_intent: { level: "active", confidence: "medium", rationale: "Discussing the Vantage quote", conditions: ["Written estimate"], score: 50, evidence: [moveRefs[0], ...leadRefs] } },
    views: { ...JSON.parse(JSON.stringify(views)), customer_stated: [
      { field: "delivery_location", value: { line: null, city: "Denver", state: "CO", zip: null, precision: "city" }, status: "stated", evidence: [saidRef] },
      { field: "money", value: { basis: "quote", amount: { min: 4200, max: 4200 }, currency: "USD", text: "$4,200" }, status: "stated", evidence: [moveRefs[0]] },
      { field: "money", value: { basis: "budget", amount: { min: 3000, max: 3000 }, currency: null, text: "three thousand" }, status: "stated", evidence: [saidRef] },
      { field: "service", value: { service: "packing", status: "declined", detail: null, duration_text: null }, status: "stated", evidence: [saidRef] }] },
    inventory: { items: [{ label: "Piano", quantity: { min: 1, max: 1 }, room: "Living room", dimensions: null, handling: "Crew of four", status: "included", evidence: [moveRefs[1]] }],
      coverage: "partial", limitations: ["Garage not discussed"] },
    conflicts: [{ affects: "delivery_location", explanation: "Original submission says Boulder; the call says Denver", evidence: [saidRef, leadRefs[1]] }],
    coverage: { conversations_available: 2, conversations_selected: 1, findings_selected: 0, source_coverage: "partial" },
    engagement: { work_status: "worked_with_next_step", rationale: "Rep promised a callback.", evidence: [saidRef],
      promised_callbacks: [{ by: "rep", raw_text: "I'll call you Friday", date: "2026-09-11", time_text: null, status: "pending", evidence: [saidRef] }], next_steps: [] },
    engagement_effects: { applied: true, mark_worked: false, blocked: null, followup_ids: [String(followupId)],
      followups: [{ kind: "call", origin: "rep_promise", description: "Promised callback", source: "promised_callback", index: 0 }], skipped: [] },
    model_output: {}, source_manifest: [], purged_at: null, purge_started_at: null } as never);
  await getOutreachRecordModel().collection.updateOne({ _id: record._id }, { $set: { move_assessment: { artifact_id: artifactId, status: "ready", transaction_intent: 50,
    move_likelihood: 75, context_as_of: at(12), latest_conversation_at: at(10), stale: false, stale_reason: null, published_at: at(12) } } });

  // ── Query counter (mongoose debug hook: one entry per collection operation) ──
  const counted = async <T>(read: () => Promise<T>) => {
    const ops: string[] = [];
    mongoose.set("debug", (collection: string, method: string) => { ops.push(`${collection}.${method}`); });
    try { return { value: await read(), ops }; } finally { mongoose.set("debug", false); }
  };
  const tally = (ops: string[]) => ops.reduce<Record<string, number>>((acc, op) => ({ ...acc, [op]: (acc[op] ?? 0) + 1 }), {});

  // ── GET /outreach/:id/assessment ──
  const outreach = await counted(() => readOutreachAssessment(recordId, deps));
  const assessment = outreachAssessmentDtoSchema.parse(outreach.value!.data);
  const current = assessment.current!;
  assert.deepEqual([current.stale, current.stale_reason, current.newer_calls_count], [true, "move_date_passed", 1], "Lead move date 2026-01-15 has passed; one newer call");
  assert.deepEqual([current.move_likelihood.stale_reason, current.move_likelihood.evidence_missing], ["move_date_passed", false]);
  const row = (key: string) => current.move_table!.rows.find(r => r.key === key)!;
  assert.deepEqual(row("money").customer.map(c => c.text), ["$4,200 quote", "$3,000 budget"]);
  assert.deepEqual(row("services").customer.map(c => [c.text, c.marker]), [["Packing", "declined"]]);
  assert.deepEqual([row("services").lead_on_file, row("money").original], [null, null]);
  assert.deepEqual([row("delivery").lead_on_file, row("delivery").original, row("delivery").conflict?.cells], ["Denver, CO 80202", "Boulder, CO 80301", ["customer", "original"]]);
  assert.equal(current.move_table!.original_origin_label, "Granot created");
  assert.equal(current.engagement!.work_status_label, "Worked, next step agreed");
  assert.deepEqual([current.engagement!.promised_callbacks[0]!.followup_created, current.engagement!.promised_callbacks[0]!.followup_id], [true, String(followupId)]);
  assert.deepEqual(current.inventory.limitations, ["Garage not discussed"]);
  assert.equal(tally(outreach.ops)["call_interactions.countDocuments"], 1, "newer_calls_count is one countDocuments");

  // ── GET /assessments/:artifactId and its evidence ──
  const section = assessmentSectionSchema.parse((await readAssessment(String(artifactId), deps))!.data);
  assert.deepEqual([section.current, section.stale_reason, section.newer_calls_count], [true, "move_date_passed", 1]);
  const evidence = await counted(() => readAssessmentEvidence(String(artifactId), deps));
  const items = evidenceSectionSchema.parse(evidence.value!.data).items;
  assert.equal(items.length, 8);
  for (const item of items) assert.ok(item.text, `assessment evidence ${item.id} (${item.kind}) carries text`);
  const byId = new Map(items.map(item => [item.id, item]));
  assert.deepEqual([byId.get("e1")!.text, byId.get("e1")!.segment_ids], ["We are moving in January", [1]]);
  assert.deepEqual([byId.get("e2")!.text, byId.get("e3")!.text, byId.get("e4")!.text],
    ["Money: $4,200 quote", "Inventory: Piano × 1 (Living room)", "Ready to book: Ready to book this week"], "D11: move_evidence resolves through the flat index");
  assert.deepEqual([byId.get("e5")!.text, byId.get("e6")!.text, byId.get("e7")!.text, byId.get("e8")!.text],
    ["Move date: Jan 15, 2026", "Delivery: Boulder, CO 80301", "Booked: no", "Corrected a finding: The move is in January, not March"]);

  // ── GET /analysis-runs/:id/presentation ──
  const first = await counted(() => readRunPresentation(String(runId), deps));
  const view = runPresentationSchema.parse(first.value!.data);
  const s = view.summary_findings;
  assert.deepEqual(s.findings.map(f => [f.kind, f.work_result, f.value_line, f.category]), [
    ["move_fact", "not_applicable", "Move date: January", "move_facts"],
    ["promised_callback", "applied", "Due Fri Sep 11, 10:00 AM ET", "commitments"],
    ["quoted_amount", "not_applicable", "$4,200 · quote total", "money"]]);
  assert.equal(s.findings[1]!.work_result_detail, "follow-up due Sep 11, 10:00 AM ET");
  assert.deepEqual(s.prior_finding_relations!.map(r => [r.relation_word, r.prior_claim, r.review_item_id]), [
    ["Replaced", "Earlier superseded", null], ["Done", "Earlier fulfilled", String(reviewFulfilled)], ["Contradicted on a later call", "Earlier contradicted", String(reviewContradiction)],
    ["Still true", "Earlier still_true", null], ["Unclear", "Earlier cannot_determine", null]]);
  assert.deepEqual(s.story_discrepancies!.map(d => [d.event_kind, d.review_item_id]), [["lead_message_sent", String(reviewDisputed)]]);
  assert.deepEqual([s.suggested_next_step?.applied_at, s.suggested_next_step?.followup_id, s.suggested_next_step?.followup_due_at],
    [at(11).toISOString(), String(appliedFollowupId), "2026-09-12T15:00:00.000Z"]);
  assert.deepEqual(s.owner_instruction_assessments!.map(a => [a.assessment_word, a.instruction_text]), [["Agrees", "Corrected a finding: The move is in January, not March"]]);
  const transcriptItems = view.evidence.items.filter(i => i.kind === "transcript_quote");
  assert.ok(transcriptItems.length > 0);
  for (const item of transcriptItems) assert.deepEqual([item.quote, item.speaker, item.at], ["We are moving to Denver in January.", "customer", new Date(+at(10) + 12_000).toISOString()]);
  const recordItems = view.evidence.items.filter(i => i.kind === "analysis_record");
  assert.equal(recordItems.length, records.length, "every record type cited");
  for (const item of recordItems) assert.ok(item.text && item.record_label && item.as_of, `${item.id} record text`);

  // Twelve more findings citing transcripts and records: the query shape is unchanged (no per-finding / per-evidence read).
  const extra = Array.from({ length: 12 }, (_, i) => ({ ...envelope.findings[i % 3]!, key: `x${i}` }));
  await getIntelligenceFindingModel().collection.insertMany(extra.map(f => ({ _id: oid(), run_id: runId, key: f.key, kind: f.kind, assertion: f, review_state: "unreviewed",
    revision: 1, superseded_by: null, conversation_id: seeded.conversation._id, contact_number_id: number._id, resolved: null, purged_at: null, createdAt: at(10, 18) })) as never[]);
  const second = await counted(() => readRunPresentation(String(runId), deps));
  assert.equal(runPresentationSchema.parse(second.value!.data).summary_findings.findings.length, 15);
  assert.deepEqual(tally(second.ops), tally(first.ops), "15 findings issue exactly the queries 3 findings do");
  console.log(`# S3-PRES query shape (run presentation): ${JSON.stringify(tally(second.ops))}`);
  console.log(`# S3-PRES query shape (outreach assessment): ${JSON.stringify(tally(outreach.ops))}`);
  console.log(`# S3-PRES query shape (assessment evidence): ${JSON.stringify(tally(evidence.ops))}`);
});
