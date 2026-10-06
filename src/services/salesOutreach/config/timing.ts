import { DESK_TIMING_DEFAULTS } from "../../../config/domain/salesOutreach";
import type { SalesOutreachConfigurationValue } from "../../../validation/v1/salesOutreach";

/**
 * Effective desk timing (olr A0). Every tunable is an optional configuration key without a schema
 * default (so stored versions keep their content hash); this resolver is the single place where an
 * absent key takes its code default (`DESK_TIMING_DEFAULTS`). Durations are milliseconds.
 */
export type DeskTiming = Readonly<{
  /** `evidence.call_settlement_allowance_minutes` (default 2): provider settlement allowance subtracted from capture coverage. */
  call_settlement_allowance_ms: number;
  /** `evidence.today_coverage_tolerance_minutes` (default 25): how far today's coverage may trail before a rep-day is not complete. */
  today_coverage_tolerance_ms: number;
  /** `evidence.capture_freshness_tolerance_minutes` (default 10): confirmation age at which calls freshness stops reading fresh. */
  capture_freshness_tolerance_ms: number;
  /** `evidence.webhook_silence_minutes` (default 30): webhook silence that marks calls freshness `webhook_silent`. */
  webhook_silence_ms: number;
  /** `operations.evaluate_drain_max_jobs` (default 100): `outreach_evaluate` jobs per cron drain. */
  evaluate_drain_max_jobs: number;
  /** `operations.evaluate_drain_budget_seconds` (default 40): wall-clock budget of one cron drain. */
  evaluate_drain_budget_ms: number;
  /** `operations.evaluate_drain_concurrency` (default 1): jobs run at once inside one drain. */
  evaluate_drain_concurrency: number;
}>;

const MINUTE_MS = 60_000;

/**
 * Effective timing for a configuration value. `null`/`undefined` (no configuration, only on
 * capture-side paths that already run without one) resolves to the code defaults.
 */
export function deskTimingOf(value: Pick<SalesOutreachConfigurationValue, "evidence" | "operations"> | null | undefined): DeskTiming {
  const evidence = value?.evidence;
  const operations = value?.operations;
  const d = DESK_TIMING_DEFAULTS;
  return Object.freeze({
    call_settlement_allowance_ms: (evidence?.call_settlement_allowance_minutes ?? d.call_settlement_allowance_minutes) * MINUTE_MS,
    today_coverage_tolerance_ms: (evidence?.today_coverage_tolerance_minutes ?? d.today_coverage_tolerance_minutes) * MINUTE_MS,
    capture_freshness_tolerance_ms: (evidence?.capture_freshness_tolerance_minutes ?? d.capture_freshness_tolerance_minutes) * MINUTE_MS,
    webhook_silence_ms: (evidence?.webhook_silence_minutes ?? d.webhook_silence_minutes) * MINUTE_MS,
    evaluate_drain_max_jobs: operations?.evaluate_drain_max_jobs ?? d.evaluate_drain_max_jobs,
    evaluate_drain_budget_ms: (operations?.evaluate_drain_budget_seconds ?? d.evaluate_drain_budget_seconds) * 1000,
    evaluate_drain_concurrency: operations?.evaluate_drain_concurrency ?? d.evaluate_drain_concurrency,
  });
}
