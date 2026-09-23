import { z } from "zod";
import {
  CSI_ENVELOPE_SCHEMA_VERSION, CSI_ENVELOPE_BOUNDS, intelligenceActionValueSchema,
  intelligenceEnvelopeSchema, intelligenceEvidenceRefSchema, intelligenceFindingSchema,
  type IntelligenceEvidenceRef,
} from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { CsiError } from "../auth";
import { summaryMoveEvidenceSchema } from "../assessment/contract";
import { validateEnvelopeEvidence, type EvidenceManifestEntry } from "../evidence";
import type { CapturedPromptPage } from "./prompt";

const envelopeShape = intelligenceEnvelopeSchema.shape;
const summaryTextSchema = envelopeShape.summary.omit({ finding_keys: true });
const transcriptRef = intelligenceEvidenceRefSchema.options[0];
const recordRef = intelligenceEvidenceRefSchema.options[1];
const segmentIds = transcriptRef.shape.segment_ids.min(1);
const minimalEvidenceSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("transcript"), call_index: z.number().int().nonnegative(),
    segment_ids: segmentIds, quote: transcriptRef.shape.quote }).strict(),
  z.object({ source: z.literal("context"), record: recordRef.shape.record_type,
    id: recordRef.shape.record_id }).strict(),
]);
const minimalOptions = intelligenceFindingSchema.options.map(option => option
  .omit({ key: true, speaker_ref: true, confidence: true, evidence: true })
  .extend({ evidence: z.array(minimalEvidenceSchema).min(1).max(CSI_ENVELOPE_BOUNDS.max_evidence_refs_per_finding) }));
const factOptions = intelligenceFindingSchema.options.map(option => option
  .omit({ key: true, speaker_ref: true, confidence: true, evidence: true, basis: true })
  .extend({ speaker: z.enum(["rep", "customer", "unknown"]), segment_ids: segmentIds,
    quote: transcriptRef.shape.quote }));

/**
 * Value contracts come from the submission schema; there is no second finding taxonomy.
 * Reader contract: csi-summary-v1 artifacts carry no `move_evidence` and stay readable (MA-01 §3).
 */
export const summaryStepSchema = z.object({
  summary: summaryTextSchema,
  said_on_call: z.array(z.discriminatedUnion("kind", [factOptions[0], ...factOptions.slice(1)])),
  move_evidence: summaryMoveEvidenceSchema.optional(),
}).strict();
export type SummaryStep = z.infer<typeof summaryStepSchema>;
/** csi-summary-v2 generation contract: the block is required because strict providers reject optional keys. */
export const summaryGenerationSchema = summaryStepSchema.extend({ move_evidence: summaryMoveEvidenceSchema }).strict();

export const minimalFindingsSchema = z.object({
  summary: summaryTextSchema,
  findings: z.array(z.discriminatedUnion("kind", [minimalOptions[0], ...minimalOptions.slice(1)]))
    .max(CSI_ENVELOPE_BOUNDS.max_findings),
  next_step: intelligenceActionValueSchema.extend({
    rationale: envelopeShape.next_step_suggestion.unwrap().shape.rationale,
  }).strict().nullable(),
  owner_instruction_assessments: z.array(z.object({
    instruction_index: z.number().int().nonnegative(),
    assessment: envelopeShape.owner_instruction_assessments.element.shape.assessment,
    reason: envelopeShape.owner_instruction_assessments.element.shape.reason,
  }).strict()),
}).strict();
export type MinimalFindings = z.infer<typeof minimalFindingsSchema>;

function refuse(path: string, code: string): never {
  throw new CsiError("EVIDENCE_SCOPE_INVALID", [{ path, code }]);
}

export function validateSummaryStep(raw: unknown, transcriptSegmentIds: readonly number[]): SummaryStep {
  const summary = summaryGenerationSchema.parse(raw);
  if (Object.values(summary.summary).reduce((total, section) => total + section.length, 0) > CSI_ENVELOPE_BOUNDS.max_summary_total_chars)
    refuse("summary", "summary_text_too_long");
  const allowed = new Set(transcriptSegmentIds);
  summary.said_on_call.forEach((fact, index) => {
    if (fact.segment_ids.some(id => !allowed.has(id)))
      refuse(`said_on_call.${index}.segment_ids`, "segment_not_in_transcript");
    if ("target_followup_id" in fact.value && fact.value.target_followup_id !== null)
      refuse(`said_on_call.${index}.value.target_followup_id`, "followup_not_available_in_transcript_step");
  });
  const { observations, inventory, intent_signals } = summary.move_evidence;
  for (const [list, items] of [["observations", observations], ["inventory", inventory], ["intent_signals", intent_signals]] as const)
    items.forEach((item, index) => {
      if (item.segment_ids.some(id => !allowed.has(id))) refuse(`move_evidence.${list}.${index}.segment_ids`, "segment_not_in_transcript");
    });
  return summary;
}

export type StructuredCall = CapturedPromptPage & {
  summary: SummaryStep;
  /** Server-resolved, reviewed identities for this call only. Never populated by the model. */
  speaker_refs: string[];
};
export type StructuredExpansionInputs = {
  subject_key: string;
  context: readonly CapturedPromptPage[];
  calls: readonly StructuredCall[];
  /** Ordered server-owned instruction list shown to the model, including current corrections. */
  instructions?: readonly { id: string; revision: number }[];
};

export function structuredInstructions(context: readonly CapturedPromptPage[]) {
  return [...new Map(context.flatMap(page => page.data.instructions)
    .map(instruction => [`${instruction.id}:${instruction.revision}`, instruction])).values()];
}

/** Pure expansion. Snapshot ownership, retention and digest checks remain in submission. */
export function expandStructuredFindings(raw: unknown, inputs: StructuredExpansionInputs) {
  const minimal = minimalFindingsSchema.parse(raw);
  const instructions = inputs.instructions ?? structuredInstructions(inputs.context);
  const allPages = [...inputs.context, ...inputs.calls];
  const manifest: EvidenceManifestEntry[] = [];
  for (const page of allPages) {
    for (const record of page.data.page.records) manifest.push({ snapshot_id: page.snapshot_id,
      subject_key: inputs.subject_key, source: "vantage_record", conversation_id: null,
      transcript_version: null, record_type: record.record_type, record_id: record.record_id,
      field_paths: Object.keys(record.fields) });
    if (page.data.transcript) manifest.push({ snapshot_id: page.snapshot_id,
      subject_key: inputs.subject_key, source: "transcript", conversation_id: page.data.transcript.conversation_id,
      transcript_version: page.data.transcript.transcript_version, record_type: null, record_id: null, field_paths: [] });
  }
  const findings = minimal.findings.map((finding, index) => {
    const transcriptSpeakers: Array<string | null> = [];
    const evidence = finding.evidence.flatMap((ref, refIndex): IntelligenceEvidenceRef[] => {
      const path = `findings.${index}.evidence.${refIndex}`;
      if (ref.source === "transcript") {
        const call = inputs.calls[ref.call_index];
        const transcript = call?.data.transcript;
        if (!call || !transcript) refuse(`${path}.call_index`, "call_not_in_summary");
        const facts = call.summary.said_on_call;
        const authorized = new Set(facts.flatMap(fact => fact.segment_ids));
        if (ref.segment_ids.some(id => !authorized.has(id)))
          refuse(`${path}.segment_ids`, "segment_not_in_summary");
        const speakers = [...new Set(call.speaker_refs)];
        const repSegments = ref.segment_ids.every(id => {
          const matching = facts.filter(fact => fact.segment_ids.includes(id));
          return matching.length > 0 && matching.every(fact => fact.speaker === "rep");
        });
        transcriptSpeakers.push(repSegments && speakers.length === 1 ? speakers[0] : null);
        return [{ source: "transcript", snapshot_id: call.snapshot_id,
          conversation_id: transcript.conversation_id, transcript_version: transcript.transcript_version,
          segment_ids: ref.segment_ids, quote: ref.quote }];
      }
      const matches = inputs.context.flatMap(page => page.data.page.records
        .filter(record => record.record_type === ref.record && record.record_id === ref.id)
        .map(record => ({ source: "vantage_record" as const, snapshot_id: page.snapshot_id,
          record_type: record.record_type, record_id: record.record_id, field_paths: Object.keys(record.fields) })));
      if (!matches.length) refuse(`${path}.id`, "record_not_in_context");
      return matches;
    });
    const uniqueSpeakers = [...new Set(transcriptSpeakers)];
    return { ...finding, evidence, key: `finding-${index + 1}`, confidence: null,
      speaker_ref: finding.actor === "rep" && uniqueSpeakers.length === 1 ? uniqueSpeakers[0] : null };
  });
  const envelope = intelligenceEnvelopeSchema.parse({
    schema_version: CSI_ENVELOPE_SCHEMA_VERSION,
    summary: { ...minimal.summary, finding_keys: findings.map(finding => finding.key) }, findings,
    next_step_suggestion: minimal.next_step ? { ...minimal.next_step,
      finding_keys: findings.filter(finding => finding.kind === "next_step").map(finding => finding.key) } : null,
    owner_instruction_assessments: minimal.owner_instruction_assessments.map((assessment, index) => {
      const instruction = instructions[assessment.instruction_index];
      if (!instruction) refuse(`owner_instruction_assessments.${index}.instruction_index`, "instruction_not_observed");
      return { instruction_id: instruction.id, instruction_revision: instruction.revision,
        assessment: assessment.assessment, reason: assessment.reason, finding_keys: [] };
    }),
  });
  validateEnvelopeEvidence(envelope, { subject_key: inputs.subject_key, snapshots: manifest,
    allowed_followup_ids: allPages.flatMap(page => page.data.allowed_followup_ids),
    instructions: [...instructions], speaker_refs: inputs.calls.flatMap(call => call.speaker_refs) });
  return envelope;
}
