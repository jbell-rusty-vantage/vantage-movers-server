import type { ExecutionMode } from "../../services/granotLifecycle/types";

export const GRANOT_LIFECYCLE_FLAG_NAMES = [
  "GRANOT_LIFECYCLE_PROCESSING_ENABLED",
  "GRANOT_LIFECYCLE_SHADOW_MODE",
  "GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED",
  "GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED",
  "GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED",
  "GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED",
  "GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED",
  "GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED",
  "GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED",
  "GRANOT_LIFECYCLE_EMAIL_ENABLED",
] as const;

export type GranotLifecycleFlagName = (typeof GRANOT_LIFECYCLE_FLAG_NAMES)[number];

export type GranotLifecycleFlags = {
  processing_enabled: boolean;
  shadow_mode: boolean;
  lead_writes_enabled: boolean;
  lead_creation_enabled: boolean;
  booking_cases_enabled: boolean;
  booking_commands_enabled: boolean;
  release_cases_enabled: boolean;
  release_commands_enabled: boolean;
  referral_booking_enabled: boolean;
  email_enabled: boolean;
};

export const GRANOT_LIFECYCLE_FLAG_DEFAULTS: GranotLifecycleFlags = {
  processing_enabled: true,
  shadow_mode: true,
  lead_writes_enabled: false,
  lead_creation_enabled: false,
  booking_cases_enabled: false,
  booking_commands_enabled: false,
  release_cases_enabled: false,
  release_commands_enabled: false,
  referral_booking_enabled: false,
  email_enabled: false,
};

const FLAG_ENV_TO_FIELD = {
  GRANOT_LIFECYCLE_PROCESSING_ENABLED: "processing_enabled",
  GRANOT_LIFECYCLE_SHADOW_MODE: "shadow_mode",
  GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED: "lead_writes_enabled",
  GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED: "lead_creation_enabled",
  GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED: "booking_cases_enabled",
  GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED: "booking_commands_enabled",
  GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED: "release_cases_enabled",
  GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED: "release_commands_enabled",
  GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED: "referral_booking_enabled",
  GRANOT_LIFECYCLE_EMAIL_ENABLED: "email_enabled",
} as const satisfies Record<GranotLifecycleFlagName, keyof GranotLifecycleFlags>;

const EXPLICIT_BOOLEAN = new Map<string, boolean>([
  ["true", true],
  ["false", false],
]);

export function parseExplicitBooleanFlag(
  raw: string | undefined,
  defaultValue: boolean,
  envName: string,
): boolean {
  if (raw == null || raw.trim() === "") {
    return defaultValue;
  }
  const normalized = raw.trim().toLowerCase();
  const parsed = EXPLICIT_BOOLEAN.get(normalized);
  if (parsed === undefined) {
    throw new Error(
      `${envName} must be an explicit boolean (true|false); received a malformed value`,
    );
  }
  return parsed;
}

export function getGranotLifecycleFlags(
  env: NodeJS.ProcessEnv = process.env,
): GranotLifecycleFlags {
  const flags = { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS };
  for (const name of GRANOT_LIFECYCLE_FLAG_NAMES) {
    const field = FLAG_ENV_TO_FIELD[name];
    flags[field] = parseExplicitBooleanFlag(
      env[name],
      GRANOT_LIFECYCLE_FLAG_DEFAULTS[field],
      name,
    );
  }
  return flags;
}

export function anyLifecycleEffectEnabled(flags: GranotLifecycleFlags): boolean {
  return (
    flags.lead_writes_enabled ||
    flags.lead_creation_enabled ||
    flags.booking_cases_enabled ||
    flags.booking_commands_enabled ||
    flags.release_cases_enabled ||
    flags.release_commands_enabled ||
    flags.referral_booking_enabled ||
    flags.email_enabled
  );
}

export type ExecutionModeClassificationInput = {
  captured_at: Date;
  activated_at?: Date | null;
  shadow_mode: boolean;
};

export function classifyExecutionMode(
  input: ExecutionModeClassificationInput,
): ExecutionMode {
  if (input.activated_at == null) {
    return "historical_shadow";
  }
  if (input.captured_at.getTime() < input.activated_at.getTime()) {
    return "historical_shadow";
  }
  return input.shadow_mode ? "live_shadow" : "live";
}

/** Unit 30 / Section 33 initial rollout thresholds. Not env-overridable. */
export const GRANOT_LIFECYCLE_ALERT_THRESHOLDS = {
  oldest_due_ms: 15 * 60 * 1000,
  oldest_due_continuity_ms: 10 * 60 * 1000,
  dead_letter_count: 0,
  capture_503_count: 0,
  claim_recovery_per_hour: 5,
  capture_to_decision_p95_ms: 10 * 60 * 1000,
  ringcentral_lease_held_ms: 10 * 60 * 1000,
  source_ambiguity_policy_blocked_rate: 0.05,
  health_window_ms: 24 * 60 * 60 * 1000,
  claim_recovery_window_ms: 60 * 60 * 1000,
} as const;
