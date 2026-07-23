import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  claimAvailableLeadForBooking,
  mirrorBookingToLead,
} from "./bookingMirror.service";

test("atomic employee Lead claim does not rewrite the existing CPL", async () => {
  let update: Record<string, any> | undefined;
  const lead = {
    _id: new mongoose.Types.ObjectId(),
    source_company: "best_relocation_leads",
    cpl: 37,
    constructor: {
      updateOne: async (_filter: unknown, nextUpdate: Record<string, any>) => {
        update = nextUpdate;
        return { modifiedCount: 1 };
      },
    },
  } as any;

  const claimed = await claimAvailableLeadForBooking(
    lead,
    "FormLead",
    new mongoose.Types.ObjectId(),
    false,
    false,
    "long_distance",
  );

  assert.equal(claimed, true);
  assert.equal("cpl" in (update?.$set ?? {}), false);
});

test("concurrent booking claims allow only one booking to claim a lead", async () => {
  let bookedBy: mongoose.Types.ObjectId | undefined;
  const lead = {
    _id: new mongoose.Types.ObjectId(),
    constructor: {
      updateOne: async (
        filter: { $and?: Array<{ $or?: Array<{ booked?: unknown }> }> },
        update: { $set: { booked: mongoose.Types.ObjectId } },
      ) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        const expectsAvailable = filter.$and?.some((clause) =>
          clause.$or?.some((condition) => "booked" in condition),
        );
        if (!expectsAvailable || bookedBy) {
          return { modifiedCount: 0 };
        }
        bookedBy = update.$set.booked;
        return { modifiedCount: 1 };
      },
    },
  } as any;
  const firstBooking = new mongoose.Types.ObjectId();
  const secondBooking = new mongoose.Types.ObjectId();

  const [firstClaimed, secondClaimed] = await Promise.all([
    claimAvailableLeadForBooking(lead, "FormLead", firstBooking, false, false, undefined),
    claimAvailableLeadForBooking(lead, "FormLead", secondBooking, false, false, undefined),
  ]);

  assert.deepEqual([firstClaimed, secondClaimed].sort(), [false, true]);
  assert.ok(bookedBy?.equals(firstBooking) || bookedBy?.equals(secondBooking));
});

test("reconciliation mirror can preserve Lead source CPL", async () => {
  const lead = {
    booked: undefined,
    cpl: 41,
    save: async () => undefined,
  } as any;

  await mirrorBookingToLead(
    lead,
    "FormLead",
    new mongoose.Types.ObjectId(),
    false,
    false,
    undefined,
    undefined,
    undefined,
    true,
  );

  assert.equal(lead.cpl, 41);
});
