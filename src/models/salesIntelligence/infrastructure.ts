import { Schema } from "mongoose";
import { CSI_JOB_STAGES } from "../../config/domain/salesIntelligence";
import {
  intelligenceEnvelopeSchema,
  intelligenceFindingSchema,
} from "../../validation/intelligence/intelligenceEnvelope.validation";
import { csiPolicySchema } from "../../validation/v1/salesIntelligence";
import { attentionRowDtoSchema } from "../../services/salesIntelligence/dto";
import { z } from "zod";
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
/**
 * Completed queue rows are operational exhaust, not the audit trail (that
 * lives in `sales_intelligence_audit_events`). `completed_at` is written only
 * by `completeCsiJob`, and Mongo's TTL monitor ignores documents whose indexed
 * field is not a date, so pending/leased/retry rows are never expired (14 §7).
 */
export const CSI_JOB_RETENTION_SECONDS = 14 * 24 * 60 * 60;
export const SALES_INTELLIGENCE_JOB_INDEXES = [
  unique("csi_job_dedupe_unique", { dedupe_key: 1 }),
  index("csi_job_due", { status: 1, next_attempt_at: 1, priority: -1 }),
  index("csi_job_lease", { status: 1, leased_until: 1 }),
  // The claim leads with the dataset and (optionally) the stage, then sorts
  // `priority desc, next_attempt_at asc, _id asc`. This index carries that
  // exact order so the claim never runs a blocking in-memory sort (14 §7).
  index("csi_job_claim", {
    deployment: 1,
    database: 1,
    stage: 1,
    status: 1,
    priority: -1,
    next_attempt_at: 1,
    _id: 1,
  }),
  {
    name: "csi_job_completed_ttl",
    key: { completed_at: 1 as const },
    expireAfterSeconds: CSI_JOB_RETENTION_SECONDS,
  },
];
export const SalesIntelligenceJobSchema = new Schema(
  {
    dedupe_key: str,
    payload_hash: str,
    stage: enumeration(CSI_JOB_STAGES),
    subject_key: str,
    input_revision: revision,
    deployment: str,
    database: str,
    status: enumeration(
      ["pending", "leased", "retry", "paused", "completed", "dead_letter"],
      "pending",
    ),
    attempts: count,
    max_attempts: { ...count, default: 8, min: 1, max: 8 },
    priority: { type: Number, default: 0 },
    next_attempt_at: at,
    lease_owner: text,
    lease_epoch: count,
    // CSI-17 transaction fence serializes evidence/submission with lease revocation.
    evidence_fence: count,
    leased_until: date,
    reason: text,
    result_ref: ref,
    // CSI-03 additive: bounded JSON summary written with completion (per-session outcomes, counts). Never provider bodies.
    result: {
      type: Schema.Types.Mixed,
      default: null,
      validate: {
        validator: (v: unknown) => v === null || z.json().safeParse(v).success,
        message: "Invalid CSI job result",
      },
    },
    completed_at: date,
    input_refs: refs,
    owner_reanalysis: {
      type: new Schema({ run_id: oid, source_run_id: oid, mode: enumeration(["original_evidence", "current_context"]), owner_correction_ids: refs, focus_finding_id: ref }, { _id: false, strict: "throw" }),
      default: null,
    },
    rep_identity_window: {
      type: new Schema({ account: str, extension: str, from: str, through: str, change_id: str, after: text, after_at: text }, { _id: false, strict: "throw" }),
      default: null,
    },
  },
  { collection: "sales_intelligence_jobs" },
);
export const getSalesIntelligenceJobModel = defineCsiModel(
  "SalesIntelligenceJob",
  SalesIntelligenceJobSchema,
  SALES_INTELLIGENCE_JOB_INDEXES,
);
export const SALES_INTELLIGENCE_AUDIT_EVENT_INDEXES = [
  unique("csi_audit_semantic_unique", { semantic_key: 1 }),
  index("csi_audit_stream", { recorded_at: 1, _id: 1 }),
  index("csi_audit_subject", { subject_key: 1, happened_at: 1 }),
];
export const SalesIntelligenceAuditEventSchema = new Schema(
  {
    semantic_key: str,
    subject_key: str,
    event_kind: str,
    command_id: ref,
    actor: { type: actor, required: true },
    happened_at: at,
    recorded_at: at,
    prior: validatedJson(),
    current: validatedJson(),
    correlation_id: text,
    run_id: ref,
    invalidation: {
      type: new Schema(
        {
          kind: enumeration([
            "number",
            "outreach",
            "followup",
            "review",
            "policy",
            "analysis",
            "restriction",
            "rep",
            "nudge",
            "interaction", // CSI-02 additive: Call Interaction projection invalidation (03 §10 `interaction` event)
            "job", // CSI-03 additive: durable job completion summary (capture projection, rebuild)
          ]),
          target_id: str,
          subject_key: str,
          revision,
        },
        { _id: false, strict: "throw" },
      ),
      required: true,
    },
  },
  { collection: "sales_intelligence_audit_events" },
);
export const getSalesIntelligenceAuditEventModel = defineCsiModel(
  "SalesIntelligenceAuditEvent",
  SalesIntelligenceAuditEventSchema,
  SALES_INTELLIGENCE_AUDIT_EVENT_INDEXES,
  true,
);
export const SALES_INTELLIGENCE_COMMAND_EXECUTION_INDEXES = [
  unique("csi_command_idempotency_unique", {
    actor_scope: 1,
    idempotency_key: 1,
  }),
];
export const SalesIntelligenceCommandExecutionSchema = new Schema(
  {
    actor_scope: str,
    idempotency_key: str,
    command: str,
    payload_hash: str,
    response: validatedJson(),
    request_id: str,
    actor: { type: actor, required: true },
    target_revisions: {
      type: [
        new Schema(
          { target_id: str, revision },
          { _id: false, strict: "throw" },
        ),
      ],
      default: [],
    },
    executed_at: at,
  },
  { collection: "sales_intelligence_command_executions" },
);
export const getSalesIntelligenceCommandExecutionModel = defineCsiModel(
  "SalesIntelligenceCommandExecution",
  SalesIntelligenceCommandExecutionSchema,
  SALES_INTELLIGENCE_COMMAND_EXECUTION_INDEXES,
  true,
);
export const SALES_INTELLIGENCE_AI_BUDGET_INDEXES = [
  unique("csi_budget_month_unique", { month: 1 }),
];
export const SalesIntelligenceAiBudgetSchema = new Schema(
  {
    month: { ...str, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    ceiling_cents: { ...count, default: 8000 },
    reserved_cents: count,
    actual_cents: count,
    policy_version: str,
    timezone: str,
    period_start: at,
    period_end: at,
    activated_at: date,
  },
  { collection: "sales_intelligence_ai_budget" },
);
export const getSalesIntelligenceAiBudgetModel = defineCsiModel(
  "SalesIntelligenceAiBudget",
  SalesIntelligenceAiBudgetSchema,
  SALES_INTELLIGENCE_AI_BUDGET_INDEXES,
);
export const SALES_INTELLIGENCE_AI_RESERVATION_INDEXES = [
  unique("csi_reservation_unique", { reservation_id: 1 }),
  index("csi_reservation_pending", { month: 1, status: 1 }),
  unique("csi_reservation_step_unique", { job_id: 1, run_id: 1, step: 1 }),
];
export const SalesIntelligenceAiReservationSchema = new Schema(
  {
    reservation_id: str,
    month: str,
    job_id: oid,
    run_id: ref,
    step: str,
    stage: enumeration(["transcription", "analysis"]),
    estimated_cents: count,
    model_version: text,
    pricing_snapshot: { ...validatedJson(), required: false, default: null },
    provider_started: { type: Boolean, default: false },
    observed_steps: count,
    input_tokens: count,
    output_tokens: count,
    reasoning_tokens: { type: Number, default: null, min: 0 },
    observed_cents: count,
    usage_complete: { type: Boolean, default: true },
    actual_cents: {
      type: Number,
      default: null,
      min: 0,
      validate: (v: number | null) => v === null || Number.isSafeInteger(v),
    },
    status: enumeration(["reserved", "reconciled", "released"], "reserved"),
    reserved_at: at,
    reconciled_at: date,
  },
  { collection: "sales_intelligence_ai_reservations" },
);
export const getSalesIntelligenceAiReservationModel = defineCsiModel(
  "SalesIntelligenceAiReservation",
  SalesIntelligenceAiReservationSchema,
  SALES_INTELLIGENCE_AI_RESERVATION_INDEXES,
);
export const SALES_INTELLIGENCE_POLICY_VERSION_INDEXES = [
  unique("csi_policy_version_unique", { version: 1 }),
];
export const SalesIntelligencePolicyVersionSchema = new Schema(
  {
    version: str,
    policy: validatedJson(csiPolicySchema),
    actor: { type: actor, required: true },
    effective_at: at,
  },
  { collection: "sales_intelligence_policy_versions" },
);
export const getSalesIntelligencePolicyVersionModel = defineCsiModel(
  "SalesIntelligencePolicyVersion",
  SalesIntelligencePolicyVersionSchema,
  SALES_INTELLIGENCE_POLICY_VERSION_INDEXES,
  true,
);
export const SALES_INTELLIGENCE_POLICY_POINTER_INDEXES = [
  unique("csi_policy_pointer_unique", { key: 1 }),
];
export const SalesIntelligencePolicyPointerSchema = new Schema(
  {
    key: { type: String, enum: ["active"], required: true },
    version: str,
    revision,
  },
  { collection: "sales_intelligence_policy_pointers" },
);
export const getSalesIntelligencePolicyPointerModel = defineCsiModel(
  "SalesIntelligencePolicyPointer",
  SalesIntelligencePolicyPointerSchema,
  SALES_INTELLIGENCE_POLICY_POINTER_INDEXES,
);
export const SALES_INTELLIGENCE_ATTENTION_SNAPSHOT_INDEXES = [
  unique("csi_attention_snapshot_unique", { snapshot_id: 1 }),
  {
    name: "csi_attention_expiry",
    key: { expires_at: 1 as const },
    expireAfterSeconds: 0,
  },
  // Newest live snapshot for the dataset, without a sort stage (14 §10).
  index("csi_attention_dataset_asof", { deployment: 1, database: 1, as_of: -1 }),
];
export const SalesIntelligenceAttentionSnapshotSchema = new Schema(
  {
    snapshot_id: str,
    owner_id: str,
    filter_digest: str,
    policy_version: str,
    deployment: str,
    database: str,
    as_of: at,
    rows: validatedJson(z.array(attentionRowDtoSchema)),
    counts: validatedJson(z.record(z.string(), z.number().int().nonnegative())),
    expires_at: at,
  },
  { collection: "sales_intelligence_attention_snapshots" },
);
export const getSalesIntelligenceAttentionSnapshotModel = defineCsiModel(
  "SalesIntelligenceAttentionSnapshot",
  SalesIntelligenceAttentionSnapshotSchema,
  SALES_INTELLIGENCE_ATTENTION_SNAPSHOT_INDEXES,
  true,
);
