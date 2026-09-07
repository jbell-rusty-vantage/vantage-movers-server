import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import { requireApiSecret } from "../middleware/requireApiSecret";
import { computeAdminActorSignature } from "../services/operationsRegistry/trustedActor";
import { SOURCE_COMPANIES } from "../config/domain/sources";
import { createDailyOperationsAdminRouter } from "./daily-operations-admin.routes";
import { createDailyOperationsCronRouter } from "./daily-operations-cron.routes";

const API_SECRET = "synthetic-daily-ops-api-secret";
const SIGNING_SECRET = "synthetic-admin-signing-secret";
const originalApiSecret = process.env.VANTAGE_API_SECRET;
const originalSigningSecret = process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET;
const originalCronSecret = process.env.CRON_SECRET;

const SNAPSHOT_FIXTURE = {
  timezone: "America/New_York" as const,
  today: "2026-09-06",
  yesterday: "2026-09-05",
  generated_at: "2026-09-06T18:14:00.000Z",
  redis: { configured: false, mode: "stream" as const },
  metrics: {
    leads: {
      today: 42,
      yesterday: 38,
      yesterday_by_now: 31,
      form: 28,
      call: 14,
      duplicate_form: 3,
      duplicate_call: 1,
    },
    bookings: { today: 6, yesterday: 5, yesterday_by_now: 4 },
    cancellations: { today: 1, yesterday: 0, yesterday_by_now: 0 },
    texts: {
      today: 19,
      yesterday: 22,
      yesterday_by_now: 18,
      deferred: 4,
      held_now: 3,
      skipped: 4,
      failed: 1,
    },
    webhooks: {
      lead_created: { today: 55, yesterday: 49 },
      priority_updated: { today: 120, yesterday: 101 },
      booking_status_changed: { today: 8, yesterday: 7 },
      booked: { today: 5, yesterday: 4 },
      release: { today: 3, yesterday: 3 },
    },
    intakes: { opened_today: 3, still_open: 2 },
    exceptions: {
      zip_missing: 2,
      crm_failed: 0,
      dead_letter: 0,
      adoption_conflict: 0,
    },
  },
  origins: {
    granot_lead_created: 20,
    ringcentral: 14,
    wordpress_form: 0,
    best_relocation_sheet: 6,
    vantage_admin: 2,
  },
  companies: SOURCE_COMPANIES.map((source_company) => ({
    source_company,
    form: source_company === "top10_leads" ? 12 : 0,
    call: source_company === "top10_leads" ? 5 : 0,
    total: source_company === "top10_leads" ? 17 : 0,
    yesterday_total: source_company === "top10_leads" ? 15 : 0,
  })),
  hourly: { today: [], yesterday: [] },
};

let lastEventsQuery: Record<string, unknown> | null = null;
let rebuildCalls = 0;
let closeCalls = 0;
let lastClosed: { today: string; closed_days: string[]; already_closed: boolean } = {
  today: "2026-09-06",
  closed_days: ["2026-09-05"],
  already_closed: false,
};

const app = express();
app.use(express.json());
app.use("/api/v1", requireApiSecret);
app.use(
  createDailyOperationsAdminRouter({
    connect: async () => undefined,
    getSnapshot: async () => SNAPSHOT_FIXTURE,
    listEvents: async (query) => {
      lastEventsQuery = query as Record<string, unknown>;
      return {
        day: "2026-09-06",
        timezone: "America/New_York",
        order: "newest_first",
        limit: 80,
        items: [
          {
            event_id: "evt_1",
            day: "2026-09-06",
            occurred_at: "2026-09-06T18:14:00.000Z",
            lane: "lead",
            kind: "form_lead.created",
            title: "Form Lead created",
            source_company: "top10_leads",
            ingestion_origin: "granot_lead_created",
            lead_kind: "form",
            job_no: null,
            entity_type: "FormLead",
            entity_id: "lead_1",
            parent_receipt_id: null,
            links: { lead_id: "lead_1", lead_model: "FormLead" },
            card: { customer_name: "Ada" },
            metric_touches: ["leads.form"],
          },
        ],
        next_cursor: "2026-09-06T18:14:00.000Z:evt_1",
      };
    },
    rebuild: async () => {
      rebuildCalls += 1;
      return {
        day: "2026-09-06",
        status: "open",
        rebuilt: true,
        events_deleted: false,
        revision: 2,
      };
    },
  }),
);
app.use(
  createDailyOperationsCronRouter({
    closeDay: async () => {
      closeCalls += 1;
      return lastClosed;
    },
  }),
);

let baseUrl = "";
let server: ReturnType<typeof app.listen>;

before(async () => {
  process.env.VANTAGE_API_SECRET = API_SECRET;
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = SIGNING_SECRET;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err?: Error) => (err ? reject(err) : resolve())),
  );
  restoreEnv("VANTAGE_API_SECRET", originalApiSecret);
  restoreEnv("VANTAGE_ADMIN_PROXY_SIGNING_SECRET", originalSigningSecret);
  restoreEnv("CRON_SECRET", originalCronSecret);
});

afterEach(() => {
  lastEventsQuery = null;
  rebuildCalls = 0;
  closeCalls = 0;
  process.env.VANTAGE_API_SECRET = API_SECRET;
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = SIGNING_SECRET;
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function signedHeaders(
  role: "owner" | "admin",
  path: string,
  method: "GET" | "POST" = "GET",
): Record<string, string> {
  const timestamp = `${Date.now()}`;
  const requestId = `req-daily-${timestamp}`;
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
    SIGNING_SECRET,
  );
  return {
    "content-type": "application/json",
    "x-api-secret": API_SECRET,
    "x-vantage-admin-user-id": "admin_123",
    "x-vantage-admin-email": "owner@example.invalid",
    "x-vantage-admin-role": role,
    "x-vantage-admin-request-id": requestId,
    "x-vantage-admin-timestamp": timestamp,
    "x-vantage-admin-signature": signature,
  };
}

test("Owner snapshot includes yesterday_by_now, company zeros, and wordpress_form", async () => {
  const path = "/api/v1/admin/daily-operations";
  const response = await fetch(`${baseUrl}${path}`, {
    headers: signedHeaders("owner", path),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as typeof SNAPSHOT_FIXTURE;
  assert.equal(body.metrics.leads.yesterday_by_now, 31);
  assert.equal(body.metrics.bookings.yesterday_by_now, 4);
  assert.equal(body.metrics.texts.yesterday_by_now, 18);
  assert.equal(body.origins.wordpress_form, 0);
  assert.equal(body.companies.length, SOURCE_COMPANIES.length);
  assert.equal(body.metrics.intakes.still_open, 2);
  assert.equal(body.metrics.texts.held_now, 3);
  assert.equal(JSON.stringify(body).includes("daily_operations_"), false);
});

test("Admin without Owner is 403 on every Daily Operations method", async () => {
  const getPath = "/api/v1/admin/daily-operations";
  const eventsPath = "/api/v1/admin/daily-operations/events";
  const rebuildPath = "/api/v1/admin/daily-operations/rebuild";
  assert.equal(
    (await fetch(`${baseUrl}${getPath}`, { headers: signedHeaders("admin", getPath) })).status,
    403,
  );
  assert.equal(
    (await fetch(`${baseUrl}${eventsPath}`, { headers: signedHeaders("admin", eventsPath) })).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${baseUrl}${rebuildPath}`, {
        method: "POST",
        headers: signedHeaders("admin", rebuildPath, "POST"),
      })
    ).status,
    403,
  );
  assert.equal(rebuildCalls, 0);
});

test("missing API secret is 401", async () => {
  const path = "/api/v1/admin/daily-operations";
  const headers = signedHeaders("owner", path);
  delete headers["x-api-secret"];
  const response = await fetch(`${baseUrl}${path}`, { headers });
  assert.equal(response.status, 401);
});

test("events page is newest-first and forwards cursor, lane, and limit", async () => {
  const path =
    "/api/v1/admin/daily-operations/events?cursor=2026-09-06T18%3A14%3A00.000Z%3Aevt_1&lane=lead&limit=40";
  const response = await fetch(`${baseUrl}${path}`, {
    headers: signedHeaders("owner", "/api/v1/admin/daily-operations/events"),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { order: string; next_cursor: string };
  assert.equal(body.order, "newest_first");
  assert.equal(body.next_cursor, "2026-09-06T18:14:00.000Z:evt_1");
  assert.deepEqual(lastEventsQuery, {
    cursor: "2026-09-06T18:14:00.000Z:evt_1",
    lane: "lead",
    limit: 40,
  });
});

test("Owner rebuild returns counters-replaced, events not deleted", async () => {
  const path = "/api/v1/admin/daily-operations/rebuild";
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: signedHeaders("owner", path, "POST"),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    rebuilt: boolean;
    events_deleted: boolean;
    status: string;
  };
  assert.equal(body.rebuilt, true);
  assert.equal(body.events_deleted, false);
  assert.equal(body.status, "open");
  assert.equal(rebuildCalls, 1);
});

test("close cron rejects missing secret header and missing CRON_SECRET", async () => {
  delete process.env.CRON_SECRET;
  const unset = await fetch(`${baseUrl}/api/cron/daily-operations-close`, {
    method: "POST",
  });
  assert.equal(unset.status, 500);
  assert.equal(closeCalls, 0);

  process.env.CRON_SECRET = "expected-secret";
  const missingHeader = await fetch(`${baseUrl}/api/cron/daily-operations-close`, {
    method: "POST",
  });
  assert.equal(missingHeader.status, 401);
  assert.equal(closeCalls, 0);

  const wrong = await fetch(`${baseUrl}/api/cron/daily-operations-close`, {
    method: "POST",
    headers: { authorization: "Bearer wrong" },
  });
  assert.equal(wrong.status, 401);

  const ok = await fetch(`${baseUrl}/api/cron/daily-operations-close`, {
    method: "POST",
    headers: { authorization: "Bearer expected-secret" },
  });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { ok: boolean; closed_days: string[] };
  assert.equal(body.ok, true);
  assert.deepEqual(body.closed_days, ["2026-09-05"]);
  assert.equal(closeCalls, 1);

  const headerOk = await fetch(`${baseUrl}/api/cron/daily-operations-close`, {
    method: "POST",
    headers: { "x-cron-secret": "expected-secret" },
  });
  assert.equal(headerOk.status, 200);
  assert.equal(closeCalls, 2);
});
