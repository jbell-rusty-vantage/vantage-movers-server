import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearCapturedOperationalEvents,
  getCapturedOperationalEvents,
} from "../observability";
import {
  getGranotLifecycleQueuePublishFailures,
  resetGranotLifecycleMetrics,
} from "./metrics";
import { publishGranotLifecycleReceiptWakeup } from "./queuePublisher";

afterEach(() => {
  resetGranotLifecycleMetrics();
  clearCapturedOperationalEvents();
});

test("[AC-35] publisher is skipped in the test runner and never sends a queue message", async () => {
  const sent: unknown[] = [];
  const result = await publishGranotLifecycleReceiptWakeup(
    { receipt_id: "receipt-skip" },
    {
      send: async (topic, payload) => {
        sent.push({ topic, payload });
        return { messageId: "should-not-send" };
      },
    },
  );
  assert.deepEqual(result, { published: false });
  assert.deepEqual(sent, []);
  assert.equal(getGranotLifecycleQueuePublishFailures(), 0);
  assert.equal(getCapturedOperationalEvents().length, 0);
});

test("[AC-02][AC-35] publisher sends exactly { receipt_id } when publishing is enabled", async () => {
  const sent: Array<{ topic: string; payload: unknown }> = [];
  const result = await publishGranotLifecycleReceiptWakeup(
    { receipt_id: "receipt-1" },
    {
      shouldPublish: () => true,
      send: async (topic, payload) => {
        sent.push({ topic, payload });
        return { messageId: "msg-1" };
      },
    },
  );
  assert.deepEqual(result, { published: true });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]?.payload, { receipt_id: "receipt-1" });
  assert.deepEqual(Object.keys(sent[0]?.payload as object), ["receipt_id"]);
  assert.equal(getGranotLifecycleQueuePublishFailures(), 0);
});

test("[AC-35] publish failure is observed safely and does not throw", async () => {
  const result = await publishGranotLifecycleReceiptWakeup(
    { receipt_id: "receipt-failed" },
    {
      shouldPublish: () => true,
      send: async () => {
        throw new Error("synthetic-queue-unavailable");
      },
    },
  );
  assert.deepEqual(result, { published: false });
  assert.equal(getGranotLifecycleQueuePublishFailures(), 1);
  const events = getCapturedOperationalEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.input.eventKey, "granot_lifecycle.queue.publish_failed");
  assert.deepEqual(events[0]?.input.details, {
    receipt_id: "receipt-failed",
    observation_channel: "granot_webhook",
  });
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("synthetic-queue-unavailable"), false);
  assert.doesNotMatch(serialized, /x-api-secret|authorization|cookie/i);
});
