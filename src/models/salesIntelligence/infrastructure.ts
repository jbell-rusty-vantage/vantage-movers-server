import { Schema } from "mongoose";
import { CSI_JOB_STAGES } from "../../config/domain/salesIntelligence";
import { csiPersistedPolicySchema } from "../../validation/v1/salesIntelligence";
import { z } from "zod";
import {
  defineCsiModel,
  str,
  text,
  ref,
  date,
  at,
  revision,
  count,
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
 * by `completeCsiJob` and by the retired-stage fence (`retireLegacyCsiJobs`),
 * and Mongo's TTL monitor ignores documents whose indexed field is not a date,
 * so pending/leased/retry/paused/dead-letter rows are never expired (14 §7).
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
    // Retained stages only. Rows of a retired stage written by earlier releases are read and
    // terminalized by raw filters (`retireLegacyCsiJobs`); nothing writes that value again.
    stage: enumeration(CSI_JOB_STAGES),
    subject_key: str,
    input_revision: revision,
    deployment: str,
    database: str,
    status: enumeration(
      // `paused` is held only by rows of retired stages until the fence marks them `retired`.
      ["pending", "leased", "retry", "paused", "completed", "dead_letter", "retired"],
      "pending",
    ),
    attempts: count,
    max_attempts: { ...count, default: 8, min: 1, max: 8 },
    priority: { type: Number, default: 0 },
    next_attempt_at: at,
    lease_owner: text,
    lease_epoch: count,
    leased_until: date,
    reason: text,
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
  },
  { collection: "sales_intelligence_jobs" },
);
export const getSalesIntelligenceJobModel = defineCsiModel(
  "SalesIntelligenceJob",
  SalesIntelligenceJobSchema,
  SALES_INTELLIGENCE_JOB_INDEXES,
);
/**
 * Disk trim (2026-10-07): audit rows are Owner/desk history (a few dozen a day
 * since the worker call-capture kinds stopped being written) and expire after
 * 90 days on `happened_at`, which every row carries as a date. Idempotency
 * receipts live in `sales_intelligence_command_executions`, never here, so a
 * command replay does not depend on an audit row surviving.
 */
export const CSI_AUDIT_RETENTION_SECONDS = 90 * 24 * 60 * 60;
export const SALES_INTELLIGENCE_AUDIT_EVENT_INDEXES = [
  unique("csi_audit_semantic_unique", { semantic_key: 1 }),
  index("csi_audit_stream", { recorded_at: 1, _id: 1 }),
  index("csi_audit_subject", { subject_key: 1, happened_at: 1 }),
  // S9-READS (addendum §6.2 flow): "moved to Quoted" reads `lead_progress_updated` rows in the period.
  index("csi_audit_kind_happened", { event_kind: 1, happened_at: 1 }),
  {
    name: "csi_audit_happened_ttl",
    key: { happened_at: 1 as const },
    expireAfterSeconds: CSI_AUDIT_RETENTION_SECONDS,
  },
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
export const SALES_INTELLIGENCE_POLICY_VERSION_INDEXES = [
  unique("csi_policy_version_unique", { version: 1 }),
];
export const SalesIntelligencePolicyVersionSchema = new Schema(
  {
    version: str,
    policy: validatedJson(csiPersistedPolicySchema),
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
