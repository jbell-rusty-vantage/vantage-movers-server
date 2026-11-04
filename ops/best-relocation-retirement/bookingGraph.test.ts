import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFinalBookingGraph, buildFinalFinancialActions } from "./bookingGraph";
import { createLeadlessBookingSchema } from "../../src/validation/v1/bookings.validation";
import { createCancelledLeadSchema } from "../../src/validation/v1/cancellations.validation";
import type { ParsedBookedDeal, ParsedCallLead, ParsedFormLead, ParsedRefund, ParsedWorkbookData, SheetProvenance } from "../../src/services/bestRelocationSheetIngest/types";

const through = "2026-11-04T00:00:00.000Z";
const proof = (tab: SheetProvenance["tab"], row: number): SheetProvenance => ({ workbook_id: "source", workbook_title: "source", tab, sheet_row: row, source_row_key: `${tab}:${row}`, raw: {} });
function booking(row = 2, overrides: Partial<ParsedBookedDeal> = {}): ParsedBookedDeal {
  return { source_tab: "Booked Deals", sheet_row: row, timestamp: "2026-06-01T14:00:00.000Z", agent: "Alex", book_date: "2026-06-01T04:00:00.000Z",
    job_no: "B123", normalized_job_no: "B123", customer_name: "Jane Smith", normalized_customer_name: "jane smith", customer_name_tokens: ["jane smith"],
    binder_amount: 100, deposit_amount: 1000, merchant: "Elavon", lead_source: "Best Relocation Forms", lid: "LID123", payment_notes: "", is_best_relocation_source: true,
    provenance: proof("Booked Deals", row), ...overrides };
}
function form(row = 2, overrides: Partial<ParsedFormLead> = {}): ParsedFormLead {
  return { kind: "form", source_tab: "Forms", sheet_row: row, timestamp: "2026-05-01T14:00:00.000Z", name: "Jane Smith", normalized_name: "jane smith", name_tokens: ["jane smith"],
    phone: "2125550100", pickup_zip: "10001", destination_zip: "10002", move_size: "1 Bedroom", lead_id: "LID123", booked_flag: "", over_2k: "", over_4k: "", bad_lead_checker: "", local: false,
    provenance: proof("Forms", row), ...overrides };
}
function refund(row = 2, overrides: Partial<ParsedRefund> = {}): ParsedRefund {
  return { source_tab: "Refunds", sheet_row: row, timestamp: "2026-07-01T14:00:00.000Z", refund_request_date: "2026-07-01T04:00:00.000Z", status: "Refunded", agent: "Alex", normalized_agent: "alex",
    book_date: "2026-06-01T04:00:00.000Z", job_no: "B123", normalized_job_no: "B123", customer_name: "Jane Smith", normalized_customer_name: "jane smith", binder_amount: 100,
    deposit_amount: 1000, merchant: "Elavon", lead_source: "Best Relocation Forms", is_best_relocation_source: true,
    provenance: { ...proof("Refunds", row), raw: { vantage_ingestion_id: `vantage:00000000-0000-4000-8000-${String(row).padStart(12, "0")}` } }, ...overrides };
}
function data(overrides: Partial<ParsedWorkbookData> = {}): ParsedWorkbookData {
  return { leadsWorkbook: { id: "leads", title: "leads" }, bookedWorkbook: { id: "booked", title: "booked" }, forms: [], localForms: [], calls: [], booked: [], refunds: [], lidBestRelo: [], ...overrides };
}
const graph = (rows: Partial<ParsedWorkbookData>) => buildFinalBookingGraph({ data: data(rows), through });

test("all in-scope Bookings survive missing or old Leads; new normal creates require exact source corroboration", () => {
  const old = form(2, { timestamp: "2026-04-01T12:00:00.000Z" });
  const result = graph({ forms: [old, form(3, { lead_id: "UNBOOKED" })], booked: [booking(), booking(3, { job_no: "B456", normalized_job_no: "B456", lid: undefined })] });
  assert.equal(result.accounting.booking_ready, 2);
  assert.equal(result.accounting.leadless_bookings, 1);
  assert.equal(result.permitted_normal_leads.length, 1);
  assert.equal(result.permitted_normal_leads[0].stable_source_row_id, "lead:lid123");
  assert.equal(result.permitted_normal_leads[0].method, "lid_ref_and_customer");
});

test("same-agent repeated submissions collapse without doubling money and split allocations retain their exact values", () => {
  const rows = [booking(), booking(3, { timestamp: "2026-06-01T15:00:00Z" }), booking(4, { agent: "Beth", binder_amount: 200 })];
  const result = graph({ booked: rows });
  assert.equal(result.bookings.length, 1);
  assert.equal(result.bookings[0].total_binder_amount, 300);
  assert.equal(result.bookings[0].deposit_amount, 1000);
  assert.deepEqual(result.bookings[0].agent_allocations, [{ agent_name: "Alex", binder_amount: 100 }, { agent_name: "Beth", binder_amount: 200 }]);
  assert.deepEqual(result.bookings[0].duplicate_response_rows, [3]);
  assert.deepEqual(result, graph({ booked: [...rows].reverse() }));
});

test("financial/identity differences and missing values stay explicit conflicts, never synthesized amounts", () => {
  for (const change of [{ binder_amount: 200 }, { deposit_amount: 2000 }, { customer_name: "Another Customer" }, { lead_source: "Best Relocation Locals" }, { binder_amount: undefined }, { merchant: "Unsupported" }]) {
    const result = graph({ booked: [booking(), booking(3, change)] });
    assert.equal(result.bookings[0].status, "conflict");
    assert.equal(result.bookings[0].total_binder_amount, undefined);
    assert.equal(result.permitted_normal_leads.length, 0);
  }
});

test("duplicate exact identities, conflicting contacts and cross-channel LIDs never choose a source Lead", () => {
  const duplicate = graph({ forms: [form(), form(3)], booked: [booking()] });
  assert.equal(duplicate.permitted_normal_leads.length, 0);
  assert.ok(duplicate.bookings[0].lead_match_conflicts.includes("multiple_exact_source_lead_candidates"));
  assert.equal(graph({ forms: [form(2, { name: "Another Person" })], booked: [booking()] }).permitted_normal_leads.length, 0);
  assert.equal(graph({ forms: [form()], booked: [booking(2, { lead_source: "Best Relocation Locals" })] }).permitted_normal_leads.length, 0);
  assert.equal(graph({ forms: [form()], booked: [booking(), booking(3, { job_no: "B456", normalized_job_no: "B456" })] }).permitted_normal_leads.length, 0);
});

test("generic Forms source can select one exact Local Form; duplicate cross-tab evidence remains ambiguous", () => {
  const local = form(2, { source_tab: "Local Forms", local: true });
  const result = graph({ localForms: [local], booked: [booking()] });
  assert.equal(result.permitted_normal_leads[0].dataset_key, "local_forms");
  assert.ok(result.permitted_normal_leads[0].evidence.includes("source_channel:local_forms"));
  assert.equal(graph({ forms: [form()], localForms: [local], booked: [booking()] }).permitted_normal_leads.length, 0);
});

test("phone, Booked flag and nearest date do not authorize Calls; explicit job plus Booking phone does", () => {
  const call: ParsedCallLead = { kind: "call", source_tab: "Calls", sheet_row: 2, phone: "2125550100", date: "6/1/2026", time: "10:00 AM", timestamp: "2026-06-01T14:00:00Z",
    booked_flag: "Booked", over_2000: "", over_4000: "", form_fill_checker: "", provenance: { ...proof("Calls", 2), raw: { vantage_ingestion_id: "vantage:00000000-0000-4000-8000-000000000002" } } };
  const book = booking(2, { lead_source: "BestRelocation Inbounds", provenance: { ...proof("Booked Deals", 2), raw: { "Phone Number": "2125550100" } } });
  assert.equal(graph({ calls: [call], booked: [book] }).permitted_normal_leads.length, 0);
  call.provenance.raw["Job Number:"] = "B123";
  assert.equal(graph({ calls: [call], booked: [book] }).permitted_normal_leads[0].method, "explicit_job_and_phone");
});

test("refunds match canonical Booking identity after split responses collapse, including blank source attribution", () => {
  const result = graph({ booked: [booking(), booking(3, { agent: "Beth", binder_amount: 200 })], refunds: [refund(2, { lead_source: "", is_best_relocation_source: false })] });
  assert.equal(result.refunds[0].status, "matched");
  assert.equal(result.refunds[0].booking_job, "B123");
  assert.equal(result.refunds[0].method, "job_and_corroboration");
});

test("refund job alone and contradictory customer evidence are review results", () => {
  for (const overrides of [{ customer_name: "", agent: "", lid: undefined }, { customer_name: "Another Person" }]) {
    const result = graph({ booked: [booking()], refunds: [refund(2, overrides)] });
    assert.equal(result.refunds[0].status, "review");
  }
});

test("competing distinct refunds refuse all requests regardless of source order; exact repeated requests collapse", () => {
  const rows = [refund(), refund(3, { deposit_amount: 500 })];
  const forward = graph({ booked: [booking()], refunds: rows });
  assert.deepEqual(forward, graph({ booked: [booking()], refunds: [...rows].reverse() }));
  assert.equal(forward.accounting.refund_matches, 0);
  assert.equal(forward.accounting.refund_review, 2);
  const repeated = graph({ booked: [booking()], refunds: [refund(), refund(3)] });
  assert.equal(repeated.accounting.refund_matches, 1);
  assert.equal(repeated.accounting.collapsed_refund_responses, 1);
});

test("Booking scope uses its own event timestamp and fixed upper bound", () => {
  const result = graph({ booked: [booking(), booking(3, { timestamp: "2026-04-30T03:59:59.999Z" }), booking(4, { timestamp: through })] });
  assert.equal(result.accounting.booking_source_rows, 1);
  assert.equal(result.bookings[0].rows[0].sheet_row, 2);
});

test("financial actions fit canonical strict schemas, keep Bookings independent, and bind refunds to one Booking", () => {
  const result = graph({ booked: [booking(), booking(3)], refunds: [refund(), refund(3)] });
  const actions = buildFinalFinancialActions(result);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].command, "create_leadless_booking");
  assert.deepEqual(actions[0].depends_on, []);
  assert.ok(createLeadlessBookingSchema.safeParse(actions[0].command_payload).success);
  assert.equal(actions[1].command, "create_cancelled_lead");
  assert.deepEqual(actions[1].depends_on, [actions[0].action_key]);
  assert.ok(createCancelledLeadSchema.safeParse({ ...actions[1].command_payload, booked_lead: "000000000000000000000001" }).success);
  assert.equal("rows" in actions[1].provenance && actions[1].provenance.rows.length, 2);
  assert.equal("rows" in actions[0].provenance && actions[0].provenance.rows.length, 2);
  assert.deepEqual(actions, buildFinalFinancialActions(graph({ booked: [booking(3), booking()], refunds: [refund(3), refund()] })));
});

test("unsupported unequal split never becomes invented equal allocations at the canonical boundary", () => {
  const [action] = buildFinalFinancialActions(graph({ booked: [booking(), booking(3, { agent: "Beth", binder_amount: 200 })] }));
  assert.equal(action.command, "record_conflict");
  assert.equal(action.command_payload, undefined);
  assert.ok((action.source_owned_values?.conflicts as string[]).includes("unequal_split_not_supported_by_canonical_create"));
});
