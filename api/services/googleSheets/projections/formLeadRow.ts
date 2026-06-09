import {
  formatFormLeadBadLeadReason,
  getFormLeadSourceCompanyLabel,
  LocalType,
} from "../../../config/domain";
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
    localCell(lead.local),
    formatDateOnly(lead.move_date),
    lead.phone_number,
    lead.email?.trim() ?? "",
    quotedCell(Boolean(lead.quoted)),
    formatNumber(lead.cubic_feet),
    bookedCell(Boolean(lead.booked)),
    overThresholdCell(Boolean(lead.over_2000), ">2k"),
    overThresholdCell(Boolean(lead.over_4000), ">4k"),
    bookedDateCell(lead.booked),
    cancelledCell(Boolean(lead.cancelled)),
    lead._id.toString(),
    lead.ref_no?.trim() || "not provided",
    getFormLeadSourceCompanyLabel(lead.source_company, lead.local as LocalType),
    formatFormLeadBadLeadReason(lead.bad_lead),
  ];
}

function formLeadStateCell(value?: string | null): string {
  return value?.trim() || FORM_LEAD_UNKNOWN_STATE;
}
