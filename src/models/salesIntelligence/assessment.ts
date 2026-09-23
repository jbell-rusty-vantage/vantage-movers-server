import { Schema } from "mongoose";
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
  enumeration,
  leadRef,
  validatedJson,
  unique,
  index,
} from "./common";

/**
 * Move assessment (MA-01/02, specification §7).
 *
 * One immutable artifact per dataset, subject, input fingerprint, contract
 * version and shadow flag. The model-facing contract, the accepted expanded
 * body and the presentation DTO are three separate Zod contracts that live in
 * `services/salesIntelligence/assessment/`; this document stores the accepted
 * body and the exact retained model object under `validatedJson` so the
 * service layer, not Mongoose, is the strict validator.
 *
 * Status is the artifact's own lifecycle. Stale is a separate flag on the
 * Outreach projection. Official applicability (closed work, CRM disposition)
 * is derived at read time from the Outreach Record, never stored here.
 */
export const MOVE_ASSESSMENT_STATUSES = [
  "pending",
  "ready",
  "insufficient_evidence",
  "ambiguous_subject",
  "not_applicable",
  "failed",
  "purged",
] as const;
export const MOVE_ASSESSMENT_INPUT_MODES = ["summaries", "summaries_with_findings", "lead_only"] as const;
export const MOVE_ASSESSMENT_CREDENTIALS = ["AI_GATEWAY_API_KEY", "PERSONAL_AI_GATEWAY_API_KEY"] as const;

export const MOVE_ASSESSMENT_ARTIFACT_INDEXES = [
  // Once per subject and complete input fingerprint under one contract; shadow artifacts are
  // their own row so promotion can reuse them without a second generation (§9).
  unique("csi_move_assessment_key", {
    deployment: 1,
    database: 1,
    subject_key: 1,
    input_fingerprint: 1,
    schema_version: 1,
    shadow: 1,
  }),
  index("csi_move_assessment_subject", { subject_key: 1, createdAt: -1 }),
  index("csi_move_assessment_number", { contact_number_id: 1, _id: 1 }),
  index("csi_move_assessment_job", { job_id: 1 }),
];

const nullableJson = { ...validatedJson(), required: false, default: null } as const;

export const MoveAssessmentArtifactSchema = new Schema(
  {
    purge_started_at: date,
    purged_at: date,
    purge_reason: text,
    deployment: str,
    database: str,
    /** `lead:<Model>:<id>` or `number:<id>` (Number Review), exactly as `subjectKey()` renders it. */
    subject_key: str,
    outreach_record_id: ref,
    contact_number_id: ref,
    lead_ref: { type: leadRef, default: null },
    schema_version: str,
    rubric_version: str,
    prompt_version: str,
    prompt_digest: str,
    schema_digest: str,
    model_version: str,
    input_fingerprint: str,
    input_mode: enumeration(MOVE_ASSESSMENT_INPUT_MODES),
    /** Selected sources with their exact ids, versions/digests and lineage. Operational identifiers only. */
    source_manifest: validatedJson(),
    context_as_of: at,
    latest_conversation_at: date,
    status: enumeration(MOVE_ASSESSMENT_STATUSES, "pending"),
    failure_reason: text,
    /** Shadow artifacts are persisted with cost evidence but are never published to a projection. */
    shadow: { type: Boolean, required: true, default: false },
    /** Accepted server-expanded body: `{ move_likelihood, transaction_intent }` with numeric scores and expanded evidence. */
    scores: nullableJson,
    /** `{ original_ingestion, canonical_current, customer_stated }` — three labelled views (§6). */
    views: nullableJson,
    inventory: nullableJson,
    conflicts: nullableJson,
    /** Accepted engagement: work status, promised callbacks and next steps with expanded evidence. */
    engagement: nullableJson,
    /** Deterministic Outreach effects derived from `engagement` at publication (`engagement.ts`); written after generation. */
    engagement_effects: nullableJson,
    /** Server-measured source coverage, distinct from the model's inventory coverage claim. */
    coverage: nullableJson,
    /** The exact validated model object (five top-level fields, §5.1). Never rewritten. */
    model_output: nullableJson,
    usage: {
      type: new Schema(
        {
          input_tokens: count,
          output_tokens: count,
          reasoning_tokens: { type: Number, default: null, min: 0 },
          cached_input_tokens: { type: Number, default: null, min: 0 },
          actual_cents: { type: Number, default: null, min: 0 },
          usage_complete: { type: Boolean, default: false },
          attempts: count,
          /** Variable name only, never a value. */
          credential: { type: String, enum: [...MOVE_ASSESSMENT_CREDENTIALS, null], default: null },
        },
        { _id: false, strict: "throw" },
      ),
      default: null,
    },
    job_id: ref,
    lease_epoch: count,
    /** Non-shadow copy promoted from an accepted shadow artifact (MA-03 promotion, zero model calls). */
    promoted_from: ref,
    generated_at: date,
    published_at: date,
    revision,
  },
  { collection: "move_assessment_artifacts" },
);

const immutableOnceReady = ["subject_key", "input_fingerprint", "schema_version", "rubric_version", "prompt_version", "prompt_digest",
  "schema_digest", "model_version", "input_mode", "source_manifest", "context_as_of", "latest_conversation_at", "scores", "views",
  "inventory", "conflicts", "engagement", "coverage", "model_output", "generated_at"];
MoveAssessmentArtifactSchema.pre(["updateOne", "updateMany", "findOneAndUpdate"], function () {
  const update = this.getUpdate();
  if (Array.isArray(update)) throw new Error("Move assessment pipelines are forbidden");
  if (update && "$rename" in update) throw new Error("Move assessment field renames are forbidden");
  // A generated artifact's content is written once by the generation CAS. Later writes (publish
  // time, purge tombstones, usage reconciliation) must target a row that is not yet ready, or must
  // be the retention purge, which sets `purged_at` in the same update.
  const touchesContent = Boolean(update && Object.entries(update).some(([key, value]) => immutableOnceReady.includes(key) ||
    (value && typeof value === "object" && Object.keys(value).some(path => immutableOnceReady.some(field => path === field || path.startsWith(`${field}.`))))));
  const purge = Boolean(update && typeof update === "object" && "$set" in update && update.$set && typeof update.$set === "object" && "purged_at" in update.$set);
  if (touchesContent && !purge) this.setQuery({ ...this.getQuery(), status: "pending" });
});
MoveAssessmentArtifactSchema.pre(["replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete"], function () {
  throw new Error("Move assessment replacement/deletion requires a retention migration");
});
MoveAssessmentArtifactSchema.pre("bulkWrite", function () {
  throw new Error("Move assessment bulk mutations are forbidden");
});

export const getMoveAssessmentArtifactModel = defineCsiModel(
  "MoveAssessmentArtifact",
  MoveAssessmentArtifactSchema,
  MOVE_ASSESSMENT_ARTIFACT_INDEXES,
);
