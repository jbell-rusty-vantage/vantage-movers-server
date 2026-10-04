import { logger } from "../../logger";

export const REPORTING_OBSERVABILITY_EVENT_KEYS = {
  oauthHealthFailed: "reporting.oauth.health_failed",
  destinationHealthFailed: "reporting.destination.health_failed",
  runStuckPhase: "reporting.run.stuck_phase",
  retryExhausted: "reporting.run.retry_exhausted",
  verificationMismatch: "reporting.delivery.verification_mismatch",
  promotionAmbiguous: "reporting.delivery.promotion_ambiguous",
  cleanupBacklog: "reporting.cleanup.backlog",
  cleanupJanitorFailed: "reporting.cleanup.janitor_failed",
  denylistUnavailable: "reporting.denylist.unavailable",
  capacityDivergence: "reporting.capacity.divergence",
  liveTestJanitorCompleted: "reporting.live_test.janitor_completed",
} as const;

const REPORTING_WORKFLOW = "reporting_projection";

type ReportingEventKey =
  (typeof REPORTING_OBSERVABILITY_EVENT_KEYS)[keyof typeof REPORTING_OBSERVABILITY_EVENT_KEYS];

function logReportingSignal(
  level: "info" | "warn" | "error",
  eventKey: ReportingEventKey,
  fields: Record<string, unknown>,
): void {
  logger[level]({ msg: eventKey, workflow: REPORTING_WORKFLOW, ...fields });
}

/** Operational alerts only — routine delivery success is never logged here. */
export function emitReportingOAuthHealthFailure(input: {
  reason: string;
  googleEmail?: string;
}): void {
  logReportingSignal("error", REPORTING_OBSERVABILITY_EVENT_KEYS.oauthHealthFailed, {
    reason: input.reason,
    ...(input.googleEmail ? { google_email_domain: input.googleEmail.split("@")[1] ?? "unknown" } : {}),
  });
}

export function emitReportingDestinationHealthFailure(input: {
  destinationId: string;
  reason: string;
}): void {
  logReportingSignal("error", REPORTING_OBSERVABILITY_EVENT_KEYS.destinationHealthFailed, {
    destination_id: input.destinationId,
    reason: input.reason,
  });
}

export function emitReportingStuckPhaseAlert(input: {
  runId: string;
  phase: string;
  ageMs: number;
  leaseOwner?: string | null;
}): void {
  logReportingSignal("error", REPORTING_OBSERVABILITY_EVENT_KEYS.runStuckPhase, {
    run_id: input.runId,
    phase: input.phase,
    age_ms: input.ageMs,
    ...(input.leaseOwner ? { lease_owner: input.leaseOwner } : {}),
  });
}

export function emitReportingRetryExhausted(input: {
  runId: string;
  phase: string;
  providerRetries: number;
}): void {
  logReportingSignal("error", REPORTING_OBSERVABILITY_EVENT_KEYS.retryExhausted, {
    run_id: input.runId,
    phase: input.phase,
    provider_retries: input.providerRetries,
  });
}

export function emitReportingVerificationMismatch(input: {
  runId: string;
  reasons: string[];
}): void {
  logReportingSignal("error", REPORTING_OBSERVABILITY_EVENT_KEYS.verificationMismatch, {
    run_id: input.runId,
    reasons: input.reasons.slice(0, 10),
  });
}

export function emitReportingPromotionAmbiguous(input: {
  runId: string;
  reason?: string;
}): void {
  logReportingSignal("error", REPORTING_OBSERVABILITY_EVENT_KEYS.promotionAmbiguous, {
    run_id: input.runId,
    ...(input.reason ? { reason: input.reason } : {}),
  });
}

export function emitReportingCleanupBacklog(input: {
  pendingCount: number;
  oldestRunId?: string;
}): void {
  logReportingSignal("warn", REPORTING_OBSERVABILITY_EVENT_KEYS.cleanupBacklog, {
    pending_count: input.pendingCount,
    ...(input.oldestRunId ? { oldest_run_id: input.oldestRunId } : {}),
  });
}

export function emitReportingDenylistUnavailable(input: {
  missingKeys?: string[];
}): void {
  logReportingSignal("error", REPORTING_OBSERVABILITY_EVENT_KEYS.denylistUnavailable, {
    severity: "critical",
    ...(input.missingKeys?.length
      ? { missing_registration_keys: input.missingKeys.slice(0, 20) }
      : {}),
  });
}

export function emitReportingCapacityDivergence(input: {
  runId: string;
  expectedCells: number;
  observedCells: number;
}): void {
  logReportingSignal("error", REPORTING_OBSERVABILITY_EVENT_KEYS.capacityDivergence, {
    run_id: input.runId,
    expected_cells: input.expectedCells,
    observed_cells: input.observedCells,
  });
}

export function recordReportingLiveTestJanitorOutcome(input: {
  ok: boolean;
  scanned: number;
  eligible: number;
  trashed: number;
  errors: number;
  dryRun: boolean;
}): void {
  logReportingSignal(
    input.ok ? "info" : "warn",
    REPORTING_OBSERVABILITY_EVENT_KEYS.liveTestJanitorCompleted,
    {
      scanned: input.scanned,
      eligible: input.eligible,
      trashed: input.trashed,
      errors: input.errors,
      dry_run: input.dryRun,
    },
  );
}

export function emitReportingCleanupJanitorFailed(input: {
  runId: string;
  errorCode?: string;
}): void {
  logReportingSignal("warn", REPORTING_OBSERVABILITY_EVENT_KEYS.cleanupJanitorFailed, {
    run_id: input.runId,
    ...(input.errorCode ? { error_code: input.errorCode } : {}),
  });
}

export type ReportingStuckRunCandidate = {
  runId: string;
  phase: string;
  updatedAtMs: number;
  leaseOwner?: string | null;
};

export function findReportingStuckRuns(input: {
  candidates: readonly ReportingStuckRunCandidate[];
  nowMs: number;
  phaseThresholdMs: number;
}): ReportingStuckRunCandidate[] {
  return input.candidates.filter(
    (candidate) => input.nowMs - candidate.updatedAtMs >= input.phaseThresholdMs,
  );
}

export const REPORTING_PHASE_STUCK_THRESHOLD_MS = 30 * 60 * 1000;

export function scanReportingOperationalHealth(input: {
  stuckCandidates: readonly ReportingStuckRunCandidate[];
  cleanupPendingCount: number;
  oldestCleanupRunId?: string;
  denylistIncomplete?: boolean;
  missingDenylistKeys?: string[];
}): void {
  const nowMs = Date.now();
  for (const stuck of findReportingStuckRuns({
    candidates: input.stuckCandidates,
    nowMs,
    phaseThresholdMs: REPORTING_PHASE_STUCK_THRESHOLD_MS,
  })) {
    emitReportingStuckPhaseAlert({
      runId: stuck.runId,
      phase: stuck.phase,
      ageMs: nowMs - stuck.updatedAtMs,
      leaseOwner: stuck.leaseOwner,
    });
  }

  if (input.cleanupPendingCount > 0) {
    emitReportingCleanupBacklog({
      pendingCount: input.cleanupPendingCount,
      ...(input.oldestCleanupRunId
        ? { oldestRunId: input.oldestCleanupRunId }
        : {}),
    });
  }

  if (input.denylistIncomplete) {
    emitReportingDenylistUnavailable({
      ...(input.missingDenylistKeys
        ? { missingKeys: input.missingDenylistKeys }
        : {}),
    });
  }
}
