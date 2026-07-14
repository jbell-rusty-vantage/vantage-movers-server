import {
  getCallLeadSourceCompanyLabel,
  getFormLeadSourceCompanyLabel,
  resolveSourceCompany,
  type LocalType,
} from "../../../config/domain";
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
  const customerName = booking.customer?.full_name ?? booking.customer_name ?? "";
  return [
    formatTimestamp(booking.timestamp),
    allocations[0]?.agent_name_snapshot ?? "",
    allocations[1]?.agent_name_snapshot ?? "",
    formatNumber(booking.total_binder_amount),
    splitCell(allocations),
    formatDateOnly(booking.book_date),
    booking.job_no ?? "",
    customerName,
    formatNumber(booking.deposit_amount),
    booking.merchant,
    bookedLeadSourceCell(booking),
    booking._id.toString(),
    typeof booking.lead_ref === "string" ? booking.lead_ref : booking.lead_ref?.toString() ?? "",
    optionalLocalCell(booking.local),
    cancelledCell(Boolean(booking.cancelled)),
  ];
}

function bookedLeadSourceCell(booking: BookedLeadSheetSource): string {
  const sourceCompany = resolveSourceCompany(booking.source);
  if (!sourceCompany) {
    return booking.source;
  }

  if (booking.lead_model === "FormLead") {
    return getFormLeadSourceCompanyLabel(
      sourceCompany,
      booking.local as LocalType | undefined,
    );
  }

  if (booking.lead_model === "CallLead") {
    return getCallLeadSourceCompanyLabel(sourceCompany);
  }

  return booking.source;
}
