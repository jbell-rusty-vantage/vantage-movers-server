import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import mongoose from "mongoose";
import { computeAdminActorSignature } from "../services/operationsRegistry/trustedActor";
import { GRANOT_LIFECYCLE_ERROR_CODES } from "../services/granotLifecycle/errors";
import { createGranotLifecycleAdminRouter } from "./granot-lifecycle-admin.routes";

const SECRET = "synthetic-admin-signing-secret";
const HEALTH_FIXTURE = {
  generated_at: "2026-08-19T16:00:00.000Z",
  flags: {
    GRANOT_LIFECYCLE_PROCESSING_ENABLED: true,
    GRANOT_LIFECYCLE_SHADOW_MODE: true,
    GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED: false,
    GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED: false,
    GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED: false,
    GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED: false,
    GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED: false,
    GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED: false,
    GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED: false,
    GRANOT_LIFECYCLE_EMAIL_ENABLED: false,
  },
  activation: { present: false },
  receipts: {
    by_work_state: { pending: 0, claimed: 0, retry_scheduled: 0, completed: 0, dead_letter: 0 },
    due_count: 0,
    oldest_due_at: null,
    oldest_due_age_ms: null,
    claimed_count: 0,
    expired_claim_count: 0,
    dead_letter_count: 0,
  },
  decisions_last_24h: [
    { execution_mode: "historical_shadow" as const, outcome: "already_current" as const, reason_code: "desired_state_already_current" as const, count: 2 },
  ],
  open_cases: [],
  open_discrepancies: [],
  command_conflicts_last_24h: [],
  record_links: { active: 0, disputed: 0 },
  last_queue_run: null,
  last_cron_run: null,
  ringcentral: {
    state_present: false,
    last_run_at: null,
    last_run_status: null,
    cursor_to: null,
    lease: { held: false, acquired_at: null, expires_at: null, age_ms: null, expired: false },
    last_runtime_ms: null,
    last_adopted_count: null,
    last_adoption_conflict_count: null,
    last_throttled_count: null,
  },
  alerts: [
    { code: "dead_letter_present" as const, state: "ok" as const, observed_value: 0, threshold: 0, unit: "count" as const },
  ],
};
const receiptId = new mongoose.Types.ObjectId().toHexString();
let lastRequeue: { id: string; reason: string; role: string } | null = null;
let lastCaseQuery: Record<string, unknown> | null = null;
let lastCandidateQuery: Record<string, unknown> | null = null;
let lastCreatingObservationCaseId: string | null = null;
let lastConfirm: Record<string, unknown> | null = null;
let lastReferralCreate: Record<string, unknown> | null = null;
let lastUpdate: Record<string, unknown> | null = null;
let lastNoAction: Record<string, unknown> | null = null;
let lastReleaseCancellation: Record<string, unknown> | null = null;
let lastReleaseUpdate: Record<string, unknown> | null = null;
let lastReleaseNoAction: Record<string, unknown> | null = null;
let lastDiscrepancyAction: Record<string, unknown> | null = null;
let lastDiscrepancyQuery: Record<string, unknown> | null = null;

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
      priority_pairing: null,
    } : null,
    getCreatingObservation: async (caseId) => {
      lastCreatingObservationCaseId = caseId;
      return caseId === receiptId ? {
        case_id: caseId,
        job_no: "synthetic-100",
        normalized_job_no: "SYNTHETIC 100",
        observation_id: receiptId,
        receipt_id: receiptId,
        captured_at: "2026-08-17T16:00:00.000Z",
        route_event_class: "booking_status_changed",
        payload_event_type_raw: "Booked",
        booking_action: "booked",
        evidence_action: "booked",
        selection: "preferred_booked",
        observation: {
          observation_id: receiptId,
          receipt_id: receiptId,
          captured_at: "2026-08-17T16:00:00.000Z",
          identity: {},
          contact: {},
          move: {},
          priority: { valid: true },
          booking_action: { normalized: "booked" },
          display_money: {},
          agent_identity: {},
        },
        granot_statement: { event_type: "Booked", job_no: "synthetic-100" },
        priority_pairing: null,
      } : null;
    },
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
    createReferralBooking: async (input) => {
      lastReferralCreate = input as unknown as Record<string, unknown>;
      return {
        case_id: input.case_id,
        case_state: "resolved",
        case_revision: 2,
        outcome: "referral_booking_created",
        command_execution_id: new mongoose.Types.ObjectId().toHexString(),
        decision_id: new mongoose.Types.ObjectId().toHexString(),
        booking_ref: { id: new mongoose.Types.ObjectId().toHexString(), domain_revision: 1 },
        record_link_ref: { id: new mongoose.Types.ObjectId().toHexString(), domain_revision: 1 },
        entity_refs: [],
        replayed: false,
      };
    },
    updateBooking: async (input) => {
      lastUpdate = input as unknown as Record<string, unknown>;
      return {
        case_id: input.case_id,
        case_state: "resolved",
        case_revision: 2,
        outcome: "booking_updated",
        command_execution_id: new mongoose.Types.ObjectId().toHexString(),
        decision_id: new mongoose.Types.ObjectId().toHexString(),
        booking_ref: { id: new mongoose.Types.ObjectId().toHexString(), domain_revision: 2 },
        entity_refs: [],
        replayed: false,
      };
    },
    noAction: async (input) => {
      lastNoAction = input as unknown as Record<string, unknown>;
      return {
        case_id: input.case_id,
        case_state: "resolved",
        case_revision: 2,
        outcome: "no_action",
        command_execution_id: new mongoose.Types.ObjectId().toHexString(),
        decision_id: new mongoose.Types.ObjectId().toHexString(),
        entity_refs: [],
        replayed: false,
      };
    },
    confirmCancellation: async (input) => {
      lastReleaseCancellation = input as unknown as Record<string, unknown>;
      return {
        case_id: input.case_id,
        case_state: "resolved",
        case_revision: 2,
        outcome: "cancellation_created",
        command_execution_id: new mongoose.Types.ObjectId().toHexString(),
        decision_id: new mongoose.Types.ObjectId().toHexString(),
        booking_ref: { id: new mongoose.Types.ObjectId().toHexString(), domain_revision: 2 },
        cancellation_ref: { id: new mongoose.Types.ObjectId().toHexString(), domain_revision: 1 },
        entity_refs: [],
        replayed: false,
      };
    },
    updateReleaseBooking: async (input) => {
      lastReleaseUpdate = input as unknown as Record<string, unknown>;
      return {
        case_id: input.case_id,
        case_state: "resolved",
        case_revision: 2,
        outcome: "booking_updated",
        command_execution_id: new mongoose.Types.ObjectId().toHexString(),
        decision_id: new mongoose.Types.ObjectId().toHexString(),
        booking_ref: { id: new mongoose.Types.ObjectId().toHexString(), domain_revision: 2 },
        entity_refs: [],
        replayed: false,
      };
    },
    releaseNoAction: async (input) => {
      lastReleaseNoAction = input as unknown as Record<string, unknown>;
      return {
        case_id: input.case_id,
        case_state: "resolved",
        case_revision: 2,
        outcome: "no_action",
        command_execution_id: new mongoose.Types.ObjectId().toHexString(),
        decision_id: new mongoose.Types.ObjectId().toHexString(),
        booking_ref: { id: new mongoose.Types.ObjectId().toHexString(), domain_revision: 1 },
        entity_refs: [],
        replayed: false,
      };
    },
    listDiscrepancies: async (query) => {
      lastDiscrepancyQuery = query;
      return { items: [], next_cursor: null };
    },
    getDiscrepancyDetail: async (id) => ({
      discrepancy_id: id, kind: "booking", state: "open", reason_code: "booked_record_link_conflict",
      normalized_job_no: "SYNTHETIC JOB 29", masked_contact_label: "Contact masked", evidence_count: 1,
      revision: 1, evidence_revision: 1, opened_at: "2026-08-19T12:00:00.000Z", last_evidence_at: "2026-08-19T12:00:00.000Z",
      reason_fingerprint: "f".repeat(64), evidence: [], candidates: [], capabilities: { re_evaluate: true, correct_record_link: false, no_action: true },
    }),
    reEvaluateDiscrepancy: async (input) => discrepancyResult(input, "still_conflicting"),
    correctRecordLink: async (input) => discrepancyResult(input, "record_link_corrected"),
    discrepancyNoAction: async (input) => discrepancyResult(input, "no_action"),
    projectHealth: async () => HEALTH_FIXTURE,
  }),
);

function discrepancyResult(input: { discrepancy_id: string } & Record<string, unknown>, outcome: "still_conflicting" | "record_link_corrected" | "no_action") {
  lastDiscrepancyAction = input;
  return { discrepancy_id: input.discrepancy_id, discrepancy_kind: "booking" as const, state: outcome === "still_conflicting" ? "open" as const : "resolved" as const,
    revision: outcome === "still_conflicting" ? 1 : 2, evidence_revision: 1, outcome, command_execution_id: new mongoose.Types.ObjectId().toHexString(), replayed: false };
}

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
  lastCreatingObservationCaseId = null;
  lastConfirm = null;
  lastUpdate = null;
  lastNoAction = null;
  lastReleaseCancellation = null;
  lastReleaseUpdate = null;
  lastReleaseNoAction = null;
  lastDiscrepancyAction = null;
  lastDiscrepancyQuery = null;
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

test("[AC-25][AC-35] read list forwards the explicit Release discriminants", async () => {
  const path = "/api/v1/admin/granot-lifecycle/cases?kind=release&mode=release&state=open";
  const response = await fetch(`${baseUrl}${path}`, { headers: signedHeaders("admin", path, "GET") });
  assert.equal(response.status, 200);
  assert.equal(lastCaseQuery?.kind, "release");
  assert.equal(lastCaseQuery?.mode, "release");
  assert.equal(lastCaseQuery?.state, "open");
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

test("creating observation is Owner-only and returns the Booked statement for a booking case", async () => {
  const path = `/api/v1/admin/granot-lifecycle/cases/${receiptId}/creating-observation`;
  const denied = await fetch(`${baseUrl}${path}`, { headers: signedHeaders("admin", path, "GET") });
  assert.equal(denied.status, 403);
  assert.equal(lastCreatingObservationCaseId, null);

  const allowed = await fetch(`${baseUrl}${path}`, { headers: signedHeaders("owner", path, "GET") });
  assert.equal(allowed.status, 200);
  const body = (await allowed.json()) as {
    ok: boolean;
    data: { selection: string; granot_statement: { event_type: string } };
  };
  assert.equal(body.ok, true);
  assert.equal(body.data.selection, "preferred_booked");
  assert.equal(body.data.granot_statement.event_type, "Booked");
  assert.equal(lastCreatingObservationCaseId, receiptId);

  const missingId = new mongoose.Types.ObjectId().toHexString();
  const missingPath = `/api/v1/admin/granot-lifecycle/cases/${missingId}/creating-observation`;
  const missing = await fetch(`${baseUrl}${missingPath}`, { headers: signedHeaders("owner", missingPath, "GET") });
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

test("[AC-35][AC-36] discrepancy list/detail are signed reads with strict filters", async () => {
  const listPath = "/api/v1/admin/granot-lifecycle/discrepancies?kind=booking&state=open";
  const list = await fetch(`${baseUrl}${listPath}`, { headers: signedHeaders("admin", listPath, "GET") });
  assert.equal(list.status, 200);
  assert.equal(lastDiscrepancyQuery?.kind, "booking");
  assert.equal(lastDiscrepancyQuery?.state, "open");
  const detailPath = `/api/v1/admin/granot-lifecycle/discrepancies/${receiptId}`;
  const detail = await fetch(`${baseUrl}${detailPath}`, { headers: signedHeaders("admin", detailPath, "GET") });
  assert.equal(detail.status, 200);
  assert.equal((await detail.json() as { data: { masked_contact_label: string } }).data.masked_contact_label, "Contact masked");
  const invalidPath = "/api/v1/admin/granot-lifecycle/discrepancies?contact=forbidden";
  assert.equal((await fetch(`${baseUrl}${invalidPath}`, { headers: signedHeaders("owner", invalidPath, "GET") })).status, 400);
});

test("[AC-23][AC-36] discrepancy commands are Owner-only, strict, and route-own identity", async () => {
  for (const [action, body] of [
    ["re-evaluate", { expected_revision: 1 }],
    ["correct-record-link", { expected_revision: 1, expected_link_revision: 0, selected_lead: { lead_model: "FormLead", lead_id: receiptId }, reason_text: "Owner reviewed corrected Lead" }],
    ["no-action", { expected_revision: 1 }],
  ] as const) {
    const path = `/api/v1/admin/granot-lifecycle/discrepancies/${receiptId}/${action}`;
    const denied = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { ...signedHeaders("admin", path), "Idempotency-Key": `unit29-${action}` }, body: JSON.stringify(body) });
    assert.equal(denied.status, 403);
    const allowed = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { ...signedHeaders("owner", path), "Idempotency-Key": `unit29-${action}` }, body: JSON.stringify(body) });
    assert.equal(allowed.status, 200);
    assert.equal(lastDiscrepancyAction?.discrepancy_id, receiptId);
    assert.equal(lastDiscrepancyAction?.idempotency_key, `unit29-${action}`);
  }
  const path = `/api/v1/admin/granot-lifecycle/discrepancies/${receiptId}/re-evaluate`;
  const invalid = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { ...signedHeaders("owner", path), "Idempotency-Key": "unit29-invalid" }, body: JSON.stringify({ expected_revision: 1, discrepancy_id: "forbidden" }) });
  assert.equal(invalid.status, 400);
});

const confirmBody = {
  expected_case_revision: 1,
  selected_lead: { lead_model: "FormLead", lead_id: new mongoose.Types.ObjectId().toHexString() },
  official_booking_details: {
    book_date: "2026-08-19",
    primary_agent_id: new mongoose.Types.ObjectId().toHexString(),
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

test("[AC-21] [AC-24] Owner update route is strict, idempotent-envelope only, and returns 200", async () => {
  const path = `/api/v1/admin/granot-lifecycle/booking-cases/${receiptId}/update-booking`;
  const body = {
    expected_case_revision: 1,
    expected_booking_revision: 4,
    official_booking_details: confirmBody.official_booking_details,
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { ...signedHeaders("owner", path), "Idempotency-Key": "unit25-update-1" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  assert.equal(lastUpdate?.case_id, receiptId);
  assert.equal(lastUpdate?.expected_booking_revision, 4);

  lastUpdate = null;
  const forbidden = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { ...signedHeaders("owner", path), "Idempotency-Key": "unit25-update-2" },
    body: JSON.stringify({ ...body, job_no: "forbidden" }),
  });
  assert.equal(forbidden.status, 400);
  assert.equal(lastUpdate, null);
});

test("[AC-28] Owner Referral create route accepts only revision plus official fields", async () => {
  const path = `/api/v1/admin/granot-lifecycle/booking-cases/${receiptId}/create-referral-booking`;
  const body = {
    expected_case_revision: 1,
    official_booking_details: confirmBody.official_booking_details,
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { ...signedHeaders("owner", path), "Idempotency-Key": "unit28-referral-1" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 201);
  assert.equal(lastReferralCreate?.case_id, receiptId);
  assert.equal(lastReferralCreate?.idempotency_key, "unit28-referral-1");
  assert.equal("job_no" in (lastReferralCreate ?? {}), false);
  assert.equal("selected_lead" in (lastReferralCreate ?? {}), false);

  lastReferralCreate = null;
  const forbidden = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { ...signedHeaders("owner", path), "Idempotency-Key": "unit28-referral-2" },
    body: JSON.stringify({ ...body, job_no: "forbidden" }),
  });
  assert.equal(forbidden.status, 400);
  assert.equal(lastReferralCreate, null);
});

test("[AC-20] [AC-32] Owner No Action accepts optional reason metadata and Admin is denied", async () => {
  const path = `/api/v1/admin/granot-lifecycle/booking-cases/${receiptId}/no-action`;
  const body = { expected_case_revision: 1, reason_code: "other" };
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { ...signedHeaders("owner", path), "Idempotency-Key": "unit25-no-action-1" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  assert.equal(lastNoAction?.reason_code, "other");

  lastNoAction = null;
  const denied = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { ...signedHeaders("admin", path), "Idempotency-Key": "unit25-no-action-2" },
    body: JSON.stringify(body),
  });
  assert.equal(denied.status, 403);
  assert.equal(lastNoAction, null);
});

test("[AC-25] [AC-32] Release Owner routes are strict, idempotent, and use exact statuses", async () => {
  const cancellationPath = `/api/v1/admin/granot-lifecycle/release-cases/${receiptId}/confirm-cancellation`;
  const cancellation = await fetch(`${baseUrl}${cancellationPath}`, {
    method: "POST",
    headers: { ...signedHeaders("owner", cancellationPath), "Idempotency-Key": "unit27-cancel-1" },
    body: JSON.stringify({
      expected_case_revision: 1,
      expected_booking_revision: 3,
      official_cancellation_details: { cancel_date: "2026-08-19", refund_amount: 25.5 },
    }),
  });
  assert.equal(cancellation.status, 201);
  assert.equal(lastReleaseCancellation?.expected_booking_revision, 3);

  const updatePath = `/api/v1/admin/granot-lifecycle/release-cases/${receiptId}/update-booking`;
  const update = await fetch(`${baseUrl}${updatePath}`, {
    method: "POST",
    headers: { ...signedHeaders("owner", updatePath), "Idempotency-Key": "unit27-update-1" },
    body: JSON.stringify({
      expected_case_revision: 1,
      expected_booking_revision: 3,
      official_booking_details: confirmBody.official_booking_details,
    }),
  });
  assert.equal(update.status, 200);
  assert.equal(lastReleaseUpdate?.expected_booking_revision, 3);

  const noActionPath = `/api/v1/admin/granot-lifecycle/release-cases/${receiptId}/no-action`;
  const noActionResponse = await fetch(`${baseUrl}${noActionPath}`, {
    method: "POST",
    headers: { ...signedHeaders("owner", noActionPath), "Idempotency-Key": "unit27-no-action-1" },
    body: JSON.stringify({ expected_case_revision: 1, reason_code: "granot_change_only" }),
  });
  assert.equal(noActionResponse.status, 200);
  assert.equal(lastReleaseNoAction?.reason_code, "granot_change_only");

  const forbidden = await fetch(`${baseUrl}${cancellationPath}`, {
    method: "POST",
    headers: { ...signedHeaders("owner", cancellationPath), "Idempotency-Key": "unit27-cancel-2" },
    body: JSON.stringify({
      expected_case_revision: 1,
      expected_booking_revision: 3,
      booking_id: new mongoose.Types.ObjectId().toHexString(),
      official_cancellation_details: { cancel_date: "2026-08-19", refund_amount: 25.5 },
    }),
  });
  assert.equal(forbidden.status, 400);
});

test("[AC-31][AC-35] Owner and Admin can read the health envelope without raw payload keys", async () => {
  const path = "/api/v1/admin/granot-lifecycle/operations/health";
  for (const role of ["owner", "admin"] as const) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: signedHeaders(role, path, "GET"),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { ok: boolean; data: typeof HEALTH_FIXTURE };
    assert.equal(body.ok, true);
    assert.equal(body.data.generated_at, HEALTH_FIXTURE.generated_at);
    assert.equal(body.data.flags.GRANOT_LIFECYCLE_SHADOW_MODE, true);
    assert.equal(body.data.flags.GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED, false);
    assert.equal(body.data.decisions_last_24h[0]?.execution_mode, "historical_shadow");
    assert.equal(JSON.stringify(body).includes("payload"), false);
    assert.equal(JSON.stringify(body).includes("authorization"), false);
  }
});
