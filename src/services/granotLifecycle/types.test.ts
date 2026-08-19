import assert from "node:assert/strict";
import test from "node:test";
import type {
  ChannelOperationKind,
  EntityRef,
  ExecutionMode,
  GranotBookingAction,
  GranotDiscrepancyReasonCode,
  GranotLeadCreatedPolicy,
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
} from "./types";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type _ObservationChannel = Assert<
  Equal<ObservationChannel, "granot_webhook" | "browser_extension" | "granot_http_automation">
>;
type _GranotRouteEventClass = Assert<
  Equal<GranotRouteEventClass, "lead_created" | "priority_updated" | "booking_status_changed">
>;
type _ChannelOperationKind = Assert<
  Equal<ChannelOperationKind, "lead_snapshot_apply" | "booking_action_apply">
>;
type _GranotObservationKind = Assert<
  Equal<GranotObservationKind, "lead_snapshot" | "booking_action_snapshot">
>;
type _ReceiptWorkState = Assert<
  Equal<ReceiptWorkState, "pending" | "claimed" | "retry_scheduled" | "completed" | "dead_letter">
>;
type _NormalizationResult = Assert<
  Equal<NormalizationResult, "valid" | "valid_with_issues" | "invalid" | "unsupported">
>;
type _NormalizationIssueCode = Assert<
  Equal<
    NormalizationIssueCode,
    | "payload_not_object"
    | "route_payload_event_conflict"
    | "missing_payload_event_type"
    | "unsupported_booking_action"
    | "invalid_source_label"
    | "missing_job_number"
    | "invalid_form_reference"
    | "invalid_phone"
    | "invalid_email"
    | "invalid_move_date"
    | "invalid_state"
    | "invalid_cubic_feet"
    | "invalid_priority"
    | "invalid_money"
    | "granot_agent_identity_conflict"
  >
>;
type _SynchronizationOutcome = Assert<
  Equal<
    SynchronizationOutcome,
    | "created"
    | "applied"
    | "linked"
    | "already_current"
    | "stale"
    | "pending_match"
    | "unmatched"
    | "ambiguous"
    | "conflict"
    | "deferred"
    | "policy_blocked"
    | "insufficient_creation_data"
    | "invalid"
    | "unsupported"
  >
>;
type _SynchronizationReasonCode = Assert<
  Equal<
    SynchronizationReasonCode,
    | "lead_created_authorized"
    | "lead_state_changed"
    | "record_link_established"
    | "record_link_confirmed"
    | "desired_state_already_current"
    | "older_than_temporal_winner"
    | "pending_source_scoped_match"
    | "match_window_expired"
    | "multiple_eligible_matches"
    | "source_scope_conflict"
    | "job_number_conflict"
    | "record_link_conflict"
    | "duplicate_form_lead_ineligible"
    | "bad_form_lead_priority_only"
    | "source_unclassified"
    | "source_deferred"
    | "source_disabled"
    | "target_source_company_inactive"
    | "target_source_granularity_inactive"
    | "global_effect_disabled"
    | "shadow_effect_suppressed"
    | "creation_policy_link_only"
    | "creation_policy_observation_only"
    | "missing_creation_job_number"
    | "missing_creation_contact"
    | "missing_creation_route_data"
    | "invalid_payload"
    | "invalid_priority_update"
    | "unsupported_booking_action"
    | "booking_case_opened"
    | "booking_case_refreshed"
    | "release_case_opened"
    | "release_case_refreshed"
    | "booking_discrepancy_opened"
    | "booking_discrepancy_refreshed"
    | "release_discrepancy_opened"
    | "release_discrepancy_refreshed"
    | "booking_already_cancelled"
    | "historical_shadow"
  >
>;
type _ExecutionMode = Assert<Equal<ExecutionMode, "historical_shadow" | "live_shadow" | "live">>;
type _GranotBookingAction = Assert<Equal<GranotBookingAction, "booked" | "release">>;
type _LeadModel = Assert<Equal<LeadModel, "FormLead" | "CallLead">>;
type _EntityRef = Assert<
  Equal<
    EntityRef,
    {
      model:
        | LeadModel
        | "BookedLead"
        | "CancelledLead"
        | "GranotRecordLink"
        | "GranotBookingReconciliationCase"
        | "GranotReleaseReconciliationCase"
        | "GranotBookingDiscrepancy"
        | "GranotReleaseDiscrepancy";
      id: string;
    }
  >
>;
type _GranotLifecycleDisposition = Assert<
  Equal<GranotLifecycleDisposition, "source_scoped_lead" | "referral_booking" | "deferred">
>;
type _GranotLeadCreatedPolicy = Assert<
  Equal<GranotLeadCreatedPolicy, "link_only" | "create_if_missing" | "observation_only">
>;
type _GranotDiscrepancyReasonCode = Assert<
  Equal<
    GranotDiscrepancyReasonCode,
    | "booked_record_link_conflict"
    | "booked_booking_lead_conflict"
    | "booked_job_number_conflict"
    | "booked_source_scope_conflict"
    | "booked_after_official_cancellation"
    | "release_without_vantage_booking"
    | "release_record_link_conflict"
    | "release_job_number_conflict"
    | "release_source_scope_conflict"
  >
>;

test("[AC-03][AC-05][AC-06][AC-29] shared lifecycle vocabulary remains exact", () => {
  assert.ok(true);
});
