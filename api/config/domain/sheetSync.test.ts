import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  buildCoalescingKey,
  getSheetSyncBudgets,
  getSheetSyncDrainGuardrails,
  getSheetSyncMode,
  getSheetSyncQueueTopic,
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
  "VANTAGE_TEST_RUNNER",
  "NODE_TEST_CONTEXT",
  "ALLOW_TEST_SHEET_SYNC_QUEUE",
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

test("getSheetSyncMode defaults to legacy and parses known values", () => {
  delete process.env.SHEET_SYNC_MODE;
  assert.equal(getSheetSyncMode(), "legacy");

  process.env.SHEET_SYNC_MODE = "queued";
  assert.equal(getSheetSyncMode(), "queued");

  process.env.SHEET_SYNC_MODE = "DISABLED";
  assert.equal(getSheetSyncMode(), "disabled");

  process.env.SHEET_SYNC_MODE = "nonsense";
  assert.equal(getSheetSyncMode(), "legacy");
});

test("queue topic is env-scoped and overridable", () => {
  delete process.env.SHEET_SYNC_QUEUE_TOPIC;
  process.env.VERCEL_ENV = "production";
  assert.equal(getSheetSyncQueueTopic(), "sheet-sync-events");

  process.env.VERCEL_ENV = "preview";
  assert.equal(getSheetSyncQueueTopic(), "sheet-sync-events-dev");

  delete process.env.VERCEL_ENV;
  assert.equal(getSheetSyncQueueTopic(), "sheet-sync-events-dev");

  process.env.SHEET_SYNC_QUEUE_TOPIC = "custom-topic";
  process.env.VERCEL_ENV = "production";
  assert.equal(getSheetSyncQueueTopic(), "custom-topic");
});

test("budgets default below documented Google limits and parse overrides", () => {
  const defaults = getSheetSyncBudgets();
  assert.equal(defaults.readsPerMinute, 45);
  assert.equal(defaults.writesPerMinute, 45);
  assert.ok(defaults.readsPerMinute < 60, "reads budget leaves user headroom");
  assert.ok(defaults.maxPayloadBytes < 2_000_000, "payload below recommended max");

  process.env.SHEET_SYNC_READS_PER_MINUTE_BUDGET = "30";
  process.env.SHEET_SYNC_MAX_PAYLOAD_BYTES = "1000000";
  const overridden = getSheetSyncBudgets();
  assert.equal(overridden.readsPerMinute, 30);
  assert.equal(overridden.maxPayloadBytes, 1_000_000);

  process.env.SHEET_SYNC_WRITES_PER_MINUTE_BUDGET = "not-a-number";
  assert.equal(getSheetSyncBudgets().writesPerMinute, 45);
});

test("drain guardrails default to fast queue draining and parse overrides", () => {
  const defaults = getSheetSyncDrainGuardrails();
  assert.equal(defaults.maxJobsPerDrain, 500);
  assert.equal(defaults.maxRowsPerBatch, 500);
  assert.equal(defaults.debounceWindowMs, 3_000);

  process.env.SHEET_SYNC_MAX_JOBS_PER_DRAIN = "100";
  process.env.SHEET_SYNC_MAX_ROWS_PER_BATCH = "50";
  process.env.SHEET_SYNC_DEBOUNCE_WINDOW_MS = "1000";
  const overridden = getSheetSyncDrainGuardrails();
  assert.equal(overridden.maxJobsPerDrain, 100);
  assert.equal(overridden.maxRowsPerBatch, 50);
  assert.equal(overridden.debounceWindowMs, 1_000);
});

test("shouldPublishSheetSyncQueue honors VERCEL and local flag", () => {
  delete process.env.VERCEL;
  delete process.env.SHEET_SYNC_QUEUE_LOCAL_PUBLISH;
  delete process.env.VANTAGE_TEST_RUNNER;
  delete process.env.NODE_TEST_CONTEXT;
  assert.equal(shouldPublishSheetSyncQueue(), false);

  process.env.SHEET_SYNC_QUEUE_LOCAL_PUBLISH = "true";
  process.env.ALLOW_TEST_SHEET_SYNC_QUEUE = "true";
  assert.equal(shouldPublishSheetSyncQueue(), true);

  delete process.env.SHEET_SYNC_QUEUE_LOCAL_PUBLISH;
  process.env.VERCEL = "1";
  assert.equal(shouldPublishSheetSyncQueue(), true);
});

test("shouldPublishSheetSyncQueue is off during the test runner unless explicitly allowed", () => {
  process.env.VANTAGE_TEST_RUNNER = "true";
  process.env.VERCEL = "1";
  assert.equal(shouldPublishSheetSyncQueue(), false);

  process.env.ALLOW_TEST_SHEET_SYNC_QUEUE = "true";
  assert.equal(shouldPublishSheetSyncQueue(), true);
});

test("shouldPublishSheetSyncQueue keeps test runner guard after env cleanup", () => {
  markVantageTestRunner();
  delete process.env.VANTAGE_TEST_RUNNER;
  delete process.env.NODE_TEST_CONTEXT;
  process.env.VERCEL = "1";
  delete process.env.ALLOW_TEST_SHEET_SYNC_QUEUE;

  assert.equal(shouldPublishSheetSyncQueue(), false);
});

test("coalescing keys follow the design doc shape", () => {
  assert.equal(
    buildCoalescingKey({ resource: "source_lead", entityModel: "FormLead", entityId: "a1" }),
    "source_lead:FormLead:a1",
  );
  assert.equal(
    buildCoalescingKey({ resource: "source_lead", entityModel: "CallLead", entityId: "a1" }),
    "source_lead:CallLead:a1",
  );
  assert.equal(
    buildCoalescingKey({ resource: "booked_lead", entityId: "b1" }),
    "booked_lead:b1",
  );
  assert.equal(
    buildCoalescingKey({ resource: "booking_chain", entityId: "b1" }),
    "booking_chain:b1",
  );
  assert.equal(
    buildCoalescingKey({ resource: "cancellation_chain", entityId: "c1" }),
    "cancellation_chain:c1",
  );
  assert.equal(
    buildCoalescingKey({ resource: "delete_source_lead", entityModel: "CallLead", entityId: "a1" }),
    "delete_source_lead:CallLead:a1",
  );
  assert.equal(
    buildCoalescingKey({ resource: "delete_booked_lead", entityId: "b1" }),
    "delete_booked_lead:b1",
  );
  assert.equal(
    buildCoalescingKey({ resource: "delete_cancelled_lead", entityId: "c1" }),
    "delete_cancelled_lead:c1",
  );
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
