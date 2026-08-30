import type { LeadModel } from "./types";

export type ConnectSelectedLead = {
  lead_model: LeadModel;
  lead_id: string;
};

export type ConnectBookingView = {
  cancelled?: unknown;
  is_referral_booking?: boolean;
  is_leadless_booking?: boolean;
  lead_ref?: unknown;
  lead_model?: unknown;
  domain_revision?: number;
  source?: unknown;
  employee_source_snapshot?: {
    lead_source_company?: unknown;
    source_granularity_id?: unknown;
    source_company?: unknown;
  } | null;
};

export type ConnectLeadView = {
  duplicate?: unknown;
  bad_lead?: unknown;
  cancelled?: unknown;
  booked?: unknown;
  created_on_unmatched?: unknown;
  lead_source_company?: unknown;
  source_granularity_id?: unknown;
  source_company?: unknown;
};

export type ConnectSourceAssignment = {
  lead_source_company?: string;
  source_granularity_id?: string;
  source_slug?: string;
};

export type ConnectEvaluation =
  | { kind: "already_satisfied" }
  | { kind: "connect"; in_scope: boolean }
  | {
      kind: "reject";
      code: "IDENTITY_CONFLICT" | "VALIDATION_FAILED" | "DOMAIN_REVISION_CONFLICT";
      message: string;
    };

export function isConnectableLeadlessBooking(booking: ConnectBookingView | null | undefined): boolean {
  if (!booking) return false;
  if (booking.cancelled) return false;
  if (booking.is_referral_booking === true) return false;
  return booking.is_leadless_booking === true || !booking.lead_ref;
}

export function isEligibleConnectLead(
  lead: ConnectLeadView | null | undefined,
  leadModel: LeadModel,
): boolean {
  if (!lead) return false;
  if (lead.duplicate === true) return false;
  if (leadModel === "FormLead" && lead.bad_lead != null && lead.bad_lead !== "") return false;
  if (lead.cancelled) return false;
  if (lead.booked) return false;
  if (leadModel === "CallLead" && lead.created_on_unmatched === true) return false;
  return true;
}

export function bookingSourceAssignment(
  booking: ConnectBookingView,
  linkScope?: { lead_source_company?: unknown; source_granularity_id?: unknown } | null,
): ConnectSourceAssignment {
  if (linkScope?.lead_source_company) {
    return {
      lead_source_company: String(linkScope.lead_source_company),
      ...(linkScope.source_granularity_id
        ? { source_granularity_id: String(linkScope.source_granularity_id) }
        : {}),
    };
  }
  const snapshot = booking.employee_source_snapshot;
  if (snapshot?.lead_source_company) {
    return {
      lead_source_company: String(snapshot.lead_source_company),
      ...(snapshot.source_granularity_id
        ? { source_granularity_id: String(snapshot.source_granularity_id) }
        : {}),
      ...(snapshot.source_company ? { source_slug: String(snapshot.source_company) } : {}),
    };
  }
  const slug = typeof booking.source === "string" && booking.source.trim()
    ? booking.source.trim()
    : undefined;
  return slug ? { source_slug: slug } : {};
}

export function leadMatchesBookingSource(
  lead: ConnectLeadView,
  assignment: ConnectSourceAssignment,
): boolean {
  if (assignment.lead_source_company) {
    if (String(lead.lead_source_company ?? "") !== assignment.lead_source_company) {
      return false;
    }
    if (assignment.source_granularity_id) {
      return String(lead.source_granularity_id ?? "") === assignment.source_granularity_id;
    }
    return true;
  }
  if (assignment.source_slug) {
    return String(lead.source_company ?? "").toLowerCase() === assignment.source_slug.toLowerCase();
  }
  return true;
}

export function validConnectOverride(value?: string): boolean {
  return Boolean(value && value === value.trim() && value.length >= 10 && value.length <= 500);
}

export function sameAttachedLead(
  booking: ConnectBookingView,
  selected: ConnectSelectedLead,
): boolean {
  return String(booking.lead_ref ?? "") === selected.lead_id
    && booking.lead_model === selected.lead_model;
}

export function evaluateConnectPreconditions(input: {
  booking: ConnectBookingView | null;
  expected_booking_revision: number;
  selected_lead: ConnectSelectedLead;
  lead: ConnectLeadView | null;
  lead_owned_by_other_booking: boolean;
  source_assignment?: ConnectSourceAssignment;
  out_of_scope_override_reason?: string;
}): ConnectEvaluation {
  const booking = input.booking;
  if (!booking) {
    return { kind: "reject", code: "IDENTITY_CONFLICT", message: "Booking was not found" };
  }
  if (booking.cancelled) {
    return { kind: "reject", code: "IDENTITY_CONFLICT", message: "Cancelled Bookings cannot connect a lead" };
  }
  if (booking.is_referral_booking === true) {
    return { kind: "reject", code: "IDENTITY_CONFLICT", message: "Referral Bookings stay without a stored lead" };
  }
  if (sameAttachedLead(booking, input.selected_lead)) {
    return { kind: "already_satisfied" };
  }
  if (booking.lead_ref && !sameAttachedLead(booking, input.selected_lead)) {
    return {
      kind: "reject",
      code: "IDENTITY_CONFLICT",
      message: "This Booking already has a different stored lead",
    };
  }
  if (!isConnectableLeadlessBooking(booking)) {
    return { kind: "reject", code: "IDENTITY_CONFLICT", message: "Booking is not a connectable Leadless Booking" };
  }
  if (booking.domain_revision !== input.expected_booking_revision) {
    return {
      kind: "reject",
      code: "DOMAIN_REVISION_CONFLICT",
      message: "Booking revision changed",
    };
  }
  if (!isEligibleConnectLead(input.lead, input.selected_lead.lead_model)) {
    return { kind: "reject", code: "IDENTITY_CONFLICT", message: "Selected Lead is not eligible" };
  }
  if (input.lead_owned_by_other_booking) {
    return {
      kind: "reject",
      code: "IDENTITY_CONFLICT",
      message: "Selected Lead is already attached to another Booking",
    };
  }
  const assignment = input.source_assignment ?? bookingSourceAssignment(booking);
  const inScope = leadMatchesBookingSource(input.lead!, assignment);
  if (!inScope && !validConnectOverride(input.out_of_scope_override_reason)) {
    return {
      kind: "reject",
      code: "VALIDATION_FAILED",
      message: "Out-of-scope Lead selection requires an override reason",
    };
  }
  return { kind: "connect", in_scope: inScope };
}
