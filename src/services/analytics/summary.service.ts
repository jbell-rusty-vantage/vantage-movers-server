import type { AnalyticsQuery } from "../../validation/v1.validation";
import type { AdminModels } from "../admin/adminScope.service";
import {
  bookedLeadPrefix,
  cancelledLeadPrefix,
  leadMatchForQuery,
  numberValue,
  rate,
  roundMoney,
} from "./analyticsFilters";

export async function getSummary(models: AdminModels, query: AnalyticsQuery) {
  const [formLeads, callLeads, [booked = {}], [cancelled = {}]] = await Promise.all([
    models["form-leads"].countDocuments(await leadMatchForQuery("FormLead", query)).exec(),
    models["call-leads"].countDocuments(await leadMatchForQuery("CallLead", query)).exec(),
    models["booked-leads"].aggregate([
      ...bookedLeadPrefix(query),
      {
        $group: {
          _id: null,
          bookings: { $sum: 1 },
          cancelled_bookings: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
          total_deposit_amount: { $sum: { $ifNull: ["$deposit_amount", 0] } },
          total_binder_amount: { $sum: { $ifNull: ["$total_binder_amount", 0] } },
        },
      },
    ]),
    models["cancelled-leads"].aggregate([
      ...cancelledLeadPrefix(query),
      {
        $group: {
          _id: null,
          cancellations: { $sum: 1 },
          total_refund_amount: { $sum: { $ifNull: ["$refund_amount", 0] } },
        },
      },
    ]),
  ]);

  const bookings = numberValue(booked.bookings);
  const cancelledBookings = numberValue(booked.cancelled_bookings);
  return {
    totals: {
      form_leads: formLeads,
      call_leads: callLeads,
      total_leads: formLeads + callLeads,
      bookings,
      cancelled_bookings: cancelledBookings,
      active_bookings: Math.max(bookings - cancelledBookings, 0),
      cancellations: numberValue(cancelled.cancellations),
      total_deposit_amount: roundMoney(numberValue(booked.total_deposit_amount)),
      total_binder_amount: roundMoney(numberValue(booked.total_binder_amount)),
      total_refund_amount: roundMoney(numberValue(cancelled.total_refund_amount)),
      booking_rate: rate(bookings, formLeads + callLeads),
      cancellation_rate: rate(cancelledBookings, bookings),
    },
  };
}
