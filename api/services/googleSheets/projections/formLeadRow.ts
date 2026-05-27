import { getSourceCompanyLabel } from "../../../config/domain";
import { FORM_LEAD_UNKNOWN_STATE } from "../../../models/FormLead";
import type { FormLeadSheetSource } from "../types";
import {
  bookedCell,
  bookedDateCell,
  cancelledCell,
  formatDateOnly,
  formatNumber,
  formatTimestamp,
  localCell,
  overThresholdCell,
  quotedCell,
} from "./cells";

export function formLeadToRow(lead: FormLeadSheetSource): string[] {
  return [
    formatTimestamp(lead.timestamp),
    lead.name,
    lead.pickup_zip,
    lead.destination_zip,
    formLeadStateCell(lead.pickup_state),
    formLeadStateCell(lead.delivery_state),
    lead.move_size,
    formatDateOnly(lead.move_date),
    lead.phone_number,
    lead._id.toString(),
    lead.ref_no?.trim() || "not provided",
    bookedCell(Boolean(lead.booked)),
    bookedDateCell(lead.booked),
    overThresholdCell(Boolean(lead.over_2000), ">2k"),
    overThresholdCell(Boolean(lead.over_4000), ">4k"),
    cancelledCell(Boolean(lead.cancelled)),
    localCell(lead.local),
    formatNumber(lead.cubic_feet),
    lead.lid ?? "",
    getSourceCompanyLabel(lead.source_company),
    lead.source_company_site ?? "",
    quotedCell(Boolean(lead.quoted)),
  ];
}

function formLeadStateCell(value?: string | null): string {
  return value?.trim() || FORM_LEAD_UNKNOWN_STATE;
}
