import assert from "node:assert/strict";
import { after, test } from "node:test";
import { MongoClient } from "mongodb";
import {
  acquireRingCentralSlot,
  createMongoRingCentralRateGate,
  decideGate,
  recordRingCentralThrottle,
  setRingCentralRateGateForTests,
  type GateDecision,
  type GateDocument,
  type RingCentralRateGate,
} from "./rateLimitGate";

const NOW = new Date("2026-09-25T03:30:00.000Z");
const CONFIG = {
  enabled: true,
  heavyPerMinute: 8,
  heavyLowPriorityPerMinute: 4,
  highPriorityMaxWaitMs: 70_000,
  lightPerMinute: 40,
  lightLowPriorityPerMinute: 10,
};
const ago = (ms: number) => new Date(NOW.getTime() - ms);

after(() => setRingCentralRateGateForTests(null));

test("light lane honours Retry-After: a provider 429 naming the Light group closes it for every Light caller", async () => {
  const provider = fakeGate([]);
  await recordRingCentralThrottle("/restapi/v1.0/account/~/extension/101/message-sync?syncType=ISync", {
    retryAfterMs: 60_000,
    headerGroup: "Light",
    gate: provider.gate,
    now: NOW,
  });
  assert.deepEqual(provider.calls.trip, [{ group: "light", retryAfterMs: 60_000 }]);
  // A Light 429 seen on an unclassified endpoint still closes the Light bucket the provider named.
  const other = fakeGate([]);
  await recordRingCentralThrottle("/restapi/v1.0/account/~/extension/101/message-store/5/content", { retryAfterMs: 30_000, headerGroup: "light", gate: other.gate, now: NOW });
  assert.deepEqual(other.calls.trip, [{ group: "other", retryAfterMs: 30_000 }, { group: "light", retryAfterMs: 30_000 }]);
  const open = { open_until: new Date(NOW.getTime() + 60_000), grants: [] };
  assert.deepEqual(decideGate(open, { group: "light", priority: "high", now: NOW, config: CONFIG }), { granted: false, reason: "gate_open", waitMs: 60_000 });
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

test("acquire: a gate failure fails open (capture never stops on a Mongo hiccup)", async () => {
  const gate: RingCentralRateGate = {
    tryAcquire: async () => {
      throw new Error("mongo down");
    },
    trip: async () => undefined,
  };
  await acquireRingCentralSlot("/restapi/v1.0/account/~/call-log", { gate });
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

    // Light (RINGCENTRAL-CAPTURE §7): 10 low, then high up to 40, recorded in its own document.
    const lightLow = await Promise.all(Array.from({ length: 30 }, () => gate.tryAcquire("light", "low", NOW)));
    assert.equal(lightLow.filter((d) => d.granted).length, 10);
    const lightHigh = await Promise.all(Array.from({ length: 40 }, () => gate.tryAcquire("light", "high", NOW)));
    assert.equal(lightHigh.filter((d) => d.granted).length, 30);
    assert.equal((await collection.findOne({ _id: "ringcentral:light" }))?.grants?.length, 40);

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
