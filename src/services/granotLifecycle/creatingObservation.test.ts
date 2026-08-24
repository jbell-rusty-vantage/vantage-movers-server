import assert from "node:assert/strict";
import { test } from "node:test";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import {
  getBookingIntakeCreatingObservation,
  selectCreatingObservationEvidence,
  type CreatingObservationLoaders,
} from "./creatingObservation";

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

test("booking intake creating observation returns the credential-redacted Booked statement", async () => {
  const observationId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const receiptId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const loaders: CreatingObservationLoaders = {
    findBookingCase: async () => ({
      _id: { toString: () => "cccccccccccccccccccccccc" },
      job_no_snapshot: "Synthetic Job 9",
      normalized_job_no: "SYNTHETIC JOB 9",
      evidence: [
        {
          observation_id: observationId,
          captured_at: new Date("2026-08-22T15:00:00.000Z"),
          action: "booked",
        },
      ],
    }),
    findObservation: async () =>
      ({
        _id: { toString: () => observationId },
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
      }) as unknown as GranotObservationDocument,
    findReceipt: async () => ({
      payload: {
        event_type: "Booked",
        job_no: "Synthetic Job 9",
        Authorization: "must-not-surface",
        estimate: "1200",
      },
    }),
  };

  const result = await getBookingIntakeCreatingObservation(
    "cccccccccccccccccccccccc",
    loaders,
  );
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
  });
  assert.equal(result, null);
});
