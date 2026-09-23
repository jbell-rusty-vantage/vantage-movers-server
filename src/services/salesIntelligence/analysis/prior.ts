import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../../../models/IntelligenceFinding";
import { getIntelligenceEffectModel } from "../../../models/IntelligenceEffect";
import { getMoveAssessmentArtifactModel } from "../../../models/MoveAssessmentArtifact";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { intelligenceEnvelopeSchema, intelligenceFindingSchema } from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { redactTranscript } from "../../conversations/redaction";
import { subjectKey } from "../outreach/types";
import type { CoverageDto } from "../dto";
import type { EvidenceRecord } from "./contracts";
import { readContentSchema, type ReadContent } from "./reads";
import { summaryStepSchema } from "./structuredContract";

/**
 * Prior Analysis page (context provenance specification §5.3): what earlier model runs concluded
 * about this customer, as citable records. Everything here is a model output, never a fact about
 * the customer; the findings prompt says so and asks for a relation per prior finding.
 */
export const PRIOR_LIMITS = { summaries: 40, findings: 60, effects: 300 } as const;
const DETAIL_CHARS = 6000;

export type PriorSelectionInput = {
  contact_number_id: string; subject_key: string; outreach_record_id: string | null;
  /** The conversation being analysed now: its own summary is a call, not a prior. */
  exclude_conversation_id: string | null;
  /** Nothing completed after this instant is a prior. */
  as_of: Date;
};

const iso = (v: unknown) => v instanceof Date ? v.toISOString() : null;
const clip = (v: unknown, max: number) => {
  if (typeof v !== "string") return null;
  const redacted = redactTranscript(v).text;
  return redacted.length > max ? `${redacted.slice(0, max - 12)}…[truncated]` : redacted;
};
const details = (value: unknown) => clip(JSON.stringify(value), DETAIL_CHARS);
const before = (at: unknown, asOf: Date) => !(at instanceof Date) || at <= asOf;

/** One page: newest 40 conversation summaries, the newest number synthesis, ≤ 60 findings, ≤ 1 assessment. */
export async function selectPriorAnalyses(input: PriorSelectionInput, coverage: CoverageDto): Promise<ReadContent> {
  const dataset = csiDataset();
  const records: EvidenceRecord[] = [];
  const missing: string[] = [];
  const numberId = input.contact_number_id;

  const conversations = await getLeadConversationModel().find({ contact_number_id: numberId, content_purged_at: null })
    .select("started_at state direction duration_seconds latest_transcript_version latest_completed_run_id").sort({ started_at: -1, _id: -1 }).limit(101).lean();
  if (conversations.length > 100) missing.push("prior_conversations_truncated");
  const startedAt = new Map(conversations.map(c => [String(c._id), c.started_at]));

  // Conversation summaries: the canonical artifact for each conversation's current transcript.
  let summaries = 0;
  for (const conversation of conversations) {
    const id = String(conversation._id);
    if (id === input.exclude_conversation_id || !before(conversation.started_at, input.as_of)) continue;
    if (summaries >= PRIOR_LIMITS.summaries) { missing.push(`prior_summaries_truncated:${conversations.length - summaries}`); break; }
    const rows = await getIntelligenceEvidenceSnapshotModel().find({ ...dataset, source_type: "summary", artifact_key: { $type: "string" },
      conversation_id: conversation._id, purged_at: null, purge_started_at: null }).select("response retrieved_at").sort({ _id: -1 }).limit(5).lean();
    const row = rows.find(r => (r.response as { transcript?: { transcript_version?: string } } | null)?.transcript?.transcript_version === conversation.latest_transcript_version) ?? rows[0];
    const parsed = row ? summaryStepSchema.safeParse((row.response as { analysis_summary?: unknown } | null)?.analysis_summary) : null;
    if (!row || !parsed?.success) continue;
    const summary = parsed.data;
    summaries++;
    records.push({ record_type: "prior_summary", record_id: id, revision: String(row._id), fields: {
      kind: "conversation_summary", conversation_id: id, run_id: conversation.latest_completed_run_id ? String(conversation.latest_completed_run_id) : null,
      happened_at: iso(conversation.started_at), occurred_at: iso(conversation.started_at), status: conversation.state,
      direction: conversation.direction ?? null, duration_seconds: typeof conversation.duration_seconds === "number" ? conversation.duration_seconds : null,
      description: clip(summary.summary.overview, 500),
      details: details({ sections: summary.summary, said_on_call: summary.said_on_call.slice(0, 30).map((f: (typeof summary)["said_on_call"][number]) => ({ kind: f.kind, claim: f.claim, speaker: f.speaker, action_status: f.action_status })),
        summary_snapshot_id: String(row._id), summarized_at: iso(row.retrieved_at) }),
    } });
  }

  // The newest completed number synthesis, as its own citable record (replaces the frozen string).
  const numberRun = await getIntelligenceRunModel().findOne({ ...dataset, subject_key: `number:${numberId}`, status: "completed", output: { $ne: null },
    purged_at: null, purge_started_at: null, completed_at: { $lte: input.as_of } }).select("output completed_at prompt_version model_version").sort({ completed_at: -1, _id: -1 }).lean();
  const numberEnvelope = numberRun ? intelligenceEnvelopeSchema.safeParse(numberRun.output) : null;
  if (numberRun && numberEnvelope?.success) {
    records.push({ record_type: "prior_summary", record_id: String(numberRun._id), revision: numberRun.prompt_version ?? null, fields: {
      kind: "number_synthesis", run_id: String(numberRun._id), happened_at: iso(numberRun.completed_at), occurred_at: iso(numberRun.completed_at),
      description: clip(numberEnvelope.data.summary.overview, 500), status: "completed",
      details: details({ sections: numberEnvelope.data.summary, next_step_suggestion: numberEnvelope.data.next_step_suggestion, model_version: numberRun.model_version }),
    } });
  } else {
    const number = await getContactNumberModel().findById(numberId).select("running_summary").lean();
    if (number?.running_summary?.text && before(number.running_summary.computed_at, input.as_of))
      records.push({ record_type: "prior_summary", record_id: `running-summary:${numberId}`, revision: number.running_summary.run_id ? String(number.running_summary.run_id) : null, fields: {
        kind: "number_synthesis", run_id: number.running_summary.run_id ? String(number.running_summary.run_id) : null,
        happened_at: iso(number.running_summary.computed_at), occurred_at: iso(number.running_summary.computed_at), status: "completed",
        description: clip(number.running_summary.text, 4000),
      } });
  }

  // Prior findings: latest completed run per conversation, the newest number run, and the record's own findings.
  const runIds = [...new Set([
    ...conversations.flatMap(c => c.latest_completed_run_id ? [String(c.latest_completed_run_id)] : []),
    ...(numberRun ? [String(numberRun._id)] : []),
  ])];
  const findingFilter = { contact_number_id: numberId, purged_at: null, purge_started_at: null, review_state: { $ne: "retracted" as const }, superseded_by: null, createdAt: { $lte: input.as_of },
    $or: [{ run_id: { $in: runIds } }, ...(input.outreach_record_id ? [{ outreach_record_id: input.outreach_record_id }] : [])] };
  const findings = await getIntelligenceFindingModel().find(findingFilter).sort({ _id: -1 }).limit(PRIOR_LIMITS.findings + 1).lean();
  if (findings.length > PRIOR_LIMITS.findings) missing.push(`prior_findings_truncated:${await getIntelligenceFindingModel().countDocuments(findingFilter) - PRIOR_LIMITS.findings}`);
  const kept = findings.slice(0, PRIOR_LIMITS.findings)
    .sort((a, b) => (+(startedAt.get(String(b.conversation_id)) ?? 0) - +(startedAt.get(String(a.conversation_id)) ?? 0)) || String(b._id).localeCompare(String(a._id)));
  const effects = kept.length ? await getIntelligenceEffectModel().find({ finding_id: { $in: kept.map(f => f._id) } })
    .select("finding_id effect_kind status target_id reason").limit(PRIOR_LIMITS.effects).lean() : [];
  for (const finding of kept) {
    const assertion = intelligenceFindingSchema.safeParse(finding.assertion);
    if (!assertion.success) continue;
    const claim = assertion.data;
    const at = startedAt.get(String(finding.conversation_id)) ?? finding.createdAt;
    records.push({ record_type: "prior_finding", record_id: String(finding._id), revision: String(finding.revision), fields: {
      kind: claim.kind, description: clip(claim.claim, 500), actor: claim.actor, action_status: claim.action_status,
      review_state: finding.review_state, status: finding.review_state,
      conversation_id: finding.conversation_id ? String(finding.conversation_id) : null, run_id: String(finding.run_id),
      happened_at: iso(at), occurred_at: iso(at),
      details: details({ value: claim.value, basis: claim.basis, clarity: claim.clarity, resolved: finding.resolved ? { due_at: iso(finding.resolved.due_at), amount_cents: finding.resolved.amount_cents ?? null } : null }),
      effects: effects.filter(e => String(e.finding_id) === String(finding._id)).map(e => ({ kind: e.effect_kind, status: e.status, target_id: e.target_id ? String(e.target_id) : null, reason: e.reason ?? null })),
    } });
  }

  // The Move assessment the Outreach record shows, else the newest ready one for the subject.
  const record = input.outreach_record_id ? await getOutreachRecordModel().findOne({ _id: input.outreach_record_id, primary_contact_number_id: numberId }).select("move_assessment subject").lean() : null;
  const subjects = [...new Set([input.subject_key, `number:${numberId}`, ...(record ? [subjectKey(record.subject)] : [])])];
  const artifact = await getMoveAssessmentArtifactModel().findOne({ ...dataset, status: "ready", shadow: false, purged_at: null, purge_started_at: null,
    published_at: { $lte: input.as_of }, ...(record?.move_assessment?.artifact_id ? { _id: record.move_assessment.artifact_id } : { subject_key: { $in: subjects } }) })
    .select("scores engagement conflicts published_at subject_key input_fingerprint schema_version").sort({ published_at: -1, _id: -1 }).lean();
  if (artifact) {
    const scores = artifact.scores as { transaction_intent?: { score?: number; level?: string; confidence?: string; rationale?: string }; move_likelihood?: { score?: number; level?: string; confidence?: string; rationale?: string } } | null;
    const engagement = artifact.engagement as { work_status?: string; promised_callbacks?: unknown[]; next_steps?: unknown[] } | null;
    records.push({ record_type: "prior_assessment", record_id: String(artifact._id), revision: artifact.schema_version ?? null, fields: {
      kind: "move_assessment", happened_at: iso(artifact.published_at), occurred_at: iso(artifact.published_at), status: engagement?.work_status ?? null,
      description: `Transaction intent ${scores?.transaction_intent?.score ?? "unknown"} (${scores?.transaction_intent?.level ?? "unknown"}) · Move likelihood ${scores?.move_likelihood?.score ?? "unknown"} (${scores?.move_likelihood?.level ?? "unknown"}) · ${engagement?.work_status ?? "work status unknown"}`,
      details: details({ scores, engagement, conflicts: Array.isArray(artifact.conflicts) ? artifact.conflicts.length : 0, subject_key: artifact.subject_key }),
    } });
  }

  return readContentSchema.parse({ page: { records: records.slice(0, 200), next_cursor: null, complete: records.length <= 200 && !missing.length, missing_ranges: missing },
    coverage, allowed_followup_ids: [], instructions: [], speaker_refs: [] });
}
