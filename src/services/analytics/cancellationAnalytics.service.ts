import type { AnalyticsQuery } from "../../validation/v1.validation";
import type { AdminModels } from "../admin/adminScope.service";
import { bookedLeadPrefix, cancelledLeadPrefix, rate, type AnalyticsRow } from "./analyticsFilters";
import { nestObservedSourceRows } from "./sourceHierarchy";

export async function getBookingCancellationRatio(models: AdminModels, query: AnalyticsQuery) {
  const [overall = null] = await models["booked-leads"].aggregate([
    ...bookedLeadPrefix(query),
    {
      $group: {
        _id: null,
        booked_leads: { $sum: 1 },
        cancelled_leads: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        booked_leads: 1,
        cancelled_leads: 1,
        active_booked_leads: { $subtract: ["$booked_leads", "$cancelled_leads"] },
        cancellation_rate: {
          $cond: [{ $eq: ["$booked_leads", 0] }, 0, { $divide: ["$cancelled_leads", "$booked_leads"] }],
        },
        booked_to_cancelled_ratio: {
          $cond: [{ $eq: ["$cancelled_leads", 0] }, null, { $divide: ["$booked_leads", "$cancelled_leads"] }],
        },
      },
    },
  ]);

  const supportsSourceGranularity = query.database_scope !== "historical";
  const leaves = await models["booked-leads"].aggregate([
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
        booked_leads: { $sum: 1 },
        cancelled_leads: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
      },
    },
  ]);
  const by_source_company = await nestObservedSourceRows(leaves as AnalyticsRow[], query, {
    additiveFields: ["booked_leads", "cancelled_leads"],
    derive: (row) => {
      const booked = Number(row.booked_leads ?? 0);
      const cancelled = Number(row.cancelled_leads ?? 0);
      return {
        ...row,
        active_booked_leads: Math.max(booked - cancelled, 0),
        cancellation_rate: rate(cancelled, booked),
      };
    },
    sort: (left, right) =>
      Number(right.cancellation_rate ?? 0) - Number(left.cancellation_rate ?? 0) ||
      Number(right.booked_leads ?? 0) - Number(left.booked_leads ?? 0),
  });

  return { overall, by_source_company };
}

export async function getCancellationReasons(models: AdminModels, query: AnalyticsQuery) {
  const items = await models["cancelled-leads"].aggregate([
    ...cancelledLeadPrefix(query),
    {
      $set: {
        normalized_reason: {
          $cond: [{ $or: [{ $eq: ["$reason", null] }, { $eq: ["$reason", ""] }] }, "unknown", "$reason"],
        },
      },
    },
    {
      $group: {
        _id: "$normalized_reason",
        cancellations: { $sum: 1 },
        linked_to_booked: {
          $sum: { $cond: [{ $gt: [{ $size: "$booked_lead_doc" }, 0] }, 1, 0] },
        },
        total_refund_amount: { $sum: { $ifNull: ["$refund_amount", 0] } },
        affected_deposit_amount: {
          $sum: { $ifNull: [{ $arrayElemAt: ["$booked_lead_doc.deposit_amount", 0] }, 0] },
        },
        affected_binder_amount: {
          $sum: { $ifNull: [{ $arrayElemAt: ["$booked_lead_doc.total_binder_amount", 0] }, 0] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        reason: "$_id",
        cancellations: 1,
        linked_to_booked: 1,
        total_refund_amount: { $round: ["$total_refund_amount", 2] },
        affected_deposit_amount: { $round: ["$affected_deposit_amount", 2] },
        affected_binder_amount: { $round: ["$affected_binder_amount", 2] },
      },
    },
    { $sort: { cancellations: -1, reason: 1 } },
    { $limit: 50 },
  ]);
  return { items };
}
