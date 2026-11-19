import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDaySeed, easternHour } from "./dayDocument";
import { listDailyOperationsEvents } from "./eventsPage";
import { getDailyOperationsSnapshot } from "./snapshot";

test("yesterday_by_now is hourly 0..currentNyHour, not the full yesterday", async () => {
  const today = buildDaySeed("2026-09-06");
  const yesterday = buildDaySeed("2026-09-05");
  yesterday.leads.total = 38;
  yesterday.bookings.total = 5;
  yesterday.cancellations.total = 0;
  yesterday.messages.successful = 22;
  yesterday.hourly[0]!.leads = 10;
  yesterday.hourly[14]!.leads = 21;
  yesterday.hourly[15]!.leads = 7;
  yesterday.hourly[0]!.bookings = 1;
  yesterday.hourly[14]!.bookings = 3;
  yesterday.hourly[23]!.bookings = 1;
  yesterday.hourly[14]!.messages = 18;
  yesterday.hourly[20]!.messages = 4;
  today.leads.total = 42;
  today.leads.form = 28;
  today.leads.call = 14;
  today.leads.duplicate_form = 3;
  today.leads.duplicate_call = 1;
  today.bookings.total = 6;
  today.cancellations.total = 1;
  today.messages.successful = 19;
  today.messages.deferred = 4;
  today.messages.skipped = 4;
  today.messages.failed = 1;

  const snapshot = await getDailyOperationsSnapshot({
    now: () => new Date("2026-09-06T18:14:00.000Z"),
    loadDay: async (day) =>
      day === "2026-09-06" ? (today as never) : (yesterday as never),
    countOpenIntakes: async () => 2,
    countHeldMessages: async () => 3,
    redisConfigured: () => false,
  });

  assert.equal(easternHour(new Date("2026-09-06T18:14:00.000Z")), 14);
  assert.equal(snapshot.metrics.leads.yesterday, 38);
  assert.equal(snapshot.metrics.leads.yesterday_by_now, 31);
  assert.equal(snapshot.metrics.bookings.yesterday, 5);
  assert.equal(snapshot.metrics.bookings.yesterday_by_now, 4);
  assert.equal(snapshot.metrics.cancellations.yesterday, 0);
  assert.equal(snapshot.metrics.cancellations.yesterday_by_now, 0);
  assert.equal(snapshot.metrics.texts.yesterday, 22);
  assert.equal(snapshot.metrics.texts.yesterday_by_now, 18);
  assert.equal(snapshot.metrics.texts.deferred, 4);
  assert.equal(snapshot.metrics.texts.held_now, 3);
});

test("intakes.still_open and texts.held_now are live queries, not day increments", async () => {
  const today = buildDaySeed("2026-09-06");
  today.intakes.opened = 3;
  today.messages.deferred = 4;
  let openQueryCalls = 0;
  let heldQueryCalls = 0;

  const snapshot = await getDailyOperationsSnapshot({
    now: () => new Date("2026-09-06T18:14:00.000Z"),
    loadDay: async (day) => (day === "2026-09-06" ? (today as never) : null),
    countOpenIntakes: async () => {
      openQueryCalls += 1;
      return 7;
    },
    countHeldMessages: async () => {
      heldQueryCalls += 1;
      return 9;
    },
    redisConfigured: () => false,
  });

  assert.equal(snapshot.metrics.intakes.opened_today, 3);
  assert.equal(snapshot.metrics.intakes.still_open, 7);
  assert.equal(snapshot.metrics.texts.deferred, 4);
  assert.equal(snapshot.metrics.texts.held_now, 9);
  assert.equal(openQueryCalls, 1);
  assert.equal(heldQueryCalls, 1);
});

test("events page is newest-first for the NY day and returns next_cursor", async () => {
  const rows = [
    {
      _id: { toString: () => "evt_new" },
      day: "2026-09-06",
      occurred_at: new Date("2026-09-06T18:00:00.000Z"),
      lane: "lead" as const,
      kind: "form_lead.created" as const,
      title: "Form Lead created",
      source_company: "top10_leads",
      ingestion_origin: "granot_lead_created",
      lead_kind: "form" as const,
      job_no: null,
      entity_type: "FormLead",
      entity_id: "1",
      parent_receipt_id: null,
      links: {},
      card: {},
      metric_touches: [],
    },
    {
      _id: { toString: () => "evt_old" },
      day: "2026-09-06",
      occurred_at: new Date("2026-09-06T12:00:00.000Z"),
      lane: "lead" as const,
      kind: "form_lead.created" as const,
      title: "Form Lead created",
      source_company: "top10_leads",
      ingestion_origin: "granot_lead_created",
      lead_kind: "form" as const,
      job_no: null,
      entity_type: "FormLead",
      entity_id: "2",
      parent_receipt_id: null,
      links: {},
      card: {},
      metric_touches: [],
    },
  ];
  const page = await listDailyOperationsEvents(
    { limit: 1 },
    {
      now: () => new Date("2026-09-06T18:14:00.000Z"),
      listEvents: async ({ limit }) => rows.slice(0, limit),
    },
  );
  assert.equal(page.order, "newest_first");
  assert.equal(page.day, "2026-09-06");
  assert.equal(page.items[0]?.event_id, "evt_new");
  assert.equal(page.next_cursor, "2026-09-06T18:00:00.000Z:evt_new");
});

test("snapshot batches the three day documents in one loader call", async () => {
  let batches = 0;
  const snapshot = await getDailyOperationsSnapshot({
    now: () => new Date("2026-10-23T18:00:00Z"),
    loadDays: async (days) => { batches++; assert.deepEqual(days, ["2026-10-23", "2026-10-22", "2026-10-21"]); return days.map(() => null); },
    loadDay: async () => { throw new Error("per-day reads must not run when batched loader is supplied"); },
    countHeldMessages: async () => 0,
    countOpenIntakes: async () => 0,
  });
  assert.equal(batches, 1); assert.equal(snapshot.today, "2026-10-23");
});
