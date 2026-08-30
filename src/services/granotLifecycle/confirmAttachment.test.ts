import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmSheetIntent,
  connectSheetIntent,
  isGranotOfficialLeadlessBooking,
  resolveConfirmAttachment,
  updateBookingSheetIntent,
} from "./confirmAttachment";

const highSuggestion = {
  lead_ref: { model: "FormLead" as const, id: "a".repeat(24) },
  confidence: "high" as const,
  match_method: "form_ref_no_exact",
};

const mediumSuggestion = {
  lead_ref: { model: "FormLead" as const, id: "b".repeat(24) },
  confidence: "medium" as const,
  match_method: "source_scoped_contact",
};

const ownerLead = { lead_model: "FormLead" as const, lead_id: "c".repeat(24) };

test("Owner selected_lead attaches even when the suggestion is medium", () => {
  const result = resolveConfirmAttachment({
    selected_lead: ownerLead,
    suggested_lead: mediumSuggestion,
  });
  assert.deepEqual(result, { kind: "attach", selected_lead: ownerLead, source: "owner" });
});

test("no selected_lead and a unique high suggestion auto-attaches", () => {
  const result = resolveConfirmAttachment({ suggested_lead: highSuggestion });
  assert.deepEqual(result, {
    kind: "attach",
    selected_lead: { lead_model: "FormLead", lead_id: "a".repeat(24) },
    source: "auto",
  });
});

test("no selected_lead and a medium-only suggestion stays Leadless", () => {
  assert.deepEqual(
    resolveConfirmAttachment({ suggested_lead: mediumSuggestion }),
    { kind: "leadless" },
  );
});

test("no selected_lead and no suggestion stays Leadless", () => {
  assert.deepEqual(resolveConfirmAttachment({}), { kind: "leadless" });
});

test("source_scoped_contact never auto-attaches even if confidence were high", () => {
  assert.deepEqual(
    resolveConfirmAttachment({
      suggested_lead: { ...mediumSuggestion, confidence: "high" },
    }),
    { kind: "leadless" },
  );
});

test("Sheet intents distinguish attached Confirm from Leadless Confirm and Update", () => {
  assert.deepEqual(confirmSheetIntent(false), {
    resource: "booking_chain",
    operation: "booked_lead.create",
  });
  assert.deepEqual(confirmSheetIntent(true), {
    resource: "booked_lead",
    operation: "granot_booking.create_leadless",
  });
  assert.deepEqual(updateBookingSheetIntent({ referral: false, leadless: false }), {
    resource: "booking_chain",
    operation: "booked_lead.update",
  });
  assert.deepEqual(updateBookingSheetIntent({ referral: false, leadless: true }), {
    resource: "booked_lead",
    operation: "booked_lead.update",
  });
  assert.deepEqual(updateBookingSheetIntent({ referral: true, leadless: false }), {
    resource: "booked_lead",
    operation: "referral_booking.update",
  });
  assert.deepEqual(connectSheetIntent(), {
    resource: "booking_chain",
    operation: "booked_lead.connect_lead",
  });
});

test("Referral is not a Granot official Leadless Booking", () => {
  assert.equal(
    isGranotOfficialLeadlessBooking({
      is_leadless_booking: false,
      is_referral_booking: true,
    }),
    false,
  );
  assert.equal(
    isGranotOfficialLeadlessBooking({
      is_leadless_booking: true,
      is_referral_booking: false,
      booking_origin: "employee_booking",
    }),
    false,
  );
  assert.equal(
    isGranotOfficialLeadlessBooking({
      is_leadless_booking: true,
      is_referral_booking: false,
    }),
    true,
  );
});
