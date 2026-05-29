import assert from "node:assert/strict";
import test from "node:test";
import {
  bookedCallLeadReconciliationBatchSchema,
  browseCallLeadsQuerySchema,
  browseFormLeadsQuerySchema,
  createBookedLeadSchema,
  createBookedLeadFromSourceSchema,
  createCallLeadSchema,
  createFormLeadSchema,
} from "./v1.validation";
import { BookedLead } from "../models/BookedLead";
import { CallLead } from "../models/CallLead";
import { FORM_LEAD_UNKNOWN_STATE, FormLead } from "../models/FormLead";

test("createCallLeadSchema accepts a job_no-only call lead", () => {
  const parsed = createCallLeadSchema.parse({
    job_no: "P5556278",
    source_company: "BestRelocation Inbounds",
  });

  assert.equal(parsed.job_no, "P5556278");
  assert.equal(parsed.source_company, "BestRelocation Inbounds");
});

test("createCallLeadSchema rejects call leads without phone_number or job_no", () => {
  const parsed = createCallLeadSchema.safeParse({
    source_company: "BestRelocation Inbounds",
  });

  assert.equal(parsed.success, false);
});

test("createBookedLeadFromSourceSchema accepts CallLead booking with only call_job_no", () => {
  const parsed = createBookedLeadFromSourceSchema.parse({
    lead_type: "CallLead",
    call_job_no: "P5556278",
    book_date: "2026-05-21",
    agent: "JOSH",
    binder_amount: 900,
    deposit_amount: 900,
    merchant: "Card",
    source_company: "BestRelocation Inbounds",
  });

  assert.equal(parsed.lead_type, "CallLead");
  assert.equal(parsed.call_job_no, "P5556278");
  assert.equal(parsed.call_phone_number, undefined);
});

test("createBookedLeadSchema accepts FormLead booking by Mongo id without job_no", () => {
  const parsed = createBookedLeadSchema.parse({
    book_date: "2026-05-21",
    lead_ref: "507f1f77bcf86cd799439011",
    lead_model: "FormLead",
    agent_allocations: [{ agent_name: "JOSH", binder_amount: 900 }],
    total_binder_amount: 900,
    deposit_amount: 900,
    merchant: "Card",
    source: "main_site",
  });

  assert.equal(parsed.lead_ref, "507f1f77bcf86cd799439011");
  assert.equal(parsed.lead_model, "FormLead");
  assert.equal(parsed.job_no, undefined);
});

test("createBookedLeadFromSourceSchema accepts transient CallLead booking phone", () => {
  const parsed = createBookedLeadFromSourceSchema.parse({
    lead_type: "CallLead",
    call_job_no: "P5556278",
    call_phone_number: "(240) 555-0199",
    book_date: "2026-05-21",
    agent: "JOSH",
    binder_amount: 900,
    deposit_amount: 900,
    merchant: "Card",
    source_company: "BestRelocation Inbounds",
  });

  assert.equal(parsed.lead_type, "CallLead");
  assert.equal(parsed.call_phone_number, "(240) 555-0199");
});

test("createBookedLeadFromSourceSchema accepts CallLead booking with only phone", () => {
  const parsed = createBookedLeadFromSourceSchema.parse({
    lead_type: "CallLead",
    call_phone_number: "(240) 555-0199",
    book_date: "2026-05-21",
    agent: "JOSH",
    binder_amount: 900,
    deposit_amount: 900,
    merchant: "Card",
    source_company: "BestRelocation Inbounds",
  });

  assert.equal(parsed.lead_type, "CallLead");
  assert.equal(parsed.call_job_no, undefined);
  assert.equal(parsed.call_phone_number, "(240) 555-0199");
});

test("createBookedLeadFromSourceSchema rejects CallLead booking without job or phone", () => {
  const parsed = createBookedLeadFromSourceSchema.safeParse({
    lead_type: "CallLead",
    book_date: "2026-05-21",
    agent: "JOSH",
    binder_amount: 900,
    deposit_amount: 900,
    merchant: "Card",
    source_company: "BestRelocation Inbounds",
  });

  assert.equal(parsed.success, false);
});

test("createFormLeadSchema does not accept duplicate from clients", () => {
  const parsed = createFormLeadSchema.safeParse({
    source_company: "main_site",
    name: "Jane Customer",
    pickup_zip: "10001",
    destination_zip: "33101",
    move_size: "Studio",
    ref_no: "not provided",
    email: "jane@example.com",
    phone_number: "5555551212",
    duplicate: true,
  });

  assert.equal(parsed.success, false);
});

test("createFormLeadSchema accepts post_to_granot boolean false", () => {
  const parsed = createFormLeadSchema.parse({
    source_company: "main_site",
    name: "Jane Customer",
    pickup_zip: "10001",
    destination_zip: "33101",
    move_size: "Studio",
    ref_no: "not provided",
    email: "jane@example.com",
    phone_number: "5555551212",
    post_to_granot: false,
  });

  assert.equal(parsed.post_to_granot, false);
});

test("createFormLeadSchema accepts post_to_granot string false", () => {
  const parsed = createFormLeadSchema.parse({
    source_company: "main_site",
    name: "Jane Customer",
    pickup_zip: "10001",
    destination_zip: "33101",
    move_size: "Studio",
    ref_no: "not provided",
    email: "jane@example.com",
    phone_number: "5555551212",
    post_to_granot: "false",
  });

  assert.equal(parsed.post_to_granot, false);
});

test("createFormLeadSchema accepts typo emails as plain strings", () => {
  const parsed = createFormLeadSchema.parse({
    source_company: "main_site",
    name: "Jane Customer",
    pickup_zip: "10001",
    destination_zip: "33101",
    move_size: "Studio",
    ref_no: "not provided",
    email: " jane@gmailcom ",
    phone_number: "5555551212",
  });

  assert.equal(parsed.email, "jane@gmailcom");
});

test("createCallLeadSchema does not accept server-owned flags from clients", () => {
  const parsed = createCallLeadSchema.safeParse({
    job_no: "P5556278",
    source_company: "BestRelocation Inbounds",
    form_fill: true,
    created_on_unmatched: true,
  });

  assert.equal(parsed.success, false);
});

test("bookedCallLeadReconciliationBatchSchema accepts Booked Jobs CRM rows", () => {
  const parsed = bookedCallLeadReconciliationBatchSchema.parse({
    rows: [
      {
        row_id: "1:P5556278",
        row_index: 1,
        section: "bookedJobs",
        job_no: "P5556278",
        source: "BestRelocation Inbounds",
        prior: "5",
        book_date: "05/21/2026",
        customer: "Andres Gonzalez",
        phone: "2405504455",
        email: "ag@acentopartners.com",
        from_zip: "22903",
        to_zip: "22903",
        est_cf: "300",
      },
    ],
  });

  assert.equal(parsed.rows[0].section, "bookedJobs");
  assert.equal(parsed.rows[0].prior, "5");
});

test("CallLead model validates job_no-only identity", async () => {
  const lead = new CallLead({
    job_no: "P5556278",
    source_company: "best_relocation_leads",
  });

  await assert.doesNotReject(() => lead.validate());
});

test("CallLead model stores form_fill when computed by the service", async () => {
  const lead = new CallLead({
    job_no: "P5556278",
    source_company: "best_relocation_leads",
    form_fill: true,
    created_on_unmatched: true,
  });

  await assert.doesNotReject(() => lead.validate());
  assert.equal(lead.form_fill, true);
  assert.equal(lead.created_on_unmatched, true);
});

test("BookedLead model validates phone-only CallLead bookings without job_no", async () => {
  const booking = new BookedLead({
    book_date: new Date("2026-05-21"),
    lead_ref: "507f1f77bcf86cd799439011",
    lead_model: "CallLead",
    agent_allocations: [
      {
        agent: "507f1f77bcf86cd799439012",
        agent_name_snapshot: "JOSH",
        binder_amount: 900,
      },
    ],
    total_binder_amount: 900,
    deposit_amount: 900,
    merchant: "Card",
    source: "main_site",
  });

  await assert.doesNotReject(() => booking.validate());
  assert.equal(booking.job_no, undefined);
});

test("FormLead model stores duplicate quarantine flag", async () => {
  const lead = new FormLead({
    source_company: "best_relocation_leads",
    name: "Jane Customer",
    pickup_zip: "10001",
    destination_zip: "33101",
    pickup_state: "NY",
    delivery_state: "FL",
    move_size: "Studio",
    ref_no: "not provided",
    email: "jane@example.com",
    phone_number: "5555551212",
    local: "long_distance",
    duplicate: true,
  });

  await assert.doesNotReject(() => lead.validate());
  assert.equal(lead.duplicate, true);
});

test("FormLead model defaults missing state fields to not_found", async () => {
  const lead = new FormLead({
    source_company: "top10_leads",
    name: "Jane Customer",
    pickup_zip: "22531",
    destination_zip: "26532",
    move_size: "Studio",
    ref_no: "not provided",
    email: "jane@example.com",
    phone_number: "5555551212",
    local: "long_distance",
  });

  await assert.doesNotReject(() => lead.validate());
  assert.equal(lead.pickup_state, FORM_LEAD_UNKNOWN_STATE);
  assert.equal(lead.delivery_state, FORM_LEAD_UNKNOWN_STATE);
});

test("CallLead model rejects identity-less documents", async () => {
  const lead = new CallLead({
    source_company: "best_relocation_leads",
  });

  await assert.rejects(() => lead.validate(), /phone_number/);
});

test("browseFormLeadsQuerySchema allows an empty query (view all) with defaults", () => {
  const parsed = browseFormLeadsQuerySchema.parse({});

  assert.equal(parsed.limit, 50);
  assert.equal(parsed.skip, 0);
  assert.equal(parsed.q, undefined);
  assert.equal(parsed.source_company, undefined);
});

test("browseFormLeadsQuerySchema accepts a standalone source_company filter", () => {
  const parsed = browseFormLeadsQuerySchema.parse({
    source_company: "Get Movers",
  });

  assert.equal(parsed.source_company, "Get Movers");
});

test("browseFormLeadsQuerySchema coerces booked and limit query strings", () => {
  const parsed = browseFormLeadsQuerySchema.parse({
    booked: "true",
    cancelled: "false",
    limit: "10",
    skip: "5",
  });

  assert.equal(parsed.booked, true);
  assert.equal(parsed.cancelled, false);
  assert.equal(parsed.limit, 10);
  assert.equal(parsed.skip, 5);
});

test("browseFormLeadsQuerySchema rejects unknown keys", () => {
  const parsed = browseFormLeadsQuerySchema.safeParse({ bogus: "x" });

  assert.equal(parsed.success, false);
});

test("browseCallLeadsQuerySchema accepts job_no and full-text q", () => {
  const parsed = browseCallLeadsQuerySchema.parse({
    q: "smith",
    job_no: "P5556767",
  });

  assert.equal(parsed.q, "smith");
  assert.equal(parsed.job_no, "P5556767");
});
