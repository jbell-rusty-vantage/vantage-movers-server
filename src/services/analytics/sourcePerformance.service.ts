import type { AnalyticsQuery } from "../../validation/v1.validation";
import type { AdminModels } from "../admin/adminScope.service";
import {
  bookedLeadPrefix,
  leadMatchForQuery,
  numberValue,
  rate,
  roundMoney,
  type AnalyticsRow,
} from "./analyticsFilters";
import {
  nestObservedSourceRows,
  sourceCompanyFromRow,
  sourceGranularityFromRow,
} from "./sourceHierarchy";

export async function getSourceCompanyPerformance(models: AdminModels, query: AnalyticsQuery) {
  const supportsSourceGranularity = query.database_scope !== "historical";
  const leaves = await bookedBySource(models, query, supportsSourceGranularity);
  const items = await nestObservedSourceRows(leaves, query, {
    additiveFields: [
      "bookings",
      "cancelled_bookings",
      "total_deposit_amount",
      "total_binder_amount",
    ],
    derive: derivePerformanceRow,
  });
  return { items };
}

export async function getSourceCompanyFunnel(models: AdminModels, query: AnalyticsQuery) {
  const supportsSourceGranularity = query.database_scope !== "historical";
  const [formStats, callStats, bookedStats] = await Promise.all([
    leadStatsBySource(models, "FormLead", query, supportsSourceGranularity),
    leadStatsBySource(models, "CallLead", query, supportsSourceGranularity),
    bookedBySource(models, query, supportsSourceGranularity),
  ]);
  const bySource = new Map<string, AnalyticsRow>();
  for (const row of [...formStats, ...callStats]) {
    const source = sourceCompanyFromRow(row);
    const granularity = supportsSourceGranularity
      ? sourceGranularityFromRow(row)
      : "";
    const key = `${source}|${granularity}`;
    const existing =
      bySource.get(key) ??
      baseSourceRow(source, supportsSourceGranularity ? granularity : undefined);
    existing.total_leads = numberValue(existing.total_leads) + numberValue(row.total_leads);
    existing.form_leads = numberValue(existing.form_leads) + (row.lead_type === "FormLead" ? numberValue(row.total_leads) : 0);
    existing.call_leads = numberValue(existing.call_leads) + (row.lead_type === "CallLead" ? numberValue(row.total_leads) : 0);
    existing.sheet_booked_leads = numberValue(existing.sheet_booked_leads) + numberValue(row.booked_leads);
    existing.sheet_cancelled_leads = numberValue(existing.sheet_cancelled_leads) + numberValue(row.cancelled_leads);
    existing.over_2000_leads = numberValue(existing.over_2000_leads) + numberValue(row.over_2000_leads);
    existing.over_4000_leads = numberValue(existing.over_4000_leads) + numberValue(row.over_4000_leads);
    bySource.set(key, existing);
  }
  for (const row of bookedStats) {
    const source = sourceCompanyFromRow(row);
    const granularity = supportsSourceGranularity
      ? sourceGranularityFromRow(row)
      : "";
    const key = `${source}|${granularity}`;
    const existing =
      bySource.get(key) ??
      baseSourceRow(source, supportsSourceGranularity ? granularity : undefined);
    existing.reconciled_bookings =
      numberValue(existing.reconciled_bookings) + numberValue(row.bookings);
    existing.reconciled_cancelled_bookings =
      numberValue(existing.reconciled_cancelled_bookings) +
      numberValue(row.cancelled_bookings);
    existing.total_deposit_amount =
      numberValue(existing.total_deposit_amount) + numberValue(row.total_deposit_amount);
    existing.total_binder_amount =
      numberValue(existing.total_binder_amount) + numberValue(row.total_binder_amount);
    bySource.set(key, existing);
  }
  const leaves = Array.from(bySource.values());
  const additiveFields = [
    "total_leads",
    "form_leads",
    "call_leads",
    "sheet_booked_leads",
    "sheet_cancelled_leads",
    "over_2000_leads",
    "over_4000_leads",
    "reconciled_bookings",
    "reconciled_cancelled_bookings",
    "total_deposit_amount",
    "total_binder_amount",
  ];
  const items = await nestObservedSourceRows(leaves, query, {
    additiveFields,
    derive: deriveFunnelRow,
  });
  return {
    items: items.sort(
      (left, right) => numberValue(right.total_deposit_amount) - numberValue(left.total_deposit_amount),
    ),
  };
}

export async function getLeadSourcePerformance(models: AdminModels, query: AnalyticsQuery) {
  const supportsSourceGranularity = query.database_scope !== "historical";
  const leaves = await bookedBySource(models, query, supportsSourceGranularity);
  const items = await nestObservedSourceRows(leaves, query, {
    additiveFields: [
      "bookings",
      "cancelled_bookings",
      "total_deposit_amount",
      "total_binder_amount",
    ],
    derive: derivePerformanceRow,
  });
  return { items };
}

async function bookedBySource(
  models: AdminModels,
  query: AnalyticsQuery,
  supportsSourceGranularity: boolean,
): Promise<AnalyticsRow[]> {
  return models["booked-leads"].aggregate([
    ...bookedLeadPrefix(query),
    {
      $group: {
        _id: supportsSourceGranularity
          ? {
              source_company: "$derived_source_company",
              source_granularity_key: {
                $ifNull: ["$derived_source_granularity_key", "unknown"],
              },
            }
          : "$derived_source_company",
        bookings: { $sum: 1 },
        cancelled_bookings: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
        total_deposit_amount: { $sum: { $ifNull: ["$deposit_amount", 0] } },
        total_binder_amount: { $sum: { $ifNull: ["$total_binder_amount", 0] } },
      },
    },
  ]);
}

async function leadStatsBySource(
  models: AdminModels,
  leadType: "FormLead" | "CallLead",
  query: AnalyticsQuery,
  supportsSourceGranularity: boolean,
): Promise<AnalyticsRow[]> {
  const model = leadType === "FormLead" ? models["form-leads"] : models["call-leads"];
  return model.aggregate([
    { $match: await leadMatchForQuery(leadType, query) },
    {
      $group: {
        _id: supportsSourceGranularity
          ? {
              source_company: "$source_company",
              source_granularity_key: {
                $ifNull: ["$source_granularity_key", "unknown"],
              },
            }
          : "$source_company",
        total_leads: { $sum: 1 },
        booked_leads: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$booked", null] }, null] }, 1, 0] } },
        cancelled_leads: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$cancelled", null] }, null] }, 1, 0] } },
        over_2000_leads: { $sum: { $cond: ["$over_2000", 1, 0] } },
        over_4000_leads: { $sum: { $cond: ["$over_4000", 1, 0] } },
      },
    },
    { $set: { lead_type: leadType } },
  ]);
}

function baseSourceRow(
  sourceCompany: string,
  sourceGranularityKey?: string,
): AnalyticsRow {
  return {
    source_company: sourceCompany,
    ...(sourceGranularityKey
      ? { source_granularity_key: sourceGranularityKey }
      : {}),
    total_leads: 0,
    form_leads: 0,
    call_leads: 0,
    sheet_booked_leads: 0,
    sheet_cancelled_leads: 0,
    over_2000_leads: 0,
    over_4000_leads: 0,
  };
}

function derivePerformanceRow(row: AnalyticsRow): AnalyticsRow {
  const bookings = numberValue(row.bookings);
  const cancelledBookings = numberValue(row.cancelled_bookings);
  return {
    ...row,
    active_bookings: Math.max(bookings - cancelledBookings, 0),
    total_deposit_amount: roundMoney(numberValue(row.total_deposit_amount)),
    total_binder_amount: roundMoney(numberValue(row.total_binder_amount)),
    booking_rate: null,
    cancellation_rate: rate(cancelledBookings, bookings),
  };
}

function deriveFunnelRow(row: AnalyticsRow): AnalyticsRow {
  const bookings = numberValue(row.reconciled_bookings);
  return {
    ...row,
    total_deposit_amount: roundMoney(numberValue(row.total_deposit_amount)),
    total_binder_amount: roundMoney(numberValue(row.total_binder_amount)),
    booking_rate: rate(bookings, numberValue(row.total_leads)),
    cancellation_rate: rate(
      numberValue(row.reconciled_cancelled_bookings),
      bookings,
    ),
  };
}
