import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientSession } from "mongoose";
import { CplRatePeriod } from "../../models/CplRatePeriod";
import type { RegistryActorContext, RegistryMutationInput } from "./types";
import {
  applySimpleCplSchedule,
  businessDateToUtc,
  constructAdvancedCplSchedule,
  constructSimpleCplSchedule,
  createCplPeriod,
  dollarsToCents,
  mutateAdvancedCplSchedule,
  ownerInclusiveEndDateToExclusive,
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

test("dollarsToCents accepts canonical non-negative precision", () => {
  assert.equal(dollarsToCents(0), 0);
  assert.equal(dollarsToCents(19.99), 1999);
  assert.equal(dollarsToCents("195"), 19500);
  assert.equal(dollarsToCents("0.10"), 10);
});

test("dollarsToCents rejects negatives, unsafe values, and more than two decimals", () => {
  for (const value of [-1, 1.005, Number.POSITIVE_INFINITY, "1.001", "-0.01", "1."]) {
    assert.throws(
      () => dollarsToCents(value),
      (error: unknown) =>
        hasRegistryCode(error, "REGISTRY_DEPENDENCY_CONFLICT"),
    );
  }
});

test("business dates convert New York local midnight across spring DST", () => {
  const before = businessDateToUtc("2026-03-08");
  const after = businessDateToUtc("2026-03-09");

  assert.equal(before.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(after.toISOString(), "2026-03-09T04:00:00.000Z");
  assert.equal(after.getTime() - before.getTime(), 23 * 60 * 60 * 1000);
});

test("business dates convert New York local midnight across fall DST", () => {
  const before = businessDateToUtc("2026-11-01");
  const after = businessDateToUtc("2026-11-02");

  assert.equal(before.toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(after.toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal(after.getTime() - before.getTime(), 25 * 60 * 60 * 1000);
});

test("owner inclusive end converts to next local midnight exclusive", () => {
  const end = ownerInclusiveEndDateToExclusive("2026-03-08");

  assert.equal(end.date, "2026-03-09");
  assert.equal(end.instant.toISOString(), "2026-03-09T04:00:00.000Z");
});

test("business date conversion rejects malformed and impossible dates", () => {
  assert.throws(() => businessDateToUtc("2026-2-01"), /YYYY-MM-DD/);
  assert.throws(() => businessDateToUtc("2026-02-29"), /valid calendar/);
});

test("active schedule validation accepts contiguous periods and explicit zero", () => {
  const periods = schedule(
    period("p1", 1000, "2026-01-01", "2026-01-31"),
    period("p2", 0, "2026-02-01"),
  );

  assert.doesNotThrow(() =>
    validateCplSchedule(periods, { active: true }),
  );
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

test("inactive schedules may be incomplete but remain ordered and non-overlapping", () => {
  const incomplete = schedule(
    period("p1", 1000, "2026-01-01", "2026-01-15"),
    period("p2", 1200, "2026-02-01", "2026-02-28"),
  );
  assert.doesNotThrow(() =>
    validateCplSchedule(incomplete, { active: false }),
  );

  assert.throws(
    () =>
      validateCplSchedule([...incomplete].reverse(), { active: false }),
    /ordered/,
  );
});

test("simple construction ignores unchanged rates and preserves future periods", () => {
  const current = schedule(
    period("p1", 1000, "2026-01-01", "2026-06-30"),
    period("p2", 2000, "2026-07-01"),
  );
  const result = constructSimpleCplSchedule(
    current,
    "g1",
    "2026-08-01",
    20,
  );

  assert.equal(result.changed, false);
  assert.deepEqual(
    result.periods.map((item) => item.id),
    ["p1", "p2"],
  );
});

test("simple construction splits history and replaces future coverage", () => {
  const current = schedule(period("p1", 1000, "2026-01-01"));
  const result = constructSimpleCplSchedule(
    current,
    "g1",
    "2026-04-01",
    "12.50",
    "new vendor price",
  );

  assert.equal(result.changed, true);
  assert.equal(result.periods.length, 2);
  assert.equal(
    result.periods[0]!.effective_until?.toISOString(),
    "2026-04-01T04:00:00.000Z",
  );
  assert.equal(result.periods[0]!.supersedes, "p1");
  assert.equal(result.periods[1]!.amount_cents, 1250);
  assert.equal(result.periods[1]!.effective_until, undefined);
  validateCplSchedule(result.periods, { active: true });
});

test("advanced operations add, split, correct, and replace schedules", () => {
  const initial = schedule(period("p1", 1000, "2026-01-01"));
  const added = constructAdvancedCplSchedule(
    initial,
    "g1",
    { type: "add_future", effective_date: "2026-04-01", amount: 20 },
    "future",
  );
  assert.deepEqual(
    added.map((item) => item.amount_cents),
    [1000, 2000],
  );
  validateCplSchedule(added, { active: true });

  const identified = added.map((item, index) => ({
    ...item,
    id: `a${index + 1}`,
  }));
  const split = constructAdvancedCplSchedule(
    identified,
    "g1",
    {
      type: "split",
      period_id: "a2",
      effective_date: "2026-06-01",
      amount: 25,
    },
  );
  assert.deepEqual(
    split.map((item) => item.amount_cents),
    [1000, 2000, 2500],
  );
  validateCplSchedule(split, { active: true });

  const corrected = constructAdvancedCplSchedule(
    [period("closed", 1000, "2026-01-01", "2026-01-31")],
    "g1",
    { type: "correct_period", period_id: "closed", amount: 11 },
  );
  assert.equal(
    corrected[0]!.effective_until?.toISOString(),
    "2026-02-01T05:00:00.000Z",
  );
  assert.equal(corrected[0]!.amount_cents, 1100);

  const replaced = constructAdvancedCplSchedule(
    initial,
    "g1",
    {
      type: "replace_schedule",
      periods: [
        { amount: 5, start_date: "2026-01-01", end_date: "2026-01-31" },
        { amount: 6, start_date: "2026-02-01" },
      ],
    },
  );
  assert.deepEqual(
    replaced.map((item) => item.amount_cents),
    [500, 600],
  );
  validateCplSchedule(replaced, { active: true });
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

test("simple command ignores unchanged rows and increments changed rows once", async () => {
  const fake = fakeStore({
    g1: { active: true, revision: 1, periods: [period("p1", 1000, "2026-01-01")] },
    g2: { active: true, revision: 2, periods: [period("p2", 2000, "2026-01-01")] },
  });
  const result = await applySimpleCplSchedule(
    {
      effective_date: "2026-03-01",
      expected_revisions: { g1: 1, g2: 2 },
      changes: [
        { source_granularity_id: "g1", amount: 10 },
        { source_granularity_id: "g2", amount: 25 },
      ],
    },
    ACTOR,
    fake.deps,
  );

  assert.equal(result.changed, true);
  assert.equal(fake.incrementCalls, 1);
  assert.equal(fake.insertCalls, 2);
  assert.equal(result.schedules.length, 1);
  assert.equal(result.schedules[0]!.source_granularity_id, "g2");
  assert.equal(result.schedules[0]!.revision, 3);
});

test("simple command ignores an unchanged row without revision comparison", async () => {
  const fake = fakeStore({
    g1: { active: true, revision: 5, periods: [period("p1", 1000, "2026-01-01")] },
  });
  const result = await applySimpleCplSchedule(
    {
      effective_date: "2026-03-01",
      expected_revisions: { g1: 1 },
      changes: [{ source_granularity_id: "g1", amount: 10 }],
    },
    ACTOR,
    fake.deps,
  );

  assert.deepEqual(result, { changed: false, schedules: [] });
  assert.equal(fake.incrementCalls, 0);
  assert.equal(fake.insertCalls, 0);
});

test("CplRatePeriod model declares the three schedule lookup indexes", () => {
  const indexKeys = CplRatePeriod.schema
    .indexes() as Array<[Record<string, number>, unknown]>;
  const serializedIndexKeys = indexKeys
    .map(([keys]) => JSON.stringify(keys));
  assert.ok(
    serializedIndexKeys.includes(
      JSON.stringify({ source_granularity: 1, effective_from: 1 }),
    ),
  );
  assert.ok(
    serializedIndexKeys.includes(
      JSON.stringify({ source_granularity: 1, effective_until: 1 }),
    ),
  );
  assert.ok(
    serializedIndexKeys.includes(
      JSON.stringify({ source_granularity: 1, archived_at: 1 }),
    ),
  );
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
