import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import mongoose from "mongoose";
import { computeAdminActorSignature } from "../services/operationsRegistry/trustedActor";
import { createConversationsAdminRouter } from "./conversations-admin.routes";
import type { LeadConversationDocument } from "../models/LeadConversation";

const SECRET = "synthetic-admin-signing-secret";
const CONVERSATION_ID = "6a761d3d7ceae445794c57bd";
const LEAD_ID = "6a761d3d7ceae445794c57be";

const conversation = {
  _id: new mongoose.Types.ObjectId(CONVERSATION_ID),
  state: "complete",
  direction: "Inbound",
  started_at: new Date("2026-08-07T16:00:00.000Z"),
  duration_seconds: 482,
  match_method: "call_lead_telephony_session",
  match_confidence: "high",
  normalized_job_no: "P5562014",
  receiver_agent_name_snapshot: "Patrick",
  lead_ref: { model: "CallLead", id: new mongoose.Types.ObjectId(LEAD_ID) },
  booking_ref: new mongoose.Types.ObjectId(),
  rc_result: "Accepted",
  telephony_session_id: "s-session",
  call_log_id: "AL0AaWD26IINT41A",
  from_phone_masked: "•••1212",
  to_phone_masked: "•••1000",
  match_evidence: { chosen_reason: "owner_seeded" },
  media: {
    blob_pathname: "conversations/3750152612023.mp3",
    blob_url: "https://blob.example/conversations/3750152612023.mp3",
    bytes: 1665549,
    content_type: "audio/mpeg",
    stored_at: new Date("2026-08-27T00:00:00.000Z"),
    purged_at: null,
  },
  transcript: {
    text: "Redacted transcript",
    model: "gpt-4o-mini-transcribe",
    chars: 19,
    redactions: 0,
    created_at: new Date("2026-08-19T00:00:00.000Z"),
  },
  summary: {
    text: "Conversation overview:\nHello.\n\nMismatch vs CRM:\nThere is no contradiction between the transcript and the CRM record.",
    model: "gpt-4.1-nano",
    prompt_version: "owner-demo-v1",
    created_at: new Date("2026-08-19T00:00:00.000Z"),
  },
  cost_cents: { stt: 3, summary: 0 },
} as unknown as LeadConversationDocument;

const audits: Array<{ eventKey: string; details?: Record<string, unknown> }> = [];

const app = express();
app.use(express.json());
app.use(
  createConversationsAdminRouter({
    connect: async () => undefined,
    list: async () => [
      {
        id: CONVERSATION_ID,
        state: "complete",
        direction: "Inbound",
        started_at: "2026-08-07T16:00:00.000Z",
        duration_seconds: 482,
        match_method: "call_lead_telephony_session",
        match_confidence: "high",
        normalized_job_no: "P5562014",
        receiver_agent_name_snapshot: "Patrick",
        lead_ref: { model: "CallLead", id: LEAD_ID },
        booking_ref: String(conversation.booking_ref),
        has_transcript: true,
        has_summary: true,
        has_mismatch: false,
        cost_cents: { stt: 3, summary: 0 },
      },
    ],
    listByLead: async () => [
      {
        id: CONVERSATION_ID,
        state: "complete",
        direction: "Inbound",
        started_at: "2026-08-07T16:00:00.000Z",
        duration_seconds: 482,
        match_method: "call_lead_telephony_session",
        match_confidence: "high",
        normalized_job_no: "P5562014",
        receiver_agent_name_snapshot: "Patrick",
        lead_ref: { model: "CallLead", id: LEAD_ID },
        booking_ref: String(conversation.booking_ref),
        has_transcript: true,
        has_summary: true,
        has_mismatch: false,
        cost_cents: { stt: 3, summary: 0 },
      },
    ],
    getById: async (id) => (id === CONVERSATION_ID ? conversation : null),
    issueAudioUrl: async () => ({
      url: "https://signed.example/audio",
      expires_at: "2026-08-27T16:05:00.000Z",
      ttl_ms: 300000,
    }),
    auditAudio: async (input) => {
      audits.push({ eventKey: input.eventKey, details: input.details });
      return null;
    },
  }),
);

const server = app.listen(0);
const baseUrl = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

before(() => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = SECRET;
});

afterEach(() => {
  audits.length = 0;
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = SECRET;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error?: Error) => (error ? reject(error) : resolve())),
  );
});

function signedHeaders(role: "owner" | "admin", path: string): Record<string, string> {
  const timestamp = `${Date.now()}`;
  const requestId = `req-conv-${timestamp}`;
  const signature = computeAdminActorSignature(
    {
      adminId: "admin_123",
      email: "owner@example.invalid",
      role,
      timestamp,
      requestId,
      method: "GET",
      path,
    },
    SECRET,
  );
  return {
    "x-vantage-admin-user-id": "admin_123",
    "x-vantage-admin-email": "owner@example.invalid",
    "x-vantage-admin-role": role,
    "x-vantage-admin-request-id": requestId,
    "x-vantage-admin-timestamp": timestamp,
    "x-vantage-admin-signature": signature,
  };
}

test("Owner can read the conversation list without transcript text", async () => {
  const path = "/api/v1/admin/conversations";
  const response = await fetch(`${baseUrl()}${path}`, {
    headers: signedHeaders("owner", path),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { ok: true; data: Array<Record<string, unknown>> };
  assert.equal(body.data[0]?.has_transcript, true);
  assert.equal("transcript" in (body.data[0] ?? {}), false);
  assert.equal(JSON.stringify(body).includes("Redacted transcript"), false);
});

test("by-lead list does not include transcript or summary text", async () => {
  const path = `/api/v1/admin/conversations/by-lead/CallLead/${LEAD_ID}`;
  const response = await fetch(`${baseUrl()}${path}`, {
    headers: signedHeaders("owner", `/api/v1/admin/conversations/by-lead/CallLead/${LEAD_ID}`),
  });
  assert.equal(response.status, 200);
  const raw = await response.text();
  assert.equal(raw.includes("Redacted transcript"), false);
  assert.equal(raw.includes("Patrick priced"), false);
});

test("Owner detail includes the redacted transcript", async () => {
  const path = `/api/v1/admin/conversations/${CONVERSATION_ID}`;
  const response = await fetch(`${baseUrl()}${path}`, {
    headers: signedHeaders("owner", path),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: { transcript: { text: string }; summary: { sections: { mismatch: string | null } } };
  };
  assert.equal(body.data.transcript.text, "Redacted transcript");
  assert.equal(body.data.summary.sections.mismatch, null);
});

test("audio-url writes an audit row and is Owner-only", async () => {
  const path = `/api/v1/admin/conversations/${CONVERSATION_ID}/audio-url`;
  const denied = await fetch(`${baseUrl()}${path}`, {
    headers: signedHeaders("admin", path),
  });
  assert.equal(denied.status, 403);
  assert.equal(audits.length, 0);

  const allowed = await fetch(`${baseUrl()}${path}`, {
    headers: signedHeaders("owner", path),
  });
  assert.equal(allowed.status, 200);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.eventKey, "conversation.audio_url.issued");
});
