import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { bookedLeadToRow } from "./bookedLeadRow";
import { callLeadToRow } from "./callLeadRow";
import { cancelledLeadToRow } from "./cancelledLeadRow";
import {
  booleanCell,
  bookedCell,
  bookedDateCell,
  cancelledCell,
  formatDateOnly,
  formatNumber,
  formatTimestamp,
  localCell,
  optionalLocalCell,
  overThresholdCell,
  primaryBookingAgent,
  quotedCell,
  splitCell,
} from "./cells";
import { formLeadToRow } from "./formLeadRow";
import type {
  BookedLeadSheetSource,
  CallLeadSheetSource,
  CancelledLeadSheetSource,
  FormLeadSheetSource,
  PopulatedBookedLead,
} from "../types";

const fixedDate = new Date("2026-05-27T15:04:05.000Z");

test("formatDateOnly returns ISO date prefix", () => {
  assert.equal(formatDateOnly(fixedDate), "2026-05-27");
});

test("formatTimestamp uses local clock components", () => {
  const value = new Date(2026, 4, 27, 9, 4, 5);
  assert.equal(formatTimestamp(value), "5/27/2026 09:04:05");
});

test("booleanCell maps booleans to sheet strings", () => {
  assert.equal(booleanCell(true), "TRUE");
  assert.equal(booleanCell(false), "FALSE");
});

test("localCell maps values to local/long_distance", () => {
  assert.equal(localCell("local"), "local");
  assert.equal(localCell("long_distance"), "long_distance");
  assert.equal(localCell(null), "long_distance");
  assert.equal(localCell(undefined), "long_distance");
});

test("optionalLocalCell returns empty string when blank", () => {
  assert.equal(optionalLocalCell(null), "");
  assert.equal(optionalLocalCell(undefined), "");
  assert.equal(optionalLocalCell(""), "");
  assert.equal(optionalLocalCell("local"), "local");
  assert.equal(optionalLocalCell("long_distance"), "long_distance");
});

test("bookedCell, bookedDateCell, cancelledCell, quotedCell map booleans to labels", () => {
  assert.equal(bookedCell(true), "booked");
  assert.equal(bookedCell(false), "");
  assert.equal(cancelledCell(true), "cancelled");
  assert.equal(cancelledCell(false), "");
  assert.equal(quotedCell(true), "quoted");
  assert.equal(quotedCell(false), "");
  assert.equal(bookedDateCell(null), "");
  assert.equal(bookedDateCell(undefined), "");
  assert.equal(bookedDateCell("not-populated"), "");
  const booking: PopulatedBookedLead = {
    _id: new mongoose.Types.ObjectId(),
    timestamp: fixedDate,
    book_date: new Date("2026-05-20T00:00:00.000Z"),
    total_binder_amount: 0,
    deposit_amount: 0,
    merchant: "stripe",
    source: "mainsite",
  };
  assert.equal(bookedDateCell(booking), "2026-05-20");
});

test("overThresholdCell returns label or blank", () => {
  assert.equal(overThresholdCell(true, ">2k"), ">2k");
  assert.equal(overThresholdCell(true, ">4k"), ">4k");
  assert.equal(overThresholdCell(false, ">2k"), "");
});

test("formatNumber stringifies finite numbers and elides null/undefined/NaN", () => {
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(12.5), "12.5");
  assert.equal(formatNumber(null), "");
  assert.equal(formatNumber(undefined), "");
  assert.equal(formatNumber(Number.NaN), "");
});

test("primaryBookingAgent returns first agent name snapshot", () => {
  assert.equal(primaryBookingAgent(undefined), "");
  assert.equal(
    primaryBookingAgent({
      _id: new mongoose.Types.ObjectId(),
      timestamp: fixedDate,
      book_date: fixedDate,
      total_binder_amount: 0,
      deposit_amount: 0,
      merchant: "stripe",
      source: "mainsite",
      agent_allocations: [
        { agent_name_snapshot: "Agent A", binder_amount: 100 },
        { agent_name_snapshot: "Agent B", binder_amount: 50 },
      ],
    }),
    "Agent A",
  );
});

test("splitCell only flags true splits when there are at least two named allocations with non-zero amounts", () => {
  assert.equal(splitCell([]), "FALSE");
  assert.equal(
    splitCell([
      { agent_name_snapshot: "Agent A", binder_amount: 100 },
    ]),
    "FALSE",
  );
  assert.equal(
    splitCell([
      { agent_name_snapshot: "Agent A", binder_amount: 0 },
      { agent_name_snapshot: "Agent B", binder_amount: 0 },
    ]),
    "FALSE",
  );
  assert.equal(
    splitCell([
      { agent_name_snapshot: "Agent A", binder_amount: 100 },
      { agent_name_snapshot: "Agent B", binder_amount: 50 },
    ]),
    "TRUE",
  );
  assert.equal(
    splitCell([
      { agent_name_snapshot: "", binder_amount: 100 },
      { agent_name_snapshot: "Agent B", binder_amount: 50 },
    ]),
    "FALSE",
  );
});

test("formLeadToRow projects fields in the documented header order", () => {
  const lead: FormLeadSheetSource = {
    _id: new mongoose.Types.ObjectId(),
    timestamp: new Date(2026, 4, 27, 9, 4, 5),
    name: "Jane Tester",
    pickup_zip: "10001",
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
  };

  const row = formLeadToRow(lead);

  assert.equal(row.length, 20);
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
  assert.equal(row[19], "main site");
});

test("formLeadToRow defaults missing ref_no to 'not provided'", () => {
  const lead: FormLeadSheetSource = {
    _id: new mongoose.Types.ObjectId(),
    timestamp: fixedDate,
    name: "Test",
    pickup_zip: "10001",
    destination_zip: "90210",
    move_size: "Studio",
    move_date: fixedDate,
    phone_number: "555-555-5555",
    local: "long_distance",
    source_company: "not_provided",
  };

  const row = formLeadToRow(lead);
  assert.equal(row[9], "");
  assert.equal(row[18], "not provided");
  assert.equal(row[4], "not_found");
  assert.equal(row[5], "not_found");
  assert.equal(row[19], "not provided");
});

test("callLeadToRow projects fields in the documented header order", () => {
  const lead: CallLeadSheetSource = {
    _id: new mongoose.Types.ObjectId(),
    timestamp: new Date(2026, 4, 27, 9, 4, 5),
    job_no: "J-100",
    phone_number: "555-333-4444",
    duration: 120,
    booked: "some-id",
    over_2000: false,
    over_4000: true,
    cancelled: null,
    local: "long_distance",
    cubic_feet: 1200,
    source_company: "tbm_leads",
    form_fill: true,
  };

  const row = callLeadToRow(lead);

  assert.equal(row.length, 14);
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
  assert.equal(row[12], "TBM Leads");
  assert.equal(row[13], "TRUE");
});

test("bookedLeadToRow projects allocations, customer, and lead ref", () => {
  const customerId = new mongoose.Types.ObjectId();
  const leadRefId = new mongoose.Types.ObjectId();
  const booking: BookedLeadSheetSource = {
    _id: new mongoose.Types.ObjectId(),
    timestamp: new Date(2026, 4, 27, 9, 4, 5),
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
    source: "mainsite",
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
  assert.equal(row[10], "mainsite");
  assert.equal(row[11], booking._id.toString());
  assert.equal(row[12], leadRefId.toString());
  assert.equal(row[13], "local");
  assert.equal(row[14], "cancelled");
});

test("bookedLeadToRow projects referral customer name and blank lead ref", () => {
  const booking: BookedLeadSheetSource = {
    _id: new mongoose.Types.ObjectId(),
    timestamp: new Date(2026, 4, 27, 9, 4, 5),
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

test("cancelledLeadToRow projects cancellation fields", () => {
  const leadRefId = new mongoose.Types.ObjectId();
  const cancellation: CancelledLeadSheetSource = {
    _id: new mongoose.Types.ObjectId(),
    timestamp: new Date(2026, 4, 27, 9, 4, 5),
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

test("cancelledLeadToRow leaves cancel_date blank when missing", () => {
  const cancellation: CancelledLeadSheetSource = {
    _id: new mongoose.Types.ObjectId(),
    timestamp: fixedDate,
  };

  const row = cancelledLeadToRow(cancellation);
  assert.equal(row[2], "");
  assert.equal(row[8], "");
});
