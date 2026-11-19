import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  priorityForJob,
  shouldPublishSheetSyncQueue,
  supersededUpsertCoalescingKey,
  SHEET_SYNC_PRIORITIES,
} from "./sheetSync";
import { markVantageTestRunner } from "./runtime";

/**
 * These tests mutate `process.env` to exercise the call-time reads. Each test
 * restores the keys it touched so ordering stays independent.
 */
const TOUCHED_ENV_KEYS = [
  "SHEET_SYNC_MODE",
  "SHEET_SYNC_QUEUE_TOPIC",
  "VERCEL_ENV",
  "VERCEL",
  "VERCEL_REGION",
  "VANTAGE_TEST_RUNNER",
  "NODE_TEST_CONTEXT",
  "SHEET_SYNC_QUEUE_LOCAL_PUBLISH",
  "SHEET_SYNC_READS_PER_MINUTE_BUDGET",
  "SHEET_SYNC_WRITES_PER_MINUTE_BUDGET",
  "SHEET_SYNC_MAX_PAYLOAD_BYTES",
  "SHEET_SYNC_MAX_JOBS_PER_DRAIN",
  "SHEET_SYNC_MAX_ROWS_PER_BATCH",
  "SHEET_SYNC_DEBOUNCE_WINDOW_MS",
];

afterEach(() => {
  for (const key of TOUCHED_ENV_KEYS) {
    delete process.env[key];
  }
});

test("shouldPublishSheetSyncQueue stays off outside production Vercel", () => {
  delete process.env.VERCEL;
  delete process.env.VERCEL_REGION;
  delete process.env.SHEET_SYNC_QUEUE_LOCAL_PUBLISH;
  delete process.env.VANTAGE_TEST_RUNNER;
  delete process.env.NODE_TEST_CONTEXT;
  assert.equal(shouldPublishSheetSyncQueue(), false);

  process.env.SHEET_SYNC_QUEUE_LOCAL_PUBLISH = "true";
  assert.equal(shouldPublishSheetSyncQueue(), false);

  delete process.env.SHEET_SYNC_QUEUE_LOCAL_PUBLISH;
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_REGION = "iad1";
  assert.equal(shouldPublishSheetSyncQueue(), false);
});

test("shouldPublishSheetSyncQueue keeps test runner guard after env cleanup", () => {
  markVantageTestRunner();
  delete process.env.VANTAGE_TEST_RUNNER;
  delete process.env.NODE_TEST_CONTEXT;
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";

  assert.equal(shouldPublishSheetSyncQueue(), false);
});

test("delete resources supersede their matching upsert keys", () => {
  assert.equal(
    supersededUpsertCoalescingKey({
      resource: "delete_source_lead",
      entityModel: "FormLead",
      entityId: "a1",
    }),
    "source_lead:FormLead:a1",
  );
  assert.equal(
    supersededUpsertCoalescingKey({ resource: "delete_booked_lead", entityId: "b1" }),
    "booked_lead:b1",
  );
  assert.equal(
    supersededUpsertCoalescingKey({ resource: "delete_cancelled_lead", entityId: "c1" }),
    "cancellation_chain:c1",
  );
  assert.equal(
    supersededUpsertCoalescingKey({ resource: "source_lead", entityId: "a1" }),
    undefined,
  );
});

test("priority ordering: deletes > booking > cancellation > create > update", () => {
  const deletePriority = priorityForJob("delete_booked_lead");
  const booking = priorityForJob("booking_chain");
  const cancellation = priorityForJob("cancellation_chain");
  const create = priorityForJob("source_lead", "form_lead.create");
  const update = priorityForJob("source_lead", "form_lead.update");

  assert.ok(deletePriority > booking);
  assert.ok(booking > cancellation);
  assert.ok(cancellation > create);
  assert.ok(create > update);
  assert.equal(deletePriority, SHEET_SYNC_PRIORITIES.delete);
  assert.equal(update, SHEET_SYNC_PRIORITIES.sourceLeadUpdate);
});
