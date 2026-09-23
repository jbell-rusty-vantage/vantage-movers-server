import type { ClientSession } from "mongoose";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../../../models/IntelligenceFinding";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { getFormLeadModel } from "../../../models/FormLead";
import { getCallLeadModel } from "../../../models/CallLead";
import { intelligenceEnvelopeSchema, intelligenceFindingSchema } from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { redactTranscript } from "../../conversations/redaction";
import { restoreAnalysisArtifact } from "../analysis/structuredArtifacts";
import { STRUCTURED_PIPELINE } from "../analysis/structuredPrompt";
import { jsonValue } from "../outreach/store";
import { CsiError } from "../auth";
import { payloadHash } from "../transactions";
import { isObjectIdString, toObjectId } from "../../../utils/objectId";
import {
  CONVERSATION_SUMMARY_SECTIONS, SUMMARY_SECTIONS, summaryMoveEvidenceSchema,
  type EvidenceCatalogEntry, type SourceManifestEntry,
} from "./contract";
import type { LeadMoveSource } from "./views";
import type { RecordRow } from "../outreach/types";

/**
 * Deterministic assessment source adapters (MA-01 §6). Reads Mongo, never writes, never
 * fetches transcript segments or media. Entry ids here are provisional (`src:` / `fnd:` /
 * `cor:`); `assembleAssessmentContext` assigns the invocation-scoped `e1..eN`.
 */
export const MAX_ASSESSMENT_CONVERSATIONS = 40;
export const MAX_ASSESSMENT_ENTRIES = 200;
const MAX_CANDIDATE_CONVERSATIONS = 200;
const ASSESSMENT_FINDING_KINDS = new Set(["move_fact", "quoted_amount", "intent", "objection", "competitor_mention", "booking_claim", "payment_claim"]);
const CORRECTION_FIELD_LIST = ["closure", "description", "kind", "status"] as const;
const CORRECTION_FIELDS = new Set<string>(CORRECTION_FIELD_LIST);

type Text = string | null | undefined;
type LeadModel = "FormLead" | "CallLead";
export type ConversationRow = {
  _id: unknown; started_at: Date; latest_transcript_version?: Text; content_purged_at?: Date | null;
  latest_completed_run_id?: unknown; analysis_eligibility?: { status?: Text } | null;
  summary?: { sections?: Partial<Record<(typeof CONVERSATION_SUMMARY_SECTIONS)[number], Text>> | null; text?: Text;
    model?: Text; prompt_version?: Text; created_at?: Date | null } | null;
};
export type SummaryArtifactRow = { _id: unknown; conversation_id?: unknown; content_digest: string; response: unknown;
  purged_at?: Date | null; purge_started_at?: Date | null };
export type LegacyRunRow = { _id: unknown; conversation_id?: unknown; status: string; completed_at?: Date | null;
  analysis_pipeline?: Text; output?: unknown; purged_at?: Date | null; purge_started_at?: Date | null };
export type FindingRow = { _id: unknown; run_id: unknown; conversation_id?: unknown; revision: number; kind: string;
  review_state: string; superseded_by?: unknown; assertion: unknown; purged_at?: Date | null; purge_started_at?: Date | null };
export type InstructionRow = { instruction_id: unknown; subject_key: string; field: string; current: unknown; revision: number; state: string };
export type SubjectRecordRow = {
  _id: unknown; subject: RecordRow["subject"];
  state: string; revision: number; primary_contact_number_id: unknown; closure_origin?: Text;
  lead_attachment?: { attachment_id?: unknown; state: string } | null; lead_attachment_revision?: number | null;
  lead_progress?: { disposition_revision?: Text } | null;
};
export type NumberRow = { _id: unknown; kind: string; classification: string; purged_at?: Date | null; content_purge_pending?: boolean | null };
export type AttachmentRow = { _id: unknown; lead_ref: { model: LeadModel; id: unknown }; state: string; revision: number };
export type LeadRow = LeadMoveSource & { _id: unknown; booked?: unknown; cancelled?: unknown; duplicate?: boolean | null;
  bad_lead?: unknown; no_sync?: boolean | null };

/** Narrow read seam: production uses Mongo; tests inject fixtures. */
export type AssessmentReader = {
  conversations(numberId: string): Promise<ConversationRow[]>;
  summaryArtifacts(conversationIds: string[]): Promise<SummaryArtifactRow[]>;
  legacyRuns(conversationIds: string[]): Promise<LegacyRunRow[]>;
  findings(runIds: string[]): Promise<FindingRow[]>;
  instructions(subjectKeys: string[]): Promise<InstructionRow[]>;
  record(query: { id: string } | { subject_key: string }): Promise<SubjectRecordRow | null>;
  number(id: string): Promise<NumberRow | null>;
  attachments(numberId: string): Promise<AttachmentRow[]>;
  lead(ref: { model: LeadModel; id: string }): Promise<LeadRow | null>;
};

function subjectFilter(subjectKey: string) {
  const [kind, a, b, extra] = subjectKey.split(":");
  if (extra !== undefined || ![a, b].every(part => part === undefined || isObjectIdString(part) || part === "FormLead" || part === "CallLead"))
    throw new CsiError("INVALID_INPUT");
  if (kind === "lead" && (a === "FormLead" || a === "CallLead") && b) return { "subject.kind": "lead" as const, "subject.model": a as LeadModel, "subject.id": toObjectId(b) };
  if (kind === "number" && a && !b) return { "subject.kind": "number_review" as const, "subject.contact_number_id": toObjectId(a) };
  throw new CsiError("INVALID_INPUT");
}

export function mongoAssessmentReader(session?: ClientSession): AssessmentReader {
  const s = session ?? null;
  return {
    conversations: numberId => getLeadConversationModel().find({ contact_number_id: numberId })
      .select("started_at latest_transcript_version content_purged_at latest_completed_run_id analysis_eligibility summary")
      .sort({ started_at: 1, _id: 1 }).limit(MAX_CANDIDATE_CONVERSATIONS + 1).session(s).lean<ConversationRow[]>(),
    summaryArtifacts: ids => getIntelligenceEvidenceSnapshotModel().find({ ...csiDataset(), source_type: "summary",
      artifact_key: { $type: "string" }, conversation_id: { $in: ids }, purged_at: null, purge_started_at: null })
      .select("conversation_id content_digest response purged_at purge_started_at").sort({ _id: -1 }).limit(401).session(s).lean<SummaryArtifactRow[]>(),
    legacyRuns: ids => getIntelligenceRunModel().find({ ...csiDataset(), conversation_id: { $in: ids }, status: "completed",
      output: { $ne: null }, purged_at: null, purge_started_at: null, analysis_pipeline: { $ne: STRUCTURED_PIPELINE } })
      .select("conversation_id status completed_at analysis_pipeline output purged_at purge_started_at")
      .sort({ completed_at: -1, _id: -1 }).limit(401).session(s).lean<LegacyRunRow[]>(),
    findings: runIds => getIntelligenceFindingModel().find({ run_id: { $in: runIds }, purged_at: null, purge_started_at: null,
      review_state: { $ne: "retracted" }, superseded_by: null, kind: { $in: [...ASSESSMENT_FINDING_KINDS] } })
      .sort({ _id: 1 }).limit(MAX_ASSESSMENT_ENTRIES + 1).session(s).lean<FindingRow[]>(),
    instructions: keys => getSalesIntelligenceOwnerInstructionModel().find({ subject_key: { $in: keys }, state: "active",
      field: { $in: [...CORRECTION_FIELD_LIST] } }).sort({ _id: 1 }).limit(101).session(s).lean<InstructionRow[]>(),
    record: query => "id" in query ? getOutreachRecordModel().findById(query.id).session(s).lean<SubjectRecordRow>()
      : getOutreachRecordModel().findOne(subjectFilter(query.subject_key)).session(s).lean<SubjectRecordRow>(),
    number: id => getContactNumberModel().findById(id).select("kind classification purged_at content_purge_pending").session(s).lean<NumberRow>(),
    attachments: numberId => getNumberLeadAttachmentModel().find({ contact_number_id: numberId, state: { $ne: "rejected" } })
      .select("lead_ref state revision").sort({ _id: 1 }).limit(101).session(s).lean<AttachmentRow[]>(),
    lead: ref => ref.model === "FormLead" ? getFormLeadModel().findById(ref.id).select(LEAD_FIELDS).session(s).lean<LeadRow>()
      : getCallLeadModel().findById(ref.id).select(LEAD_FIELDS).session(s).lean<LeadRow>(),
  };
}
const LEAD_FIELDS = "pickup_city pickup_state pickup_zip delivery_city delivery_state destination_zip delivery_zip move_date move_size granot_move_size cubic_feet ingestion_origin current_move_provenance ingested_move_snapshot booked cancelled duplicate bad_lead no_sync";

const redact = (value: string) => redactTranscript(value).text;
const present = (value: Text): value is string => typeof value === "string" && value.trim().length > 0;

export type SelectedConversation = {
  conversation_id: string; call_at: string; source: SourceManifestEntry; entries: EvidenceCatalogEntry[];
  /** Run whose findings may support this conversation, with the transcript version they must cite (null for legacy runs). */
  finding_run: { run_id: string; transcript_version: string | null } | null;
  /** said_on_call entry id → fact kind and cited segments, for finding lineage without re-reading. */
  said: Record<string, { kind: string; segment_ids: number[] }>;
};
export type ConversationSelection = {
  conversations: SelectedConversation[];
  skipped: Array<{ conversation_id: string; reason: string }>;
};

function fromSummaryArtifact(row: SummaryArtifactRow, conversation: ConversationRow, callAt: string): SelectedConversation | null {
  let data;
  try { data = restoreAnalysisArtifact(row).data; } catch { return null; }
  const summary = data.analysis_summary, transcript = data.transcript;
  if (!summary || !transcript || transcript.transcript_version !== conversation.latest_transcript_version) return null;
  const conversationId = String(conversation._id);
  const locator = { source: "summary_artifact" as const, snapshot_id: String(row._id), content_digest: row.content_digest,
    conversation_id: conversationId, transcript_version: transcript.transcript_version };
  const entries: EvidenceCatalogEntry[] = SUMMARY_SECTIONS.flatMap(section => present(summary.summary[section]) ? [{
    id: `src:${conversationId}:${section}`, kind: "summary_section" as const, text: redact(summary.summary[section]),
    locator: { ...locator, section }, call_at: callAt, lineage: [] }] : []);
  const said: SelectedConversation["said"] = {};
  summary.said_on_call.forEach((fact, index) => (said[`src:${conversationId}:said_on_call.${index}`] = { kind: fact.kind, segment_ids: fact.segment_ids }));
  summary.said_on_call.forEach((fact, index) => entries.push({ id: `src:${conversationId}:said_on_call.${index}`, kind: "said_on_call",
    text: redact(`[${fact.kind}${fact.action_status ? `/${fact.action_status}` : ""}${fact.clarity === "uncertain" ? "/uncertain" : ""}] ${fact.claim} ${JSON.stringify(fact.value)}`),
    locator: { ...locator, section: `said_on_call.${index}` }, speaker: fact.speaker, call_at: callAt, lineage: [] }));
  // csi-summary-v2 only; v1 artifacts have no block and stay fully usable.
  const moveEvidence = summaryMoveEvidenceSchema.safeParse((summary as { move_evidence?: unknown }).move_evidence);
  if (moveEvidence.success) {
    const { observations, inventory, intent_signals } = moveEvidence.data;
    [...observations.map(({ speaker, segment_ids: _s, ...value }) => ({ speaker, text: JSON.stringify(value) })),
      ...inventory.map(({ speaker, segment_ids: _s, ...item }) => ({ speaker, text: JSON.stringify({ inventory_item: item }) })),
      ...intent_signals.map(({ speaker, segment_ids: _s, ...signal }) => ({ speaker, text: JSON.stringify({ intent_signal: signal }) })),
    ].forEach((item, index) => entries.push({ id: `src:${conversationId}:move_evidence.${index}`, kind: "move_evidence",
      text: redact(item.text), locator: { ...locator, section: `move_evidence.${index}` }, speaker: item.speaker, call_at: callAt, lineage: [] }));
  }
  if (!entries.length) return null;
  return { conversation_id: conversationId, call_at: callAt, entries, said,
    source: { kind: "summary_artifact", id: String(row._id), version: row.content_digest, conversation_id: conversationId, call_at: callAt },
    finding_run: conversation.latest_completed_run_id && conversation.latest_transcript_version
      ? { run_id: String(conversation.latest_completed_run_id), transcript_version: conversation.latest_transcript_version } : null };
}

function fromLegacyRun(row: LegacyRunRow, conversationId: string, callAt: string): SelectedConversation | null {
  const parsed = intelligenceEnvelopeSchema.shape.summary.safeParse((row.output as { summary?: unknown } | null)?.summary);
  if (!parsed.success) return null;
  const output_digest = payloadHash(jsonValue(row.output));
  // A legacy narrative citation stays a stored-summary citation; it is never a transcript segment.
  const entries: EvidenceCatalogEntry[] = SUMMARY_SECTIONS.flatMap(section => present(parsed.data[section]) ? [{
    id: `src:${conversationId}:${section}`, kind: "legacy_summary_section" as const, text: redact(parsed.data[section]),
    locator: { source: "legacy_run" as const, run_id: String(row._id), output_digest, conversation_id: conversationId, section },
    call_at: callAt, lineage: [] }] : []);
  if (!entries.length) return null;
  return { conversation_id: conversationId, call_at: callAt, entries, said: {},
    source: { kind: "legacy_run", id: String(row._id), version: output_digest, conversation_id: conversationId, call_at: callAt },
    finding_run: { run_id: String(row._id), transcript_version: null } };
}

function fromConversationSummary(conversation: ConversationRow, callAt: string): SelectedConversation | null {
  const summary = conversation.summary;
  if (!summary || !present(summary.model) || !present(summary.prompt_version)) return null;
  const conversationId = String(conversation._id), text_digest = payloadHash(jsonValue(summary));
  const locator = { source: "conversation_summary" as const, conversation_id: conversationId, text_digest };
  const sections = CONVERSATION_SUMMARY_SECTIONS.filter(section => section !== "text" && present(summary.sections?.[section]));
  const entries: EvidenceCatalogEntry[] = sections.length
    ? sections.map(section => ({ id: `src:${conversationId}:${section}`, kind: "legacy_summary_section" as const,
      text: redact(summary.sections![section]!), locator: { ...locator, section }, call_at: callAt, lineage: [] }))
    : present(summary.text) ? [{ id: `src:${conversationId}:text`, kind: "legacy_summary_text", text: redact(summary.text),
      locator: { ...locator, section: "text" }, call_at: callAt, lineage: [] }] : [];
  if (!entries.length) return null;
  return { conversation_id: conversationId, call_at: callAt, entries, finding_run: null, said: {},
    source: { kind: "conversation_summary", id: conversationId, version: text_digest, conversation_id: conversationId, call_at: callAt } };
}

/**
 * Exactly one summary version per conversation on this Contact Number, in preference order:
 * canonical structured artifact of the current transcript → newest retained completed legacy
 * run → `LeadConversation.summary` with provenance. Chronological by call time.
 */
export async function selectConversationSources(numberId: string, options: { session?: ClientSession; reader?: AssessmentReader } = {}): Promise<ConversationSelection> {
  const reader = options.reader ?? mongoAssessmentReader(options.session);
  const rows = await reader.conversations(numberId);
  if (rows.length > MAX_CANDIDATE_CONVERSATIONS) throw new CsiError("EVIDENCE_LIMIT_REACHED");
  const skipped: ConversationSelection["skipped"] = [];
  const candidates = rows.filter(row => {
    const reason = row.content_purged_at ? "content_purged" : row.analysis_eligibility?.status === "excluded" ? "analysis_excluded" : null;
    if (reason) skipped.push({ conversation_id: String(row._id), reason });
    return !reason;
  });
  const ids = candidates.map(row => String(row._id));
  const [artifacts, runs] = ids.length ? await Promise.all([reader.summaryArtifacts(ids), reader.legacyRuns(ids)]) : [[], []];
  const conversations: SelectedConversation[] = [];
  for (const conversation of candidates) {
    const id = String(conversation._id), callAt = conversation.started_at.toISOString();
    // Newest first; a digest/shape failure falls through to the next retained candidate.
    const artifactRows = artifacts.filter(row => String(row.conversation_id) === id && !row.purged_at && !row.purge_started_at)
      .sort((a, b) => String(b._id).localeCompare(String(a._id)));
    let selected: SelectedConversation | null = null;
    for (const row of artifactRows) if ((selected = fromSummaryArtifact(row, conversation, callAt))) break;
    if (!selected) {
      const legacy = runs.filter(run => String(run.conversation_id) === id && run.status === "completed" && run.output != null &&
        !run.purged_at && !run.purge_started_at && run.analysis_pipeline !== STRUCTURED_PIPELINE)
        .sort((a, b) => +(b.completed_at ?? 0) - +(a.completed_at ?? 0) || String(b._id).localeCompare(String(a._id)));
      for (const run of legacy) if ((selected = fromLegacyRun(run, id, callAt))) break;
    }
    selected ??= fromConversationSummary(conversation, callAt);
    if (selected) conversations.push(selected);
    else skipped.push({ conversation_id: id, reason: "no_retained_summary" });
  }
  conversations.sort((a, b) => a.call_at.localeCompare(b.call_at) || a.conversation_id.localeCompare(b.conversation_id));
  if (conversations.length > MAX_ASSESSMENT_CONVERSATIONS ||
    conversations.reduce((total, c) => total + c.entries.length, 0) > MAX_ASSESSMENT_ENTRIES) throw new CsiError("EVIDENCE_LIMIT_REACHED");
  return { conversations, skipped };
}

type Section = (typeof SUMMARY_SECTIONS)[number] | (typeof CONVERSATION_SUMMARY_SECTIONS)[number];
function findingSections(kind: string, field: unknown): Section[] {
  if (kind === "quoted_amount" || (kind === "move_fact" && field === "move_date")) return ["money_and_dates", "money_dates"];
  if (kind === "move_fact" || kind === "intent") return ["customer_wanted"];
  if (kind === "objection" || kind === "competitor_mention") return ["outcome"];
  return ["commitments", "promised"];
}

/**
 * Optional supporting observations from already-retained findings of the selected source run.
 * Each finding carries `lineage` to the summary entry that already states it, so the pair is
 * one observation, not two confirmations. Action kinds, next steps and inferences are excluded.
 */
export async function selectRetainedFindings(selection: readonly SelectedConversation[],
  options: { session?: ClientSession; reader?: AssessmentReader } = {}): Promise<{ entries: EvidenceCatalogEntry[]; manifest: SourceManifestEntry[] }> {
  const byRun = new Map(selection.flatMap(c => c.finding_run ? [[c.finding_run.run_id, c] as const] : []));
  if (!byRun.size) return { entries: [], manifest: [] };
  const reader = options.reader ?? mongoAssessmentReader(options.session);
  const rows = await reader.findings([...byRun.keys()]);
  if (rows.length > MAX_ASSESSMENT_ENTRIES) throw new CsiError("EVIDENCE_LIMIT_REACHED");
  const entries: EvidenceCatalogEntry[] = [], manifest: SourceManifestEntry[] = [];
  for (const row of [...rows].sort((a, b) => String(a._id).localeCompare(String(b._id)))) {
    const conversation = byRun.get(String(row.run_id));
    if (!conversation || row.purged_at || row.purge_started_at || row.review_state === "retracted" || row.superseded_by ||
      !ASSESSMENT_FINDING_KINDS.has(row.kind)) continue;
    const parsed = intelligenceFindingSchema.safeParse(row.assertion);
    if (!parsed.success || parsed.data.kind !== row.kind || parsed.data.basis === "model_inference") continue;
    const finding = parsed.data;
    const transcriptRefs = finding.evidence.flatMap(ref => ref.source === "transcript" && ref.conversation_id === conversation.conversation_id ? [ref] : []);
    if (row.conversation_id ? String(row.conversation_id) !== conversation.conversation_id : !transcriptRefs.length) continue;
    // A summary artifact's findings must cite the same transcript version the summary covers.
    const version = conversation.finding_run!.transcript_version;
    if (version && (!transcriptRefs.length || transcriptRefs.some(ref => ref.transcript_version !== version))) continue;
    const segments = new Set(transcriptRefs.flatMap(ref => ref.segment_ids));
    const said = conversation.entries.find(entry => conversation.said[entry.id]?.kind === finding.kind &&
      conversation.said[entry.id].segment_ids.some(id => segments.has(id)));
    const sections = findingSections(finding.kind, "field" in finding.value ? finding.value.field : null);
    const source = said ?? conversation.entries.find(entry => "section" in entry.locator &&
      sections.some(section => entry.locator.source !== "finding" && "section" in entry.locator && entry.locator.section === section)) ?? conversation.entries[0];
    const findingId = String(row._id), runId = String(row.run_id);
    entries.push({ id: `fnd:${findingId}`, kind: "finding", text: redact(finding.claim), speaker: finding.actor, call_at: conversation.call_at,
      locator: { source: "finding", finding_id: findingId, run_id: runId, revision: row.revision, conversation_id: conversation.conversation_id },
      lineage: [source.id] });
    manifest.push({ kind: "finding", id: findingId, version: String(row.revision), conversation_id: conversation.conversation_id,
      call_at: conversation.call_at, lineage: [conversation.source.id] });
  }
  return { entries, manifest };
}

/** Active Owner corrections on the subject's keys that bear on applicability or the stated move. */
export async function selectCorrections(subjectKeys: readonly string[], options: { session?: ClientSession; reader?: AssessmentReader } = {}) {
  const reader = options.reader ?? mongoAssessmentReader(options.session);
  const rows = await reader.instructions([...new Set(subjectKeys)]);
  if (rows.length > 100) throw new CsiError("EVIDENCE_LIMIT_REACHED");
  return rows.filter(row => row.state === "active" && CORRECTION_FIELDS.has(row.field))
    .sort((a, b) => String(a.instruction_id).localeCompare(String(b.instruction_id)))
    .map(row => ({
      entry: { id: `cor:${row.instruction_id}`, kind: "owner_correction" as const, lineage: [],
        text: redact(`${row.field}: ${JSON.stringify(row.current)}`),
        locator: { source: "owner_correction" as const, instruction_id: String(row.instruction_id), revision: row.revision } },
      manifest: { kind: "owner_correction" as const, id: String(row.instruction_id), version: String(row.revision) },
    }));
}
