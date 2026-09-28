import assert from "node:assert/strict";
import { test } from "node:test";
import type { Schema } from "mongoose";
import { newObjectIdHex, toObjectId } from "../../utils/objectId";
import { BookedLead } from "../../models/BookedLead";
import { CallLead } from "../../models/CallLead";
import { CancelledLead } from "../../models/CancelledLead";
import { FormLead } from "../../models/FormLead";
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

function applicationDeleteHooks(schema: Schema, method: string): string[] {
  const pres = (
    schema as unknown as {
      s?: {
        hooks?: {
          _pres?: Map<string, Array<{ fn?: { name?: string } }>>;
        };
      };
    }
  ).s?.hooks?._pres;
  const rows = pres?.get(method) ?? [];
  return rows
    .map((row) => row.fn?.name ?? "")
    .filter((name) => name !== "shardingPluginPreDeleteOne");
}

test("[AC-DLC-12] Booking, Cancellation, Lead, and Record Link gain no new delete middleware", () => {
  for (const model of [BookedLead, CancelledLead, FormLead, CallLead]) {
    assert.deepEqual(applicationDeleteHooks(model.schema, "deleteOne"), [], model.modelName);
    assert.deepEqual(applicationDeleteHooks(model.schema, "deleteMany"), [], model.modelName);
  }
  assert.deepEqual(applicationDeleteHooks(GranotRecordLink.schema, "deleteOne"), [
    "rejectLinkReplaceOrDelete",
  ]);
  assert.deepEqual(applicationDeleteHooks(GranotRecordLink.schema, "deleteMany"), [
    "rejectLinkReplaceOrDelete",
  ]);
});
