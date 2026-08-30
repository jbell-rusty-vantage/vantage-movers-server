import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import { computeAdminActorSignature } from "../services/operationsRegistry/trustedActor";
import { createJobNumberTimelineAdminRouter } from "./job-number-timeline-admin.routes";

const SECRET = "synthetic-admin-signing-secret";

const app = express();
app.use(express.json());
app.use(
  createJobNumberTimelineAdminRouter({
    connect: async () => undefined,
    listRecentOfficialBookings: async () => [
      { job_no: "P9003", booked_at: "2026-08-20T14:00:00.000Z" },
      { job_no: "P9002", booked_at: "2026-08-19T14:00:00.000Z" },
      { job_no: "P9001", booked_at: "2026-08-18T14:00:00.000Z" },
    ],
    read: async (input) => {
      if (input.job_no.trim() === "") {
        return { status: "invalid_job_number", normalized_job_no: null };
      }
      if (input.job_no === "missing") {
        return { status: "not_found", normalized_job_no: "MISSING" };
      }
      return {
        status: "ok",
        page: {
          normalized_job_no: "5562924",
          job_no_snapshot: "P5562924",
          proof_shape: "wordpress_born",
          source: {
            source_company_id: null,
            source_company_label: null,
            source_granularity_id: input.source_granularity_id ?? null,
            source_granularity_label: null,
          },
          coverage: {
            lead: "resolved",
            lead_message: "present",
            job_number_at_create: false,
            booking_intake: "absent",
            cancellation_intake: "absent",
            official_booking: false,
            official_cancellation: false,
            sheet_sync: "absent",
          },
          current: { ingestion_origin: "wordpress_form" },
          schema_version: "job_timeline.v2",
          assembled_at: "2026-08-01T10:00:00.000Z",
          current_outcome: "unknown",
          summary: {
            headline: "",
            origin_label: "WordPress",
            latest_activity_at: "2026-08-01T10:00:00.000Z",
            event_count: 1,
            attention_count: 0,
          },
          freshness: {
            mongo_read_at: "2026-08-01T10:00:00.000Z",
            consistency: "multi_query_best_effort",
            ringcentral_covered_through: null,
            ringcentral_cursor_lag_seconds: null,
            google_destination_readback: "not_performed",
          },
          stage_assessments: [],
          attention: [],
          limitations: [],
          activities: [],
          events: [
            {
              id: "e1",
              kind: "lead_created",
              event_at: "2026-08-01T10:00:00.000Z",
              clock_field: "entity_change.applied_at",
              type_priority: 10,
              coverage: "command_backed",
              headline: "Lead created (wordpress_form)",
              data: { ingestion_origin: "wordpress_form" },
              stage: "origin",
              evidence_level: "verified_change",
              time: {
                occurred_at: "2026-08-01T10:00:00.000Z",
                occurred_at_field: "entity_change.applied_at",
                recorded_at: "2026-08-01T10:00:00.000Z",
                recorded_at_field: "entity_change.applied_at",
                precision: "domain",
              },
              summary: "Lead created (wordpress_form)",
              status: "completed",
              correlation: {
                method: "lead_reference",
                confidence: "walked_back",
                explanation: "Lead existed before Job Number.",
              },
              causality: {
                activity_id: "activity:lead:e1",
                caused_by_event_ids: [],
                resulting_event_ids: [],
              },
              evidence: [],
            },
          ],
        },
      };
    },
  }),
);

const server = app.listen(0);
const baseUrl = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

before(() => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = SECRET;
});

afterEach(() => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = SECRET;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error?: Error) => (error ? reject(error) : resolve())),
  );
});

function signedHeaders(role: "owner" | "admin", path: string): Record<string, string> {
  const timestamp = `${Date.now()}`;
  const requestId = `req-jnt-${timestamp}`;
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

test("Owner Job Number timeline read returns the assembler DTO", async () => {
  const path = "/api/v1/admin/job-number-timeline?job_no=P5562924";
  const response = await fetch(`${baseUrl()}${path}`, {
    headers: signedHeaders("owner", "/api/v1/admin/job-number-timeline"),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { ok: true; data: { status: string; page?: { events: Array<{ headline: string }> } } };
  assert.equal(body.data.status, "ok");
  assert.equal(body.data.page?.events[0]?.headline, "Lead created (wordpress_form)");
});

test("Admin cannot read the owner Job Number timeline", async () => {
  const path = "/api/v1/admin/job-number-timeline?job_no=P5562924";
  const response = await fetch(`${baseUrl()}${path}`, {
    headers: signedHeaders("admin", "/api/v1/admin/job-number-timeline"),
  });
  assert.equal(response.status, 403);
});

test("typed miss returns not_found without an event list", async () => {
  const path = "/api/v1/admin/job-number-timeline?job_no=missing";
  const response = await fetch(`${baseUrl()}${path}`, {
    headers: signedHeaders("owner", "/api/v1/admin/job-number-timeline"),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { ok: true; data: { status: string; page?: unknown } };
  assert.equal(body.data.status, "not_found");
  assert.equal(body.data.page, undefined);
});

test("Owner recent official booking examples return only Job Numbers", async () => {
  const path = "/api/v1/admin/job-number-timeline/recent-official-bookings";
  const response = await fetch(`${baseUrl()}${path}`, {
    headers: signedHeaders("owner", "/api/v1/admin/job-number-timeline/recent-official-bookings"),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: { bookings: Array<{ job_no: string; booked_at: string; customer_name?: string }> };
  };
  assert.equal(body.ok, true);
  assert.deepEqual(body.data.bookings.map((row) => row.job_no), ["P9003", "P9002", "P9001"]);
  assert.equal(body.data.bookings[0]?.booked_at, "2026-08-20T14:00:00.000Z");
  assert.equal("customer_name" in (body.data.bookings[0] ?? {}), false);
});

test("unhandled timeline read failure does not echo error.message", async () => {
  const failingApp = express();
  failingApp.use(
    createJobNumberTimelineAdminRouter({
      connect: async () => undefined,
      read: async () => {
        throw new Error("mongo connection string leaked");
      },
    }),
  );
  const failingServer = failingApp.listen(0);
  try {
    const path = "/api/v1/admin/job-number-timeline?job_no=P5562924";
    const response = await fetch(
      `http://127.0.0.1:${(failingServer.address() as AddressInfo).port}${path}`,
      { headers: signedHeaders("owner", "/api/v1/admin/job-number-timeline") },
    );
    assert.equal(response.status, 500);
    const body = await response.json() as { ok: false; error: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, "Internal error");
    assert.equal(JSON.stringify(body).includes("mongo connection string leaked"), false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      failingServer.close((error?: Error) => (error ? reject(error) : resolve())),
    );
  }
});

test("Admin cannot read recent official booking examples", async () => {
  const path = "/api/v1/admin/job-number-timeline/recent-official-bookings";
  const response = await fetch(`${baseUrl()}${path}`, {
    headers: signedHeaders("admin", "/api/v1/admin/job-number-timeline/recent-official-bookings"),
  });
  assert.equal(response.status, 403);
});
