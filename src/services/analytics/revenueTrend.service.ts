import type { AnalyticsQuery } from "../../validation/v1.validation";
import type { AdminModels } from "../admin/adminScope.service";
import { bookedLeadPrefix, trendDateExpression } from "./analyticsFilters";

export async function getRevenueTrend(models: AdminModels, query: AnalyticsQuery) {
  const items = await models["booked-leads"].aggregate([
    ...bookedLeadPrefix(query),
    {
      $set: {
        report_date: { $ifNull: ["$book_date", "$timestamp"] },
      },
    },
    {
      $group: {
        _id: trendDateExpression(query),
        bookings: { $sum: 1 },
        cancelled_bookings: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
        total_deposit_amount: { $sum: { $ifNull: ["$deposit_amount", 0] } },
        total_binder_amount: { $sum: { $ifNull: ["$total_binder_amount", 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        period: "$_id",
        bookings: 1,
        cancelled_bookings: 1,
        total_deposit_amount: { $round: ["$total_deposit_amount", 2] },
        total_binder_amount: { $round: ["$total_binder_amount", 2] },
        cancellation_rate: {
          $cond: [{ $eq: ["$bookings", 0] }, 0, { $divide: ["$cancelled_bookings", "$bookings"] }],
        },
      },
    },
    { $sort: { period: 1 } },
  ]);
  return { items };
}
