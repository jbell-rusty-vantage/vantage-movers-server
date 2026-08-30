import assert from "node:assert/strict";
import test from "node:test";
import { CONNECT_LEAD_OWNER_NOTICE, connectSheetIntent } from "./confirmAttachment";
import {
  bookingSourceAssignment,
  evaluateConnectPreconditions,
  isConnectableLeadlessBooking,
  isEligibleConnectLead,
  leadMatchesBookingSource,
} from "./connectLead";

const leadId = "a".repeat(24);
const otherLeadId = "b".repeat(24);
const selected = { lead_model: "FormLead" as const, lead_id: leadId };
const companyId = "c".repeat(24);
const granularityId = "d".repeat(24);

const leadlessBooking = {
  is_leadless_booking: true,
  is_referral_booking: false,
  domain_revision: 2,
  source: "best-relocation",
};

const eligibleLead = {
  duplicate: false,
  bad_lead: null,
  source_company: "best-relocation",
  lead_source_company: companyId,
  source_granularity_id: granularityId,
};

test("Connect sheet intent is booking_chain / booked_lead.connect_lead", () => {
  assert.deepEqual(connectSheetIntent(), {
    resource: "booking_chain",
    operation: "booked_lead.connect_lead",
  });
  assert.doesNotMatch(CONNECT_LEAD_OWNER_NOTICE, /synced|already updated|already visible/i);
  assert.match(CONNECT_LEAD_OWNER_NOTICE, /Master Leads/);
  assert.match(CONNECT_LEAD_OWNER_NOTICE, /Master Booked/);
});

test("Leadless non-referral non-cancelled Bookings are connectable", () => {
  assert.equal(isConnectableLeadlessBooking(leadlessBooking), true);
  assert.equal(isConnectableLeadlessBooking({ lead_ref: undefined, is_referral_booking: false }), true);
  assert.equal(isConnectableLeadlessBooking({
    is_leadless_booking: true,
    is_referral_booking: true,
  }), false);
  assert.equal(isConnectableLeadlessBooking({
    is_leadless_booking: true,
    cancelled: new Date("2026-08-01"),
  }), false);
  assert.equal(isConnectableLeadlessBooking({
    is_leadless_booking: false,
    lead_ref: leadId,
    lead_model: "FormLead",
  }), false);
});

test("Eligible Connect Leads exclude Duplicate, Bad, cancelled, booked, and unmatched Call Leads", () => {
  assert.equal(isEligibleConnectLead(eligibleLead, "FormLead"), true);
  assert.equal(isEligibleConnectLead({ ...eligibleLead, duplicate: true }, "FormLead"), false);
  assert.equal(isEligibleConnectLead({ ...eligibleLead, bad_lead: "spam" }, "FormLead"), false);
  assert.equal(isEligibleConnectLead({ ...eligibleLead, cancelled: new Date() }, "FormLead"), false);
  assert.equal(isEligibleConnectLead({ ...eligibleLead, booked: leadId }, "FormLead"), false);
  assert.equal(isEligibleConnectLead({ created_on_unmatched: true }, "CallLead"), false);
  assert.equal(isEligibleConnectLead({ created_on_unmatched: false }, "CallLead"), true);
  assert.equal(isEligibleConnectLead(null, "FormLead"), false);
});

test("Source assignment prefers Record Link scope, then employee snapshot, then booking source slug", () => {
  assert.deepEqual(
    bookingSourceAssignment(
      { source: "ignored", employee_source_snapshot: { lead_source_company: "x", source_granularity_id: "y" } },
      { lead_source_company: companyId, source_granularity_id: granularityId },
    ),
    { lead_source_company: companyId, source_granularity_id: granularityId },
  );
  assert.deepEqual(
    bookingSourceAssignment({
      source: "slug",
      employee_source_snapshot: { lead_source_company: companyId, source_company: "snap" },
    }),
    { lead_source_company: companyId, source_slug: "snap" },
  );
  assert.deepEqual(bookingSourceAssignment({ source: "best-relocation" }), {
    source_slug: "best-relocation",
  });
});

test("Lead matches booking source on company id, granularity, or slug", () => {
  assert.equal(
    leadMatchesBookingSource(eligibleLead, {
      lead_source_company: companyId,
      source_granularity_id: granularityId,
    }),
    true,
  );
  assert.equal(
    leadMatchesBookingSource(eligibleLead, {
      lead_source_company: companyId,
      source_granularity_id: "e".repeat(24),
    }),
    false,
  );
  assert.equal(leadMatchesBookingSource(eligibleLead, { source_slug: "best-relocation" }), true);
  assert.equal(leadMatchesBookingSource(eligibleLead, { source_slug: "other" }), false);
});

test("evaluateConnectPreconditions attaches an eligible unbooked Lead", () => {
  assert.deepEqual(
    evaluateConnectPreconditions({
      booking: leadlessBooking,
      expected_booking_revision: 2,
      selected_lead: selected,
      lead: eligibleLead,
      lead_owned_by_other_booking: false,
    }),
    { kind: "connect", in_scope: true },
  );
});

test("already_satisfied when the Booking already has this exact Lead", () => {
  assert.deepEqual(
    evaluateConnectPreconditions({
      booking: {
        ...leadlessBooking,
        is_leadless_booking: false,
        lead_ref: leadId,
        lead_model: "FormLead",
      },
      expected_booking_revision: 2,
      selected_lead: selected,
      lead: { ...eligibleLead, booked: leadId },
      lead_owned_by_other_booking: false,
    }),
    { kind: "already_satisfied" },
  );
});

test("IDENTITY_CONFLICT when the Booking already has a different Lead", () => {
  const result = evaluateConnectPreconditions({
    booking: {
      is_leadless_booking: false,
      lead_ref: otherLeadId,
      lead_model: "FormLead",
      domain_revision: 2,
    },
    expected_booking_revision: 2,
    selected_lead: selected,
    lead: eligibleLead,
    lead_owned_by_other_booking: false,
  });
  assert.equal(result.kind, "reject");
  if (result.kind === "reject") assert.equal(result.code, "IDENTITY_CONFLICT");
});

test("IDENTITY_CONFLICT when another Booking already owns the Lead", () => {
  const result = evaluateConnectPreconditions({
    booking: leadlessBooking,
    expected_booking_revision: 2,
    selected_lead: selected,
    lead: eligibleLead,
    lead_owned_by_other_booking: true,
  });
  assert.equal(result.kind, "reject");
  if (result.kind === "reject") {
    assert.equal(result.code, "IDENTITY_CONFLICT");
    assert.match(result.message, /another Booking/);
  }
});

test("Referral, cancelled, Duplicate, Bad, and unmatched Call Leads are rejected", () => {
  const referral = evaluateConnectPreconditions({
    booking: { ...leadlessBooking, is_referral_booking: true },
    expected_booking_revision: 2,
    selected_lead: selected,
    lead: eligibleLead,
    lead_owned_by_other_booking: false,
  });
  assert.equal(referral.kind, "reject");

  const cancelled = evaluateConnectPreconditions({
    booking: { ...leadlessBooking, cancelled: new Date() },
    expected_booking_revision: 2,
    selected_lead: selected,
    lead: eligibleLead,
    lead_owned_by_other_booking: false,
  });
  assert.equal(cancelled.kind, "reject");

  for (const lead of [
    { ...eligibleLead, duplicate: true },
    { ...eligibleLead, bad_lead: "spam" },
  ]) {
    const result = evaluateConnectPreconditions({
      booking: leadlessBooking,
      expected_booking_revision: 2,
      selected_lead: selected,
      lead,
      lead_owned_by_other_booking: false,
    });
    assert.equal(result.kind, "reject");
    if (result.kind === "reject") assert.equal(result.code, "IDENTITY_CONFLICT");
  }

  const unmatched = evaluateConnectPreconditions({
    booking: leadlessBooking,
    expected_booking_revision: 2,
    selected_lead: { lead_model: "CallLead", lead_id: leadId },
    lead: { created_on_unmatched: true },
    lead_owned_by_other_booking: false,
  });
  assert.equal(unmatched.kind, "reject");
});

test("stale booking revision fails closed", () => {
  const result = evaluateConnectPreconditions({
    booking: leadlessBooking,
    expected_booking_revision: 1,
    selected_lead: selected,
    lead: eligibleLead,
    lead_owned_by_other_booking: false,
  });
  assert.equal(result.kind, "reject");
  if (result.kind === "reject") assert.equal(result.code, "DOMAIN_REVISION_CONFLICT");
});

test("out-of-scope without override is rejected; with reason it connects", () => {
  const assignment = { lead_source_company: "f".repeat(24), source_granularity_id: granularityId };
  const missing = evaluateConnectPreconditions({
    booking: leadlessBooking,
    expected_booking_revision: 2,
    selected_lead: selected,
    lead: eligibleLead,
    lead_owned_by_other_booking: false,
    source_assignment: assignment,
  });
  assert.equal(missing.kind, "reject");
  if (missing.kind === "reject") assert.equal(missing.code, "VALIDATION_FAILED");

  const withReason = evaluateConnectPreconditions({
    booking: leadlessBooking,
    expected_booking_revision: 2,
    selected_lead: selected,
    lead: eligibleLead,
    lead_owned_by_other_booking: false,
    source_assignment: assignment,
    out_of_scope_override_reason: "Owner confirmed this is the same household.",
  });
  assert.deepEqual(withReason, { kind: "connect", in_scope: false });
});
