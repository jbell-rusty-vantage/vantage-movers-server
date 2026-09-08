import assert from "node:assert/strict";
import { test } from "node:test";
import { SOURCE_COMPANIES } from "../../config/domain/sources";
import { shouldPublishDailyOperationsRedis } from "../../config/domain/dailyOperations";
import { applyDottedIncrements, buildDayIncrements, buildDaySeed, easternHour } from "./dayDocument";
import {
  decodeDailyOperationsEventCursor,
  encodeDailyOperationsEventCursor,
  listDailyOperationsEvents,
} from "./eventsPage";
import { getDailyOperationsSnapshot } from "./snapshot";

function dayWithTouches(
  day: string,
  touches: readonly string[],
  hour: number,
) {
  const seed = buildDaySeed(day) as ReturnType<typeof buildDaySeed> & {
    revision: number;
  };
  seed.revision = 0;
  applyDottedIncrements(
    seed as unknown as Record<string, unknown>,
    buildDayIncrements(touches, hour),
  );
  return seed;
}

test("missing open day returns seeded zeros, not 404", async () => {
  const snapshot = await getDailyOperationsSnapshot({
    now: () => new Date("2026-09-06T18:14:00.000Z"),
    loadDay: async () => null,
    countOpenIntakes: async () => 2,
    countHeldMessages: async () => 3,
    redisConfigured: () => false,
  });

  assert.equal(snapshot.timezone, "America/New_York");
  assert.equal(snapshot.today, "2026-09-06");
  assert.equal(snapshot.yesterday, "2026-09-05");
  assert.equal(snapshot.generated_at, "2026-09-06T18:14:00.000Z");
  assert.deepEqual(snapshot.redis, { configured: false, mode: "stream" });
  assert.equal(snapshot.metrics.leads.today, 0);
  assert.equal(snapshot.metrics.leads.form, 0);
  assert.equal(snapshot.metrics.bookings.today, 0);
  assert.equal(snapshot.origins.wordpress_form, 0);
  assert.equal(snapshot.metrics.intakes.still_open, 2);
  assert.equal(snapshot.metrics.texts.held_now, 3);
  assert.equal(snapshot.hourly.today.length, 24);
});

test("sheet_sync touches increment the day and surface on the snapshot; pre-hook days read zero", async () => {
  const today = dayWithTouches(
    "2026-09-06",
    ["sheet_sync.completed", "sheet_sync.completed", "sheet_sync.failed"],
    14,
  );
  const legacy = buildDaySeed("2026-09-06") as Record<string, unknown>;
  delete legacy.sheet_sync;
  const deps = {
    now: () => new Date("2026-09-06T18:14:00.000Z"),
    countOpenIntakes: async () => 0,
    countHeldMessages: async () => 0,
    redisConfigured: () => false,
  };

  const snapshot = await getDailyOperationsSnapshot({
    ...deps,
    loadDay: async (day) => (day === "2026-09-06" ? (today as never) : null),
  });
  assert.deepEqual(snapshot.metrics.sheet_sync, { completed: 2, failed: 1 });

  const preHook = await getDailyOperationsSnapshot({
    ...deps,
    loadDay: async (day) => (day === "2026-09-06" ? (legacy as never) : null),
  });
  assert.deepEqual(preHook.metrics.sheet_sync, { completed: 0, failed: 0 });
});

test("missing yesterday yields null totals so the UI can show a dash", async () => {
  const today = dayWithTouches(
    "2026-09-06",
    ["leads.total", "leads.form", "hourly.leads", "bookings.total", "hourly.bookings"],
    14,
  );
  const snapshot = await getDailyOperationsSnapshot({
    now: () => new Date("2026-09-06T18:14:00.000Z"),
    loadDay: async (day) => (day === "2026-09-06" ? (today as never) : null),
    countOpenIntakes: async () => 0,
    countHeldMessages: async () => 0,
    redisConfigured: () => false,
  });

  assert.equal(snapshot.metrics.leads.today, 1);
  assert.equal(snapshot.metrics.leads.yesterday, null);
  assert.equal(snapshot.metrics.leads.yesterday_by_now, null);
  assert.equal(snapshot.metrics.bookings.yesterday, null);
  assert.equal(snapshot.metrics.bookings.yesterday_by_now, null);
  assert.equal(snapshot.metrics.cancellations.yesterday, null);
  assert.equal(snapshot.metrics.texts.yesterday, null);
  assert.equal(snapshot.metrics.webhooks.lead_created.yesterday, null);
  assert.equal(snapshot.companies[0]?.yesterday_total, null);
});

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

test("day_before and day_before_by_now come from the third NY day; missing day is null", async () => {
  const today = buildDaySeed("2026-09-06");
  today.leads.total = 42;
  const yesterday = buildDaySeed("2026-09-05");
  yesterday.leads.total = 38;
  yesterday.hourly[9]!.leads = 31;
  const dayBefore = buildDaySeed("2026-09-04");
  dayBefore.leads.total = 35;
  dayBefore.bookings.total = 4;
  dayBefore.messages.successful = 20;
  dayBefore.hourly[8]!.leads = 12;
  dayBefore.hourly[14]!.leads = 9;
  dayBefore.hourly[16]!.leads = 14;
  dayBefore.hourly[14]!.bookings = 2;
  dayBefore.hourly[13]!.messages = 11;
  dayBefore.webhooks.lead_created = 40;
  dayBefore.companies.top10_leads = { form: 8, call: 3, total: 11 };

  const docs: Record<string, unknown> = {
    "2026-09-06": today,
    "2026-09-05": yesterday,
    "2026-09-04": dayBefore,
  };
  const snapshot = await getDailyOperationsSnapshot({
    now: () => new Date("2026-09-06T18:14:00.000Z"),
    loadDay: async (day) => (docs[day] as never) ?? null,
    countOpenIntakes: async () => 0,
    countHeldMessages: async () => 0,
    redisConfigured: () => false,
  });

  assert.equal(snapshot.day_before, "2026-09-04");
  assert.equal(snapshot.metrics.leads.yesterday, 38);
  assert.equal(snapshot.metrics.leads.yesterday_by_now, 31);
  assert.equal(snapshot.metrics.leads.day_before, 35);
  assert.equal(snapshot.metrics.leads.day_before_by_now, 21);
  assert.equal(snapshot.metrics.bookings.day_before, 4);
  assert.equal(snapshot.metrics.bookings.day_before_by_now, 2);
  assert.equal(snapshot.metrics.texts.day_before, 20);
  assert.equal(snapshot.metrics.texts.day_before_by_now, 11);
  assert.equal(snapshot.metrics.webhooks.lead_created.day_before, 40);
  assert.equal(snapshot.metrics.webhooks.booked.day_before, 0);
  assert.equal(
    snapshot.companies.find((row) => row.source_company === "top10_leads")?.day_before_total,
    11,
  );
  assert.equal(snapshot.hourly.day_before.length, 24);
  assert.equal(snapshot.hourly.day_before[16]?.leads, 14);

  const withoutDayBefore = await getDailyOperationsSnapshot({
    now: () => new Date("2026-09-06T18:14:00.000Z"),
    loadDay: async (day) => (day === "2026-09-04" ? null : ((docs[day] as never) ?? null)),
    countOpenIntakes: async () => 0,
    countHeldMessages: async () => 0,
    redisConfigured: () => false,
  });
  assert.equal(withoutDayBefore.metrics.leads.yesterday_by_now, 31);
  assert.equal(withoutDayBefore.metrics.leads.day_before, null);
  assert.equal(withoutDayBefore.metrics.leads.day_before_by_now, null);
  assert.equal(withoutDayBefore.metrics.webhooks.lead_created.day_before, null);
  assert.equal(withoutDayBefore.companies[0]?.day_before_total, null);
  assert.equal(withoutDayBefore.hourly.day_before.length, 24);
  assert.equal(
    withoutDayBefore.hourly.day_before.every((bucket) => bucket.leads === 0),
    true,
  );
});

test("every SOURCE_COMPANIES slug is present including zeros", async () => {
  const today = buildDaySeed("2026-09-06");
  today.companies.top10_leads = { form: 12, call: 5, total: 17 };
  const yesterday = buildDaySeed("2026-09-05");
  yesterday.companies.top10_leads = { form: 10, call: 5, total: 15 };

  const snapshot = await getDailyOperationsSnapshot({
    now: () => new Date("2026-09-06T18:14:00.000Z"),
    loadDay: async (day) =>
      day === "2026-09-06" ? (today as never) : (yesterday as never),
    countOpenIntakes: async () => 0,
    countHeldMessages: async () => 0,
    redisConfigured: () => false,
  });

  assert.equal(snapshot.companies.length, SOURCE_COMPANIES.length);
  assert.deepEqual(
    snapshot.companies.map((row) => row.source_company),
    [...SOURCE_COMPANIES],
  );
  const top10 = snapshot.companies.find((row) => row.source_company === "top10_leads");
  assert.deepEqual(top10, {
    source_company: "top10_leads",
    form: 12,
    call: 5,
    total: 17,
    yesterday_total: 15,
    day_before_total: 15,
  });
  const silent = snapshot.companies.find((row) => row.source_company === "paid_overflow");
  assert.deepEqual(silent, {
    source_company: "paid_overflow",
    form: 0,
    call: 0,
    total: 0,
    yesterday_total: 0,
    day_before_total: 0,
  });
});

test("wordpress_form is a present key even when zero", async () => {
  const snapshot = await getDailyOperationsSnapshot({
    now: () => new Date("2026-09-06T18:14:00.000Z"),
    loadDay: async () => null,
    countOpenIntakes: async () => 0,
    countHeldMessages: async () => 0,
    redisConfigured: () => false,
  });
  assert.equal(Object.hasOwn(snapshot.origins, "wordpress_form"), true);
  assert.equal(snapshot.origins.wordpress_form, 0);
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

test("GET snapshot does not mutate loaded day documents", async () => {
  const today = buildDaySeed("2026-09-06");
  today.leads.total = 4;
  const before = today.leads.total;
  await getDailyOperationsSnapshot({
    now: () => new Date("2026-09-06T18:14:00.000Z"),
    loadDay: async (day) => (day === "2026-09-06" ? (today as never) : null),
    countOpenIntakes: async () => 0,
    countHeldMessages: async () => 0,
    redisConfigured: () => false,
  });
  assert.equal(today.leads.total, before);
});

test("events cursor is occurred_at ISO plus event id, parsed at the last colon", () => {
  const encoded = encodeDailyOperationsEventCursor({
    occurred_at: new Date("2026-09-06T18:14:00.000Z"),
    event_id: "68bcf1a0c4d5e6f708901234",
  });
  assert.equal(encoded, "2026-09-06T18:14:00.000Z:68bcf1a0c4d5e6f708901234");
  assert.deepEqual(decodeDailyOperationsEventCursor(encoded), {
    occurred_at: "2026-09-06T18:14:00.000Z",
    event_id: "68bcf1a0c4d5e6f708901234",
  });
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

test("test runner reports redis.configured false without constructing a client", async () => {
  assert.equal(shouldPublishDailyOperationsRedis(), false);
  const snapshot = await getDailyOperationsSnapshot({
    now: () => new Date("2026-09-06T18:14:00.000Z"),
    loadDay: async () => null,
    countOpenIntakes: async () => 0,
    countHeldMessages: async () => 0,
  });
  assert.equal(snapshot.redis.configured, false);
  assert.equal(snapshot.redis.mode, "stream");
});
