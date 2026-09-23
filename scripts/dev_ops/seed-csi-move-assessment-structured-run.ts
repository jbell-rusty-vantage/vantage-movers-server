Object.assign(process.env, { TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: "testvantagemovers_madem0", MONGO_URI: "mongodb://127.0.0.1:27189/?replicaSet=csi01",
  SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SHEET_SYNC_MODE: "disabled", SALES_INTELLIGENCE_ENABLED: "true", AI_GATEWAY_API_KEY: "", PERSONAL_AI_GATEWAY_API_KEY: "" });
async function main() {
  const mongoose = (await import("mongoose")).default;
  const { connectMongo } = await import("../../src/db.ts");
  const { csiDataset } = await import("../../src/config/domain/salesIntelligence.ts");
  const { getIntelligenceRunModel } = await import("../../src/models/IntelligenceRun.ts");
  const { getIntelligenceFindingModel } = await import("../../src/models/IntelligenceFinding.ts");
  const { getIntelligenceEvidenceSnapshotModel } = await import("../../src/models/IntelligenceEvidenceSnapshot.ts");
  await connectMongo();
  const O = (s: string) => new mongoose.Types.ObjectId(s);
  const conversation = "6ab333c23834458a2259c029", number = "6ab333c23834458a2259c022";
  const summary = await getIntelligenceEvidenceSnapshotModel().findOne({ conversation_id: O(conversation), source_type: "summary" }).lean();
  if (!summary) throw new Error("no summary snapshot for the rich subject");
  const at = new Date("2026-09-15T15:30:00Z"), runId = new mongoose.Types.ObjectId();
  const ev = { source: "transcript", snapshot_id: String(summary._id), conversation_id: conversation, transcript_version: (summary.response as any).transcript.transcript_version, segment_ids: [1], quote: null };
  const findings = [
    { key: "finding-1", kind: "move_fact", claim: "Customer said the pickup is a fourth-floor walk-up at 1200 Very Long Boulevard Apartment 4C, San Francisco, CA 94110 and the delivery is a house in Seattle.", basis: "said_on_call", actor: "customer", speaker_ref: null, action_status: null, clarity: "clear", evidence: [ev], confidence: null, value: { field: "origin", stated_value: "1200 Very Long Boulevard Apt 4C, San Francisco, CA 94110 (4th floor walk-up)" } },
    { key: "finding-2", kind: "quoted_amount", claim: "Rep quoted about $4,800 for the full-service move including packing.", basis: "said_on_call", actor: "rep", speaker_ref: null, action_status: null, clarity: "clear", evidence: [ev], confidence: null, value: { amount_text: "about $4,800", currency: "USD", meaning: "quote_total" } },
    { key: "finding-3", kind: "promised_callback", claim: "Rep promised to call back Thursday with the written estimate.", basis: "said_on_call", actor: "rep", speaker_ref: null, action_status: "promised", clarity: "clear", evidence: [ev], confidence: null, value: { action_kind: "call", description: "Call back with the written estimate", date_text: "Thursday", timezone_text: null, target_followup_id: null } },
    { key: "finding-4", kind: "objection", claim: "Customer is comparing against two other movers and wants the price matched.", basis: "said_on_call", actor: "customer", speaker_ref: null, action_status: null, clarity: "uncertain", evidence: [ev], confidence: null, value: { description: "Comparing two other movers; wants a price match" } },
  ];
  const output = { schema_version: "csi-envelope-v1", summary: { overview: "Long conversation about a full-service move from a fourth-floor walk-up in San Francisco to a house in Seattle; the customer is comparing movers and asked for a written estimate. ".repeat(3).trim(),
    customer_wanted: "A full-service move with packing, a written estimate by Thursday, and a price match against two other quotes.", money_and_dates: "About $4,800 quoted; move window October 10–14; estimate promised Thursday.",
    outcome: "Customer will decide after receiving the written estimate.", commitments: "Rep promised a callback Thursday with the estimate.", discrepancies: "Customer's form said a 2-bedroom; on the call the inventory sounded closer to 3 bedrooms.", finding_keys: findings.map(f => f.key) },
    findings, next_step_suggestion: { action_kind: "call", description: "Send the written estimate and call Thursday", date_text: "Thursday", timezone_text: null, target_followup_id: null, rationale: "The customer is waiting on the estimate before deciding.", finding_keys: ["finding-3"] }, owner_instruction_assessments: [] };
  await getIntelligenceRunModel().collection.insertOne({ _id: runId, ...csiDataset(), subject_key: `conversation:${conversation}`, contact_number_id: O(number), conversation_id: O(conversation), outreach_record_id: O("6ab333c23834458a2259c026"),
    mode: "initial", job_id: new mongoose.Types.ObjectId(), triggering_event_ids: [], input_fingerprint: "synthetic-structured", prompt_version: "sales_intelligence_analyze_v3", schema_version: "csi-envelope-v1", schema_digest: "synthetic", model_version: "openai/gpt-5-mini",
    rendered_prompt: null, owner_correction_ids: [], owner_correction_context: [], manifest_digest: "synthetic", manifest_snapshot_ids: [summary._id], evidence_count: 1, evidence_bytes: 1000, application_cursor: 0, schema_failures: 0, schema_rejections: [], invocation_complete: true,
    processing_reason: null, finalized_at: at, output, raw_output: null, usage: { input_tokens: 1200, output_tokens: 300, reasoning_tokens: null, cached_input_tokens: null, actual_cents: 3, usage_complete: true }, pricing_snapshot: null,
    analysis_pipeline: "csi-analysis-steps-v1", application_disabled: false, step_contracts: null, step_artifacts: { summaries: [String(summary._id)], context: String(summary._id), context_digest: "synthetic" }, per_recording_ceiling_exceeded: false,
    status: "completed", result_counts: { applied: 1, blocked: 0, review: 1 }, permitted_tools: [], tool_grant_reason: null, token_nonce: null, started_at: at, submitted_at: at, completed_at: at, revision: 3, purged_at: null, purge_started_at: null, createdAt: at, updatedAt: at } as never);
  await getIntelligenceFindingModel().collection.insertMany(findings.map((f, i) => ({ _id: new mongoose.Types.ObjectId(), run_id: runId, key: f.key, assertion: f, revision: 1, conversation_id: O(conversation), contact_number_id: O(number), outreach_record_id: O("6ab333c23834458a2259c026"),
    kind: f.kind, prompt_version: "sales_intelligence_analyze_v3", schema_version: "csi-envelope-v1", model_version: "openai/gpt-5-mini", resolved: null, review_state: i === 0 ? "confirmed" : "unreviewed", superseded_by: null,
    validation: { schema_ok: true, source_snapshots_valid: true, locator_status: "not_run", entailment_check: "not_run" }, purged_at: null, purge_started_at: null, createdAt: at, updatedAt: at })) as never);
  await mongoose.connection.useDb("testvantagemovers_madem0", { useCache: true }).collection("lead_conversations").updateOne({ _id: O(conversation) }, { $set: { latest_completed_run_id: runId } });
  console.log("STRUCTURED_RUN", String(runId), "summary_snapshot", String(summary._id));
  process.exit(0);
}
void main();
