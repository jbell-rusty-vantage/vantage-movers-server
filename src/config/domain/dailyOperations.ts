import { Redis } from "@upstash/redis";
import { isTestMode, isVantageTestRunner } from "./runtime";

/**
 * Daily Operations Redis doorbell and collection-name helpers.
 *
 * Env reads happen at call time (same as Twilio / queues). Never log tokens.
 * Do not use `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, or `REDIS_URL`.
 */

export type DailyOperationsCollectionKey = "events" | "days";

export type DailyOperationsCollectionNames = Record<
  DailyOperationsCollectionKey,
  string
>;

export const DAILY_OPERATIONS_PRODUCTION_COLLECTIONS = {
  events: "daily_operations_events",
  days: "daily_operations_days",
} as const satisfies DailyOperationsCollectionNames;

export const DAILY_OPERATIONS_TEST_COLLECTIONS = {
  events: "test_daily_operations_events",
  days: "test_daily_operations_days",
} as const satisfies DailyOperationsCollectionNames;

export type DailyOperationsRedisEnv = "production" | "preview" | "local";

export function getDailyOperationsRedis(): Redis | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim() ||
    "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim() ||
    "";
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/**
 * Whether the writer may construct a Redis client and XADD.
 *
 * Test runner and TEST_MODE never publish (and the writer must not construct
 * a client). Missing URL/token is Mongo-only. Local `pnpm dev:local` publishes
 * when credentials are present — this is not the Granot queue prod-only gate.
 */
export function shouldPublishDailyOperationsRedis(): boolean {
  if (isVantageTestRunner() || isTestMode()) {
    return false;
  }
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim() ||
    "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim() ||
    "";
  return Boolean(url && token);
}

export function getDailyOperationsRedisEnv(): DailyOperationsRedisEnv {
  const vercelEnv = process.env.VERCEL_ENV?.trim();
  if (vercelEnv === "production" || vercelEnv === "preview") {
    return vercelEnv;
  }
  return "local";
}

export function getDailyOperationsStreamKey(day: string): string {
  return `dailyops:${getDailyOperationsRedisEnv()}:stream:${day}`;
}

export function getDailyOperationsCollectionNames(): DailyOperationsCollectionNames {
  if (isVantageTestRunner() || isTestMode()) {
    return DAILY_OPERATIONS_TEST_COLLECTIONS;
  }
  return DAILY_OPERATIONS_PRODUCTION_COLLECTIONS;
}

export function getDailyOperationsCollectionName(
  key: DailyOperationsCollectionKey,
): string {
  return getDailyOperationsCollectionNames()[key];
}
