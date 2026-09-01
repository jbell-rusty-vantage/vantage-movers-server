import assert from "node:assert/strict";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import {
  GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES,
  GranotBookingReconciliationCase,
} from "./GranotBookingReconciliationCase";

describe("GranotBookingReconciliationCase model", () => {
  it("[AC-20] declares the exact six named indexes and open partial uniqueness", () => {
    assert.deepEqual(GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES, [
      {
        name: "granot_booking_case_open_job_kind_unique",
        key: { normalized_job_no: 1, action_kind: 1 },
        unique: true,
        partialFilterExpression: { state: "open" },
      },
      {
        name: "granot_booking_case_job_kind_sequence_unique",
        key: { normalized_job_no: 1, action_kind: 1, sequence_number: 1 },
        unique: true,
      },
      {
        name: "granot_booking_case_state_last_evidence",
        key: { state: 1, last_evidence_at: -1 },
      },
      {
        name: "granot_booking_case_booking_state",
        key: { deterministic_booking_id: 1, state: 1 },
      },
      {
        name: "granot_booking_case_suggested_lead_state",
        key: {
          "suggested_lead.lead_ref.model": 1,
          "suggested_lead.lead_ref.id": 1,
          state: 1,
        },
      },
      {
        name: "granot_booking_case_evidence_observation_id",
        key: { "evidence.observation_id": 1 },
      },
    ]);
    const indexes = GranotBookingReconciliationCase.schema.indexes();
    assert.equal(indexes.length, 6);
  });

  it("[AC-18] validates exact defaults, enums, evidence shape, and bounded context", async () => {
    const observationId = new mongoose.Types.ObjectId();
    const decisionId = new mongoose.Types.ObjectId();
    const now = new Date("2026-08-18T12:00:00.000Z");
    const row = new GranotBookingReconciliationCase({
      normalized_job_no: "JOB-22",
      job_no_snapshot: "Job 22",
      mode: "create_missing_booking",
      sequence_number: 1,
      evidence: [{
        observation_id: observationId,
        decision_id: decisionId,
        captured_at: now,
        action: "priority_5",
      }],
      observed_context: { granot_priority: "5" },
      opened_at: now,
      last_evidence_at: now,
    });
    await row.validate();
    assert.equal(row.action_kind, "booked");
    assert.equal(row.state, "open");
    assert.equal(row.case_revision, 1);
    assert.equal(row.evidence_revision, 1);
    const plain = row.toObject();
    assert.deepEqual(Object.keys(plain.evidence[0]!).sort(), [
      "action",
      "captured_at",
      "decision_id",
      "observation_id",
    ]);

    row.mode = "not-a-mode" as never;
    await assert.rejects(row.validate(), /mode/);
  });

  it("[AC-20] rejects mutation of existing evidence IDs and every resolved-row write", async () => {
    const first = new mongoose.Types.ObjectId();
    const row = new GranotBookingReconciliationCase({
      normalized_job_no: "JOB-22",
      job_no_snapshot: "Job 22",
      mode: "create_missing_booking",
      sequence_number: 1,
      evidence: [{
        observation_id: first,
        decision_id: new mongoose.Types.ObjectId(),
        captured_at: new Date(),
        action: "booked",
      }],
      observed_context: {},
      opened_at: new Date(),
      last_evidence_at: new Date(),
    });
    row.isNew = false;
    row.$locals.persisted_state = "resolved";
    row.$locals.persisted_evidence_ids = [String(first)];
    row.state = "open";
    await assert.rejects(row.validate(), /resolved case is immutable/);

    row.$locals.persisted_state = "open";
    row.evidence[0]!.observation_id = new mongoose.Types.ObjectId();
    await assert.rejects(row.validate(), /evidence IDs are immutable/);
  });
});
