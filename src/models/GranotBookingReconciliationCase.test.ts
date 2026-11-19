import assert from "node:assert/strict";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import { GranotBookingReconciliationCase } from "./GranotBookingReconciliationCase";

describe("GranotBookingReconciliationCase model", () => {

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
