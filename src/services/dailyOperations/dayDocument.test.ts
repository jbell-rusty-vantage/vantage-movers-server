import assert from "node:assert/strict";
import { test } from "node:test";
import { SOURCE_COMPANIES } from "../../config/domain/sources";
import {
  applyDottedIncrements,
  buildDayIncrements,
  buildDaySeed,
  easternDayKey,
  easternHour,
  easternInstantBounds,
  floridaTimestampBounds,
  nextEasternDayKey,
  previousEasternDayKey,
  seedCompanyCounts,
  seedHourlyBuckets,
  sumHourlyThrough,
} from "./dayDocument";

test("2026-06-01T03:00:00.000Z maps to the NY day 2026-05-31", () => {
  const occurredAt = new Date("2026-06-01T03:00:00.000Z");
  assert.equal(easternDayKey(occurredAt), "2026-05-31");
  assert.equal(easternHour(occurredAt), 23);
});

test("first day seed has 24 hourly buckets and known Source Company slugs", () => {
  const hourly = seedHourlyBuckets();
  assert.equal(hourly.length, 24);
  for (let hour = 0; hour < 24; hour += 1) {
    assert.deepEqual(hourly[hour], {
      hour,
      leads: 0,
      bookings: 0,
      cancellations: 0,
      webhooks: 0,
      messages: 0,
    });
  }

  const companies = seedCompanyCounts();
  for (const slug of SOURCE_COMPANIES) {
    assert.deepEqual(companies[slug], { form: 0, call: 0, total: 0 });
  }

  const seed = buildDaySeed("2026-05-31");
  assert.equal(seed.day, "2026-05-31");
  assert.equal(seed.timezone, "America/New_York");
  assert.equal(seed.status, "open");
  assert.equal(seed.hourly.length, 24);
  assert.equal(Object.keys(seed.companies).length, SOURCE_COMPANIES.length);
});

test("metric_touches expand hourly.* onto the NY hour and always bump revision", () => {
  const increments = buildDayIncrements(
    ["leads.form", "leads.total", "hourly.leads", "origins.wordpress_form"],
    23,
  );
  assert.deepEqual(increments, {
    revision: 1,
    "leads.form": 1,
    "leads.total": 1,
    "hourly.23.leads": 1,
    "origins.wordpress_form": 1,
  });
});

test("already-expanded hourly paths stay as written", () => {
  const increments = buildDayIncrements(["hourly.14.leads"], 23);
  assert.equal(increments["hourly.14.leads"], 1);
  assert.equal(increments["hourly.23.leads"], undefined);
});

test("dotted increments apply onto a seeded day including hourly buckets", () => {
  const day = buildDaySeed("2026-05-31") as unknown as Record<string, unknown>;
  applyDottedIncrements(
    day,
    buildDayIncrements(["leads.form", "hourly.leads", "companies.tbm_leads.form"], 23),
  );
  const typed = day as unknown as ReturnType<typeof buildDaySeed> & {
    revision: number;
  };
  assert.equal(typed.leads.form, 1);
  assert.equal(typed.hourly[23]?.leads, 1);
  assert.equal(typed.companies.tbm_leads.form, 1);
  assert.equal(typed.revision, 1);
});

test("previousEasternDayKey walks the NY calendar, not UTC midnight", () => {
  assert.equal(previousEasternDayKey("2026-09-06"), "2026-09-05");
  assert.equal(previousEasternDayKey("2026-01-01"), "2025-12-31");
  assert.equal(nextEasternDayKey("2026-09-06"), "2026-09-07");
});

test("florida timestamp bounds are UTC wall-clock of the day key", () => {
  const bounds = floridaTimestampBounds("2026-09-06");
  assert.equal(bounds.start.toISOString(), "2026-09-06T00:00:00.000Z");
  assert.equal(bounds.end.toISOString(), "2026-09-07T00:00:00.000Z");
});

test("eastern instant bounds start at NY midnight, not UTC midnight", () => {
  const bounds = easternInstantBounds("2026-09-06");
  assert.equal(easternDayKey(bounds.start), "2026-09-06");
  assert.equal(easternHour(bounds.start), 0);
  assert.equal(easternDayKey(new Date(bounds.end.getTime() - 1)), "2026-09-06");
  assert.notEqual(bounds.start.toISOString(), "2026-09-06T00:00:00.000Z");
});

test("sumHourlyThrough is pace 0..currentNyHour, not the full day", () => {
  const hourly = seedHourlyBuckets();
  hourly[0]!.leads = 10;
  hourly[14]!.leads = 5;
  hourly[15]!.leads = 20;
  assert.equal(sumHourlyThrough(hourly, 14, "leads"), 15);
  assert.equal(sumHourlyThrough(hourly, 23, "leads"), 35);
});
