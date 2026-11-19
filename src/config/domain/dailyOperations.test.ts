import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  DAILY_OPERATIONS_PRODUCTION_COLLECTIONS,
  DAILY_OPERATIONS_TEST_COLLECTIONS,
  getDailyOperationsCollectionName,
  getDailyOperationsCollectionNames,
  getDailyOperationsRedis,
  shouldPublishDailyOperationsRedis,
} from "./dailyOperations";
import { isVantageTestRunner } from "./runtime";

const KEYS = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "KV_REST_API_READ_ONLY_TOKEN",
  "KV_URL",
  "REDIS_URL",
  "VERCEL_ENV",
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

function clearRedisEnv(): void {
  for (const key of KEYS) {
    delete process.env[key];
  }
}

test("retired transport never constructs Redis even with configured quota-exhausted credentials", () => {
  clearRedisEnv();
  process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "dummy-upstash-token";
  process.env.KV_REST_API_URL = "https://example.upstash.io";
  process.env.KV_REST_API_TOKEN = "dummy-kv-token";
  assert.equal(getDailyOperationsRedis(), null);
  assert.equal(shouldPublishDailyOperationsRedis(), false);
});

test("test runner never publishes Daily Operations Redis writes", () => {
  clearRedisEnv();
  process.env.KV_REST_API_URL = "https://example.upstash.io";
  process.env.KV_REST_API_TOKEN = "dummy-kv-token";
  assert.equal(isVantageTestRunner(), true);
  assert.equal(shouldPublishDailyOperationsRedis(), false);
});

test("collection names use the test prefix in the test runner", () => {
  assert.deepEqual(getDailyOperationsCollectionNames(), {
    events: "test_daily_operations_events",
    days: "test_daily_operations_days",
    read_views: "test_daily_operations_read_views",
  });
  assert.equal(
    getDailyOperationsCollectionName("events"),
    DAILY_OPERATIONS_TEST_COLLECTIONS.events,
  );
  assert.equal(
    getDailyOperationsCollectionName("days"),
    DAILY_OPERATIONS_TEST_COLLECTIONS.days,
  );
  assert.equal(
    DAILY_OPERATIONS_PRODUCTION_COLLECTIONS.events,
    "daily_operations_events",
  );
  assert.equal(
    DAILY_OPERATIONS_PRODUCTION_COLLECTIONS.days,
    "daily_operations_days",
  );
});
