import { toCsv, type CsvRow } from "../../utils/csv";
import type { AnalyticsQuery, AnalyticsReport } from "../../validation/v1.validation";
import { getAnalyticsReport } from "./analytics.service";

const CSV_COLUMNS: Record<AnalyticsReport, string[]> = {
  summary: [
    "form_leads",
    "call_leads",
    "total_leads",
    "bookings",
    "cancelled_bookings",
    "cancellations",
    "total_deposit_amount",
    "total_binder_amount",
    "total_refund_amount",
    "booking_rate",
    "cancellation_rate",
  ],
  "revenue-trend": ["period", "bookings", "cancelled_bookings", "total_deposit_amount", "total_binder_amount", "cancellation_rate"],
  "source-company-performance": [
    "source_company",
    "bookings",
    "cancelled_bookings",
    "active_bookings",
    "total_deposit_amount",
    "total_binder_amount",
    "booking_rate",
    "cancellation_rate",
  ],
  "agent-performance": [
    "agent_name",
    "bookings",
    "cancelled_bookings",
    "active_bookings",
    "total_binder_amount",
    "total_deposit_amount",
    "average_binder_amount",
    "average_deposit_amount",
    "cancellation_rate",
  ],
  "booking-cancellation-ratio": [
    "source_company",
    "booked_leads",
    "cancelled_leads",
    "active_booked_leads",
    "cancellation_rate",
  ],
  "source-company-funnel": [
    "source_company",
    "total_leads",
    "form_leads",
    "call_leads",
    "sheet_booked_leads",
    "sheet_cancelled_leads",
    "reconciled_bookings",
    "reconciled_cancelled_bookings",
    "total_deposit_amount",
    "total_binder_amount",
    "booking_rate",
    "cancellation_rate",
  ],
  "cancellation-reasons": [
    "reason",
    "cancellations",
    "linked_to_booked",
    "total_refund_amount",
    "affected_deposit_amount",
    "affected_binder_amount",
  ],
  "lead-source-performance": ["lead_source", "bookings", "cancelled_bookings", "total_deposit_amount", "total_binder_amount", "cancellation_rate"],
  "local-vs-long-distance": ["local_type", "bookings", "cancelled_bookings", "total_deposit_amount", "total_binder_amount", "cancellation_rate"],
  "geographic-lanes": ["lead_type", "pickup_state", "delivery_state", "leads", "booked_leads", "cancelled_leads", "booking_rate"],
  "pickup-state-performance": ["state", "leads", "booked_leads", "cancelled_leads", "booking_rate"],
  "delivery-state-performance": ["state", "leads", "booked_leads", "cancelled_leads", "booking_rate"],
  "receiver-agent-performance": [
    "receiver_agent_id",
    "receiver_agent_name",
    "receiver_agent_group",
    "received_leads",
    "billable_received_leads",
    "unresolved_cpl_count",
    "form_leads",
    "call_leads",
    "booked_leads",
    "active_booked_leads",
    "cancelled_leads",
    "total_lead_cost",
    "average_cpl",
    "cost_per_received_lead",
    "cost_per_booked_lead",
    "booking_rate",
    "cancellation_rate",
    "receiver_attribution_rate",
  ],
  "receiver-agent-trend": [
    "period",
    "receiver_agent_id",
    "receiver_agent_name",
    "received_leads",
    "billable_received_leads",
    "unresolved_cpl_count",
    "booked_leads",
    "cancelled_leads",
    "total_lead_cost",
  ],
  "receiver-agent-source-breakdown": [
    "receiver_agent_id",
    "receiver_agent_name",
    "source_label",
    "source_company",
    "lead_type",
    "received_leads",
    "billable_received_leads",
    "unresolved_cpl_count",
    "booked_leads",
    "cancelled_leads",
    "total_lead_cost",
    "booking_rate",
    "cancellation_rate",
  ],
};

export async function exportAnalyticsReportCsv(
  report: AnalyticsReport,
  query: AnalyticsQuery,
): Promise<{ filename: string; csv: string }> {
  const payload = await getAnalyticsReport(report, query);
  return {
    filename: `analytics-${report}-${query.database_scope}.csv`,
    csv: toCsv(rowsForCsv(report, payload.data), CSV_COLUMNS[report]),
  };
}

function rowsForCsv(report: AnalyticsReport, data: Record<string, unknown>): CsvRow[] {
  if (report === "summary") {
    return [objectValue(data.totals)];
  }
  if (report === "booking-cancellation-ratio") {
    return [
      { source_company: "overall", ...objectValue(data.overall) },
      ...arrayValue(data.by_source_company),
    ];
  }
  if (report === "geographic-lanes") {
    return [
      ...arrayValue(data.form_lanes).map((row) => ({ lead_type: "form", ...row })),
      ...arrayValue(data.call_lanes).map((row) => ({ lead_type: "call", ...row })),
    ];
  }
  return arrayValue(data.items);
}

function arrayValue(value: unknown): CsvRow[] {
  return Array.isArray(value) ? (value as CsvRow[]) : [];
}

function objectValue(value: unknown): CsvRow {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as CsvRow) : {};
}
