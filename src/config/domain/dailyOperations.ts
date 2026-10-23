import type { Redis } from "@upstash/redis";
import { isTestMode, isVantageTestRunner } from "./runtime";

/**
 * Daily Operations Redis doorbell and collection-name helpers.
 *
 * Env reads happen at call time (same as Twilio / queues). Never log tokens.
 * Do not use `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, or `REDIS_URL`.
 */

export type DailyOperationsCollectionKey = "events" | "days" | "read_views";

export type DailyOperationsCollectionNames = Record<
  DailyOperationsCollectionKey,
  string
>;

export const DAILY_OPERATIONS_PRODUCTION_COLLECTIONS = {
  events: "daily_operations_events",
  days: "daily_operations_days",
  read_views: "daily_operations_read_views",
} as const satisfies DailyOperationsCollectionNames;

export const DAILY_OPERATIONS_TEST_COLLECTIONS = {
  events: "test_daily_operations_events",
  days: "test_daily_operations_days",
  read_views: "test_daily_operations_read_views",
} as const satisfies DailyOperationsCollectionNames;

export type DailyOperationsRedisEnv = "production" | "preview" | "local";

/** Retired transport: credentials may remain configured, but no client is constructed. */
export function getDailyOperationsRedis(): Redis | null {
  return null;
}

export function shouldPublishDailyOperationsRedis(): boolean {
  return false;
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
