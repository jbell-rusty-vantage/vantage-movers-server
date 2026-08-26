import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GranotSearchQueryError,
  assertSearchQuery,
  searchGranotObservationsAndCommands,
} from "./search.js";
import type { GranotSearchCatalog, SearchObservationRow } from "./types.js";

function observation(
  overrides: Partial<SearchObservationRow> & Pick<SearchObservationRow, "id">,
): SearchObservationRow {
  return {
    captured_at: "2026-08-21T15:00:00.000Z",
    normalized_job_no: "5562924",
    route_event_class: "priority_updated",
    ...overrides,
  };
}

const catalog: GranotSearchCatalog = {
  observations: [
    observation({
      id: "obs-priority-1",
      captured_at: "2026-08-21T14:36:13.866Z",
      route_event_class: "priority_updated",
      payload_event_type_raw: "priority_update",
      priority_canonical: "1",
    }),
    observation({
      id: "obs-priority-5",
      captured_at: "2026-08-21T15:29:37.645Z",
      route_event_class: "priority_updated",
      payload_event_type_raw: "priority_update",
      priority_canonical: "5",
    }),
    observation({
      id: "obs-booked-1",
      captured_at: "2026-08-21T15:29:39.367Z",
      route_event_class: "booking_status_changed",
      payload_event_type_raw: "Booked",
      booking_action_raw: "Booked",
      booking_action_normalized: "booked",
      priority_canonical: "5",
    }),
    observation({
      id: "obs-releas-1",
      captured_at: "2026-08-21T15:42:04.075Z",
      route_event_class: "booking_status_changed",
      payload_event_type_raw: "Releas",
      booking_action_raw: "Releas",
      booking_action_normalized: "release",
    }),
    observation({
      id: "obs-other-job",
      normalized_job_no: "1111111",
      route_event_class: "lead_created",
      payload_event_type_raw: "lead_created",
    }),
  ],
  decisions: [
    {
      id: "dec-1",
      observation_id: "obs-booked-1",
      attempt: 1,
      outcome: "pending_match",
      reason_code: "pending_source_scoped_match",
      execution_mode: "live",
      decided_at: "2026-08-21T15:29:39.505Z",
    },
    {
      id: "dec-5",
      observation_id: "obs-booked-1",
      attempt: 5,
      outcome: "stale",
      reason_code: "older_than_temporal_winner",
      execution_mode: "live",
      decided_at: "2026-08-21T16:31:13.583Z",
    },
  ],
  commands: [
    {
      id: "cmd-sync",
      command_name: "synchronizeLeadFromGranot",
      observation_id: "obs-booked-1",
      applied_at: "2026-08-21T16:05:16.344Z",
      entity_models: ["CallLead", "GranotRecordLink"],
    },
    {
      id: "cmd-confirm",
      command_name: "confirmGranotBooking",
      observation_id: "obs-booked-1",
      applied_at: "2026-08-26T00:29:50.095Z",
      entity_models: ["BookedLead", "CallLead"],
    },
    {
      id: "cmd-other",
      command_name: "createLeadFromGranot",
      observation_id: "obs-other-job",
      applied_at: "2026-08-21T10:00:00.000Z",
      entity_models: ["FormLead"],
    },
  ],
};

test("blank Job Number is rejected before any search", () => {
  assert.throws(
    () => assertSearchQuery({ job_no: "   " }),
    GranotSearchQueryError,
  );
});

test("Booked / Releas without booking_status_changed is rejected", () => {
  assert.throws(
    () =>
      assertSearchQuery({
        job_no: "5562924",
        event_class: "priority_updated",
        booking_action_event_type: "Booked",
      }),
    /booking_status_changed/,
  );
  assert.throws(
    () =>
      assertSearchQuery({
        job_no: "5562924",
        booking_action_event_type: "Releas",
      }),
    /booking_status_changed/,
  );
});

test("equivalent Job Numbers resolve to the same hit set", () => {
  const prefixed = searchGranotObservationsAndCommands(
    { job_no: "P5562924" },
    catalog,
  );
  const core = searchGranotObservationsAndCommands(
    { job_no: "5562924" },
    catalog,
  );
  assert.equal(prefixed.query.normalized_job_no, "P5562924");
  assert.equal(core.query.normalized_job_no, "5562924");
  assert.deepEqual(
    prefixed.hits.map((hit) => hit.observation.id),
    core.hits.map((hit) => hit.observation.id),
  );
  assert.equal(prefixed.hits.length, 4);
  assert.equal(
    prefixed.hits.some((hit) => hit.observation.id === "obs-other-job"),
    false,
  );
});

test("event class keeps route_event_class, not payload event_type aliases", () => {
  const page = searchGranotObservationsAndCommands(
    { job_no: "5562924", event_class: "priority_updated" },
    catalog,
  );
  assert.deepEqual(
    page.hits.map((hit) => hit.observation.id),
    ["obs-priority-1", "obs-priority-5"],
  );
  assert.equal(
    page.hits.every(
      (hit) => hit.observation.payload_event_type_raw === "priority_update",
    ),
    true,
  );
});

test("booking_status_changed Booked and Releas are two granularities", () => {
  const booked = searchGranotObservationsAndCommands(
    {
      job_no: "5562924",
      event_class: "booking_status_changed",
      booking_action_event_type: "Booked",
    },
    catalog,
  );
  const releas = searchGranotObservationsAndCommands(
    {
      job_no: "5562924",
      event_class: "booking_status_changed",
      booking_action_event_type: "Releas",
    },
    catalog,
  );
  assert.deepEqual(
    booked.hits.map((hit) => hit.observation.id),
    ["obs-booked-1"],
  );
  assert.deepEqual(
    releas.hits.map((hit) => hit.observation.id),
    ["obs-releas-1"],
  );
});

test("Priority 5 is not Booked", () => {
  const page = searchGranotObservationsAndCommands(
    {
      job_no: "5562924",
      event_class: "booking_status_changed",
      booking_action_event_type: "Booked",
    },
    catalog,
  );
  assert.equal(
    page.hits.some((hit) => hit.observation.route_event_class === "priority_updated"),
    false,
  );
});

test("latest Decision attempt only, and commands attach by observation provenance", () => {
  const page = searchGranotObservationsAndCommands(
    {
      job_no: "5562924",
      event_class: "booking_status_changed",
      booking_action_event_type: "Booked",
    },
    catalog,
  );
  const hit = page.hits[0];
  assert.equal(hit?.latest_decision?.id, "dec-5");
  assert.equal(hit?.latest_decision?.attempt, 5);
  assert.deepEqual(
    hit?.commands.map((command) => command.command_name),
    ["synchronizeLeadFromGranot", "confirmGranotBooking"],
  );
  assert.deepEqual(page.timeline_seed.observation_ids, ["obs-booked-1"]);
  assert.deepEqual(page.timeline_seed.command_ids, ["cmd-sync", "cmd-confirm"]);
});

test("a command on another Job does not leak into this Job's timeline seed", () => {
  const page = searchGranotObservationsAndCommands(
    { job_no: "5562924" },
    catalog,
  );
  assert.equal(page.timeline_seed.command_ids.includes("cmd-other"), false);
});
