import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import type { LeadConversationDocument } from "../../models/LeadConversation";
import {
  assertListProjectionSafe,
  toConversationListItem,
} from "./reads";

function seededDocument(): LeadConversationDocument {
  return {
    _id: new mongoose.Types.ObjectId("6a905b5cf7dda52cfacb721e"),
    state: "complete",
    direction: "Inbound",
    started_at: new Date("2026-08-07T16:00:41.844Z"),
    duration_seconds: 482,
    match_method: "call_lead_telephony_session",
    match_confidence: "high",
    normalized_job_no: "P5562014",
    receiver_agent_name_snapshot: "Patrick",
    lead_ref: {
      model: "CallLead",
      id: new mongoose.Types.ObjectId("6a761d3d7ceae445794c57bd"),
    },
    booking_ref: new mongoose.Types.ObjectId("6a7d4e3529d500054c6b5be5"),
    transcript: {
      text: "Redacted transcript with [REDACTED:EMAIL]",
      model: "gpt-4o-mini-transcribe",
      chars: 40,
      redactions: 1,
      created_at: new Date("2026-08-27T15:44:49.460Z"),
    },
    summary: {
      text: "Conversation overview:\nA booked inbound call.",
      model: "gpt-4.1-nano",
      prompt_version: "owner-demo-v1",
      created_at: new Date("2026-08-27T15:44:49.460Z"),
    },
    cost_cents: { stt: 3, summary: 0 },
  } as unknown as LeadConversationDocument;
}

test("list projection keeps cost cents and does not treat them as leaked summary text", () => {
  const item = toConversationListItem(seededDocument());
  assert.doesNotThrow(() => assertListProjectionSafe(item));
  assert.deepEqual(item.cost_cents, { stt: 3, summary: 0 });
  assert.equal(item.has_summary, true);
  assert.equal(item.has_transcript, true);
  assert.equal("transcript" in item, false);
  assert.equal("summary" in item, false);
  assert.equal(JSON.stringify(item).includes("Redacted transcript"), false);
  assert.equal(JSON.stringify(item).includes("booked inbound call"), false);
});

test("list projection still rejects a top-level transcript or summary field", () => {
  const item = toConversationListItem(seededDocument());
  assert.throws(
    () => assertListProjectionSafe({ ...item, summary: { text: "nope" } } as typeof item),
    /leaked summary/,
  );
});
