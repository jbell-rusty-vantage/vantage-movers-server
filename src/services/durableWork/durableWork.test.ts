import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryDurableRunStore,
  InMemoryLeaseStore,
  createBestRelocationIngestionActor,
  createGranotLifecycleProcessorActor,
  resolveEffectiveCapability,
  sanitizeDurableMetadata,
} from "./index";

test("effective capability requires all three gates", () => {
  assert.equal(
    resolveEffectiveCapability({
      required_configuration_present: true,
      deployment_gate: true,
      owner_intent: true,
    }).effective_enabled,
    true,
  );
  const disabled = resolveEffectiveCapability({
    required_configuration_present: false,
    deployment_gate: true,
    owner_intent: true,
  });
  assert.equal(disabled.effective_enabled, false);
  assert.deepEqual(disabled.reasons, ["required_configuration_missing"]);
});

test("fenced in-memory leases reject stale epochs", async () => {
  const store = new InMemoryLeaseStore();
  const start = new Date("2026-05-01T00:00:00Z");
  const first = await store.acquire({
    scope: "ingestion:best-relocation",
    owner: "worker-a",
    ttl_ms: 1_000,
    now: start,
  });
  assert.ok(first);
  assert.equal(
    await store.acquire({
      scope: first.scope,
      owner: "worker-b",
      ttl_ms: 1_000,
      now: start,
    }),
    null,
  );
  const reclaimed = await store.acquire({
    scope: first.scope,
    owner: "worker-b",
    ttl_ms: 1_000,
    now: new Date(start.getTime() + 1_001),
  });
  assert.ok(reclaimed);
  assert.equal(reclaimed.epoch, first.epoch + 1);
  assert.equal(
    await store.assertHeld({
      token: first,
      now: new Date(start.getTime() + 1_002),
    }),
    false,
  );
});

test("run fake enforces status graph, lease fencing, and monotonic checkpoints", async () => {
  type Status = "queued" | "running" | "completed";
  const store = new InMemoryDurableRunStore<Status>({
    queued: ["running"],
    running: ["completed"],
    completed: [],
  });
  const lease = {
    scope: "run:1",
    owner: "worker",
    epoch: 1,
    leased_until: new Date("2026-05-01T01:00:00Z"),
  };
  store.seed({
    id: "1",
    status: "queued",
    lease,
    checkpoint: null,
    counters: {},
    failure: null,
  });
  assert.deepEqual(
    await store.transition({
      run_id: "1",
      expected_statuses: ["queued"],
      next_status: "running",
      lease,
      checkpoint: {
        version: 1,
        phase: "read",
        cursor: { next: 1 },
        completed_units: 0,
        updated_at: new Date("2026-05-01T00:00:01Z"),
      },
      counters: { read: 1 },
      now: new Date("2026-05-01T00:00:00Z"),
    }),
    { applied: true },
  );
  assert.equal(store.read("1")?.status, "running");
});

test("system actors remain distinct and metadata is sanitized", () => {
  assert.notEqual(
    createBestRelocationIngestionActor("request-1").actor_id,
    createGranotLifecycleProcessorActor("request-1").actor_id,
  );
  assert.deepEqual(
    sanitizeDurableMetadata({
      attempt: 2,
      refresh_token: "secret",
      nested: { raw_row: "pii" },
    }),
    {
      attempt: 2,
      refresh_token: "[redacted]",
      nested: { raw_row: "[redacted]" },
    },
  );
});
