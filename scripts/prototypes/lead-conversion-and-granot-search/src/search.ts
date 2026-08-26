import {
  jobNumbersEquivalent,
  normalizeJobNo,
} from "../../../../src/services/bookings/bookingIdentity.js";
import type {
  BookingActionEventType,
  GranotSearchCatalog,
  GranotSearchEventClass,
  GranotSearchHit,
  GranotSearchPage,
  GranotSearchQuery,
  SearchCommandRow,
  SearchDecisionRow,
  SearchObservationRow,
} from "./types.js";
import {
  BOOKING_ACTION_EVENT_TYPES,
  GRANOT_SEARCH_EVENT_CLASSES,
} from "./types.js";

export class GranotSearchQueryError extends Error {
  readonly exit_code = 2;
}

export function parseEventClass(
  value: string | undefined,
): GranotSearchEventClass | undefined {
  if (value == null || value === "") return undefined;
  if (
    (GRANOT_SEARCH_EVENT_CLASSES as readonly string[]).includes(value)
  ) {
    return value as GranotSearchEventClass;
  }
  throw new GranotSearchQueryError(
    `Unknown --event ${value}. Use lead_created, priority_updated, or booking_status_changed.`,
  );
}

export function parseBookingActionEventType(
  value: string | undefined,
): BookingActionEventType | undefined {
  if (value == null || value === "") return undefined;
  if ((BOOKING_ACTION_EVENT_TYPES as readonly string[]).includes(value)) {
    return value as BookingActionEventType;
  }
  throw new GranotSearchQueryError(
    `Unknown --booking-action ${value}. Use Booked or Releas.`,
  );
}

export function assertSearchQuery(query: GranotSearchQuery): {
  raw_job_no: string;
  normalized_job_no: string;
  event_class: GranotSearchEventClass | undefined;
  booking_action_event_type: BookingActionEventType | undefined;
} {
  const normalized = normalizeJobNo(query.job_no);
  if (!normalized) {
    throw new GranotSearchQueryError(
      "search requires --job-no with a normalizable Job Number.",
    );
  }
  if (
    query.booking_action_event_type &&
    query.event_class &&
    query.event_class !== "booking_status_changed"
  ) {
    throw new GranotSearchQueryError(
      "--booking-action is only valid with --event booking_status_changed.",
    );
  }
  if (
    query.booking_action_event_type &&
    !query.event_class
  ) {
    throw new GranotSearchQueryError(
      "--booking-action requires --event booking_status_changed.",
    );
  }
  return {
    raw_job_no: query.job_no.trim(),
    normalized_job_no: normalized,
    event_class: query.event_class,
    booking_action_event_type: query.booking_action_event_type,
  };
}

export function observationMatchesJob(
  observation: SearchObservationRow,
  normalizedJobNo: string,
): boolean {
  return jobNumbersEquivalent(
    observation.normalized_job_no,
    normalizedJobNo,
  );
}

export function observationBookingActionEventType(
  observation: SearchObservationRow,
): BookingActionEventType | null {
  const raw =
    observation.payload_event_type_raw?.trim() ||
    observation.booking_action_raw?.trim() ||
    "";
  if (raw === "Booked" || raw === "Releas") return raw;
  if (observation.booking_action_normalized === "booked") return "Booked";
  if (observation.booking_action_normalized === "release") return "Releas";
  return null;
}

export function observationMatchesEvent(
  observation: SearchObservationRow,
  eventClass?: GranotSearchEventClass,
  bookingAction?: BookingActionEventType,
): boolean {
  if (eventClass && observation.route_event_class !== eventClass) {
    return false;
  }
  if (!bookingAction) return true;
  if (observation.route_event_class !== "booking_status_changed") {
    return false;
  }
  return observationBookingActionEventType(observation) === bookingAction;
}

export function latestDecisionForObservation(
  observationId: string,
  decisions: readonly SearchDecisionRow[],
): SearchDecisionRow | null {
  let latest: SearchDecisionRow | null = null;
  for (const decision of decisions) {
    if (decision.observation_id !== observationId) continue;
    if (!latest || decision.attempt > latest.attempt) {
      latest = decision;
    }
  }
  return latest;
}

function commandsForObservation(
  observationId: string,
  commands: readonly SearchCommandRow[],
): SearchCommandRow[] {
  return commands
    .filter((command) => command.observation_id === observationId)
    .sort((left, right) => left.applied_at.localeCompare(right.applied_at));
}

export function searchGranotObservationsAndCommands(
  query: GranotSearchQuery,
  catalog: GranotSearchCatalog,
): GranotSearchPage {
  const parsed = assertSearchQuery(query);
  const hits: GranotSearchHit[] = catalog.observations
    .filter(
      (observation) =>
        observationMatchesJob(observation, parsed.normalized_job_no) &&
        observationMatchesEvent(
          observation,
          parsed.event_class,
          parsed.booking_action_event_type,
        ),
    )
    .sort((left, right) => {
      const time = left.captured_at.localeCompare(right.captured_at);
      return time || left.id.localeCompare(right.id);
    })
    .map((observation) => ({
      observation,
      latest_decision: latestDecisionForObservation(
        observation.id,
        catalog.decisions,
      ),
      commands: commandsForObservation(observation.id, catalog.commands),
    }));

  const observationIds = hits.map((hit) => hit.observation.id);
  const commandIds = hits.flatMap((hit) =>
    hit.commands.map((command) => command.id),
  );

  return {
    query: {
      raw_job_no: parsed.raw_job_no,
      normalized_job_no: parsed.normalized_job_no,
      event_class: parsed.event_class ?? null,
      booking_action_event_type: parsed.booking_action_event_type ?? null,
    },
    hits,
    timeline_seed: {
      normalized_job_no: parsed.normalized_job_no,
      observation_ids: observationIds,
      command_ids: commandIds,
      event_class: parsed.event_class ?? null,
      booking_action_event_type: parsed.booking_action_event_type ?? null,
    },
  };
}
