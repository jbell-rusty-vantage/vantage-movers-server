import { parseReportingEnabledDatasets, REPORTING_DEFAULT_TIMEZONE, REPORTING_PREVIEW_LIMIT } from "../../../config/domain/reporting";
import type { DatasetColumn, DatasetContract, DatasetKey, MeasureContract } from "./types";

const column = (
  id: string,
  defaultLabel: string,
  type: DatasetColumn["type"],
  sensitivity: DatasetColumn["sensitivity"] = "internal",
  isDefault = true,
): DatasetColumn => ({ id, defaultLabel, type, sensitivity, default: isDefault });

export const LEAD_OUTCOME_COLUMNS = [
  column("lead_id", "Lead ID", "string", "internal", false),
  column("lead_type", "Lead Type", "enum"),
  column("lead_timestamp", "Lead Timestamp", "date_time"),
  column("source_company", "Source Company", "string"),
  column("source_granularity", "Granularity", "string"),
  column("customer_name", "Name", "string", "confidential_pii"),
  column("customer_phone", "Phone", "string", "confidential_pii"),
  column("customer_email", "Email", "string", "confidential_pii"),
  column("pickup_zip", "Pickup ZIP", "string", "confidential_pii"),
  column("pickup_state", "Pickup State", "string"),
  column("delivery_zip", "Delivery ZIP", "string", "confidential_pii"),
  column("delivery_state", "Delivery State", "string"),
  column("route_classification", "Route", "enum"),
  column("move_date", "Move Date", "date", "confidential_pii"),
  column("move_size", "Move Size", "string"),
  column("quoted", "Quoted", "not_applicable_boolean"),
  column("duplicate_state", "Duplicate", "boolean"),
  column("bad_lead_state", "Bad Lead", "boolean"),
  column("cpl_value", "CPL", "money"),
  column("cpl_resolution_status", "CPL Resolution", "enum"),
  column("booked", "Booked", "boolean"),
  column("booking_count", "Booking Count", "integer"),
  column("primary_job_number", "Primary Job Number", "string"),
  column("book_date", "Book Date", "date_time"),
  column("assigned_agents", "Assigned Agent(s)", "string"),
  column("merchant", "Merchant", "string"),
  column("binder", "Binder", "money"),
  column("deposit", "Deposit", "money"),
  column("cancelled_or_refunded", "Cancelled/Refunded", "boolean"),
  column("cancellation_or_refund_date", "Cancellation/Refund Date", "date_time"),
  column("refund_amount", "Refund Amount", "money"),
] as const;

export const EXCEPTION_TYPES = [
  "duplicate",
  "bad_lead",
  "unresolved_cpl_or_source_attribution",
  "leadless_booking",
  "ambiguous_or_unresolved_booking_match",
  "multiple_booking_anomaly",
  "source_canonical_divergence",
  "unresolved_cancellation_or_refund_relationship",
] as const;

const exceptionColumns = [
  column("exception_type", "Exception Type", "enum"),
  column("date_basis", "Date Basis", "enum"),
  column("exception_timestamp", "Exception Timestamp", "date_time"),
  column("source_company", "Source Company", "string"),
  column("source_granularity", "Granularity", "string"),
  column("lead_id", "Lead ID", "string", "internal", false),
  column("lead_type", "Lead Type", "enum", "internal", false),
  column("job_number", "Job Number", "string", "internal", false),
  column("summary", "Summary", "string"),
  column("operational_status", "Operational Status", "enum"),
  column("related_record_count", "Related Record Count", "integer"),
] as const;

export const SOURCE_PERFORMANCE_MEASURES = [
  ["total_leads", "Distinct canonical leads in the cohort", "integer"],
  ["valid_leads", "Cohort leads not marked duplicate or bad", "integer"],
  ["duplicates", "Cohort leads marked duplicate", "integer"],
  ["bad_leads", "Cohort leads marked bad", "integer"],
  ["quoted_form_leads", "Form leads with quoted true", "integer"],
  ["booked_leads", "Distinct cohort leads with at least one related booking", "integer"],
  ["cancelled_bookings", "Every related booking with a cancellation/refund", "integer"],
  ["net_bookings", "All related bookings minus cancelled/refunded related bookings", "integer"],
  ["lead_to_booking_conversion", "booked_leads / total_leads; null when total_leads is zero", "decimal"],
  ["net_conversion", "net_bookings / total_leads; null when total_leads is zero", "decimal"],
  ["resolved_cpl_spend", "Sum of resolved canonical CPL for cohort leads", "money"],
  ["unresolved_cpl_count", "Cohort leads without resolved CPL", "integer"],
  ["total_binder", "Sum of binder across every related booking", "money"],
  ["total_deposit", "Sum of deposit across every related booking", "money"],
] satisfies ReadonlyArray<readonly [string, string, MeasureContract["type"]]>;

const sourceMeasures: MeasureContract[] = SOURCE_PERFORMANCE_MEASURES.map(
  ([id, definition, type]) => ({ id, definition, type }),
);
const sourceColumns = [
  column("period", "Period", "string"),
  column("source_company", "Source Company", "string"),
  column("source_granularity", "Granularity", "string"),
  ...sourceMeasures.map((measure) => column(measure.id, measure.id, measure.type)),
];

export const REPORTING_DATASETS: Readonly<Record<DatasetKey, DatasetContract>> = {
  lead_outcome_detail: {
    key: "lead_outcome_detail",
    schemaVersion: 1,
    grain: "Exactly one canonical lead per row",
    dateSemantic: "Lead cohort [from,to), with current outcomes attached",
    columns: LEAD_OUTCOME_COLUMNS,
    measures: [],
    filterKeys: ["leadType", "agentKeys", "merchantKeys", "route", "bookingStatus", "cancellationStatus"],
    filterSchema: {
      unknownKeys: "reject",
      fields: [
        { id: "leadType", type: "enum", required: false, options: ["form", "call"] },
        { id: "agentKeys", type: "string_array", required: false, maxItems: 100 },
        { id: "merchantKeys", type: "string_array", required: false, maxItems: 100 },
        { id: "route", type: "enum", required: false, options: ["local", "long_distance"] },
        { id: "bookingStatus", type: "enum", required: false, options: ["booked", "unbooked"] },
        { id: "cancellationStatus", type: "enum", required: false, options: ["active", "cancelled_or_refunded"] },
      ],
    },
    allowedSorts: ["lead_timestamp", "source_company", "source_granularity", "customer_name", "move_date", "book_date", "primary_job_number"],
    defaultSort: [{ id: "lead_timestamp", direction: "asc" }],
    requiredTieBreakers: [{ id: "lead_type", direction: "asc" }, { id: "lead_id", direction: "asc" }],
    samplePolicyVersion: 1,
  },
  lead_quality_exceptions: {
    key: "lead_quality_exceptions",
    schemaVersion: 1,
    grain: "Exactly one report-quality exception occurrence per row",
    dateSemantic: "Lead cohort when present, otherwise related canonical observation",
    columns: exceptionColumns,
    measures: [],
    filterKeys: ["exceptionTypes", "leadType"],
    filterSchema: {
      unknownKeys: "reject",
      fields: [
        { id: "exceptionTypes", type: "enum_array", required: false, options: EXCEPTION_TYPES, maxItems: 8 },
        { id: "leadType", type: "enum", required: false, options: ["form", "call", "none"] },
      ],
    },
    allowedSorts: ["exception_timestamp", "exception_type"],
    defaultSort: [{ id: "exception_timestamp", direction: "asc" }, { id: "exception_type", direction: "asc" }],
    requiredTieBreakers: [{ id: "exception_key", direction: "asc" }],
    samplePolicyVersion: 1,
  },
  source_performance: {
    key: "source_performance",
    schemaVersion: 1,
    grain: "Source Company, optional Granularity, and selected time dimension",
    dateSemantic: "Lead cohort [from,to), aggregating all related bookings",
    columns: sourceColumns,
    measures: sourceMeasures,
    filterKeys: ["timeDimension", "includeGranularity", "leadType"],
    filterSchema: {
      unknownKeys: "reject",
      fields: [
        { id: "timeDimension", type: "enum", required: false, options: ["none", "day", "month"] },
        { id: "includeGranularity", type: "boolean", required: false },
        { id: "leadType", type: "enum", required: false, options: ["form", "call"] },
      ],
    },
    allowedSorts: ["period", "source_company", "source_granularity"],
    defaultSort: [{ id: "period", direction: "asc" }, { id: "source_company", direction: "asc" }, { id: "source_granularity", direction: "asc" }],
    requiredTieBreakers: [{ id: "_source_company_id", direction: "asc" }, { id: "_source_granularity_key", direction: "asc" }],
    samplePolicyVersion: 1,
  },
};

export function getReportingCatalog(enabled = parseReportingEnabledDatasets()) {
  return {
    defaultTimezone: REPORTING_DEFAULT_TIMEZONE,
    manualOnly: true,
    previewLimit: REPORTING_PREVIEW_LIMIT,
    dateWindow: {
      kinds: ["explicit", "rolling"] as const,
      rolling: {
        presets: ["last_n_days"] as const,
        minDays: 1,
        maxDays: 366,
        anchor: "preview_or_run_time" as const,
        endPolicy: "include_current_local_day" as const,
      },
    },
    datasets: Object.values(REPORTING_DATASETS).filter((dataset) => enabled.has(dataset.key)),
  };
}

export function requireDataset(key: DatasetKey, enabled = parseReportingEnabledDatasets()): DatasetContract {
  const contract = REPORTING_DATASETS[key];
  if (!enabled.has(key)) throw reportingError("dataset_disabled", `${key} is disabled.`);
  return contract;
}

export class ReportingError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 400) {
    super(message);
    this.name = "ReportingError";
  }
}

export function reportingError(code: string, message: string, statusCode = 400): ReportingError {
  return new ReportingError(code, message, statusCode);
}

export * from "./types";
