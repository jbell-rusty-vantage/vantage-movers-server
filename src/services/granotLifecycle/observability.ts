import {
  recordOperationalEvent,
  type RecordOperationalEventInput,
} from "../observability";
import { incrementGranotLifecycleCommandConflicts } from "./metrics";
import { GRANOT_LIFECYCLE_ERROR_CODES, isGranotLifecycleError } from "./errors";
import { DomainCommandIdempotencyConflictError } from "../domainCommands/types";

/**
 * Unit 30 / Section 33 event catalog. Literal keys are issue-author;
 * Section 33 names the transitions. Landed underscore keys normalize here
 * one-way. Do not emit both an alias and its canonical key for one transition.
 */
export const GRANOT_LIFECYCLE_EVENT_CATALOG = [
  "granot_lifecycle.capture.failed",
  "granot_lifecycle.queue.publish_failed",
  "granot_lifecycle.processing.completed",
  "granot_lifecycle.technical_retry.scheduled",
  "granot_lifecycle.dead_letter.entered",
  "granot_lifecycle.manual_requeue",
  "granot_lifecycle.booking_case.opened",
  "granot_lifecycle.booking_case.refreshed",
  "granot_lifecycle.booking_case.resolved",
  "granot_lifecycle.release_case.opened",
  "granot_lifecycle.release_case.refreshed",
  "granot_lifecycle.release_case.resolved",
  "granot_lifecycle.booking_discrepancy.opened",
  "granot_lifecycle.booking_discrepancy.refreshed",
  "granot_lifecycle.booking_discrepancy.resolved",
  "granot_lifecycle.release_discrepancy.opened",
  "granot_lifecycle.release_discrepancy.refreshed",
  "granot_lifecycle.release_discrepancy.resolved",
  "granot_lifecycle.owner_command.applied",
  "granot_lifecycle.owner_command.replayed",
  "granot_lifecycle.owner_command.conflict",
  "granot_lifecycle.activation.committed",
  "ringcentral.granot_adoption.adopted",
  "ringcentral.granot_adoption.conflict",
] as const;

export type GranotLifecycleEventKey = (typeof GRANOT_LIFECYCLE_EVENT_CATALOG)[number];

/** Supporting keys used for health last-run, claim-recovery window, and alert transitions. */
export const GRANOT_LIFECYCLE_SUPPORTING_EVENT_KEYS = [
  "granot_lifecycle.queue.run.completed",
  "granot_lifecycle.queue.run.failed",
  "granot_lifecycle.cron.run.completed",
  "granot_lifecycle.cron.run.failed",
  "granot_lifecycle.claim.recovered",
  "granot_lifecycle.alert.firing",
  "granot_lifecycle.alert.recovered",
] as const;

export const GRANOT_LIFECYCLE_EVENT_ALIASES = {
  "granot_lifecycle.booking_case_opened": "granot_lifecycle.booking_case.opened",
  "granot_lifecycle.booking_case_refreshed": "granot_lifecycle.booking_case.refreshed",
  "granot_lifecycle.release_case_opened": "granot_lifecycle.release_case.opened",
  "granot_lifecycle.release_case_refreshed": "granot_lifecycle.release_case.refreshed",
  "granot_lifecycle.booking_discrepancy_opened": "granot_lifecycle.booking_discrepancy.opened",
  "granot_lifecycle.booking_discrepancy_refreshed": "granot_lifecycle.booking_discrepancy.refreshed",
  "granot_lifecycle.release_discrepancy_opened": "granot_lifecycle.release_discrepancy.opened",
  "granot_lifecycle.release_discrepancy_refreshed": "granot_lifecycle.release_discrepancy.refreshed",
  "granot_lifecycle.dead_letter": "granot_lifecycle.dead_letter.entered",
  "granot_lifecycle.technical_retry": "granot_lifecycle.technical_retry.scheduled",
  "granot_lifecycle.manual_requeue.committed": "granot_lifecycle.manual_requeue",
  "ringcentral.call_lead.adopted": "ringcentral.granot_adoption.adopted",
  "ringcentral.call_lead.adopted_duplicate": "ringcentral.granot_adoption.adopted",
  "ringcentral.call_lead.convergence_conflict": "ringcentral.granot_adoption.conflict",
} as const satisfies Record<string, GranotLifecycleEventKey>;

export const GRANOT_LIFECYCLE_ALERT_CODES = [
  "oldest_due_exceeded",
  "dead_letter_present",
  "capture_unavailable",
  "claim_recovery_rate",
  "capture_to_decision_p95",
  "ringcentral_lease_held",
  "source_ambiguity_policy_blocked_rate",
] as const;

export type GranotLifecycleAlertCode = (typeof GRANOT_LIFECYCLE_ALERT_CODES)[number];

export const OWNER_COMMAND_CONFLICT_CODES = [
  "DOMAIN_REVISION_CONFLICT",
  "GRANOT_CASE_REVISION_CONFLICT",
  "DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT",
  "GRANOT_IDENTITY_CONFLICT",
  "GRANOT_OPERATION_IDEMPOTENCY_CONFLICT",
] as const;

const FORBIDDEN_DETAIL_KEYS = new Set([
  "payload",
  "raw_payload",
  "headers",
  "authorization",
  "cookie",
  "secret",
  "credential",
  "credentials",
  "password",
  "token",
  "x-api-secret",
  "address",
  "phone",
  "phone_number",
  "email",
  "name",
  "customer",
  "job_no",
  "job_number",
  "normalized_job_no",
  "source_label",
  "actor_label",
  "actor_email",
  "reason",
  "reason_text",
  "notes",
  "command_body",
  "money",
  "stack",
  "message",
  "error",
  "error_message",
  "provider_body",
  "provider_message",
]);

const ALLOWED_DETAIL_KEYS = new Set([
  "channel",
  "event_class",
  "outcome",
  "reason_code",
  "code",
  "conflict_code",
  "execution_mode",
  "kind",
  "mode",
  "trigger",
  "replayed",
  "command",
  "attempt",
  "technical_attempts",
  "manual_requeue_count",
  "case_revision",
  "evidence_revision",
  "revision",
  "duration_ms",
  "count",
  "observed_value",
  "threshold",
  "unit",
  "state",
  "prior_state",
  "new_state",
  "receipt_id",
  "observation_id",
  "decision_id",
  "case_id",
  "discrepancy_id",
  "activation_id",
  "command_execution_id",
  "processor_version",
  "activated_at",
  "request_id",
  "actor_role",
  "actor_id",
  "route",
  "alert_code",
  "scope_ref",
  "numerator",
  "denominator",
  "rate",
  "sample_count",
  "pii_policy",
]);

export type GranotLifecycleEmitInput = {
  eventKey: string;
  level?: RecordOperationalEventInput["level"];
  category?: RecordOperationalEventInput["category"];
  workflow?: string;
  summary: string;
  details?: Record<string, unknown>;
  entity?: { type: string; id: string };
  route?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  requestId?: string;
  dedupeKey?: string;
  autoResolveKey?: string;
  piiPolicy?: "none" | "masked";
};

export function normalizeGranotLifecycleEventKey(eventKey: string): string {
  if (eventKey in GRANOT_LIFECYCLE_EVENT_ALIASES) {
    return GRANOT_LIFECYCLE_EVENT_ALIASES[
      eventKey as keyof typeof GRANOT_LIFECYCLE_EVENT_ALIASES
    ];
  }
  return eventKey;
}

export function isGranotLifecycleCatalogKey(eventKey: string): boolean {
  return (GRANOT_LIFECYCLE_EVENT_CATALOG as readonly string[]).includes(eventKey)
    || (GRANOT_LIFECYCLE_SUPPORTING_EVENT_KEYS as readonly string[]).includes(eventKey);
}

export function maskLifecycleId(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  return value.length <= 10 ? "***" : `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function sanitizeGranotLifecycleEventDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!details) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    const normalized = key.toLowerCase();
    if (FORBIDDEN_DETAIL_KEYS.has(normalized)) continue;
    if (!ALLOWED_DETAIL_KEYS.has(normalized)) continue;
    if (value === undefined) continue;
    if (typeof value === "string") {
      if (normalized.endsWith("_id") || normalized === "scope_ref") {
        out[normalized] = maskLifecycleId(value) ?? "***";
        continue;
      }
      if (value.length > 80) continue;
      out[normalized] = value;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      out[normalized] = value;
      continue;
    }
    if (typeof value === "boolean") {
      out[normalized] = value;
      continue;
    }
  }
  return out;
}

/**
 * Best-effort lifecycle emission. Never throws. Does not populate lead/contact
 * columns. Instrumentation failure cannot change a business outcome.
 */
export async function emitGranotLifecycleEvent(
  input: GranotLifecycleEmitInput,
): Promise<void> {
  try {
    const eventKey = normalizeGranotLifecycleEventKey(input.eventKey);
    if (!isGranotLifecycleCatalogKey(eventKey)) {
      return;
    }
    const details = sanitizeGranotLifecycleEventDetails(input.details);
    await recordOperationalEvent({
      level: input.level ?? "info",
      eventKey,
      category: input.category ?? "admin",
      workflow: input.workflow ?? "granot_lifecycle",
      summary: input.summary,
      details,
      entity: input.entity
        ? { type: input.entity.type, id: maskLifecycleId(input.entity.id) ?? "***" }
        : undefined,
      route: input.route,
      method: input.method,
      statusCode: input.statusCode,
      durationMs: input.durationMs,
      requestId: input.requestId,
      dedupeKey: input.dedupeKey,
      autoResolveKey: input.autoResolveKey,
      notificationCandidate: false,
      reportable: true,
      ownerVisible: false,
      piiPolicy: input.piiPolicy ?? "none",
    });
  } catch {
    // Best-effort: never roll back or fail the caller.
  }
}

export function ownerCommandConflictCode(error: unknown): string | null {
  if (error instanceof DomainCommandIdempotencyConflictError) {
    return GRANOT_LIFECYCLE_ERROR_CODES.DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT;
  }
  if (isGranotLifecycleError(error)) {
    if ((OWNER_COMMAND_CONFLICT_CODES as readonly string[]).includes(error.code)) {
      return error.code;
    }
  }
  return null;
}

export async function observeGranotOwnerCommandConflict(error: unknown): Promise<void> {
  const code = ownerCommandConflictCode(error);
  if (!code) return;
  incrementGranotLifecycleCommandConflicts(code);
  await emitGranotLifecycleEvent({
    level: "warn",
    eventKey: "granot_lifecycle.owner_command.conflict",
    category: "admin",
    summary: "Granot lifecycle owner command conflicted.",
    details: { code },
    piiPolicy: "none",
  });
}

export async function observeGranotOwnerCommandResult(input: {
  replayed: boolean;
  command: string;
  case_kind?: "booking" | "release";
  case_resolved?: boolean;
  discrepancy_kind?: "booking" | "release";
  discrepancy_resolved?: boolean;
  duration_ms?: number;
}): Promise<void> {
  await emitGranotLifecycleEvent({
    eventKey: input.replayed
      ? "granot_lifecycle.owner_command.replayed"
      : "granot_lifecycle.owner_command.applied",
    category: "admin",
    summary: input.replayed
      ? "Granot lifecycle owner command replayed."
      : "Granot lifecycle owner command applied.",
    details: {
      command: input.command,
      replayed: input.replayed,
      ...(input.case_kind ? { kind: input.case_kind } : {}),
      ...(input.discrepancy_kind ? { kind: input.discrepancy_kind } : {}),
      ...(input.duration_ms != null ? { duration_ms: input.duration_ms } : {}),
    },
  });
  if (input.replayed) return;
  if (input.case_resolved && input.case_kind) {
    await emitGranotLifecycleEvent({
      eventKey: `granot_lifecycle.${input.case_kind}_case.resolved`,
      category: "admin",
      summary: `Granot ${input.case_kind} reconciliation case resolved.`,
      details: { kind: input.case_kind, command: input.command },
    });
  }
  if (input.discrepancy_resolved && input.discrepancy_kind) {
    await emitGranotLifecycleEvent({
      eventKey: `granot_lifecycle.${input.discrepancy_kind}_discrepancy.resolved`,
      category: "admin",
      summary: `Granot ${input.discrepancy_kind} discrepancy resolved.`,
      details: { kind: input.discrepancy_kind, command: input.command },
    });
  }
}
