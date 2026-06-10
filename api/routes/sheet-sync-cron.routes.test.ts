import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { afterEach, before, after, test } from "node:test";
import express from "express";
import sheetSyncCronRoutes from "./sheet-sync-cron.routes";

const app = express();
app.use(express.json());
app.use(sheetSyncCronRoutes);

let baseUrl = "";
let server: ReturnType<typeof app.listen>;

const originalSecret = process.env.CRON_SECRET;
const originalMode = process.env.SHEET_SYNC_MODE;

before(async () => {
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
});

afterEach(() => {
  restoreEnv("CRON_SECRET", originalSecret);
  restoreEnv("SHEET_SYNC_MODE", originalMode);
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function drain(headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/cron/sheet-sync-drain`, { method: "POST", headers });
}

test("returns 500 when CRON_SECRET is not configured", async () => {
  delete process.env.CRON_SECRET;
  const res = await drain({ authorization: "Bearer anything" });
  assert.equal(res.status, 500);
});

test("returns 401 when the secret does not match", async () => {
  process.env.CRON_SECRET = "expected-secret";
  const res = await drain({ authorization: "Bearer wrong" });
  assert.equal(res.status, 401);
});

test("skips the drain (no DB work) when mode is not queued", async () => {
  process.env.CRON_SECRET = "expected-secret";
  process.env.SHEET_SYNC_MODE = "legacy";
  const res = await drain({ "x-cron-secret": "expected-secret" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; skipped: boolean; reason: string };
  assert.equal(body.ok, true);
  assert.equal(body.skipped, true);
  assert.match(body.reason, /legacy/);
});

test("accepts a bearer token matching CRON_SECRET", async () => {
  process.env.CRON_SECRET = "expected-secret";
  process.env.SHEET_SYNC_MODE = "disabled";
  const res = await drain({ authorization: "Bearer expected-secret" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { skipped: boolean };
  assert.equal(body.skipped, true);
});
