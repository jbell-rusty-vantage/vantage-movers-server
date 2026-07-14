import { CALL_LEAD_MINIMUM_ANSWERED_SECONDS } from "./call-candidate-evaluator";
import {
  resolveRingCentralInboundSource,
  type SourceCompany,
} from "./call-lead-sources";
import { normalizePhoneNumberToE164Like } from "./phone-normalization";

/**
 * Shared vetting for RingCentral *Call Log* records (the cron/polling path).
 *
 * This mirrors the qualification rules applied to webhook sessions so both
 * strategies agree on what a lead is:
 *   - Inbound
 *   - `to.phoneNumber` (on the record or any leg) matches a mapped toll-free
 *   - Answered (a connected/completed result on the record or a leg)
 *   - Answered duration >= 120s
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
  sourceCompany: SourceCompany | null;
  matchedTargetNumber: boolean;
  answered: boolean;
  overMinimumDuration: boolean;
  qualifies: boolean;
  rejectionReasons: string[];
};

export function vetRingCentralCallLogRecord(
  record: unknown,
): RingCentralCallLogVetResult {
  const root = asRecord(record);
  const legs = getLegs(root);
  const allParts = [root, ...legs].filter(
    (part): part is Record<string, unknown> => part !== null,
  );

  const targetPhoneNumber = findTargetPhoneNumber(allParts);
  const source = resolveRingCentralInboundSource(targetPhoneNumber);
  const direction = valueToString(root?.direction);
  const durationSeconds = maxNumber(
    valueToNumber(root?.duration),
    Math.floor((valueToNumber(root?.durationMs) ?? 0) / 1000) || null,
    ...legs.map((leg) => valueToNumber(leg?.duration)),
  );
  const answered = isAnswered(root) || legs.some(isAnswered);
  const caller = findCaller(root, legs);
  const overMinimumDuration =
    durationSeconds !== null && durationSeconds >= CALL_LEAD_MINIMUM_ANSWERED_SECONDS;

  const rejectionReasons: string[] = [];
  if (direction !== "Inbound") {
    rejectionReasons.push("not_inbound");
  }
  if (!targetPhoneNumber || !source) {
    rejectionReasons.push("target_number_not_matched");
  }
  if (!answered) {
    rejectionReasons.push("not_answered");
  }
  if (!overMinimumDuration) {
    rejectionReasons.push("under_120_seconds");
  }
  if (!caller.phoneNumber) {
    rejectionReasons.push("missing_caller_phone_number");
  }

  return {
    callLogId: valueToString(root?.id),
    sessionId: valueToString(root?.sessionId),
    telephonySessionId: valueToString(root?.telephonySessionId),
    startTime: valueToDate(root?.startTime),
    durationSeconds,
    direction,
    result: valueToString(root?.result),
    callerPhoneNumber: caller.phoneNumber,
    callerName: caller.name,
    targetPhoneNumber,
    targetName: findTargetName(allParts, targetPhoneNumber),
    sourceLabel: source?.sourceLabel ?? null,
    sourceCompany: source?.sourceCompany ?? null,
    matchedTargetNumber: targetPhoneNumber !== null && source !== null,
    answered,
    overMinimumDuration,
    qualifies: rejectionReasons.length === 0,
    rejectionReasons,
  };
}

function findTargetPhoneNumber(parts: Record<string, unknown>[]): string | null {
  let firstInboundTarget: string | null = null;
  for (const part of parts) {
    const to = asRecord(part.to);
    const normalized = normalizePhoneNumberToE164Like(valueToString(to?.phoneNumber));
    if (normalized && resolveRingCentralInboundSource(normalized)) {
      return normalized;
    }
    if (!firstInboundTarget && normalized) {
      firstInboundTarget = normalized;
    }
  }
  return firstInboundTarget;
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

function findCaller(
  record: Record<string, unknown> | null,
  legs: Record<string, unknown>[],
): { phoneNumber: string | null; name: string | null } {
  const parts = [record, ...legs].filter(
    (part): part is Record<string, unknown> => part !== null,
  );
  const inboundParts = parts.filter(
    (part) => valueToString(part.direction) === "Inbound",
  );
  for (const part of inboundParts) {
    const from = asRecord(part.from);
    const phoneNumber = normalizePhoneNumberToE164Like(valueToString(from?.phoneNumber));
    if (phoneNumber) {
      return { phoneNumber, name: valueToString(from?.name) };
    }
  }

  const recordFrom = asRecord(record?.from);
  return {
    phoneNumber: normalizePhoneNumberToE164Like(valueToString(recordFrom?.phoneNumber)),
    name: valueToString(recordFrom?.name),
  };
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

function maxNumber(...values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => value !== null);
  if (numbers.length === 0) {
    return null;
  }
  return Math.max(...numbers);
}
