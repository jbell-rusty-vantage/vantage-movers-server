import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { runDueBookingLeadRematches } from "./reconciliationRematch.service";

const originalMongoUri = process.env.MONGO_URI;
const originalEnabled = process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED;
const originalRules = process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES;
const originalVersion = process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION;
const originalConnect = mongoose.connect;

afterEach(() => {
  if (originalMongoUri === undefined) delete process.env.MONGO_URI;
  else process.env.MONGO_URI = originalMongoUri;
  if (originalEnabled === undefined) {
    delete process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED;
  } else {
    process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED = originalEnabled;
  }
  if (originalRules === undefined) delete process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES;
  else process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES = originalRules;
  if (originalVersion === undefined) delete process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION;
  else process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION = originalVersion;
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
