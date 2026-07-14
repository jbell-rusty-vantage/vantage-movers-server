import type { AnalyticsQuery } from "../../validation/v1.validation";
import type { AdminModels } from "../admin/adminScope.service";
import {
  bookedLeadPrefix,
  leadMatch,
  normalizeSourceDimension,
  numberValue,
  rate,
  roundMoney,
  type AnalyticsRow,
} from "./analyticsFilters";

export async function getSourceCompanyPerformance(models: AdminModels, query: AnalyticsQuery) {
  const items = await bookedBySource(models, query);
  return { items };
}

export async function getSourceCompanyFunnel(models: AdminModels, query: AnalyticsQuery) {
  const [formStats, callStats, bookedStats] = await Promise.all([
    leadStatsBySource(models, "FormLead", query),
    leadStatsBySource(models, "CallLead", query),
    bookedBySource(models, query),
  ]);
  const bySource = new Map<string, AnalyticsRow>();
  for (const row of [...formStats, ...callStats]) {
    const source = normalizeSourceDimension(row.source_company);
    const existing = bySource.get(source) ?? baseSourceRow(source);
    existing.total_leads = numberValue(existing.total_leads) + numberValue(row.total_leads);
    existing.form_leads = numberValue(existing.form_leads) + (row.lead_type === "FormLead" ? numberValue(row.total_leads) : 0);
    existing.call_leads = numberValue(existing.call_leads) + (row.lead_type === "CallLead" ? numberValue(row.total_leads) : 0);
    existing.sheet_booked_leads = numberValue(existing.sheet_booked_leads) + numberValue(row.booked_leads);
    existing.sheet_cancelled_leads = numberValue(existing.sheet_cancelled_leads) + numberValue(row.cancelled_leads);
    existing.over_2000_leads = numberValue(existing.over_2000_leads) + numberValue(row.over_2000_leads);
    existing.over_4000_leads = numberValue(existing.over_4000_leads) + numberValue(row.over_4000_leads);
    bySource.set(source, existing);
  }
  for (const row of bookedStats) {
    const source = normalizeSourceDimension(row.source_company);
    const existing = bySource.get(source) ?? baseSourceRow(source);
    existing.reconciled_bookings = numberValue(row.bookings);
    existing.reconciled_cancelled_bookings = numberValue(row.cancelled_bookings);
    existing.total_deposit_amount = roundMoney(numberValue(row.total_deposit_amount));
    existing.total_binder_amount = roundMoney(numberValue(row.total_binder_amount));
    existing.booking_rate = rate(numberValue(row.bookings), numberValue(existing.total_leads));
    existing.cancellation_rate = rate(numberValue(row.cancelled_bookings), numberValue(row.bookings));
    bySource.set(source, existing);
  }
  return {
    items: Array.from(bySource.values()).sort(
      (left, right) => numberValue(right.total_deposit_amount) - numberValue(left.total_deposit_amount),
    ),
  };
}

export async function getLeadSourcePerformance(models: AdminModels, query: AnalyticsQuery) {
  const items = await models["booked-leads"].aggregate([
    ...bookedLeadPrefix(query),
    {
      $set: {
        lead_source: {
          $cond: [{ $or: [{ $eq: ["$source", null] }, { $eq: ["$source", ""] }] }, "unknown", "$source"],
        },
      },
    },
    {
      $group: {
        _id: "$lead_source",
        bookings: { $sum: 1 },
        cancelled_bookings: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
        total_deposit_amount: { $sum: { $ifNull: ["$deposit_amount", 0] } },
        total_binder_amount: { $sum: { $ifNull: ["$total_binder_amount", 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        lead_source: "$_id",
        bookings: 1,
        cancelled_bookings: 1,
        total_deposit_amount: { $round: ["$total_deposit_amount", 2] },
        total_binder_amount: { $round: ["$total_binder_amount", 2] },
        cancellation_rate: {
          $cond: [{ $eq: ["$bookings", 0] }, 0, { $divide: ["$cancelled_bookings", "$bookings"] }],
        },
      },
    },
    { $sort: { total_deposit_amount: -1, bookings: -1 } },
    { $limit: 75 },
  ]);
  return { items };
}

async function bookedBySource(models: AdminModels, query: AnalyticsQuery): Promise<AnalyticsRow[]> {
  return models["booked-leads"].aggregate([
    ...bookedLeadPrefix(query),
    {
      $group: {
        _id: "$derived_source_company",
        bookings: { $sum: 1 },
        cancelled_bookings: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
        total_deposit_amount: { $sum: { $ifNull: ["$deposit_amount", 0] } },
        total_binder_amount: { $sum: { $ifNull: ["$total_binder_amount", 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        source_company: "$_id",
        bookings: 1,
        cancelled_bookings: 1,
        active_bookings: { $subtract: ["$bookings", "$cancelled_bookings"] },
        total_deposit_amount: { $round: ["$total_deposit_amount", 2] },
        total_binder_amount: { $round: ["$total_binder_amount", 2] },
        booking_rate: null,
        cancellation_rate: {
          $cond: [{ $eq: ["$bookings", 0] }, 0, { $divide: ["$cancelled_bookings", "$bookings"] }],
        },
      },
    },
    { $sort: { total_deposit_amount: -1, bookings: -1, source_company: 1 } },
  ]);
}

async function leadStatsBySource(
  models: AdminModels,
  leadType: "FormLead" | "CallLead",
  query: AnalyticsQuery,
): Promise<AnalyticsRow[]> {
  const model = leadType === "FormLead" ? models["form-leads"] : models["call-leads"];
  return model.aggregate([
    { $match: leadMatch(leadType, query) },
    {
      $group: {
        _id: "$source_company",
        total_leads: { $sum: 1 },
        booked_leads: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$booked", null] }, null] }, 1, 0] } },
        cancelled_leads: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$cancelled", null] }, null] }, 1, 0] } },
        over_2000_leads: { $sum: { $cond: ["$over_2000", 1, 0] } },
        over_4000_leads: { $sum: { $cond: ["$over_4000", 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        source_company: "$_id",
        lead_type: { $literal: leadType },
        total_leads: 1,
        booked_leads: 1,
        cancelled_leads: 1,
        over_2000_leads: 1,
        over_4000_leads: 1,
      },
    },
  ]);
}

function baseSourceRow(sourceCompany: string): AnalyticsRow {
  return {
    source_company: sourceCompany,
    total_leads: 0,
    form_leads: 0,
    call_leads: 0,
    sheet_booked_leads: 0,
    sheet_cancelled_leads: 0,
    over_2000_leads: 0,
    over_4000_leads: 0,
  };
}
