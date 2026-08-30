import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RECENT_OFFICIAL_BOOKING_EXAMPLE_LIMIT,
  listRecentOfficialBookingExamples,
} from "./recent-official-bookings.js";

function listFrom(rows: Array<Record<string, unknown>>) {
  return listRecentOfficialBookingExamples({
    async findBookings({ limit }) {
      return rows.slice(0, limit);
    },
  });
}

test("recent official booking examples stay capped at three and newest book_date first", async () => {
  const examples = await listRecentOfficialBookingExamples({
    async findBookings({ filter, projection, sort, limit }) {
      assert.equal(limit, RECENT_OFFICIAL_BOOKING_EXAMPLE_LIMIT);
      assert.equal(limit, 3);
      assert.equal(sort.book_date, -1);
      assert.equal(projection.job_no, 1);
      assert.equal(projection.normalized_job_no, 1);
      assert.equal(projection.book_date, 1);
      assert.equal(projection.customer_name, undefined);
      assert.ok(filter.$or);
      return [
        { job_no: "P9003", book_date: new Date("2026-08-20T14:00:00.000Z") },
        { job_no: "P9002", book_date: new Date("2026-08-19T14:00:00.000Z") },
        { job_no: "P9001", book_date: new Date("2026-08-18T14:00:00.000Z") },
        { job_no: "P9000", book_date: new Date("2026-08-17T14:00:00.000Z") },
      ];
    },
  });

  assert.deepEqual(
    examples.map((row) => row.job_no),
    ["P9003", "P9002", "P9001"],
  );
  assert.equal(examples[0]?.booked_at, "2026-08-20T14:00:00.000Z");
});

test("recent official booking examples skip rows without a Job Number and never copy contact", async () => {
  const examples = await listFrom([
    {
      job_no: "P7001",
      customer_name: "Ada Example",
      phone: "555-0100",
      book_date: new Date("2026-08-21T10:00:00.000Z"),
    },
    { job_no: "   ", normalized_job_no: "", book_date: new Date("2026-08-22T10:00:00.000Z") },
    { normalized_job_no: "7002", book_date: new Date("2026-08-20T10:00:00.000Z") },
  ]);

  assert.deepEqual(examples, [
    { job_no: "P7001", booked_at: "2026-08-21T10:00:00.000Z" },
    { job_no: "7002", booked_at: "2026-08-20T10:00:00.000Z" },
  ]);
  assert.equal("customer_name" in examples[0]!, false);
  assert.equal("phone" in examples[0]!, false);
});
