import type { JobTimelineLeadModel } from "./types.js";

export type IdLike = string;

export type ObservationRow = {
  id: IdLike;
  captured_at: string;
  normalized_job_no?: string;
  job_no_snapshot?: string;
  identity?: { normalized_job_no?: string; job_no_raw?: string };
  receipt_id?: string;
  route_event_class?: string;
  normalization_result?: string;
  priority_canonical?: string;
  priority_valid?: boolean;
  priority?: { canonical?: string; valid?: boolean };
  booking_action_normalized?: string;
  booking_action?: { normalized?: string };
  issue_codes?: string[];
  granot_crm_source_id?: string;
  contact?: Record<string, unknown>;
};

export type DecisionRow = {
  id: IdLike;
  observation_id: string;
  attempt: number;
  decided_at: string;
  execution_mode?: string;
  outcome?: string;
  reason_code?: string;
  match_method?: string;
  target?: { model: string; id: string };
  source_granularity_id?: string;
  source_company_id?: string;
  source_scope?: { source_granularity_id?: string; lead_source_company?: string };
  effect_kinds?: string[];
  effects?: Array<{ kind?: string }>;
  evaluated_gates?: Array<{ gate: string; allowed: boolean }>;
};

export type RecordLinkRow = {
  id: IdLike;
  normalized_job_no: string;
  job_no_snapshot?: string;
  state: string;
  established_at?: string;
  lead_ref?: { model: JobTimelineLeadModel; id: string };
  source_granularity_id?: string;
  source_company_id?: string;
};

export type BookingRow = {
  id: IdLike;
  normalized_job_no: string;
  job_no_snapshot?: string;
  lead_ref?: string;
  lead_model?: JobTimelineLeadModel;
  last_changed_at?: string;
  timestamp?: string;
  createdAt?: string;
};

export type CancellationRow = {
  id: IdLike;
  booked_lead?: string;
  last_changed_at?: string;
  createdAt?: string;
};

export type CaseEvidenceRow = {
  observation_id: string;
  captured_at: string;
};

export type CaseRow = {
  id: IdLike;
  kind: "booking" | "release";
  normalized_job_no: string;
  job_no_snapshot?: string;
  state: "open" | "resolved";
  mode?: string;
  sequence_number?: number;
  case_revision?: number;
  evidence_revision?: number;
  opened_at?: string;
  resolved_at?: string;
  evidence?: CaseEvidenceRow[];
};

export type DiscrepancyRow = {
  id: IdLike;
  normalized_job_no: string;
};

export type LeadRow = {
  id: IdLike;
  model: JobTimelineLeadModel;
  ingestion_origin?: string;
  timestamp?: string;
  createdAt?: string;
  change_history_started_at?: string;
  source_granularity_id?: string;
  source_company_id?: string;
  source_company_label?: string;
  source_granularity_label?: string;
  name?: string;
  phone?: string;
  phone_number?: string;
  email?: string;
  job_no?: string;
  normalized_job_no?: string;
};

export type EntityChangeRow = {
  id: IdLike;
  entity_model?: string;
  entity_id?: string;
  entity?: { model: string; id: string };
  command_name: string;
  applied_at: string;
  changed_paths: string[];
};

export type LeadMessageRow = {
  id: IdLike;
  lead_id?: string;
  lead_ref?: { model?: string; id?: string };
  form_lead?: string;
  origin?: string;
  purpose?: string;
  status?: string;
  skip_reason?: string | null;
  observation_id?: string;
  consent_basis?: string;
  delivered_at?: string;
  sent_at?: string;
  accepted_at?: string;
  createdAt?: string;
  to?: string;
  from?: string;
  body?: string;
};

export type SheetSyncJobRow = {
  id: IdLike;
  entity_id: string;
  entity_model?: string;
  resource: string;
  operation: string;
  status: string;
  attempts?: number;
  created_by?: string;
  createdAt: string;
  updatedAt?: string;
  target_hints?: string[];
  last_error?: string;
  spreadsheet_id?: string;
};

export type CrmSourceRow = {
  id: IdLike;
  source_granularity_id?: string;
  review_state?: string;
  lifecycle_routes?: Array<{ source_granularity_id?: string }>;
};

export type GranularityRow = {
  id: IdLike;
  source_company_id?: string;
  owner_label?: string;
  label?: string;
};

export type JobTimelineRows = {
  observations?: ObservationRow[];
  decisions?: DecisionRow[];
  record_links?: RecordLinkRow[];
  bookings?: BookingRow[];
  cancellations?: CancellationRow[];
  cases?: CaseRow[];
  booking_cases?: CaseRow[];
  release_cases?: CaseRow[];
  booking_discrepancies?: DiscrepancyRow[];
  release_discrepancies?: DiscrepancyRow[];
  leads?: LeadRow[];
  entity_changes?: EntityChangeRow[];
  lead_messages?: LeadMessageRow[];
  sheet_sync_jobs?: SheetSyncJobRow[];
  granot_crm_sources?: CrmSourceRow[];
  granularities?: GranularityRow[];
  source_granularities?: GranularityRow[];
};

export type JobTimelineAssembleInput = {
  rawJobNo: string;
  filters?: {
    source_granularity_id?: string;
    source_company_id?: string;
    company_granularity_ids?: string[];
  };
  rows: JobTimelineRows;
};

export function emptyJobTimelineRows(): Required<JobTimelineRows> {
  return {
    observations: [],
    decisions: [],
    record_links: [],
    bookings: [],
    cancellations: [],
    cases: [],
    booking_cases: [],
    release_cases: [],
    booking_discrepancies: [],
    release_discrepancies: [],
    leads: [],
    entity_changes: [],
    lead_messages: [],
    sheet_sync_jobs: [],
    granot_crm_sources: [],
    granularities: [],
    source_granularities: [],
  };
}
