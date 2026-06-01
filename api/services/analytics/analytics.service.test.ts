import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { BookedLead } from "../../models/BookedLead";
import { analyticsQuerySchema, analyticsReportSchema } from "../../validation/v1.validation";
import { bookedLeadPrefix } from "./analyticsFilters";
import { exportAnalyticsReportCsv } from "./analyticsExport.service";
import { mergeAnalyticsPayload } from "./analyticsMerge";

type MutableModel = Record<string, unknown>;

const originalBookedAggregate = BookedLead.aggregate as unknown;

afterEach(() => {
  (BookedLead as unknown as MutableModel).aggregate = originalBookedAggregate;
});

test("analytics validation accepts report filters and rejects invalid report names", () => {
  const query = analyticsQuerySchema.parse({
    database_scope: "combined",
    from: "2026-01-01",
    to: "2026-01-31",
    source_company: "Main Site Forms",
    agent: "Austin",
    lead_type: "form",
    granularity: "day",
  });

  assert.equal(query.database_scope, "combined");
  assert.equal(query.lead_type, "FormLead");
  assert.equal(query.granularity, "day");
  assert.equal(analyticsReportSchema.parse("revenue-trend"), "revenue-trend");
  assert.throws(() => analyticsReportSchema.parse("unknown-report"));
});

test("analytics booked lead filters start with a leading date match", () => {
  const query = analyticsQuerySchema.parse({
    from: "2026-02-01",
    to: "2026-02-28",
    merchant: "Elavon",
  });
  const pipeline = bookedLeadPrefix(query);

  assert.deepEqual(Object.keys(pipeline[0]), ["$match"]);
  assert.match(JSON.stringify(pipeline[0]), /book_date/);
  assert.match(JSON.stringify(pipeline[0]), /merchant/);
});

test("combined source analytics merge by stable text dimension instead of ids", () => {
  const merged = mergeAnalyticsPayload("source-company-performance", [
    {
      items: [
        {
          source_company: "Main Site Forms",
          bookings: 2,
          cancelled_bookings: 1,
          total_deposit_amount: 3000,
          total_binder_amount: 500,
        },
      ],
    },
    {
      items: [
        {
          source_company: "main_site",
          bookings: 3,
          cancelled_bookings: 1,
          total_deposit_amount: 4500,
          total_binder_amount: 750,
        },
      ],
    },
  ]);

  const items = merged.items as Record<string, unknown>[];
  assert.equal(items.length, 1);
  assert.equal(items[0].bookings, 5);
  assert.equal(items[0].cancelled_bookings, 2);
  assert.equal(items[0].total_deposit_amount, 7500);
});

test("combined revenue trend merges rows by date period", () => {
  const merged = mergeAnalyticsPayload("revenue-trend", [
    { items: [{ period: "2026-01", bookings: 1, total_deposit_amount: 1000 }] },
    { items: [{ period: "2026-01", bookings: 2, total_deposit_amount: 2000 }] },
  ]);

  const items = merged.items as Record<string, unknown>[];
  assert.equal(items.length, 1);
  assert.equal(items[0].period, "2026-01");
  assert.equal(items[0].bookings, 3);
  assert.equal(items[0].total_deposit_amount, 3000);
});

test("analytics CSV export uses the selected report rows", async () => {
  (BookedLead as unknown as MutableModel).aggregate = () =>
    Promise.resolve([
      {
        source_company: "Main Site Forms",
        bookings: 1,
        cancelled_bookings: 0,
        active_bookings: 1,
        total_deposit_amount: 1200,
        total_binder_amount: 300,
        booking_rate: null,
        cancellation_rate: 0,
      },
    ]);

  const query = analyticsQuerySchema.parse({ database_scope: "production" });
  const result = await exportAnalyticsReportCsv("source-company-performance", query);

  assert.equal(result.filename, "analytics-source-company-performance-production.csv");
  assert.match(result.csv, /^source_company,bookings,cancelled_bookings/);
  assert.match(result.csv, /Main Site Forms,1,0,1,1200,300/);
});
