import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose, { Types } from "mongoose";
import type { SheetSyncJobDocument } from "../../../models/SheetSyncJob";
import { planJobWrites } from "./jobPlanner";

test("jobPlanner registers mongoose models required for booked-lead populate", () => {
  assert.ok(mongoose.models.Customer, "Customer must be registered for booking_chain populate");
  assert.ok(mongoose.models.Agent, "Agent must be registered for booking_chain populate");
});

type TombstoneInput = {
  mongo_id: string;
  previous_targets: {
    target: string;
    spreadsheet_id: string;
    tab_name: string;
    row_number?: number;
  }[];
};

function tombstoneJob(
  resource: "delete_source_lead" | "delete_booked_lead" | "delete_cancelled_lead",
  tombstone: TombstoneInput,
): SheetSyncJobDocument {
  return {
    _id: new Types.ObjectId(),
    resource,
    operation: "delete",
    entity_id: tombstone.mongo_id,
    tombstone,
  } as unknown as SheetSyncJobDocument;
}

test("planJobWrites turns a tombstone's previous_targets into delete writes", async () => {
  const job = tombstoneJob("delete_source_lead", {
    mongo_id: "lead-1",
    previous_targets: [
      { target: "master_calls", spreadsheet_id: "sheet-a", tab_name: "Calls", row_number: 12 },
      { target: "source_calls", spreadsheet_id: "sheet-b", tab_name: "Calls", row_number: 4 },
    ],
  });

  const planned = await planJobWrites(job);
  assert.equal(planned.length, 1);
  const [doc] = planned;
  assert.equal(doc.doc, undefined, "tombstone plans carry no surviving document");
  assert.equal(doc.writes.length, 2);
  assert.ok(doc.writes.every((write) => write.op === "delete"));
  assert.deepEqual(
    doc.writes.map((write) => write.spreadsheetId),
    ["sheet-a", "sheet-b"],
  );
  assert.deepEqual(
    doc.writes.map((write) => write.knownRowNumber),
    [12, 4],
  );
  assert.ok(doc.writes.every((write) => write.mongoId === "lead-1"));
});

test("planJobWrites skips tombstone targets with unknown headers", async () => {
  const job = tombstoneJob("delete_booked_lead", {
    mongo_id: "booking-1",
    previous_targets: [
      { target: "master_booked", spreadsheet_id: "sheet-a", tab_name: "Booked" },
      { target: "not_a_real_target", spreadsheet_id: "sheet-a", tab_name: "Ghost" },
    ],
  });

  const planned = await planJobWrites(job);
  assert.equal(planned[0].writes.length, 1, "only the known target is planned");
  assert.equal(planned[0].writes[0].target, "master_booked");
});

test("planJobWrites limits retrying tombstones to target_hints", async () => {
  const job = {
    ...tombstoneJob("delete_source_lead", {
      mongo_id: "lead-1",
      previous_targets: [
        { target: "master_calls", spreadsheet_id: "sheet-a", tab_name: "Calls", row_number: 12 },
        { target: "source_calls", spreadsheet_id: "sheet-b", tab_name: "Calls", row_number: 4 },
      ],
    }),
    target_hints: ["source_calls"],
  } as SheetSyncJobDocument;

  const planned = await planJobWrites(job);
  assert.equal(planned.length, 1);
  assert.deepEqual(
    planned[0].writes.map((write) => write.target),
    ["source_calls"],
  );
});

test("planJobWrites returns a single empty plan when a tombstone has no targets", async () => {
  const job = tombstoneJob("delete_cancelled_lead", {
    mongo_id: "cancel-1",
    previous_targets: [],
  });

  const planned = await planJobWrites(job);
  assert.equal(planned.length, 1);
  assert.equal(planned[0].writes.length, 0);
});
