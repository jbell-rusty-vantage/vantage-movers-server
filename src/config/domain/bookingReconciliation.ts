const ALLOWED_AUTO_REMATCH_REASONS = [
  "no_match",
  "multiple_matches",
  "identity_conflict",
  "source_conflict",
  "channel_conflict",
  "duplicate_lead",
  "lead_already_booked",
  "lead_cancelled",
  "matching_unavailable",
] as const;

export type BookingLeadReconciliationReason =
  (typeof ALLOWED_AUTO_REMATCH_REASONS)[number];

export type BookingReconciliationConfig = {
  autoRematchEnabled: boolean;
  autoRematchReasons: BookingLeadReconciliationReason[];
  autoRematchDelaysMinutes: number[];
  autoRematchBatchSize: number;
  publicThrottleWindowSeconds: number;
  publicThrottlePerClientLimit: number;
  publicThrottleGlobalLimit: number;
};

export function getBookingReconciliationConfig(): BookingReconciliationConfig {
  return {
    autoRematchEnabled:
      process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED?.trim().toLowerCase() !==
      "false",
    autoRematchReasons: parseBookingReconciliationReasons(
      process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_REASONS?.trim() ||
        "matching_unavailable",
    ),
    autoRematchDelaysMinutes: parseMinuteList(
      process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_DELAYS_MINUTES?.trim() ||
        "5,30,120",
      "BOOKING_RECONCILIATION_AUTO_REMATCH_DELAYS_MINUTES",
    ),
    autoRematchBatchSize: parsePositiveInteger(
      process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_BATCH_SIZE,
      25,
      "BOOKING_RECONCILIATION_AUTO_REMATCH_BATCH_SIZE",
    ),
    publicThrottleWindowSeconds: parsePositiveInteger(
      process.env.EMPLOYEE_BOOKING_PUBLIC_THROTTLE_WINDOW_SECONDS,
      300,
      "EMPLOYEE_BOOKING_PUBLIC_THROTTLE_WINDOW_SECONDS",
    ),
    publicThrottlePerClientLimit: parsePositiveInteger(
      process.env.EMPLOYEE_BOOKING_PUBLIC_THROTTLE_PER_CLIENT_LIMIT,
      10,
      "EMPLOYEE_BOOKING_PUBLIC_THROTTLE_PER_CLIENT_LIMIT",
    ),
    publicThrottleGlobalLimit: parsePositiveInteger(
      process.env.EMPLOYEE_BOOKING_PUBLIC_THROTTLE_GLOBAL_LIMIT,
      250,
      "EMPLOYEE_BOOKING_PUBLIC_THROTTLE_GLOBAL_LIMIT",
    ),
  };
}

export function parseBookingReconciliationReasons(
  raw: string,
): BookingLeadReconciliationReason[] {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    throw new Error(
      "BOOKING_RECONCILIATION_AUTO_REMATCH_REASONS must list at least one reason",
    );
  }

  const seen = new Set<string>();
  const reasons = normalized
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      if (
        !ALLOWED_AUTO_REMATCH_REASONS.includes(
          value as BookingLeadReconciliationReason,
        )
      ) {
        throw new Error(
          `Unknown booking reconciliation rematch reason "${value}"`,
        );
      }
      if (seen.has(value)) {
        throw new Error(
          `Duplicate booking reconciliation rematch reason "${value}"`,
        );
      }
      seen.add(value);
      return value as BookingLeadReconciliationReason;
    });

  if (reasons.length === 0) {
    throw new Error(
      "BOOKING_RECONCILIATION_AUTO_REMATCH_REASONS must list at least one reason",
    );
  }

  return reasons;
}

function parseMinuteList(raw: string, envName: string): number[] {
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${envName} must contain only positive integers`);
      }
      return parsed;
    });

  if (values.length === 0) {
    throw new Error(`${envName} must contain at least one delay`);
  }

  return values;
}

function parsePositiveInteger(
  raw: string | undefined,
  defaultValue: number,
  envName: string,
): number {
  if (!raw?.trim()) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer`);
  }
  return parsed;
}

export const BOOKING_RECONCILIATION_AUTO_REMATCH_REASONS =
  ALLOWED_AUTO_REMATCH_REASONS;
