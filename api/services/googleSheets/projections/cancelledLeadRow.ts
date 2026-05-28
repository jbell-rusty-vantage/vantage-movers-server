import type { CancelledLeadSheetSource } from "../types";
import { formatDateOnly, formatNumber, formatTimestamp } from "./cells";

export function cancelledLeadToRow(cancellation: CancelledLeadSheetSource): string[] {
  return [
    formatTimestamp(cancellation.timestamp),
    cancellation.agent ?? "",
    cancellation.cancel_date ? formatDateOnly(cancellation.cancel_date) : "",
    cancellation.job_no ?? "",
    cancellation.customer_name ?? "",
    formatNumber(cancellation.refund_amount),
    cancellation.source ?? "",
    cancellation._id.toString(),
    typeof cancellation.lead_ref === "string"
      ? cancellation.lead_ref
      : cancellation.lead_ref?.toString() ?? "",
  ];
}
