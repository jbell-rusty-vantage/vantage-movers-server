import assert from "node:assert/strict";
import { test } from "node:test";
import { toObjectId } from "../../utils/objectId";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import {
  projectBookingPriorityPairing,
} from "./bookingPriorityPairing";

const JOB = "SYNTHETIC JOB PAIR";
const earlier = new Date("2026-08-24T15:00:00.000Z");
const bookedAt = new Date("2026-08-24T15:01:00.000Z");
const later = new Date("2026-08-24T15:02:00.000Z");
const priorityId = "64b7f4d9e6c2a1b0f3d5e780";
const bookedId = "64b7f4d9e6c2a1b0f3d5e788";
const laterId = "64b7f4d9e6c2a1b0f3d5e789";

function observation(input: {
  id: string;
  receipt?: string;
  captured_at: Date;
  route?: GranotObservationDocument["route_event_class"];
  event?: string;
  job?: string;
  priority?: GranotObservationDocument["priority"];
  booking_action?: GranotObservationDocument["booking_action"];
}): GranotObservationDocument {
  return {
    _id: toObjectId(input.id),
    receipt_id: toObjectId(input.receipt ?? input.id.replace(/.$/, "1")),
    captured_at: input.captured_at,
    route_event_class: input.route,
    payload_event_type_raw: input.event,
    identity: { normalized_job_no: input.job ?? JOB },
    priority: input.priority ?? { valid: false },
    booking_action: input.booking_action ?? {},
  } as GranotObservationDocument;
}

function booked(overrides: Partial<Parameters<typeof observation>[0]> = {}) {
  return observation({
    id: bookedId,
    captured_at: bookedAt,
    route: "booking_status_changed",
    event: "Booked",
    priority: { valid: true, canonical: "5" },
    booking_action: { raw: "Booked", normalized: "booked" },
    ...overrides,
  });
}

function priorityFive(overrides: Partial<Parameters<typeof observation>[0]> = {}) {
  return observation({
    id: priorityId,
    captured_at: earlier,
    route: "priority_updated",
    event: "Priority",
    priority: { valid: true, canonical: "5" },
    ...overrides,
  });
}

test("[AC-P1] Priority 5 then Booked selects the preceding Priority Update", () => {
  const creating = booked();
  const preceding = priorityFive();
  const pairing = projectBookingPriorityPairing({
    creating_booked: creating,
    job_observations: [preceding, creating],
  });
  assert.equal(pairing.pairing, "priority_5_then_booked");
  assert.equal(pairing.preceding_priority_5?.observation_id, priorityId);
  assert.equal(pairing.preceding_priority_5?.priority_canonical, "5");
  assert.equal(pairing.creating_booked.priority_is_5, true);
  assert.equal(pairing.later_priority_5, undefined);
});

test("[AC-P3] Booked without valid canonical 5 is booked_without_priority_5", () => {
  for (const priority of [
    undefined,
    { valid: false },
    { valid: true, canonical: "1" },
    { valid: false, canonical: "5" },
  ] as Array<GranotObservationDocument["priority"] | undefined>) {
    const creating = booked({ priority: priority ?? { valid: false } });
    if (priority === undefined) creating.priority = undefined as never;
    const pairing = projectBookingPriorityPairing({
      creating_booked: creating,
      job_observations: [creating, priorityFive()],
    });
    assert.equal(pairing.pairing, "booked_without_priority_5");
    assert.equal(pairing.creating_booked.priority_is_5, false);
    assert.equal(pairing.preceding_priority_5?.observation_id, priorityId);
  }
});

test("[AC-P4] later Priority 5 is read-time only and does not become preceding", () => {
  const creating = booked({ priority: { valid: true, canonical: "1" } });
  const laterFive = priorityFive({ id: laterId, captured_at: later });
  const pairing = projectBookingPriorityPairing({
    creating_booked: creating,
    job_observations: [creating, laterFive],
  });
  assert.equal(pairing.pairing, "booked_without_priority_5");
  assert.equal(pairing.preceding_priority_5, undefined);
  assert.equal(pairing.later_priority_5?.observation_id, laterId);
});
