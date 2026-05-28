/**
 * Sheet tab names, header arrays, and Google Sheets container env-var name
 * constants.
 *
 * This module owns the *names* of env vars (and the type aliases that
 * enumerate them) but never reads `process.env`. Runtime resolution of the
 * mode-aware (`TEST_`-prefixed) env var, and the actual `process.env`
 * lookup, live in `./runtime.ts` so this file stays pure.
 */

export const SHEET_TAB_NAMES = {
  forms: "Forms",
  calls: "Calls",
  duplicates: "Duplicates",
  badLeads: "Bad Leads",
  badCalls: "Bad Calls",
  bookedDeals: "Booked Deals",
  cancelledDeals: "Cancelled Deals",
} as const;

export const SHEET_CONTAINER_ENV_VARS = {
  masterLeads: "MASTER_LEADS_SHEET_ID",
  masterBooked: "MASTER_BOOKED_SHEET_ID",
  sourceLeads: {
    tbm_leads: "TBM_LEADS_SHEET_ID",
    tbm_prime_leads: "TBM_PRIME_LEADS_SHEET_ID",
    top10_leads: "TOP10_LEADS_SHEET_ID",
    best_relocation_leads: "BEST_RELOCATION_LEADS_SHEET_ID",
    main_site: "MAINSITE_LEADS_SHEET_ID",
  },
} as const;

export type SourceLeadSheetEnvVar =
  | "TBM_LEADS_SHEET_ID"
  | "TBM_PRIME_LEADS_SHEET_ID"
  | "TOP10_LEADS_SHEET_ID"
  | "BEST_RELOCATION_LEADS_SHEET_ID"
  | "MAINSITE_LEADS_SHEET_ID";

export type SheetContainerEnvVar =
  | "MASTER_LEADS_SHEET_ID"
  | "MASTER_BOOKED_SHEET_ID"
  | SourceLeadSheetEnvVar;

export type RuntimeSheetContainerEnvVar =
  | SheetContainerEnvVar
  | `TEST_${SheetContainerEnvVar}`;

export const FORM_SHEET_HEADERS = [
  "Timestamp",
  "Name",
  "Pickup Zip",
  "Destination Zip",
  "Pickup State",
  "Delivery State",
  "Move Size",
  "Move Date",
  "Phone Number",
  "Mongo ID",
  "Ref No",
  "Booked",
  "Booked Date",
  "OVER 2000",
  "OVER 4000",
  "Cancelled",
  "Local",
  "Cubic Feet",
  "Lead ID",
  "Source Company",
  "Source Company Site",
  "Quoted",
] as const;

export const CALL_SHEET_HEADERS = [
  "Timestamp",
  "Job No",
  "Phone Number",
  "Duration",
  "Booked",
  "Booked Date",
  "Over 2000",
  "Over 4000",
  "Cancelled",
  "Local",
  "Cubic Feet",
  "Mongo ID",
  "Source Company",
  "FormFill",
] as const;

export const BOOKED_SHEET_HEADERS = [
  "Timestamp",
  "Agent",
  "SplitAgent",
  "Binder Amount",
  "Split",
  "Book Date",
  "Job No",
  "Customer Name",
  "Deposit Amount",
  "Merchant",
  "Source",
  "Mongo ID",
  "Mongo Lead ID",
  "Local",
  "Cancelled",
] as const;

export const CANCELLED_SHEET_HEADERS = [
  "Timestamp",
  "Agent",
  "Cancel Date",
  "Job No",
  "Customer Name",
  "Refund Amount",
  "Source",
  "Mongo ID",
  "Lead Mongo ID",
] as const;
