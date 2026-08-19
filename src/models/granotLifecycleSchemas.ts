import { Schema } from "mongoose";
import type {
  CallLeadIngestionOrigin,
  ChannelOperationKind,
  CurrentContactSourceSystem,
  CurrentMoveSourceSystem,
  ExecutionMode,
  FormLeadIngestionOrigin,
  GranotBookingAction,
  GranotLifecycleDisposition,
  GranotObservationKind,
  GranotRouteEventClass,
  IngestedEvidenceStatus,
  LeadModel,
  NormalizationIssueCode,
  NormalizationResult,
  ObservationChannel,
  ReceiptWorkState,
  RingCentralConvergenceState,
  SynchronizationOutcome,
  SynchronizationReasonCode,
} from "../services/granotLifecycle/types";

export const RECEIPT_WORK_STATES = [
  "pending",
  "claimed",
  "retry_scheduled",
  "completed",
  "dead_letter",
] as const satisfies readonly ReceiptWorkState[];

export const AUTHENTICATION_METHODS = [
  "body_secret",
  "header_secret",
  "extension_session",
  "automation_owner_approval",
  "legacy_unknown",
] as const;

export const PAYLOAD_KINDS = ["object", "array", "null", "primitive"] as const;

export const OBSERVATION_CHANNELS = [
  "granot_webhook",
  "browser_extension",
  "granot_http_automation",
] as const satisfies readonly ObservationChannel[];

export const ROUTE_EVENT_CLASSES = [
  "lead_created",
  "priority_updated",
  "booking_status_changed",
] as const satisfies readonly GranotRouteEventClass[];

export const CHANNEL_OPERATION_KINDS = [
  "lead_snapshot_apply",
  "booking_action_apply",
] as const satisfies readonly ChannelOperationKind[];

export const OBSERVATION_KINDS = [
  "lead_snapshot",
  "booking_action_snapshot",
] as const satisfies readonly GranotObservationKind[];

export const NORMALIZATION_RESULTS = [
  "valid",
  "valid_with_issues",
  "invalid",
  "unsupported",
] as const satisfies readonly NormalizationResult[];

export const NORMALIZATION_ISSUE_CODES = [
  "payload_not_object",
  "route_payload_event_conflict",
  "missing_payload_event_type",
  "unsupported_booking_action",
  "invalid_source_label",
  "missing_job_number",
  "invalid_form_reference",
  "invalid_phone",
  "invalid_email",
  "invalid_move_date",
  "invalid_state",
  "invalid_cubic_feet",
  "invalid_priority",
  "invalid_money",
  "granot_agent_identity_conflict",
] as const satisfies readonly NormalizationIssueCode[];

export const GRANOT_BOOKING_ACTIONS = [
  "booked",
  "release",
] as const satisfies readonly GranotBookingAction[];

export const NORMALIZATION_ISSUE_SEVERITIES = ["warning", "error"] as const;

export const SYNCHRONIZATION_OUTCOMES = [
  "created",
  "applied",
  "linked",
  "already_current",
  "stale",
  "pending_match",
  "unmatched",
  "ambiguous",
  "conflict",
  "deferred",
  "policy_blocked",
  "insufficient_creation_data",
  "invalid",
  "unsupported",
] as const satisfies readonly SynchronizationOutcome[];

export const SYNCHRONIZATION_REASON_CODES = [
  "lead_created_authorized",
  "lead_state_changed",
  "record_link_established",
  "record_link_confirmed",
  "desired_state_already_current",
  "older_than_temporal_winner",
  "pending_source_scoped_match",
  "match_window_expired",
  "multiple_eligible_matches",
  "source_scope_conflict",
  "job_number_conflict",
  "record_link_conflict",
  "duplicate_form_lead_ineligible",
  "bad_form_lead_priority_only",
  "source_unclassified",
  "source_deferred",
  "source_disabled",
  "target_source_company_inactive",
  "target_source_granularity_inactive",
  "global_effect_disabled",
  "shadow_effect_suppressed",
  "creation_policy_link_only",
  "creation_policy_observation_only",
  "missing_creation_job_number",
  "missing_creation_contact",
  "missing_creation_route_data",
  "invalid_payload",
  "invalid_priority_update",
  "unsupported_booking_action",
  "booking_case_opened",
  "booking_case_refreshed",
  "release_case_opened",
  "release_case_refreshed",
  "booking_discrepancy_opened",
  "booking_discrepancy_refreshed",
  "release_discrepancy_opened",
  "release_discrepancy_refreshed",
  "booking_already_cancelled",
  "historical_shadow",
] as const satisfies readonly SynchronizationReasonCode[];

export const EXECUTION_MODES = [
  "historical_shadow",
  "live_shadow",
  "live",
] as const satisfies readonly ExecutionMode[];

export const SYNCHRONIZATION_MATCH_METHODS = [
  "granot_record_link",
  "form_ref_no_exact",
  "form_mongo_id_compatibility",
  "call_job_no_exact",
  "booking_job_no_exact",
  "source_scoped_contact",
] as const;

export const SYNCHRONIZATION_EFFECT_KINDS = [
  "record_link_established",
  "record_link_confirmed",
  "lead_created",
  "lead_updated",
  "booking_case_opened",
  "booking_case_refreshed",
  "release_case_opened",
  "release_case_refreshed",
  "discrepancy_opened",
  "discrepancy_refreshed",
  "sheet_sync_requested",
] as const;

export const ENTITY_REF_MODELS = [
  "FormLead",
  "CallLead",
  "BookedLead",
  "CancelledLead",
  "GranotRecordLink",
  "GranotBookingReconciliationCase",
  "GranotReleaseReconciliationCase",
] as const;

export const GRANOT_RECONCILIATION_CASE_STATES = ["open", "resolved"] as const;

export const GRANOT_RECONCILIATION_ACTION_KINDS = ["booked", "release"] as const;

export const GRANOT_RECONCILIATION_EVIDENCE_ACTIONS = [
  "priority_5",
  ...GRANOT_RECONCILIATION_ACTION_KINDS,
] as const;

export const GRANOT_BOOKING_RECONCILIATION_MODES = [
  "create_missing_booking",
  "review_existing_booking",
  "create_referral_booking",
] as const;

export const GRANOT_BOOKING_RECONCILIATION_OUTCOMES = [
  "booking_created",
  "booking_updated",
  "referral_booking_created",
  "no_action",
  "already_satisfied",
  "superseded_by_current_state",
] as const;

export const GRANOT_RELEASE_RECONCILIATION_OUTCOMES = [
  "cancellation_created",
  "booking_updated",
  "no_action",
  "already_satisfied",
  "superseded_by_current_state",
] as const;

export const GRANOT_RECONCILIATION_NO_ACTION_REASON_CODES = [
  "already_handled_elsewhere",
  "granot_action_not_authoritative",
  "wrong_customer_or_job",
  "duplicate_granot_action",
  "booking_still_valid",
  "granot_change_only",
  "insufficient_information",
  "legacy_data",
  "other",
] as const;

export const GRANOT_LIFECYCLE_DISPOSITIONS = [
  "source_scoped_lead",
  "referral_booking",
  "deferred",
] as const satisfies readonly GranotLifecycleDisposition[];

export const GRANOT_LEAD_MODELS = [
  "FormLead",
  "CallLead",
] as const satisfies readonly LeadModel[];

export const AGGREGATE_REVISION_FIELD_NAMES = [
  "domain_revision",
  "last_change_id",
  "last_changed_at",
  "change_history_started_at",
] as const;

export function isNonnegativeIntegerRevision(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= 0
  );
}

export const aggregateRevisionSchemaFields = {
  domain_revision: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
    validate: {
      validator: isNonnegativeIntegerRevision,
      message: "domain_revision must be a nonnegative integer",
    },
  },
  last_change_id: {
    type: Schema.Types.ObjectId,
    ref: "EntityChange",
  },
  last_changed_at: { type: Date },
  change_history_started_at: { type: Date },
};

export const FORM_LEAD_INGESTION_ORIGINS = [
  "wordpress_form",
  "granot_lead_created",
  "best_relocation_sheet",
  "vantage_admin",
  "legacy_unknown",
] as const satisfies readonly FormLeadIngestionOrigin[];

export const CALL_LEAD_INGESTION_ORIGINS = [
  "ringcentral",
  "granot_lead_created",
  "best_relocation_sheet",
  "vantage_admin",
  "legacy_import",
  "legacy_unknown",
] as const satisfies readonly CallLeadIngestionOrigin[];

export const ASSIGNABLE_FORM_LEAD_INGESTION_ORIGINS = [
  "wordpress_form",
  "granot_lead_created",
  "best_relocation_sheet",
  "vantage_admin",
] as const satisfies readonly Exclude<FormLeadIngestionOrigin, "legacy_unknown">[];

export const ASSIGNABLE_CALL_LEAD_INGESTION_ORIGINS = [
  "ringcentral",
  "granot_lead_created",
  "best_relocation_sheet",
  "vantage_admin",
  "legacy_import",
] as const satisfies readonly Exclude<CallLeadIngestionOrigin, "legacy_unknown">[];

export const INGESTED_EVIDENCE_STATUSES = [
  "captured_at_ingestion",
  "legacy_baseline",
] as const satisfies readonly IngestedEvidenceStatus[];

export const CURRENT_CONTACT_SOURCE_SYSTEMS = [
  "vantage",
  "granot",
  "ringcentral",
] as const satisfies readonly CurrentContactSourceSystem[];

export const CURRENT_MOVE_SOURCE_SYSTEMS = [
  "wordpress",
  "granot",
  "ringcentral",
  "admin",
  "legacy",
] as const satisfies readonly CurrentMoveSourceSystem[];

export const RINGCENTRAL_CONVERGENCE_STATES = [
  "pending",
  "adopted",
  "conflict",
  "not_applicable",
] as const satisfies readonly RingCentralConvergenceState[];

export const RECEIVER_AGENT_SOURCES = [
  "extension_match",
  "extension_selected",
  "extension_created",
  "extension_crm_username_match",
  "granot_username_match",
  "best_relocation_sheet",
  "manual",
] as const;

export const LEAD_PROVENANCE_FIELD_NAMES = [
  "ingestion_origin",
  "job_no",
  "normalized_job_no",
  "granot_priority",
  "granot_move_size",
  "granot_service_type",
  "ingested_contact_snapshot",
  "granot_contact_snapshot",
  "ingested_move_snapshot",
  "current_contact_provenance",
  "current_move_provenance",
  "last_accepted_granot_observation",
  "granot_contact_revision",
  "last_granot_contact_change",
  "ringcentral_convergence",
] as const;

export const PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS = [
  "ingestion_origin",
  "normalized_job_no",
  "granot_priority",
  "granot_move_size",
  "granot_service_type",
  "ingested_contact_snapshot",
  "granot_contact_snapshot",
  "ingested_move_snapshot",
  "current_contact_provenance",
  "current_move_provenance",
  "last_accepted_granot_observation",
  "granot_contact_revision",
  "last_granot_contact_change",
  "ringcentral_convergence",
  ...AGGREGATE_REVISION_FIELD_NAMES,
] as const;

const ingestedContactSnapshotSchema = new Schema(
  {
    first_name: { type: String, trim: true },
    last_name: { type: String, trim: true },
    name: { type: String, trim: true },
    phone_number: { type: String, trim: true },
    normalized_phone_number: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    captured_at: { type: Date, required: true },
    evidence_status: {
      type: String,
      required: true,
      enum: INGESTED_EVIDENCE_STATUSES,
    },
  },
  { _id: false },
);

const ingestedMoveSnapshotSchema = new Schema(
  {
    pickup_city: { type: String, trim: true },
    pickup_zip: { type: String, trim: true },
    pickup_state: { type: String, trim: true },
    delivery_city: { type: String, trim: true },
    destination_zip: { type: String, trim: true },
    delivery_state: { type: String, trim: true },
    move_date: { type: Date },
    move_size: { type: String, trim: true },
    captured_at: { type: Date, required: true },
    evidence_status: {
      type: String,
      required: true,
      enum: INGESTED_EVIDENCE_STATUSES,
    },
  },
  { _id: false },
);

const granotContactSnapshotSchema = new Schema(
  {
    first_name: { type: String, trim: true },
    last_name: { type: String, trim: true },
    name: { type: String, trim: true },
    phone_number: { type: String, trim: true },
    normalized_phone_number: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    differs_from_ingested: { type: Boolean, required: true },
    observation_id: { type: Schema.Types.ObjectId, required: true },
    captured_at: { type: Date, required: true },
  },
  { _id: false },
);

const currentContactProvenanceSchema = new Schema(
  {
    source_system: {
      type: String,
      required: true,
      enum: CURRENT_CONTACT_SOURCE_SYSTEMS,
    },
    observation_id: { type: Schema.Types.ObjectId },
    changed_at: { type: Date, required: true },
  },
  { _id: false },
);

const currentMoveProvenanceSchema = new Schema(
  {
    source_system: {
      type: String,
      required: true,
      enum: CURRENT_MOVE_SOURCE_SYSTEMS,
    },
    observation_id: { type: Schema.Types.ObjectId },
    changed_at: { type: Date, required: true },
  },
  { _id: false },
);

const lastAcceptedGranotObservationSchema = new Schema(
  {
    observation_id: { type: Schema.Types.ObjectId, required: true },
    captured_at: { type: Date, required: true },
  },
  { _id: false },
);

const lastGranotContactChangeSchema = new Schema(
  {
    observation_id: { type: Schema.Types.ObjectId, required: true },
    changed_at: { type: Date, required: true },
    changed_paths: { type: [String], required: true, default: undefined },
    before_hash: { type: String, required: true, trim: true },
    after_hash: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const ringcentralConvergenceSchema = new Schema(
  {
    state: {
      type: String,
      required: true,
      enum: RINGCENTRAL_CONVERGENCE_STATES,
    },
    candidate_window_started_at: { type: Date },
    adopted_at: { type: Date },
    conflict_reason: { type: String, trim: true },
    conflict_call_identity_hash: { type: String, trim: true },
    observation_id: { type: Schema.Types.ObjectId },
  },
  { _id: false },
);

export const sharedLeadProvenanceSchemaFields = {
  job_no: { type: String, trim: true },
  normalized_job_no: { type: String, trim: true },
  granot_priority: { type: String, trim: true },
  granot_move_size: { type: String, trim: true },
  granot_service_type: { type: String, trim: true },
  ingested_contact_snapshot: { type: ingestedContactSnapshotSchema },
  granot_contact_snapshot: { type: granotContactSnapshotSchema },
  current_contact_provenance: { type: currentContactProvenanceSchema },
  current_move_provenance: { type: currentMoveProvenanceSchema },
  last_accepted_granot_observation: { type: lastAcceptedGranotObservationSchema },
  granot_contact_revision: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
    validate: {
      validator: isNonnegativeIntegerRevision,
      message: "granot_contact_revision must be a nonnegative integer",
    },
  },
  last_granot_contact_change: { type: lastGranotContactChangeSchema },
};

export const formLeadProvenanceSchemaFields = {
  ingestion_origin: {
    type: String,
    enum: FORM_LEAD_INGESTION_ORIGINS,
  },
  ...sharedLeadProvenanceSchemaFields,
  ingested_move_snapshot: { type: ingestedMoveSnapshotSchema },
};

export const callLeadProvenanceSchemaFields = {
  ingestion_origin: {
    type: String,
    enum: CALL_LEAD_INGESTION_ORIGINS,
  },
  quoted: { type: Boolean, required: true, default: false },
  ringcentral_convergence: { type: ringcentralConvergenceSchema },
  ...sharedLeadProvenanceSchemaFields,
};

const IMMUTABLE_LEAD_PROVENANCE_PATHS = [
  "ingestion_origin",
  "ingested_contact_snapshot",
  "ingested_move_snapshot",
] as const;

export function applyLeadProvenanceGuards(schema: Schema): void {
  schema.pre("validate", function rejectImmutableProvenanceMutation() {
    if (this.isNew) {
      if (this.get("ingestion_origin") === "legacy_unknown") {
        this.invalidate(
          "ingestion_origin",
          "legacy_unknown is migration-only and is never assigned to a new row",
        );
      }
      const contactSnapshot = this.get("ingested_contact_snapshot") as
        | { evidence_status?: string }
        | undefined;
      if (contactSnapshot?.evidence_status === "legacy_baseline") {
        this.invalidate(
          "ingested_contact_snapshot",
          "legacy_baseline is migration-only and is never assigned to a new ingested snapshot",
        );
      }
      const moveSnapshot = this.get("ingested_move_snapshot") as
        | { evidence_status?: string }
        | undefined;
      if (moveSnapshot?.evidence_status === "legacy_baseline") {
        this.invalidate(
          "ingested_move_snapshot",
          "legacy_baseline is migration-only and is never assigned to a new ingested snapshot",
        );
      }
      return;
    }

    for (const path of IMMUTABLE_LEAD_PROVENANCE_PATHS) {
      if (schema.path(path) && this.isModified(path)) {
        this.invalidate(path, `${path} is immutable after insert`);
      }
    }
  });
}

export function applyAggregateRevisionGuards(schema: Schema): void {
  schema.pre("validate", function rejectInvalidRevisionMetadata() {
    const hasChangeId = this.get("last_change_id") != null;
    const hasChangedAt = this.get("last_changed_at") != null;
    if (hasChangeId !== hasChangedAt) {
      this.invalidate(
        "last_change_id",
        "last_change_id and last_changed_at must both be present or both absent",
      );
    }

    if (this.isNew) {
      this.set("change_history_started_at", new Date());
      return;
    }

    if (this.isModified("change_history_started_at")) {
      this.invalidate(
        "change_history_started_at",
        "change_history_started_at is write-once outside the authorized migration seam",
      );
    }
  });
}

export const RECORD_LINK_STATES = ["active", "superseded"] as const;

export const GRANOT_LIFECYCLE_ACTIVATION_KEY = "granot_lifecycle" as const;

const CONTROL_OR_BIDI = /[\p{Cc}\p{Cf}]/u;
const LOWERCASE_UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const granotReceiptLastErrorSchema = new Schema(
  {
    code: { type: String, required: true, trim: true },
    message: { type: String, required: true, maxlength: 500 },
    failed_at: { type: Date, required: true },
  },
  { _id: false },
);

export const granotReceiptProcessingSchema = new Schema(
  {
    state: {
      type: String,
      required: true,
      enum: RECEIPT_WORK_STATES,
    },
    technical_attempts: { type: Number, required: true, min: 0 },
    match_attempt: { type: Number, required: true, min: 0 },
    next_attempt_at: { type: Date, required: true },
    lease_owner: { type: String, trim: true },
    leased_until: { type: Date },
    last_started_at: { type: Date },
    last_error: { type: granotReceiptLastErrorSchema },
    completed_at: { type: Date },
    latest_decision_id: { type: Schema.Types.ObjectId },
    manual_requeue_count: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

export function assertChannelOperationId(
  value: unknown,
  channel: ObservationChannel | undefined,
): asserts value is string {
  if (typeof value !== "string") {
    throw new Error("channel_operation_id must be a string when present");
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 300) {
    throw new Error("channel_operation_id must be 1-300 trimmed characters");
  }
  if (CONTROL_OR_BIDI.test(trimmed)) {
    throw new Error(
      "channel_operation_id must not contain control or bidirectional characters",
    );
  }
  if (channel === "browser_extension" && !LOWERCASE_UUID_V4.test(trimmed)) {
    throw new Error("browser_extension channel_operation_id must be a lowercase UUID v4");
  }
  if (channel === "granot_http_automation" && !isAutomationOperationId(trimmed)) {
    throw new Error(
      "granot_http_automation channel_operation_id must exactly equal ${run_id}:${action_id}",
    );
  }
}

export function isAutomationOperationId(value: string): boolean {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    return false;
  }
  const runId = value.slice(0, separator);
  const actionId = value.slice(separator + 1);
  return (
    runId.length > 0 &&
    actionId.length > 0 &&
    !CONTROL_OR_BIDI.test(runId) &&
    !CONTROL_OR_BIDI.test(actionId)
  );
}

export function assertReceiptChannelShape(input: {
  observation_channel?: ObservationChannel;
  route_event_class?: unknown;
  channel_operation_kind?: ChannelOperationKind | unknown;
  channel_operation_id?: unknown;
}): void {
  const channel = input.observation_channel;
  if (channel === "granot_webhook") {
    if (input.route_event_class == null || input.route_event_class === "") {
      throw new Error("granot_webhook receipts require route_event_class");
    }
    if (input.channel_operation_kind != null) {
      throw new Error("granot_webhook receipts forbid channel_operation_kind");
    }
    return;
  }

  if (channel === "browser_extension" || channel === "granot_http_automation") {
    if (input.route_event_class != null && input.route_event_class !== "") {
      throw new Error(
        `${channel} receipts must not pretend to be webhook route deliveries`,
      );
    }
    if (input.channel_operation_kind == null || input.channel_operation_kind === "") {
      throw new Error(`${channel} receipts require channel_operation_kind`);
    }
    if (input.channel_operation_id == null || input.channel_operation_id === "") {
      throw new Error(`${channel} receipts require channel_operation_id`);
    }
  }
}
