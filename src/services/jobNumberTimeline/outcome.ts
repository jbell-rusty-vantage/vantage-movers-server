import type { EnhancedJobTimelineEvent } from "./types.js";
import type {
  JobTimelineOutcome,
  JobTimelinePage,
  JobTimelineStage,
  StageAssessment,
  StageAssessmentState,
} from "./types.js";

export const STAGE_REASON = {
  LEAD_RECORDED: "LEAD_RECORDED",
  LEAD_UNRESOLVED: "LEAD_UNRESOLVED",
  TEXT_DELIVERED: "TEXT_DELIVERED",
  TEXT_POLICY_SKIP: "TEXT_POLICY_SKIP",
  TEXT_NOT_RECORDED: "TEXT_NOT_RECORDED",
  TEXT_FAILED: "TEXT_FAILED",
  TEXT_PENDING: "TEXT_PENDING",
  JOB_NUMBER_KNOWN: "JOB_NUMBER_KNOWN",
  JOB_NUMBER_NOT_RECORDED: "JOB_NUMBER_NOT_RECORDED",
  GRANOT_EVIDENCE_EVALUATED: "GRANOT_EVIDENCE_EVALUATED",
  GRANOT_PROCESSING_NOT_STARTED: "GRANOT_PROCESSING_NOT_STARTED",
  PROCESSING_EVIDENCE_GAP: "PROCESSING_EVIDENCE_GAP",
  BOOKING_OFFICIAL: "BOOKING_OFFICIAL",
  BOOKING_INTAKE_OPEN: "BOOKING_INTAKE_OPEN",
  BOOKING_RESOLVED_WITHOUT_FACT: "BOOKING_RESOLVED_WITHOUT_FACT",
  BOOKING_NOT_STARTED: "BOOKING_NOT_STARTED",
  CANCELLATION_OFFICIAL: "CANCELLATION_OFFICIAL",
  CANCELLATION_INTAKE_OPEN: "CANCELLATION_INTAKE_OPEN",
  CANCELLATION_RESOLVED_WITHOUT_FACT: "CANCELLATION_RESOLVED_WITHOUT_FACT",
  CANCELLATION_NOT_STARTED: "CANCELLATION_NOT_STARTED",
  GOOGLE_DESTINATION_UNVERIFIED: "GOOGLE_DESTINATION_UNVERIFIED",
} as const;

const SUCCESSFUL_TEXT = new Set(["accepted", "sent", "delivered"]);
const PENDING_TEXT = new Set(["scheduled", "accepted"]);
const FAILED_TEXT = new Set(["failed", "undelivered"]);
const POLICY_SKIP_PATTERN = /consent|policy|messaging_disabled|not_attested|outbound_sms|quiet_hours|country_not_allowed|gate/i;

export const OUTCOME_HEADLINE: Record<JobTimelineOutcome, string> = {
  lead_active: "Lead recorded",
  booking_intake_open: "Booking intake open",
  booked: "Booked",
  cancellation_intake_open: "Cancellation intake open",
  cancelled: "Cancelled",
  contradictory: "Contradictory official state",
  unknown: "Outcome unknown",
};

function eventsOf(events: EnhancedJobTimelineEvent[], kind: EnhancedJobTimelineEvent["kind"]): EnhancedJobTimelineEvent[] {
  return events.filter((event) => event.kind === kind);
}

function idsOf(events: EnhancedJobTimelineEvent[]): string[] {
  return events.map((event) => event.id);
}

function firstClock(events: EnhancedJobTimelineEvent[]): string | undefined {
  return events[0]?.event_at;
}

export function officialFactsContradict(events: EnhancedJobTimelineEvent[]): boolean {
  const bookings = eventsOf(events, "official_booking");
  const cancellations = eventsOf(events, "official_cancellation");
  if (cancellations.length === 0) return false;
  if (bookings.length === 0) return true;
  const bookingAt = firstClock(bookings);
  const cancellationAt = firstClock(cancellations);
  return Boolean(bookingAt && cancellationAt && cancellationAt < bookingAt);
}

export function evaluateCurrentOutcome(input: {
  coverage: JobTimelinePage["coverage"];
  events: EnhancedJobTimelineEvent[];
}): JobTimelineOutcome {
  const officialBooking = input.coverage.official_booking;
  const officialCancellation = input.coverage.official_cancellation;
  const openCancellationIntake = input.coverage.cancellation_intake === "open";
  const openBookingIntake = input.coverage.booking_intake === "open";
  const leadResolved = input.coverage.lead === "resolved";

  if (officialFactsContradict(input.events)) {
    return "contradictory";
  }
  if (officialCancellation && officialBooking) {
    return "cancelled";
  }
  if (openCancellationIntake && officialBooking) {
    return "cancellation_intake_open";
  }
  if (officialBooking) {
    return "booked";
  }
  if (openBookingIntake) {
    return "booking_intake_open";
  }
  if (leadResolved) {
    return "lead_active";
  }
  return "unknown";
}

export function outcomeHeadline(outcome: JobTimelineOutcome): string {
  return OUTCOME_HEADLINE[outcome];
}

export function isPolicySkipMessage(event: EnhancedJobTimelineEvent): boolean {
  if (event.kind !== "lead_message") return false;
  const status = String(event.data.status ?? "");
  const skipReason = String(event.data.skip_reason ?? "");
  if (status === "skipped" && POLICY_SKIP_PATTERN.test(skipReason)) return true;
  if (POLICY_SKIP_PATTERN.test(skipReason) && !SUCCESSFUL_TEXT.has(status)) return true;
  return false;
}

function assessOrigin(input: {
  coverage: JobTimelinePage["coverage"];
  events: EnhancedJobTimelineEvent[];
}): StageAssessment {
  const event_ids = idsOf(input.events.filter((event) => event.stage === "origin"));
  if (input.coverage.lead === "resolved") {
    return {
      stage: "origin",
      state: "complete",
      label: "Lead recorded",
      reason_code: STAGE_REASON.LEAD_RECORDED,
      event_ids,
    };
  }
  return {
    stage: "origin",
    state: "attention",
    label: "Lead unresolved",
    reason_code: STAGE_REASON.LEAD_UNRESOLVED,
    event_ids,
  };
}

function assessEngagement(events: EnhancedJobTimelineEvent[]): StageAssessment {
  const messages = eventsOf(events, "lead_message");
  const event_ids = idsOf(messages);
  if (messages.some((event) => SUCCESSFUL_TEXT.has(String(event.data.status ?? "")))) {
    return {
      stage: "engagement",
      state: "complete",
      label: "Text delivered",
      reason_code: STAGE_REASON.TEXT_DELIVERED,
      event_ids,
    };
  }
  if (messages.some((event) => isPolicySkipMessage(event))) {
    return {
      stage: "engagement",
      state: "not_applicable",
      label: "Text skipped",
      reason_code: STAGE_REASON.TEXT_POLICY_SKIP,
      event_ids,
    };
  }
  if (messages.some((event) => FAILED_TEXT.has(String(event.data.status ?? "")))) {
    return {
      stage: "engagement",
      state: "attention",
      label: "Text failed",
      reason_code: STAGE_REASON.TEXT_FAILED,
      event_ids,
    };
  }
  if (messages.some((event) => PENDING_TEXT.has(String(event.data.status ?? "")))) {
    return {
      stage: "engagement",
      state: "active",
      label: "Text pending",
      reason_code: STAGE_REASON.TEXT_PENDING,
      event_ids,
    };
  }
  return {
    stage: "engagement",
    state: "not_started",
    label: "No text recorded",
    reason_code: STAGE_REASON.TEXT_NOT_RECORDED,
    event_ids,
  };
}

function assessQualification(events: EnhancedJobTimelineEvent[]): StageAssessment {
  const acquired = eventsOf(events, "job_number_acquired");
  const event_ids = idsOf(events.filter((event) => event.stage === "qualification"));
  if (acquired.length > 0) {
    return {
      stage: "qualification",
      state: "complete",
      label: "Job Number known",
      reason_code: STAGE_REASON.JOB_NUMBER_KNOWN,
      event_ids,
    };
  }
  return {
    stage: "qualification",
    state: "not_started",
    label: "Job Number not yet recorded",
    reason_code: STAGE_REASON.JOB_NUMBER_NOT_RECORDED,
    event_ids,
  };
}

function assessProcessing(input: {
  events: EnhancedJobTimelineEvent[];
  processingGap: boolean;
}): StageAssessment {
  const event_ids = idsOf(input.events.filter((event) => event.stage === "processing"));
  if (input.processingGap) {
    return {
      stage: "processing",
      state: "attention",
      label: "Granot evidence incomplete",
      reason_code: STAGE_REASON.PROCESSING_EVIDENCE_GAP,
      event_ids,
    };
  }
  if (event_ids.length > 0) {
    return {
      stage: "processing",
      state: "complete",
      label: "Granot evidence evaluated",
      reason_code: STAGE_REASON.GRANOT_EVIDENCE_EVALUATED,
      event_ids,
    };
  }
  return {
    stage: "processing",
    state: "not_started",
    label: "No Granot processing",
    reason_code: STAGE_REASON.GRANOT_PROCESSING_NOT_STARTED,
    event_ids,
  };
}

function assessBooking(coverage: JobTimelinePage["coverage"], events: EnhancedJobTimelineEvent[]): StageAssessment {
  const event_ids = idsOf(events.filter((event) => event.stage === "booking"));
  if (coverage.official_booking) {
    return {
      stage: "booking",
      state: "complete",
      label: "Booked",
      reason_code: STAGE_REASON.BOOKING_OFFICIAL,
      event_ids,
    };
  }
  if (coverage.booking_intake === "open") {
    return {
      stage: "booking",
      state: "active",
      label: "Booking intake open",
      reason_code: STAGE_REASON.BOOKING_INTAKE_OPEN,
      event_ids,
    };
  }
  if (coverage.booking_intake === "resolved") {
    return {
      stage: "booking",
      state: "attention",
      label: "Booking intake resolved without official Booking",
      reason_code: STAGE_REASON.BOOKING_RESOLVED_WITHOUT_FACT,
      event_ids,
    };
  }
  return {
    stage: "booking",
    state: "not_started",
    label: "Not yet booked",
    reason_code: STAGE_REASON.BOOKING_NOT_STARTED,
    event_ids,
  };
}

function assessCancellation(coverage: JobTimelinePage["coverage"], events: EnhancedJobTimelineEvent[]): StageAssessment {
  const event_ids = idsOf(events.filter((event) => event.stage === "cancellation"));
  if (coverage.official_cancellation) {
    return {
      stage: "cancellation",
      state: "complete",
      label: "Cancelled",
      reason_code: STAGE_REASON.CANCELLATION_OFFICIAL,
      event_ids,
    };
  }
  if (coverage.cancellation_intake === "open") {
    return {
      stage: "cancellation",
      state: "active",
      label: "Cancellation intake open",
      reason_code: STAGE_REASON.CANCELLATION_INTAKE_OPEN,
      event_ids,
    };
  }
  if (coverage.cancellation_intake === "resolved") {
    return {
      stage: "cancellation",
      state: "attention",
      label: "Cancellation intake resolved without official Cancellation",
      reason_code: STAGE_REASON.CANCELLATION_RESOLVED_WITHOUT_FACT,
      event_ids,
    };
  }
  return {
    stage: "cancellation",
    state: "not_started",
    label: "No cancellation activity",
    reason_code: STAGE_REASON.CANCELLATION_NOT_STARTED,
    event_ids,
  };
}

function assessDelivery(events: EnhancedJobTimelineEvent[]): StageAssessment {
  return {
    stage: "delivery",
    state: "unverifiable",
    label: "Google not verified",
    reason_code: STAGE_REASON.GOOGLE_DESTINATION_UNVERIFIED,
    event_ids: idsOf(eventsOf(events, "sheet_sync")),
  };
}

export function assessStages(input: {
  coverage: JobTimelinePage["coverage"];
  events: EnhancedJobTimelineEvent[];
  processingGap?: boolean;
}): StageAssessment[] {
  const stages: Array<[JobTimelineStage, StageAssessment]> = [
    ["origin", assessOrigin(input)],
    ["engagement", assessEngagement(input.events)],
    ["qualification", assessQualification(input.events)],
    ["processing", assessProcessing({ events: input.events, processingGap: Boolean(input.processingGap) })],
    ["booking", assessBooking(input.coverage, input.events)],
    ["cancellation", assessCancellation(input.coverage, input.events)],
    ["delivery", assessDelivery(input.events)],
  ];
  return stages.map(([, assessment]) => assessment);
}

export function stageState(assessments: StageAssessment[], stage: JobTimelineStage): StageAssessmentState | undefined {
  return assessments.find((row) => row.stage === stage)?.state;
}
