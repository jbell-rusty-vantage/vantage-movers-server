import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import { createRingCentralCronRouter } from "./ringcentral-cron.routes";
import type { RingCentralCallLogSyncSummary } from "../services/ringcentral/call-log-sync.service";

/**
 * Unit 21 / AC-17 — the cron route is a trigger and a mapper only. Normal
 * overlap is a bounded skip, never HTTP 500, and a genuine failure returns a
 * safe non-sensitive body.
 */

let enabled = true;
let nextSummary: RingCentralCallLogSyncSummary = summary({});
let nextError: Error | null = null;
let runCount = 0;

function summary(
  overrides: Partial<RingCentralCallLogSyncSummary>,
): RingCentralCallLogSyncSummary {
  return {
    ranAt: "2026-08-18T12:00:00.000Z",
    windowFrom: "2026-08-18T00:00:00.000Z",
    windowTo: "2026-08-18T12:00:00.000Z",
    leaseOwnerHash: "a1b2c3d4e5f6",
    leaseAcquired: true,
    leaseRecovered: false,
    leaseLost: false,
    skipped: false,
    skipReason: null,
    runtimeMs: 1234,
    fetchedRecords: 2,
    candidateRecords: 1,
    qualifiedRecords: 1,
    ingestActions: {
      lead_created: 0,
      lead_created_duplicate: 0,
      lead_adopted: 1,
      lead_adopted_duplicate: 0,
      shadow_recorded: 0,
      dry_run: 0,
      skipped_already_processed: 0,
    },
    adoptedRecords: 1,
    adoptionConflicts: 0,
    throttledResponses: 0,
    leadsCreated: 0,
    duplicatesFlagged: 0,
    cursorAdvanced: true,
    errors: [],
    ...overrides,
  };
}

const app = express();
app.use(
  createRingCentralCronRouter({
    callLogSyncEnabled: () => enabled,
    analyticsReconcileEnabled: () => false,
    runCallLogSync: async () => {
      runCount += 1;
      if (nextError) throw nextError;
      return nextSummary;
    },
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
  enabled = true;
  nextError = null;
  nextSummary = summary({});
  runCount = 0;
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function callLogSync(headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/cron/ringcentral-call-log-sync`, {
    method: "POST",
    headers,
  });
}

const authorized = { authorization: "Bearer expected-secret" };

test("[AC-17] a disabled Call Log sync never claims the lease", async () => {
  process.env.CRON_SECRET = "expected-secret";
  enabled = false;
  const res = await callLogSync(authorized);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.skipped, true);
  assert.equal(body.reason, "RINGCENTRAL_CALL_LOG_SYNC_ENABLED is not true");
  assert.equal(runCount, 0, "the run must not be invoked while disabled");
});

test("[AC-17] lease contention is a bounded skip, not an HTTP 500", async () => {
  process.env.CRON_SECRET = "expected-secret";
  nextSummary = summary({
    skipped: true,
    skipReason: "lease_held",
    leaseAcquired: false,
    leaseOwnerHash: null,
    cursorAdvanced: false,
    fetchedRecords: 0,
    candidateRecords: 0,
    qualifiedRecords: 0,
    adoptedRecords: 0,
    ingestActions: {
      lead_created: 0,
      lead_created_duplicate: 0,
      lead_adopted: 0,
      lead_adopted_duplicate: 0,
      shadow_recorded: 0,
      dry_run: 0,
      skipped_already_processed: 0,
    },
  });
  const res = await callLogSync(authorized);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.skipped, true);
  assert.equal(body.reason, "lease_held");
  assert.equal("error" in body, false);
});

test("[AC-17] a successful run returns the bounded lease/cursor summary", async () => {
  process.env.CRON_SECRET = "expected-secret";
  const res = await callLogSync(authorized);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    ok: boolean;
    skipped: boolean;
    summary: RingCentralCallLogSyncSummary;
  };
  assert.equal(body.ok, true);
  assert.equal(body.skipped, false);
  assert.equal(body.summary.cursorAdvanced, true);
  assert.equal(body.summary.leaseOwnerHash, "a1b2c3d4e5f6");
  assert.equal(body.summary.runtimeMs, 1234);
  const serialized = JSON.stringify(body);
  for (const forbidden of ["phone", "caller", "Bearer", "authorization", "token"]) {
    assert.equal(
      serialized.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `response leaked ${forbidden}`,
    );
  }
});

test("[AC-17] a genuine failure stays safe and non-sensitive", async () => {
  process.env.CRON_SECRET = "expected-secret";
  nextError = new Error(
    "provider rejected caller +15550001000 with Bearer secret-token",
  );
  const res = await callLogSync(authorized);
  assert.equal(res.status, 500);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.ok, false);
  assert.equal(body.error, "Call log sync failed");
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes("+15550001000"), false);
  assert.equal(serialized.includes("secret-token"), false);
});
