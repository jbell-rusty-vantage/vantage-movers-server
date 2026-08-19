import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import mongoose from "mongoose";
import { computeAdminActorSignature } from "../services/operationsRegistry/trustedActor";
import { GRANOT_LIFECYCLE_ERROR_CODES } from "../services/granotLifecycle/errors";
import { createGranotLifecycleAdminRouter } from "./granot-lifecycle-admin.routes";

const SECRET = "synthetic-admin-signing-secret";
const receiptId = new mongoose.Types.ObjectId().toHexString();
let lastRequeue: { id: string; reason: string; role: string } | null = null;
let lastCaseQuery: Record<string, unknown> | null = null;
let lastCandidateQuery: Record<string, unknown> | null = null;
let lastConfirm: Record<string, unknown> | null = null;

const app = express();
app.use(express.json());
app.use(
  createGranotLifecycleAdminRouter({
    connect: async () => undefined,
    requeue: async (input, actor) => {
      lastRequeue = { id: input.id, reason: input.reason, role: actor.actorRole };
      return {
        receipt_id: input.id,
        state: "pending",
        next_attempt_at: "2026-08-17T18:00:00.000Z",
        manual_requeue_count: 1,
        match_attempt: 2,
        payload_sha256: "d".repeat(64),
      };
    },
    listCases: async (query) => {
      lastCaseQuery = query;
      return { items: [], next_cursor: null };
    },
    getCaseDetail: async (caseId) => caseId === receiptId ? {
      case_id: caseId,
      kind: "booking",
      state: "open",
      mode: "create_missing_booking",
      sequence_number: 1,
      case_revision: 1,
      evidence_revision: 1,
      normalized_job_no: "SYNTHETIC 100",
      job_no: "synthetic-100",
      opened_at: "2026-08-17T16:00:00.000Z",
      last_evidence_at: "2026-08-17T16:00:00.000Z",
      evidence: [],
      observed_context: { section_label: "Granot evidence — not official Vantage values" },
      contacts: {},
      candidate_search: { available: true, default_scope: "source", all_scope_warning: true },
      official_current: {},
      official_draft: {},
      timeline: {
        items: [], next_cursor: null, current: {},
        capabilities: { booking_cases: true, release_cases: false, discrepancies: false, official_facts: true },
      },
      capabilities: { commands: false, referral: false, release_cases: false, discrepancies: false },
    } : null,
    listCandidates: async (caseId, query) => {
      lastCandidateQuery = query;
      return caseId === receiptId ? { items: [], next_cursor: null } : null;
    },
    projectLeadTimeline: async (_model, leadId) => leadId === receiptId ? {
      items: [], next_cursor: null, current: {},
      capabilities: { booking_cases: true, release_cases: false, discrepancies: false, official_facts: true },
    } : null,
    projectJob: async () => ({
      items: [], next_cursor: null, current: {},
      capabilities: { booking_cases: true, release_cases: false, discrepancies: false, official_facts: true },
    }),
    confirmBooking: async (input) => {
      lastConfirm = input as unknown as Record<string, unknown>;
      return {
        case_id: input.case_id,
        case_state: "resolved",
        case_revision: 2,
        outcome: "booking_created",
        command_execution_id: new mongoose.Types.ObjectId().toHexString(),
        decision_id: new mongoose.Types.ObjectId().toHexString(),
        booking_ref: { id: new mongoose.Types.ObjectId().toHexString(), domain_revision: 1 },
        record_link_ref: { id: new mongoose.Types.ObjectId().toHexString(), domain_revision: 1 },
        entity_refs: [],
        replayed: false,
      };
    },
  }),
);

let baseUrl = "";
let server: ReturnType<typeof app.listen>;
const originalSecret = process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET;

before(async () => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = SECRET;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (originalSecret === undefined) delete process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET;
  else process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = originalSecret;
  await new Promise<void>((resolve, reject) =>
    server.close((error?: Error) => (error ? reject(error) : resolve())),
  );
});

afterEach(() => {
  lastRequeue = null;
  lastCaseQuery = null;
  lastCandidateQuery = null;
  lastConfirm = null;
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = SECRET;
});

function signedHeaders(
  role: "owner" | "admin",
  path: string,
  method: "GET" | "POST" = "POST",
): Record<string, string> {
  const timestamp = `${Date.now()}`;
  const requestId = `req-requeue-${timestamp}`;
  const signature = computeAdminActorSignature(
    {
      adminId: "admin_123",
      email: "owner@example.invalid",
      role,
      timestamp,
      requestId,
      method,
      path,
    },
    SECRET,
  );
  return {
    "content-type": "application/json",
    "x-vantage-admin-user-id": "admin_123",
    "x-vantage-admin-email": "owner@example.invalid",
    "x-vantage-admin-role": role,
    "x-vantage-admin-request-id": requestId,
    "x-vantage-admin-timestamp": timestamp,
    "x-vantage-admin-signature": signature,
  };
}

test("[AC-37] Owner requeue route returns 200 {ok:true,data}", async () => {
  const path = `/api/v1/admin/granot-lifecycle/receipts/${receiptId}/requeue`;
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: signedHeaders("owner", path),
    body: JSON.stringify({ reason: "Owner requeue of synthetic dead-lettered receipt" }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; data: { state: string } };
  assert.equal(body.ok, true);
  assert.equal(body.data.state, "pending");
  assert.equal(lastRequeue?.role, "owner");
  assert.equal(lastRequeue?.id, receiptId);
});

test("[AC-37] Admin without Owner cannot requeue", async () => {
  const path = `/api/v1/admin/granot-lifecycle/receipts/${receiptId}/requeue`;
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: signedHeaders("admin", path),
    body: JSON.stringify({ reason: "Admin must not requeue dead-lettered work" }),
  });
  assert.equal(response.status, 403);
  const body = (await response.json()) as { code: string };
  assert.equal(body.code, GRANOT_LIFECYCLE_ERROR_CODES.OWNER_REQUIRED);
  assert.equal(lastRequeue, null);
});

test("[AC-37] invalid requeue body is GRANOT_VALIDATION_FAILED", async () => {
  const path = `/api/v1/admin/granot-lifecycle/receipts/${receiptId}/requeue`;
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: signedHeaders("owner", path),
    body: JSON.stringify({ reason: "short", payload: { secret: true } }),
  });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { code: string };
  assert.equal(body.code, GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED);
});

test("[AC-18] [AC-19] read list applies the exact default queue for Owner/Admin", async () => {
  const path = "/api/v1/admin/granot-lifecycle/cases";
  for (const role of ["owner", "admin"] as const) {
    const response = await fetch(`${baseUrl}${path}`, { headers: signedHeaders(role, path, "GET") });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean; data: { items: unknown[] } };
    assert.equal(body.ok, true);
    assert.deepEqual(body.data.items, []);
    assert.equal(lastCaseQuery?.state, "open");
    assert.equal(lastCaseQuery?.sort, "last_evidence_at");
    assert.equal(lastCaseQuery?.order, "desc");
    assert.equal(lastCaseQuery?.limit, 25);
  }
});

test("[AC-35] unsigned lifecycle reads are denied before projection", async () => {
  const path = "/api/v1/admin/granot-lifecycle/cases";
  const response = await fetch(`${baseUrl}${path}`);
  assert.equal(response.status, 403);
  assert.equal(lastCaseQuery, null);
});

test("[AC-35] strict case filters reject unknown keys with a safe 400", async () => {
  const path = "/api/v1/admin/granot-lifecycle/cases?payload=forbidden";
  const response = await fetch(`${baseUrl}${path}`, { headers: signedHeaders("owner", path, "GET") });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { code: string; error: string };
  assert.equal(body.code, GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED);
  assert.equal(body.error, "Invalid request");
});

test("[AC-35] [AC-39] case detail has safe 404 and exact read envelope", async () => {
  const foundPath = `/api/v1/admin/granot-lifecycle/cases/${receiptId}`;
  const found = await fetch(`${baseUrl}${foundPath}`, { headers: signedHeaders("admin", foundPath, "GET") });
  assert.equal(found.status, 200);
  const foundBody = (await found.json()) as { data: { observed_context: { section_label: string } } };
  assert.equal(foundBody.data.observed_context.section_label, "Granot evidence — not official Vantage values");

  const missingId = new mongoose.Types.ObjectId().toHexString();
  const missingPath = `/api/v1/admin/granot-lifecycle/cases/${missingId}`;
  const missing = await fetch(`${baseUrl}${missingPath}`, { headers: signedHeaders("admin", missingPath, "GET") });
  assert.equal(missing.status, 404);
  const missingBody = (await missing.json()) as { code: string };
  assert.equal(missingBody.code, GRANOT_LIFECYCLE_ERROR_CODES.CASE_NOT_FOUND);
});

test("[AC-35] candidate browser is Owner-only for source and all scope and performs a read", async () => {
  const path = `/api/v1/admin/granot-lifecycle/cases/${receiptId}/candidates?scope=all&q=synthetic`;
  const denied = await fetch(`${baseUrl}${path}`, { headers: signedHeaders("admin", path, "GET") });
  assert.equal(denied.status, 403);

  const allowed = await fetch(`${baseUrl}${path}`, { headers: signedHeaders("owner", path, "GET") });
  assert.equal(allowed.status, 200);
  const observed = lastCandidateQuery as Record<string, unknown> | null;
  assert.ok(observed);
  assert.equal(observed.scope, "all");
  assert.equal(observed.q, "synthetic");
  assert.equal(observed.limit, 25);
});

test("[AC-40] Lead timeline validates model/ID and preserves generic missing Lead envelope", async () => {
  const foundPath = `/api/v1/admin/leads/FormLead/${receiptId}/lifecycle`;
  const found = await fetch(`${baseUrl}${foundPath}`, { headers: signedHeaders("admin", foundPath, "GET") });
  assert.equal(found.status, 200);

  const missingId = new mongoose.Types.ObjectId().toHexString();
  const missingPath = `/api/v1/admin/leads/CallLead/${missingId}/lifecycle`;
  const missing = await fetch(`${baseUrl}${missingPath}`, { headers: signedHeaders("admin", missingPath, "GET") });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { ok: false, error: "Lead not found" });
});

test("[AC-20] Job timeline is readable by Admin and strictly bounds pagination", async () => {
  const path = "/api/v1/admin/granot-lifecycle/jobs/synthetic-100?limit=200";
  const response = await fetch(`${baseUrl}${path}`, { headers: signedHeaders("admin", path, "GET") });
  assert.equal(response.status, 200);
  const invalidPath = "/api/v1/admin/granot-lifecycle/jobs/synthetic-100?limit=201";
  const invalid = await fetch(`${baseUrl}${invalidPath}`, { headers: signedHeaders("admin", invalidPath, "GET") });
  assert.equal(invalid.status, 400);
});

const confirmBody = {
  expected_case_revision: 1,
  selected_lead: { lead_model: "FormLead", lead_id: new mongoose.Types.ObjectId().toHexString() },
  official_booking_details: {
    book_date: "2026-08-19",
    agent_allocations: [{ agent_id: new mongoose.Types.ObjectId().toHexString(), binder_amount: 10 }],
    total_binder_amount: 10,
    deposit_amount: 100,
    merchant_id: new mongoose.Types.ObjectId().toHexString(),
  },
};

test("[AC-21] [AC-22] Owner confirm route requires one idempotency header and returns 201", async () => {
  const path = `/api/v1/admin/granot-lifecycle/booking-cases/${receiptId}/confirm-booking`;
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { ...signedHeaders("owner", path), "Idempotency-Key": "unit24-attempt-1" },
    body: JSON.stringify(confirmBody),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json() as { ok: boolean }).ok, true);
  assert.equal(lastConfirm?.case_id, receiptId);
  assert.equal(lastConfirm?.idempotency_key, "unit24-attempt-1");

  lastConfirm = null;
  const missing = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: signedHeaders("owner", path),
    body: JSON.stringify(confirmBody),
  });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json() as { code: string }).code, GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED);
  assert.equal(lastConfirm, null);
});

test("[AC-22] Admin cannot invoke confirm Booking", async () => {
  const path = `/api/v1/admin/granot-lifecycle/booking-cases/${receiptId}/confirm-booking`;
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { ...signedHeaders("admin", path), "Idempotency-Key": "unit24-attempt-2" },
    body: JSON.stringify(confirmBody),
  });
  assert.equal(response.status, 403);
  assert.equal(lastConfirm, null);
});
