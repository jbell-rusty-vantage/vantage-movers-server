import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import type { CaptureGranotLifecycleWebhookInput } from "../services/granotLifecycle/capture";
import {
  getGranotLifecycleCaptureFailures,
  resetGranotLifecycleMetrics,
} from "../services/granotLifecycle/metrics";
import {
  clearCapturedOperationalEvents,
  getCapturedOperationalEvents,
} from "../services/observability";
import { createGranotWebhookRouter } from "./granot-webhook.routes";

const SYNTHETIC_SECRET = "synthetic-expected-secret";
const captures: CaptureGranotLifecycleWebhookInput[] = [];
const published: Array<{ receipt_id: string }> = [];
let captureShouldFail = false;
let publishShouldFail = false;
let publishShouldThrow = false;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  createGranotWebhookRouter({
    capture: async (input) => {
      if (captureShouldFail) throw new Error("storage unavailable");
      captures.push(input);
      return { receipt_id: `receipt-${captures.length}` };
    },
    publish: async (message) => {
      if (publishShouldThrow) {
        throw new Error("publisher leaked");
      }
      if (publishShouldFail) {
        return { published: false };
      }
      published.push(message);
      return { published: true };
    },
  }),
);

let baseUrl = "";
let server: ReturnType<typeof app.listen>;
const originalSecret = process.env.GRANOT_WEBHOOK_SECRET;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  restoreSecret();
  await new Promise<void>((resolve, reject) =>
    server.close((error?: Error) => (error ? reject(error) : resolve())),
  );
});

afterEach(() => {
  captures.length = 0;
  published.length = 0;
  captureShouldFail = false;
  publishShouldFail = false;
  publishShouldThrow = false;
  resetGranotLifecycleMetrics();
  clearCapturedOperationalEvents();
  restoreSecret();
});

test("[AC-01] missing configuration returns 500 and reaches neither capture nor publisher", async () => {
  delete process.env.GRANOT_WEBHOOK_SECRET;
  const response = await post("lead-created", { job_no: "567632" }, SYNTHETIC_SECRET);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Granot webhook authentication is not configured",
  });
  assert.equal(captures.length, 0);
  assert.equal(published.length, 0);
});

test("[AC-01] missing, wrong, nonscalar, and mismatched dual secrets return exact 401 and create no receipt", async () => {
  process.env.GRANOT_WEBHOOK_SECRET = SYNTHETIC_SECRET;
  const missing = await post("lead-created", { job_no: "567632" });
  const wrong = await post("lead-created", { job_no: "567632" }, "synthetic-wrong-secret");
  const mismatched = await fetch(`${baseUrl}/api/webhooks/granot/lead-created`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-secret": SYNTHETIC_SECRET,
    },
    body: JSON.stringify({
      "x-api-secret": "synthetic-wrong-secret",
      job_no: "567632",
    }),
  });
  const nonscalar = await fetch(`${baseUrl}/api/webhooks/granot/lead-created`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      "x-api-secret": [SYNTHETIC_SECRET],
      job_no: "567632",
    }),
  });

  for (const response of [missing, wrong, mismatched, nonscalar]) {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      ok: false,
      code: "GRANOT_WEBHOOK_UNAUTHORIZED",
      error: "Unauthorized",
    });
  }
  assert.equal(captures.length, 0);
  assert.equal(published.length, 0);
});

test("[AC-01][AC-35] JSON body, form body, and header secrets authenticate and strip the credential before capture", async () => {
  process.env.GRANOT_WEBHOOK_SECRET = SYNTHETIC_SECRET;

  const header = await post("lead-created", { job_no: "567632" }, SYNTHETIC_SECRET);
  assert.equal(header.status, 202);
  assert.deepEqual(await header.json(), {
    ok: true,
    accepted: true,
    event_type: "lead_created",
    receipt_id: "receipt-1",
  });

  const jsonBody = await fetch(`${baseUrl}/api/webhooks/granot/priority-updated`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      "x-api-secret": SYNTHETIC_SECRET,
      priority: "1",
    }),
  });
  assert.equal(jsonBody.status, 202);
  assert.deepEqual(await jsonBody.json(), {
    ok: true,
    accepted: true,
    event_type: "priority_updated",
    receipt_id: "receipt-2",
  });

  const form = await fetch(`${baseUrl}/api/webhooks/granot/booking-status-changed`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      "x-api-secret": SYNTHETIC_SECRET,
      event_type: "booked",
      job_no: "567632",
    }),
  });
  assert.equal(form.status, 202);
  assert.deepEqual(await form.json(), {
    ok: true,
    accepted: true,
    event_type: "booking_status_changed",
    receipt_id: "receipt-3",
  });

  assert.equal(captures.length, 3);
  assert.deepEqual(
    captures.map((capture) => capture.authentication_method),
    ["header_secret", "body_secret", "body_secret"],
  );
  assert.deepEqual(captures[0]?.payload, { job_no: "567632" });
  assert.deepEqual(captures[1]?.payload, { priority: "1" });
  assert.deepEqual(captures[2]?.payload, {
    event_type: "booked",
    job_no: "567632",
  });
  assert.equal(JSON.stringify(captures).includes(SYNTHETIC_SECRET), false);
  assert.equal(
    JSON.stringify(captures.map((capture) => capture.headers)).includes("x-api-secret"),
    false,
  );
  assert.deepEqual(
    published.map((message) => message.receipt_id),
    ["receipt-1", "receipt-2", "receipt-3"],
  );
});

test("[AC-01] both valid secrets attach header_secret after the body is also validated", async () => {
  process.env.GRANOT_WEBHOOK_SECRET = SYNTHETIC_SECRET;
  const response = await fetch(`${baseUrl}/api/webhooks/granot/lead-created`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-secret": SYNTHETIC_SECRET,
    },
    body: JSON.stringify({
      "x-api-secret": SYNTHETIC_SECRET,
      job_no: "567632",
    }),
  });
  assert.equal(response.status, 202);
  assert.equal(captures[0]?.authentication_method, "header_secret");
  assert.deepEqual(captures[0]?.payload, { job_no: "567632" });
});

test("[AC-02] unused Granot field additions or omissions are captured as-is and still return 202", async () => {
  process.env.GRANOT_WEBHOOK_SECRET = SYNTHETIC_SECRET;
  const payload = {
    event_type: "lead_created",
    job_no: "567632",
    priority: "1",
    label: "Synthetic Forms",
    est_cf: "800",
    cubic_rate: "4.25",
  };

  const response = await post("lead-created", payload, SYNTHETIC_SECRET);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    ok: true,
    accepted: true,
    event_type: "lead_created",
    receipt_id: "receipt-1",
  });
  assert.deepEqual(captures[0]?.payload, payload);
  assert.equal("service_type" in (captures[0]?.payload as object), false);
});

test("[AC-02] capture happens before 202 and uses the invoked route class", async () => {
  process.env.GRANOT_WEBHOOK_SECRET = SYNTHETIC_SECRET;
  const cases = [
    ["lead-created", "lead_created", { unfamiliar: { nested: [1, "two", null] } }],
    ["priority-updated", "priority_updated", ["shape", { is: "unknown" }]],
    [
      "booking-status-changed",
      "booking_status_changed",
      { fields_from_granot: { can_change_later: true } },
    ],
  ] as const;

  for (const [path, eventType, payload] of cases) {
    const response = await post(path, payload, SYNTHETIC_SECRET);
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.deepEqual(body, {
      ok: true,
      accepted: true,
      event_type: eventType,
      receipt_id: body.receipt_id,
    });
    assert.match(body.receipt_id, /^receipt-/);
  }

  assert.deepEqual(
    captures.map((capture) => capture.route_event_class),
    ["lead_created", "priority_updated", "booking_status_changed"],
  );
  assert.equal(published.length, 3);
});

test("[AC-01] capture failure returns safe 503, creates no publish, and stays distinct from queue failure", async () => {
  process.env.GRANOT_WEBHOOK_SECRET = SYNTHETIC_SECRET;
  captureShouldFail = true;
  const response = await post("priority-updated", { priority: 7 }, SYNTHETIC_SECRET);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Webhook receipt could not be stored",
  });
  assert.equal(captures.length, 0);
  assert.equal(published.length, 0);
  assert.equal(getGranotLifecycleCaptureFailures(), 1);
  const events = getCapturedOperationalEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.input.eventKey, "granot_lifecycle.capture.failed");
  assert.notEqual(events[0]?.input.eventKey, "granot_lifecycle.queue.publish_failed");
});

test("[AC-02] publish failure cannot change 202 or the accepted receipt", async () => {
  process.env.GRANOT_WEBHOOK_SECRET = SYNTHETIC_SECRET;
  publishShouldFail = true;
  const failed = await post("lead-created", { job_no: "567632" }, SYNTHETIC_SECRET);
  assert.equal(failed.status, 202);
  assert.deepEqual(await failed.json(), {
    ok: true,
    accepted: true,
    event_type: "lead_created",
    receipt_id: "receipt-1",
  });
  assert.equal(captures.length, 1);

  publishShouldFail = false;
  publishShouldThrow = true;
  const leaked = await post("lead-created", { job_no: "567632" }, SYNTHETIC_SECRET);
  assert.equal(leaked.status, 202);
  assert.deepEqual(await leaked.json(), {
    ok: true,
    accepted: true,
    event_type: "lead_created",
    receipt_id: "receipt-2",
  });
});

function post(path: string, payload: unknown, secret?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers["x-api-secret"] = secret;
  return fetch(`${baseUrl}/api/webhooks/granot/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

function restoreSecret() {
  if (originalSecret === undefined) {
    delete process.env.GRANOT_WEBHOOK_SECRET;
  } else {
    process.env.GRANOT_WEBHOOK_SECRET = originalSecret;
  }
}
