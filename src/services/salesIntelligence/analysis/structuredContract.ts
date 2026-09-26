import { z } from "zod";
import {
  CSI_ENVELOPE_SCHEMA_VERSION, CSI_ENVELOPE_BOUNDS, PRIOR_FINDING_RELATIONS, intelligenceActionValueSchema,
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

/**
 * Context provenance §6.2: the two additive findings-step outputs. Indices point into the
 * prompt's `prior.findings` and `story.events` lists; the server resolves them to record ids.
 * Both arrays are required in the generation contract (strict providers reject optional keys)
 * and empty when nothing applies.
 */
const priorFindingRelationOutputSchema = z.object({
  prior_index: z.number().int().nonnegative(),
  relation: z.enum(PRIOR_FINDING_RELATIONS),
  by_finding_index: z.number().int().nonnegative().nullable(),
  evidence: z.array(minimalEvidenceSchema).max(CSI_ENVELOPE_BOUNDS.max_evidence_refs_per_finding),
  note: envelopeShape.summary.shape.overview.max(200).nullable(),
}).strict();
const storyDiscrepancyOutputSchema = z.object({
  story_index: z.number().int().nonnegative(),
  claim: z.string().min(1).max(300),
  evidence: z.array(minimalEvidenceSchema).min(1).max(CSI_ENVELOPE_BOUNDS.max_evidence_refs_per_finding),
}).strict();

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
  prior_finding_relations: z.array(priorFindingRelationOutputSchema).max(60),
  story_discrepancies: z.array(storyDiscrepancyOutputSchema).max(20),
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
  /** The `prior_finding` record ids in the order the prompt listed them (context provenance §5.4). */
  prior_finding_ids?: readonly string[];
  /** The `story_event` record ids in the order the prompt listed them. */
  story_event_ids?: readonly string[];
};

export function structuredInstructions(context: readonly CapturedPromptPage[]) {
  return [...new Map(context.flatMap(page => page.data.instructions)
    .map(instruction => [`${instruction.id}:${instruction.revision}`, instruction])).values()];
}

const HINT_LIMIT = 20, NEAR_DISTANCE = 4, NEAR_LIMIT = 3;
function editDistance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length];
}

/**
 * Repair hints for a findings object the validator refused (never part of the refusal itself, which
 * stays sanitized `path:code` pairs). The validator stops at the first unresolvable citation, and a
 * model that mis-copied one long record id (a dropped last character, the neighbouring ObjectId)
 * usually repeated it elsewhere, so every unresolvable citation in the object is listed once, with
 * the same record under the type it was supplied as and the closest record ids of the cited type
 * that the prompt already showed; out-of-range `by_finding_index` / `instruction_index` values name
 * the valid range. Nothing is substituted: acceptance stays with `expandStructuredFindings`.
 */
export function citationRepairHints(raw: unknown, inputs: Pick<StructuredExpansionInputs, "context" | "calls" | "instructions">): string[] {
  const records = inputs.context.flatMap(page => page.data.page.records);
  const citable = new Set(records.map(record => `${record.record_type}\u0000${record.record_id}`));
  const hints = new Map<string, { paths: string[]; text: string }>();
  const object = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  // The same underlying record under another type: the exact id, or the id with / without a `kind:` prefix (`call:<id>` vs `<id>`).
  const bare = (id: string) => id.replace(/^[a-z_]+:/, "");
  const sameRecord = (id: string) => records.filter(r => r.record_id === id || bare(r.record_id) === bare(id))
    .map(r => `{"record":${JSON.stringify(r.record_type)},"id":${JSON.stringify(r.record_id)}}`);
  const count = Array.isArray(object.findings) ? object.findings.length : 0;
  if (Array.isArray(object.prior_finding_relations)) object.prior_finding_relations.forEach((relation: unknown, index) => {
    const at = relation && typeof relation === "object" ? (relation as { by_finding_index?: unknown }).by_finding_index : null;
    if (typeof at === "number" && at >= count) hints.set(`by\u0000${index}`, { paths: [`prior_finding_relations.${index}.by_finding_index`],
      text: `by_finding_index ${at} does not exist: this object has ${count} findings (indices 0 to ${count - 1}); use null when no finding of this object applies.` });
  });
  const instructions = inputs.instructions ?? structuredInstructions(inputs.context);
  if (Array.isArray(object.owner_instruction_assessments)) object.owner_instruction_assessments.forEach((assessment: unknown, index) => {
    const at = assessment && typeof assessment === "object" ? (assessment as { instruction_index?: unknown }).instruction_index : null;
    if (typeof at === "number" && at >= instructions.length) hints.set(`instruction\u0000${index}`, { paths: [`owner_instruction_assessments.${index}.instruction_index`],
      text: instructions.length ? `instruction_index ${at} does not exist: the instructions list has ${instructions.length} entries (indices 0 to ${instructions.length - 1}).`
        : "the instructions list is empty, so owner_instruction_assessments must be an empty list." });
  });
  const lists = [["findings", object.findings], ["prior_finding_relations", object.prior_finding_relations], ["story_discrepancies", object.story_discrepancies]] as const;
  for (const [name, list] of lists) {
    if (!Array.isArray(list)) continue;
    list.forEach((item: unknown, itemIndex) => {
      const evidence = item && typeof item === "object" ? (item as { evidence?: unknown }).evidence : null;
      if (!Array.isArray(evidence)) return;
      evidence.forEach((ref: unknown, refIndex) => {
        if (!ref || typeof ref !== "object") return;
        const path = `${name}.${itemIndex}.evidence.${refIndex}`;
        const { source, record, id, call_index: callIndex, segment_ids: segmentIds } = ref as Record<string, unknown>;
        if (source === "context" && typeof record === "string" && typeof id === "string" && !citable.has(`${record}\u0000${id}`)) {
          const key = `context\u0000${record}\u0000${id}`;
          if (hints.has(key)) return void hints.get(key)!.paths.push(path);
          const same = [...new Set(sameRecord(id))].slice(0, NEAR_LIMIT);
          const near = [...new Set(records.filter(r => r.record_type === record).map(r => r.record_id))]
            .map(candidate => ({ candidate, distance: editDistance(candidate, id) }))
            .filter(entry => entry.distance <= NEAR_DISTANCE).sort((a, b) => a.distance - b.distance).slice(0, NEAR_LIMIT).map(entry => entry.candidate);
          hints.set(key, { paths: [path], text: `record ${JSON.stringify(record)} id ${JSON.stringify(id)} is not a supplied ${record} record id.`
            + (same.length ? ` That record is supplied only as ${same.join(" or ")}: cite it exactly that way if you mean it.` : "")
            + (near.length ? ` The closest supplied ${record} ids are ${near.map(n => JSON.stringify(n)).join(", ")}; check which record you mean.` : "")
            + " Copy record type and id character for character from the appendix, or drop the citation." });
        } else if (source === "transcript" && typeof callIndex === "number" && Array.isArray(segmentIds)) {
          const call = inputs.calls[callIndex];
          const authorized = call?.data.transcript ? [...new Set(call.summary.said_on_call.flatMap(fact => fact.segment_ids))].sort((a, b) => a - b) : null;
          if (authorized && segmentIds.every(sid => authorized.includes(sid as number))) return;
          const key = `transcript\u0000${callIndex}`;
          if (hints.has(key)) return void hints.get(key)!.paths.push(path);
          hints.set(key, { paths: [path], text: authorized
            ? `call_index ${callIndex} may cite only the segment ids listed for it in appendix.calls: ${JSON.stringify(authorized)}.`
            : `call_index ${callIndex} has no citable segments (segments_available is false or no such call); cite its story event instead or drop the citation.` });
        }
      });
    });
  }
  return [...hints.values()].slice(0, HINT_LIMIT).map(hint => `${hint.paths.slice(0, 6).join(", ")}${hint.paths.length > 6 ? ` (+${hint.paths.length - 6} more)` : ""}: ${hint.text}`);
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
  type MinimalRef = z.infer<typeof minimalEvidenceSchema>;
  const expandRefs = (refs: readonly MinimalRef[], at: string, transcriptSpeakers?: Array<string | null>) =>
    refs.flatMap((ref, refIndex): IntelligenceEvidenceRef[] => {
      const path = `${at}.evidence.${refIndex}`;
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
        transcriptSpeakers?.push(repSegments && speakers.length === 1 ? speakers[0] : null);
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
  const findings = minimal.findings.map((finding, index) => {
    const transcriptSpeakers: Array<string | null> = [];
    const evidence = expandRefs(finding.evidence, `findings.${index}`, transcriptSpeakers);
    const uniqueSpeakers = [...new Set(transcriptSpeakers)];
    return { ...finding, evidence, key: `finding-${index + 1}`, confidence: null,
      speaker_ref: finding.actor === "rep" && uniqueSpeakers.length === 1 ? uniqueSpeakers[0] : null };
  });
  // Prior relations and story discrepancies (§6.2): indices resolve to the record ids the run was shown.
  const priorIds = inputs.prior_finding_ids ?? [], storyIds = inputs.story_event_ids ?? [];
  const relations = minimal.prior_finding_relations.map((relation, index) => {
    const at = `prior_finding_relations.${index}`;
    const priorId = priorIds[relation.prior_index];
    if (!priorId) refuse(`${at}.prior_index`, "prior_not_observed");
    if (relation.by_finding_index !== null && !findings[relation.by_finding_index]) refuse(`${at}.by_finding_index`, "finding_not_in_envelope");
    if (relation.relation !== "cannot_determine" && !relation.evidence.length) refuse(`${at}.evidence`, "relation_without_evidence");
    return { prior_finding_id: priorId, relation: relation.relation,
      by_finding_key: relation.by_finding_index === null ? null : findings[relation.by_finding_index].key,
      evidence: expandRefs(relation.evidence, at), note: relation.note };
  });
  const discrepancies = minimal.story_discrepancies.map((discrepancy, index) => {
    const at = `story_discrepancies.${index}`;
    const storyId = storyIds[discrepancy.story_index];
    if (!storyId) refuse(`${at}.story_index`, "story_event_not_observed");
    return { story_event_id: storyId, claim: discrepancy.claim, evidence: expandRefs(discrepancy.evidence, at) };
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
    ...(relations.length ? { prior_finding_relations: relations } : {}),
    ...(discrepancies.length ? { story_discrepancies: discrepancies } : {}),
  });
  validateEnvelopeEvidence(envelope, { subject_key: inputs.subject_key, snapshots: manifest,
    allowed_followup_ids: allPages.flatMap(page => page.data.allowed_followup_ids),
    instructions: [...instructions], speaker_refs: inputs.calls.flatMap(call => call.speaker_refs) });
  return envelope;
}
