import assert from "node:assert/strict";
import { after, test } from "node:test";
import { MongoClient } from "mongodb";
import { ringCentralReadResponse, ringCentralRequest, RingCentralApiError } from "./client";
import { providerSuppliedRetryAfter, throttleRetryAfterMs, isProviderThrottle } from "../numberActivity/callLogClient";
import {
  acquireRingCentralSlot,
  createMongoRingCentralRateGate,
  decideGate,
  providerRetryAfterMs,
  RingCentralGateDeniedError,
  ringCentralGateConfig,
  ringCentralGateGroup,
  setRingCentralRateGateForTests,
  type GateDecision,
  type GateDocument,
  type RingCentralRateGate,
} from "./rateLimitGate";

const NOW = new Date("2026-09-25T03:30:00.000Z");
const CONFIG = { enabled: true, heavyPerMinute: 8, heavyLowPriorityPerMinute: 4, highPriorityMaxWaitMs: 70_000 };
const ago = (ms: number) => new Date(NOW.getTime() - ms);

after(() => setRingCentralRateGateForTests(null));

test("group: Call Log, Call Log Sync and recording reads are Heavy; everything else is other", () => {
  for (const endpoint of [
    "/restapi/v1.0/account/~/call-log?dateFrom=x&view=Detailed",
    "/restapi/v1.0/account/~/call-log/Abc123?view=Detailed",
    "/restapi/v1.0/account/~/call-log-sync?syncType=ISync",
    "/restapi/v1.0/account/800000000001/call-log?phoneNumber=%2B1",
    "/restapi/v1.0/account/800000000001/recording/42",
    "/restapi/v1.0/account/800000000001/recording/42/content",
  ]) assert.equal(ringCentralGateGroup(endpoint), "heavy", endpoint);
  for (const endpoint of [
    "/restapi/v1.0/account/~/extension?page=1",
    "/restapi/v1.0/subscription",
    "/restapi/v1.0/account/~",
    "/analytics/calls/v1/accounts/~/aggregation/fetch?page=1&perPage=200",
  ]) assert.equal(ringCentralGateGroup(endpoint), "other", endpoint);
});

test("config: defaults 8/min Heavy, 4/min for low priority, 70 s wait; limits clamp to the provider's 10", () => {
  assert.deepEqual(ringCentralGateConfig({}), CONFIG);
  assert.equal(ringCentralGateConfig({ RINGCENTRAL_HEAVY_REQUESTS_PER_MINUTE: "25" }).heavyPerMinute, 8);
  assert.equal(ringCentralGateConfig({ RINGCENTRAL_HEAVY_REQUESTS_PER_MINUTE: "3" }).heavyLowPriorityPerMinute, 3);
  assert.equal(ringCentralGateConfig({ RINGCENTRAL_RATE_GATE: "off" }).enabled, false);
});

test("decide: an open gate refuses every priority and group until open_until", () => {
  const state = { open_until: new Date(NOW.getTime() + 42_000), grants: [] };
  for (const group of ["heavy", "other"] as const) {
    assert.deepEqual(decideGate(state, { group, priority: "high", now: NOW, config: CONFIG }), { granted: false, reason: "gate_open", waitMs: 42_000 });
  }
  assert.deepEqual(decideGate({ open_until: ago(1) }, { group: "heavy", priority: "high", now: NOW, config: CONFIG }), { granted: true });
});

test("decide: sliding 60 s window; low priority stops at its share so high priority keeps headroom", () => {
  const grants = [ago(59_000), ago(50_000), ago(40_000), ago(30_000)];
  assert.deepEqual(decideGate({ grants }, { group: "heavy", priority: "high", now: NOW, config: CONFIG }), { granted: true });
  // Four live grants = the low share: low waits until the oldest leaves the window (1 s).
  assert.deepEqual(decideGate({ grants }, { group: "heavy", priority: "low", now: NOW, config: CONFIG }), { granted: false, reason: "budget", waitMs: 1_000 });
  // Grants older than the window do not count.
  assert.deepEqual(decideGate({ grants: [ago(61_000), ...grants.slice(1)] }, { group: "heavy", priority: "low", now: NOW, config: CONFIG }), { granted: true });
  const full = Array.from({ length: 8 }, (_, i) => ago(55_000 - i * 1_000));
  assert.deepEqual(decideGate({ grants: full }, { group: "heavy", priority: "high", now: NOW, config: CONFIG }), { granted: false, reason: "budget", waitMs: 5_000 });
  // `other` is never budgeted.
  assert.deepEqual(decideGate({ grants: full }, { group: "other", priority: "low", now: NOW, config: CONFIG }), { granted: true });
});

test("Retry-After: seconds, HTTP date, else X-Rate-Limit-Window, else 60 s (not observed)", () => {
  assert.deepEqual(providerRetryAfterMs(new Headers({ "retry-after": "60" }), NOW), { ms: 60_000, observed: true });
  assert.deepEqual(providerRetryAfterMs(new Headers({ "retry-after": new Date(NOW.getTime() + 30_000).toUTCString() }), NOW), { ms: 30_000, observed: true });
  assert.deepEqual(providerRetryAfterMs(new Headers({ "x-rate-limit-window": "60" }), NOW), { ms: 60_000, observed: true });
  assert.deepEqual(providerRetryAfterMs(new Headers(), NOW), { ms: 60_000, observed: false });
});

function fakeGate(decisions: GateDecision[]) {
  const calls = { acquire: [] as Array<{ group: string; priority: string }>, trip: [] as Array<{ group: string; retryAfterMs: number }> };
  const gate: RingCentralRateGate = {
    async tryAcquire(group, priority) {
      calls.acquire.push({ group, priority });
      return decisions.shift() ?? { granted: true };
    },
    async trip(group, retryAfterMs) {
      calls.trip.push({ group, retryAfterMs });
    },
  };
  return { gate, calls };
}

test("acquire: high priority waits for a budget slot inside its bound; low priority never waits", async () => {
  const slept: number[] = [];
  const high = fakeGate([{ granted: false, reason: "budget", waitMs: 2_000 }, { granted: true }]);
  let clock = NOW.getTime();
  await acquireRingCentralSlot("/restapi/v1.0/account/~/call-log?x=1", {
    gate: high.gate,
    now: () => new Date(clock),
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
  });
  assert.equal(high.calls.acquire.length, 2);
  assert.ok(slept[0]! >= 2_000 && slept[0]! < 2_500, "wait + jitter");

  const low = fakeGate([{ granted: false, reason: "budget", waitMs: 2_000 }]);
  await assert.rejects(
    acquireRingCentralSlot("/restapi/v1.0/account/~/call-log?x=1", { gate: low.gate, priority: "low", sleep: async () => assert.fail("low never sleeps") }),
    (error: unknown) => error instanceof RingCentralGateDeniedError && error.reason === "budget" && error.retryAfterMs === 2_000,
  );

  const open = fakeGate([{ granted: false, reason: "gate_open", waitMs: 600_000 }]);
  await assert.rejects(
    acquireRingCentralSlot("/restapi/v1.0/account/~/call-log?x=1", { gate: open.gate, sleep: async () => assert.fail("beyond the bound: no sleep") }),
    (error: unknown) => error instanceof RingCentralGateDeniedError && error.reason === "gate_open",
  );
});

test("acquire: a gate failure fails open (capture never stops on a Mongo hiccup)", async () => {
  const gate: RingCentralRateGate = {
    tryAcquire: async () => {
      throw new Error("mongo down");
    },
    trip: async () => undefined,
  };
  await acquireRingCentralSlot("/restapi/v1.0/account/~/call-log", { gate });
});

test("client: a refused slot throws a gated 429 without sending, carrying the gate's wait for job deferral", async () => {
  const { gate } = fakeGate([{ granted: false, reason: "gate_open", waitMs: 45_000 }]);
  setRingCentralRateGateForTests(gate);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => assert.fail("no request is sent while the gate is closed")) as typeof fetch;
  try {
    const error = await ringCentralRequest("GET", "/restapi/v1.0/account/~/call-log?page=1", undefined, { priority: "low" }).then(
      () => assert.fail("expected a throttle"),
      (e: unknown) => e,
    );
    assert.ok(error instanceof RingCentralApiError);
    assert.equal(error.status, 429);
    assert.equal(error.throttle.gated, true);
    assert.ok(isProviderThrottle(error));
    assert.equal(throttleRetryAfterMs(error), 45_000);
    assert.equal(providerSuppliedRetryAfter(error), true);
  } finally {
    globalThis.fetch = originalFetch;
    setRingCentralRateGateForTests(null);
  }
});

test("recording read: a refused slot answers a local 429 with Retry-After; a provider 429 opens the shared gate", async () => {
  const token = async () => ({ access_token: "t", issued_at: 0, access_token_expires_at: Date.now() + 3_600_000 }) as never;
  const endpoint = "/restapi/v1.0/account/a/recording/r/content";

  const refused = fakeGate([{ granted: false, reason: "budget", waitMs: 12_300 }]);
  setRingCentralRateGateForTests(refused.gate);
  try {
    const response = await ringCentralReadResponse(endpoint, AbortSignal.timeout(5_000), {
      token,
      server: "https://platform.example",
      priority: "low",
      fetch: (async () => assert.fail("no request while refused")) as typeof fetch,
    });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "13");
    assert.deepEqual(refused.calls.acquire, [{ group: "heavy", priority: "low" }]);

    const provider = fakeGate([]);
    setRingCentralRateGateForTests(provider.gate);
    const throttled = await ringCentralReadResponse(endpoint, AbortSignal.timeout(5_000), {
      token,
      server: "https://platform.example",
      fetch: (async () =>
        new Response("{}", { status: 429, headers: { "retry-after": "60", "x-rate-limit-group": "heavy", "x-rate-limit-window": "60" } })) as typeof fetch,
    });
    assert.equal(throttled.status, 429);
    assert.deepEqual(provider.calls.trip, [{ group: "heavy", retryAfterMs: 60_000 }]);
  } finally {
    setRingCentralRateGateForTests(null);
  }
});

// ---------------------------------------------------------------------------
// Opt-in replica proof of the atomic Mongo pipeline:
//   RINGCENTRAL_RATE_GATE_TEST_URI=mongodb://127.0.0.1:27189/?directConnection=true
// Uses database `testvantagemovers_rate_gate`; never a production database.
// ---------------------------------------------------------------------------

const replicaUri = process.env.RINGCENTRAL_RATE_GATE_TEST_URI?.trim();

test("replica: concurrent acquires never exceed the budget; a trip refuses everyone until it expires", async (t) => {
  if (!replicaUri) {
    t.skip("Opt-in via RINGCENTRAL_RATE_GATE_TEST_URI.");
    return;
  }
  const client = await MongoClient.connect(replicaUri);
  try {
    const db = client.db("testvantagemovers_rate_gate");
    assert.match(db.databaseName, /^testvantagemovers/);
    const collection = db.collection<GateDocument>("ringcentral_rate_limit_gates");
    await collection.deleteMany({});
    const gate = createMongoRingCentralRateGate(CONFIG, () => collection);

    // 20 concurrent low-priority tries: exactly the low share (4) is granted.
    const low = await Promise.all(Array.from({ length: 20 }, () => gate.tryAcquire("heavy", "low", NOW)));
    assert.equal(low.filter((d) => d.granted).length, 4);
    // High priority takes the rest of the budget (8 total), then is refused with the slot's wait.
    const high = await Promise.all(Array.from({ length: 10 }, () => gate.tryAcquire("heavy", "high", NOW)));
    assert.equal(high.filter((d) => d.granted).length, 4);
    const refused = high.find((d) => !d.granted);
    assert.ok(refused && !refused.granted && refused.reason === "budget" && refused.waitMs === 60_000);
    // A minute later the window has slid.
    assert.equal((await gate.tryAcquire("heavy", "high", new Date(NOW.getTime() + 60_001))).granted, true);
    const stored = await collection.findOne({ _id: "ringcentral:heavy" });
    assert.equal(stored?.grants?.length, 1, "expired grants are pruned");

    // `other` is never budgeted, and records no grants.
    for (let i = 0; i < 12; i += 1) assert.equal((await gate.tryAcquire("other", "low", NOW)).granted, true);
    assert.equal((await collection.findOne({ _id: "ringcentral:other" }))?.grants?.length, 0);

    const later = new Date(NOW.getTime() + 120_000);
    await gate.trip("heavy", 60_000, later, { header_group: "heavy" });
    // A shorter second trip never shortens the open window.
    await gate.trip("heavy", 5_000, later, { header_group: "heavy" });
    const during = await gate.tryAcquire("heavy", "high", new Date(later.getTime() + 30_000));
    assert.deepEqual(during, { granted: false, reason: "gate_open", waitMs: 30_000 });
    assert.equal((await gate.tryAcquire("heavy", "high", new Date(later.getTime() + 60_001))).granted, true);
    assert.equal((await collection.findOne({ _id: "ringcentral:heavy" }))?.throttle_count, 2);
    await collection.deleteMany({});
  } finally {
    await client.close();
  }
});
