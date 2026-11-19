import assert from "node:assert/strict";
import { test } from "node:test";
import { newObjectIdHex, toObjectId } from "../../utils/objectId";
import { GranotRecordLink } from "../../models/GranotRecordLink";

test("[AC-DLC-11] GranotRecordLink model updateOne still rejects a booking_ref update", async () => {
  await assert.rejects(
    GranotRecordLink.updateOne(
      { _id: toObjectId(newObjectIdHex()) },
      { $set: { booking_ref: toObjectId(newObjectIdHex()) } },
    ),
    /cannot update booking_ref/,
  );
});
