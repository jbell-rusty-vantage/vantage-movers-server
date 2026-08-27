import type { JobTimelinePage } from "../../job-number-timeline/src/types.js";

export type Confidence = "verified" | "strong" | "bounded" | "unknown";

export type WindowSpec = {
  from: Date;
  to: Date;
};

export type CountRow = {
  key: string;
  count: number;
};

export type ReceiptEvidence = {
  id: string;
  captured_at: string;
  route: string;
  state: string;
};

export type ObservationEvidence = {
  id: string;
  receipt_id: string | null;
  captured_at: string;
  route: string;
  priority: string | null;
  action: string | null;
  normalization_result: string | null;
  normalized_job_no: string | null;
};

export type DecisionEffectEvidence = {
  kind: string;
  ref_model: string | null;
  ref_id: string | null;
  changed_paths: string[];
};

export type DecisionEvidence = {
  id: string;
  observation_id: string;
  attempt: number;
  decided_at: string;
  execution_mode: string;
  outcome: string;
  reason_code: string;
  effects: DecisionEffectEvidence[];
};

export type LeadEvidence = {
  id: string;
  model: "FormLead" | "CallLead";
  created_at: string;
  ingestion_origin: string;
  normalized_job_no: string | null;
  domain_revision: number | null;
};

export type MessageEvidence = {
  id: string;
  created_at: string;
  origin: string;
  purpose: string;
  status: string;
  lead_model: string | null;
  lead_id: string | null;
};

export type ChangeEvidence = {
  id: string;
  entity_model: string;
  entity_id: string;
  command_name: string;
  decision_id: string | null;
  applied_at: string;
  changed_paths: string[];
  in_window: boolean;
};

export type BookingEvidence = {
  id: string;
  activity_at: string;
  normalized_job_no: string | null;
  lead_id: string | null;
  booking_origin: string;
  in_window: boolean;
};

export type CancellationEvidence = {
  id: string;
  booked_lead_id: string;
  activity_at: string;
  in_window: boolean;
};

export type CaseEvidence = {
  id: string;
  kind: "booking" | "cancellation";
  normalized_job_no: string | null;
  state: string;
  mode: string;
  opened_at: string;
  last_evidence_at: string;
  resolved_at: string | null;
  deterministic_booking_id: string | null;
  resolution_outcome: string | null;
};

export type SheetJobEvidence = {
  id: string;
  entity_id: string;
  entity_model: string;
  resource: string;
  operation: string;
  status: string;
  created_at: string;
  updated_at: string;
  in_window: boolean;
};

export type RingCentralProcessedEvidence = {
  status: string;
  ingestion_source: string;
  first_processed_at: string;
  call_lead_expected: boolean;
  call_lead_exists: boolean;
};

export type RingCentralSyncStateEvidence = {
  last_sync_from: string | null;
  last_sync_to: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  last_error: string | null;
  last_processed_count: number | null;
  last_qualified_count: number | null;
  last_lead_action_count: number | null;
};

export type LifecycleEvidence = {
  database: string;
  generated_at: string;
  window: { from: string; to: string };
  activated_at: string | null;
  receipts: ReceiptEvidence[];
  observations: ObservationEvidence[];
  decisions: DecisionEvidence[];
  leads: LeadEvidence[];
  messages: MessageEvidence[];
  changes: ChangeEvidence[];
  bookings: BookingEvidence[];
  cancellations: CancellationEvidence[];
  booking_cases: CaseEvidence[];
  cancellation_cases: CaseEvidence[];
  sheet_jobs: SheetJobEvidence[];
  ringcentral_processed: RingCentralProcessedEvidence[];
  ringcentral_sync_state: RingCentralSyncStateEvidence | null;
  cancellation_traceability: {
    total: number;
    with_surviving_booking: number;
    with_resolvable_job: number;
  };
  timeline_pages: JobTimelinePage[];
  collection_counts_before: Record<string, number>;
  collection_counts_after: Record<string, number>;
};

export type AssuranceFinding = {
  severity: "ok" | "attention" | "gap";
  code: string;
  statement: string;
  count?: number;
};

export type StageAssurance = {
  stage: string;
  confidence: Confidence;
  result: string;
  evidence: string;
  limitation: string;
};

export type TimelineProof = {
  label: string;
  proof_shape: string;
  stages: string[];
  missing_stages: string[];
  events: Array<{ event_at: string; kind: string; headline: string }>;
};

export type AssuranceReport = {
  database: string;
  generated_at: string;
  window: { from: string; to: string; timezone: "America/New_York" };
  activated_at: string | null;
  verdict: string;
  stages: StageAssurance[];
  granot: {
    receipts: number;
    observations: number;
    latest_decisions: number;
    completed_receipts_without_observation: number;
    observations_without_receipt: number;
    observations_without_decision: number;
    observations_with_multiple_attempts: number;
    pre_activation_observations: number;
    post_activation_observations: number;
    receipt_states: CountRow[];
    observation_routes: CountRow[];
    decision_outcomes: CountRow[];
    applied_or_created: number;
    applied_with_exact_entity_change: number;
    applied_with_entity_sheet_job: number;
    applied_sheet_statuses: CountRow[];
  };
  ringcentral: {
    processed_calls: number;
    statuses: CountRow[];
    ingestion_sources: CountRow[];
    materialized_expected: number;
    materialized_with_call_lead: number;
    covered_through: string | null;
    cursor_lag_minutes: number | null;
    last_run_status: string | null;
    last_error: string | null;
    last_run_counts: {
      processed: number | null;
      qualified: number | null;
      lead_actions: number | null;
    };
  };
  lifecycle: {
    leads_by_origin: CountRow[];
    leads_with_create_change: number;
    messages_by_status: CountRow[];
    messages_by_origin: CountRow[];
    changes_by_command: CountRow[];
    changed_paths: CountRow[];
    booking_cases_by_state: CountRow[];
    official_bookings: number;
    resolved_booking_cases: number;
    resolved_booking_cases_with_official_fact: number;
    finalized_booking_cases: number;
    finalized_booking_cases_with_official_fact: number;
    cancellation_cases_by_state: CountRow[];
    official_cancellations: number;
    resolved_cancellation_cases: number;
    resolved_cancellation_cases_with_official_fact: number;
    finalized_cancellation_cases: number;
    finalized_cancellation_cases_with_official_fact: number;
    historical_cancellations: number;
    historical_cancellations_with_surviving_booking: number;
    historical_cancellations_with_resolvable_job: number;
  };
  sheets: {
    jobs: number;
    statuses: CountRow[];
    terminal_failures: number;
    destination_verified: false;
  };
  findings: AssuranceFinding[];
  timelines: TimelineProof[];
  read_only_proof: {
    collection_count_deltas: Record<string, number>;
    source_operations: string[];
    note: string;
  };
};
