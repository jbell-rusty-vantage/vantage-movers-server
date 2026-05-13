import { FORM_SHEET_HEADERS, SHEET_TAB_NAMES } from "../config/domain";

export const LEAD_SHEET_NAME = SHEET_TAB_NAMES.forms;
export const CALL_SHEET_NAME = SHEET_TAB_NAMES.calls;

export const LEAD_SHEET_HEADERS = FORM_SHEET_HEADERS;

export type LeadSheetRowSource = {
  _id: { toString(): string };
  timestamp: Date;
  name: string;
  pickup_zip: string;
  pickup_state?: string | null;
  destination_zip: string;
  delivery_state?: string | null;
  local: string;
  move_size: string;
  move_date: Date;
  phone_number: string;
  lid?: string | null;
  ref_no?: string | null;
  booked?: unknown;
  over_2000?: boolean | null;
  over_4000?: boolean | null;
  cancelled?: unknown;
  source_company: string;
  source_company_site?: string | null;
  quoted?: boolean | null;
  cubic_feet?: number | null;
  cpl?: number | null;
};

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatTimestamp(value: Date): string {
  const date = `${value.getMonth() + 1}/${value.getDate()}/${value.getFullYear()}`;
  const time = [value.getHours(), value.getMinutes(), value.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");

  return `${date} ${time}`;
}

export function leadToSheetRow(lead: LeadSheetRowSource): string[] {
  return [
    formatTimestamp(lead.timestamp),
    lead.name,
    lead.pickup_zip,
    lead.destination_zip,
    lead.pickup_state ?? "",
    lead.delivery_state ?? "",
    lead.move_size,
    formatDateOnly(lead.move_date),
    lead.phone_number,
    lead._id.toString(),
    lead.ref_no?.trim() || "not provided",
    lead.booked ? "TRUE" : "FALSE",
    lead.over_2000 ? "TRUE" : "FALSE",
    lead.over_4000 ? "TRUE" : "FALSE",
    lead.cancelled ? "TRUE" : "FALSE",
    lead.local === "local" ? "TRUE" : "FALSE",
    lead.cubic_feet ? String(lead.cubic_feet) : "",
    lead.lid ?? "",
    lead.source_company,
    lead.source_company_site ?? "",
    lead.quoted ? "TRUE" : "FALSE",
    formatCplForSheet(lead.cpl),
  ];
}

function formatCplForSheet(cpl: number | null | undefined): string {
  if (cpl === null || cpl === undefined || Number.isNaN(cpl)) {
    return "";
  }

  return String(cpl);
}
