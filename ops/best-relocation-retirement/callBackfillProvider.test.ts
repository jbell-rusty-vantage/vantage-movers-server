import assert from "node:assert/strict";
import test from "node:test";
import { RingCentralApiError } from "../../src/services/ringcentral/client";
import { createCallBackfillProviderReader } from "./callBackfillProvider";

const endpoint = "/restapi/v1.0/account/~/call-log/synthetic?view=Detailed";
const throttled = (retryAfterMs?: number, gated = false) => new RingCentralApiError("synthetic quota", 429, "Too Many Requests", endpoint, "GET", null, { retryAfterMs, gated });

test("backfill reads wait for the low-priority budget and retry a transient shared-gate denial", async () => {
  let now = 0, calls = 0;
  const waits: number[] = [];
  const read = createCallBackfillProviderReader({ now: () => now, sleep: async ms => { waits.push(ms); now += ms; },
    request: async (method, path, body, options) => {
      calls++;
      assert.equal(method, "GET"); assert.equal(path, endpoint); assert.equal(body, undefined);
      assert.deepEqual(options, { priority: "low", maxWaitMs: 70_000 });
      if (calls === 1) throw throttled(1500, true);
      return { id: "synthetic", finished: true };
    },
  });
  assert.deepEqual(await read(endpoint), { id: "synthetic", finished: true });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [1500]);
});

test("provider 429 exhaustion is bounded and its Retry-After cooldown also protects the following row", async () => {
  let now = 0, calls = 0;
  const waits: number[] = [];
  const read = createCallBackfillProviderReader({ now: () => now, sleep: async ms => { waits.push(ms); now += ms; },
    request: async (_method, _path, _body, options) => {
      calls++; assert.equal(options?.priority, "low");
      if (calls <= 3) throw throttled(60_000);
      return { id: "following-row" };
    },
  });
  await assert.rejects(read(endpoint), RingCentralApiError);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [60_000, 60_000]);
  assert.deepEqual(await read("/restapi/v1.0/account/~/call-log/next"), { id: "following-row" });
  assert.equal(calls, 4);
  assert.deepEqual(waits, [60_000, 60_000, 60_000]);
});

test("a cooldown longer than the bounded read budget never triggers an early retry or hammers following rows", async () => {
  let calls = 0;
  const read = createCallBackfillProviderReader({ now: () => 0, sleep: async () => { throw new Error("must not wait beyond read budget"); },
    request: async () => { calls++; throw throttled(360_000); },
  });
  await assert.rejects(read(endpoint), RingCentralApiError);
  await assert.rejects(read("/restapi/v1.0/account/~/call-log/next"), /cooldown_exceeds_read_budget/);
  assert.equal(calls, 1);
});

test("non-429 provider failures remain explicit failures without unreviewed retries", async () => {
  let calls = 0;
  const read = createCallBackfillProviderReader({ request: async () => {
    calls++; throw new RingCentralApiError("synthetic missing history", 404, "Not Found", endpoint, "GET", null);
  } });
  await assert.rejects(read(endpoint), (error: unknown) => error instanceof RingCentralApiError && error.status === 404);
  assert.equal(calls, 1);
});

test("gate waits shrink to the remaining total read budget and account requests share the same adapter", async () => {
  let now = 0, calls = 0;
  const waits: number[] = [];
  const read = createCallBackfillProviderReader({ now: () => now, sleep: async ms => { waits.push(ms); now += ms; },
    request: async (_method, path, _body, options) => {
      calls++;
      if (calls === 1) { now += 200_000; throw throttled(1000); }
      assert.equal(path, "/restapi/v1.0/account/~");
      assert.deepEqual(options, { priority: "low", maxWaitMs: 39_000 });
      return { id: "synthetic-account" };
    },
  });
  assert.deepEqual(await read("/restapi/v1.0/account/~"), { id: "synthetic-account" });
  assert.deepEqual(waits, [1000]);
});
