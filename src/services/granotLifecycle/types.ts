export type ObservationChannel =
  | "granot_webhook"
  | "browser_extension"
  | "granot_http_automation";

export type GranotRouteEventClass =
  | "lead_created"
  | "priority_updated"
  | "booking_status_changed";

export type ChannelOperationKind =
  | "lead_snapshot_apply"
  | "booking_action_apply";

export type GranotObservationKind =
  | "lead_snapshot"
  | "booking_action_snapshot";

export type ReceiptWorkState =
  | "pending"
  | "claimed"
  | "retry_scheduled"
  | "completed"
  | "dead_letter";

export type NormalizationResult =
  | "valid"
  | "valid_with_issues"
  | "invalid"
  | "unsupported";

export type NormalizationIssueCode =
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
  | "granot_agent_identity_conflict";

export type SynchronizationOutcome =
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
  | "unsupported";

export type SynchronizationReasonCode =
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
  | "historical_shadow";

export type ExecutionMode = "historical_shadow" | "live_shadow" | "live";

export type GranotBookingAction = "booked" | "release";

export type LeadModel = "FormLead" | "CallLead";

export type EntityRef = {
  model:
    | LeadModel
    | "BookedLead"
    | "CancelledLead"
    | "GranotRecordLink"
    | "GranotBookingReconciliationCase"
    | "GranotReleaseReconciliationCase";
  id: string;
};

export type GranotLifecycleDisposition =
  | "source_scoped_lead"
  | "referral_booking"
  | "deferred";

export type GranotLeadCreatedPolicy =
  | "link_only"
  | "create_if_missing"
  | "observation_only";

export type GranotDiscrepancyReasonCode =
  | "booked_record_link_conflict"
  | "booked_booking_lead_conflict"
  | "booked_job_number_conflict"
  | "booked_source_scope_conflict"
  | "booked_after_official_cancellation"
  | "release_without_vantage_booking"
  | "release_record_link_conflict"
  | "release_job_number_conflict"
  | "release_source_scope_conflict";
