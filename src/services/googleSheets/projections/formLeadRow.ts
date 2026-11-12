import {
  formatFormLeadBadLeadReason,
  getFormLeadSourceCompanyLabel,
  LocalType,
} from "../../../config/domain";
import { FORM_LEAD_UNKNOWN_STATE } from "../../../models/FormLead";
import { hasTrustedExternalSheetReview } from "../../leads/callLeadReportingDisposition";
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
    lead.crm_source_label_snapshot?.trim() ||
      lead.source_granularity_label_snapshot?.trim() ||
      getFormLeadSourceCompanyLabel(lead.source_company, lead.local as LocalType),
    formBadReasonCell(lead),
    lead.receiver_agent_name_snapshot?.trim() ?? "",
  ];
}

function formLeadStateCell(value?: string | null): string {
  return value?.trim() || FORM_LEAD_UNKNOWN_STATE;
}

function formBadReasonCell(lead: FormLeadSheetSource): string {
  if (hasTrustedExternalSheetReview(lead.external_sheet_review, ["bad_form"])) {
    const note = (lead.external_sheet_review as { raw_value: string }).raw_value;
    // USER_ENTERED preserves date/numeric formatting elsewhere; arbitrary imported
    // review text is always escaped so formulas cannot execute in this cell.
    return "'" + note;
  }
  return formatFormLeadBadLeadReason(lead.bad_lead);
}
