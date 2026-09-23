import { z } from "zod";
import { csiIdSchema as id, csiDateSchema as date, csiSubjectSchema } from "../../../validation/v1/salesIntelligence";

/**
 * MA-04 presentation DTOs (MA-01 contract §10, specification §8.3–8.4).
 *
 * These are the Owner read contracts, separate from the model-output contract
 * (`contract.ts`, MA-01) and the stored artifact (`models/salesIntelligence/assessment.ts`).
 * Every object is strict; fields the Admin must tolerate on older servers are optional.
 * Labels such as Unknown / Pending / Not applicable / Not assessed are UI words: the
 * server sends numbers or null plus an explicit availability, and a readable label.
 */
export const ASSESSMENT_AVAILABILITY = ["not_assessed", "pending", "ready", "insufficient_evidence", "ambiguous_subject", "not_applicable",
  "failed", "purged", "unsupported", "unavailable"] as const;
export type AssessmentAvailability = (typeof ASSESSMENT_AVAILABILITY)[number];
/** Availability of a section that is not an assessment (summary/findings, evidence, full output). */
export const SECTION_AVAILABILITY = ["ready", "unavailable", "purged", "unsupported"] as const;
export const ASSESSMENT_LEVELS = ["unknown", "none", "exploring", "active", "strong", "confirmed"] as const;
export const ASSESSMENT_APPLICABILITY = ["active", "closed", "not_applicable"] as const;
export type AssessmentApplicability = (typeof ASSESSMENT_APPLICABILITY)[number];
const confidence = z.enum(["low", "medium", "high"]);
const score = z.number().min(0).max(100);

/** §3 locators plus the two envelope citation shapes (`analysis_transcript`, `analysis_record`) used by legacy/structured findings. */
export const evidenceLocatorDtoSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("summary_artifact"), snapshot_id: z.string(), content_digest: z.string(), conversation_id: z.string().nullable(),
    transcript_version: z.string().nullable(), section: z.string() }).strict(),
  z.object({ source: z.literal("legacy_run"), run_id: z.string(), output_digest: z.string(), conversation_id: z.string().nullable(), section: z.string() }).strict(),
  z.object({ source: z.literal("conversation_summary"), conversation_id: z.string(), text_digest: z.string(), section: z.string() }).strict(),
  z.object({ source: z.literal("finding"), finding_id: z.string(), run_id: z.string(), revision: z.number().int(), conversation_id: z.string().nullable() }).strict(),
  z.object({ source: z.literal("lead"), model: z.enum(["FormLead", "CallLead"]), id: z.string(), view: z.enum(["current", "ingested"]), field_path: z.string() }).strict(),
  z.object({ source: z.literal("official"), model: z.string(), id: z.string(), field_path: z.string() }).strict(),
  z.object({ source: z.literal("owner_correction"), instruction_id: z.string(), revision: z.number().int() }).strict(),
  z.object({ source: z.literal("analysis_transcript"), run_id: z.string(), snapshot_id: z.string(), conversation_id: z.string(), transcript_version: z.string(),
    segment_ids: z.array(z.number().int().nonnegative()) }).strict(),
  z.object({ source: z.literal("analysis_record"), run_id: z.string(), snapshot_id: z.string(), record_type: z.string(), record_id: z.string(),
    field_paths: z.array(z.string()) }).strict(),
]);
export type EvidenceLocatorDto = z.infer<typeof evidenceLocatorDtoSchema>;
export const EVIDENCE_KINDS = ["summary_section", "said_on_call", "move_evidence", "legacy_summary_text", "legacy_summary_section", "finding",
  "lead_current", "lead_ingested", "official_state", "owner_correction", "transcript_quote", "analysis_record"] as const;
export const evidenceRefDtoSchema = z.object({
  id: z.string().min(1), kind: z.enum(EVIDENCE_KINDS), locator: evidenceLocatorDtoSchema,
  speaker: z.enum(["rep", "customer", "unknown"]).nullable(), call_at: date.nullable(), lineage: z.array(z.string()),
}).strict();
export type EvidenceRefDto = z.infer<typeof evidenceRefDtoSchema>;

export const scoreDtoSchema = z.object({
  score: score.nullable(), level: z.enum(ASSESSMENT_LEVELS).nullable(), label: z.string(), confidence: confidence.nullable(),
  rationale: z.string().nullable(), conditions: z.array(z.string()), evidence: z.array(evidenceRefDtoSchema),
  stale: z.boolean(), stale_reason: z.string().nullable(), applicability: z.enum(ASSESSMENT_APPLICABILITY),
}).strict();
export type ScoreDto = z.infer<typeof scoreDtoSchema>;

const place = z.object({ city: z.string().nullable(), state: z.string().nullable(), zip: z.string().nullable() }).strict();
export const moveViewDtoSchema = z.object({
  pickup: place, delivery: place, move_date: z.string().nullable(), move_size: z.string().nullable(), granot_move_size: z.string().nullable(),
  cubic_feet: z.number().nullable(),
  provenance: z.object({ source_system: z.string().nullable(), changed_at: date.nullable(), observation_id: z.string().nullable() }).strict().nullable(),
  // original_ingestion only
  captured_at: date.nullable().optional(), evidence_status: z.string().nullable().optional(), ingestion_origin: z.string().nullable().optional(),
  label: z.enum(["original_form_submission", "legacy_baseline", "granot_created", "unknown"]).optional(),
}).strict();
export type MoveViewDto = z.infer<typeof moveViewDtoSchema>;

const range = z.object({ min: z.number().nullable(), max: z.number().nullable() }).strict();
const location = z.object({ line: z.string().nullable(), city: z.string().nullable(), state: z.string().nullable(), zip: z.string().nullable(),
  precision: z.enum(["address", "city", "state", "zip", "unknown"]) }).strict();
const observationStatus = z.enum(["stated", "conditional", "changed", "retracted"]);
const observation = <F extends string, V extends z.ZodType>(field: F, value: V) =>
  z.object({ field: z.literal(field), value, status: observationStatus, evidence: z.array(evidenceRefDtoSchema) }).strict();
export const observationDtoSchema = z.discriminatedUnion("field", [
  observation("pickup_location", location),
  observation("delivery_location", location),
  observation("move_date", z.object({ raw_text: z.string(), date: z.string().nullable(), end_date: z.string().nullable(),
    applies_to: z.enum(["pickup", "delivery", "unspecified"]), flexibility: z.enum(["fixed", "flexible", "unknown"]),
    precision: z.enum(["exact", "window", "month", "unresolved"]) }).strict()),
  observation("move_size", z.object({ value: range, unit: z.enum(["bedrooms", "rooms", "cubic_feet", "pounds", "square_feet", "description"]), text: z.string(),
    basis: z.enum(["customer_estimate", "customer_stated", "unknown"]) }).strict()),
  observation("service", z.object({ service: z.enum(["packing", "unpacking", "storage", "vehicle", "specialty", "disassembly"]),
    status: z.enum(["requested", "declined", "unknown"]), detail: z.string().nullable(), duration_text: z.string().nullable() }).strict()),
  observation("access", z.object({ end: z.enum(["pickup", "delivery"]), constraint: z.enum(["floor", "elevator", "stairs", "long_carry", "parking", "shuttle", "access_window"]),
    detail: z.string() }).strict()),
  observation("money", z.object({ basis: z.enum(["budget", "quote", "estimate", "deposit", "final_price", "competitor_quote"]), amount: range,
    currency: z.string().nullable(), text: z.string() }).strict()),
]);
export type ObservationDto = z.infer<typeof observationDtoSchema>;

export const inventoryItemDtoSchema = z.object({
  label: z.string(), quantity: range, room: z.string().nullable(),
  dimensions: z.object({ text: z.string(), unit: z.string().nullable() }).strict().nullable(), handling: z.string().nullable(),
  status: z.enum(["included", "excluded", "conditional"]), evidence: z.array(evidenceRefDtoSchema),
}).strict();
export type InventoryItemDto = z.infer<typeof inventoryItemDtoSchema>;
export const conflictDtoSchema = z.object({ affects: z.string(), explanation: z.string(), evidence: z.array(evidenceRefDtoSchema) }).strict();
export type ConflictDto = z.infer<typeof conflictDtoSchema>;

/** Work state the model read from the conversations, plus the deterministic effects the server applied at publication. */
export const promisedCallbackDtoSchema = z.object({ by: z.string(), raw_text: z.string(), date: z.string().nullable(), time_text: z.string().nullable(),
  status: z.string(), evidence: z.array(evidenceRefDtoSchema) }).strict();
export const nextStepDtoSchema = z.object({ action: z.string(), owner: z.string(), description: z.string(), date: z.string().nullable(), date_text: z.string().nullable(),
  status: z.string(), evidence: z.array(evidenceRefDtoSchema) }).strict();
export const engagementEffectsDtoSchema = z.object({
  applied: z.boolean(), mark_worked: z.boolean(), blocked: z.string().nullable(), followup_ids: z.array(z.string()),
  followups: z.array(z.object({ kind: z.string(), origin: z.string(), description: z.string(), source: z.string() }).strict()),
  skipped: z.array(z.object({ source: z.string(), index: z.number().int(), reason: z.string() }).strict()),
}).strict();
export const engagementDtoSchema = z.object({
  work_status: z.string(), rationale: z.string(), evidence: z.array(evidenceRefDtoSchema),
  promised_callbacks: z.array(promisedCallbackDtoSchema), next_steps: z.array(nextStepDtoSchema),
  effects: engagementEffectsDtoSchema.nullable(),
}).strict();
export type EngagementDto = z.infer<typeof engagementDtoSchema>;

export const sourceManifestEntryDtoSchema = z.object({
  kind: z.enum(["summary_artifact", "legacy_run", "conversation_summary", "finding", "lead", "official", "owner_correction"]),
  id: z.string(), version: z.string(), conversation_id: z.string().nullable(), call_at: date.nullable(), lineage: z.array(z.string()),
}).strict();

export const assessmentSectionSchema = z.object({
  availability: z.enum(ASSESSMENT_AVAILABILITY),
  artifact_id: id.nullable(),
  schema_version: z.string().nullable(), rubric_version: z.string().nullable(), model_version: z.string().nullable(),
  generated_at: date.nullable(), context_as_of: date.nullable(), latest_conversation_at: date.nullable(),
  input_mode: z.enum(["summaries", "summaries_with_findings", "lead_only"]).nullable(), shadow: z.boolean(),
  current: z.boolean(),
  transaction_intent: scoreDtoSchema, move_likelihood: scoreDtoSchema,
  views: z.object({ original_ingestion: moveViewDtoSchema.nullable(), canonical_current: moveViewDtoSchema.nullable(),
    customer_stated: z.array(observationDtoSchema) }).strict(),
  inventory: z.object({ items: z.array(inventoryItemDtoSchema), coverage: z.enum(["none", "partial", "customer_says_complete"]).nullable(),
    limitations: z.array(z.string()), source_coverage: z.enum(["complete", "partial", "none"]).nullable() }).strict(),
  conflicts: z.array(conflictDtoSchema),
  /** Additive (older artifacts and servers may omit it). */
  engagement: engagementDtoSchema.optional(),
  coverage: z.object({ conversations_available: z.number().int().nonnegative(), conversations_selected: z.number().int().nonnegative(),
    findings_selected: z.number().int().nonnegative() }).strict().nullable(),
  source_manifest: z.array(sourceManifestEntryDtoSchema),
}).strict();
export type AssessmentSection = z.infer<typeof assessmentSectionSchema>;

export const assessmentVersionSchema = z.object({
  artifact_id: id, status: z.enum(ASSESSMENT_AVAILABILITY), label: z.string(), current: z.boolean(),
  generated_at: date.nullable(), context_as_of: date.nullable(), schema_version: z.string(), model_version: z.string(),
  input_mode: z.enum(["summaries", "summaries_with_findings", "lead_only"]).nullable(),
  transaction_intent: score.nullable(), move_likelihood: score.nullable(),
}).strict();
export type AssessmentVersion = z.infer<typeof assessmentVersionSchema>;

export const assessmentSubjectSchema = z.object({
  outreach_record_id: id, subject_key: z.string(), subject: csiSubjectSchema, state: z.string(),
  contact_number_id: id.nullable(), applicability: z.enum(ASSESSMENT_APPLICABILITY),
}).strict();
export const outreachAssessmentDtoSchema = z.object({
  subject: assessmentSubjectSchema, availability: z.enum(ASSESSMENT_AVAILABILITY),
  current: assessmentSectionSchema.nullable(), versions: z.array(assessmentVersionSchema),
}).strict();
export type OutreachAssessmentDto = z.infer<typeof outreachAssessmentDtoSchema>;

const summarySectionKey = z.enum(["overview", "customer_wanted", "money_and_dates", "outcome", "commitments", "discrepancies"]);
export const summaryFindingsSectionSchema = z.object({
  availability: z.enum(SECTION_AVAILABILITY),
  scope: z.enum(["conversation", "number"]),
  source: z.object({ kind: z.enum(["legacy_run", "structured_run", "summary_artifact"]), id: z.string(), version: z.string().nullable(),
    generated_at: date.nullable(), model_version: z.string().nullable(), prompt_version: z.string().nullable() }).strict(),
  summary: z.object({ sections: z.array(z.object({ key: summarySectionKey, label: z.string(), text: z.string() }).strict()), narrative: z.string().nullable() }).strict(),
  said_on_call: z.array(z.object({ index: z.number().int().nonnegative(), call_index: z.number().int().nonnegative(), kind: z.string(),
    speaker: z.enum(["rep", "customer", "unknown"]), text: z.string(), segment_ids: z.array(z.number().int().nonnegative()) }).strict()),
  findings: z.array(z.object({
    id: z.string(), kind: z.string(), claim: z.string(), basis: z.string(), actor: z.string(), action_status: z.string().nullable(),
    clarity: z.string(), review_state: z.enum(["unreviewed", "confirmed", "corrected", "retracted"]), evidence: z.array(evidenceRefDtoSchema),
    effects: z.array(z.object({ kind: z.string(), status: z.string(), reason: z.string().nullable(), target_id: z.string().nullable() }).strict()),
  }).strict()),
  suggested_next_step: z.object({ action_kind: z.string(), description: z.string(), date_text: z.string().nullable(), timezone_text: z.string().nullable(),
    rationale: z.string(), target_followup_id: z.string().nullable() }).strict().nullable(),
  applied_actions: z.array(z.object({ id: z.string(), kind: z.string(), description: z.string(), status: z.string(), due_at: date.nullable() }).strict()),
}).strict();
export type SummaryFindingsSection = z.infer<typeof summaryFindingsSectionSchema>;

export const evidenceOpenDtoSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("analysis_evidence"), run_id: z.string(), snapshot_id: z.string() }).strict(),
  z.object({ kind: z.literal("summary_artifact"), snapshot_id: z.string() }).strict(),
  z.object({ kind: z.literal("record"), model: z.string(), id: z.string(), href: z.string() }).strict(),
  z.object({ kind: z.literal("analysis_run"), run_id: z.string() }).strict(),
]);
export const evidenceItemDtoSchema = z.object({
  id: z.string(), kind: z.enum(EVIDENCE_KINDS), source: evidenceLocatorDtoSchema,
  availability: z.enum(["retained", "purged", "missing", "partial"]), text: z.string().nullable(), open: evidenceOpenDtoSchema.nullable(),
}).strict();
export type EvidenceItemDto = z.infer<typeof evidenceItemDtoSchema>;
export const evidenceSectionSchema = z.object({ availability: z.enum(SECTION_AVAILABILITY), items: z.array(evidenceItemDtoSchema) }).strict();
export type EvidenceSection = z.infer<typeof evidenceSectionSchema>;

export const FULL_OUTPUT_KINDS = ["move_assessment", "conversation_summary", "findings", "legacy_analysis"] as const;
export const fullOutputSchema = z.object({
  kind: z.enum(FULL_OUTPUT_KINDS), id: z.string(), version: z.string().nullable(), generated_at: date.nullable(),
  availability: z.enum(SECTION_AVAILABILITY),
  /** True only when `model_output` is the complete retained object. */
  complete: z.boolean(),
  /** Exact retained model object, never a normalized DTO. Null when unavailable. */
  model_output: z.json().nullable(),
  /** Server-expanded accepted envelope (scores, citations), labelled separately from model-produced values. */
  accepted: z.json().nullable(),
  details: z.object({ schema_version: z.string().nullable(), prompt_version: z.string().nullable(), model_version: z.string().nullable(),
    digests: z.record(z.string(), z.string()) }).strict(),
}).strict();
export type FullOutput = z.infer<typeof fullOutputSchema>;
export const fullOutputRefSchema = z.object({
  kind: z.enum(FULL_OUTPUT_KINDS), id: z.string(), label: z.string(), generated_at: date.nullable(), version: z.string().nullable(), available: z.boolean(),
}).strict();
export type FullOutputRef = z.infer<typeof fullOutputRefSchema>;
export const runPresentationSchema = z.object({
  run_id: id, summary_findings: summaryFindingsSectionSchema, evidence: evidenceSectionSchema, full_output: z.array(fullOutputRefSchema),
}).strict();
export type RunPresentation = z.infer<typeof runPresentationSchema>;

/**
 * Compact projection DTO carried on Outreach rows (`outreach.move_assessment`). Applicability is
 * derived on read from the record; numbers are null whenever the score is not actionable.
 */
export const outreachMoveAssessmentDtoSchema = z.object({
  artifact_id: id.nullable(), status: z.enum(ASSESSMENT_AVAILABILITY), applicability: z.enum(ASSESSMENT_APPLICABILITY),
  transaction_intent: score.nullable(), move_likelihood: score.nullable(),
  transaction_intent_confidence: confidence.nullable(), move_likelihood_confidence: confidence.nullable(),
  context_as_of: date.nullable(), latest_conversation_at: date.nullable(), stale: z.boolean(), stale_reason: z.string().nullable(), published_at: date.nullable(),
}).strict();
export type OutreachMoveAssessmentDto = z.infer<typeof outreachMoveAssessmentDtoSchema>;
