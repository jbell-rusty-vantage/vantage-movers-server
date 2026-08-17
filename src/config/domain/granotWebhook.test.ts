import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  getGranotLifecycleQueueTopic,
  getGranotWebhookSecret,
  shouldPublishGranotLifecycleQueue,
} from "./granotWebhook";

const KEYS = [
  "GRANOT_WEBHOOK_SECRET",
  "GRANOT_LIFECYCLE_QUEUE_TOPIC",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_REGION",
  "TEST_MODE",
] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("blank Granot webhook secret is treated as missing configuration", () => {
  delete process.env.GRANOT_WEBHOOK_SECRET;
  assert.equal(getGranotWebhookSecret(), null);
  process.env.GRANOT_WEBHOOK_SECRET = "   ";
  assert.equal(getGranotWebhookSecret(), null);
});

test("lifecycle queue topic is environment scoped", () => {
  delete process.env.GRANOT_LIFECYCLE_QUEUE_TOPIC;
  process.env.VERCEL_ENV = "production";
  assert.equal(getGranotLifecycleQueueTopic(), "granot-lifecycle-events");
  process.env.VERCEL_ENV = "preview";
  assert.equal(getGranotLifecycleQueueTopic(), "granot-lifecycle-events-dev");
  process.env.GRANOT_LIFECYCLE_QUEUE_TOPIC = "custom-lifecycle-topic";
  assert.equal(getGranotLifecycleQueueTopic(), "custom-lifecycle-topic");
});

test("lifecycle queue publishing stays off in the test runner and unapproved environments", () => {
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
  process.env.VERCEL_REGION = "iad1";
  assert.equal(shouldPublishGranotLifecycleQueue(), false);

  delete process.env.VERCEL;
  delete process.env.VERCEL_REGION;
  process.env.VERCEL_ENV = "preview";
  assert.equal(shouldPublishGranotLifecycleQueue(), false);
});
