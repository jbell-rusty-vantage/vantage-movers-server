import assert from "node:assert/strict";
import test from "node:test";
import {
  createBookedLeadFromSourceSchema,
  createReferralBookingSchema,
  createLeadlessBookingSchema,
  createCallLeadSchema,
  createFormLeadSchema,
  granotFormLeadSyncSchema,
  updateCallLeadSchema,
  updateFormLeadSchema,
} from "./v1.validation";
import { BookedLead } from "../models/BookedLead";
import { FormLead } from "../models/FormLead";

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

test("createBookedLeadFromSourceSchema accepts CallLead booking with only phone on Best Relocation import", () => {
  const parsed = createBookedLeadFromSourceSchema.parse({
    lead_type: "CallLead",
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
  assert.equal(parsed.call_job_no, undefined);
  assert.equal(parsed.call_phone_number, "(240) 555-0199");
});

test("createBookedLeadFromSourceSchema rejects Owner Call Lead booking with only phone", () => {
  const parsed = createBookedLeadFromSourceSchema.safeParse({
    lead_type: "CallLead",
    call_phone_number: "(240) 555-0199",
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

test("Call Lead writes reject client-supplied lifecycle and billing evidence", () => {
  const qualification = {
    ingestion_source: "webhook",
    qualification_reason: "call_log_inbound_target_elapsed_at_least_120s",
    call_log_id: "synthetic-final-call",
    duration_seconds: 120,
  };
  const ordinaryPatch = { no_sync: true };
  assert.equal(updateCallLeadSchema.safeParse(ordinaryPatch).success, true);
  for (const field of ["ringcentral", "external_call_admission"]) {
    const patch = updateCallLeadSchema.safeParse({ ...ordinaryPatch, [field]: qualification });
    assert.equal(patch.success, false, field);
    assert.ok(patch.error?.issues.some(issue =>
      issue.code === "unrecognized_keys" && issue.keys.includes(field),
    ), `public patches cannot supply ${field}`);
  }
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
