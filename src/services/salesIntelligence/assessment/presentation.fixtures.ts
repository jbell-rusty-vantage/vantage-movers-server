import { payloadHash } from "../transactions";
import type { ArtifactRow, ConversationRow, EffectRow, FindingRow, FollowupLite, RunRow, SnapshotRow, TranscriptRow } from "./presentation";

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
      move_evidence: summaryMoveEvidence(),
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
export const conversationRow = (over: Partial<ConversationRow> = {}): ConversationRow => ({ _id: IDS.conversation, summary: conversationSummary, content_purged_at: null, started_at: at(9), ...over });

// ---------------------------------------------------------------- S3-PRES presentation contract (data spec §6.11)

/** csi-summary-v2 `move_evidence`: cited as ONE flat list (observations, then inventory, then intent signals). */
export function summaryMoveEvidence() {
  return {
    observations: [{ field: "money", value: { basis: "quote", amount: { min: 4200, max: 4200 }, currency: "USD", text: "forty-two hundred" }, status: "stated",
      speaker: "rep", segment_ids: [5] }],
    inventory: [{ label: "Piano", quantity: { min: 1, max: 1 }, room: "Living room", dimensions: null, handling: "Needs a crew of four", status: "included",
      speaker: "customer", segment_ids: [6] }],
    intent_signals: [{ signal: "booking_readiness", text: "Ready to book this week", speaker: "customer", segment_ids: [7] }],
  };
}
export const moveEvidenceRef = (index: number, id = `e-move-${index}`) => ref(id, "move_evidence",
  { source: "summary_artifact", snapshot_id: IDS.summarySnapshot, content_digest: payloadHash(summaryArtifactResponse()), conversation_id: IDS.conversation,
    transcript_version: "v1", section: `move_evidence.${index}` }, { speaker: "customer", call_at: "2026-09-09T12:00:00.000Z" });
export const sectionRef = (section: string) => ref(`e-section-${section}`, "summary_section",
  { source: "summary_artifact", snapshot_id: IDS.summarySnapshot, content_digest: payloadHash(summaryArtifactResponse()), conversation_id: IDS.conversation,
    transcript_version: "v1", section }, { call_at: "2026-09-09T12:00:00.000Z" });
export const ingestedRef = () => ref("e8", "lead_ingested", { source: "lead", model: "FormLead", id: IDS.lead, view: "ingested", field_path: "ingested_move_snapshot.move_date" });
export const officialLeadRef = () => ref("e9", "official_state", { source: "official", model: "FormLead", id: IDS.lead, field_path: "booked" });

/** The source transcript a structured summary artifact points at (`transcript.source_snapshot_id`); its own `segments` are empty. */
export const transcriptRow = (over: Partial<TranscriptRow> = {}): TranscriptRow => ({ _id: IDS.transcriptSnapshot, conversation_id: IDS.conversation, purged_at: null,
  segments: [{ sid: 3, start_ms: 65_000, speaker: "customer", text: "We move on the fifteenth" }, { sid: 4, start_ms: 70_000, speaker: "customer", text: "of October." }], ...over });
export const instructionRow = () => ({ instruction_id: IDS.instruction, revision: 2, field: "assertion", happened_at: at(11),
  current: { review_state: "corrected", replacement: null, reason: "Customer moves on the 20th, not the 15th" } });

/** One record of every type the findings step may cite (`EVIDENCE_RECORD_TYPES`). */
export const RECORD_FIXTURES: Array<{ record_type: string; record_id: string; revision: string | null; fields: Record<string, unknown> }> = [
  { record_type: "lead", record_id: IDS.lead, revision: "1", fields: { model: "FormLead", name: "Synthetic Customer", job_no: "J-100", move_date: "2026-10-15", pickup: "Austin, TX", delivery: "Denver, CO" } },
  { record_type: "booking", record_id: IDS.booking, revision: "1", fields: { name: "Synthetic Customer", job_no: "J-100", occurred_at: "2026-09-12T15:00:00.000Z", cancelled: false } },
  { record_type: "cancellation", record_id: hex(61), revision: "1", fields: { name: "Synthetic Customer", job_no: "J-100", occurred_at: "2026-09-13T15:00:00.000Z" } },
  { record_type: "interaction", record_id: hex(62), revision: "2", fields: { direction: "Inbound", result: "Accepted", duration_seconds: 312, occurred_at: "2026-09-09T12:00:00.000Z" } },
  { record_type: "outreach", record_id: IDS.record, revision: "4", fields: { status: "open", agent_id: null } },
  { record_type: "followup", record_id: IDS.followup, revision: "1", fields: { status: "open", description: "Call back Friday", due_at: "2026-09-12T14:00:00.000Z" } },
  { record_type: "rep_identity", record_id: hex(63), revision: "f", fields: { status: "resolved", agent_id: hex(64), account_id: "acct", extension_id: "101" } },
  { record_type: "owner_instruction", record_id: IDS.instruction, revision: "2", fields: { instruction_field: "assertion", details: "{\"review_state\":\"corrected\"}", status: "active" } },
  { record_type: "owner_note", record_id: hex(65), revision: "1", fields: { description: "Customer prefers texts" } },
  { record_type: "contact_number", record_id: IDS.number, revision: "3", fields: { phone: "+12025550123", status: "allowed", certainty: "customer" } },
  { record_type: "agent", record_id: hex(64), revision: null, fields: { name: "Rep Synthetic", role: "sales", active: true } },
  { record_type: "granot_source", record_id: hex(66), revision: null, fields: { name: "Top10", source: "Top10 Movers", active: true } },
  { record_type: "ringcentral_queue", record_id: hex(67), revision: null, fields: { name: "Sales queue" } },
  { record_type: "ringcentral_user", record_id: hex(68), revision: null, fields: { name: "Rep Synthetic", extension_id: "101" } },
  { record_type: "job_timeline", record_id: hex(69), revision: null, fields: { description: "Estimate sent", occurred_at: "2026-09-10T15:00:00.000Z", status: "sent" } },
  { record_type: "story_event", record_id: `lead_message_sent:${hex(70)}`, revision: null, fields: { kind: "lead_message_sent", description: "Vantage texted the estimate link.",
    happened_at: "2026-09-10T16:00:00.000Z", occurred_at: "2026-09-10T16:00:00.000Z" } },
  { record_type: "granot_state", record_id: `FormLead:${IDS.lead}`, revision: null, fields: { description: "Priority 3 (Quoted), estimate $4,200", occurred_at: "2026-09-11T12:00:00.000Z" } },
  { record_type: "prior_summary", record_id: hex(71), revision: hex(72), fields: { kind: "conversation_summary", description: "Earlier call: customer asked for a quote.", happened_at: "2026-09-05T12:00:00.000Z" } },
  { record_type: "prior_finding", record_id: hex(90), revision: "1", fields: { kind: "promised_callback", description: "Rep will call back Monday", happened_at: "2026-09-05T12:00:00.000Z" } },
  { record_type: "prior_assessment", record_id: IDS.artifactOld, revision: "move-assessment-v1", fields: { description: "Transaction intent 50 (active) · Move likelihood 75 (strong)", happened_at: "2026-09-15T12:00:00.000Z" } },
];
export function contextResponse() {
  return { page: { records: RECORD_FIXTURES, next_cursor: null, complete: true, missing_ranges: [] },
    coverage: { known_through: null, gaps: [], capabilities: {}, ai_paused: false }, allowed_followup_ids: [], instructions: [], speaker_refs: [] };
}
export const CONTEXT_SNAPSHOT = hex(23);
export const PRIOR = { superseded: hex(90), fulfilled: hex(91), contradicted: hex(92), still_true: hex(93), cannot_determine: hex(94) } as const;
export const STORY_EVENT = `lead_message_sent:${hex(70)}`;
const transcriptEvidence = (snapshotId: string, segment_ids: number[]) =>
  ({ source: "transcript" as const, snapshot_id: snapshotId, conversation_id: IDS.conversation, transcript_version: "v1", segment_ids, quote: null });
/** A structured findings envelope with every relation kind, a story discrepancy and an Owner-instruction assessment. */
export function relationsEnvelope() {
  const base = legacyEnvelope(IDS.summarySnapshot, CONTEXT_SNAPSHOT);
  const t = transcriptEvidence(IDS.summarySnapshot, [3, 4]);
  return { ...base,
    findings: base.findings.map(f => ({ ...f, evidence: f.evidence.map(e => e.source === "transcript" ? { ...e, quote: null } : e) })),
    owner_instruction_assessments: [{ instruction_id: IDS.instruction, instruction_revision: 2, assessment: "disagrees", reason: "The call says the 15th.", finding_keys: ["f1"] }],
    prior_finding_relations: [
      { prior_finding_id: PRIOR.superseded, relation: "superseded", by_finding_key: "f2", evidence: [t], note: "Rescheduled to Friday" },
      { prior_finding_id: PRIOR.fulfilled, relation: "fulfilled", by_finding_key: "f2", evidence: [t], note: null },
      { prior_finding_id: PRIOR.contradicted, relation: "contradicted", by_finding_key: "f1", evidence: [t], note: "Date changed" },
      { prior_finding_id: PRIOR.still_true, relation: "still_true", by_finding_key: null, evidence: [t], note: null },
      { prior_finding_id: PRIOR.cannot_determine, relation: "cannot_determine", by_finding_key: null, evidence: [], note: null },
    ],
    story_discrepancies: [{ story_event_id: STORY_EVENT, claim: "Customer says the estimate text never arrived", evidence: [t] }],
  };
}
export const priorFindings = (): FindingRow[] => Object.entries(PRIOR).map(([relation, id]) => ({ _id: id, run_id: IDS.legacyRun, revision: 1, review_state: "unreviewed",
  purged_at: null, conversation_id: IDS.conversation, key: `p-${relation}`, kind: "promised_callback",
  assertion: { ...legacyEnvelope().findings[1], key: `p-${relation}`, claim: `Earlier claim (${relation})` } }));
export function relationsRun(over: Partial<RunRow> = {}): RunRow {
  return structuredRun({ output: relationsEnvelope(), subject_key: `conversation:${IDS.conversation}`, ...over });
}
