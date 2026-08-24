import type { GranotObservationDocument } from "../../models/GranotObservation";
import { compareGranotTemporal } from "./granotTemporal";

export type BookingPriorityPairingClass =
  | "priority_5_then_booked"
  | "booked_carries_priority_5"
  | "booked_without_priority_5";

export type BookingPriorityPairingRef = {
  observation_id: string;
  receipt_id: string;
  captured_at: Date;
  route_event_class: "priority_updated";
  payload_event_type_raw?: string;
  priority_canonical: "5";
};

export type BookingPriorityPairing = {
  pairing: BookingPriorityPairingClass;
  creating_booked: {
    observation_id: string;
    receipt_id: string;
    captured_at: Date;
    route_event_class?: GranotObservationDocument["route_event_class"];
    payload_event_type_raw?: string;
    priority_canonical?: string;
    priority_valid: boolean;
    priority_is_5: boolean;
  };
  preceding_priority_5?: BookingPriorityPairingRef;
  later_priority_5?: BookingPriorityPairingRef;
};

export type BookingPriorityPairingProjection = {
  pairing: BookingPriorityPairingClass;
  creating_booked: {
    observation_id: string;
    receipt_id: string;
    captured_at: string;
    route_event_class?: string;
    payload_event_type_raw?: string;
    priority_canonical?: string;
    priority_valid: boolean;
    priority_is_5: boolean;
  };
  preceding_priority_5?: {
    observation_id: string;
    receipt_id: string;
    captured_at: string;
    route_event_class: "priority_updated";
    payload_event_type_raw?: string;
    priority_canonical: "5";
  };
  later_priority_5?: {
    observation_id: string;
    receipt_id: string;
    captured_at: string;
    route_event_class: "priority_updated";
    payload_event_type_raw?: string;
    priority_canonical: "5";
  };
};

export type BookingPriorityPairingListItem = {
  pairing: BookingPriorityPairingClass;
  creating_booked_priority_is_5: boolean;
  has_preceding_priority_5: boolean;
  has_later_priority_5: boolean;
};

export type BookingPriorityPairingJobObservation = Pick<
  GranotObservationDocument,
  | "_id"
  | "receipt_id"
  | "captured_at"
  | "route_event_class"
  | "payload_event_type_raw"
  | "priority"
  | "identity"
>;

export function isCanonicalPriorityFive(
  priority: GranotObservationDocument["priority"] | undefined,
): boolean {
  return priority?.valid === true && priority.canonical === "5";
}

export function projectBookingPriorityPairing(input: {
  creating_booked: Pick<
    GranotObservationDocument,
    | "_id"
    | "receipt_id"
    | "captured_at"
    | "route_event_class"
    | "payload_event_type_raw"
    | "priority"
    | "identity"
    | "booking_action"
  >;
  job_observations: BookingPriorityPairingJobObservation[];
}): BookingPriorityPairing {
  const creating = input.creating_booked;
  if (creating.booking_action?.normalized !== "booked") {
    throw new Error("Booking Priority Pairing requires a creating Booked Observation.");
  }
  const jobNo = creating.identity?.normalized_job_no;
  if (!jobNo) {
    throw new Error("Booking Priority Pairing requires a creating Observation Job Number.");
  }

  const sameJob = input.job_observations.filter(
    (observation) => observation.identity?.normalized_job_no === jobNo,
  );
  const priorityFives = sameJob.filter(
    (observation) =>
      observation.route_event_class === "priority_updated" &&
      isCanonicalPriorityFive(observation.priority),
  );

  const preceding = latestWhere(priorityFives, (candidate) =>
    compareGranotTemporal(temporal(candidate), temporal(creating)) === "older",
  );
  const later = latestWhere(priorityFives, (candidate) =>
    compareGranotTemporal(temporal(creating), temporal(candidate)) === "older",
  );

  const priority_is_5 = isCanonicalPriorityFive(creating.priority);
  const pairing: BookingPriorityPairingClass = !priority_is_5
    ? "booked_without_priority_5"
    : preceding
      ? "priority_5_then_booked"
      : "booked_carries_priority_5";

  return {
    pairing,
    creating_booked: {
      observation_id: String(creating._id),
      receipt_id: String(creating.receipt_id),
      captured_at: new Date(creating.captured_at),
      route_event_class: creating.route_event_class,
      payload_event_type_raw: creating.payload_event_type_raw,
      priority_canonical: creating.priority?.canonical,
      priority_valid: creating.priority?.valid === true,
      priority_is_5,
    },
    preceding_priority_5: preceding ? toPairingRef(preceding) : undefined,
    later_priority_5: later ? toPairingRef(later) : undefined,
  };
}

export function toBookingPriorityPairingProjection(
  pairing: BookingPriorityPairing,
): BookingPriorityPairingProjection {
  return {
    pairing: pairing.pairing,
    creating_booked: {
      observation_id: pairing.creating_booked.observation_id,
      receipt_id: pairing.creating_booked.receipt_id,
      captured_at: pairing.creating_booked.captured_at.toISOString(),
      route_event_class: pairing.creating_booked.route_event_class,
      payload_event_type_raw: pairing.creating_booked.payload_event_type_raw,
      priority_canonical: pairing.creating_booked.priority_canonical,
      priority_valid: pairing.creating_booked.priority_valid,
      priority_is_5: pairing.creating_booked.priority_is_5,
    },
    preceding_priority_5: pairing.preceding_priority_5
      ? toPairingRefProjection(pairing.preceding_priority_5)
      : undefined,
    later_priority_5: pairing.later_priority_5
      ? toPairingRefProjection(pairing.later_priority_5)
      : undefined,
  };
}

export function toListPriorityPairing(
  pairing: BookingPriorityPairing,
): BookingPriorityPairingListItem {
  return {
    pairing: pairing.pairing,
    creating_booked_priority_is_5: pairing.creating_booked.priority_is_5,
    has_preceding_priority_5: Boolean(pairing.preceding_priority_5),
    has_later_priority_5: Boolean(pairing.later_priority_5),
  };
}

function latestWhere(
  observations: BookingPriorityPairingJobObservation[],
  predicate: (observation: BookingPriorityPairingJobObservation) => boolean,
): BookingPriorityPairingJobObservation | undefined {
  let latest: BookingPriorityPairingJobObservation | undefined;
  for (const observation of observations) {
    if (!predicate(observation)) continue;
    if (
      !latest ||
      compareGranotTemporal(temporal(observation), temporal(latest)) === "newer"
    ) {
      latest = observation;
    }
  }
  return latest;
}

function temporal(observation: {
  _id: { toString(): string } | string;
  captured_at: Date;
}): { captured_at: Date; observation_id: string } {
  return {
    captured_at: new Date(observation.captured_at),
    observation_id: String(observation._id),
  };
}

function toPairingRef(
  observation: BookingPriorityPairingJobObservation,
): BookingPriorityPairingRef {
  return {
    observation_id: String(observation._id),
    receipt_id: String(observation.receipt_id),
    captured_at: new Date(observation.captured_at),
    route_event_class: "priority_updated",
    payload_event_type_raw: observation.payload_event_type_raw,
    priority_canonical: "5",
  };
}

function toPairingRefProjection(
  ref: BookingPriorityPairingRef,
): NonNullable<BookingPriorityPairingProjection["preceding_priority_5"]> {
  return {
    observation_id: ref.observation_id,
    receipt_id: ref.receipt_id,
    captured_at: ref.captured_at.toISOString(),
    route_event_class: "priority_updated",
    payload_event_type_raw: ref.payload_event_type_raw,
    priority_canonical: "5",
  };
}
