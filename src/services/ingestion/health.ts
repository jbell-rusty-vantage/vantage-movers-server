import { recordOperationalEvent } from "../observability";

export type IngestionHealthSignal =
  | {
      key: "structural_failure";
      run_id: string;
      code: string;
      phase: string;
      summary: string;
    }
  | {
      key: "schema_or_formula_drift";
      run_id: string;
      blocking_checks: string[];
    }
  | {
      key: "zero_parsed_counts";
      run_id: string;
      read_count: number;
    }
  | {
      key: "unmatched_refunds";
      run_id: string;
      count: number;
    }
  | {
      key: "leadless_booking_growth";
      run_id: string;
      count: number;
    }
  | {
      key: "conflict_growth";
      run_id: string;
      count: number;
    }
  | {
      key: "duplicate_source_identity";
      run_id: string;
      count: number;
    }
  | {
      key: "completed_with_errors";
      run_id: string;
      failures: number;
      skipped_dependencies: number;
    }
  | {
      key: "lease_contention";
      scope: string;
      owner?: string;
    };

const EVENT_KEYS = {
  structural_failure: "best_relocation_ingestion.run_failed",
  schema_or_formula_drift: "best_relocation_ingestion.schema_drift",
  zero_parsed_counts: "best_relocation_ingestion.zero_parsed_counts",
  unmatched_refunds: "best_relocation_ingestion.unmatched_refunds",
  leadless_booking_growth: "best_relocation_ingestion.leadless_booking_growth",
  conflict_growth: "best_relocation_ingestion.conflict_growth",
  duplicate_source_identity: "best_relocation_ingestion.duplicate_source_identity",
  completed_with_errors: "best_relocation_ingestion.completed_with_errors",
  lease_contention: "best_relocation_ingestion.lease_contention",
} as const;

const GROWTH_ALERT_THRESHOLD = 5;

export function shouldAlertIngestionSignal(
  signal: IngestionHealthSignal,
): boolean {
  switch (signal.key) {
    case "structural_failure":
    case "schema_or_formula_drift":
    case "duplicate_source_identity":
    case "lease_contention":
    case "completed_with_errors":
      return true;
    case "zero_parsed_counts":
      return signal.read_count === 0;
    case "unmatched_refunds":
    case "leadless_booking_growth":
    case "conflict_growth":
      return signal.count >= GROWTH_ALERT_THRESHOLD;
    default:
      return false;
  }
}

export async function emitIngestionHealthSignal(
  signal: IngestionHealthSignal,
): Promise<void> {
  if (!shouldAlertIngestionSignal(signal)) return;
  const summary = summarize(signal);
  await recordOperationalEvent({
    level: "error",
    eventKey: EVENT_KEYS[signal.key],
    category: "google_sheets",
    workflow: "best_relocation_ingestion",
    summary,
    details: signal as unknown as Record<string, unknown>,
    errorMessage: summary,
    notificationCandidate: true,
  });
}

export function planHealthSignals(input: {
  run_id: string;
  read_count: number;
  counters: Record<string, number>;
  blocking_inspection_checks?: string[];
}): IngestionHealthSignal[] {
  const signals: IngestionHealthSignal[] = [];
  if (input.blocking_inspection_checks?.length) {
    signals.push({
      key: "schema_or_formula_drift",
      run_id: input.run_id,
      blocking_checks: input.blocking_inspection_checks,
    });
  }
  if (input.read_count === 0) {
    signals.push({
      key: "zero_parsed_counts",
      run_id: input.run_id,
      read_count: 0,
    });
  }
  const unmatchedRefunds = input.counters.unmatched_refund ?? 0;
  if (unmatchedRefunds > 0) {
    signals.push({
      key: "unmatched_refunds",
      run_id: input.run_id,
      count: unmatchedRefunds,
    });
  }
  const leadless = input.counters.leadless_booking ?? 0;
  if (leadless > 0) {
    signals.push({
      key: "leadless_booking_growth",
      run_id: input.run_id,
      count: leadless,
    });
  }
  const conflicts = input.counters.conflict ?? 0;
  if (conflicts > 0) {
    signals.push({
      key: "conflict_growth",
      run_id: input.run_id,
      count: conflicts,
    });
  }
  const duplicates = input.counters.duplicate_source_identity ?? 0;
  if (duplicates > 0) {
    signals.push({
      key: "duplicate_source_identity",
      run_id: input.run_id,
      count: duplicates,
    });
  }
  return signals;
}

function summarize(signal: IngestionHealthSignal): string {
  switch (signal.key) {
    case "structural_failure":
      return signal.summary;
    case "schema_or_formula_drift":
      return `Best Relocation source schema/formula drift blocked run ${signal.run_id}.`;
    case "zero_parsed_counts":
      return `Best Relocation ingestion run ${signal.run_id} parsed zero in-window rows.`;
    case "unmatched_refunds":
      return `Best Relocation ingestion opened ${signal.count} unmatched refund conflict(s).`;
    case "leadless_booking_growth":
      return `Best Relocation ingestion created ${signal.count} leadless booking(s).`;
    case "conflict_growth":
      return `Best Relocation ingestion opened ${signal.count} conflict(s).`;
    case "duplicate_source_identity":
      return `Best Relocation ingestion detected ${signal.count} duplicate source identity conflict(s).`;
    case "completed_with_errors":
      return `Best Relocation ingestion run ${signal.run_id} completed with ${signal.failures} failure(s).`;
    case "lease_contention":
      return `Best Relocation ingestion could not acquire apply lease ${signal.scope}.`;
  }
}
