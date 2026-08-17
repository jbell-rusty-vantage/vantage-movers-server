import assert from "node:assert/strict";
import test from "node:test";
import {
  bookedCallLeadReconciliationBatchSchema,
  browseCallLeadsQuerySchema,
  browseFormLeadsQuerySchema,
  createBookedLeadSchema,
  createBookedLeadFromSourceSchema,
  createReferralBookingSchema,
  createLeadlessBookingSchema,
  createCallLeadSchema,
  createCustomerSchema,
  createFormLeadSchema,
  granotFormLeadSyncSchema,
  resolveGranotFormLeadSchema,
  searchFormLeadsSchema,
  updateCallLeadSchema,
  updateFormLeadSchema,
} from "./v1.validation";
import { BookedLead } from "../models/BookedLead";
import { CallLead } from "../models/CallLead";
import { FORM_LEAD_UNKNOWN_STATE, FormLead } from "../models/FormLead";

test("createCallLeadSchema accepts a job_no-only call lead", () => {
  const parsed = createCallLeadSchema.parse({
    job_no: "P5556278",
    source_company: "BestRelocation Inbounds",
    pickup_city: "Barnesville",
    delivery_city: "Atlanta",
  });

  assert.equal(parsed.job_no, "P5556278");
  assert.equal(parsed.source_company, "BestRelocation Inbounds");
  assert.equal(parsed.pickup_city, "Barnesville");
  assert.equal(parsed.delivery_city, "Atlanta");
});

test("updateFormLeadSchema accepts canonical pickup and delivery cities", () => {
  const parsed = updateFormLeadSchema.parse({
    pickup_city: "New Orleans",
    delivery_city: "New York",
  });

  assert.equal(parsed.pickup_city, "New Orleans");
  assert.equal(parsed.delivery_city, "New York");
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

test("createReferralBookingSchema accepts owner-facing referral booking fields", () => {
  const parsed = createReferralBookingSchema.parse({
    book_date: "2026-05-21",
    job_no: "REF-100",
    customer_name: "Jane Referral",
    agent: "JOSH",
    split_agent: "Austin",
    total_binder_amount: 900,
    deposit_amount: 300,
    merchant: "Paper Check",
    local: "local",
  });

  assert.equal(parsed.job_no, "REF-100");
  assert.equal(parsed.customer_name, "Jane Referral");
  assert.equal(parsed.local, "local");
});

test("createReferralBookingSchema accepts optional customer_phone", () => {
  const parsed = createReferralBookingSchema.parse({
    book_date: "2026-05-21",
    job_no: "REF-101",
    customer_name: "Jane Referral",
    customer_phone: "(240) 555-0199",
    agent: "JOSH",
    total_binder_amount: 900,
    deposit_amount: 300,
    merchant: "Paper Check",
  });

  assert.equal(parsed.customer_phone, "(240) 555-0199");
});

test("createBookedLeadFromSourceSchema accepts optional customer contact fields", () => {
  const parsed = createBookedLeadFromSourceSchema.parse({
    lead_type: "FormLead",
    form_lead_id: "507f1f77bcf86cd799439011",
    job_no: "P5556278",
    book_date: "2026-05-21",
    agent: "JOSH",
    binder_amount: 900,
    deposit_amount: 900,
    merchant: "Card",
    customer_name: "Jane Doe",
    customer_phone: "(240) 555-0199",
  });

  assert.equal(parsed.customer_name, "Jane Doe");
  assert.equal(parsed.customer_phone, "(240) 555-0199");
});

test("createCustomerSchema accepts name-only customers", () => {
  const parsed = createCustomerSchema.parse({
    full_name: "Jane Doe",
  });

  assert.equal(parsed.full_name, "Jane Doe");
  assert.equal(parsed.phone_number, undefined);
});

test("createReferralBookingSchema rejects server-owned referral source fields", () => {
  const parsed = createReferralBookingSchema.safeParse({
    book_date: "2026-05-21",
    job_no: "REF-100",
    customer_name: "Jane Referral",
    agent: "JOSH",
    total_binder_amount: 900,
    deposit_amount: 300,
    merchant: "Paper Check",
    source: "referral",
    is_referral_booking: true,
  });

  assert.equal(parsed.success, false);
});

test("createLeadlessBookingSchema accepts owner-facing leadless booking fields", () => {
  const parsed = createLeadlessBookingSchema.parse({
    book_date: "2026-05-21",
    job_no: "JOB-100",
    source_company: "Best Relocation Inbounds",
    source: "Best Relocation Forms",
    customer_name: "Jane Doe",
    agent: "JOSH",
    split_agent: "Austin",
    total_binder_amount: 900,
    deposit_amount: 300,
    merchant: "Paper Check",
    local: "local",
  });

  assert.equal(parsed.job_no, "JOB-100");
  assert.equal(parsed.source_company, "Best Relocation Inbounds");
  assert.equal(parsed.source, "Best Relocation Forms");
  assert.equal(parsed.customer_name, "Jane Doe");
});

test("createLeadlessBookingSchema accepts booking without customer contact fields", () => {
  const parsed = createLeadlessBookingSchema.parse({
    book_date: "2026-05-21",
    job_no: "JOB-101",
    source_company: "10best Inbounds",
    agent: "JOSH",
    total_binder_amount: 900,
    deposit_amount: 900,
    merchant: "Card",
  });

  assert.equal(parsed.customer_name, undefined);
  assert.equal(parsed.customer_phone, undefined);
});

test("createLeadlessBookingSchema rejects server-owned leadless flags", () => {
  const parsed = createLeadlessBookingSchema.safeParse({
    book_date: "2026-05-21",
    job_no: "JOB-100",
    source_company: "Best Relocation Inbounds",
    agent: "JOSH",
    total_binder_amount: 900,
    deposit_amount: 900,
    merchant: "Card",
    is_leadless_booking: true,
  });

  assert.equal(parsed.success, false);
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
    ingestion_source: "best_relocation_sheet",
  });

  assert.equal(parsed.lead_type, "CallLead");
  assert.equal(parsed.call_phone_number, "(240) 555-0199");
  assert.equal(parsed.ingestion_source, "best_relocation_sheet");
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

test("createFormLeadSchema does not accept bad_lead from clients", () => {
  const parsed = createFormLeadSchema.safeParse({
    source_company: "main_site",
    name: "Jane Customer",
    pickup_zip: "10001",
    destination_zip: "33101",
    move_size: "Studio",
    ref_no: "not provided",
    email: "jane@example.com",
    phone_number: "5555551212",
    bad_lead: "auto_only",
  });

  assert.equal(parsed.success, false);
});

test("createFormLeadSchema accepts optional lid from clients", () => {
  const parsed = createFormLeadSchema.parse({
    source_company: "main_site",
    name: "Jane Customer",
    pickup_zip: "10001",
    destination_zip: "33101",
    move_size: "Studio",
    ref_no: "not provided",
    email: "jane@example.com",
    phone_number: "5555551212",
    lid: "LID6a6255e58ad8d",
  });

  assert.equal(parsed.lid, "LID6a6255e58ad8d");
});

test("createFormLeadSchema accepts Best Relocation UUID identity and sheet flags", () => {
  const parsed = createFormLeadSchema.parse({
    source_company: "best_relocation_leads",
    name: "Jane Customer",
    pickup_zip: "10001",
    destination_zip: "33101",
    move_size: "Studio",
    phone_number: "5555551212",
    lid: "33e2d437-594b-475a-b03b-0789a9f614a7",
    local: "long_distance",
    ingestion_source: "best_relocation_sheet",
    over_2000: true,
    over_4000: false,
  });

  assert.equal(parsed.lid, "33e2d437-594b-475a-b03b-0789a9f614a7");
  assert.equal(parsed.local, "long_distance");
  assert.equal(parsed.over_2000, true);
});

test("createFormLeadSchema rejects malformed lid values", () => {
  const parsed = createFormLeadSchema.safeParse({
    source_company: "main_site",
    name: "Jane Customer",
    pickup_zip: "10001",
    destination_zip: "33101",
    move_size: "Studio",
    email: "jane@example.com",
    phone_number: "5555551212",
    lid: "LIDabc123",
  });

  assert.equal(parsed.success, false);
});

test("updateFormLeadSchema accepts duplicate for backfill and admin patches", () => {
  const parsed = updateFormLeadSchema.parse({
    duplicate: true,
  });

  assert.equal(parsed.duplicate, true);
});

test("updateFormLeadSchema accepts and clears bad_lead reasons", () => {
  const marked = updateFormLeadSchema.parse({
    bad_lead: "international_move",
  });
  const cleared = updateFormLeadSchema.parse({
    bad_lead: null,
  });
  const invalid = updateFormLeadSchema.safeParse({
    bad_lead: "wrong_reason",
  });

  assert.equal(marked.bad_lead, "international_move");
  assert.equal(cleared.bad_lead, null);
  assert.equal(invalid.success, false);
});

test("createFormLeadSchema defaults post_to_granot to false when omitted", () => {
  const parsed = createFormLeadSchema.parse({
    source_company: "main_site",
    name: "Jane Customer",
    pickup_zip: "10001",
    destination_zip: "33101",
    move_size: "Studio",
    ref_no: "not provided",
    email: "jane@example.com",
    phone_number: "5555551212",
  });

  assert.equal(parsed.post_to_granot, false);
});

test("createFormLeadSchema defaults an omitted or blank ref_no", () => {
  const baseLead = {
    source_company: "main_site",
    name: "Jane Customer",
    pickup_zip: "10001",
    destination_zip: "33101",
    move_size: "Studio",
    email: "jane@example.com",
    phone_number: "5555551212",
  };

  assert.equal(createFormLeadSchema.parse(baseLead).ref_no, "not provided");
  assert.equal(createFormLeadSchema.parse({ ...baseLead, ref_no: "" }).ref_no, "not provided");
});

test("createFormLeadSchema accepts first and last name without name", () => {
  const parsed = createFormLeadSchema.parse({
    source_company: "main_site",
    first_name: " Jane ",
    last_name: " Customer ",
    pickup_zip: "10001",
    destination_zip: "33101",
    move_size: "Studio",
    ref_no: "not provided",
    email: "jane@example.com",
    phone_number: "5555551212",
  });

  assert.equal(parsed.name, undefined);
  assert.equal(parsed.first_name, "Jane");
  assert.equal(parsed.last_name, "Customer");
});

test("createFormLeadSchema rejects payloads without any name fields", () => {
  const parsed = createFormLeadSchema.safeParse({
    source_company: "main_site",
    pickup_zip: "10001",
    destination_zip: "33101",
    move_size: "Studio",
    ref_no: "not provided",
    email: "jane@example.com",
    phone_number: "5555551212",
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

test("createFormLeadSchema accepts boolean sms_consent", () => {
  const parsed = createFormLeadSchema.parse({
    source_company: "main_site",
    name: "Jane Customer",
    pickup_zip: "10001",
    destination_zip: "33101",
    move_size: "Studio",
    ref_no: "not provided",
    email: "jane@example.com",
    phone_number: "5555551212",
    sms_consent: true,
  });

  assert.equal(parsed.sms_consent, true);
});

test("createFormLeadSchema coerces string sms_consent values", () => {
  const base = {
    source_company: "main_site",
    name: "Jane Customer",
    pickup_zip: "10001",
    destination_zip: "33101",
    move_size: "Studio",
    ref_no: "not provided",
    email: "jane@example.com",
    phone_number: "5555551212",
  };

  assert.equal(
    createFormLeadSchema.parse({ ...base, sms_consent: "true" }).sms_consent,
    true,
  );
  assert.equal(
    createFormLeadSchema.parse({ ...base, sms_consent: "false" }).sms_consent,
    false,
  );
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

test("createCallLeadSchema accepts imported qualification flags", () => {
  const parsed = createCallLeadSchema.parse({
    source_company: "best_relocation_leads",
    phone_number: "5555551212",
    over_2000: true,
    over_4000: false,
  });

  assert.equal(parsed.over_2000, true);
  assert.equal(parsed.over_4000, false);
});

test("createCallLeadSchema accepts optional first and last name", () => {
  const parsed = createCallLeadSchema.parse({
    source_company: "BestRelocation Inbounds",
    phone_number: "5555551212",
    first_name: "Jane",
    last_name: "Caller",
  });

  assert.equal(parsed.first_name, "Jane");
  assert.equal(parsed.last_name, "Caller");
});

test("createCallLeadSchema accepts Best Relocation Inbounds webhook payload", () => {
  const parsed = createCallLeadSchema.parse({
    source_company: "Best Relocation Inbounds",
    phone_number: "5555551212",
    pickup_zip: "10001",
    delivery_zip: "33101",
    first_name: "Jane",
    last_name: "Customer",
    email: "JANE.CUSTOMER@EXAMPLE.COM",
  });

  assert.equal(parsed.source_company, "Best Relocation Inbounds");
  assert.equal(parsed.phone_number, "5555551212");
  assert.equal(parsed.pickup_zip, "10001");
  assert.equal(parsed.delivery_zip, "33101");
  assert.equal(parsed.email, "jane.customer@example.com");
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

test("BookedLead model validates leadless referral bookings", async () => {
  const booking = new BookedLead({
    book_date: new Date("2026-05-21"),
    job_no: "REF-100",
    customer_name: "Jane Referral",
    agent_allocations: [
      {
        agent: "507f1f77bcf86cd799439012",
        agent_name_snapshot: "JOSH",
        binder_amount: 900,
      },
    ],
    total_binder_amount: 900,
    deposit_amount: 900,
    merchant: "Paper Check",
    source: "referral",
    is_referral_booking: true,
  });

  await assert.doesNotReject(() => booking.validate());
  assert.equal(booking.lead_ref, undefined);
  assert.equal(booking.lead_model, undefined);
});

test("BookedLead model validates leadless bookings without lead linkage", async () => {
  const booking = new BookedLead({
    book_date: new Date("2026-05-21"),
    job_no: "JOB-100",
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
    source: "Best Relocation Inbounds",
    is_leadless_booking: true,
  });

  await assert.doesNotReject(() => booking.validate());
  assert.equal(booking.lead_ref, undefined);
  assert.equal(booking.lead_model, undefined);
});

test("BookedLead model still requires lead linkage for non-referral bookings", async () => {
  const booking = new BookedLead({
    book_date: new Date("2026-05-21"),
    job_no: "JOB-100",
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

  await assert.rejects(() => booking.validate(), /lead_ref/);
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

test("FormLead model stores bad_lead enum values", async () => {
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
    bad_lead: "disconnected_number",
  });

  await assert.doesNotReject(() => lead.validate());
  assert.equal(lead.bad_lead, "disconnected_number");
});

test("FormLead model and update validation support lossless legacy bad-tab provenance", async () => {
  const parsed = updateFormLeadSchema.parse({ bad_lead: "legacy_bad_tab" });
  assert.equal(parsed.bad_lead, "legacy_bad_tab");

  const lead = new FormLead({
    source_company: "tbm_leads",
    name: "Legacy Bad Row",
    pickup_zip: "10001",
    destination_zip: "33101",
    move_size: "Studio",
    phone_number: "5551112222",
    local: "long_distance",
    cpl: 0,
    bad_lead: "legacy_bad_tab",
  });
  await lead.validate();
  assert.equal(lead.bad_lead, "legacy_bad_tab");
});

test("FormLead model rejects unknown bad_lead values", async () => {
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
    bad_lead: "wrong_reason",
  });

  await assert.rejects(() => lead.validate(), /bad_lead/);
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

test("FormLead model accepts receiver_agent provenance fields", async () => {
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
    receiver_agent_source: "best_relocation_sheet",
    receiver_agent_source_value: "Booked Deals:P5556278",
  });

  await assert.doesNotReject(() => lead.validate());
  assert.equal(lead.receiver_agent_source, "best_relocation_sheet");
  assert.equal(lead.receiver_agent_source_value, "Booked Deals:P5556278");
});

test("FormLead model rejects an unknown receiver_agent_source value", async () => {
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
    receiver_agent_source: "not_a_real_source",
  });

  await assert.rejects(() => lead.validate(), /receiver_agent_source/);
});

test("CallLead model accepts receiver_agent provenance fields", async () => {
  const lead = new CallLead({
    job_no: "P5556278",
    source_company: "best_relocation_leads",
    receiver_agent_source: "best_relocation_sheet",
    receiver_agent_source_value: "Booked Deals:P5556278",
  });

  await assert.doesNotReject(() => lead.validate());
  assert.equal(lead.receiver_agent_source, "best_relocation_sheet");
});

test("updateFormLeadSchema accepts receiver_agent linking fields", () => {
  const parsed = updateFormLeadSchema.parse({
    receiver_agent: "507f1f77bcf86cd799439011",
    receiver_agent_source: "manual",
    receiver_agent_source_value: "Nick",
  });

  assert.equal(parsed.receiver_agent, "507f1f77bcf86cd799439011");
  assert.equal(parsed.receiver_agent_source, "manual");
});

test("updateCallLeadSchema accepts receiver_agent linking fields", () => {
  const parsed = updateCallLeadSchema.parse({
    receiver_agent: "507f1f77bcf86cd799439011",
    receiver_agent_source: "extension_crm_username_match",
  });

  assert.equal(parsed.receiver_agent, "507f1f77bcf86cd799439011");
  assert.equal(parsed.receiver_agent_source, "extension_crm_username_match");
});

test("searchFormLeadsSchema accepts typo emails as plain strings", () => {
  const parsed = searchFormLeadsSchema.parse({
    phone_number: "+14322750467",
    email: " dupemail.com ",
  });

  assert.equal(parsed.phone_number, "+14322750467");
  assert.equal(parsed.email, "dupemail.com");
  assert.equal(parsed.include_duplicates, false);
});

test("searchFormLeadsSchema accepts include_duplicates to search quarantined leads", () => {
  const parsed = searchFormLeadsSchema.parse({
    phone_number: "3525851751",
    include_duplicates: true,
  });

  assert.equal(parsed.include_duplicates, true);
});

test("resolveGranotFormLeadSchema keeps provider refs and requires a Granot source", () => {
  const parsed = resolveGranotFormLeadSchema.parse({
    ref_no: " Mob_t3ePdBDVFn ",
    phone_number: " 5551234567 ",
    email: " lead@example.com ",
    name: " Jane Customer ",
    source_label: " Top10 Forms ",
    prior: "5",
  });

  assert.equal(parsed.ref_no, "Mob_t3ePdBDVFn");
  assert.equal(parsed.source_label, "Top10 Forms");
  assert.equal(parsed.name, "Jane Customer");
});

test("granotFormLeadSyncSchema separates the patch from its source precondition", () => {
  const parsed = granotFormLeadSyncSchema.parse({
    patch: { quoted: true, cubic_feet: 300 },
    expected_source_company: "top10_leads",
    expected_snapshot: {
      quoted: false,
      cubic_feet: 200,
      pickup_city: null,
      pickup_zip: null,
      pickup_state: "not_found",
      delivery_city: null,
      destination_zip: null,
      delivery_state: "not_found",
      receiver_agent: null,
    },
  });
  assert.deepEqual(parsed.patch, { quoted: true, cubic_feet: 300 });
  assert.equal(parsed.expected_source_company, "top10_leads");
  assert.throws(() =>
    granotFormLeadSyncSchema.parse({
      patch: { quoted: true, source_company: "tbm_leads" },
      expected_source_company: "top10_leads",
    }),
  );
  assert.throws(() =>
    granotFormLeadSyncSchema.parse({
      patch: {
        receiver_agent_source: "extension_crm_username_match",
        receiver_agent_source_value: "MIKEM",
      },
      expected_source_company: "top10_leads",
    }),
  );
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

const FORM_CREATE_BASE = {
  source_company: "main_site",
  name: "Synthetic User",
  pickup_zip: "10001",
  destination_zip: "94105",
  move_size: "Studio",
  phone_number: "5550100100",
};

const INTERNAL_LEAD_FIELDS = [
  "ingestion_origin",
  "normalized_job_no",
  "granot_priority",
  "granot_move_size",
  "granot_service_type",
  "ingested_contact_snapshot",
  "granot_contact_snapshot",
  "ingested_move_snapshot",
  "current_contact_provenance",
  "current_move_provenance",
  "last_accepted_granot_observation",
  "granot_contact_revision",
  "last_granot_contact_change",
  "ringcentral_convergence",
  "domain_revision",
  "last_change_id",
  "last_changed_at",
  "change_history_started_at",
] as const;

test("[AC-07] [AC-10] public/admin Form create and patch reject internal lifecycle metadata", () => {
  for (const field of INTERNAL_LEAD_FIELDS) {
    assert.equal(
      createFormLeadSchema.safeParse({ ...FORM_CREATE_BASE, [field]: "x" }).success,
      false,
      `createFormLeadSchema must reject ${field}`,
    );
    assert.equal(
      updateFormLeadSchema.safeParse({ [field]: "x" }).success,
      false,
      `updateFormLeadSchema must reject ${field}`,
    );
  }
  assert.equal(
    createFormLeadSchema.safeParse({ ...FORM_CREATE_BASE, job_no: "P5556278" }).success,
    false,
  );
  assert.equal(createFormLeadSchema.safeParse({
    ...FORM_CREATE_BASE,
    move_size: undefined,
  }).success, false);
});

test("[AC-12] public/admin Call create and patch reject internal lifecycle metadata", () => {
  const callBase = { phone_number: "5550100101" };
  for (const field of INTERNAL_LEAD_FIELDS) {
    assert.equal(
      createCallLeadSchema.safeParse({ ...callBase, [field]: "x" }).success,
      false,
      `createCallLeadSchema must reject ${field}`,
    );
    assert.equal(
      updateCallLeadSchema.safeParse({ [field]: "x" }).success,
      false,
      `updateCallLeadSchema must reject ${field}`,
    );
  }
  assert.equal(
    createCallLeadSchema.safeParse({ ...callBase, quoted: true }).success,
    false,
  );
});

test("[AC-07] ordinary Form create still requires move_size; ordinary Call still requires phone or job_no", () => {
  const { move_size: _moveSize, ...withoutMoveSize } = FORM_CREATE_BASE;
  assert.equal(createFormLeadSchema.safeParse(withoutMoveSize).success, false);
  assert.equal(createCallLeadSchema.safeParse({ name: "Synthetic" }).success, false);
  assert.equal(
    createCallLeadSchema.parse({ phone_number: "5550100101" }).phone_number,
    "5550100101",
  );
});
