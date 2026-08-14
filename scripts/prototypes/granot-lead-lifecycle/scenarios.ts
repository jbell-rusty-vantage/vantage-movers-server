import assert from "node:assert/strict";
import { advanceLeadLifecycle, type LifecycleWorld } from "./domain";
import {
  PROTOTYPE_CATALOG,
  bestRelocationBookingStatusReceipt,
  bestRelocationPriorityFiveReceipt,
  emptyWorld,
  top10FormReceipt,
  top10InboundReceipt,
  worldWithTop10CallLead,
  worldWithTop10FormLead,
  worldWithBestRelocationBookingCandidates,
} from "./fixtures";

export type ScenarioReport = {
  name: string;
  outcomes: string[];
  final_world: LifecycleWorld;
};

export function runPrototypeScenarios(): ScenarioReport[] {
  return [
    formLeadLinkAndQuote(),
    replayAndCrossChannelConvergence(),
    providerOccurredAtRejectsStaleObservation(),
    priorityFiveOpensGranotBookingIntake(),
    ownerConfirmsGranotBookingWithChangedLead(),
    authoritativeBookingThenCancellation(),
    callLeadWaitsForRingCentral(),
    callLeadPriorityEnrichment(),
    unsupportedPriorityIsObservedButBlocked(),
    unknownSourceNeverSearchesGlobally(),
    bookedWebhookOpensBookingIntakeWhenNoBooking(),
    bookedWebhookAlreadyCurrentWhenBookingExists(),
    bookedWebhookAfterCancellationOpensDiscrepancy(),
    releasOpensCancellationIntakeForActiveBooking(),
    releaseAliasOpensTheSameCancellationIntake(),
    ownerConfirmsGranotCancellationWithOfficialFacts(),
    ownerUpdatesBookingFromReleaseIntake(),
    ownerDismissesReleaseIntakeWithoutChangingBooking(),
    bookedAfterReleaseStaysIdempotentOnJobNo(),
    bookedThenReleaseThenBookedChangeCycle(),
    releasAlreadyCancelledIsAlreadyCurrent(),
    releasWithoutBookingOpensDiscrepancy(),
    releasWithConflictingLinkOpensDiscrepancy(),
    releasWithPriorityZeroDoesNotUnbook(),
    priorityZeroAfterBookingDoesNotDowngrade(),
    duplicateReleasDoesNotDuplicateOwnerWork(),
    laterReleaseReopensDismissedIntake(),
  ];
}

function formLeadLinkAndQuote(): ScenarioReport {
  let world = worldWithTop10FormLead();
  const linked = advanceLeadLifecycle(
    world,
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: top10FormReceipt({
        receipt_id: "receipt-01",
        route_event_type: "lead_created",
      }),
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(linked.decision.outcome, "linked");
  assert.equal(linked.world.leads.length, 1, "lead_created must not mint a second Lead");
  assert.equal(linked.world.granot_record_links.length, 1);

  const quoted = advanceLeadLifecycle(
    linked.world,
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: top10FormReceipt({
        receipt_id: "receipt-02",
        route_event_type: "priority_updated",
        priority: "1",
      }),
    },
    PROTOTYPE_CATALOG,
  );
  const lead = quoted.world.leads[0];
  assert.equal(quoted.decision.outcome, "applied");
  assert.equal(lead.quoted, true);
  assert.equal(lead.cubic_feet, 1250);
  assert.equal(lead.receiver_agent, "agent-mike");
  assert.equal(quoted.world.entity_changes.at(-1)?.provenance.observation_channel, "granot_webhook");
  assert.ok(quoted.effects.some((effect) => effect.kind === "sheet_sync_requested"));
  return report("F-C: lead_created link then Priority 1 quote", [linked, quoted]);
}

function replayAndCrossChannelConvergence(): ScenarioReport {
  let world = worldWithTop10FormLead();
  const receipt = top10FormReceipt({
    receipt_id: "receipt-03",
    route_event_type: "priority_updated",
    priority: "1",
  });
  const first = advanceLeadLifecycle(
    world,
    {
      kind: "observe_granot",
      observation_channel: "browser_extension",
      actor: { actor_type: "owner", actor_id: "owner-prototype" },
      receipt,
    },
    PROTOTYPE_CATALOG,
  );
  const replay = advanceLeadLifecycle(
    first.world,
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt,
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(replay.decision.outcome, "already_processed");
  assert.equal(replay.effects.length, 0);

  const laterWebhook = advanceLeadLifecycle(
    replay.world,
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: top10FormReceipt({
        receipt_id: "receipt-04",
        route_event_type: "priority_updated",
        priority: "1",
      }),
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(laterWebhook.decision.outcome, "already_current");
  assert.equal(laterWebhook.world.entity_changes.length, 1);
  return report("F-P: extension then webhook converges", [first, replay, laterWebhook]);
}

function priorityFiveOpensGranotBookingIntake(): ScenarioReport {
  const outcome = advanceLeadLifecycle(
    worldWithTop10FormLead(),
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: top10FormReceipt({
        receipt_id: "receipt-05",
        route_event_type: "priority_updated",
        priority: "5",
      }),
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(outcome.decision.outcome, "applied");
  assert.equal(outcome.world.leads[0].quoted, true);
  assert.equal(outcome.world.leads[0].booked, undefined);
  assert.equal(outcome.world.bookings.length, 0);
  assert.equal(outcome.world.granot_booking_intake_cases.length, 1);
  assert.equal(outcome.world.granot_booking_intake_cases[0].state, "open");
  assert.equal(outcome.world.booking_intake_notifications.length, 2);
  assert.equal(outcome.world.granot_booking_discrepancies.length, 0);
  return report("F-E: Priority 5 opens booking intake but never fabricates Booking", [outcome]);
}

function ownerConfirmsGranotBookingWithChangedLead(): ScenarioReport {
  const observed = advanceLeadLifecycle(
    worldWithBestRelocationBookingCandidates(),
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: bestRelocationPriorityFiveReceipt("receipt-booking-intake-01"),
    },
    PROTOTYPE_CATALOG,
  );
  const intake = observed.world.granot_booking_intake_cases[0];
  assert.equal(observed.decision.outcome, "applied");
  assert.equal(
    intake.suggested_booking_lead.lead_ref,
    "call-lead-best-relocation-suggested",
  );
  assert.equal(intake.suggested_booking_lead.confidence, "medium");
  assert.equal(intake.suggested_agent?.agent_id, "agent-roys");
  assert.equal(intake.observed.estimate, 2400);
  assert.equal(observed.world.bookings.length, 0);

  const incomplete = advanceLeadLifecycle(
    observed.world,
    {
      kind: "confirm_granot_booking",
      command_id: "confirm-granot-booking-incomplete",
      actor_id: "owner-prototype",
      booking_intake_case_id: intake.case_id,
      expected_case_revision: intake.revision,
      selected_booking_lead: {
        lead_ref: "call-lead-best-relocation-alternative",
        lead_model: "CallLead",
      },
      official_booking_details: {
        booking_id: "booking-best-relocation-prototype",
        book_date: "2026-08-13",
        agent_allocations: [],
        total_binder_amount: 2400,
        deposit_amount: 0,
        merchant: "Cardpointe",
      },
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(incomplete.decision.outcome, "invalid");
  assert.equal(incomplete.world.bookings.length, 0);
  assert.equal(incomplete.world.granot_booking_intake_cases[0].state, "open");

  const confirmed = advanceLeadLifecycle(
    incomplete.world,
    {
      kind: "confirm_granot_booking",
      command_id: "confirm-granot-booking-001",
      actor_id: "owner-prototype",
      booking_intake_case_id: intake.case_id,
      expected_case_revision: intake.revision,
      selected_booking_lead: {
        lead_ref: "call-lead-best-relocation-alternative",
        lead_model: "CallLead",
      },
      official_booking_details: {
        booking_id: "booking-best-relocation-prototype",
        book_date: "2026-08-13",
        agent_allocations: [
          {
            agent: "agent-roys",
            agent_name_snapshot: "Roys",
            binder_amount: 625,
          },
        ],
        total_binder_amount: 625,
        deposit_amount: 800,
        merchant: "Cardpointe",
      },
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(confirmed.decision.outcome, "applied");
  assert.equal(confirmed.world.bookings.length, 1);
  assert.equal(confirmed.world.bookings[0].total_binder_amount, 625);
  assert.equal(confirmed.world.bookings[0].deposit_amount, 800);
  assert.equal(
    confirmed.world.bookings[0].lead_ref,
    "call-lead-best-relocation-alternative",
    "owner selection must replace the Suggested Booking Lead",
  );
  assert.equal(confirmed.world.granot_booking_intake_cases[0].state, "completed");
  assert.equal(
    confirmed.world.granot_booking_intake_cases[0].selected_booking_lead?.lead_ref,
    "call-lead-best-relocation-alternative",
  );
  assert.equal(
    confirmed.world.granot_record_links[0].lead_ref,
    "call-lead-best-relocation-alternative",
    "owner selection must correct the durable Granot Record Link",
  );
  assert.equal(
    confirmed.world.granot_record_links[0].owner_correction?.previous_lead_ref,
    "call-lead-best-relocation-suggested",
  );
  assert.ok(
    confirmed.world.booking_intake_notifications.every(
      (notification) => notification.state === "acted",
    ),
  );
  assert.ok(
    confirmed.effects.some(
      (effect) =>
        effect.kind === "sheet_sync_requested" &&
        effect.resource === "booking_chain",
    ),
  );
  return report(
    "B-I: owner changes Suggested Booking Lead and confirms official Booking",
    [observed, incomplete, confirmed],
  );
}

function providerOccurredAtRejectsStaleObservation(): ScenarioReport {
  const newer = advanceLeadLifecycle(
    worldWithTop10FormLead(),
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: top10FormReceipt({
        receipt_id: "receipt-11",
        route_event_type: "priority_updated",
        priority: "1",
        occurred_at: "2026-08-13T18:00:00.000Z",
      }),
    },
    PROTOTYPE_CATALOG,
  );
  const older = advanceLeadLifecycle(
    newer.world,
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: top10FormReceipt({
        receipt_id: "receipt-12",
        route_event_type: "priority_updated",
        priority: "1",
        occurred_at: "2026-08-13T17:00:00.000Z",
      }),
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(newer.decision.outcome, "applied");
  assert.equal(older.decision.outcome, "stale");
  assert.equal(older.world.entity_changes.length, 1);
  return report("Provider occurred_at rejects a stale Granot Observation", [newer, older]);
}

function authoritativeBookingThenCancellation(): ScenarioReport {
  let world = advanceLeadLifecycle(
    worldWithTop10FormLead(),
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: top10FormReceipt({
        receipt_id: "receipt-06",
        route_event_type: "priority_updated",
        priority: "5",
      }),
    },
    PROTOTYPE_CATALOG,
  ).world;
  const booked = advanceLeadLifecycle(
    world,
    {
      kind: "record_booking",
      command_id: "command-booking-001",
      actor_id: "owner-prototype",
      booking: {
        id: "booking-top10-001",
        lead_ref: "form-lead-top10-001",
        lead_model: "FormLead",
        job_no: "P-PROTOTYPE-FORM-001",
        book_date: "2026-08-14T12:00:00.000Z",
        agent_allocations: [
          {
            agent: "agent-mike",
            agent_name_snapshot: "Mike",
            binder_amount: 500,
          },
        ],
        total_binder_amount: 500,
        deposit_amount: 750,
        merchant: "Cardpointe",
        source: "Top10 Forms",
      },
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(booked.decision.outcome, "applied");
  assert.equal(booked.world.leads[0].booked, "booking-top10-001");
  assert.equal(booked.world.granot_booking_intake_cases[0].state, "completed");

  const cancelled = advanceLeadLifecycle(
    booked.world,
    {
      kind: "record_cancellation",
      command_id: "command-cancellation-001",
      actor_id: "owner-prototype",
      cancellation: {
        id: "cancellation-top10-001",
        booked_lead: "booking-top10-001",
        lead_ref: "form-lead-top10-001",
        lead_model: "FormLead",
        cancel_date: "2026-08-15T12:00:00.000Z",
        refund_amount: 750,
        reason: "Prototype cancellation",
      },
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(cancelled.decision.outcome, "applied");
  assert.equal(cancelled.world.leads[0].booked, "booking-top10-001");
  assert.equal(cancelled.world.leads[0].cancelled, "cancellation-top10-001");
  assert.equal(cancelled.world.bookings[0].cancelled, "cancellation-top10-001");
  return report("Vantage Booking then Cancellation retains Booked", [booked, cancelled]);
}

function callLeadWaitsForRingCentral(): ScenarioReport {
  const outcome = advanceLeadLifecycle(
    emptyWorld(),
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: top10InboundReceipt({
        receipt_id: "receipt-07",
        route_event_type: "lead_created",
      }),
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(outcome.decision.outcome, "pending_match");
  assert.equal(outcome.world.leads.length, 0, "Granot cannot bypass RingCentral qualification");
  return report("C-C: inbound Granot job waits for RingCentral Call Lead", [outcome]);
}

function callLeadPriorityEnrichment(): ScenarioReport {
  const outcome = advanceLeadLifecycle(
    worldWithTop10CallLead(),
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: top10InboundReceipt({
        receipt_id: "receipt-08",
        route_event_type: "priority_updated",
        priority: "1",
      }),
    },
    PROTOTYPE_CATALOG,
  );
  const lead = outcome.world.leads[0];
  assert.equal(outcome.decision.outcome, "applied");
  assert.equal(lead.model, "CallLead");
  assert.equal(lead.job_no, "P-PROTOTYPE-CALL-001");
  assert.equal(lead.cubic_feet, 900);
  assert.equal(lead.quoted, undefined, "Call Lead has no quoted field");
  return report("C-E: Priority Snapshot enriches Call Lead without quoted", [outcome]);
}

function unsupportedPriorityIsObservedButBlocked(): ScenarioReport {
  const outcome = advanceLeadLifecycle(
    worldWithTop10FormLead(),
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: top10FormReceipt({
        receipt_id: "receipt-09",
        route_event_type: "priority_updated",
        priority: "8",
      }),
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(outcome.decision.outcome, "blocked");
  assert.equal(outcome.decision.raw_granot_priority, "8");
  assert.equal(outcome.world.leads[0].quoted, false);
  return report("Unknown Granot Priority remains raw and blocked", [outcome]);
}

function unknownSourceNeverSearchesGlobally(): ScenarioReport {
  const world = worldWithTop10FormLead();
  const receipt = top10FormReceipt({
    receipt_id: "receipt-10",
    route_event_type: "lead_created",
  });
  receipt.payload.source = "Paid Overflow";
  const outcome = advanceLeadLifecycle(
    world,
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt,
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(outcome.decision.outcome, "blocked");
  assert.equal(outcome.world.granot_record_links.length, 0);
  return report("Unknown Paid Overflow source never triggers global contact matching", [outcome]);
}

function bookedWebhookOpensBookingIntakeWhenNoBooking(): ScenarioReport {
  const outcome = advanceLeadLifecycle(
    worldWithBestRelocationBookingCandidates(),
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: bestRelocationBookingStatusReceipt({
        receipt_id: "receipt-booked-no-booking",
        event_type: "Booked",
      }),
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(outcome.decision.outcome, "applied");
  assert.equal(outcome.world.bookings.length, 0);
  assert.equal(outcome.world.cancellations.length, 0);
  assert.equal(outcome.world.granot_booking_intake_cases[0]?.state, "open");
  assert.equal(outcome.world.granot_cancellation_intake_cases.length, 0);
  return report("Booked webhook with no Vantage Booking opens booking intake", [outcome]);
}

function bookedWebhookAlreadyCurrentWhenBookingExists(): ScenarioReport {
  const booked = confirmBestRelocationBooking();
  const observed = advanceLeadLifecycle(
    booked.world,
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: bestRelocationBookingStatusReceipt({
        receipt_id: "receipt-booked-already-booked",
        event_type: "Booked",
      }),
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(observed.decision.outcome, "already_current");
  assert.equal(observed.world.bookings.length, 1);
  assert.equal(observed.world.granot_cancellation_intake_cases.length, 0);
  assert.equal(observed.world.granot_cancellation_discrepancies.length, 0);
  return report("Booked webhook with matching active Booking is already current", [
    booked,
    observed,
  ]);
}

function bookedWebhookAfterCancellationOpensDiscrepancy(): ScenarioReport {
  const cancelled = cancelBestRelocationBookingDirectly();
  const observed = advanceLeadLifecycle(
    cancelled.world,
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: bestRelocationBookingStatusReceipt({
        receipt_id: "receipt-booked-after-cancel",
        event_type: "Booked",
      }),
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(observed.decision.outcome, "conflict");
  assert.equal(observed.world.leads.find((lead) => lead.booked)?.cancelled, "cancellation-direct-001");
  assert.equal(observed.world.bookings[0].cancelled, "cancellation-direct-001");
  assert.equal(observed.world.cancellations.length, 1);
  assert.equal(
    observed.world.granot_cancellation_discrepancies[0]?.reason,
    "granot_booked_after_vantage_cancellation",
  );
  return report("Booked after official Cancellation opens discrepancy and never un-cancels", [
    cancelled,
    observed,
  ]);
}

function releasOpensCancellationIntakeForActiveBooking(): ScenarioReport {
  const booked = confirmBestRelocationBooking();
  const observed = observeReleas(booked.world, "receipt-releas-open-intake");
  assert.equal(observed.decision.outcome, "applied");
  assert.equal(observed.world.cancellations.length, 0);
  assert.equal(observed.world.bookings[0].cancelled, undefined);
  assert.equal(observed.world.granot_cancellation_intake_cases.length, 1);
  assert.equal(observed.world.granot_cancellation_intake_cases[0].state, "open");
  assert.equal(
    observed.world.granot_cancellation_intake_cases[0].linked_cancellation_booking.booking_ref,
    "booking-best-relocation-prototype",
  );
  assert.equal(observed.world.granot_cancellation_intake_cases[0].observed.raw_booking_status, "Releas");
  assert.deepEqual(observed.world.granot_cancellation_intake_cases[0].offered_owner_paths, [
    "confirm_cancellation",
    "update_booking",
  ]);
  assert.equal(observed.world.granot_cancellation_intake_cases[0].observed.payment, 646.4);
  assert.equal(observed.world.cancellation_intake_notifications.length, 2);
  return report("Releas with active Booking opens cancellation intake and notifications", [
    booked,
    observed,
  ]);
}

function ownerConfirmsGranotCancellationWithOfficialFacts(): ScenarioReport {
  const booked = confirmBestRelocationBooking();
  const observed = observeReleas(booked.world, "receipt-releas-confirm");
  const intake = observed.world.granot_cancellation_intake_cases[0];

  const incomplete = advanceLeadLifecycle(
    observed.world,
    {
      kind: "confirm_granot_cancellation",
      command_id: "confirm-granot-cancellation-incomplete",
      actor_id: "owner-prototype",
      cancellation_intake_case_id: intake.case_id,
      expected_case_revision: intake.revision,
      official_cancellation_details: {
        cancellation_id: "cancellation-best-relocation-prototype",
        cancel_date: "",
        refund_amount: Number.NaN,
      },
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(incomplete.decision.outcome, "invalid");
  assert.equal(incomplete.world.cancellations.length, 0);
  assert.equal(incomplete.world.granot_cancellation_intake_cases[0].state, "open");

  const confirmed = advanceLeadLifecycle(
    incomplete.world,
    {
      kind: "confirm_granot_cancellation",
      command_id: "confirm-granot-cancellation-001",
      actor_id: "owner-prototype",
      cancellation_intake_case_id: intake.case_id,
      expected_case_revision: intake.revision,
      official_cancellation_details: {
        cancellation_id: "cancellation-best-relocation-prototype",
        cancel_date: "2026-08-15",
        refund_amount: 750,
        reason: "Owner-confirmed prototype cancellation",
        notes: "Granot payment stayed display-only",
        cancelled_by: "owner-prototype",
      },
    },
    PROTOTYPE_CATALOG,
  );
  const lead = confirmed.world.leads.find(
    (candidate) => candidate.id === "call-lead-best-relocation-alternative",
  );
  assert.equal(confirmed.decision.outcome, "applied");
  assert.equal(lead?.booked, "booking-best-relocation-prototype");
  assert.equal(lead?.cancelled, "cancellation-best-relocation-prototype");
  assert.equal(confirmed.world.bookings[0].cancelled, "cancellation-best-relocation-prototype");
  assert.equal(confirmed.world.cancellations[0].refund_amount, 750);
  assert.notEqual(
    confirmed.world.cancellations[0].refund_amount,
    intake.observed.payment,
    "Granot payment must not become the official Refund",
  );
  assert.equal(confirmed.world.granot_cancellation_intake_cases[0].state, "completed");
  assert.ok(
    confirmed.world.cancellation_intake_notifications.every(
      (notification) => notification.state === "acted",
    ),
  );
  assert.equal(
    confirmed.effects.filter(
      (effect) =>
        effect.kind === "sheet_sync_requested" &&
        effect.resource === "cancellation_chain",
    ).length,
    1,
  );

  const replayedConfirm = advanceLeadLifecycle(
    confirmed.world,
    {
      kind: "confirm_granot_cancellation",
      command_id: "confirm-granot-cancellation-replay",
      actor_id: "owner-prototype",
      cancellation_intake_case_id: intake.case_id,
      expected_case_revision: confirmed.world.granot_cancellation_intake_cases[0].revision,
      official_cancellation_details: {
        cancellation_id: "cancellation-best-relocation-duplicate",
        cancel_date: "2026-08-16",
        refund_amount: 1,
      },
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(replayedConfirm.decision.outcome, "already_current");
  assert.equal(replayedConfirm.world.cancellations.length, 1);
  return report(
    "C-I: owner confirms official Cancellation; Granot payment stays context; replay is idempotent",
    [observed, incomplete, confirmed, replayedConfirm],
  );
}

function releasAlreadyCancelledIsAlreadyCurrent(): ScenarioReport {
  const cancelled = cancelBestRelocationBookingDirectly();
  const observed = observeReleas(cancelled.world, "receipt-releas-already-cancelled");
  assert.equal(observed.decision.outcome, "already_current");
  assert.equal(observed.world.cancellations.length, 1);
  assert.equal(observed.world.granot_cancellation_intake_cases.length, 0);
  return report("Releas after official Cancellation refreshes evidence only", [
    cancelled,
    observed,
  ]);
}

function releasWithoutBookingOpensDiscrepancy(): ScenarioReport {
  const outcome = advanceLeadLifecycle(
    worldWithBestRelocationBookingCandidates(),
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: bestRelocationBookingStatusReceipt({
        receipt_id: "receipt-releas-no-booking",
        event_type: "Releas",
      }),
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(outcome.decision.outcome, "conflict");
  assert.equal(outcome.world.cancellations.length, 0);
  assert.equal(outcome.world.granot_cancellation_intake_cases.length, 0);
  assert.equal(
    outcome.world.granot_cancellation_discrepancies[0]?.reason,
    "releas_without_vantage_booking",
  );
  return report("Releas with no Booking opens an explicit discrepancy", [outcome]);
}

function releasWithConflictingLinkOpensDiscrepancy(): ScenarioReport {
  const booked = confirmBestRelocationBooking();
  const conflictingWorld = structuredClone(booked.world);
  conflictingWorld.bookings.push({
    id: "booking-conflicting-link",
    lead_ref: "call-lead-best-relocation-suggested",
    lead_model: "CallLead",
    job_no: "PROTO-OTHER-JOB",
    book_date: "2026-08-13",
    agent_allocations: [
      { agent: "agent-roys", agent_name_snapshot: "Roys", binder_amount: 100 },
    ],
    total_binder_amount: 100,
    deposit_amount: 100,
    merchant: "Cardpointe",
    source: "BestRelocation Inbounds",
    revision: 1,
  });
  conflictingWorld.granot_record_links[0].booking_ref = "booking-conflicting-link";
  const observed = observeReleas(conflictingWorld, "receipt-releas-link-conflict");
  assert.equal(observed.decision.outcome, "conflict");
  assert.equal(observed.world.cancellations.length, 0);
  assert.equal(observed.world.granot_cancellation_intake_cases.length, 0);
  assert.equal(
    observed.world.granot_cancellation_discrepancies[0]?.reason,
    "granot_record_link_conflict",
  );
  return report("Releas with a conflicting Record Link stays owner-resolvable", [
    booked,
    observed,
  ]);
}

function priorityZeroAfterBookingDoesNotDowngrade(): ScenarioReport {
  const booked = confirmBestRelocationBooking();
  const leadBefore = booked.world.leads.find(
    (lead) => lead.id === "call-lead-best-relocation-alternative",
  );
  const observed = advanceLeadLifecycle(
    booked.world,
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: bestRelocationPriorityFiveReceipt("receipt-priority-zero-after-booking"),
    },
    PROTOTYPE_CATALOG,
  );
  const zero = advanceLeadLifecycle(
    observed.world,
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: {
        ...bestRelocationPriorityFiveReceipt("receipt-priority-zero-after-booking-0"),
        payload: {
          ...bestRelocationPriorityFiveReceipt("receipt-priority-zero-after-booking-0").payload,
          priority: "0",
        },
      },
    },
    PROTOTYPE_CATALOG,
  );
  const lead = zero.world.leads.find(
    (candidate) => candidate.id === "call-lead-best-relocation-alternative",
  );
  assert.equal(lead?.booked, "booking-best-relocation-prototype");
  assert.equal(lead?.cancelled, undefined);
  assert.equal(lead?.quoted, leadBefore?.quoted);
  assert.equal(zero.world.cancellations.length, 0);
  return report("Priority 0 after Booking does not undo Booked facts", [booked, zero]);
}

function duplicateReleasDoesNotDuplicateOwnerWork(): ScenarioReport {
  const booked = confirmBestRelocationBooking();
  const first = observeReleas(booked.world, "receipt-releas-duplicate-1");
  const second = observeReleas(first.world, "receipt-releas-duplicate-2");
  assert.equal(first.decision.outcome, "applied");
  assert.equal(second.decision.outcome, "already_current");
  assert.equal(second.world.granot_cancellation_intake_cases.length, 1);
  assert.equal(second.world.cancellation_intake_notifications.length, 2);
  assert.equal(second.world.cancellations.length, 0);
  return report("Duplicate Releas keeps one open intake and one notification per channel", [
    first,
    second,
  ]);
}

function confirmBestRelocationBooking() {
  const observed = advanceLeadLifecycle(
    worldWithBestRelocationBookingCandidates(),
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: bestRelocationPriorityFiveReceipt("receipt-cancel-setup-priority-5"),
    },
    PROTOTYPE_CATALOG,
  );
  return advanceLeadLifecycle(
    observed.world,
    {
      kind: "confirm_granot_booking",
      command_id: "confirm-granot-booking-cancel-setup",
      actor_id: "owner-prototype",
      booking_intake_case_id: observed.world.granot_booking_intake_cases[0].case_id,
      expected_case_revision: observed.world.granot_booking_intake_cases[0].revision,
      selected_booking_lead: {
        lead_ref: "call-lead-best-relocation-alternative",
        lead_model: "CallLead",
      },
      official_booking_details: {
        booking_id: "booking-best-relocation-prototype",
        book_date: "2026-08-13",
        agent_allocations: [
          {
            agent: "agent-roys",
            agent_name_snapshot: "Roys",
            binder_amount: 625,
          },
        ],
        total_binder_amount: 625,
        deposit_amount: 800,
        merchant: "Cardpointe",
      },
    },
    PROTOTYPE_CATALOG,
  );
}

function cancelBestRelocationBookingDirectly() {
  const booked = confirmBestRelocationBooking();
  return advanceLeadLifecycle(
    booked.world,
    {
      kind: "record_cancellation",
      command_id: "command-cancellation-direct-001",
      actor_id: "owner-prototype",
      cancellation: {
        id: "cancellation-direct-001",
        booked_lead: "booking-best-relocation-prototype",
        lead_ref: "call-lead-best-relocation-alternative",
        lead_model: "CallLead",
        cancel_date: "2026-08-15T12:00:00.000Z",
        refund_amount: 800,
        reason: "Direct owner cancellation",
      },
    },
    PROTOTYPE_CATALOG,
  );
}

function releaseAliasOpensTheSameCancellationIntake(): ScenarioReport {
  const booked = confirmBestRelocationBooking();
  const observed = observeReleas(booked.world, "receipt-release-alias", "Release");
  assert.equal(observed.decision.outcome, "applied");
  assert.equal(observed.world.cancellations.length, 0);
  assert.equal(observed.world.bookings.length, 1);
  assert.equal(
    observed.world.granot_cancellation_intake_cases[0].observed.raw_booking_status,
    "Release",
  );
  assert.deepEqual(observed.world.granot_cancellation_intake_cases[0].offered_owner_paths, [
    "confirm_cancellation",
    "update_booking",
  ]);
  return report("Release spelling is the same Granot Booking Action as truncated Releas", [
    booked,
    observed,
  ]);
}

function ownerUpdatesBookingFromReleaseIntake(): ScenarioReport {
  const booked = confirmBestRelocationBooking();
  const observed = observeReleas(booked.world, "receipt-releas-update-booking");
  const intake = observed.world.granot_cancellation_intake_cases[0];
  const updated = advanceLeadLifecycle(
    observed.world,
    {
      kind: "update_granot_booking",
      command_id: "update-granot-booking-001",
      actor_id: "owner-prototype",
      cancellation_intake_case_id: intake.case_id,
      expected_case_revision: intake.revision,
      official_booking_details: {
        book_date: "2026-08-20",
        agent_allocations: [
          {
            agent: "agent-roys",
            agent_name_snapshot: "Roys",
            binder_amount: 700,
          },
        ],
        total_binder_amount: 700,
        deposit_amount: 900,
        merchant: "Cardpointe",
      },
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(updated.decision.outcome, "applied");
  assert.equal(updated.world.bookings.length, 1);
  assert.equal(updated.world.bookings[0].id, "booking-best-relocation-prototype");
  assert.equal(updated.world.bookings[0].total_binder_amount, 700);
  assert.equal(updated.world.bookings[0].deposit_amount, 900);
  assert.equal(updated.world.bookings[0].cancelled, undefined);
  assert.equal(updated.world.cancellations.length, 0);
  assert.equal(updated.world.granot_cancellation_intake_cases[0].state, "completed");
  assert.equal(
    updated.world.granot_cancellation_intake_cases[0].resolution_action,
    "update_booking",
  );
  assert.ok(
    updated.effects.some(
      (effect) =>
        effect.kind === "sheet_sync_requested" &&
        effect.resource === "booking_chain" &&
        effect.operation === "booking.update",
    ),
  );
  return report("Release intake Update Booking path mutates the existing Job Number Booking", [
    booked,
    observed,
    updated,
  ]);
}

function ownerDismissesReleaseIntakeWithoutChangingBooking(): ScenarioReport {
  const booked = confirmBestRelocationBooking();
  const observed = observeReleas(booked.world, "receipt-releas-dismiss");
  const intake = observed.world.granot_cancellation_intake_cases[0];
  const dismissed = advanceLeadLifecycle(
    observed.world,
    {
      kind: "dismiss_granot_cancellation_intake",
      command_id: "dismiss-granot-cancellation-001",
      actor_id: "owner-prototype",
      cancellation_intake_case_id: intake.case_id,
      expected_case_revision: intake.revision,
      reason: "Granot released to make changes; Vantage Booking stays",
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(dismissed.decision.outcome, "applied");
  assert.equal(dismissed.world.bookings.length, 1);
  assert.equal(dismissed.world.bookings[0].cancelled, undefined);
  assert.equal(dismissed.world.cancellations.length, 0);
  assert.equal(dismissed.world.granot_cancellation_intake_cases[0].state, "dismissed");
  assert.equal(dismissed.world.granot_cancellation_intake_cases[0].resolution_action, "dismiss");
  assert.ok(
    dismissed.world.cancellation_intake_notifications.every(
      (notification) => notification.state === "dismissed",
    ),
  );
  return report("Owner may dismiss Release intake without changing Vantage", [
    booked,
    observed,
    dismissed,
  ]);
}

function bookedAfterReleaseStaysIdempotentOnJobNo(): ScenarioReport {
  const booked = confirmBestRelocationBooking();
  const released = observeReleas(booked.world, "receipt-releas-then-booked");
  const rebooked = advanceLeadLifecycle(
    released.world,
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: bestRelocationBookingStatusReceipt({
        receipt_id: "receipt-booked-after-release",
        event_type: "Booked",
        priority: "5",
      }),
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(rebooked.decision.outcome, "already_current");
  assert.equal(rebooked.world.bookings.length, 1);
  assert.equal(rebooked.world.cancellations.length, 0);
  assert.equal(rebooked.world.granot_cancellation_intake_cases.length, 1);
  assert.equal(rebooked.world.granot_cancellation_intake_cases[0].state, "open");
  assert.equal(
    rebooked.world.granot_cancellation_intake_cases[0].observed.raw_booking_status,
    "Booked",
  );
  assert.deepEqual(rebooked.world.granot_cancellation_intake_cases[0].offered_owner_paths, [
    "confirm_cancellation",
    "update_booking",
  ]);
  return report("Booked after Release stays one Booking per Job Number and keeps the owner offer", [
    booked,
    released,
    rebooked,
  ]);
}

function bookedThenReleaseThenBookedChangeCycle(): ScenarioReport {
  const booked = confirmBestRelocationBooking();
  const firstBooked = advanceLeadLifecycle(
    booked.world,
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: bestRelocationBookingStatusReceipt({
        receipt_id: "receipt-cycle-booked-1",
        event_type: "Booked",
        priority: "5",
      }),
    },
    PROTOTYPE_CATALOG,
  );
  const released = observeReleas(firstBooked.world, "receipt-cycle-releas", "Releas", "5");
  const secondBooked = advanceLeadLifecycle(
    released.world,
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: bestRelocationBookingStatusReceipt({
        receipt_id: "receipt-cycle-booked-2",
        event_type: "Booked",
        priority: "5",
      }),
    },
    PROTOTYPE_CATALOG,
  );
  assert.equal(firstBooked.decision.outcome, "already_current");
  assert.equal(released.decision.outcome, "applied");
  assert.equal(secondBooked.decision.outcome, "already_current");
  assert.equal(secondBooked.world.bookings.length, 1);
  assert.equal(secondBooked.world.cancellations.length, 0);
  assert.equal(
    secondBooked.world.leads.find((lead) => lead.id === "call-lead-best-relocation-alternative")
      ?.booked,
    "booking-best-relocation-prototype",
  );
  return report("Booked → Release → Booked change cycle never mints a second Booking or Cancellation", [
    firstBooked,
    released,
    secondBooked,
  ]);
}

function releasWithPriorityZeroDoesNotUnbook(): ScenarioReport {
  const booked = confirmBestRelocationBooking();
  const observed = observeReleas(booked.world, "receipt-releas-priority-0", "Releas", "0");
  const lead = observed.world.leads.find(
    (candidate) => candidate.id === "call-lead-best-relocation-alternative",
  );
  assert.equal(observed.decision.outcome, "applied");
  assert.equal(lead?.booked, "booking-best-relocation-prototype");
  assert.equal(lead?.cancelled, undefined);
  assert.equal(observed.world.bookings[0].cancelled, undefined);
  assert.equal(observed.world.cancellations.length, 0);
  assert.equal(observed.world.granot_cancellation_intake_cases[0].observed.granot_priority, "0");
  assert.equal(
    observed.world.granot_cancellation_intake_cases[0].observed.raw_booking_status,
    "Releas",
  );
  return report("Priority 0 on a Release snapshot is context, not unbook or cancel", [
    booked,
    observed,
  ]);
}

function laterReleaseReopensDismissedIntake(): ScenarioReport {
  const booked = confirmBestRelocationBooking();
  const observed = observeReleas(booked.world, "receipt-releas-before-dismiss");
  const dismissed = advanceLeadLifecycle(
    observed.world,
    {
      kind: "dismiss_granot_cancellation_intake",
      command_id: "dismiss-before-later-release",
      actor_id: "owner-prototype",
      cancellation_intake_case_id: observed.world.granot_cancellation_intake_cases[0].case_id,
      expected_case_revision: observed.world.granot_cancellation_intake_cases[0].revision,
    },
    PROTOTYPE_CATALOG,
  );
  const later = observeReleas(dismissed.world, "receipt-releas-after-dismiss");
  assert.equal(later.decision.outcome, "applied");
  assert.equal(later.world.granot_cancellation_intake_cases.length, 1);
  assert.equal(later.world.granot_cancellation_intake_cases[0].state, "open");
  assert.equal(later.world.cancellations.length, 0);
  assert.equal(later.world.bookings.length, 1);
  return report("A later Release reopens dismissed intake for the same Job Number", [
    booked,
    dismissed,
    later,
  ]);
}

function observeReleas(
  world: ReturnType<typeof advanceLeadLifecycle>["world"],
  receiptId: string,
  eventType: "Releas" | "Release" = "Releas",
  priority?: string,
) {
  return advanceLeadLifecycle(
    world,
    {
      kind: "observe_granot",
      observation_channel: "granot_webhook",
      actor: { actor_type: "system", actor_id: "granot-webhook-processor" },
      receipt: bestRelocationBookingStatusReceipt({
        receipt_id: receiptId,
        event_type: eventType,
        priority,
      }),
    },
    PROTOTYPE_CATALOG,
  );
}

function report(
  name: string,
  results: Array<ReturnType<typeof advanceLeadLifecycle>>,
): ScenarioReport {
  return {
    name,
    outcomes: results.map((result) => result.decision.outcome),
    final_world: results.at(-1)!.world,
  };
}
