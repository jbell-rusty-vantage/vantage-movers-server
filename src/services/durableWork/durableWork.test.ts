import assert from "node:assert/strict";
import test from "node:test";
import { SheetSyncLease } from "../../models/SheetSyncLease";
import {
  CanonicalSerializationError,
  InMemoryDurableRunStore,
  InMemoryLeaseStore,
  assertChecksum,
  canonicalJson,
  classifyGoogleFailure,
  computeChecksum,
  createBestRelocationIngestionActor,
  createReportingProjectionActor,
  decideProviderRetry,
  resolveEffectiveCapability,
  sanitizeDurableMetadata,
  type ChecksumEnvelope,
} from "./index";

test("canonical JSON is stable across object insertion order", () => {
  const left = { z: 1, nested: { b: 2, a: [3, new Date("2026-05-01T00:00:00Z")] } };
  const right = { nested: { a: [3, new Date("2026-05-01T00:00:00.000Z")], b: 2 }, z: 1 };
  assert.equal(canonicalJson(left), canonicalJson(right));

  const envelope: ChecksumEnvelope<typeof left> = {
    checksum_version: 1,
    artifact_kind: "ingestion_plan",
    schema_version: 2,
    payload: left,
  };
  const checksum = computeChecksum(envelope);
  assert.match(checksum, /^[a-f0-9]{64}$/);
  assertChecksum(envelope, checksum.toUpperCase());
});

test("canonical JSON rejects unsupported values", () => {
  assert.throws(
    () => canonicalJson({ secret: undefined }),
    CanonicalSerializationError,
  );
  assert.throws(
    () => canonicalJson({ value: Number.POSITIVE_INFINITY }),
    CanonicalSerializationError,
  );
});

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

test("provider failures classify and retry deterministically", () => {
  assert.equal(classifyGoogleFailure({ response: { status: 429 } }), "retryable_rate_limit");
  assert.equal(classifyGoogleFailure({ code: "ETIMEDOUT" }), "retryable_transient");
  assert.equal(classifyGoogleFailure({ status: 401 }), "authentication");
  assert.equal(classifyGoogleFailure({ status: 403 }), "authorization");
  assert.equal(classifyGoogleFailure({ status: 404 }), "not_found");
  assert.equal(classifyGoogleFailure({ status: 400 }), "invalid_request");
  assert.equal(classifyGoogleFailure({ code: "CHECKSUM_MISMATCH" }), "structural");

  const now = new Date("2026-05-01T00:00:00Z");
  assert.deepEqual(
    decideProviderRetry({
      failure_class: "retryable_transient",
      attempt: 2,
      now,
      deadline: new Date(now.getTime() + 60_000),
      policy: {
        max_attempts: 5,
        base_delay_ms: 1_000,
        max_delay_ms: 10_000,
        max_elapsed_ms: 120_000,
        defer_delay_ms: 30_000,
        started_at: now,
        random: () => 0.5,
      },
    }),
    {
      action: "retry",
      delay_ms: 1_000,
      failure_class: "retryable_transient",
    },
  );
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

test("model-backed lease schema carries unique scope and fencing epoch", () => {
  assert.ok(SheetSyncLease.schema.path("lease_epoch"));
  const uniqueScope = SheetSyncLease.schema
    .indexes()
    .find((entry: unknown) => {
      const [fields, options] = entry as [
        Record<string, unknown>,
        { unique?: boolean },
      ];
      return fields.scope === 1 && options.unique === true;
    });
  assert.ok(uniqueScope);
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
    createReportingProjectionActor("request-1").actor_id,
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
