import { recordOperationalEvent } from "../observability";

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

/** Operational alerts only — routine delivery success is never notified. */
export async function emitReportingOAuthHealthFailure(input: {
  reason: string;
  googleEmail?: string;
}): Promise<void> {
  await recordOperationalEvent({
    level: "error",
    eventKey: REPORTING_OBSERVABILITY_EVENT_KEYS.oauthHealthFailed,
    category: "admin",
    workflow: REPORTING_WORKFLOW,
    summary: "Reporting Google OAuth health check failed.",
    details: {
      reason: input.reason,
      ...(input.googleEmail ? { google_email_domain: input.googleEmail.split("@")[1] ?? "unknown" } : {}),
    },
    notificationCandidate: true,
    ownerVisible: true,
    piiPolicy: "none",
  });
}

export async function emitReportingDestinationHealthFailure(input: {
  destinationId: string;
  reason: string;
}): Promise<void> {
  await recordOperationalEvent({
    level: "error",
    eventKey: REPORTING_OBSERVABILITY_EVENT_KEYS.destinationHealthFailed,
    category: "admin",
    workflow: REPORTING_WORKFLOW,
    summary: "Reporting destination health verification failed.",
    details: {
      destination_id: input.destinationId,
      reason: input.reason,
    },
    entity: { type: "reporting_destination", id: input.destinationId },
    notificationCandidate: true,
    ownerVisible: true,
    piiPolicy: "none",
  });
}

export async function emitReportingStuckPhaseAlert(input: {
  runId: string;
  phase: string;
  ageMs: number;
  leaseOwner?: string | null;
}): Promise<void> {
  await recordOperationalEvent({
    level: "error",
    eventKey: REPORTING_OBSERVABILITY_EVENT_KEYS.runStuckPhase,
    category: "admin",
    workflow: REPORTING_WORKFLOW,
    summary: "Reporting run exceeded phase age threshold.",
    details: {
      phase: input.phase,
      age_ms: input.ageMs,
      ...(input.leaseOwner ? { lease_owner: input.leaseOwner } : {}),
    },
    runId: input.runId,
    entity: { type: "reporting_run", id: input.runId },
    notificationCandidate: true,
    ownerVisible: false,
    piiPolicy: "none",
  });
}

export async function emitReportingRetryExhausted(input: {
  runId: string;
  phase: string;
  providerRetries: number;
}): Promise<void> {
  await recordOperationalEvent({
    level: "error",
    eventKey: REPORTING_OBSERVABILITY_EVENT_KEYS.retryExhausted,
    category: "admin",
    workflow: REPORTING_WORKFLOW,
    summary: "Reporting delivery exhausted transient provider retries.",
    details: {
      phase: input.phase,
      provider_retries: input.providerRetries,
    },
    runId: input.runId,
    entity: { type: "reporting_run", id: input.runId },
    notificationCandidate: true,
    ownerVisible: false,
    piiPolicy: "none",
  });
}

export async function emitReportingVerificationMismatch(input: {
  runId: string;
  reasons: string[];
}): Promise<void> {
  await recordOperationalEvent({
    level: "error",
    eventKey: REPORTING_OBSERVABILITY_EVENT_KEYS.verificationMismatch,
    category: "admin",
    workflow: REPORTING_WORKFLOW,
    summary: "Reporting delivery verification mismatch.",
    details: { reasons: input.reasons.slice(0, 10) },
    runId: input.runId,
    entity: { type: "reporting_run", id: input.runId },
    notificationCandidate: true,
    ownerVisible: true,
    piiPolicy: "none",
  });
}

export async function emitReportingPromotionAmbiguous(input: {
  runId: string;
  reason?: string;
}): Promise<void> {
  await recordOperationalEvent({
    level: "error",
    eventKey: REPORTING_OBSERVABILITY_EVENT_KEYS.promotionAmbiguous,
    category: "admin",
    workflow: REPORTING_WORKFLOW,
    summary: "Reporting replace-tab promotion is ambiguous.",
    details: input.reason ? { reason: input.reason } : {},
    runId: input.runId,
    entity: { type: "reporting_run", id: input.runId },
    notificationCandidate: true,
    ownerVisible: true,
    piiPolicy: "none",
  });
}

export async function emitReportingCleanupBacklog(input: {
  pendingCount: number;
  oldestRunId?: string;
}): Promise<void> {
  await recordOperationalEvent({
    level: "warn",
    eventKey: REPORTING_OBSERVABILITY_EVENT_KEYS.cleanupBacklog,
    category: "admin",
    workflow: REPORTING_WORKFLOW,
    summary: "Reporting cleanup backlog requires attention.",
    details: {
      pending_count: input.pendingCount,
      ...(input.oldestRunId ? { oldest_run_id: input.oldestRunId } : {}),
    },
    notificationCandidate: input.pendingCount >= 5,
    ownerVisible: false,
    piiPolicy: "none",
  });
}

export async function emitReportingDenylistUnavailable(input: {
  missingKeys?: string[];
}): Promise<void> {
  await recordOperationalEvent({
    level: "critical",
    eventKey: REPORTING_OBSERVABILITY_EVENT_KEYS.denylistUnavailable,
    category: "admin",
    workflow: REPORTING_WORKFLOW,
    summary: "Operational workbook denylist is incomplete or unavailable.",
    details: {
      ...(input.missingKeys?.length
        ? { missing_registration_keys: input.missingKeys.slice(0, 20) }
        : {}),
    },
    notificationCandidate: true,
    ownerVisible: false,
    piiPolicy: "none",
  });
}

export async function emitReportingCapacityDivergence(input: {
  runId: string;
  expectedCells: number;
  observedCells: number;
}): Promise<void> {
  await recordOperationalEvent({
    level: "error",
    eventKey: REPORTING_OBSERVABILITY_EVENT_KEYS.capacityDivergence,
    category: "admin",
    workflow: REPORTING_WORKFLOW,
    summary: "Reporting capacity estimate diverged from observed write bounds.",
    details: {
      expected_cells: input.expectedCells,
      observed_cells: input.observedCells,
    },
    runId: input.runId,
    entity: { type: "reporting_run", id: input.runId },
    notificationCandidate: true,
    ownerVisible: false,
    piiPolicy: "none",
  });
}

export async function recordReportingLiveTestJanitorOutcome(input: {
  ok: boolean;
  scanned: number;
  eligible: number;
  trashed: number;
  errors: number;
  dryRun: boolean;
}): Promise<void> {
  await recordOperationalEvent({
    level: input.ok ? "info" : "warn",
    eventKey: REPORTING_OBSERVABILITY_EVENT_KEYS.liveTestJanitorCompleted,
    category: "admin",
    workflow: REPORTING_WORKFLOW,
    summary: input.ok
      ? "Reporting live-test artifact janitor completed."
      : "Reporting live-test artifact janitor completed with errors.",
    details: {
      scanned: input.scanned,
      eligible: input.eligible,
      trashed: input.trashed,
      errors: input.errors,
      dry_run: input.dryRun,
    },
    notificationCandidate: !input.ok,
    reportable: true,
    ownerVisible: false,
    piiPolicy: "none",
  });
}

export async function emitReportingCleanupJanitorFailed(input: {
  runId: string;
  errorCode?: string;
}): Promise<void> {
  await recordOperationalEvent({
    level: "warn",
    eventKey: REPORTING_OBSERVABILITY_EVENT_KEYS.cleanupJanitorFailed,
    category: "admin",
    workflow: REPORTING_WORKFLOW,
    summary: "Reporting delivery cleanup janitor failed for a run.",
    details: input.errorCode ? { error_code: input.errorCode } : {},
    runId: input.runId,
    entity: { type: "reporting_run", id: input.runId },
    notificationCandidate: true,
    ownerVisible: false,
    piiPolicy: "none",
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

export async function scanReportingOperationalHealth(input: {
  stuckCandidates: readonly ReportingStuckRunCandidate[];
  cleanupPendingCount: number;
  oldestCleanupRunId?: string;
  denylistIncomplete?: boolean;
  missingDenylistKeys?: string[];
}): Promise<void> {
  const nowMs = Date.now();
  for (const stuck of findReportingStuckRuns({
    candidates: input.stuckCandidates,
    nowMs,
    phaseThresholdMs: REPORTING_PHASE_STUCK_THRESHOLD_MS,
  })) {
    await emitReportingStuckPhaseAlert({
      runId: stuck.runId,
      phase: stuck.phase,
      ageMs: nowMs - stuck.updatedAtMs,
      leaseOwner: stuck.leaseOwner,
    });
  }

  if (input.cleanupPendingCount > 0) {
    await emitReportingCleanupBacklog({
      pendingCount: input.cleanupPendingCount,
      ...(input.oldestCleanupRunId
        ? { oldestRunId: input.oldestCleanupRunId }
        : {}),
    });
  }

  if (input.denylistIncomplete) {
    await emitReportingDenylistUnavailable({
      ...(input.missingDenylistKeys
        ? { missingKeys: input.missingDenylistKeys }
        : {}),
    });
  }
}
