export const DAILY_OPERATIONS_LANES = [
  "granot",
  "lead",
  "text",
  "intake",
  "booking",
  "cancellation",
  "sheet_sync",
  "exception",
] as const;

export type DailyOperationsLane = (typeof DAILY_OPERATIONS_LANES)[number];

export const DAILY_OPERATIONS_KINDS = [
  "form_lead.created",
  "form_lead.duplicate",
  "call_lead.created",
  "call_lead.duplicate",
  "call_lead.unmatched",
  "granot.lead_created",
  "granot.priority_updated",
  "granot.booked",
  "granot.release",
  "granot.minted",
  "granot.linked",
  "granot.observed",
  "granot.pending_match",
  "granot.unmatched",
  "intake.opened",
  "intake.refreshed",
  "text.deferred",
  "text.sent",
  "text.skipped",
  "text.failed",
  "booking.created",
  "booking.employee_pending",
  "cancellation.created",
  "sheet_sync.completed",
  "sheet_sync.failed",
  "exception.zip_missing",
  "exception.crm_failed",
  "exception.dead_letter",
  "exception.adoption_conflict",
] as const;

export type DailyOperationsKind = (typeof DAILY_OPERATIONS_KINDS)[number];

export type DailyOperationsKindDefinition = {
  lane: DailyOperationsLane;
  title: string;
  metricTouches: readonly string[];
};

export const DAILY_OPERATIONS_KIND_CATALOG = {
  "form_lead.created": {
    lane: "lead",
    title: "Form Lead created",
    metricTouches: ["leads.form", "leads.total", "hourly.leads"],
  },
  "form_lead.duplicate": {
    lane: "lead",
    title: "Duplicate Form Lead",
    metricTouches: ["leads.duplicate_form"],
  },
  "call_lead.created": {
    lane: "lead",
    title: "Call Lead created",
    metricTouches: ["leads.call", "leads.total", "hourly.leads"],
  },
  "call_lead.duplicate": {
    lane: "lead",
    title: "Duplicate Call Lead",
    metricTouches: ["leads.duplicate_call"],
  },
  "call_lead.unmatched": {
    lane: "lead",
    title: "Unmatched Call Lead",
    metricTouches: ["leads.unmatched_call"],
  },
  "granot.lead_created": {
    lane: "granot",
    title: "Granot lead created",
    metricTouches: ["webhooks.lead_created", "hourly.webhooks"],
  },
  "granot.priority_updated": {
    lane: "granot",
    title: "Granot priority updated",
    metricTouches: ["webhooks.priority_updated", "hourly.webhooks"],
  },
  "granot.booked": {
    lane: "granot",
    title: "Granot Booked",
    metricTouches: [
      "webhooks.booking_status_changed",
      "webhooks.booked",
      "hourly.webhooks",
    ],
  },
  "granot.release": {
    lane: "granot",
    title: "Granot Release",
    metricTouches: [
      "webhooks.booking_status_changed",
      "webhooks.release",
      "hourly.webhooks",
    ],
  },
  "granot.minted": {
    lane: "granot",
    title: "Created a Lead from Granot",
    metricTouches: ["decisions.minted"],
  },
  "granot.linked": {
    lane: "granot",
    title: "Linked to existing Lead",
    metricTouches: ["decisions.linked"],
  },
  "granot.observed": {
    lane: "granot",
    title: "Observing only",
    metricTouches: ["decisions.observed"],
  },
  "granot.pending_match": {
    lane: "granot",
    title: "Waiting to match",
    metricTouches: ["decisions.pending_match"],
  },
  "granot.unmatched": {
    lane: "granot",
    title: "No matching Lead",
    metricTouches: ["decisions.unmatched"],
  },
  "intake.opened": {
    lane: "intake",
    title: "Intake opened",
    metricTouches: ["intakes.opened"],
  },
  "intake.refreshed": {
    lane: "intake",
    title: "Intake refreshed",
    metricTouches: ["intakes.refreshed"],
  },
  "text.deferred": {
    lane: "text",
    title: "Text held until {time}",
    metricTouches: ["messages.deferred"],
  },
  "text.sent": {
    lane: "text",
    title: "Text sent",
    metricTouches: ["messages.successful", "hourly.messages"],
  },
  "text.skipped": {
    lane: "text",
    title: "Text skipped",
    metricTouches: ["messages.skipped"],
  },
  "text.failed": {
    lane: "text",
    title: "Text failed",
    metricTouches: ["messages.failed"],
  },
  "booking.created": {
    lane: "booking",
    title: "Booking written",
    metricTouches: ["bookings.total", "hourly.bookings"],
  },
  "booking.employee_pending": {
    lane: "booking",
    title: "Employee Booking — pending Lead",
    metricTouches: [
      "bookings.total",
      "bookings.employee_pending",
      "hourly.bookings",
    ],
  },
  "cancellation.created": {
    lane: "cancellation",
    title: "Cancellation written",
    metricTouches: ["cancellations.total", "hourly.cancellations"],
  },
  // Drain hook is out of DOP-02 (optional v1; do not hook finalizeSheetSync).
  "sheet_sync.completed": {
    lane: "sheet_sync",
    title: "Sheet Sync completed",
    metricTouches: [],
  },
  "sheet_sync.failed": {
    lane: "sheet_sync",
    title: "Sheet Sync failed",
    metricTouches: [],
  },
  "exception.zip_missing": {
    lane: "exception",
    title: "ZIP did not produce a state",
    metricTouches: ["exceptions.zip_missing"],
  },
  "exception.crm_failed": {
    lane: "exception",
    title: "CRM Posting failed",
    metricTouches: ["exceptions.crm_failed"],
  },
  "exception.dead_letter": {
    lane: "exception",
    title: "Granot dead letter",
    metricTouches: ["exceptions.dead_letter"],
  },
  "exception.adoption_conflict": {
    lane: "exception",
    title: "RingCentral adoption conflict",
    metricTouches: ["exceptions.adoption_conflict"],
  },
} as const satisfies Record<DailyOperationsKind, DailyOperationsKindDefinition>;

export type DailyOperationsKindExtras = {
  origin?: string | null;
  sourceCompany?: string | null;
  bookingKind?: string | null;
};

export function getDailyOperationsKindDefinition(
  kind: DailyOperationsKind,
): DailyOperationsKindDefinition {
  return DAILY_OPERATIONS_KIND_CATALOG[kind];
}

export function laneForKind(kind: DailyOperationsKind): DailyOperationsLane {
  return DAILY_OPERATIONS_KIND_CATALOG[kind].lane;
}

export function titleForKind(kind: DailyOperationsKind): string {
  return DAILY_OPERATIONS_KIND_CATALOG[kind].title;
}

export function defaultMetricTouches(
  kind: DailyOperationsKind,
): readonly string[] {
  return DAILY_OPERATIONS_KIND_CATALOG[kind].metricTouches;
}

/**
 * Default day increments for a kind, plus caller-specific origin / Source
 * Company / booking-kind paths. `granot.minted` never adds `leads.*`.
 */
export function buildMetricTouches(
  kind: DailyOperationsKind,
  extras: DailyOperationsKindExtras = {},
): string[] {
  const touches: string[] = [
    ...DAILY_OPERATIONS_KIND_CATALOG[kind].metricTouches,
  ];

  if (kind === "form_lead.created" || kind === "call_lead.created") {
    if (extras.origin) {
      touches.push(`origins.${extras.origin}`);
    }
    if (extras.sourceCompany) {
      const side = kind === "form_lead.created" ? "form" : "call";
      touches.push(`companies.${extras.sourceCompany}.${side}`);
      touches.push(`companies.${extras.sourceCompany}.total`);
    }
  }

  if (kind === "booking.created" && extras.bookingKind) {
    touches.push(`bookings.${extras.bookingKind}`);
  }

  return touches;
}
