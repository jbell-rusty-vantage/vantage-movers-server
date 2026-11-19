import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateConnectPreconditions,
  isEligibleConnectLead,
} from "./connectLead";

const leadId = "a".repeat(24);
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
