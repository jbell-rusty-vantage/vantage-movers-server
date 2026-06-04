import { getCallLeadSourceCompanyLabel } from "../../../config/domain";
import type { CallLeadSheetSource } from "../types";
import {
  booleanCell,
  bookedCell,
  bookedDateCell,
  cancelledCell,
  formatNumber,
  formatTimestamp,
  optionalLocalCell,
  overThresholdCell,
} from "./cells";

export function callLeadToRow(lead: CallLeadSheetSource): string[] {
  return [
    formatTimestamp(lead.timestamp),
    lead.job_no ?? "",
    lead.phone_number ?? "",
    formatNumber(lead.duration),
    bookedCell(Boolean(lead.booked)),
    bookedDateCell(lead.booked),
    overThresholdCell(Boolean(lead.over_2000), ">2k"),
    overThresholdCell(Boolean(lead.over_4000), ">4k"),
    cancelledCell(Boolean(lead.cancelled)),
    optionalLocalCell(lead.local),
    formatNumber(lead.cubic_feet),
    lead._id.toString(),
    getCallLeadSourceCompanyLabel(lead.source_company),
    booleanCell(Boolean(lead.form_fill)),
  ];
}
