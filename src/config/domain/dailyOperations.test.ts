import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  DAILY_OPERATIONS_PRODUCTION_COLLECTIONS,
  DAILY_OPERATIONS_TEST_COLLECTIONS,
  getDailyOperationsCollectionName,
  getDailyOperationsCollectionNames,
  getDailyOperationsRedis,
  getDailyOperationsRedisEnv,
  getDailyOperationsStreamKey,
  shouldPublishDailyOperationsRedis,
} from "./dailyOperations";
import { isTestMode, isVantageTestRunner } from "./runtime";

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

test("missing Redis URL or token returns a null client", () => {
  clearRedisEnv();
  assert.equal(getDailyOperationsRedis(), null);

  process.env.KV_REST_API_URL = "https://example.upstash.io";
  assert.equal(getDailyOperationsRedis(), null);

  delete process.env.KV_REST_API_URL;
  process.env.KV_REST_API_TOKEN = "dummy-token";
  assert.equal(getDailyOperationsRedis(), null);

  process.env.KV_REST_API_URL = "   ";
  process.env.KV_REST_API_TOKEN = "   ";
  assert.equal(getDailyOperationsRedis(), null);
});

test("UPSTASH_* names construct a client and KV_* aliases do too", () => {
  clearRedisEnv();
  process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "dummy-upstash-token";
  const upstashClient = getDailyOperationsRedis();
  assert.ok(upstashClient);
  assert.equal(typeof upstashClient.xadd, "function");

  clearRedisEnv();
  process.env.KV_REST_API_URL = "https://example.upstash.io";
  process.env.KV_REST_API_TOKEN = "dummy-kv-token";
  const kvClient = getDailyOperationsRedis();
  assert.ok(kvClient);
  assert.equal(typeof kvClient.xadd, "function");
});

test("read-only token, KV_URL, and REDIS_URL are not used for the client", () => {
  clearRedisEnv();
  process.env.KV_REST_API_READ_ONLY_TOKEN = "dummy-read-only";
  process.env.KV_URL = "rediss://example.upstash.io:6379";
  process.env.REDIS_URL = "rediss://example.upstash.io:6379";
  assert.equal(getDailyOperationsRedis(), null);
});

test("test runner never publishes Daily Operations Redis writes", () => {
  clearRedisEnv();
  process.env.KV_REST_API_URL = "https://example.upstash.io";
  process.env.KV_REST_API_TOKEN = "dummy-kv-token";
  assert.equal(isVantageTestRunner(), true);
  assert.equal(shouldPublishDailyOperationsRedis(), false);
});

test("TEST_MODE also keeps Daily Operations Redis publish off", () => {
  clearRedisEnv();
  process.env.TEST_MODE = "true";
  process.env.KV_REST_API_URL = "https://example.upstash.io";
  process.env.KV_REST_API_TOKEN = "dummy-kv-token";
  assert.equal(isTestMode(), true);
  assert.equal(shouldPublishDailyOperationsRedis(), false);
});

test("missing credentials keep publish off even outside the TEST_MODE flag", () => {
  clearRedisEnv();
  delete process.env.TEST_MODE;
  assert.equal(shouldPublishDailyOperationsRedis(), false);
});

test("Redis stream key uses VERCEL_ENV production or preview, otherwise local", () => {
  clearRedisEnv();
  assert.equal(getDailyOperationsRedisEnv(), "local");
  assert.equal(
    getDailyOperationsStreamKey("2026-05-31"),
    "dailyops:local:stream:2026-05-31",
  );

  process.env.VERCEL_ENV = "production";
  assert.equal(
    getDailyOperationsStreamKey("2026-05-31"),
    "dailyops:production:stream:2026-05-31",
  );

  process.env.VERCEL_ENV = "preview";
  assert.equal(
    getDailyOperationsStreamKey("2026-05-31"),
    "dailyops:preview:stream:2026-05-31",
  );

  process.env.VERCEL_ENV = "development";
  assert.equal(
    getDailyOperationsStreamKey("2026-05-31"),
    "dailyops:local:stream:2026-05-31",
  );
});

test("collection names use the test prefix in the test runner", () => {
  assert.deepEqual(getDailyOperationsCollectionNames(), {
    events: "test_daily_operations_events",
    days: "test_daily_operations_days",
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
