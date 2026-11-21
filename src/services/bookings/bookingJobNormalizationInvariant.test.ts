import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "mongodb";
import {
  BOOKING_JOB_NORMALIZATION_STATE_ID,
  runBookingJobNormalizationInvariant,
  type BookingJobNormalizationState,
} from "./bookingJobNormalizationInvariant";

/** In-memory stand-in for the two collections the invariant touches. `scan` decides what the Booking read does. */
function fakeDb(scan: () => Promise<unknown[]>) {
  let state: Partial<BookingJobNormalizationState> | null = null;
  let scans = 0;
  const db = {
    collection(name: string) {
      if (name === "booked_leads") {
        return { find: () => ({ toArray: () => { scans++; return scan(); } }) };
      }
      return {
        findOne: async () => state,
        updateOne: async (_filter: unknown, update: { $set: Partial<BookingJobNormalizationState> }) => {
          state = { _id: BOOKING_JOB_NORMALIZATION_STATE_ID, ...(state ?? {}), ...update.$set };
        },
      };
    },
  } as unknown as Db;
  return { db, state: () => state, scans: () => scans };
}

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 21, 3, 0) + minutes * 60_000);

test("a timed-out scan records the attempt, keeps the last result and is not retried within the hour", async () => {
  let fail = false;
  const fake = fakeDb(async () => {
    if (fail) throw Object.assign(new Error("operation exceeded time limit"), { code: 50 });
    return [];
  });

  assert.deepEqual(await runBookingJobNormalizationInvariant(fake.db, at(0)), { skipped: false, drift_count: 0 });

  fail = true;
  await assert.rejects(runBookingJobNormalizationInvariant(fake.db, at(60)), /exceeded time limit/);
  assert.equal(fake.state()?.checked_at?.getTime(), at(0).getTime(), "the last completed scan stays visible");
  assert.equal(fake.state()?.drift_count, 0);
  assert.equal(fake.state()?.last_attempt_at?.getTime(), at(60).getTime());
  assert.equal(fake.state()?.last_failure, "operation exceeded time limit");

  // The five-minute cron must not rescan the slow member until the hour has passed.
  assert.deepEqual(await runBookingJobNormalizationInvariant(fake.db, at(65)), { skipped: true });
  assert.equal(fake.scans(), 2);

  fail = false;
  assert.deepEqual(await runBookingJobNormalizationInvariant(fake.db, at(120)), { skipped: false, drift_count: 0 });
  assert.equal(fake.state()?.last_failure, null);
  assert.equal(fake.state()?.checked_at?.getTime(), at(120).getTime());
});

test("a first-ever failure still throttles even though no scan has completed", async () => {
  const fake = fakeDb(async () => { throw new Error("operation exceeded time limit"); });
  await assert.rejects(runBookingJobNormalizationInvariant(fake.db, at(0)));
  assert.equal(fake.state()?.checked_at, undefined);
  assert.deepEqual(await runBookingJobNormalizationInvariant(fake.db, at(5)), { skipped: true });
});
