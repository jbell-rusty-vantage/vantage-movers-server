import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import mongoose from "mongoose";
import { computeAdminActorSignature } from "../services/operationsRegistry/trustedActor";
import { GRANOT_LIFECYCLE_ERROR_CODES, GranotLifecycleError } from "../services/granotLifecycle/errors";
import { createGranotLifecycleAdminRouter } from "./granot-lifecycle-admin.routes";
import { BookingJobNumberError } from "../services/bookings/bookingJobNumberGuard";

const SECRET = "synthetic-admin-signing-secret";
const receiptId = new mongoose.Types.ObjectId().toHexString();
const releaseCaseId = new mongoose.Types.ObjectId().toHexString();
const createMissingCaseId = new mongoose.Types.ObjectId().toHexString();
const bookedPostureCaseId = new mongoose.Types.ObjectId().toHexString();
let lastCreatingObservationCaseId: string | null = null;
let lastConfirm: Record<string, unknown> | null = null;
let lastReferralCreate: Record<string, unknown> | null = null;
let lastUpdate: Record<string, unknown> | null = null;
let lastBookingCancellation: Record<string, unknown> | null = null;
let lastReleaseCancellation: Record<string, unknown> | null = null;
let lastReleaseUpdate: Record<string, unknown> | null = null;
let lastReleaseNoAction: Record<string, unknown> | null = null;
let lastDiscrepancyAction: Record<string, unknown> | null = null;

const app = express();
app.use(express.json());
app.use(
  createGranotLifecycleAdminRouter({
    connect: async () => undefined,
    getCreatingObservation: async (caseId) => {
      lastCreatingObservationCaseId = caseId;
      if (caseId === releaseCaseId) {
        return {
          case_id: caseId,
          job_no: "synthetic-200",
          normalized_job_no: "SYNTHETIC 200",
          observation_id: releaseCaseId,
          receipt_id: releaseCaseId,
          captured_at: "2026-08-24T16:00:00.000Z",
          route_event_class: "booking_status_changed",
          payload_event_type_raw: "Release",
          booking_action: "release",
          evidence_action: "release",
          selection: "preferred_release",
          observation: {
            observation_id: releaseCaseId,
            receipt_id: releaseCaseId,
            captured_at: "2026-08-24T16:00:00.000Z",
            identity: {},
            contact: {},
            move: {},
            priority: { valid: true },
            booking_action: { normalized: "release" },
            display_money: {},
            agent_identity: {},
          },
          granot_statement: { event_type: "Release", job_no: "synthetic-200" },
          priority_pairing: null,
        };
      }
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
    confirmBooking: async (input) => {
      if (input.idempotency_key === "jobno-invalid") throw new BookingJobNumberError("no_digits");
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
    confirmBookingCancellation: async (input) => {
      lastBookingCancellation = input as unknown as Record<string, unknown>;
      if (input.case_id === createMissingCaseId || input.case_id === bookedPostureCaseId) {
        throw new GranotLifecycleError(
          "Granot reconciliation case revision changed",
          GRANOT_LIFECYCLE_ERROR_CODES.CASE_REVISION_CONFLICT,
          409,
        );
      }
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
    reEvaluateDiscrepancy: async (input) => discrepancyResult(input, "still_conflicting"),
    correctRecordLink: async (input) => discrepancyResult(input, "record_link_corrected"),
    discrepancyNoAction: async (input) => discrepancyResult(input, "no_action"),
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
  lastCreatingObservationCaseId = null;
  lastConfirm = null;
  lastUpdate = null;
  lastBookingCancellation = null;
  lastReleaseCancellation = null;
  lastReleaseUpdate = null;
  lastReleaseNoAction = null;
  lastDiscrepancyAction = null;
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

test("creating observation returns the Release statement for a cancellation intake", async () => {
  const path = `/api/v1/admin/granot-lifecycle/cases/${releaseCaseId}/creating-observation`;
  const allowed = await fetch(`${baseUrl}${path}`, { headers: signedHeaders("owner", path, "GET") });
  assert.equal(allowed.status, 200);
  const body = (await allowed.json()) as {
    ok: boolean;
    data: { selection: string; granot_statement: { event_type: string } };
  };
  assert.equal(body.ok, true);
  assert.equal(body.data.selection, "preferred_release");
  assert.equal(body.data.granot_statement.event_type, "Release");
  assert.equal(lastCreatingObservationCaseId, releaseCaseId);
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

test("[AC-R9] Owner booking-case confirm-cancellation succeeds and rejects create-missing posture", async () => {
  const path = `/api/v1/admin/granot-lifecycle/booking-cases/${receiptId}/confirm-cancellation`;
  const body = {
    expected_case_revision: 1,
    expected_booking_revision: 3,
    official_cancellation_details: { cancel_date: "2026-08-19", refund_amount: 25.5 },
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { ...signedHeaders("owner", path), "Idempotency-Key": "unit-r9-cancel-1" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 201);
  assert.equal(lastBookingCancellation?.case_id, receiptId);
  assert.equal(lastBookingCancellation?.expected_booking_revision, 3);
  assert.equal(lastBookingCancellation?.idempotency_key, "unit-r9-cancel-1");

  const createMissingPath = `/api/v1/admin/granot-lifecycle/booking-cases/${createMissingCaseId}/confirm-cancellation`;
  const rejected = await fetch(`${baseUrl}${createMissingPath}`, {
    method: "POST",
    headers: { ...signedHeaders("owner", createMissingPath), "Idempotency-Key": "unit-r9-cancel-missing" },
    body: JSON.stringify(body),
  });
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json() as { code: string }).code, GRANOT_LIFECYCLE_ERROR_CODES.CASE_REVISION_CONFLICT);
  assert.equal(lastBookingCancellation?.case_id, createMissingCaseId);

  const bookedPosturePath = `/api/v1/admin/granot-lifecycle/booking-cases/${bookedPostureCaseId}/confirm-cancellation`;
  const bookedRejected = await fetch(`${baseUrl}${bookedPosturePath}`, {
    method: "POST",
    headers: { ...signedHeaders("owner", bookedPosturePath), "Idempotency-Key": "unit-r9-cancel-booked" },
    body: JSON.stringify(body),
  });
  assert.equal(bookedRejected.status, 409);
  assert.equal((await bookedRejected.json() as { code: string }).code, GRANOT_LIFECYCLE_ERROR_CODES.CASE_REVISION_CONFLICT);
  assert.equal(lastBookingCancellation?.case_id, bookedPostureCaseId);

  lastBookingCancellation = null;
  const forbidden = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { ...signedHeaders("owner", path), "Idempotency-Key": "unit-r9-cancel-2" },
    body: JSON.stringify({
      ...body,
      booking_id: new mongoose.Types.ObjectId().toHexString(),
    }),
  });
  assert.equal(forbidden.status, 400);
  assert.equal(lastBookingCancellation, null);
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

test("Owner confirm answers 422 with the reason when the Booking Job Number rule rejects the Job", async () => {
  const path = `/api/v1/admin/granot-lifecycle/booking-cases/${receiptId}/confirm-booking`;
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { ...signedHeaders("owner", path), "Idempotency-Key": "jobno-invalid" },
    body: JSON.stringify(confirmBody),
  });
  assert.equal(response.status, 422);
  const body = await response.json() as { ok: boolean; code: string; error: string; issues: Array<{ path: string; message: string }> };
  assert.equal(body.ok, false);
  assert.equal(body.code, "booking.job_number_invalid");
  assert.match(body.error, /Invalid Job Number/);
  assert.deepEqual(body.issues, [{ path: "job_no", message: "no_digits" }]);
});
