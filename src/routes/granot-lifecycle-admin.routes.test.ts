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
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = SECRET;
});

function signedHeaders(role: "owner" | "admin", path: string): Record<string, string> {
  const timestamp = `${Date.now()}`;
  const requestId = `req-requeue-${timestamp}`;
  const signature = computeAdminActorSignature(
    {
      adminId: "admin_123",
      email: "owner@example.invalid",
      role,
      timestamp,
      requestId,
      method: "POST",
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
