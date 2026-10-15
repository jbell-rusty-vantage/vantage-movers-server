import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { CallLead } from "../../models/CallLead";
import { callMoveDateRecovery } from "./callLeadMoveDateRepair";

test("recover only stamped Granot dates for the same Job, newest dated evidence wins, and known dates stay intact", () => {
  const older = new mongoose.Types.ObjectId(), newer = new mongoose.Types.ObjectId(), unrelated = new mongoose.Types.ObjectId();
  const lead = new CallLead({ phone_number: "3055550101", normalized_job_no: "P123",
    current_move_provenance: { source_system: "granot", observation_id: older, changed_at: new Date("2026-10-01") },
    last_accepted_granot_observation: { observation_id: newer, captured_at: new Date("2026-10-02") } });
  const observations = [
    { _id: older, captured_at: new Date("2026-10-01"), normalization_result: "valid", identity: { normalized_job_no: "123" }, move: { move_date: new Date("2026-11-01") } },
    { _id: newer, captured_at: new Date("2026-10-02"), normalization_result: "valid", identity: { normalized_job_no: "Q123" }, move: { move_date: new Date("2026-11-02") } },
    { _id: unrelated, captured_at: new Date("2026-10-03"), normalization_result: "valid", identity: { normalized_job_no: "123" }, move: { move_date: new Date("2026-11-03") } },
  ];
  assert.equal(callMoveDateRecovery(lead, observations)?.observation_id, String(newer));
  assert.equal(callMoveDateRecovery(lead, [{ ...observations[1]!, move: {} }, observations[0]!])?.observation_id, String(older));
  assert.equal(callMoveDateRecovery(lead, [{ ...observations[1]!, identity: { normalized_job_no: "999" } }]), null);
  assert.equal(callMoveDateRecovery(lead, [{ ...observations[1]!, normalization_result: "invalid" }]), null);
  assert.equal(callMoveDateRecovery(lead, [observations[2]!]), null);
  lead.move_date = new Date("2026-12-01");
  assert.equal(callMoveDateRecovery(lead, observations), null);
});
