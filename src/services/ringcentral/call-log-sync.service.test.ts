import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  clearCapturedOperationalEvents,
  getCapturedOperationalEvents,
} from "../observability/testObservabilitySink";
import { RingCentralApiError } from "./client";
import { runRingCentralCallLogSync } from "./call-log-sync.service";
import type { RingCentralCallLogSyncDependencies } from "./call-log-sync.service";
import type { RingCentralCallLogSyncStateDocument } from "./call-log-sync-state.store";
import type { RingCentralCallLogVetResult } from "./call-log-vetting";
import type { RingCentralRouteResolution } from "../operationsRegistry";
import {
  getRingCentralAdoptionsTotal,
  getRingCentralCallLogLeaseContentionTotal,
  getRingCentralCallLogRuntimeMsSamples,
  resetRingCentralMetrics,
} from "./ringcentral-metrics";
import type { RingCentralIngestResult } from "./ringcentral-call-lead-ingest.service";

/**
 * Unit 21 / AC-17 — production-interface proof for the Call Log run:
 * claim-before-work, loser no-op, renewal, stop-on-loss, cursor-on-full-success
 * only, the locked 12-hour rolling floor, and bounded PII-safe telemetry.
 *
 * Every dependency (clock, owner, state store, provider, ingest, events) is
 * injected, so nothing here touches Mongo or RingCentral. Mongo lease semantics
 * are proven separately at the replica level.
 */

const T0 = new Date("2026-08-18T12:00:00.000Z");
const LEASE_MS = 5 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

const ROUTE: RingCentralRouteResolution = {
  route_id: "route-unit21",
  assignment_id: "assignment-unit21",
  normalized_target_number: "+15550002000",
  company_id: "company-unit21",
  company_slug: "unit21_synthetic",
  company_label_snapshot: "Unit 21 Synthetic",
  granularity_id: "granularity-unit21",
  granularity_key: "unit21_synthetic_calls",
  granularity_label_snapshot: "Unit 21 Synthetic Calls",
  crm_label_snapshot: "Unit 21 Synthetic Calls",
};

function at(offsetMs: number): Date {
  return new Date(T0.getTime() + offsetMs);
}

function qualifiedVet(index: number): RingCentralCallLogVetResult {
  return {
    callLogId: `call-log-${index}`,
    sessionId: `session-${index}`,
    telephonySessionId: `telephony-${index}`,
    startTime: at(-60_000),
    durationSeconds: 300,
    direction: "Inbound",
    result: "Accepted",
    callerPhoneNumber: "+15550001000",
    callerName: "Synthetic Caller",
    targetPhoneNumber: "+15550002000",
    targetName: "Unit 21 Synthetic",
    sourceLabel: "Unit 21 Synthetic Calls",
    sourceCompany: "unit21_synthetic",
    routeResolution: ROUTE,
    matchedTargetNumber: true,
    answered: true,
    overMinimumDuration: true,
    qualifies: true,
    rejectionReasons: [],
  };
}

function ingestResult(
  overrides: Partial<RingCentralIngestResult> = {},
): RingCentralIngestResult {
  return {
    action: "dry_run",
    duplicate: false,
    duplicateReason: null,
    callLeadId: null,
    telephonySessionId: null,
    callLogId: null,
    convergenceOutcome: "not_found",
    ...overrides,
  };
}

type Calls = {
  order: string[];
  claims: Array<{ owner: string; now: Date }>;
  renewals: Array<{ owner: string; now: Date }>;
  successes: Array<Parameters<RingCentralCallLogSyncDependencies["recordSuccess"]>[0]>;
  errors: Array<Parameters<RingCentralCallLogSyncDependencies["recordError"]>[0]>;
  releases: number;
  routeObservations: number;
  ingested: number;
  pages: number[];
  indexAsserts: number;
};

type HarnessOptions = {
  /** Records returned per page, in page order. */
  pages?: unknown[][];
  claim?: "acquired" | "lease_held" | "recovered";
  priorState?: RingCentralCallLogSyncStateDocument | null;
  renewals?: boolean[];
  successFenced?: boolean;
  errorFenced?: boolean;
  ingestResults?: RingCentralIngestResult[];
  ingestError?: unknown;
  failIngestAtRecord?: number;
  fetchError?: unknown;
  failFetchAtPage?: number;
  routeSnapshotError?: unknown;
  renewIntervalMs?: number;
  perPage?: number;
  tickMs?: number;
};

function harness(options: HarnessOptions = {}) {
  const calls: Calls = {
    order: [],
    claims: [],
    renewals: [],
    successes: [],
    errors: [],
    releases: 0,
    routeObservations: 0,
    ingested: 0,
    pages: [],
    indexAsserts: 0,
  };
  const owner = "rcls_unit21fixedowner00000000000000";
  const tickMs = options.tickMs ?? 10;
  let clock = T0.getTime();
  const renewals = [...(options.renewals ?? [])];
  const ingestResults = [...(options.ingestResults ?? [])];

  const deps: Partial<RingCentralCallLogSyncDependencies> = {
    now: () => {
      const current = new Date(clock);
      clock += tickMs;
      return current;
    },
    createOwner: () => owner,
    assertSingletonIndex: async () => {
      calls.indexAsserts += 1;
      calls.order.push("assert_index");
    },
    acquireLease: async ({ owner: claimOwner, now }) => {
      calls.order.push("acquire");
      calls.claims.push({ owner: claimOwner, now });
      if (options.claim === "lease_held") {
        return { acquired: false, reason: "lease_held" };
      }
      return {
        acquired: true,
        owner: claimOwner,
        leaseAcquiredAt: now,
        leasedUntil: new Date(now.getTime() + LEASE_MS),
        recovered: options.claim === "recovered",
        state: options.priorState ?? null,
      };
    },
    renewLease: async ({ owner: renewOwner, now }) => {
      calls.order.push("renew");
      calls.renewals.push({ owner: renewOwner, now });
      const renewed = renewals.length > 0 ? (renewals.shift() as boolean) : true;
      return {
        renewed,
        leasedUntil: renewed ? new Date(now.getTime() + LEASE_MS) : null,
      };
    },
    recordSuccess: async (input) => {
      calls.order.push("record_success");
      calls.successes.push(input);
      return options.successFenced ?? true;
    },
    recordError: async (input) => {
      calls.order.push("record_error");
      calls.errors.push(input);
      return options.errorFenced ?? true;
    },
    releaseLease: async () => {
      calls.releases += 1;
      return true;
    },
    loadRouteSnapshot: async () => {
      calls.order.push("route_snapshot");
      if (options.routeSnapshotError) {
        throw options.routeSnapshotError;
      }
      return { version: 1, built_at: T0, entries: [] } as never;
    },
    recordRouteObservation: async () => {
      calls.routeObservations += 1;
      calls.order.push("route_observation");
      return undefined as never;
    },
    vetRecord: (record) => record as RingCentralCallLogVetResult,
    fetchCallLogPage: async ({ page }) => {
      calls.order.push("fetch");
      calls.pages.push(page);
      if (options.fetchError && page === (options.failFetchAtPage ?? 1)) {
        throw options.fetchError;
      }
      return options.pages?.[page - 1] ?? [];
    },
    ingestCall: async () => {
      calls.order.push("ingest");
      calls.ingested += 1;
      if (
        options.ingestError &&
        calls.ingested === (options.failIngestAtRecord ?? 1)
      ) {
        throw options.ingestError;
      }
      return ingestResults.length > 0
        ? (ingestResults.shift() as RingCentralIngestResult)
        : ingestResult();
    },
    renewIntervalMs: options.renewIntervalMs ?? 2 * 60 * 1000,
    perPage: options.perPage ?? 250,
    maxPages: 20,
  };

  return { calls, deps, owner };
}

function priorCursorState(
  lastSyncTo: Date,
): RingCentralCallLogSyncStateDocument {
  return {
    key: "account",
    provider: "ringcentral",
    lastSyncFrom: new Date(lastSyncTo.getTime() - 60_000),
    lastSyncTo,
    lastRunAt: lastSyncTo,
    lastRunStatus: "success",
    lastError: null,
    lastProcessedCount: 1,
    lastQualifiedCount: 0,
    lastLeadActionCount: 0,
    updatedAt: lastSyncTo,
  };
}

function eventKeys(): string[] {
  return getCapturedOperationalEvents().map((event) => event.input.eventKey);
}

beforeEach(() => {
  clearCapturedOperationalEvents();
  resetRingCentralMetrics();
});

test("[AC-17] the lease loser performs no provider, route, ingest, or state work", async () => {
  const { calls, deps } = harness({ claim: "lease_held", pages: [[qualifiedVet(1)]] });
  const summary = await runRingCentralCallLogSync(T0, deps);

  assert.equal(summary.skipped, true);
  assert.equal(summary.skipReason, "lease_held");
  assert.equal(summary.leaseAcquired, false);
  assert.equal(summary.cursorAdvanced, false);
  assert.equal(summary.fetchedRecords, 0);
  assert.deepEqual(calls.order, ["assert_index", "acquire"]);
  assert.equal(calls.pages.length, 0);
  assert.equal(calls.ingested, 0);
  assert.equal(calls.routeObservations, 0);
  assert.equal(calls.successes.length, 0);
  assert.equal(calls.errors.length, 0);
  assert.equal(getRingCentralCallLogLeaseContentionTotal(), 1);
  assert.deepEqual(eventKeys(), ["ringcentral.call_log_sync.lease_contended"]);
});

test("[AC-17] two overlapping invocations produce exactly one winner", async () => {
  // One shared in-memory state object stands in for the Mongo singleton so the
  // service-level contract can be exercised; Mongo's own atomicity is proven at
  // the replica level.
  let heldUntil: number | null = null;
  let winners = 0;
  const makeDeps = (owner: string): Partial<RingCentralCallLogSyncDependencies> => ({
    now: () => T0,
    createOwner: () => owner,
    assertSingletonIndex: async () => undefined,
    acquireLease: async ({ now }) => {
      if (heldUntil !== null && heldUntil > now.getTime()) {
        return { acquired: false, reason: "lease_held" };
      }
      heldUntil = now.getTime() + LEASE_MS;
      winners += 1;
      return {
        acquired: true,
        owner,
        leaseAcquiredAt: now,
        leasedUntil: new Date(heldUntil),
        recovered: false,
        state: null,
      };
    },
    renewLease: async ({ now }) => ({
      renewed: true,
      leasedUntil: new Date(now.getTime() + LEASE_MS),
    }),
    recordSuccess: async () => true,
    recordError: async () => true,
    loadRouteSnapshot: async () =>
      ({ version: 1, built_at: T0, entries: [] }) as never,
    fetchCallLogPage: async () => [],
    ingestCall: async () => ingestResult(),
  });

  const [first, second] = await Promise.all([
    runRingCentralCallLogSync(T0, makeDeps("rcls_a")),
    runRingCentralCallLogSync(T0, makeDeps("rcls_b")),
  ]);

  assert.equal(winners, 1);
  const acquired = [first, second].filter((summary) => summary.leaseAcquired);
  const skipped = [first, second].filter((summary) => summary.skipped);
  assert.equal(acquired.length, 1);
  assert.equal(skipped.length, 1);
  assert.equal(acquired[0]?.cursorAdvanced, true);
  assert.equal(skipped[0]?.cursorAdvanced, false);
  assert.equal(skipped[0]?.skipReason, "lease_held");
});

test("[AC-17] the winner claims before any provider or ingest work", async () => {
  const { calls, deps } = harness({ pages: [[qualifiedVet(1)]] });
  await runRingCentralCallLogSync(T0, deps);

  assert.equal(calls.order[0], "assert_index");
  assert.equal(calls.order[1], "acquire");
  assert.equal(calls.order[2], "route_snapshot");
  // The lease is renewed before the long pagination/ingest phase.
  assert.equal(calls.order[3], "renew");
  assert.equal(calls.order[4], "fetch");
  assert.ok(calls.order.indexOf("acquire") < calls.order.indexOf("ingest"));
  assert.equal(calls.claims.length, 1);
});

test("[AC-17] a complete successful run advances the cursor exactly once", async () => {
  const { calls, deps } = harness({
    pages: [[qualifiedVet(1), qualifiedVet(2)]],
    ingestResults: [
      ingestResult({ action: "lead_adopted", convergenceOutcome: "adopted" }),
      ingestResult({
        action: "lead_created_duplicate",
        duplicate: true,
        duplicateReason: "same_caller_within_window",
        convergenceOutcome: "conflict",
      }),
    ],
  });
  const summary = await runRingCentralCallLogSync(T0, deps);

  assert.equal(summary.cursorAdvanced, true);
  assert.equal(calls.successes.length, 1);
  assert.equal(calls.errors.length, 0);
  const success = calls.successes[0]!;
  assert.equal(success.owner, calls.claims[0]?.owner);
  assert.deepEqual(success.syncTo, calls.claims[0]?.now);
  assert.equal(success.processedCount, 2);
  assert.equal(success.qualifiedCount, 2);
  assert.equal(success.leadActionCount, 1);
  assert.equal(success.telemetry.adoptedCount, 1);
  assert.equal(success.telemetry.adoptionConflictCount, 1);
  assert.equal(success.telemetry.throttledCount, 0);
  assert.ok(Number.isInteger(success.telemetry.runtimeMs));
  assert.ok(success.telemetry.runtimeMs >= 0);

  assert.equal(summary.adoptedRecords, 1);
  assert.equal(summary.adoptionConflicts, 1);
  assert.equal(summary.leadsCreated, 1);
  assert.equal(summary.duplicatesFlagged, 1);
  assert.equal(summary.ingestActions.lead_adopted, 1);
  assert.equal(summary.ingestActions.lead_created_duplicate, 1);
  assert.equal(getRingCentralAdoptionsTotal("adopted"), 1);
  assert.equal(getRingCentralAdoptionsTotal("conflict"), 1);
  assert.equal(getRingCentralCallLogRuntimeMsSamples().length, 1);
  assert.ok(eventKeys().includes("ringcentral.call_log_sync.completed"));
});

test("[AC-17] every failure stage leaves the cursor unchanged", async () => {
  const stages: Array<{
    name: string;
    options: HarnessOptions;
    expectedCode: string;
  }> = [
    {
      name: "route snapshot",
      options: { routeSnapshotError: new Error("snapshot unavailable") },
      expectedCode: "route_snapshot_failed",
    },
    {
      name: "provider pagination",
      options: {
        pages: [[qualifiedVet(1)], [qualifiedVet(2)]],
        perPage: 1,
        fetchError: new RingCentralApiError(
          "RingCentral request failed with status 500",
          500,
          "Server Error",
          "/restapi/v1.0/account/~/call-log",
          "GET",
          null,
        ),
        failFetchAtPage: 2,
      },
      expectedCode: "provider_request_failed",
    },
    {
      name: "unrecovered throttling",
      options: {
        fetchError: new RingCentralApiError(
          "RingCentral request failed with status 429",
          429,
          "Too Many Requests",
          "/restapi/v1.0/account/~/call-log",
          "GET",
          null,
        ),
      },
      expectedCode: "provider_throttled",
    },
    {
      name: "ingest / adoption / ledger",
      options: {
        pages: [[qualifiedVet(1), qualifiedVet(2)]],
        ingestError: new Error("ledger write failed"),
        failIngestAtRecord: 2,
      },
      expectedCode: "ingest_failed",
    },
  ];

  for (const stage of stages) {
    clearCapturedOperationalEvents();
    resetRingCentralMetrics();
    const { calls, deps } = harness(stage.options);
    await assert.rejects(() => runRingCentralCallLogSync(T0, deps), `${stage.name}`);
    assert.equal(calls.successes.length, 0, `${stage.name}: cursor advanced`);
    assert.equal(calls.errors.length, 1, `${stage.name}: terminal error write`);
    assert.equal(calls.errors[0]?.errorCode, stage.expectedCode, stage.name);
    assert.ok(
      eventKeys().includes("ringcentral.call_log_sync.failed"),
      `${stage.name}: failure event`,
    );
  }
});

test("[AC-17] an observed provider throttle is counted and blocks cursor movement", async () => {
  const { calls, deps } = harness({
    fetchError: new RingCentralApiError(
      "RingCentral request failed with status 429",
      429,
      "Too Many Requests",
      "/restapi/v1.0/account/~/call-log",
      "GET",
      null,
    ),
  });
  await assert.rejects(() => runRingCentralCallLogSync(T0, deps));
  assert.equal(calls.errors[0]?.telemetry.throttledCount, 1);
  assert.equal(calls.errors[0]?.errorCode, "provider_throttled");
  assert.equal(calls.successes.length, 0);
});

test("[AC-17] a run with no throttling reports zero throttles", async () => {
  const { calls, deps } = harness({ pages: [[qualifiedVet(1)]] });
  const summary = await runRingCentralCallLogSync(T0, deps);
  assert.equal(summary.throttledResponses, 0);
  assert.equal(calls.successes[0]?.telemetry.throttledCount, 0);
});

test("[AC-17] terminal write failure loses the fence and moves no cursor", async () => {
  const { calls, deps } = harness({
    pages: [[qualifiedVet(1)]],
    successFenced: false,
  });
  const summary = await runRingCentralCallLogSync(T0, deps);

  assert.equal(summary.cursorAdvanced, false);
  assert.equal(summary.leaseLost, true);
  assert.equal(calls.errors.length, 0, "no terminal write as the former owner");
  assert.deepEqual(summary.errors, ["lease_lost"]);
  assert.ok(eventKeys().includes("ringcentral.call_log_sync.lease_lost"));
  assert.equal(eventKeys().includes("ringcentral.call_log_sync.completed"), false);
});

test("[AC-17] losing the lease mid-run stops work and writes nothing", async () => {
  const { calls, deps } = harness({
    pages: [[qualifiedVet(1), qualifiedVet(2), qualifiedVet(3)]],
    // Forced pre-pagination renewal and the first record's renewal succeed;
    // the renewal before the second record loses the fence.
    renewals: [true, true, false],
    renewIntervalMs: 0,
  });
  const summary = await runRingCentralCallLogSync(T0, deps);

  assert.equal(summary.leaseLost, true);
  assert.equal(summary.cursorAdvanced, false);
  assert.equal(calls.ingested, 1, "stops starting new records after the loss");
  assert.equal(calls.successes.length, 0);
  assert.equal(calls.errors.length, 0);
  assert.ok(eventKeys().includes("ringcentral.call_log_sync.lease_lost"));
});

test("[AC-17] the lease is renewed while long work remains", async () => {
  const records = Array.from({ length: 6 }, (_, index) => qualifiedVet(index));
  const { calls, deps } = harness({ pages: [records], renewIntervalMs: 0 });
  const summary = await runRingCentralCallLogSync(T0, deps);

  assert.equal(summary.cursorAdvanced, true);
  // One forced renewal before pagination plus one per record.
  assert.ok(calls.renewals.length >= records.length + 1);
  for (const renewal of calls.renewals) {
    assert.equal(renewal.owner, calls.claims[0]?.owner);
  }
});

test("[AC-17] a failed fenced error write degrades to a PII-safe lease-lost event", async () => {
  const { calls, deps } = harness({
    routeSnapshotError: new Error("snapshot unavailable"),
    errorFenced: false,
  });
  const summary = await runRingCentralCallLogSync(T0, deps);

  assert.equal(calls.errors.length, 1, "exactly one fenced terminal attempt");
  assert.equal(summary.leaseLost, true);
  assert.equal(summary.cursorAdvanced, false);
  assert.ok(eventKeys().includes("ringcentral.call_log_sync.lease_lost"));
  assert.equal(eventKeys().includes("ringcentral.call_log_sync.failed"), false);
});

test("[AC-17] expired-lease recovery is reported without erasing terminal facts", async () => {
  const priorSyncTo = at(-30 * 60 * 1000);
  const { calls, deps } = harness({
    claim: "recovered",
    priorState: priorCursorState(priorSyncTo),
    pages: [[]],
  });
  const summary = await runRingCentralCallLogSync(T0, deps);

  assert.equal(summary.leaseRecovered, true);
  assert.ok(eventKeys().includes("ringcentral.call_log_sync.lease_recovered"));
  // The recovering winner still reads the predecessor's committed cursor.
  assert.equal(summary.windowFrom, new Date(T0.getTime() - TWELVE_HOURS_MS).toISOString());
  assert.equal(calls.successes.length, 1);
});

test("[AC-17] the rolling lookback stays exactly 12 hours for a first run", async () => {
  const { deps } = harness({ priorState: null, pages: [[]] });
  const summary = await runRingCentralCallLogSync(T0, deps);
  // min(now - 30m initial lookback, now - 12h floor) = the 12-hour floor.
  assert.equal(
    summary.windowFrom,
    new Date(T0.getTime() - TWELVE_HOURS_MS).toISOString(),
  );
  assert.equal(summary.windowTo, T0.toISOString());
});

test("[AC-17] the rolling lookback stays exactly 12 hours at a 30-minute cadence", async () => {
  // A cursor 30 minutes old (the new cadence) still rescans the full 12 hours.
  const { deps } = harness({
    priorState: priorCursorState(at(-30 * 60 * 1000)),
    pages: [[]],
  });
  const summary = await runRingCentralCallLogSync(T0, deps);
  assert.equal(
    summary.windowFrom,
    new Date(T0.getTime() - TWELVE_HOURS_MS).toISOString(),
  );
});

test("[AC-17] a cursor older than the floor keeps its overlap window", async () => {
  // lastSyncTo 20 hours ago - 15m overlap is earlier than the 12-hour floor.
  const lastSyncTo = at(-20 * 60 * 60 * 1000);
  const { deps } = harness({
    priorState: priorCursorState(lastSyncTo),
    pages: [[]],
  });
  const summary = await runRingCentralCallLogSync(T0, deps);
  assert.equal(
    summary.windowFrom,
    new Date(lastSyncTo.getTime() - 15 * 60 * 1000).toISOString(),
  );
});

test("[AC-17] the winner's window end is its own claim instant", async () => {
  const { calls, deps } = harness({ pages: [[]] });
  const summary = await runRingCentralCallLogSync(T0, deps);
  assert.equal(summary.windowTo, calls.claims[0]?.now.toISOString());
  assert.deepEqual(calls.successes[0]?.syncTo, calls.claims[0]?.now);
});

test("[AC-17] pagination stops at a short page and continues through full pages", async () => {
  const { calls, deps } = harness({
    pages: [[qualifiedVet(1), qualifiedVet(2)], [qualifiedVet(3)]],
    perPage: 2,
  });
  const summary = await runRingCentralCallLogSync(T0, deps);
  assert.deepEqual(calls.pages, [1, 2]);
  assert.equal(summary.fetchedRecords, 3);
  assert.equal(summary.cursorAdvanced, true);
});

test("[AC-17] Call Log telemetry and events carry no caller or provider content", async () => {
  const leakyError = new Error(
    "provider rejected caller +15550001000 for Synthetic Caller with Bearer secret-token",
  );
  const { calls, deps } = harness({
    pages: [[qualifiedVet(1)]],
    ingestError: leakyError,
  });
  await assert.rejects(() => runRingCentralCallLogSync(T0, deps));

  assert.equal(calls.errors[0]?.errorCode, "ingest_failed");
  const serialized = JSON.stringify(getCapturedOperationalEvents());
  for (const forbidden of [
    "+15550001000",
    "Synthetic Caller",
    "secret-token",
    "Bearer",
    "provider rejected",
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `event stream leaked ${forbidden}`,
    );
  }
});

test("[AC-17] emitted lease events expose only a masked owner and bounded fields", async () => {
  const { deps, owner } = harness({ pages: [[qualifiedVet(1)]] });
  await runRingCentralCallLogSync(T0, deps);

  const serialized = JSON.stringify(getCapturedOperationalEvents());
  assert.equal(serialized.includes(owner), false, "raw lease owner leaked");
  const started = getCapturedOperationalEvents().find(
    (event) => event.input.eventKey === "ringcentral.call_log_sync.started",
  );
  assert.ok(started);
  const details = started.input.details as Record<string, unknown>;
  assert.match(String(details.leaseOwnerHash), /^[0-9a-f]{12}$/);
  assert.equal(typeof details.windowFrom, "string");
  assert.equal(typeof details.windowTo, "string");
});

test("[AC-17] the run summary itself exposes no caller data", async () => {
  const { deps } = harness({
    pages: [[qualifiedVet(1)]],
    ingestResults: [
      ingestResult({ action: "lead_adopted", convergenceOutcome: "adopted" }),
    ],
  });
  const summary = await runRingCentralCallLogSync(T0, deps);
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes("+15550001000"), false);
  assert.equal(serialized.includes("Synthetic Caller"), false);
  assert.equal(serialized.includes("call-log-1"), false);
});
