import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * The Booking Job Number rule is enforced by `BookedLead` document and query middleware. A raw
 * driver write (`BookedLead.collection.*`, `collection("booked_leads")`) bypasses it, so every such
 * writer is listed here and must never set `job_no`. A new raw writer fails this test until it is
 * reviewed against the rule and added.
 */
const RAW_WRITERS: Record<string, string> = {
  "src/services/cancellations/cancelledLead.service.ts": "cancellation claim: $set cancelled",
  "src/services/domainCommands/bookings.ts": "updateBooking: official details only",
  "src/services/granotLifecycle/bookingOwnerCommands.ts": "Granot Update: official details only",
  "src/services/granotLifecycle/connectBookingToLead.ts": "Connect: lead_ref and flags only",
  "src/services/granotLifecycle/releaseOwnerCommands.ts": "Granot Release: release fields only",
};
const RAW_WRITE = /(?:BookedLead\.collection|collection\(\s*["']booked_leads["']\s*\))\s*\.\s*(?:insertOne|insertMany|updateOne|updateMany|replaceOne|findOneAndUpdate|findOneAndReplace|bulkWrite)\s*\(/;

test("every raw booked_leads writer is reviewed and none sets job_no", () => {
  const found = globSync("src/**/*.ts")
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !/\.test\.ts$/.test(file) && RAW_WRITE.test(readFileSync(file, "utf8")))
    .sort();
  assert.deepEqual(found, Object.keys(RAW_WRITERS).sort());
  for (const file of found) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(new RegExp(RAW_WRITE.source, "g"))) {
      const call = source.slice(match.index, match.index + 1200);
      assert.equal(/\bjob_no\s*:/.test(call.replace(/normalized_job_no/g, "")), false, `${file} raw write sets job_no`);
    }
  }
});
