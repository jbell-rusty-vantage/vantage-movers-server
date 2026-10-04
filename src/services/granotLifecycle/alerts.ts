import { GRANOT_LIFECYCLE_ALERT_THRESHOLDS } from "../../config/domain/granotLifecycle";
import {
  markGranotLifecycleAlertFiring,
  markGranotLifecycleAlertRecovered,
  readGranotLifecycleAlertRows,
} from "./healthState";
import {
  GRANOT_LIFECYCLE_ALERT_CODES,
  emitGranotLifecycleEvent,
  type GranotLifecycleAlertCode,
} from "./observability";

export type GranotLifecycleAlertState = "ok" | "firing" | "insufficient_data";
export type GranotLifecycleAlertUnit = "count" | "milliseconds" | "ratio";

export type GranotLifecycleAlertProjection = {
  code: GranotLifecycleAlertCode;
  scope_ref?: string;
  state: GranotLifecycleAlertState;
  observed_value: number | null;
  threshold: number;
  unit: GranotLifecycleAlertUnit;
  since?: string;
};

export type GranotLifecycleAlertSnapshot = {
  oldest_due_age_ms: number | null;
  oldest_due_threshold_since: Date | null;
  dead_letter_count: number;
  /** Null when the bounded Health window is not fully covered (unknown). */
  capture_503_count_24h: number | null;
  claim_recoveries_1h: number | null;
  capture_to_decision_samples_24h: readonly number[];
  ringcentral_lease_held: boolean;
  ringcentral_lease_age_ms: number | null;
  source_rates: Array<{
    scope_ref: string;
    numerator: number;
    denominator: number;
  }>;
};

export function nearestRankP95(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1));
  return sorted[rank] ?? null;
}

export function evaluateGranotLifecycleAlerts(
  snapshot: GranotLifecycleAlertSnapshot,
  now: Date = new Date(),
): GranotLifecycleAlertProjection[] {
  const alerts: GranotLifecycleAlertProjection[] = [
    evaluateOldestDue(snapshot.oldest_due_age_ms, snapshot.oldest_due_threshold_since, now),
    evaluateDeadLetter(snapshot.dead_letter_count),
    evaluateCaptureUnavailable(snapshot.capture_503_count_24h),
    evaluateClaimRecovery(snapshot.claim_recoveries_1h),
    evaluateCaptureToDecisionP95(snapshot.capture_to_decision_samples_24h),
    evaluateRingCentralLease(snapshot.ringcentral_lease_held, snapshot.ringcentral_lease_age_ms),
    ...evaluateSourceRates(snapshot.source_rates),
  ];
  return alerts.sort(compareAlerts);
}

function evaluateOldestDue(
  ageMs: number | null,
  thresholdSince: Date | null,
  now: Date,
): GranotLifecycleAlertProjection {
  const threshold = GRANOT_LIFECYCLE_ALERT_THRESHOLDS.oldest_due_ms;
  const firing = ageMs != null
    && ageMs > threshold
    && thresholdSince != null
    && now.getTime() - thresholdSince.getTime()
      >= GRANOT_LIFECYCLE_ALERT_THRESHOLDS.oldest_due_continuity_ms;
  return {
    code: "oldest_due_exceeded",
    state: firing ? "firing" : "ok",
    observed_value: ageMs,
    threshold,
    unit: "milliseconds",
  };
}

function evaluateDeadLetter(count: number): GranotLifecycleAlertProjection {
  return {
    code: "dead_letter_present",
    state: count > GRANOT_LIFECYCLE_ALERT_THRESHOLDS.dead_letter_count ? "firing" : "ok",
    observed_value: count,
    threshold: GRANOT_LIFECYCLE_ALERT_THRESHOLDS.dead_letter_count,
    unit: "count",
  };
}

function evaluateCaptureUnavailable(count: number | null): GranotLifecycleAlertProjection {
  return {
    code: "capture_unavailable",
    state: count == null
      ? "insufficient_data"
      : count > GRANOT_LIFECYCLE_ALERT_THRESHOLDS.capture_503_count ? "firing" : "ok",
    observed_value: count,
    threshold: GRANOT_LIFECYCLE_ALERT_THRESHOLDS.capture_503_count,
    unit: "count",
  };
}

function evaluateClaimRecovery(count: number | null): GranotLifecycleAlertProjection {
  return {
    code: "claim_recovery_rate",
    state: count == null
      ? "insufficient_data"
      : count > GRANOT_LIFECYCLE_ALERT_THRESHOLDS.claim_recovery_per_hour ? "firing" : "ok",
    observed_value: count,
    threshold: GRANOT_LIFECYCLE_ALERT_THRESHOLDS.claim_recovery_per_hour,
    unit: "count",
  };
}

function evaluateCaptureToDecisionP95(samples: readonly number[]): GranotLifecycleAlertProjection {
  const p95 = nearestRankP95(samples);
  return {
    code: "capture_to_decision_p95",
    state: p95 == null
      ? "insufficient_data"
      : p95 > GRANOT_LIFECYCLE_ALERT_THRESHOLDS.capture_to_decision_p95_ms
        ? "firing"
        : "ok",
    observed_value: p95,
    threshold: GRANOT_LIFECYCLE_ALERT_THRESHOLDS.capture_to_decision_p95_ms,
    unit: "milliseconds",
  };
}

function evaluateRingCentralLease(
  held: boolean,
  ageMs: number | null,
): GranotLifecycleAlertProjection {
  const firing = held && ageMs != null && ageMs > GRANOT_LIFECYCLE_ALERT_THRESHOLDS.ringcentral_lease_held_ms;
  return {
    code: "ringcentral_lease_held",
    state: firing ? "firing" : "ok",
    observed_value: held ? ageMs : 0,
    threshold: GRANOT_LIFECYCLE_ALERT_THRESHOLDS.ringcentral_lease_held_ms,
    unit: "milliseconds",
  };
}

function evaluateSourceRates(
  rates: GranotLifecycleAlertSnapshot["source_rates"],
): GranotLifecycleAlertProjection[] {
  if (rates.length === 0) {
    return [{
      code: "source_ambiguity_policy_blocked_rate",
      state: "insufficient_data",
      observed_value: null,
      threshold: GRANOT_LIFECYCLE_ALERT_THRESHOLDS.source_ambiguity_policy_blocked_rate,
      unit: "ratio",
    }];
  }
  return rates.map((row) => {
    if (row.denominator <= 0) {
      return {
        code: "source_ambiguity_policy_blocked_rate",
        scope_ref: row.scope_ref,
        state: "insufficient_data" as const,
        observed_value: null,
        threshold: GRANOT_LIFECYCLE_ALERT_THRESHOLDS.source_ambiguity_policy_blocked_rate,
        unit: "ratio" as const,
      };
    }
    const rate = row.numerator / row.denominator;
    return {
      code: "source_ambiguity_policy_blocked_rate",
      scope_ref: row.scope_ref,
      state: rate > GRANOT_LIFECYCLE_ALERT_THRESHOLDS.source_ambiguity_policy_blocked_rate
        ? "firing" as const
        : "ok" as const,
      observed_value: rate,
      threshold: GRANOT_LIFECYCLE_ALERT_THRESHOLDS.source_ambiguity_policy_blocked_rate,
      unit: "ratio" as const,
    };
  });
}

function compareAlerts(a: GranotLifecycleAlertProjection, b: GranotLifecycleAlertProjection): number {
  const code = a.code.localeCompare(b.code);
  if (code !== 0) return code;
  return (a.scope_ref ?? "").localeCompare(b.scope_ref ?? "");
}

export function classifyAlertTransition(
  state: GranotLifecycleAlertState,
  wasOpen: boolean,
): "firing" | "recovered" | null {
  if (state === "firing" && !wasOpen) return "firing";
  if (state === "ok" && wasOpen) return "recovered";
  return null;
}

function alertStateKey(alert: GranotLifecycleAlertProjection): string {
  return `alert:${alert.code}:${alert.scope_ref ?? "global"}`;
}

function alertTransitionDetails(alert: GranotLifecycleAlertProjection): Record<string, unknown> {
  return {
    alert_code: alert.code,
    ...(alert.scope_ref ? { scope_ref: alert.scope_ref } : {}),
    observed_value: alert.observed_value,
    threshold: alert.threshold,
    unit: alert.unit,
    state: alert.state,
  };
}

/**
 * Persist firing/recovery transitions in the bounded Health state. The row is
 * compare-and-set, so repeated evaluation, restarts and replicas never fan out
 * a second transition. A firing alert reports the persisted `since`.
 */
export async function persistGranotLifecycleAlertTransitions(
  alerts: GranotLifecycleAlertProjection[],
  now: Date = new Date(),
): Promise<void> {
  try {
    const rows = await readGranotLifecycleAlertRows();
    for (const alert of alerts) {
      const key = alertStateKey(alert);
      const row = rows.get(key);
      const wasOpen = row?.state === "firing";
      const transition = classifyAlertTransition(alert.state, wasOpen);
      if (alert.state === "firing" && wasOpen) {
        if (row?.since) alert.since = row.since.toISOString();
        continue;
      }
      if (transition === "firing") {
        const marked = await markGranotLifecycleAlertFiring({
          key,
          code: alert.code,
          scope_ref: alert.scope_ref,
          now,
        });
        if (marked.since) alert.since = marked.since.toISOString();
        if (!marked.transitioned) continue;
        await emitGranotLifecycleEvent({
          level: "warn",
          eventKey: "granot_lifecycle.alert.firing",
          category: "admin",
          summary: "Granot lifecycle rollout alert entered firing.",
          details: alertTransitionDetails(alert),
        });
      } else if (transition === "recovered") {
        if (!(await markGranotLifecycleAlertRecovered({ key, now }))) continue;
        await emitGranotLifecycleEvent({
          level: "info",
          eventKey: "granot_lifecycle.alert.recovered",
          category: "admin",
          summary: "Granot lifecycle rollout alert recovered.",
          details: alertTransitionDetails(alert),
        });
      }
    }
  } catch {
    // Alert persistence is best-effort and cannot pause capture/processing.
  }
}

export function alertCatalogFrozen(): readonly GranotLifecycleAlertCode[] {
  return GRANOT_LIFECYCLE_ALERT_CODES;
}
