import type { AnalyticsQuery } from "../../validation/v1.validation";
import type { AdminModels } from "../admin/adminScope.service";
import { bookedLeadPrefix, leadMatch } from "./analyticsFilters";

export async function getLocalVsLongDistance(models: AdminModels, query: AnalyticsQuery) {
  const items = await models["booked-leads"].aggregate([
    ...bookedLeadPrefix(query),
    {
      $group: {
        _id: {
          $cond: [{ $or: [{ $eq: ["$local", null] }, { $eq: ["$local", ""] }] }, "unknown", "$local"],
        },
        bookings: { $sum: 1 },
        cancelled_bookings: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
        total_deposit_amount: { $sum: { $ifNull: ["$deposit_amount", 0] } },
        total_binder_amount: { $sum: { $ifNull: ["$total_binder_amount", 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        local_type: "$_id",
        bookings: 1,
        cancelled_bookings: 1,
        total_deposit_amount: { $round: ["$total_deposit_amount", 2] },
        total_binder_amount: { $round: ["$total_binder_amount", 2] },
        cancellation_rate: {
          $cond: [{ $eq: ["$bookings", 0] }, 0, { $divide: ["$cancelled_bookings", "$bookings"] }],
        },
      },
    },
    { $sort: { total_deposit_amount: -1 } },
  ]);
  return { items };
}

export async function getGeographicLanes(models: AdminModels, query: AnalyticsQuery) {
  const [formLanes, callLanes] = await Promise.all([
    laneStats(models, "FormLead", query),
    laneStats(models, "CallLead", query),
  ]);
  return { form_lanes: formLanes, call_lanes: callLanes };
}

function laneStats(models: AdminModels, leadType: "FormLead" | "CallLead", query: AnalyticsQuery) {
  const model = leadType === "FormLead" ? models["form-leads"] : models["call-leads"];
  return model.aggregate([
    { $match: leadMatch(leadType, query) },
    {
      $set: {
        pickup: {
          $cond: [{ $or: [{ $eq: ["$pickup_state", null] }, { $eq: ["$pickup_state", ""] }] }, "unknown", "$pickup_state"],
        },
        delivery: {
          $cond: [
            { $or: [{ $eq: ["$delivery_state", null] }, { $eq: ["$delivery_state", ""] }] },
            "unknown",
            "$delivery_state",
          ],
        },
      },
    },
    {
      $group: {
        _id: { pickup_state: "$pickup", delivery_state: "$delivery" },
        leads: { $sum: 1 },
        booked_leads: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$booked", null] }, null] }, 1, 0] } },
        cancelled_leads: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$cancelled", null] }, null] }, 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        pickup_state: "$_id.pickup_state",
        delivery_state: "$_id.delivery_state",
        leads: 1,
        booked_leads: 1,
        cancelled_leads: 1,
        booking_rate: {
          $cond: [{ $eq: ["$leads", 0] }, 0, { $divide: ["$booked_leads", "$leads"] }],
        },
      },
    },
    { $sort: { leads: -1, booked_leads: -1 } },
    { $limit: 50 },
  ]);
}
