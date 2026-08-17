import { Schema } from "mongoose";
import type {
  ChannelOperationKind,
  ExecutionMode,
  GranotBookingAction,
  GranotLifecycleDisposition,
  GranotObservationKind,
  GranotRouteEventClass,
  LeadModel,
  NormalizationIssueCode,
  NormalizationResult,
  ObservationChannel,
  ReceiptWorkState,
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

export const GRANOT_LIFECYCLE_DISPOSITIONS = [
  "source_scoped_lead",
  "referral_booking",
  "deferred",
] as const satisfies readonly GranotLifecycleDisposition[];

export const GRANOT_LEAD_MODELS = [
  "FormLead",
  "CallLead",
] as const satisfies readonly LeadModel[];

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
