import { GRANOT_JOB, T0, T1, T2, T3, WP_JOB, granotRows, wordpressRows } from "./fixtures.js";
import { emptyJobTimelineRows, type JobTimelineRows } from "./rows.js";
import type { JobTimelineOutcome, TimelineAttentionCode, TimelineLimitationCode } from "./types.js";

export const RC_JOB = "7003003";
export const BOOKED_JOB = "6004004";
export const T_RECORDED = "2026-03-01T10:45:00.000Z";

export const ALWAYS_LIMITATION_CODES: TimelineLimitationCode[] = [
  "MULTI_QUERY_READ",
  "MOVE_COMPLETION_UNAVAILABLE",
  "GOOGLE_DESTINATION_UNVERIFIED",
];

export function goldenWordpressRows(): JobTimelineRows {
  return wordpressRows();
}

export function goldenGranotRows(): JobTimelineRows {
  const rows = granotRows();
  return {
    ...rows,
    entity_changes: [
      ...rows.entity_changes ?? [],
      {
        id: "chg-gr-priority",
        entity_model: "FormLead",
        entity_id: "lead-gr-1",
        command_name: "synchronizeLeadFromGranot",
        applied_at: T2,
        changed_paths: ["granot_priority"],
      },
    ],
    observation_receipts: [
      {
        id: "rcpt-gr-1",
        captured_at: T0,
        createdAt: T_RECORDED,
        route_event_class: "lead_created",
        observation_channel: "granot_webhook",
        processing_state: "completed",
      },
    ],
    sheet_sync_jobs: [
      {
        id: "sheet-gr-create",
        entity_id: "lead-gr-1",
        entity_model: "FormLead",
        resource: "source_lead",
        operation: "form_lead.create",
        status: "synced",
        attempts: 1,
        created_by: "processor",
        createdAt: T0,
        updatedAt: T0,
        target_hints: ["Leads"],
      },
    ],
  };
}

export function goldenRingCentralRows(): JobTimelineRows {
  return {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-rc-1",
        captured_at: T2,
        normalized_job_no: RC_JOB,
        job_no_snapshot: RC_JOB,
        route_event_class: "priority_updated",
        normalization_result: "usable",
      },
    ],
    decisions: [
      {
        id: "dec-rc-1",
        observation_id: "obs-rc-1",
        attempt: 1,
        decided_at: T2,
        outcome: "applied",
        reason_code: "lead_synchronized",
        target: { model: "CallLead", id: "lead-rc-1" },
      },
    ],
    leads: [
      {
        id: "lead-rc-1",
        model: "CallLead",
        ingestion_origin: "ringcentral",
        timestamp: T0,
        createdAt: T0,
        job_no: RC_JOB,
        normalized_job_no: RC_JOB,
      },
    ],
    entity_changes: [
      {
        id: "chg-rc-create",
        entity_model: "CallLead",
        entity_id: "lead-rc-1",
        command_name: "createCallLead",
        applied_at: T0,
        changed_paths: ["job_no", "normalized_job_no"],
      },
    ],
    processed_calls: [
      {
        id: "pc-rc-1",
        callLeadId: "lead-rc-1",
        status: "lead_created",
        qualificationReason: "qualified_inbound",
        firstProcessedAt: T0,
        updatedAt: T_RECORDED,
        ingestionSource: "call_log_sync",
        duplicate: false,
      },
    ],
    call_log_cursor: {
      lastSyncTo: T3,
      lastSyncFrom: T0,
      lastRunAt: T3,
      lastRunStatus: "success",
    },
  };
}

export function goldenBookedRows(): JobTimelineRows {
  return {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-book",
        captured_at: T2,
        normalized_job_no: BOOKED_JOB,
        job_no_snapshot: BOOKED_JOB,
        receipt_id: "rcpt-book-1",
        route_event_class: "booking_status_changed",
        booking_action_normalized: "booked",
      },
    ],
    observation_receipts: [
      {
        id: "rcpt-book-1",
        captured_at: T2,
        createdAt: T2,
        route_event_class: "booking_status_changed",
        observation_channel: "granot_webhook",
        processing_state: "completed",
      },
    ],
    decisions: [
      {
        id: "dec-book",
        observation_id: "obs-book",
        attempt: 1,
        decided_at: T2,
        outcome: "applied",
        reason_code: "booking_confirmed",
        effect_kinds: ["sheet_sync_requested"],
        target: { model: "FormLead", id: "lead-book-1" },
      },
    ],
    bookings: [
      {
        id: "booking-book-1",
        normalized_job_no: BOOKED_JOB,
        job_no_snapshot: BOOKED_JOB,
        lead_ref: "lead-book-1",
        lead_model: "FormLead",
        timestamp: T2,
        createdAt: T2,
      },
    ],
    booking_cases: [
      {
        id: "case-book-1",
        kind: "booking",
        normalized_job_no: BOOKED_JOB,
        state: "resolved",
        mode: "confirm",
        resolved_at: T2,
        evidence: [{ observation_id: "obs-book", captured_at: T2 }],
      },
    ],
    leads: [
      {
        id: "lead-book-1",
        model: "FormLead",
        ingestion_origin: "granot_lead_created",
        timestamp: T0,
        createdAt: T0,
        job_no: BOOKED_JOB,
        normalized_job_no: BOOKED_JOB,
      },
    ],
    entity_changes: [
      {
        id: "chg-book-create",
        entity_model: "FormLead",
        entity_id: "lead-book-1",
        command_name: "createLeadFromGranot",
        applied_at: T0,
        changed_paths: ["job_no", "normalized_job_no"],
      },
    ],
    sheet_sync_jobs: [
      {
        id: "sheet-book",
        entity_id: "booking-book-1",
        entity_model: "BookedLead",
        resource: "booking_chain",
        operation: "booked_lead.create",
        status: "synced",
        createdAt: T2,
        updatedAt: T2,
        target_hints: ["Booked"],
      },
    ],
  };
}

export function goldenCancelledRows(): JobTimelineRows {
  const booked = goldenBookedRows();
  return {
    ...booked,
    observations: [
      ...booked.observations ?? [],
      {
        id: "obs-cancel",
        captured_at: T3,
        normalized_job_no: BOOKED_JOB,
        receipt_id: "rcpt-cancel-1",
        route_event_class: "booking_status_changed",
        booking_action_normalized: "release",
      },
    ],
    observation_receipts: [
      ...booked.observation_receipts ?? [],
      {
        id: "rcpt-cancel-1",
        captured_at: T3,
        createdAt: T3,
        route_event_class: "booking_status_changed",
        processing_state: "completed",
      },
    ],
    release_cases: [
      {
        id: "case-cancel-1",
        kind: "release",
        normalized_job_no: BOOKED_JOB,
        state: "resolved",
        mode: "release",
        resolved_at: T3,
        evidence: [{ observation_id: "obs-cancel", captured_at: T3 }],
      },
    ],
    cancellations: [
      {
        id: "cancel-1",
        booked_lead: "booking-book-1",
        createdAt: T3,
        last_changed_at: T3,
      },
    ],
    sheet_sync_jobs: [
      ...booked.sheet_sync_jobs ?? [],
      {
        id: "sheet-cancel",
        entity_id: "cancel-1",
        entity_model: "CancelledLead",
        resource: "cancellation_chain",
        operation: "cancelled_lead.create",
        status: "synced",
        createdAt: T3,
        updatedAt: T3,
        target_hints: ["Cancelled"],
      },
    ],
  };
}

export function goldenPolicySkipRows(): JobTimelineRows {
  return {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-skip",
        captured_at: T2,
        normalized_job_no: "5005005",
        route_event_class: "lead_created",
      },
    ],
    leads: [
      {
        id: "lead-skip-1",
        model: "FormLead",
        ingestion_origin: "granot_lead_created",
        timestamp: T0,
        createdAt: T0,
        job_no: "5005005",
        normalized_job_no: "5005005",
      },
    ],
    entity_changes: [
      {
        id: "chg-skip-create",
        entity_model: "FormLead",
        entity_id: "lead-skip-1",
        command_name: "createLeadFromGranot",
        applied_at: T0,
        changed_paths: ["job_no", "normalized_job_no"],
      },
    ],
    decisions: [
      {
        id: "dec-skip",
        observation_id: "obs-skip",
        attempt: 1,
        decided_at: T0,
        outcome: "created",
        reason_code: "lead_created",
        target: { model: "FormLead", id: "lead-skip-1" },
      },
    ],
    lead_messages: [
      {
        id: "msg-skip-1",
        lead_id: "lead-skip-1",
        origin: "granot_lead_created",
        purpose: "granot_lead_created_confirmation",
        status: "skipped",
        skip_reason: "consent_not_attested",
        createdAt: T1,
      },
    ],
  };
}

export function goldenResolvedBookingWithoutFactRows(): JobTimelineRows {
  return {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-final-book",
        captured_at: T2,
        normalized_job_no: "5005006",
        route_event_class: "booking_status_changed",
        booking_action_normalized: "booked",
      },
    ],
    decisions: [
      {
        id: "dec-final-book",
        observation_id: "obs-final-book",
        attempt: 1,
        decided_at: T2,
        outcome: "applied",
        reason_code: "booking_confirmed",
        target: { model: "FormLead", id: "lead-final-book" },
      },
    ],
    booking_cases: [
      {
        id: "case-final-book",
        kind: "booking",
        normalized_job_no: "5005006",
        state: "resolved",
        mode: "create_missing_booking",
        resolved_at: T2,
        evidence: [{ observation_id: "obs-final-book", captured_at: T2 }],
      },
    ],
    leads: [
      {
        id: "lead-final-book",
        model: "FormLead",
        ingestion_origin: "granot_lead_created",
        timestamp: T0,
        createdAt: T0,
        job_no: "5005006",
        normalized_job_no: "5005006",
      },
    ],
    entity_changes: [
      {
        id: "chg-final-book",
        entity_model: "FormLead",
        entity_id: "lead-final-book",
        command_name: "createLeadFromGranot",
        applied_at: T0,
        changed_paths: ["job_no", "normalized_job_no"],
      },
    ],
  };
}

export function goldenResolvedReleaseWithoutFactRows(): JobTimelineRows {
  const booked = goldenBookedRows();
  return {
    ...booked,
    observations: [
      ...booked.observations ?? [],
      {
        id: "obs-final-rel",
        captured_at: T3,
        normalized_job_no: BOOKED_JOB,
        route_event_class: "booking_status_changed",
        booking_action_normalized: "release",
      },
    ],
    release_cases: [
      {
        id: "case-final-rel",
        kind: "release",
        normalized_job_no: BOOKED_JOB,
        state: "resolved",
        mode: "release",
        resolved_at: T3,
        evidence: [{ observation_id: "obs-final-rel", captured_at: T3 }],
      },
    ],
  };
}

export function goldenContradictoryChronologyRows(): JobTimelineRows {
  const booked = goldenBookedRows();
  return {
    ...booked,
    cancellations: [
      {
        id: "cancel-early",
        booked_lead: "booking-book-1",
        createdAt: T1,
        last_changed_at: T1,
      },
    ],
  };
}

export function goldenOpenCancellationIntakeRows(): JobTimelineRows {
  const booked = goldenBookedRows();
  return {
    ...booked,
    observations: [
      ...booked.observations ?? [],
      {
        id: "obs-open-rel",
        captured_at: T3,
        normalized_job_no: BOOKED_JOB,
        route_event_class: "booking_status_changed",
        booking_action_normalized: "release",
      },
    ],
    release_cases: [
      {
        id: "case-open-rel",
        kind: "release",
        normalized_job_no: BOOKED_JOB,
        state: "open",
        mode: "release",
        evidence: [{ observation_id: "obs-open-rel", captured_at: T3 }],
      },
    ],
  };
}

export const GOLDEN_JOBS = {
  wordpress: WP_JOB,
  granot: GRANOT_JOB,
  ringcentral: RC_JOB,
  booked: BOOKED_JOB,
  cancelled: BOOKED_JOB,
  policySkip: "5005005",
  resolvedBookingWithoutFact: "5005006",
  resolvedReleaseWithoutFact: BOOKED_JOB,
  contradictory: BOOKED_JOB,
  cancellationIntakeOpen: BOOKED_JOB,
} as const;

export type GoldenShapeExpectation = {
  outcome: JobTimelineOutcome;
  attention: TimelineAttentionCode[];
  extraLimitations: TimelineLimitationCode[];
};

export const GOLDEN_EXPECTATIONS: Record<
  "wordpress" | "granot" | "ringcentral" | "booked" | "cancelled",
  GoldenShapeExpectation
> = {
  wordpress: {
    outcome: "booking_intake_open",
    attention: [],
    extraLimitations: ["WORDPRESS_RECEIPT_UNAVAILABLE"],
  },
  granot: {
    outcome: "lead_active",
    attention: [],
    extraLimitations: [],
  },
  ringcentral: {
    outcome: "lead_active",
    attention: [],
    extraLimitations: ["RINGCENTRAL_CURSOR_BOUNDED"],
  },
  booked: {
    outcome: "booked",
    attention: [],
    extraLimitations: [],
  },
  cancelled: {
    outcome: "cancelled",
    attention: [],
    extraLimitations: [],
  },
};

export { WP_JOB, GRANOT_JOB };
