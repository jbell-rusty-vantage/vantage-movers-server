export type JobTimelineEventKind =
  | "lead_created"
  | "lead_message"
  | "job_number_acquired"
  | "lead_updated"
  | "granot_observation"
  | "synchronization_decision"
  | "booking_intake"
  | "cancellation_intake"
  | "official_booking"
  | "official_cancellation"
  | "sheet_sync";

export type JobTimelineCoverageFlag =
  | "command_backed"
  | "official_fact_only"
  | "evidence_only";

export type JobTimelineProofShape =
  | "granot_born"
  | "wordpress_born"
  | "ringcentral_born"
  | "other";

export type JobTimelineLeadModel = "FormLead" | "CallLead";

export type JobTimelineEvent = {
  id: string;
  kind: JobTimelineEventKind;
  event_at: string;
  clock_field: string;
  type_priority: number;
  coverage: JobTimelineCoverageFlag;
  headline: string;
  data: Record<string, unknown>;
};

export type JobTimelinePage = {
  normalized_job_no: string;
  job_no_snapshot: string | null;
  proof_shape: JobTimelineProofShape;
  source: {
    source_company_id: string | null;
    source_company_label: string | null;
    source_granularity_id: string | null;
    source_granularity_label: string | null;
  };
  coverage: {
    lead: "resolved" | "unresolved";
    lead_message: "present" | "absent";
    job_number_at_create: boolean;
    booking_intake: "absent" | "open" | "resolved";
    cancellation_intake: "absent" | "open" | "resolved";
    official_booking: boolean;
    official_cancellation: boolean;
    sheet_sync: "absent" | "pending" | "synced" | "failed" | "mixed";
  };
  current: {
    lead_ref?: { model: JobTimelineLeadModel; id: string };
    ingestion_origin?: string;
    record_link_id?: string;
    booking_id?: string;
    cancellation_id?: string;
  };
  events: JobTimelineEvent[];
};

export type JobTimelineAssembleStatus =
  | "ok"
  | "invalid_job_number"
  | "not_found"
  | "filtered_out";

export type JobTimelineResolvedScope = {
  kind: "lead" | "record_link" | "decision" | "observation_route";
  source_granularity_id: string | null;
  source_granularity_label: string | null;
  source_company_id?: string | null;
  owner_label?: string | null;
};

export type JobTimelineAssembleResult =
  | { status: "ok"; page: JobTimelinePage }
  | { status: "invalid_job_number"; normalized_job_no: null }
  | { status: "not_found"; normalized_job_no: string }
  | {
      status: "filtered_out";
      normalized_job_no: string;
      scopes: JobTimelineResolvedScope[];
    };

export const JOB_TIMELINE_TYPE_PRIORITY: Record<JobTimelineEventKind, number> = {
  lead_created: 10,
  lead_message: 20,
  job_number_acquired: 30,
  lead_updated: 40,
  granot_observation: 50,
  synchronization_decision: 60,
  booking_intake: 70,
  cancellation_intake: 80,
  official_booking: 90,
  official_cancellation: 100,
  sheet_sync: 110,
};

export const SUCCESSFUL_LEAD_MESSAGE_STATUSES = [
  "accepted",
  "sent",
  "delivered",
] as const;

export type JobTimelineAssembleFilters = {
  source_granularity_id?: string;
  source_company_id?: string;
  company_granularity_ids?: string[];
};

export type JobTimelineDiscoverOptions = {
  minScore?: number;
  limit?: number;
};

export type JobTimelineDiscoverRow = {
  normalized_job_no: string;
  source_granularity_label: string | null;
  score: number;
  present_kinds: JobTimelineEventKind[];
  proof_shape: JobTimelineProofShape;
};
