import {
  resolveRingCentralInboundRoute,
  type RingCentralRouteResolution,
  type RingCentralRouteSnapshot,
} from "../operationsRegistry";
import { normalizePhoneNumberToE164Like } from "./phone-normalization";
import type { RingCentralQualifiedCall } from "./ringcentral-call-lead-ingest.service";
import {
  CALL_LEAD_MINIMUM_ELAPSED_SECONDS,
  qualifyRingCentralCall,
} from "./call-qualification";

/**
 * Shared vetting for RingCentral *Call Log* records (the cron/polling path).
 *
 * This mirrors the qualification rules applied to webhook sessions so both
 * strategies agree on what a lead is:
 *   - Inbound
 *   - `to.phoneNumber` (on the record or any leg) matches a mapped toll-free
 *   - Explicitly finished caller-side record (never a partial queue snapshot)
 *   - Parent call elapsed duration >= 120s; answering is not required
 *   - Caller phone present
 *
 * RingCentral exposes no webhook for Call Log, so this is consumed by the
 * scheduled sync. The probe script (`ringcentral-call-lead-api-probe.ts`)
 * uses the same primitives for offline validation.
 */
const ANSWERED_RESULTS = new Set([
  "Accepted",
  "Completed",
  "Call connected",
  "Connected",
  "Answered",
]);

export type RingCentralCallLogVetResult = {
  callLogId: string | null;
  sessionId: string | null;
  telephonySessionId: string | null;
  startTime: Date | null;
  durationSeconds: number | null;
  direction: string | null;
  result: string | null;
  callerPhoneNumber: string | null;
  callerName: string | null;
  targetPhoneNumber: string | null;
  targetName: string | null;
  sourceLabel: string | null;
  sourceCompany: string | null;
  routeResolution: RingCentralRouteResolution | null;
  matchedTargetNumber: boolean;
  answered: boolean;
  overMinimumDuration: boolean;
  qualifies: boolean;
  rejectionReasons: string[];
};

export function vetRingCentralCallLogRecord(
  record: unknown,
  snapshot: RingCentralRouteSnapshot = EMPTY_ROUTE_SNAPSHOT,
): RingCentralCallLogVetResult {
  const root = asRecord(record);
  const legs = getLegs(root);
  const allParts = [root, ...legs].filter(
    (part): part is Record<string, unknown> => part !== null,
  );

  const startTime = valueToDate(root?.startTime);
  const from = asRecord(root?.from);
  const caller = {
    phoneNumber: normalizePhoneNumberToE164Like(valueToString(from?.phoneNumber)),
    name: valueToString(from?.name),
  };
  const target = findTarget(allParts.filter((part) =>
    part === root || (
      valueToString(part.direction) === "Inbound" &&
      normalizePhoneNumberToE164Like(valueToString(asRecord(part.from)?.phoneNumber)) === caller.phoneNumber &&
      (!part.telephonySessionId || part.telephonySessionId === root?.telephonySessionId)
    )), snapshot, startTime);
  const targetPhoneNumber = target.phoneNumber;
  const resolution = target.resolution;
  const direction = valueToString(root?.direction);
  // A parent record spans one caller's call. Parallel/transfer legs must never
  // supply its duration. Prefer precise milliseconds over rounded seconds.
  const durationSeconds = readParentElapsedSeconds(root);
  const answered = isAnswered(root) || legs.some(isAnswered);
  const overMinimumDuration =
    durationSeconds !== null && durationSeconds >= CALL_LEAD_MINIMUM_ELAPSED_SECONDS;

  const { rejectionReasons } = qualifyRingCentralCall({
    direction,
    routeResolution: resolution,
    durationSeconds,
    callerPhoneNumber: caller.phoneNumber,
  });
  // Call Log may expose and later rewrite a still-running queue call. Absence
  // of the optional finished marker is unknown, not proof of completion. No
  // processed-call ledger is written until qualification succeeds; cron retries.
  if (root?.finished !== true) rejectionReasons.push("call_completion_unconfirmed");
  if (root?.type !== "Voice") rejectionReasons.push("not_voice");
  if (!startTime) rejectionReasons.push("missing_call_start_time");
  if (!valueToString(root?.id) && !valueToString(root?.telephonySessionId)) {
    rejectionReasons.push("missing_call_identity");
  }

  return {
    callLogId: valueToString(root?.id),
    sessionId: valueToString(root?.sessionId),
    telephonySessionId: valueToString(root?.telephonySessionId),
    startTime,
    durationSeconds,
    direction,
    result: valueToString(root?.result),
    callerPhoneNumber: caller.phoneNumber,
    callerName: caller.name,
    targetPhoneNumber,
    targetName: findTargetName(allParts, targetPhoneNumber),
    sourceLabel: resolution?.crm_label_snapshot ?? null,
    sourceCompany: resolution?.company_slug ?? null,
    routeResolution: resolution,
    matchedTargetNumber: resolution !== null,
    answered,
    overMinimumDuration,
    qualifies: rejectionReasons.length === 0,
    rejectionReasons,
  };
}

function readParentElapsedSeconds(root: Record<string, unknown> | null): number | null {
  if (root?.durationMs != null) {
    const milliseconds = valueToNumber(root.durationMs);
    return milliseconds === null ? null : milliseconds / 1000;
  }
  const seconds = valueToNumber(root?.duration);
  // Rounded 120 may really be 119.5 seconds. Wait for precise timing evidence.
  return seconds === CALL_LEAD_MINIMUM_ELAPSED_SECONDS ? null : seconds;
}

const EMPTY_ROUTE_SNAPSHOT: RingCentralRouteSnapshot = Object.freeze({
  version: 1,
  built_at: new Date(0),
  max_age_ms: 1,
  entries_by_phone: new Map(),
});

/** Both transports hand precisely the same final caller facts to shared ingest. */
export function qualifiedCallFromCallLog(
  vet: RingCentralCallLogVetResult,
  ingestionSource: RingCentralQualifiedCall["ingestionSource"],
): RingCentralQualifiedCall {
  if (!vet.qualifies || !vet.startTime || vet.durationSeconds === null ||
      !vet.routeResolution || !vet.sourceCompany || !vet.callerPhoneNumber) {
    throw new Error("Cannot ingest an unqualified RingCentral call");
  }
  return {
    ingestionSource,
    telephonySessionId: vet.telephonySessionId,
    sessionId: vet.sessionId,
    partyId: null,
    callLogId: vet.callLogId,
    sourceCompany: vet.sourceCompany,
    sourceLabel: vet.sourceLabel,
    routeResolution: vet.routeResolution,
    callerPhoneNumber: vet.callerPhoneNumber,
    callerName: vet.callerName,
    targetPhoneNumber: vet.targetPhoneNumber ?? "",
    targetName: vet.targetName,
    answeredAt: null, // Call Log startTime is not an answer timestamp.
    terminalAt: new Date(vet.startTime.getTime() + vet.durationSeconds * 1000),
    startTime: vet.startTime,
    durationSeconds: vet.durationSeconds,
    qualificationReason: "call_log_inbound_target_elapsed_at_least_120s",
  };
}

function findTarget(
  parts: Record<string, unknown>[],
  snapshot: RingCentralRouteSnapshot,
  startTime: Date | null,
): { phoneNumber: string | null; resolution: RingCentralRouteResolution | null } {
  let firstInboundTarget: string | null = null;
  for (const part of parts) {
    const to = asRecord(part.to);
    const normalized = normalizePhoneNumberToE164Like(valueToString(to?.phoneNumber));
    const resolution = startTime
      ? resolveRingCentralInboundRoute(snapshot, normalized, startTime)
      : null;
    if (normalized && resolution) {
      return { phoneNumber: normalized, resolution };
    }
    if (!firstInboundTarget && normalized) {
      firstInboundTarget = normalized;
    }
  }
  return { phoneNumber: firstInboundTarget, resolution: null };
}

function findTargetName(
  parts: Record<string, unknown>[],
  targetPhoneNumber: string | null,
): string | null {
  if (!targetPhoneNumber) {
    return null;
  }
  for (const part of parts) {
    const to = asRecord(part.to);
    const normalized = normalizePhoneNumberToE164Like(valueToString(to?.phoneNumber));
    if (normalized === targetPhoneNumber) {
      return valueToString(to?.name);
    }
  }
  return null;
}

function isAnswered(recordOrLeg: Record<string, unknown> | null): boolean {
  const result = valueToString(recordOrLeg?.result);
  return result !== null && ANSWERED_RESULTS.has(result);
}

function getLegs(record: Record<string, unknown> | null): Record<string, unknown>[] {
  const legs = record?.legs;
  if (!Array.isArray(legs)) {
    return [];
  }
  return legs
    .map((leg) => asRecord(leg))
    .filter((leg): leg is Record<string, unknown> => leg !== null);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function valueToString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function valueToNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function valueToDate(value: unknown): Date | null {
  const stringValue = valueToString(value);
  if (!stringValue) {
    return null;
  }
  const date = new Date(stringValue);
  return Number.isNaN(date.getTime()) ? null : date;
}
