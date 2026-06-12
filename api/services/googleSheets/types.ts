import type { FormLeadBadLeadReason, SourceCompany } from "../../config/domain";
import type { SheetSyncEntry } from "../../models/schemaHelpers";

export type SyncTarget = {
  target: string;
  spreadsheetId: string;
  tabName: string;
  headers: readonly string[];
  ensureTabs: SheetTabConfig[];
};

export type SheetTabConfig = {
  tabName: string;
  headers: readonly string[];
};

export type SyncableDocument = {
  _id: { toString(): string };
  sheet_sync?: SheetSyncEntry[];
};

export type AgentAllocationSheetSource = {
  agent_name_snapshot: string;
  binder_amount: number;
};

export type PopulatedBookedLead = {
  _id: { toString(): string };
  timestamp: Date;
  book_date: Date;
  job_no?: string | null;
  customer?: { full_name?: string | null } | null;
  customer_name?: string | null;
  agent_allocations?: AgentAllocationSheetSource[] | null;
  total_binder_amount: number;
  deposit_amount: number;
  merchant: string;
  source: string;
  lead_model?: "FormLead" | "CallLead" | null;
  local?: string | null;
  cancelled?: unknown;
  lead_ref?: { toString(): string } | string;
};

export type FormLeadSheetSource = SyncableDocument & {
  timestamp: Date;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  pickup_zip: string;
  destination_zip: string;
  pickup_state?: string | null;
  delivery_state?: string | null;
  move_size: string;
  move_date: Date;
  phone_number: string;
  email?: string | null;
  ref_no?: string | null;
  booked?: PopulatedBookedLead | string | null;
  over_2000?: boolean | null;
  over_4000?: boolean | null;
  cancelled?: unknown;
  local: string;
  cubic_feet?: number | null;
  lid?: string | null;
  source_company: SourceCompany;
  source_company_site?: string | null;
  quoted?: boolean | null;
  cpl?: number | null;
  duplicate?: boolean | null;
  bad_lead?: FormLeadBadLeadReason | null;
};

export type CallLeadSheetSource = SyncableDocument & {
  timestamp: Date;
  job_no?: string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  email?: string | null;
  pickup_zip?: string | null;
  delivery_zip?: string | null;
  pickup_state?: string | null;
  delivery_state?: string | null;
  duration?: number | null;
  source_company: SourceCompany;
  booked?: PopulatedBookedLead | string | null;
  cancelled?: unknown;
  over_2000?: boolean | null;
  over_4000?: boolean | null;
  local?: string | null;
  form_fill?: boolean | null;
  cubic_feet?: number | null;
  duplicate?: boolean | null;
};

export type BookedLeadSheetSource = SyncableDocument & PopulatedBookedLead;

export type CancelledLeadSheetSource = SyncableDocument & {
  timestamp: Date;
  agent?: string | null;
  cancel_date?: Date | null;
  job_no?: string | null;
  customer_name?: string | null;
  refund_amount?: number | null;
  source?: string | null;
  lead_ref?: { toString(): string } | string | null;
};
