import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import { createGranotLifecycleCronRouter } from "./granot-lifecycle-cron.routes";

const app = express();
app.use(
  createGranotLifecycleCronRouter({
    connect: async () => undefined,
    drain: async () => ({
      trigger: "cron",
      skipped: false,
      scanned: 1,
      claimed: 1,
      completed: 1,
      retried: 0,
      dead_lettered: 0,
      recovered: 0,
      lease_lost: 0,
    }),
  }),
);

let baseUrl = "";
let server: ReturnType<typeof app.listen>;
const originalSecret = process.env.CRON_SECRET;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  restoreEnv("CRON_SECRET", originalSecret);
  await new Promise<void>((resolve, reject) =>
    server.close((error?: Error) => (error ? reject(error) : resolve())),
  );
});

afterEach(() => {
  restoreEnv("CRON_SECRET", originalSecret);
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function drain(headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/cron/granot-lifecycle-drain`, { method: "POST", headers });
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

test("processing-enabled cron returns a bounded summary and no payload values", async () => {
  process.env.CRON_SECRET = "expected-secret";
  const res = await drain({ authorization: "Bearer expected-secret" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.claimed, 1);
  assert.equal("error" in body, false);
  assert.equal(JSON.stringify(body).includes("payload"), false);
});

test("vercel.json registers the five-minute lifecycle drain cron", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
  ) as { crons: Array<{ path: string; schedule: string }> };
  assert.deepEqual(
    manifest.crons.find((entry) => entry.path === "/api/cron/granot-lifecycle-drain"),
    { path: "/api/cron/granot-lifecycle-drain", schedule: "*/5 * * * *" },
  );
});
