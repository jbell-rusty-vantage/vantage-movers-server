import type { LeadModel } from "./types";

export const LEADLESS_CONFIRM_OWNER_NOTICE =
  "Booking saved to Master Booked. No stored lead was attached. You can connect a lead later from Bookings.";

export const HIGH_CONFIDENCE_BOOKING_MATCH_METHODS = new Set<string>([
  "granot_record_link",
  "form_ref_no_exact",
  "form_mongo_id_compatibility",
  "form_job_no_exact",
  "call_job_no_exact",
  "booking_job_no_exact",
]);

export type ConfirmSelectedLead = {
  lead_model: LeadModel;
  lead_id: string;
};

export type ConfirmSuggestedLead = {
  lead_ref: { model: string; id: unknown };
  confidence: "high" | "medium";
  match_method: string;
};

export type ConfirmAttachmentResolution =
  | { kind: "attach"; selected_lead: ConfirmSelectedLead; source: "owner" | "auto" }
  | { kind: "leadless" };

/**
 * Server-owned Confirm attachment. Owner selection always wins. Unique high
 * auto-attaches. Medium, missing, or ambiguous high becomes Leadless.
 */
export function resolveConfirmAttachment(input: {
  selected_lead?: ConfirmSelectedLead;
  suggested_lead?: ConfirmSuggestedLead;
}): ConfirmAttachmentResolution {
  if (input.selected_lead) {
    return { kind: "attach", selected_lead: input.selected_lead, source: "owner" };
  }
  const suggestion = input.suggested_lead;
  if (
    suggestion &&
    suggestion.confidence === "high" &&
    HIGH_CONFIDENCE_BOOKING_MATCH_METHODS.has(suggestion.match_method)
  ) {
    const model = suggestion.lead_ref.model;
    if (model === "FormLead" || model === "CallLead") {
      return {
        kind: "attach",
        selected_lead: { lead_model: model, lead_id: String(suggestion.lead_ref.id) },
        source: "auto",
      };
    }
  }
  return { kind: "leadless" };
}

export function isGranotOfficialLeadlessBooking(booking: {
  is_leadless_booking?: boolean;
  is_referral_booking?: boolean;
  booking_origin?: string | null;
  lead_ref?: unknown;
  lead_model?: unknown;
}): boolean {
  return booking.is_leadless_booking === true
    && booking.is_referral_booking !== true
    && booking.booking_origin !== "employee_booking"
    && !booking.lead_ref
    && !booking.lead_model;
}

export function confirmSheetIntent(leadless: boolean): {
  resource: "booking_chain" | "booked_lead";
  operation: "booked_lead.create" | "granot_booking.create_leadless";
} {
  return leadless
    ? { resource: "booked_lead", operation: "granot_booking.create_leadless" }
    : { resource: "booking_chain", operation: "booked_lead.create" };
}

export function updateBookingSheetIntent(input: {
  referral: boolean;
  leadless: boolean;
}): {
  resource: "booking_chain" | "booked_lead";
  operation: "booked_lead.update" | "referral_booking.update";
} {
  if (input.referral) {
    return { resource: "booked_lead", operation: "referral_booking.update" };
  }
  if (input.leadless) {
    return { resource: "booked_lead", operation: "booked_lead.update" };
  }
  return { resource: "booking_chain", operation: "booked_lead.update" };
}
