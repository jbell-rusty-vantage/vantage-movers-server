import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { runDueBookingLeadRematches } from "./reconciliationRematch.service";

const originalMongoUri = process.env.MONGO_URI;
const originalEnabled = process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED;
const originalConnect = mongoose.connect;

afterEach(() => {
  if (originalMongoUri === undefined) delete process.env.MONGO_URI;
  else process.env.MONGO_URI = originalMongoUri;
  if (originalEnabled === undefined) {
    delete process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED;
  } else {
    process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED = originalEnabled;
  }
  (mongoose as any).connect = originalConnect;
  global.__mongooseCache = undefined;
});

test("cold rematch connects to Mongo before attempting a lease or model operation", async () => {
  process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED = "true";
  process.env.MONGO_URI = "mongodb://cold-path.invalid/vantagemovers";
  let connectCalls = 0;
  (mongoose as any).connect = async () => {
    connectCalls += 1;
    throw new Error("cold connection refused");
  };

  await assert.rejects(
    () => runDueBookingLeadRematches({ actor: "cron" }),
    /Database temporarily unavailable/,
  );
  assert.equal(connectCalls, 1);
});
