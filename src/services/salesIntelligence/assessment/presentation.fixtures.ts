import { payloadHash } from "../transactions";
import type { ArtifactRow, ConversationRow, EffectRow, FindingRow, FollowupLite, RunRow, SnapshotRow } from "./presentation";

/**
 * MA-04 test fixtures (not imported by runtime code). Shapes follow the MA-01
 * contract §2–§4 for artifacts and the existing envelope / structured-run
 * storage for analyses. All identifiers are synthetic.
 */
export const hex = (n: number) => n.toString(16).padStart(24, "0");
export const IDS = {
  record: hex(1), number: hex(2), lead: hex(3), conversation: hex(4), legacyRun: hex(10), structuredRun: hex(11), transcriptSnapshot: hex(20),
  recordSnapshot: hex(21), summarySnapshot: hex(22), finding: hex(30), finding2: hex(31), effect: hex(40), followup: hex(50), booking: hex(60),
  artifactNew: hex(70), artifactOld: hex(71), artifactPurged: hex(72), artifactInsufficient: hex(73), artifactFailed: hex(74), instruction: hex(80),
};
export const SUBJECT_KEY = `lead:FormLead:${IDS.lead}`;
const at = (day: number) => new Date(Date.UTC(2026, 8, day, 12));

const summaryText = { overview: "Customer is moving a two-bedroom apartment.", customer_wanted: "A quote for next month.",
  money_and_dates: "Budget around $2,000; moving October 15.", outcome: "Rep promised a callback.", commitments: "Call back Friday.", discrepancies: "" };

export function legacyEnvelope(transcriptSnapshot = IDS.transcriptSnapshot, recordSnapshot = IDS.recordSnapshot) {
  return {
    schema_version: "csi-envelope-v1",
    summary: { ...summaryText, finding_keys: ["f1", "f2"] },
    findings: [
      { key: "f1", kind: "move_fact", claim: "Moving October 15", basis: "said_on_call", actor: "customer", speaker_ref: null, action_status: null, clarity: "clear",
        confidence: null, value: { field: "move_date", stated_value: "October 15" },
        evidence: [{ source: "transcript", snapshot_id: transcriptSnapshot, conversation_id: IDS.conversation, transcript_version: "v1", segment_ids: [3, 4], quote: "We move on the fifteenth" }] },
      { key: "f2", kind: "promised_callback", claim: "Rep will call back Friday", basis: "said_on_call", actor: "rep", speaker_ref: null, action_status: "promised", clarity: "clear",
        confidence: null, value: { action_kind: "call", description: "Call back Friday", date_text: "Friday", timezone_text: null, target_followup_id: null },
        evidence: [{ source: "vantage_record", snapshot_id: recordSnapshot, record_type: "lead", record_id: IDS.lead, field_paths: ["move_date"] }] },
    ],
    next_step_suggestion: { action_kind: "send_estimate", description: "Send the estimate", date_text: null, timezone_text: null, target_followup_id: null,
      rationale: "Customer asked for a quote", finding_keys: ["f1"] },
    owner_instruction_assessments: [],
  };
}

export function legacyRun(over: Partial<RunRow> = {}): RunRow {
  return { _id: IDS.legacyRun, conversation_id: IDS.conversation, contact_number_id: IDS.number, status: "completed", output: legacyEnvelope(), analysis_pipeline: null,
    step_artifacts: null, prompt_version: "csi-agent-v3", schema_version: "csi-envelope-v1", model_version: "openai/gpt-5-mini", completed_at: at(10), createdAt: at(10),
    purged_at: null, purge_started_at: null, manifest_snapshot_ids: [IDS.transcriptSnapshot, IDS.recordSnapshot], ...over };
}
export const legacyFindings = (runId = IDS.legacyRun): FindingRow[] => {
  const envelope = legacyEnvelope();
  return [{ _id: IDS.finding, run_id: runId, revision: 1, assertion: envelope.findings[0], review_state: "confirmed", purged_at: null, conversation_id: IDS.conversation },
    { _id: IDS.finding2, run_id: runId, revision: 1, assertion: envelope.findings[1], review_state: "unreviewed", purged_at: null, conversation_id: IDS.conversation }];
};
export const legacyEffects = (): EffectRow[] => [{ _id: IDS.effect, finding_id: IDS.finding2, effect_kind: "create_followup", status: "applied", reason: null, target_id: IDS.followup }];
export const legacyActions = (): FollowupLite[] => [{ _id: IDS.followup, kind: "call", description: "Call back Friday", status: "open", due_at: at(12) }];
export const snapshot = (id: string, response: unknown, over: Partial<SnapshotRow> = {}): SnapshotRow =>
  ({ _id: id, run_id: null, response, content_digest: payloadHash(response), purged_at: null, purge_started_at: null, retrieved_at: at(9), ...over });

export function summaryArtifactResponse() {
  return {
    page: { records: [], next_cursor: null, complete: true, missing_ranges: [] },
    analysis_summary: {
      summary: { ...summaryText, overview: "Structured: customer moving a two-bedroom apartment." },
      said_on_call: [{ kind: "move_fact", claim: "Customer said they move October 15", actor: "customer", action_status: null, clarity: "clear",
        value: { field: "move_date", stated_value: "October 15" }, speaker: "customer", segment_ids: [3], quote: "We move on the fifteenth" }],
    },
    transcript: { conversation_id: IDS.conversation, transcript_version: "v1", source_snapshot_id: IDS.transcriptSnapshot, segments: [] },
    coverage: { known_through: null, gaps: [], capabilities: {}, ai_paused: false },
    allowed_followup_ids: [], instructions: [], speaker_refs: [],
  };
}
export function structuredRun(over: Partial<RunRow> = {}): RunRow {
  return legacyRun({ _id: IDS.structuredRun, analysis_pipeline: "csi-analysis-steps-v1", prompt_version: "csi-findings-v1",
    step_artifacts: { summaries: [IDS.summarySnapshot], context: hex(23), context_digest: "d" },
    output: legacyEnvelope(IDS.summarySnapshot, hex(23)), manifest_snapshot_ids: [], ...over });
}

// ---------------------------------------------------------------- Move assessment artifacts (MA-01 §2–§4)

const ref = (id: string, kind: string, locator: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ id, kind, locator, speaker: null, call_at: null, lineage: [], ...extra });
export const summaryRef = (snapshotId = IDS.summarySnapshot, digest = payloadHash(summaryArtifactResponse())) => ref("e1", "said_on_call",
  { source: "summary_artifact", snapshot_id: snapshotId, content_digest: digest, conversation_id: IDS.conversation, transcript_version: "v1", section: "said_on_call.0" },
  { speaker: "customer", call_at: "2026-09-09T12:00:00.000Z" });
export const leadRef = () => ref("e2", "lead_current", { source: "lead", model: "FormLead", id: IDS.lead, view: "current", field_path: "move_date" });
export const findingRef = () => ref("e3", "finding", { source: "finding", finding_id: IDS.finding, run_id: IDS.legacyRun, revision: 1, conversation_id: IDS.conversation }, { lineage: ["e1"] });
export const officialRef = () => ref("e4", "official_state", { source: "official", model: "BookedLead", id: IDS.booking, field_path: "booked" });
export const legacyRunRef = () => ref("e5", "legacy_summary_section", { source: "legacy_run", run_id: IDS.legacyRun, output_digest: payloadHash(legacyEnvelope()),
  conversation_id: IDS.conversation, section: "money_and_dates" });
export const conversationSummary = { text: "Plain summary", sections: { overview: "Old overview", money_dates: "Old money" }, model: "m", prompt_version: "p", created_at: "2026-09-01T00:00:00.000Z" };
export const conversationRef = () => ref("e6", "legacy_summary_section", { source: "conversation_summary", conversation_id: IDS.conversation,
  text_digest: payloadHash(conversationSummary), section: "money_dates" });
export const correctionRef = () => ref("e7", "owner_correction", { source: "owner_correction", instruction_id: IDS.instruction, revision: 2 });

const dimension = (level: string, score: number | null, evidence: unknown[]) => ({ level, confidence: "medium", rationale: `Rationale for ${level}`,
  evidence_ids: evidence.map(e => (e as { id: string }).id), conditions: [], score, evidence });
const moveView = { pickup: { city: "Austin", state: "TX", zip: "78701" }, delivery: { city: "Denver", state: "CO", zip: "80202" }, move_date: "2026-10-15",
  move_size: "2 bedroom", granot_move_size: null, cubic_feet: null, provenance: { source_system: "granot", changed_at: "2026-09-05T00:00:00.000Z", observation_id: null } };
export function modelOutput() {
  return {
    move_likelihood: { level: "strong", confidence: "medium", rationale: "Rationale for strong", evidence_ids: ["e1", "e2"], conditions: [] },
    transaction_intent: { level: "active", confidence: "medium", rationale: "Rationale for active", evidence_ids: ["e1", "e3"], conditions: [] },
    move_details: [{ field: "move_date", value: { raw_text: "the fifteenth", date: "2026-10-15", end_date: null, applies_to: "pickup", flexibility: "fixed", precision: "exact" },
      status: "stated", evidence_ids: ["e1"] }],
    inventory: { items: [{ label: "Sofa", quantity: { min: 1, max: 1 }, room: "Living room", dimensions: null, handling: null, status: "included", evidence_ids: ["e1"] }],
      coverage: "partial", limitations: ["Garage not discussed"] },
    conflicts: [{ affects: "move_date", explanation: "Lead says Oct 1, call says Oct 15", evidence_ids: ["e1", "e2"] }],
    engagement: { work_status: "worked_with_next_step", rationale: "Rep spoke with the customer and promised a callback.", evidence_ids: ["e1"],
      promised_callbacks: [{ by: "rep", raw_text: "I'll call you Friday", date: "2026-09-11", time_text: null, status: "pending", evidence_ids: ["e1"] }],
      next_steps: [] },
  };
}
export function artifact(over: Partial<ArtifactRow> = {}): ArtifactRow {
  const raw = modelOutput();
  return {
    _id: IDS.artifactNew, status: "ready", shadow: false, subject_key: SUBJECT_KEY, outreach_record_id: IDS.record, contact_number_id: IDS.number,
    schema_version: "move-assessment-v1", rubric_version: "move-rubric-v1", prompt_version: "csi-move-assessment-v1", prompt_digest: "pd", schema_digest: "sd",
    model_version: "openai/gpt-5-mini", input_fingerprint: "fp-new", input_mode: "summaries_with_findings", generated_at: at(20), context_as_of: at(20),
    latest_conversation_at: at(9), createdAt: at(20),
    scores: { move_likelihood: dimension("strong", 75, [summaryRef(), leadRef()]), transaction_intent: dimension("active", 50, [summaryRef(), findingRef()]) },
    views: { original_ingestion: { ...moveView, move_date: "2026-10-01", captured_at: "2026-09-01T00:00:00.000Z", evidence_status: "captured_at_ingestion",
      ingestion_origin: "wordpress", label: "original_form_submission" }, canonical_current: moveView,
    customer_stated: [{ ...raw.move_details[0], evidence: [summaryRef()] }] },
    inventory: { ...raw.inventory, items: [{ ...raw.inventory.items[0], evidence: [summaryRef()] }] },
    conflicts: [{ ...raw.conflicts[0], evidence: [summaryRef(), leadRef(), officialRef(), legacyRunRef(), conversationRef(), correctionRef()] }],
    coverage: { conversations_available: 2, conversations_selected: 1, findings_selected: 1, source_coverage: "partial" },
    model_output: raw,
    source_manifest: [{ kind: "summary_artifact", id: IDS.summarySnapshot, version: "digest", conversation_id: IDS.conversation, call_at: "2026-09-09T12:00:00.000Z", lineage: [] }],
    purged_at: null, purge_started_at: null, ...over,
  };
}
export const oldArtifact = () => artifact({ _id: IDS.artifactOld, input_fingerprint: "fp-old", generated_at: at(15), context_as_of: at(15), createdAt: at(15),
  input_mode: "lead_only", scores: { move_likelihood: dimension("active", 50, [leadRef()]), transaction_intent: dimension("unknown", null, []) } });
export const purgedArtifact = () => artifact({ _id: IDS.artifactPurged, status: "purged", purged_at: at(18), createdAt: at(14), scores: null, views: null, inventory: null,
  conflicts: null, coverage: null, model_output: null });
export const conversationRow = (over: Partial<ConversationRow> = {}): ConversationRow => ({ _id: IDS.conversation, summary: conversationSummary, content_purged_at: null, ...over });
