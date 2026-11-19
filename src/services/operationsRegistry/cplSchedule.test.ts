import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientSession } from "mongoose";
import type { RegistryActorContext, RegistryMutationInput } from "./types";
import {
  applySimpleCplSchedule,
  businessDateToUtc,
  createCplPeriod,
  mutateAdvancedCplSchedule,
  resolveCplFromPeriods,
  validateCplSchedule,
  type CplSchedulePeriod,
  type CplScheduleStore,
} from "./cplSchedule";

const ACTOR: RegistryActorContext = {
  actorType: "owner",
  actorId: "owner_1",
  actorLabel: "owner@example.test",
  actorRole: "owner",
  requestId: "req_cpl_1",
};

test("business dates convert New York local midnight across fall DST", () => {
  const before = businessDateToUtc("2026-11-01");
  const after = businessDateToUtc("2026-11-02");

  assert.equal(before.toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(after.toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal(after.getTime() - before.getTime(), 25 * 60 * 60 * 1000);
});

test("active schedule validation rejects gaps, overlaps, and missing open end", () => {
  assert.throws(
    () =>
      validateCplSchedule(
        schedule(
          period("p1", 1000, "2026-01-01", "2026-01-15"),
          period("p2", 1200, "2026-01-17"),
        ),
        { active: true },
      ),
    (error: unknown) => hasRegistryCode(error, "CPL_SCHEDULE_GAP"),
  );

  assert.throws(
    () =>
      validateCplSchedule(
        schedule(
          period("p1", 1000, "2026-01-01", "2026-01-31"),
          period("p2", 1200, "2026-01-31"),
        ),
        { active: true },
      ),
    (error: unknown) => hasRegistryCode(error, "CPL_SCHEDULE_OVERLAP"),
  );

  assert.throws(
    () =>
      validateCplSchedule(
        schedule(period("p1", 1000, "2026-01-01", "2026-01-31")),
        { active: true },
      ),
    (error: unknown) => hasRegistryCode(error, "CPL_SCHEDULE_GAP"),
  );
});

test("resolver uses inclusive start and exclusive end business timestamp", () => {
  const periods = schedule(
    period("p1", 1000, "2026-01-01", "2026-01-31"),
    period("p2", 0, "2026-02-01"),
  );
  const resolved = resolveCplFromPeriods(periods, {
    source_granularity_id: "g1",
    business_timestamp: new Date("2026-02-01T05:00:00.000Z"),
  });

  assert.deepEqual(resolved, {
    status: "resolved",
    amount: 0,
    amount_cents: 0,
    period_id: "p2",
  });
});

test("resolver distinguishes missing, duplicate zero, and not applicable", () => {
  const base = schedule(period("p1", 1000, "2026-01-01"));
  assert.deepEqual(
    resolveCplFromPeriods(base, {
      source_granularity_id: "g1",
      business_timestamp: new Date("2025-12-31T12:00:00.000Z"),
    }),
    { status: "missing_rate", fallback_amount: 0 },
  );
  assert.deepEqual(
    resolveCplFromPeriods(base, {
      source_granularity_id: "g1",
      business_timestamp: new Date("2026-02-01T12:00:00.000Z"),
      duplicate: true,
    }),
    { status: "duplicate_zero", amount: 0, base_period_id: "p1" },
  );
  assert.deepEqual(
    resolveCplFromPeriods([], {
      source_granularity_id: null,
      business_timestamp: new Date("2026-02-01T12:00:00.000Z"),
    }),
    { status: "not_applicable", amount: 0 },
  );
});

test("advanced command returns safe stale revision state without writes", async () => {
  const fake = fakeStore({
    g1: { active: true, revision: 4, periods: [period("p1", 1000, "2026-01-01")] },
  });

  await assert.rejects(
    () =>
      mutateAdvancedCplSchedule(
        {
          source_granularity_id: "g1",
          expected_revision: 3,
          operation: {
            type: "add_future",
            effective_date: "2026-03-01",
            amount: 20,
          },
        },
        ACTOR,
        fake.deps,
      ),
    (error: unknown) => {
      if (!hasRegistryCode(error, "REGISTRY_STALE_REVISION")) return false;
      const remediation = (
        error as { remediation?: Record<string, unknown> }
      ).remediation;
      assert.equal(remediation?.current_revision, 4);
      assert.deepEqual(remediation?.current_schedule, [
        {
          id: "p1",
          amount_cents: 1000,
          effective_from_date: "2026-01-01",
          effective_until_date_exclusive: null,
          business_timezone: "America/New_York",
        },
      ]);
      return true;
    },
  );
  assert.equal(fake.incrementCalls, 0);
  assert.equal(fake.insertCalls, 0);
});

test("simple command validates every changed granularity before writing atomically", async () => {
  const fake = fakeStore({
    g1: { active: true, revision: 1, periods: [period("p1", 1000, "2026-01-01")] },
    g2: {
      active: true,
      revision: 2,
      periods: [
        period("p2a", 1000, "2026-01-01", "2026-01-31"),
        period("p2b", 1000, "2026-03-01"),
      ],
    },
  });

  await assert.rejects(
    () =>
      applySimpleCplSchedule(
        {
          effective_date: "2026-04-01",
          expected_revisions: { g1: 1, g2: 2 },
          changes: [
            { source_granularity_id: "g1", amount: 20 },
            { source_granularity_id: "g2", amount: 20 },
          ],
        },
        ACTOR,
        fake.deps,
      ),
    (error: unknown) => hasRegistryCode(error, "CPL_SCHEDULE_GAP"),
  );
  assert.equal(fake.incrementCalls, 0);
  assert.equal(fake.insertCalls, 0);
});

function period(
  id: string,
  amountCents: number,
  startDate: string,
  inclusiveEndDate?: string,
): CplSchedulePeriod {
  const created = createCplPeriod("g1", {
    amount: amountCents / 100,
    start_date: startDate,
    ...(inclusiveEndDate ? { end_date: inclusiveEndDate } : {}),
  });
  return { ...created, id };
}

function schedule(...periods: CplSchedulePeriod[]): CplSchedulePeriod[] {
  return periods;
}

function hasRegistryCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "registryCode" in error &&
    error.registryCode === code
  );
}

function fakeStore(
  initial: Record<
    string,
    { active: boolean; revision: number; periods: CplSchedulePeriod[] }
  >,
): {
  deps: {
    store: CplScheduleStore;
    runMutation: <T>(input: RegistryMutationInput<T>) => Promise<T>;
    now: () => Date;
  };
  readonly incrementCalls: number;
  readonly insertCalls: number;
} {
  let incrementCalls = 0;
  let insertCalls = 0;
  let nextId = 1;
  const state = new Map(
    Object.entries(initial).map(([id, value]) => [
      id,
      {
        active: value.active,
        revision: value.revision,
        periods: value.periods.map((item) => ({ ...item })),
      },
    ]),
  );
  const store: CplScheduleStore = {
    async loadGranularity(id) {
      const row = state.get(id);
      return row
        ? {
            id,
            active: row.active,
            schedule_revision: row.revision,
          }
        : null;
    },
    async loadSchedule(id) {
      return (state.get(id)?.periods ?? []).map((item) => ({ ...item }));
    },
    async compareAndIncrementRevision(id, expectedRevision) {
      incrementCalls += 1;
      const row = state.get(id);
      if (!row || row.revision !== expectedRevision) return false;
      row.revision += 1;
      return true;
    },
    async archivePeriods() {},
    async insertPeriods(periods) {
      insertCalls += periods.length;
      return periods.map((item) => ({
        ...item,
        id: `new_${nextId++}`,
      }));
    },
    async findCoveringPeriods(id, at) {
      return (state.get(id)?.periods ?? []).filter(
        (item) =>
          item.effective_from <= at &&
          (!item.effective_until || at < item.effective_until),
      );
    },
  };
  return {
    deps: {
      store,
      runMutation: async <T>(input: RegistryMutationInput<T>) =>
        input.mutate({} as ClientSession),
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    },
    get incrementCalls() {
      return incrementCalls;
    },
    get insertCalls() {
      return insertCalls;
    },
  };
}
