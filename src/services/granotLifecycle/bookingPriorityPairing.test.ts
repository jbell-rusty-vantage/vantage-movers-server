import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import {
  isCanonicalPriorityFive,
  projectBookingPriorityPairing,
  toBookingPriorityPairingProjection,
  toListPriorityPairing,
} from "./bookingPriorityPairing";

const JOB = "SYNTHETIC JOB PAIR";
const OTHER_JOB = "SYNTHETIC JOB OTHER";
const earlier = new Date("2026-08-24T15:00:00.000Z");
const bookedAt = new Date("2026-08-24T15:01:00.000Z");
const later = new Date("2026-08-24T15:02:00.000Z");
const priorityId = "64b7f4d9e6c2a1b0f3d5e780";
const bookedId = "64b7f4d9e6c2a1b0f3d5e788";
const laterId = "64b7f4d9e6c2a1b0f3d5e789";
const otherId = "64b7f4d9e6c2a1b0f3d5e77a";

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
    _id: new mongoose.Types.ObjectId(input.id),
    receipt_id: new mongoose.Types.ObjectId(input.receipt ?? input.id.replace(/.$/, "1")),
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

test("[AC-P2] Booked that carries Priority 5 with no preceding Priority Update", () => {
  const creating = booked();
  const pairing = projectBookingPriorityPairing({
    creating_booked: creating,
    job_observations: [creating],
  });
  assert.equal(pairing.pairing, "booked_carries_priority_5");
  assert.equal(pairing.preceding_priority_5, undefined);
  assert.equal(pairing.creating_booked.priority_is_5, true);
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

test("equal temporal tuple is neither preceding nor later", () => {
  const creating = booked();
  const sameTuple = priorityFive({
    id: bookedId,
    captured_at: bookedAt,
  });
  const pairing = projectBookingPriorityPairing({
    creating_booked: creating,
    job_observations: [creating, sameTuple],
  });
  assert.equal(pairing.preceding_priority_5, undefined);
  assert.equal(pairing.later_priority_5, undefined);
  assert.equal(pairing.pairing, "booked_carries_priority_5");
});

test("other jobs are ignored and lead_created Priority 5 is not preceding", () => {
  const creating = booked();
  const otherJob = priorityFive({
    id: otherId,
    job: OTHER_JOB,
    captured_at: earlier,
  });
  const leadCreated = observation({
    id: "64b7f4d9e6c2a1b0f3d5e770",
    captured_at: earlier,
    route: "lead_created",
    event: "Lead",
    priority: { valid: true, canonical: "5" },
  });
  const pairing = projectBookingPriorityPairing({
    creating_booked: creating,
    job_observations: [creating, otherJob, leadCreated],
  });
  assert.equal(pairing.pairing, "booked_carries_priority_5");
  assert.equal(pairing.preceding_priority_5, undefined);
});

test("latest older Priority 5 wins when several precede Booked", () => {
  const creating = booked();
  const older = priorityFive({
    id: otherId,
    captured_at: new Date("2026-08-24T14:00:00.000Z"),
  });
  const newestOlder = priorityFive();
  const pairing = projectBookingPriorityPairing({
    creating_booked: creating,
    job_observations: [creating, older, newestOlder],
  });
  assert.equal(pairing.preceding_priority_5?.observation_id, priorityId);
});

test("throws without a Booked creating Observation or Job Number", () => {
  assert.throws(
    () =>
      projectBookingPriorityPairing({
        creating_booked: priorityFive(),
        job_observations: [],
      }),
    /creating Booked Observation/,
  );
  const missingJob = booked();
  missingJob.identity = {};
  assert.throws(
    () =>
      projectBookingPriorityPairing({
        creating_booked: missingJob,
        job_observations: [],
      }),
    /Job Number/,
  );
});

test("isCanonicalPriorityFive requires valid canonical 5", () => {
  assert.equal(isCanonicalPriorityFive({ valid: true, canonical: "5" }), true);
  assert.equal(isCanonicalPriorityFive({ valid: false, canonical: "5" }), false);
  assert.equal(isCanonicalPriorityFive({ valid: true, canonical: "1" }), false);
  assert.equal(isCanonicalPriorityFive(undefined), false);
});

test("wire and list projections keep IDs, times, route, and Priority only", () => {
  const pairing = projectBookingPriorityPairing({
    creating_booked: booked(),
    job_observations: [priorityFive(), booked()],
  });
  const wire = toBookingPriorityPairingProjection(pairing);
  assert.equal(wire.pairing, "priority_5_then_booked");
  assert.equal(wire.creating_booked.captured_at, bookedAt.toISOString());
  assert.equal(wire.preceding_priority_5?.captured_at, earlier.toISOString());
  assert.equal(JSON.stringify(wire).includes("Ada"), false);
  assert.equal(JSON.stringify(wire).includes("phone"), false);
  assert.equal("payload" in wire, false);
  assert.equal("payload" in (wire.preceding_priority_5 ?? {}), false);
  assert.equal(JSON.stringify(wire).includes("Authorization"), false);
  assert.deepEqual(toListPriorityPairing(pairing), {
    pairing: "priority_5_then_booked",
    creating_booked_priority_is_5: true,
    has_preceding_priority_5: true,
    has_later_priority_5: false,
  });
});
