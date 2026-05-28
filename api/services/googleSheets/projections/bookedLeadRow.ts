import type { BookedLeadSheetSource } from "../types";
import {
  cancelledCell,
  formatDateOnly,
  formatNumber,
  formatTimestamp,
  optionalLocalCell,
  splitCell,
} from "./cells";

export function bookedLeadToRow(booking: BookedLeadSheetSource): string[] {
  const allocations = booking.agent_allocations ?? [];
  return [
    formatTimestamp(booking.timestamp),
    allocations[0]?.agent_name_snapshot ?? "",
    allocations[1]?.agent_name_snapshot ?? "",
    formatNumber(booking.total_binder_amount),
    splitCell(allocations),
    formatDateOnly(booking.book_date),
    booking.job_no ?? "",
    booking.customer?.full_name ?? "",
    formatNumber(booking.deposit_amount),
    booking.merchant,
    booking.source,
    booking._id.toString(),
    typeof booking.lead_ref === "string" ? booking.lead_ref : booking.lead_ref?.toString() ?? "",
    optionalLocalCell(booking.local),
    cancelledCell(Boolean(booking.cancelled)),
  ];
}
