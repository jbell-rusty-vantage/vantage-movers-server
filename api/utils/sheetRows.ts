export const LEAD_SHEET_NAME = "Leads";

export const LEAD_SHEET_HEADERS = [
  "Time Stamp",
  "Name",
  "Pickup Zip",
  "Destination Zip",
  "Move Size",
  "Move Date",
  "Phone",
  "Lead ID",
  "Ref No",
  "Booked (Can be empty for now)",
  "Source Company Label",
  "Source Company Site",
] as const;

export type LeadSheetRowSource = {
  timestamp: Date;
  name: string;
  pickupZip: string;
  destinationZip: string;
  moveSize: string;
  moveDate: Date;
  phoneNumber: string;
  leadId: string;
  refNo?: string | null;
  booked: boolean;
  sourceCompanyLabel: string;
  sourceCompanySite: string;
};

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function leadToSheetRow(lead: LeadSheetRowSource): string[] {
  return [
    lead.timestamp.toISOString(),
    lead.name,
    lead.pickupZip,
    lead.destinationZip,
    lead.moveSize,
    formatDateOnly(lead.moveDate),
    lead.phoneNumber,
    lead.leadId,
    lead.refNo?.trim() || "not provided",
    lead.booked ? "TRUE" : "",
    lead.sourceCompanyLabel,
    lead.sourceCompanySite,
  ];
}
