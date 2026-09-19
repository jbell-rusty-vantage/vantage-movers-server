import { Schema } from "mongoose";
import {
  intelligenceEnvelopeSchema,
  intelligenceFindingSchema,
} from "../../validation/intelligence/intelligenceEnvelope.validation";
import {
  CSI_EFFECT_STATUSES,
  CSI_TOOLS,
} from "../../config/domain/salesIntelligence";
import {
  defineCsiModel,
  str,
  text,
  oid,
  ref,
  date,
  at,
  revision,
  count,
  strings,
  refs,
  enumeration,
  actor,
  validatedJson,
  unique,
  index,
} from "./common";
export const INTELLIGENCE_RUN_INDEXES = [
  unique("csi_run_job_unique", { job_id: 1 }),
  index("csi_run_subject", { subject_key: 1, createdAt: -1 }),
];
export const IntelligenceRunSchema = new Schema(
  {
    subject_key: str,
    contact_number_id: ref,
    conversation_id: ref,
    outreach_record_id: ref,
    mode: enumeration([
      "initial",
      "original_evidence",
      "current_context",
      "number_refresh",
      "backfill",
    ]),
    parent_run_id: ref,
    job_id: oid,
    triggering_event_ids: refs,
    input_fingerprint: str,
    prompt_version: str,
    schema_version: str,
    schema_digest: text,
    model_version: str,
    rendered_prompt: text,
    owner_correction_ids: refs,
    owner_correction_context: { ...validatedJson(), default: () => [] },
    manifest_digest: text,
    manifest_snapshot_ids: refs,
    evidence_count: count,
    evidence_bytes: count,
    application_cursor: count,
    schema_failures: count,
    invocation_complete: { type: Boolean, default: false },
    processing_reason: text,
    finalized_at: date,
    output: {
      ...validatedJson(intelligenceEnvelopeSchema.nullable()),
      required: false,
      default: null,
    },
    raw_output: { ...validatedJson(), required: false, default: null },
    usage: {
      type: new Schema(
        { input_tokens: count, output_tokens: count, reasoning_tokens: { type: Number, default: null, min: 0 }, actual_cents: { type: Number, default: null, min: 0 }, usage_complete: { type: Boolean, default: false } },
        { _id: false, strict: "throw" },
      ),
      default: null,
    },
    pricing_snapshot: { ...validatedJson(), required: false, default: null },
    status: enumeration(
      [
        "queued",
        "running",
        "submitted",
        "completed",
        "stale",
        "paused",
        "failed",
        "dead_letter",
      ],
      "queued",
    ),
    result_counts: {
      type: new Schema(
        { applied: count, blocked: count, review: count },
        { _id: false, strict: "throw" },
      ),
      default: null,
    },
    deployment: str,
    database: str,
    permitted_tools: { type: [String], enum: CSI_TOOLS, default: [] },
    token_nonce: text,
    started_at: date,
    submitted_at: date,
    completed_at: date,
    revision,
  },
  { collection: "intelligence_runs" },
);
// Protected content can be finalized once; later status/cost changes do not rewrite evidence.
const finalizedFields = [
  "subject_key",
  "contact_number_id",
  "conversation_id",
  "outreach_record_id",
  "mode",
  "parent_run_id",
  "job_id",
  "triggering_event_ids",
  "input_fingerprint",
  "prompt_version",
  "schema_version",
  "schema_digest",
  "model_version",
  "owner_correction_ids",
  "owner_correction_context",
  "deployment",
  "database",
  "permitted_tools",
  "token_nonce",
  "rendered_prompt",
  "manifest_digest",
  "manifest_snapshot_ids",
  "evidence_count",
  "evidence_bytes",
  "output",
  "raw_output",
  "finalized_at",
];
IntelligenceRunSchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate"],
  function () {
    const update = this.getUpdate();
    if (Array.isArray(update))
      throw new Error("CSI run pipelines are forbidden");
    if (update && "$rename" in update)
      throw new Error("CSI run field renames are forbidden");
    if (
      update &&
      Object.entries(update).some(
        ([key, value]) =>
          finalizedFields.includes(key) ||
          (value &&
            typeof value === "object" &&
            Object.keys(value).some((path) =>
              finalizedFields.some(
                (field) => path === field || path.startsWith(`${field}.`),
              ),
            )),
      )
    ) {
      this.setQuery({ ...this.getQuery(), finalized_at: null });
    }
  },
);
IntelligenceRunSchema.pre(
  [
    "replaceOne",
    "findOneAndReplace",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
  ],
  function () {
    throw new Error(
      "CSI run replacement/deletion requires a retention migration",
    );
  },
);
IntelligenceRunSchema.pre("bulkWrite", function () {
  throw new Error("CSI run bulk mutations are forbidden");
});
IntelligenceRunSchema.pre("save", function () {
  if (!this.isNew && finalizedFields.some((field) => this.isModified(field)))
    throw new Error("Finalize run content with revision CAS");
});
export const getIntelligenceRunModel = defineCsiModel(
  "IntelligenceRun",
  IntelligenceRunSchema,
  INTELLIGENCE_RUN_INDEXES,
);
export const INTELLIGENCE_EVIDENCE_SNAPSHOT_INDEXES = [
  unique(
    "csi_evidence_tool_unique",
    { run_id: 1, tool_call_id: 1 },
    { tool_call_id: { $type: "string" } },
  ),
  unique(
    "csi_evidence_transcript_unique",
    { conversation_id: 1, transcript_version: 1 },
    { transcript_version: { $type: "string" } },
  ),
  index("csi_evidence_run", { run_id: 1, _id: 1 }),
];
export const IntelligenceEvidenceSnapshotSchema = new Schema(
  {
    purged_at: date,
    purge_reason: text,
    run_id: ref,
    conversation_id: ref,
    transcript_version: text,
    source_type: enumeration(["transcript", "vantage_record", "tool_response"]),
    source_id: str,
    source_revision: text,
    tool_name: { type: String, enum: [...CSI_TOOLS, null], default: null },
    tool_call_id: text,
    arguments: validatedJson(),
    response: validatedJson(),
    retrieved_at: at,
    happened_at: date,
    content_digest: str,
    subject_key: str,
    deployment: str,
    database: str,
    completeness: {
      type: new Schema(
        {
          complete: { type: Boolean, required: true },
          cursor: text,
          missing_ranges: strings,
        },
        { _id: false, strict: "throw" },
      ),
      required: true,
    },
    segments: {
      type: [
        new Schema(
          {
            sid: count,
            start_ms: { type: Number, default: null, min: 0 },
            end_ms: { type: Number, default: null, min: 0 },
            timing_source: enumeration(["provider", "unavailable"]),
            speaker: enumeration(["rep", "customer", "unknown"]),
            text: str,
          },
          { _id: false, strict: "throw" },
        ),
      ],
      default: [],
    },
  },
  { collection: "intelligence_evidence_snapshots" },
);
export const getIntelligenceEvidenceSnapshotModel = defineCsiModel(
  "IntelligenceEvidenceSnapshot",
  IntelligenceEvidenceSnapshotSchema,
  INTELLIGENCE_EVIDENCE_SNAPSHOT_INDEXES,
  true,
);
export const INTELLIGENCE_SUBMISSION_INDEXES = [
  unique("csi_submission_run_unique", { run_id: 1 }),
];
export const IntelligenceSubmissionSchema = new Schema(
  {
    run_id: oid,
    idempotency_key: str,
    payload_hash: str,
    envelope: validatedJson(intelligenceEnvelopeSchema),
    received_at: at,
    application_job_id: oid,
    manifest_digest: text,
  },
  { collection: "intelligence_submissions" },
);
export const getIntelligenceSubmissionModel = defineCsiModel(
  "IntelligenceSubmission",
  IntelligenceSubmissionSchema,
  INTELLIGENCE_SUBMISSION_INDEXES,
  true,
);
export const INTELLIGENCE_FINDING_INDEXES = [
  unique("csi_finding_run_key_unique", { run_id: 1, key: 1 }),
  index("csi_finding_number", { contact_number_id: 1, kind: 1, createdAt: 1 }),
  index("csi_finding_review", { outreach_record_id: 1, review_state: 1 }),
  index("csi_finding_conversation", { conversation_id: 1, run_id: 1 }),
];
export const IntelligenceFindingSchema = new Schema(
  {
    run_id: { ...oid, immutable: true },
    key: { ...str, immutable: true },
    assertion: { ...validatedJson(intelligenceFindingSchema), immutable: true },
    revision,
    conversation_id: ref,
    contact_number_id: ref,
    outreach_record_id: ref,
    kind: str,
    prompt_version: str,
    schema_version: str,
    model_version: str,
    resolved: {
      type: new Schema(
        {
          due_at: date,
          amount_cents: { type: Number, default: null },
          original_wording: text,
          assumptions: strings,
          uncertain: { type: Boolean, default: true },
        },
        { _id: false, strict: "throw" },
      ),
      default: null,
    },
    review_state: enumeration(
      ["unreviewed", "confirmed", "corrected", "retracted"],
      "unreviewed",
    ),
    superseded_by: ref,
    validation: {
      type: new Schema(
        {
          schema_ok: { type: Boolean, required: true },
          source_snapshots_valid: { type: Boolean, required: true },
          locator_status: enumeration(
            ["not_run", "located", "unlocated"],
            "not_run",
          ),
          entailment_check: enumeration(
            ["not_run", "pass", "fail", "unsure"],
            "not_run",
          ),
        },
        { _id: false, strict: "throw" },
      ),
      required: true,
    },
  },
  { collection: "intelligence_findings" },
);
const findingProjectionFields = new Set([
  "review_state",
  "superseded_by",
  "revision",
  "updatedAt",
]);
IntelligenceFindingSchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate"],
  function () {
    const update = this.getUpdate();
    if (Array.isArray(update))
      throw new Error("CSI finding pipelines are forbidden");
    for (const [operator, fields] of Object.entries(update ?? {})) {
      if (
        !["$set", "$unset", "$inc", "$setOnInsert"].includes(operator) ||
        !fields ||
        typeof fields !== "object"
      )
        throw new Error("CSI finding assertions are immutable");
      // Mongoose adds createdAt on updates; it is used only on insertion.
      for (const path of Object.keys(fields))
        if (
          !(operator === "$setOnInsert" && path === "createdAt") &&
          !findingProjectionFields.has(path)
        )
          throw new Error("CSI finding assertions are immutable");
    }
    if (this.getOptions().upsert)
      throw new Error("Create new CSI findings explicitly");
  },
);
IntelligenceFindingSchema.pre(
  [
    "replaceOne",
    "findOneAndReplace",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
  ],
  function () {
    throw new Error(
      "CSI finding replacement/deletion requires a retention migration",
    );
  },
);
IntelligenceFindingSchema.pre("bulkWrite", function () {
  throw new Error("CSI finding bulk mutations are forbidden");
});
IntelligenceFindingSchema.pre("save", function () {
  if (
    !this.isNew &&
    this.modifiedPaths().some((path) => !findingProjectionFields.has(path))
  )
    throw new Error("CSI finding assertions are immutable");
});
export const getIntelligenceFindingModel = defineCsiModel(
  "IntelligenceFinding",
  IntelligenceFindingSchema,
  INTELLIGENCE_FINDING_INDEXES,
);
export const INTELLIGENCE_EFFECT_INDEXES = [
  unique("csi_effect_unique", {
    run_id: 1,
    finding_key: 1,
    effect_kind: 1,
    target_key: 1,
  }),
  index("csi_effect_commitment", { commitment_key: 1 }),
];
export const IntelligenceEffectSchema = new Schema(
  {
    run_id: oid,
    finding_id: oid,
    finding_key: str,
    commitment_key: text,
    effect_kind: enumeration([
      "create_followup",
      "revise_followup",
      "complete_followup",
      "assign",
      "set_contact_type",
      "mark_meaningful_contact",
      "pause_channel",
      "open_review",
      "open_number_review",
      "cancel_followup",
      "supersede",
    ]),
    target_key: str,
    target_id: ref,
    revision_before: { type: Number, default: null },
    revision_after: { type: Number, default: null },
    previous: validatedJson(),
    current: validatedJson(),
    status: enumeration(CSI_EFFECT_STATUSES),
    reason: text,
    applied_at: at,
    superseding_effect_id: ref,
    reversing_effect_id: ref,
  },
  { collection: "intelligence_effects" },
);
export const getIntelligenceEffectModel = defineCsiModel(
  "IntelligenceEffect",
  IntelligenceEffectSchema,
  INTELLIGENCE_EFFECT_INDEXES,
  true,
);
export const SALES_INTELLIGENCE_OWNER_INSTRUCTION_INDEXES = [
  unique("csi_instruction_revision_unique", { instruction_id: 1, revision: 1 }),
  index("csi_instruction_subject", { subject_key: 1, state: 1 }),
];
export const SalesIntelligenceOwnerInstructionSchema = new Schema(
  {
    instruction_id: oid,
    subject_key: str,
    followup_id: ref,
    finding_id: ref,
    field: enumeration([
      "assignment",
      "due_at",
      "description",
      "kind",
      "status",
      "contact_type",
      "restriction",
      "assertion",
      "closure",
    ]),
    prior: validatedJson(),
    current: validatedJson(),
    actor: { type: actor, required: true },
    happened_at: at,
    revision,
    state: enumeration(["active", "retracted", "satisfied"]),
  },
  { collection: "sales_intelligence_owner_instructions" },
);
export const getSalesIntelligenceOwnerInstructionModel = defineCsiModel(
  "SalesIntelligenceOwnerInstruction",
  SalesIntelligenceOwnerInstructionSchema,
  SALES_INTELLIGENCE_OWNER_INSTRUCTION_INDEXES,
  true,
);
export const INTELLIGENCE_OWNER_ASSESSMENT_INDEXES = [
  unique("csi_assessment_unique", {
    run_id: 1,
    instruction_id: 1,
    instruction_revision: 1,
  }),
];
export const IntelligenceOwnerAssessmentSchema = new Schema(
  {
    run_id: oid,
    instruction_id: oid,
    instruction_revision: revision,
    assessment: enumeration(["agrees", "disagrees", "cannot_determine"]),
    reason: str,
    finding_ids: refs,
  },
  { collection: "intelligence_owner_assessments" },
);
export const getIntelligenceOwnerAssessmentModel = defineCsiModel(
  "IntelligenceOwnerAssessment",
  IntelligenceOwnerAssessmentSchema,
  INTELLIGENCE_OWNER_ASSESSMENT_INDEXES,
  true,
);
export const SALES_INTELLIGENCE_REVIEW_ITEM_INDEXES = [
  unique("csi_review_cause_unique", {
    subject_key: 1,
    cause_kind: 1,
    cause_key: 1,
  }),
];
export const SalesIntelligenceReviewItemSchema = new Schema(
  {
    subject_key: str,
    cause_kind: enumeration([
      "missing_date",
      "identity",
      "completion_target",
      "restriction",
      "official_mismatch",
      "owner_conflict",
      "closed_work_request",
      "missing_responsibility",
      "unclear_commitment",
    ]),
    cause_key: str,
    state: enumeration(["open", "resolved", "dismissed"], "open"),
    evidence_ids: refs,
    resolution_actor: { type: actor, default: null },
    resolved_at: date,
    resolution_reason: text,
    opened_at: at,
    revision,
  },
  { collection: "sales_intelligence_review_items" },
);
export const getSalesIntelligenceReviewItemModel = defineCsiModel(
  "SalesIntelligenceReviewItem",
  SalesIntelligenceReviewItemSchema,
  SALES_INTELLIGENCE_REVIEW_ITEM_INDEXES,
);
export const SALES_INTELLIGENCE_CONTACT_RESTRICTION_INDEXES = [
  index("csi_restriction_number", { contact_number_id: 1, state: 1, until: 1 }),
];
export const SalesIntelligenceContactRestrictionSchema = new Schema(
  {
    contact_number_id: oid,
    source_interaction_id: { ...ref, immutable: true },
    channels: {
      type: [String],
      enum: ["call", "text"],
      required: true,
      validate: (v: string[]) => v.length > 0 && v.length === new Set(v).size,
    },
    until: date,
    origin: enumeration(["owner", "intelligence"]),
    actor: { type: actor, required: true },
    run_id: ref,
    finding_id: ref,
    resolution_actor: { type: actor, default: null },
    resolved_at: date,
    resolution_reason: text,
    state: enumeration(["active", "expired", "resolved"], "active"),
    revision,
  },
  { collection: "sales_intelligence_contact_restrictions" },
);
export const getSalesIntelligenceContactRestrictionModel = defineCsiModel(
  "SalesIntelligenceContactRestriction",
  SalesIntelligenceContactRestrictionSchema,
  SALES_INTELLIGENCE_CONTACT_RESTRICTION_INDEXES,
);
