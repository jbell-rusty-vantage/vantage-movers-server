export type SheetRow = Record<string, string>;

export type SourceTab =
  | "Forms"
  | "Local Forms"
  | "Calls"
  | "Booked Deals"
  | "Refunds"
  | "LID_BestRelo";

export type TabReadResult = {
  spreadsheetId: string;
  spreadsheetTitle: string;
  tabId?: number;
  tabName: SourceTab;
  headers: string[];
  matrix: string[][];
  rangeRead: string;
};

export type SheetProvenance = {
  workbook_id: string;
  workbook_title: string;
  tab: SourceTab;
  sheet_row: number;
  source_row_key: string;
  raw: SheetRow;
};

export type ParsedFormLead = {
  kind: "form";
  source_tab: "Forms" | "Local Forms";
  sheet_row: number;
  timestamp?: string;
  timestamp_ms?: number;
  name: string;
  normalized_name?: string;
  name_tokens: string[];
  pickup_zip: string;
  destination_zip: string;
  move_size: string;
  move_date?: string;
  phone: string;
  normalized_phone?: string;
  lead_id?: string;
  ref_no?: string;
  booked_flag: string;
  over_2k: string;
  over_4k: string;
  bad_lead_checker: string;
  local: boolean;
  provenance: SheetProvenance;
};

export type ParsedCallLead = {
  kind: "call";
  source_tab: "Calls";
  sheet_row: number;
  phone: string;
  normalized_phone?: string;
  date: string;
  time: string;
  timestamp?: string;
  timestamp_ms?: number;
  booked_flag: string;
  over_2000: string;
  over_4000: string;
  form_fill_checker: string;
  provenance: SheetProvenance;
};

export type ParsedBookedDeal = {
  source_tab: "Booked Deals";
  sheet_row: number;
  timestamp?: string;
  timestamp_ms?: number;
  agent: string;
  book_date?: string;
  book_date_ms?: number;
  job_no: string;
  normalized_job_no?: string;
  customer_name: string;
  normalized_customer_name?: string;
  customer_name_tokens: string[];
  binder_amount?: number;
  deposit_amount?: number;
  merchant: string;
  lead_source: string;
  lid?: string;
  payment_notes: string;
  is_best_relocation_source: boolean;
  provenance: SheetProvenance;
};

export type ParsedRefund = {
  source_tab: "Refunds";
  sheet_row: number;
  refund_request_date?: string;
  status: string;
  timestamp?: string;
  agent: string;
  normalized_agent?: string;
  book_date?: string;
  job_no: string;
  normalized_job_no?: string;
  customer_name: string;
  normalized_customer_name?: string;
  binder_amount?: number;
  deposit_amount?: number;
  merchant: string;
  lead_source: string;
  lid?: string;
  is_best_relocation_source: boolean;
  provenance: SheetProvenance;
};

export type LidBestReloEntry = {
  lid: string;
  bucket: "<1K" | ">2K" | ">4K" | "unknown";
  sheet_row: number;
};

export type LeadMatchMethod =
  | "lid_exact"
  | "ref_no_exact"
  | "name_date_window"
  | "name_token_date_window"
  | "name_fuzzy_date_window"
  | "phone_form_bridge"
  | "call_same_day_unique"
  | "call_same_day_amount_tier"
  | "call_date_window_unique"
  | "lid_best_relo_only";

export type LeadBookingMatch = {
  method: LeadMatchMethod;
  confidence: number;
  booking: ParsedBookedDeal;
  lead:
    | { kind: "form"; row: ParsedFormLead }
    | { kind: "call"; row: ParsedCallLead }
    | { kind: "lid_best_relo"; entry: LidBestReloEntry };
  notes?: string;
};

export type RefundMatchMethod =
  | "job_no_agent"
  | "job_no_unique"
  | "job_no_customer"
  | "job_no_amounts"
  | "lid_exact"
  | "customer_book_date";

export type RefundBookingMatch = {
  method: RefundMatchMethod;
  confidence: number;
  refund: ParsedRefund;
  booking: ParsedBookedDeal;
  notes?: string;
};

export type CollapsedBooking = {
  normalized_job_no: string;
  rows: ParsedBookedDeal[];
  primary: ParsedBookedDeal;
  agents: string[];
  total_binder_amount: number;
  deposit_amount: number;
};

export type MutationAction =
  | "create_form_lead"
  | "create_call_lead"
  | "create_booked_from_source"
  | "create_leadless_booking"
  | "create_cancelled_lead";

export type PlannedMutation = {
  action: MutationAction;
  idempotency_key: string;
  confidence?: number;
  match_method?: LeadMatchMethod | RefundMatchMethod;
  depends_on?: string[];
  api: {
    method: "POST";
    path: string;
    body: Record<string, unknown>;
    /**
     * Values resolved from earlier response IDs immediately before POST.
     * The JSON body keeps a human-readable `$ref:<idempotency_key>` marker.
     */
    bindings?: Record<string, string>;
  };
  sheet: SheetProvenance | { rows: SheetProvenance[] };
  notes?: string[];
};

export type IngestPlan = {
  version: 1;
  generated_at: string;
  mode: "dry-run";
  base_url: string;
  threshold: number;
  source_company: "best_relocation_leads";
  workbooks: {
    leads: { id: string; title: string };
    booked: { id: string; title: string };
  };
  summary: {
    forms: number;
    local_forms: number;
    calls: number;
    booking_rows: number;
    booking_jobs: number;
    collapsed_booking_rows: number;
    accepted_booking_matches: number;
    leadless_bookings: number;
    refunds: number;
    matched_refunds: number;
    unmatched_refunds: number;
    mutations: Record<MutationAction, number>;
  };
  unmatched_booking_jobs: Array<{
    job_no: string;
    rows: number[];
    best_match_confidence?: number;
    best_match_method?: LeadMatchMethod;
  }>;
  warnings: string[];
  mutations: PlannedMutation[];
};

export type ParsedWorkbookData = {
  leadsWorkbook: { id: string; title: string };
  bookedWorkbook: { id: string; title: string };
  forms: ParsedFormLead[];
  localForms: ParsedFormLead[];
  calls: ParsedCallLead[];
  booked: ParsedBookedDeal[];
  refunds: ParsedRefund[];
  lidBestRelo: LidBestReloEntry[];
};
