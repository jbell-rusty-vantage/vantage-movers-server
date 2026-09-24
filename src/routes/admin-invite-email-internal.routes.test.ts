import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, mock, test } from "node:test";
import express from "express";
import { logger } from "../logger";
import { computeAdminActorSignature } from "../services/operationsRegistry/trustedActor";
import {
  sendAdminInviteEmail,
  type AdminInviteMailMessage,
} from "../services/adminInvites/inviteEmail.service";
import { ADMIN_INVITE_EMAIL_PATH, createAdminInviteEmailRouter } from "./admin-invite-email-internal.routes";

const SECRET = "synthetic-admin-signing-secret";
const TOKEN = "tok_Zq9SyntheticInviteToken_do_not_log_1234567890";
const LINK = `https://admin.example.invalid/accept-invite#token=${TOKEN}`;
const TO = "new.rep@example.invalid";

type Config = { apiKey: string | null; fromEmail: string | null; replyTo: string | null };
let config: Config = { apiKey: "SG.synthetic", fromEmail: "noreply@example.invalid", replyTo: null };
let sendBehaviour: "ok" | "throw" = "ok";
const sent: Array<{ apiKey: string; message: AdminInviteMailMessage }> = [];

const app = express();
app.use(express.json());
app.use(
  createAdminInviteEmailRouter({
    send: (input) =>
      sendAdminInviteEmail(input, {
        config: () => config,
        send: async (apiKey, message) => {
          if (sendBehaviour === "throw") {
            throw Object.assign(new Error(`provider echoed ${LINK}`), { response: { statusCode: 400, body: LINK } });
          }
          sent.push({ apiKey, message });
        },
      }),
  }),
);
const server = app.listen(0);
const url = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}${ADMIN_INVITE_EMAIL_PATH}`;

const logged: string[] = [];
before(() => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = SECRET;
  for (const level of ["trace", "debug", "info", "warn", "error", "fatal"] as const) {
    mock.method(logger, level, (...args: unknown[]) => {
      logged.push(JSON.stringify(args, (_key, value) => (value instanceof Error ? `${value.message} ${value.stack}` : value)));
    });
  }
});
afterEach(() => {
  sent.length = 0;
  sendBehaviour = "ok";
  config = { apiKey: "SG.synthetic", fromEmail: "noreply@example.invalid", replyTo: null };
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = SECRET;
});
after(async () => {
  mock.restoreAll();
  await new Promise<void>((resolve, reject) => server.close((error?: Error) => (error ? reject(error) : resolve())));
});

function signedHeaders(role: "owner" | "admin" | "rep", options: { secret?: string; path?: string } = {}) {
  const timestamp = `${Date.now()}`;
  const requestId = `req-invite-${timestamp}`;
  const signature = computeAdminActorSignature(
    {
      adminId: "507f1f77bcf86cd799439011",
      email: "owner@example.invalid",
      role,
      timestamp,
      requestId,
      method: "POST",
      path: options.path ?? ADMIN_INVITE_EMAIL_PATH,
    },
    options.secret ?? SECRET,
  );
  return {
    "content-type": "application/json",
    "x-vantage-admin-user-id": "507f1f77bcf86cd799439011",
    "x-vantage-admin-email": "owner@example.invalid",
    "x-vantage-admin-role": role,
    "x-vantage-admin-request-id": requestId,
    "x-vantage-admin-timestamp": timestamp,
    "x-vantage-admin-signature": signature,
  };
}

const body = () => JSON.stringify({ to: TO, link: LINK, expires_at: "2026-09-27T12:00:00.000Z" });

test("unsigned requests are 401 and send nothing", async () => {
  const response = await fetch(url(), { method: "POST", headers: { "content-type": "application/json" }, body: body() });
  assert.equal(response.status, 401);
  assert.equal(sent.length, 0);
});

test("a bad signature is 401 and sends nothing", async () => {
  const wrongSecret = await fetch(url(), { method: "POST", headers: signedHeaders("owner", { secret: "another-secret-value" }), body: body() });
  assert.equal(wrongSecret.status, 401);
  const wrongPath = await fetch(url(), { method: "POST", headers: signedHeaders("owner", { path: "/api/v1/admin/extension-users" }), body: body() });
  assert.equal(wrongPath.status, 401);
  assert.equal(sent.length, 0);
});

test("a signed non-Owner is 403", async () => {
  const admin = await fetch(url(), { method: "POST", headers: signedHeaders("admin"), body: body() });
  assert.equal(admin.status, 403);
  const rep = await fetch(url(), { method: "POST", headers: signedHeaders("rep"), body: body() });
  assert.equal(rep.status, 403);
  assert.equal(sent.length, 0);
});

test("a server without the signing secret refuses (401)", async () => {
  delete process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET;
  const response = await fetch(url(), { method: "POST", headers: signedHeaders("owner"), body: body() });
  assert.equal(response.status, 401);
  assert.equal(sent.length, 0);
});

test("a signed Owner sends one email with the link in the body", async () => {
  const response = await fetch(url(), { method: "POST", headers: signedHeaders("owner"), body: body() });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: { status: "sent" } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.message.to, TO);
  assert.equal(sent[0]?.message.from, "noreply@example.invalid");
  assert.ok(sent[0]?.message.text.includes(LINK));
});

test("no sender configured returns not_configured", async () => {
  config = { apiKey: null, fromEmail: "noreply@example.invalid", replyTo: null };
  const noKey = await fetch(url(), { method: "POST", headers: signedHeaders("owner"), body: body() });
  assert.deepEqual(await noKey.json(), { ok: true, data: { status: "not_configured" } });
  config = { apiKey: "SG.synthetic", fromEmail: null, replyTo: null };
  const noFrom = await fetch(url(), { method: "POST", headers: signedHeaders("owner"), body: body() });
  assert.deepEqual(await noFrom.json(), { ok: true, data: { status: "not_configured" } });
  assert.equal(sent.length, 0);
});

test("a provider failure returns failed with only the status code", async () => {
  sendBehaviour = "throw";
  const response = await fetch(url(), { method: "POST", headers: signedHeaders("owner"), body: body() });
  assert.deepEqual(await response.json(), { ok: true, data: { status: "failed", provider_status: 400 } });
});

test("invalid bodies are 400 without echoing the link", async () => {
  const response = await fetch(url(), {
    method: "POST",
    headers: signedHeaders("owner"),
    body: JSON.stringify({ to: "not-an-email", link: `javascript:${TOKEN}`, expires_at: "soon", extra: true }),
  });
  assert.equal(response.status, 400);
  const text = await response.text();
  assert.equal(text.includes(TOKEN), false);
});

test("the link, token and recipient never reach the logger", () => {
  assert.ok(logged.length > 0, "the service logs its outcomes");
  const all = logged.join("\n");
  assert.equal(all.includes(TOKEN), false);
  assert.equal(all.includes(LINK), false);
  assert.equal(all.includes(TO), false);
});
