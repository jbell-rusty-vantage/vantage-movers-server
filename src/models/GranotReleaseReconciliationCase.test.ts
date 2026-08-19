import assert from "node:assert/strict";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import {
  GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES,
  GranotReleaseReconciliationCase,
} from "./GranotReleaseReconciliationCase";

describe("GranotReleaseReconciliationCase model", () => {
  it("[AC-25][AC-36] requires deterministic Booking identity and declares the five Release indexes", async () => {
    assert.deepEqual(GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES, [
      {
        name: "granot_release_case_open_job_kind_unique",
        key: { normalized_job_no: 1, action_kind: 1 },
        unique: true,
        partialFilterExpression: { state: "open" },
      },
      {
        name: "granot_release_case_job_kind_sequence_unique",
        key: { normalized_job_no: 1, action_kind: 1, sequence_number: 1 },
        unique: true,
      },
      {
        name: "granot_release_case_state_last_evidence",
        key: { state: 1, last_evidence_at: -1 },
      },
      {
        name: "granot_release_case_booking_state",
        key: { deterministic_booking_id: 1, state: 1 },
      },
      {
        name: "granot_release_case_suggested_lead_state",
        key: {
          "suggested_lead.lead_ref.model": 1,
          "suggested_lead.lead_ref.id": 1,
          state: 1,
        },
      },
    ]);
    assert.equal(GranotReleaseReconciliationCase.schema.indexes().length, 5);

    const now = new Date("2026-08-19T12:00:00.000Z");
    const valid = new GranotReleaseReconciliationCase({
      normalized_job_no: "U26-ACTIVE-1",
      job_no_snapshot: "U26 Active 1",
      sequence_number: 1,
      deterministic_booking_id: new mongoose.Types.ObjectId(),
      booking_revision_at_open: 4,
      evidence: [{
        observation_id: new mongoose.Types.ObjectId(),
        decision_id: new mongoose.Types.ObjectId(),
        captured_at: now,
        action: "release",
      }],
      observed_context: {},
      opened_at: now,
      last_evidence_at: now,
    });
    await valid.validate();
    assert.equal(valid.action_kind, "release");
    assert.equal(valid.state, "open");
    assert.equal(valid.case_revision, 1);
    assert.equal(valid.evidence_revision, 1);
    const plain = valid.toObject() as Record<string, unknown>;
    assert.equal("mode" in plain, false);
    assert.deepEqual(Object.keys((plain.evidence as Array<Record<string, unknown>>)[0]!).sort(), [
      "action",
      "captured_at",
      "decision_id",
      "observation_id",
    ]);

    const missingBooking = new GranotReleaseReconciliationCase({
      normalized_job_no: "U26-MISSING-BOOKING",
      job_no_snapshot: "U26 Missing Booking",
      sequence_number: 1,
      booking_revision_at_open: 1,
      evidence: [{
        observation_id: new mongoose.Types.ObjectId(),
        decision_id: new mongoose.Types.ObjectId(),
        captured_at: now,
        action: "release",
      }],
      observed_context: {},
      opened_at: now,
      last_evidence_at: now,
    });
    await assert.rejects(missingBooking.validate(), /deterministic_booking_id/);

    valid.evidence[0]!.action = "booked" as never;
    await assert.rejects(valid.validate(), /evidence.*action|action/i);
  });

  it("[AC-35][AC-36] strips forbidden transport fields and enforces revisions plus immutable guards", async () => {
    const first = new mongoose.Types.ObjectId();
    const now = new Date("2026-08-19T13:00:00.000Z");
    const row = new GranotReleaseReconciliationCase({
      normalized_job_no: "U26-GUARDS",
      job_no_snapshot: "U26 Guards",
      sequence_number: 1,
      deterministic_booking_id: new mongoose.Types.ObjectId(),
      booking_revision_at_open: 0,
      evidence: [{
        observation_id: first,
        decision_id: new mongoose.Types.ObjectId(),
        captured_at: now,
        action: "release",
        payload: { forbidden: true },
        headers: { authorization: "forbidden" },
      }],
      observed_context: {},
      payload: { forbidden: true },
      headers: { authorization: "forbidden" },
      opened_at: now,
      last_evidence_at: now,
    });
    await row.validate();
    const plain = row.toObject() as Record<string, unknown>;
    assert.equal("payload" in plain, false);
    assert.equal("headers" in plain, false);
    assert.equal("payload" in (plain.evidence as Array<Record<string, unknown>>)[0]!, false);
    assert.equal("headers" in (plain.evidence as Array<Record<string, unknown>>)[0]!, false);

    row.sequence_number = 0;
    await assert.rejects(row.validate(), /sequence_number/);
    row.sequence_number = 1;
    row.booking_revision_at_open = -1;
    await assert.rejects(row.validate(), /booking_revision_at_open/);
    row.booking_revision_at_open = 0;

    row.isNew = false;
    row.$locals.persisted_state = "resolved";
    row.$locals.persisted_evidence_ids = [String(first)];
    await assert.rejects(row.validate(), /resolved Release case is immutable/);
    row.$locals.persisted_state = "open";
    row.evidence[0]!.observation_id = new mongoose.Types.ObjectId();
    await assert.rejects(row.validate(), /evidence IDs are immutable/);

    const id = new mongoose.Types.ObjectId();
    await assert.rejects(
      GranotReleaseReconciliationCase.updateOne(
        { _id: id },
        { $set: { last_evidence_at: now } },
      ).exec(),
      /must guard on open state/,
    );
    await assert.rejects(
      GranotReleaseReconciliationCase.replaceOne(
        { _id: id, state: "open" },
        { normalized_job_no: "REPLACEMENT" },
      ).exec(),
      /cannot be replaced directly/,
    );
  });
});
