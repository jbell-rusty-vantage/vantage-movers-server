import type { AnalyticsReport } from "../../validation/v1.validation";
import {
  normalizeDimension,
  normalizeDimensionKey,
  normalizeSourceDimension,
  numberValue,
  rate,
  roundMoney,
  type AnalyticsRow,
} from "./analyticsFilters";

export type AnalyticsPayload = Record<string, unknown>;

const NUMERIC_FIELDS = [
  "form_leads",
  "call_leads",
  "total_leads",
  "leads",
  "bookings",
  "booked_leads",
  "cancelled_bookings",
  "cancelled_leads",
  "active_bookings",
  "active_booked_leads",
  "cancellations",
  "linked_to_booked",
  "over_2000_leads",
  "over_4000_leads",
  "over_2000_bookings",
  "over_4000_bookings",
  "total_deposit_amount",
  "total_binder_amount",
  "total_refund_amount",
  "affected_deposit_amount",
  "affected_binder_amount",
  "sheet_booked_leads",
  "sheet_cancelled_leads",
  "reconciled_bookings",
  "reconciled_cancelled_bookings",
];

export function mergeAnalyticsPayload(report: AnalyticsReport, payloads: AnalyticsPayload[]): AnalyticsPayload {
  if (report === "summary") {
    return mergeSummary(payloads);
  }
  if (report === "booking-cancellation-ratio") {
    return mergeRatioPayloads(payloads);
  }
  if (report === "geographic-lanes") {
    return {
      form_lanes: mergeRows(payloads.flatMap((payload) => arrayValue(payload.form_lanes)), ["pickup_state", "delivery_state"]),
      call_lanes: mergeRows(payloads.flatMap((payload) => arrayValue(payload.call_lanes)), ["pickup_state", "delivery_state"]),
    };
  }
  const keyFields = keyFieldsForReport(report);
  const items = mergeRows(payloads.flatMap((payload) => arrayValue(payload.items)), keyFields);
  return { items };
}

export function mergeRows(rows: AnalyticsRow[], keyFields: string[]): AnalyticsRow[] {
  const merged = new Map<string, AnalyticsRow>();
  for (const row of rows) {
    const key = keyFields.map((field) => keyValue(field, row[field])).join("|");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row });
      continue;
    }
    for (const field of NUMERIC_FIELDS) {
      if (field in row || field in existing) {
        existing[field] = numberValue(existing[field]) + numberValue(row[field]);
      }
    }
  }
  const values = Array.from(merged.values()).map(deriveRates);
  return values.sort(defaultSort);
}

function mergeSummary(payloads: AnalyticsPayload[]): AnalyticsPayload {
  const totals = payloads.reduce<AnalyticsRow>((acc, payload) => {
    const payloadTotals = objectValue(payload.totals);
    for (const field of NUMERIC_FIELDS) {
      acc[field] = numberValue(acc[field]) + numberValue(payloadTotals[field]);
    }
    return acc;
  }, {});
  return { totals: deriveRates(totals) };
}

function mergeRatioPayloads(payloads: AnalyticsPayload[]): AnalyticsPayload {
  const overall = deriveRates(
    payloads.reduce<AnalyticsRow>((acc, payload) => {
      const row = objectValue(payload.overall);
      for (const field of NUMERIC_FIELDS) {
        acc[field] = numberValue(acc[field]) + numberValue(row[field]);
      }
      return acc;
    }, {}),
  );
  return {
    overall,
    by_source_company: mergeRows(
      payloads.flatMap((payload) => arrayValue(payload.by_source_company)),
      ["source_company"],
    ),
  };
}

function deriveRates(row: AnalyticsRow): AnalyticsRow {
  const next = { ...row };
  const bookings = numberValue(next.bookings || next.booked_leads);
  const cancellations = numberValue(next.cancelled_bookings || next.cancelled_leads || next.cancellations);
  const leads = numberValue(next.total_leads || next.leads);
  if (bookings || cancellations) {
    next.cancellation_rate = rate(cancellations, bookings);
    next.active_bookings = numberValue(next.active_bookings) || Math.max(bookings - cancellations, 0);
  }
  if (leads || bookings) {
    next.booking_rate = rate(bookings, leads);
  }
  for (const moneyField of ["total_deposit_amount", "total_binder_amount", "total_refund_amount"]) {
    if (moneyField in next) next[moneyField] = roundMoney(numberValue(next[moneyField]));
  }
  return next;
}

function keyFieldsForReport(report: AnalyticsReport): string[] {
  switch (report) {
    case "revenue-trend":
      return ["period"];
    case "source-company-performance":
    case "source-company-funnel":
      return ["source_company"];
    case "agent-performance":
      return ["agent_name"];
    case "cancellation-reasons":
      return ["reason"];
    case "lead-source-performance":
      return ["lead_source"];
    case "local-vs-long-distance":
      return ["local_type"];
    case "pickup-state-performance":
    case "delivery-state-performance":
      return ["state"];
    default:
      return ["label"];
  }
}

function keyValue(field: string, value: unknown): string {
  if (field === "source_company") return normalizeSourceDimension(value);
  return normalizeDimensionKey(value);
}

function defaultSort(left: AnalyticsRow, right: AnalyticsRow): number {
  const leftPeriod = typeof left.period === "string" ? left.period : "";
  const rightPeriod = typeof right.period === "string" ? right.period : "";
  if (leftPeriod || rightPeriod) return leftPeriod.localeCompare(rightPeriod);
  return (
    numberValue(right.total_deposit_amount) - numberValue(left.total_deposit_amount) ||
    numberValue(right.total_binder_amount) - numberValue(left.total_binder_amount) ||
    numberValue(right.bookings) - numberValue(left.bookings) ||
    normalizeDimension(left.source_company || left.agent_name || left.reason || left.lead_source || left.local_type).localeCompare(
      normalizeDimension(right.source_company || right.agent_name || right.reason || right.lead_source || right.local_type),
    )
  );
}

function arrayValue(value: unknown): AnalyticsRow[] {
  return Array.isArray(value) ? (value as AnalyticsRow[]) : [];
}

function objectValue(value: unknown): AnalyticsRow {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnalyticsRow) : {};
}
