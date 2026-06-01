import type { AnalyticsQuery } from "../../validation/v1.validation";
import type { AdminModels } from "../admin/adminScope.service";
import { bookedLeadPrefix } from "./analyticsFilters";

export async function getAgentPerformance(models: AdminModels, query: AnalyticsQuery) {
  const items = await models["booked-leads"].aggregate([
    ...bookedLeadPrefix(query),
    { $unwind: "$agent_allocations" },
    {
      $set: {
        agent_name: {
          $cond: [
            {
              $or: [
                { $eq: ["$agent_allocations.agent_name_snapshot", null] },
                { $eq: ["$agent_allocations.agent_name_snapshot", ""] },
              ],
            },
            "unknown",
            "$agent_allocations.agent_name_snapshot",
          ],
        },
      },
    },
    { $match: { agent_name: { $ne: "" } } },
    {
      $group: {
        _id: "$agent_name",
        bookings: { $sum: 1 },
        cancelled_bookings: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
        total_binder_amount: { $sum: { $ifNull: ["$agent_allocations.binder_amount", 0] } },
        total_deposit_amount: { $sum: { $ifNull: ["$deposit_amount", 0] } },
        over_2000_bookings: { $sum: { $cond: ["$over_2000", 1, 0] } },
        over_4000_bookings: { $sum: { $cond: ["$over_4000", 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        agent_name: "$_id",
        bookings: 1,
        cancelled_bookings: 1,
        active_bookings: { $subtract: ["$bookings", "$cancelled_bookings"] },
        total_binder_amount: { $round: ["$total_binder_amount", 2] },
        total_deposit_amount: { $round: ["$total_deposit_amount", 2] },
        average_binder_amount: {
          $round: [{ $cond: [{ $eq: ["$bookings", 0] }, 0, { $divide: ["$total_binder_amount", "$bookings"] }] }, 2],
        },
        average_deposit_amount: {
          $round: [{ $cond: [{ $eq: ["$bookings", 0] }, 0, { $divide: ["$total_deposit_amount", "$bookings"] }] }, 2],
        },
        cancellation_rate: {
          $cond: [{ $eq: ["$bookings", 0] }, 0, { $divide: ["$cancelled_bookings", "$bookings"] }],
        },
        over_2000_bookings: 1,
        over_4000_bookings: 1,
      },
    },
    { $sort: { total_binder_amount: -1, bookings: -1, agent_name: 1 } },
    { $limit: 50 },
  ]);
  return { items };
}
