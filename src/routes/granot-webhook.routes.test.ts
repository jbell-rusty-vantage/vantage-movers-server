import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import type { CaptureGranotWebhookInput } from "../services/granotWebhooks/granotWebhookCapture.service";
import { createGranotWebhookRouter } from "./granot-webhook.routes";

const captures: CaptureGranotWebhookInput[] = [];
let captureShouldFail = false;

const app = express();
app.use(express.json());
app.use(
  createGranotWebhookRouter(async (input) => {
    if (captureShouldFail) throw new Error("storage unavailable");
    captures.push(input);
    return { receipt_id: `receipt-${captures.length}` };
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
  captureShouldFail = false;
  restoreSecret();
});

test("returns 500 when the Granot webhook secret is not configured", async () => {
  delete process.env.GRANOT_WEBHOOK_SECRET;
  const response = await post("lead-created", {}, "anything");
  assert.equal(response.status, 500);
  assert.equal(captures.length, 0);
});

test("rejects a missing or incorrect Granot webhook secret", async () => {
  process.env.GRANOT_WEBHOOK_SECRET = "expected-secret";
  const missing = await post("lead-created", { arbitrary: true });
  const incorrect = await post("lead-created", { arbitrary: true }, "wrong-secret");
  assert.equal(missing.status, 401);
  assert.equal(incorrect.status, 401);
  assert.equal(captures.length, 0);
});

test("accepts unknown payload shapes on all three event routes", async () => {
  process.env.GRANOT_WEBHOOK_SECRET = "expected-secret";
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
    const response = await post(path, payload, "expected-secret");
    assert.equal(response.status, 202);
    const body = (await response.json()) as {
      accepted: boolean;
      event_type: string;
      receipt_id: string;
    };
    assert.equal(body.accepted, true);
    assert.equal(body.event_type, eventType);
    assert.match(body.receipt_id, /^receipt-/);
  }

  assert.equal(captures.length, 3);
  assert.deepEqual(
    captures.map((capture) => capture.payload),
    cases.map((entry) => entry[2]),
  );
});

test("returns 503 so Granot can retry when durable capture fails", async () => {
  process.env.GRANOT_WEBHOOK_SECRET = "expected-secret";
  captureShouldFail = true;
  const response = await post("priority-updated", { priority: 7 }, "expected-secret");
  assert.equal(response.status, 503);
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
