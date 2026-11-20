import assert from "node:assert/strict";
import { textCell } from "./cells";
import { test } from "node:test";
import mongoose from "mongoose";
import { bookedLeadToRow } from "./bookedLeadRow";
import { callLeadToRow } from "./callLeadRow";
import { cancelledLeadToRow } from "./cancelledLeadRow";
import { formLeadToRow } from "./formLeadRow";
import type {
  BookedLeadSheetSource,
  CallLeadSheetSource,
  CancelledLeadSheetSource,
  FormLeadSheetSource,
} from "../types";

const fixedDate = new Date("2026-05-27T15:04:05.000Z");

test("formLeadToRow projects fields in the documented header order", () => {
  const lead: FormLeadSheetSource = {
    _id: new mongoose.Types.ObjectId(),
    timestamp: new Date("2026-05-27T09:04:05.000Z"),
    name: "Jane Tester",
    pickup_city: "New York",
    pickup_zip: "10001",
    delivery_city: "Beverly Hills",
    destination_zip: "90210",
    pickup_state: "NY",
    delivery_state: "  ",
    move_size: "2 Bedrooms",
    move_date: new Date("2026-06-01T00:00:00.000Z"),
    phone_number: "555-111-2222",
    email: "  jane@example.com  ",
    ref_no: " ref-abc ",
    booked: null,
    over_2000: true,
    over_4000: false,
    cancelled: null,
    local: "local",
    cubic_feet: 750,
    lid: "lead-id-1",
    source_company: "main_site",
    source_company_site: "vantagemovers.com",
    quoted: true,
    bad_lead: "bad_phone_email_name",
    receiver_agent_name_snapshot: "  Nick Smith  ",
  };

  const row = formLeadToRow(lead);

  assert.equal(row.length, 22);
  assert.equal(row.includes("New York"), false);
  assert.equal(row.includes("Beverly Hills"), false);
  assert.equal(row[0], "5/27/2026 09:04:05");
  assert.equal(row[1], "Jane Tester");
  assert.equal(row[2], "10001");
  assert.equal(row[3], "90210");
  assert.equal(row[4], "NY");
  assert.equal(row[5], "not_found");
  assert.equal(row[6], "local");
  assert.equal(row[7], "2026-06-01");
  assert.equal(row[8], "555-111-2222");
  assert.equal(row[9], "jane@example.com");
  assert.equal(row[10], "quoted");
  assert.equal(row[11], "750");
  assert.equal(row[12], "");
  assert.equal(row[13], ">2k");
  assert.equal(row[14], "");
  assert.equal(row[15], "");
  assert.equal(row[16], "");
  assert.equal(row[17], lead._id.toString());
  assert.equal(row[18], "ref-abc");
  assert.equal(row[19], "Main Site Forms");
  assert.equal(row[20], "Bad Phone-Email-Name");
  assert.equal(row[21], "Nick Smith");
});

test("formLeadToRow clears booking reporting columns after booking deletion", () => {
  const lead: FormLeadSheetSource = {
    _id: new mongoose.Types.ObjectId(),
    timestamp: fixedDate,
    name: "Deleted Booking Lead",
    pickup_zip: "10001",
    destination_zip: "90210",
    move_size: "Studio",
    move_date: fixedDate,
    phone_number: "555-555-5555",
    local: "local",
    source_company: "main_site",
    booked: undefined,
    over_2000: false,
    over_4000: false,
    cancelled: undefined,
  };

  const row = formLeadToRow(lead);

  assert.equal(row[12], "");
  assert.equal(row[13], "");
  assert.equal(row[14], "");
  assert.equal(row[15], "");
  assert.equal(row[16], "");
});

test("callLeadToRow projects fields in the documented header order", () => {
  const lead: CallLeadSheetSource = {
    _id: new mongoose.Types.ObjectId(),
    timestamp: new Date("2026-05-27T09:04:05.000Z"),
    job_no: "J-100",
    phone_number: "555-333-4444",
    pickup_city: "New York",
    delivery_city: "Beverly Hills",
    duration: 120,
    booked: "some-id",
    over_2000: false,
    over_4000: true,
    cancelled: null,
    local: "long_distance",
    cubic_feet: 1200,
    source_company: "tbm_leads",
    form_fill: true,
    receiver_agent_name_snapshot: "  Nick Smith  ",
  };

  const row = callLeadToRow(lead);

  assert.equal(row.length, 15);
  assert.equal(row.includes("New York"), false);
  assert.equal(row.includes("Beverly Hills"), false);
  assert.equal(row[0], "5/27/2026 09:04:05");
  assert.equal(row[1], "J-100");
  assert.equal(row[2], "555-333-4444");
  assert.equal(row[3], "120");
  assert.equal(row[4], "booked");
  assert.equal(row[5], "");
  assert.equal(row[6], "");
  assert.equal(row[7], ">4k");
  assert.equal(row[8], "");
  assert.equal(row[9], "long_distance");
  assert.equal(row[10], "1200");
  assert.equal(row[11], lead._id.toString());
  assert.equal(row[12], "10best Inbounds");
  assert.equal(row[13], "TRUE");
  assert.equal(row[14], "Nick Smith");
});

test("callLeadToRow clears booking reporting columns after booking deletion", () => {
  const lead: CallLeadSheetSource = {
    _id: new mongoose.Types.ObjectId(),
    timestamp: fixedDate,
    job_no: "J-200",
    phone_number: "555-333-4444",
    source_company: "tbm_leads",
    booked: undefined,
    over_2000: false,
    over_4000: false,
    cancelled: undefined,
  };

  const row = callLeadToRow(lead);

  assert.equal(row[4], "");
  assert.equal(row[5], "");
  assert.equal(row[6], "");
  assert.equal(row[7], "");
  assert.equal(row[8], "");
});

test("bookedLeadToRow projects allocations, customer, and lead ref", () => {
  const customerId = new mongoose.Types.ObjectId();
  const leadRefId = new mongoose.Types.ObjectId();
  const booking: BookedLeadSheetSource = {
    _id: new mongoose.Types.ObjectId(),
    timestamp: new Date("2026-05-27T09:04:05.000Z"),
    book_date: new Date("2026-05-20T00:00:00.000Z"),
    job_no: "JOB-1",
    customer: { full_name: "John Doe" },
    agent_allocations: [
      { agent_name_snapshot: "Agent A", binder_amount: 800 },
      { agent_name_snapshot: "Agent B", binder_amount: 200 },
    ],
    total_binder_amount: 1000,
    deposit_amount: 250,
    merchant: "stripe",
    source: "main_site",
    lead_model: "FormLead",
    local: "local",
    cancelled: true,
    lead_ref: leadRefId,
  };
  // attach an extra unused customer id to ensure full_name takes precedence
  void customerId;

  const row = bookedLeadToRow(booking);
  assert.equal(row.length, 15);
  assert.equal(row[0], "5/27/2026 09:04:05");
  assert.equal(row[1], "Agent A");
  assert.equal(row[2], "Agent B");
  assert.equal(row[3], "1000");
  assert.equal(row[4], "TRUE");
  assert.equal(row[5], "2026-05-20");
  assert.equal(row[6], "JOB-1");
  assert.equal(row[7], "John Doe");
  assert.equal(row[8], "250");
  assert.equal(row[9], "stripe");
  assert.equal(row[10], "Main Site Forms");
  assert.equal(row[11], booking._id.toString());
  assert.equal(row[12], leadRefId.toString());
  assert.equal(row[13], "local");
  assert.equal(row[14], "cancelled");
});

test("bookedLeadToRow projects referral customer name and blank lead ref", () => {
  const booking: BookedLeadSheetSource = {
    _id: new mongoose.Types.ObjectId(),
    timestamp: new Date("2026-05-27T09:04:05.000Z"),
    book_date: new Date("2026-05-20T00:00:00.000Z"),
    job_no: "REF-1",
    customer_name: "Referral Customer",
    agent_allocations: [{ agent_name_snapshot: "Agent A", binder_amount: 500 }],
    total_binder_amount: 500,
    deposit_amount: 100,
    merchant: "Paper Check",
    source: "referral",
    local: null,
  };

  const row = bookedLeadToRow(booking);
  assert.equal(row.length, 15);
  assert.equal(row[7], "Referral Customer");
  assert.equal(row[10], "referral");
  assert.equal(row[12], "");
  assert.equal(row[13], "");
});

test("bookedLeadToRow projects leadless booking source label and blank lead ref", () => {
  const booking: BookedLeadSheetSource = {
    _id: new mongoose.Types.ObjectId(),
    timestamp: new Date("2026-05-27T09:04:05.000Z"),
    book_date: new Date("2026-05-20T00:00:00.000Z"),
    job_no: "JOB-1",
    agent_allocations: [{ agent_name_snapshot: "Agent A", binder_amount: 500 }],
    total_binder_amount: 500,
    deposit_amount: 100,
    merchant: "Card",
    source: "Best Relocation Inbounds",
    local: "local",
  };

  const row = bookedLeadToRow(booking);
  assert.equal(row[6], "JOB-1");
  assert.equal(row[10], "Best Relocation Inbounds");
  assert.equal(row[12], "");
});

test("cancelledLeadToRow projects cancellation fields", () => {
  const leadRefId = new mongoose.Types.ObjectId();
  const cancellation: CancelledLeadSheetSource = {
    _id: new mongoose.Types.ObjectId(),
    timestamp: new Date("2026-05-27T09:04:05.000Z"),
    agent: "Agent A",
    cancel_date: new Date("2026-05-25T00:00:00.000Z"),
    job_no: "JOB-2",
    customer_name: "Jane Roe",
    refund_amount: 99,
    source: "mainsite",
    lead_ref: leadRefId,
  };

  const row = cancelledLeadToRow(cancellation);
  assert.equal(row.length, 9);
  assert.equal(row[0], "5/27/2026 09:04:05");
  assert.equal(row[1], "Agent A");
  assert.equal(row[2], "2026-05-25");
  assert.equal(row[3], "JOB-2");
  assert.equal(row[4], "Jane Roe");
  assert.equal(row[5], "99");
  assert.equal(row[6], "mainsite");
  assert.equal(row[7], cancellation._id.toString());
  assert.equal(row[8], leadRefId.toString());
});

test("phone cells that Sheets would parse as a formula are stored as text", () => {
  assert.equal(textCell("+15628418170"), "'+15628418170");
  assert.equal(textCell("+44 (0)20 3314 8208"), "'+44 (0)20 3314 8208");
  assert.equal(textCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(textCell("-5551234"), "'-5551234");
  assert.equal(textCell("@x"), "'@x");
  assert.equal(textCell("(407) 235-2379"), "(407) 235-2379");
  assert.equal(textCell("504-897-5528"), "504-897-5528");
  assert.equal(textCell(""), "");
  assert.equal(textCell(null), "");
  assert.equal(textCell(undefined), "");
});
