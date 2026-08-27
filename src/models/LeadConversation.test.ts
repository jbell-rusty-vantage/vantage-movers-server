import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { LeadConversation, LEAD_CONVERSATION_INDEXES } from "./LeadConversation";

test("LeadConversation unique recording index is the only unique index", () => {
  const unique = LEAD_CONVERSATION_INDEXES.filter((index) => "unique" in index && index.unique);
  assert.equal(unique.length, 1);
  assert.equal(unique[0]?.name, "lead_conversation_recording_unique");
  assert.deepEqual(unique[0]?.key, { provider: 1, provider_recording_id: 1 });
});

test("LeadConversation schema declares the seven contract indexes", () => {
  const declared = new Set(
    LeadConversation.schema.indexes().map((index) => index[1]?.name),
  );
  for (const index of LEAD_CONVERSATION_INDEXES) {
    assert.equal(declared.has(index.name), true, `missing ${index.name}`);
  }
});

test("LeadConversation validates a complete seeded conversation", async () => {
  const conversation = new LeadConversation({
    provider: "ringcentral",
    provider_recording_id: "3750152612023",
    call_log_id: "AL0AaWD26IINT41A",
    telephony_session_id: "s-session",
    lead_ref: { model: "CallLead", id: new mongoose.Types.ObjectId() },
    booking_ref: new mongoose.Types.ObjectId(),
    normalized_job_no: "P5562014",
    match_method: "call_lead_telephony_session",
    match_confidence: "high",
    match_evidence: { chosen_reason: "owner_seeded", candidate_count: 1 },
    direction: "Inbound",
    rc_result: "Accepted",
    started_at: new Date("2026-08-07T16:00:00.000Z"),
    duration_seconds: 482,
    from_phone_masked: "•••1212",
    to_phone_masked: "•••1000",
    state: "complete",
    attempts: 0,
    next_attempt_at: null,
    claimed_by: null,
    claim_expires_at: null,
    last_error: null,
    cost_cents: { stt: 3, summary: 0 },
  });
  await conversation.validate();
  assert.equal(conversation.state, "complete");
  assert.equal(conversation.media, null);
  assert.equal(conversation.transcript, null);
});

test("LeadConversation rejects an invented match method", async () => {
  const conversation = new LeadConversation({
    provider: "ringcentral",
    provider_recording_id: "rec-1",
    call_log_id: "AL1",
    match_method: "guessed_phone",
    match_confidence: "high",
    direction: "Inbound",
    rc_result: "Accepted",
    started_at: new Date(),
    duration_seconds: 120,
    from_phone_masked: "•••0000",
    to_phone_masked: "•••0001",
  });
  await assert.rejects(conversation.validate(), /match_method/);
});
