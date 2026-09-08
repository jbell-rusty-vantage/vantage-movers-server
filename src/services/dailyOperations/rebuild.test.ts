import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDaySeed } from "./dayDocument";
import {
  DailyOperationsRebuildError,
  rebuildOpenDailyOperationsDay,
  type DailyOperationsRebuildCounters,
} from "./rebuild";

function counters(overrides: Partial<DailyOperationsRebuildCounters> = {}) {
  const seed = buildDaySeed("2026-09-06");
  return {
    leads: seed.leads,
    origins: seed.origins,
    companies: seed.companies,
    webhooks: seed.webhooks,
    decisions: seed.decisions,
    messages: seed.messages,
    bookings: seed.bookings,
    cancellations: seed.cancellations,
    intakes: seed.intakes,
    exceptions: seed.exceptions,
    hourly: seed.hourly,
    ...overrides,
  } satisfies DailyOperationsRebuildCounters;
}

test("rebuild of an open day replaces counters and never deletes events", async () => {
  const open = buildDaySeed("2026-09-06") as ReturnType<typeof buildDaySeed> & {
    revision: number;
    status: "open" | "closed";
  };
  open.revision = 4;
  open.leads.total = 1;
  const events = [{ id: "evt-1" }, { id: "evt-2" }];
  let replaced: DailyOperationsRebuildCounters | undefined;
  let deleteCalls = 0;

  const rebuilt = counters();
  rebuilt.leads.total = 9;
  rebuilt.leads.form = 6;
  rebuilt.leads.call = 3;
  rebuilt.origins.granot_lead_created = 4;

  const result = await rebuildOpenDailyOperationsDay({
    now: () => new Date("2026-09-06T18:14:00.000Z"),
    loadDay: async () => open as never,
    aggregateOpenDay: async () => rebuilt,
    replaceCounters: async ({ counters: next, previousRevision }) => {
      replaced = next;
      return previousRevision + 1;
    },
  });

  assert.equal(result.rebuilt, true);
  assert.equal(result.events_deleted, false);
  assert.equal(result.day, "2026-09-06");
  assert.equal(result.status, "open");
  assert.equal(result.revision, 5);
  assert.equal(replaced?.leads.total, 9);
  assert.equal(replaced?.origins.granot_lead_created, 4);
  assert.equal(events.length, 2);
  assert.equal(deleteCalls, 0);
});

test("rebuild refuses a closed day and leaves counters and events alone", async () => {
  const closed = buildDaySeed("2026-09-06") as ReturnType<typeof buildDaySeed> & {
    revision: number;
    status: "open" | "closed";
  };
  closed.status = "closed";
  closed.revision = 8;
  closed.leads.total = 12;
  let replaceCalls = 0;
  let aggregateCalls = 0;

  await assert.rejects(
    () =>
      rebuildOpenDailyOperationsDay({
        now: () => new Date("2026-09-06T18:14:00.000Z"),
        loadDay: async () => closed as never,
        aggregateOpenDay: async () => {
          aggregateCalls += 1;
          return counters();
        },
        replaceCounters: async () => {
          replaceCalls += 1;
          return 9;
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof DailyOperationsRebuildError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "DAY_CLOSED");
      return true;
    },
  );
  assert.equal(closed.leads.total, 12);
  assert.equal(replaceCalls, 0);
  assert.equal(aggregateCalls, 0);
});

test("rebuild of a missing open day still writes seeded counters", async () => {
  let wroteDay: string | null = null;
  const result = await rebuildOpenDailyOperationsDay({
    now: () => new Date("2026-09-06T18:14:00.000Z"),
    loadDay: async () => null,
    aggregateOpenDay: async () => counters(),
    replaceCounters: async ({ day, previousRevision }) => {
      wroteDay = day;
      return previousRevision + 1;
    },
  });
  assert.equal(wroteDay, "2026-09-06");
  assert.equal(result.revision, 1);
});

test("rebuild rejects a deleteEvents hook so events stay append-only", async () => {
  await assert.rejects(
    () =>
      rebuildOpenDailyOperationsDay({
        now: () => new Date("2026-09-06T18:14:00.000Z"),
        loadDay: async () => buildDaySeed("2026-09-06") as never,
        aggregateOpenDay: async () => counters(),
        replaceCounters: async () => 1,
        deleteEvents: async () => 2,
      }),
    (error: unknown) => {
      assert.ok(error instanceof DailyOperationsRebuildError);
      assert.equal(error.code, "EVENTS_APPEND_ONLY");
      return true;
    },
  );
});
