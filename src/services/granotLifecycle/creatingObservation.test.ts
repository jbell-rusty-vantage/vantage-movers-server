import assert from "node:assert/strict";
import { test } from "node:test";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import {
  getBookingIntakeCreatingObservation,
  selectCreatingObservationEvidence,
  type CreatingObservationLoaders,
} from "./creatingObservation";

const bookedId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const receiptId = "bbbbbbbbbbbbbbbbbbbbbbbb";
const caseId = "cccccccccccccccccccccccc";
const priorityId = "dddddddddddddddddddddddd";
function bookedObservation(
  overrides: Partial<GranotObservationDocument> = {},
): GranotObservationDocument {
  return {
    _id: { toString: () => bookedId },
    receipt_id: { toString: () => receiptId },
    kind: "booking_action_snapshot",
    normalization_result: "valid",
    route_event_class: "booking_status_changed",
    payload_event_type_raw: "Booked",
    captured_at: new Date("2026-08-22T15:00:00.000Z"),
    identity: { job_no_raw: "Synthetic Job 9", normalized_job_no: "SYNTHETIC JOB 9" },
    contact: { first_name: "Ada", last_name: "Owner" },
    move: { move_date: new Date("2026-09-01T00:00:00.000Z") },
    priority: { valid: true, canonical: "5" },
    booking_action: { raw: "Booked", normalized: "booked" },
    display_money: { estimate: { raw: "1200" } },
    agent_identity: { user_raw: "rep" },
    ...overrides,
  } as unknown as GranotObservationDocument;
}

function priorityObservation(): GranotObservationDocument {
  return {
    _id: { toString: () => priorityId },
    receipt_id: { toString: () => "ffffffffffffffffffffffff" },
    kind: "lead_snapshot",
    normalization_result: "valid",
    route_event_class: "priority_updated",
    payload_event_type_raw: "Priority",
    captured_at: new Date("2026-08-22T14:00:00.000Z"),
    identity: { normalized_job_no: "SYNTHETIC JOB 9" },
    contact: {},
    move: {},
    priority: { valid: true, canonical: "5" },
    booking_action: {},
    display_money: {},
    agent_identity: {},
  } as unknown as GranotObservationDocument;
}

test("booking intake selection prefers the latest Booked evidence", () => {
  const selected = selectCreatingObservationEvidence([
    {
      observation_id: "priority-old",
      captured_at: "2026-08-20T10:00:00.000Z",
      action: "priority_5",
    },
    {
      observation_id: "booked-first",
      captured_at: "2026-08-21T09:00:00.000Z",
      action: "booked",
    },
    {
      observation_id: "booked-latest",
      captured_at: "2026-08-22T15:00:00.000Z",
      action: "booked",
    },
    {
      observation_id: "later-priority",
      captured_at: "2026-08-23T12:00:00.000Z",
      action: "priority_5",
    },
  ]);
  assert.deepEqual(selected, {
    item: {
      observation_id: "booked-latest",
      captured_at: "2026-08-22T15:00:00.000Z",
      action: "booked",
    },
    selection: "preferred_booked",
  });
});

test("booking intake selection falls back to the latest creating evidence", () => {
  const selected = selectCreatingObservationEvidence([
    {
      observation_id: "priority-first",
      captured_at: "2026-08-20T10:00:00.000Z",
      action: "priority_5",
    },
    {
      observation_id: "priority-latest",
      captured_at: "2026-08-21T10:00:00.000Z",
      action: "priority_5",
    },
  ]);
  assert.equal(selected?.selection, "latest_creating");
  assert.equal(selected?.item.observation_id, "priority-latest");
});

function loaders(input: {
  evidenceAction?: "booked" | "priority_5";
  observation?: GranotObservationDocument;
  jobObservations?: GranotObservationDocument[];
}): CreatingObservationLoaders {
  const observation = input.observation ?? bookedObservation();
  const byId = new Map(
    [observation, ...(input.jobObservations ?? [])].map((row) => [String(row._id), row]),
  );
  return {
    findBookingCase: async () => ({
      _id: { toString: () => caseId },
      job_no_snapshot: "Synthetic Job 9",
      normalized_job_no: "SYNTHETIC JOB 9",
      evidence: [
        {
          observation_id: String(observation._id),
          captured_at: observation.captured_at,
          action: input.evidenceAction ?? "booked",
        },
      ],
    }),
    findObservation: async (id) => byId.get(id) ?? null,
    findReceipt: async () => ({
      payload: {
        event_type: "Booked",
        job_no: "Synthetic Job 9",
        Authorization: "must-not-surface",
        estimate: "1200",
      },
    }),
    findJobObservations: async () => input.jobObservations ?? [observation],
  };
}

test("booking intake creating observation returns the credential-redacted Booked statement", async () => {
  const result = await getBookingIntakeCreatingObservation(caseId, loaders({}));
  assert.equal(result?.selection, "preferred_booked");
  assert.equal(result?.route_event_class, "booking_status_changed");
  assert.equal(result?.payload_event_type_raw, "Booked");
  assert.equal(result?.booking_action, "booked");
  assert.deepEqual(result?.granot_statement, {
    event_type: "Booked",
    job_no: "Synthetic Job 9",
    estimate: "1200",
  });
  assert.equal(result?.observation.move.move_date, "2026-09-01T00:00:00.000Z");
  assert.equal(JSON.stringify(result).includes("Authorization"), false);
  assert.equal(result?.priority_pairing?.pairing, "booked_carries_priority_5");
});

test("booking intake creating observation is absent for missing booking cases", async () => {
  const result = await getBookingIntakeCreatingObservation("dddddddddddddddddddddddd", {
    findBookingCase: async () => null,
    findObservation: async () => {
      throw new Error("should not load observation");
    },
    findReceipt: async () => {
      throw new Error("should not load receipt");
    },
    findJobObservations: async () => {
      throw new Error("should not load job observations");
    },
  });
  assert.equal(result, null);
});

test("[AC-P1] creating observation includes pairing and the preceding Priority 5 snapshot", async () => {
  const creating = bookedObservation();
  const preceding = priorityObservation();
  const result = await getBookingIntakeCreatingObservation(
    caseId,
    loaders({ observation: creating, jobObservations: [preceding, creating] }),
  );
  assert.equal(result?.priority_pairing?.pairing, "priority_5_then_booked");
  assert.equal(result?.priority_pairing?.preceding_priority_5?.observation_id, priorityId);
  assert.equal(result?.paired_priority_5_observation?.observation_id, priorityId);
  assert.equal(result?.paired_priority_5_observation?.route_event_class, "priority_updated");
  assert.equal(
    result?.paired_priority_5_observation
      && "granot_statement" in result.paired_priority_5_observation,
    false,
  );
  assert.equal((result?.granot_statement as { event_type?: string })?.event_type, "Booked");
  assert.equal(JSON.stringify(result.priority_pairing).includes("Ada"), false);
  assert.equal(JSON.stringify(result.priority_pairing).includes("Authorization"), false);
});

test("[AC-P3] Booked-without-5 still returns 200 with the Booked statement and no paired snapshot", async () => {
  const creating = bookedObservation({ priority: { valid: false } });
  const result = await getBookingIntakeCreatingObservation(
    caseId,
    loaders({ observation: creating, jobObservations: [creating] }),
  );
  assert.equal(result?.priority_pairing?.pairing, "booked_without_priority_5");
  assert.equal(result?.priority_pairing?.creating_booked.priority_is_5, false);
  assert.equal(result?.paired_priority_5_observation, undefined);
  assert.equal((result?.granot_statement as { event_type?: string })?.event_type, "Booked");
});

test("[AC-P6] historical Priority-5-only remains latest_creating with null pairing", async () => {
  const historical = priorityObservation();
  const result = await getBookingIntakeCreatingObservation(
    caseId,
    loaders({
      evidenceAction: "priority_5",
      observation: historical,
      jobObservations: [historical],
    }),
  );
  assert.equal(result?.selection, "latest_creating");
  assert.equal(result?.evidence_action, "priority_5");
  assert.equal(result?.priority_pairing, null);
  assert.equal(result?.paired_priority_5_observation, undefined);
});
