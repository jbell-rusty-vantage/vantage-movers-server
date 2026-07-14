import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { SheetSyncJob } from "../../models/SheetSyncJob";
import {
  enqueueSheetSyncJob,
  enqueueSheetSyncTombstone,
} from "./sheetSyncOutbox.service";
import { persistSheetSyncIntent } from "./sheetSyncCoordinator";

type FindOneAndUpdateCall = { filter: any; update: any; options: any };

const originalFindOneAndUpdate = SheetSyncJob.findOneAndUpdate as unknown;
const originalUpdateMany = SheetSyncJob.updateMany as unknown;
const originalMode = process.env.SHEET_SYNC_MODE;

afterEach(() => {
  (SheetSyncJob as any).findOneAndUpdate = originalFindOneAndUpdate;
  (SheetSyncJob as any).updateMany = originalUpdateMany;
  if (originalMode === undefined) {
    delete process.env.SHEET_SYNC_MODE;
  } else {
    process.env.SHEET_SYNC_MODE = originalMode;
  }
});

function stubFindOneAndUpdate(): FindOneAndUpdateCall[] {
  const calls: FindOneAndUpdateCall[] = [];
  (SheetSyncJob as any).findOneAndUpdate = (filter: any, update: any, options: any) => {
    calls.push({ filter, update, options });
    return Promise.resolve({
      _id: new mongoose.Types.ObjectId(),
      due_at: update.$min?.due_at ?? new Date(),
      priority: update.$max?.priority ?? 0,
    });
  };
  return calls;
}

test("enqueueSheetSyncJob writes a coalescing upsert keyed by entity", async () => {
  const calls = stubFindOneAndUpdate();
  const leadId = new mongoose.Types.ObjectId().toString();

  await enqueueSheetSyncJob({
    resource: "source_lead",
    operation: "form_lead.create",
    leadModel: "FormLead",
    leadId,
  });

  assert.equal(calls.length, 1);
  const { filter, update, options } = calls[0];
  assert.equal(filter.coalescing_key, `source_lead:FormLead:${leadId}`);
  assert.deepEqual(filter.status, { $in: ["pending", "retrying"] });
  assert.equal(update.$set.resource, "source_lead");
  assert.equal(update.$set.entity_model, "FormLead");
  assert.equal(update.$set.entity_id, leadId);
  // create-priority is higher than update-priority.
  assert.equal(update.$max.priority, 60);
  assert.equal(update.$setOnInsert.status, "pending");
  assert.equal(options.upsert, true);
});

test("enqueueSheetSyncJob threads the caller session for atomic commit", async () => {
  const calls = stubFindOneAndUpdate();
  const session = { id: "fake-session" } as unknown as mongoose.ClientSession;

  await enqueueSheetSyncJob(
    { resource: "booking_chain", operation: "booked_lead.update", bookingId: "b1" },
    { session, createdBy: "api" },
  );

  assert.equal(calls[0].options.session, session);
  assert.equal(calls[0].filter.coalescing_key, "booking_chain:b1");
});

test("enqueueSheetSyncTombstone cancels the superseded upsert then writes the delete", async () => {
  const updateManyCalls: any[] = [];
  (SheetSyncJob as any).updateMany = (filter: any, update: any, options: any) => {
    updateManyCalls.push({ filter, update, options });
    return Promise.resolve({ modifiedCount: 1 });
  };
  const findCalls = stubFindOneAndUpdate();

  await enqueueSheetSyncTombstone(
    {
      resource: "delete_source_lead",
      entityModel: "CallLead",
      entityId: "lead-1",
      operation: "call_lead.delete",
      tombstone: { mongo_id: "lead-1", previous_targets: [] },
    },
    { targetHints: ["master_leads"] },
  );

  assert.equal(updateManyCalls.length, 1);
  assert.equal(updateManyCalls[0].filter.coalescing_key, "source_lead:CallLead:lead-1");
  assert.deepEqual(updateManyCalls[0].update.$set, {
    status: "cancelled",
    last_error: "superseded_by_delete_tombstone",
  });

  assert.equal(findCalls.length, 1);
  assert.equal(findCalls[0].filter.coalescing_key, "delete_source_lead:CallLead:lead-1");
  assert.equal(findCalls[0].update.$set.tombstone.mongo_id, "lead-1");
  assert.deepEqual(findCalls[0].update.$set.target_hints, ["master_leads"]);
  // Deletes bypass debounce: due immediately.
  assert.ok(findCalls[0].update.$min.due_at instanceof Date);
});

test("persistSheetSyncIntent only writes the outbox in queued mode", async () => {
  const calls = stubFindOneAndUpdate();
  const job = {
    resource: "source_lead" as const,
    operation: "call_lead.update",
    leadModel: "CallLead" as const,
    leadId: "lead-9",
  };

  process.env.SHEET_SYNC_MODE = "legacy";
  await persistSheetSyncIntent(job);
  assert.equal(calls.length, 0, "legacy mode must not write an outbox job");

  process.env.SHEET_SYNC_MODE = "disabled";
  await persistSheetSyncIntent(job);
  assert.equal(calls.length, 0, "disabled mode must not write an outbox job");

  process.env.SHEET_SYNC_MODE = "queued";
  await persistSheetSyncIntent(job);
  assert.equal(calls.length, 1, "queued mode writes exactly one outbox job");
  assert.equal(calls[0].filter.coalescing_key, "source_lead:CallLead:lead-9");
});
