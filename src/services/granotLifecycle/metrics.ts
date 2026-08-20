import {
  OBSERVATION_CHANNELS,
  ROUTE_EVENT_CLASSES,
  SYNCHRONIZATION_OUTCOMES,
  SYNCHRONIZATION_REASON_CODES,
} from "../../models/granotLifecycleSchemas";
import { BOOKING_DISCREPANCY_REASON_CODES } from "../../models/GranotBookingDiscrepancy";
import { RELEASE_DISCREPANCY_REASON_CODES } from "../../models/GranotReleaseDiscrepancy";
import type {
  GranotDiscrepancyReasonCode,
  ObservationChannel,
  SynchronizationOutcome,
  SynchronizationReasonCode,
} from "./types";

export const GRANOT_LIFECYCLE_SECTION_33_METRIC_NAMES = [
  "granot_lifecycle_receipts_total",
  "granot_lifecycle_queue_due",
  "granot_lifecycle_oldest_due_seconds",
  "granot_lifecycle_claim_recoveries_total",
  "granot_lifecycle_technical_retries_total",
  "granot_lifecycle_dead_letters_total",
  "granot_lifecycle_decisions_total",
  "granot_lifecycle_capture_to_decision_ms",
  "granot_lifecycle_decision_to_effect_ms",
  "granot_lifecycle_open_cases",
  "granot_lifecycle_open_discrepancies",
  "granot_lifecycle_command_conflicts_total",
  "ringcentral_call_log_runtime_ms",
  "ringcentral_adoptions_total",
  "ringcentral_call_log_lease_contention_total",
] as const;

export const GRANOT_LIFECYCLE_RECEIPT_EVENT_CLASSES = [
  ...ROUTE_EVENT_CLASSES,
  "none",
] as const;

export const GRANOT_LIFECYCLE_CASE_KINDS = ["booking", "release"] as const;
export const GRANOT_LIFECYCLE_CASE_MODES = [
  "create_missing_booking",
  "review_existing_booking",
  "create_referral_booking",
  "release",
] as const;
export const GRANOT_LIFECYCLE_DISCREPANCY_REASON_CODES = [
  ...BOOKING_DISCREPANCY_REASON_CODES,
  ...RELEASE_DISCREPANCY_REASON_CODES,
] as const;

export type GranotLifecycleReceiptMetricLabels = {
  channel: string;
  event_class: string;
};

export type GranotLifecycleDecisionMetricLabels = {
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  channel: ObservationChannel;
};

export type GranotLifecycleCaseKind = (typeof GRANOT_LIFECYCLE_CASE_KINDS)[number];
export type GranotLifecycleCaseMode = (typeof GRANOT_LIFECYCLE_CASE_MODES)[number];

const receiptsTotal = new Map<string, number>();
let captureFailuresTotal = 0;
let queuePublishFailuresTotal = 0;
const decisionsTotal = new Map<string, number>();
const captureToDecisionMs: number[] = [];
const decisionToEffectMs: number[] = [];
let activationsTotal = 0;
let queueDue = 0;
let oldestDueSeconds = 0;
let claimRecoveriesTotal = 0;
const technicalRetriesTotal = new Map<string, number>();
const deadLettersTotal = new Map<string, number>();
const openCases = new Map<string, number>();
const openDiscrepancies = new Map<string, number>();
const commandConflictsTotal = new Map<string, number>();

function boundedErrorCode(code: string): string | null {
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(code)) {
    return null;
  }
  return code;
}

function receiptKey(labels: GranotLifecycleReceiptMetricLabels): string {
  return `${labels.channel}|${labels.event_class}`;
}

function decisionKey(labels: GranotLifecycleDecisionMetricLabels): string {
  return `${labels.outcome}|${labels.reason_code}|${labels.channel}`;
}

function caseKey(kind: string, mode: string): string {
  return `${kind}|${mode}`;
}

function discrepancyKey(kind: string, reasonCode: string): string {
  return `${kind}|${reasonCode}`;
}

function isBoundedReceiptLabel(labels: GranotLifecycleReceiptMetricLabels): boolean {
  return (
    (OBSERVATION_CHANNELS as readonly string[]).includes(labels.channel) &&
    (GRANOT_LIFECYCLE_RECEIPT_EVENT_CLASSES as readonly string[]).includes(labels.event_class)
  );
}

function isBoundedDecisionLabel(
  labels: GranotLifecycleDecisionMetricLabels,
): boolean {
  return (
    (SYNCHRONIZATION_OUTCOMES as readonly string[]).includes(labels.outcome) &&
    (SYNCHRONIZATION_REASON_CODES as readonly string[]).includes(labels.reason_code) &&
    (OBSERVATION_CHANNELS as readonly string[]).includes(labels.channel)
  );
}

function recordFiniteDuration(samples: number[], durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return;
  }
  samples.push(durationMs);
}

export function incrementGranotLifecycleReceiptsTotal(
  labels: GranotLifecycleReceiptMetricLabels,
): void {
  if (!isBoundedReceiptLabel(labels)) {
    return;
  }
  const key = receiptKey(labels);
  receiptsTotal.set(key, (receiptsTotal.get(key) ?? 0) + 1);
}

export function incrementGranotLifecycleCaptureFailures(): void {
  captureFailuresTotal += 1;
}

export function incrementGranotLifecycleQueuePublishFailures(): void {
  queuePublishFailuresTotal += 1;
}

export function incrementGranotLifecycleDecisionsTotal(
  labels: GranotLifecycleDecisionMetricLabels,
): void {
  if (!isBoundedDecisionLabel(labels)) {
    return;
  }
  const key = decisionKey(labels);
  decisionsTotal.set(key, (decisionsTotal.get(key) ?? 0) + 1);
}

export function recordGranotLifecycleCaptureToDecisionMs(durationMs: number): void {
  recordFiniteDuration(captureToDecisionMs, durationMs);
}

export function recordGranotLifecycleDecisionToEffectMs(durationMs: number): void {
  recordFiniteDuration(decisionToEffectMs, durationMs);
}

export function incrementGranotLifecycleActivationsTotal(): void {
  activationsTotal += 1;
}

export function setGranotLifecycleQueueDue(count: number): void {
  queueDue = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function setGranotLifecycleOldestDueSeconds(seconds: number): void {
  oldestDueSeconds =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
}

export function incrementGranotLifecycleClaimRecoveries(): void {
  claimRecoveriesTotal += 1;
}

export function incrementGranotLifecycleTechnicalRetries(code: string): void {
  const bounded = boundedErrorCode(code);
  if (!bounded) {
    return;
  }
  technicalRetriesTotal.set(bounded, (technicalRetriesTotal.get(bounded) ?? 0) + 1);
}

export function incrementGranotLifecycleDeadLetters(code: string): void {
  const bounded = boundedErrorCode(code);
  if (!bounded) {
    return;
  }
  deadLettersTotal.set(bounded, (deadLettersTotal.get(bounded) ?? 0) + 1);
}

export function setGranotLifecycleOpenCases(
  kind: GranotLifecycleCaseKind,
  mode: GranotLifecycleCaseMode,
  count: number,
): void {
  if (
    !(GRANOT_LIFECYCLE_CASE_KINDS as readonly string[]).includes(kind) ||
    !(GRANOT_LIFECYCLE_CASE_MODES as readonly string[]).includes(mode)
  ) {
    return;
  }
  openCases.set(
    caseKey(kind, mode),
    Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
  );
}

export function setGranotLifecycleOpenBookingCases(
  mode: Exclude<GranotLifecycleCaseMode, "release">,
  count: number,
): void {
  setGranotLifecycleOpenCases("booking", mode, count);
}

export function setGranotLifecycleOpenDiscrepancies(
  kind: GranotLifecycleCaseKind,
  reasonCode: GranotDiscrepancyReasonCode | string,
  count: number,
): void {
  if (
    !(GRANOT_LIFECYCLE_CASE_KINDS as readonly string[]).includes(kind) ||
    !(GRANOT_LIFECYCLE_DISCREPANCY_REASON_CODES as readonly string[]).includes(reasonCode)
  ) {
    return;
  }
  openDiscrepancies.set(
    discrepancyKey(kind, reasonCode),
    Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
  );
}

export function incrementGranotLifecycleCommandConflicts(code: string): void {
  const bounded = boundedErrorCode(code);
  if (!bounded) {
    return;
  }
  commandConflictsTotal.set(bounded, (commandConflictsTotal.get(bounded) ?? 0) + 1);
}

export function getGranotLifecycleOpenCases(
  kind: GranotLifecycleCaseKind,
  mode: GranotLifecycleCaseMode,
): number {
  return openCases.get(caseKey(kind, mode)) ?? 0;
}

export function getGranotLifecycleOpenBookingCases(
  mode: Exclude<GranotLifecycleCaseMode, "release">,
): number {
  return getGranotLifecycleOpenCases("booking", mode);
}

export function getGranotLifecycleOpenDiscrepancies(
  kind: GranotLifecycleCaseKind,
  reasonCode: string,
): number {
  return openDiscrepancies.get(discrepancyKey(kind, reasonCode)) ?? 0;
}

export function getGranotLifecycleReceiptsTotal(
  labels: GranotLifecycleReceiptMetricLabels,
): number {
  return receiptsTotal.get(receiptKey(labels)) ?? 0;
}

export function getGranotLifecycleCaptureFailures(): number {
  return captureFailuresTotal;
}

export function getGranotLifecycleQueuePublishFailures(): number {
  return queuePublishFailuresTotal;
}

export function getGranotLifecycleDecisionsTotal(
  labels: GranotLifecycleDecisionMetricLabels,
): number {
  return decisionsTotal.get(decisionKey(labels)) ?? 0;
}

export function getGranotLifecycleCaptureToDecisionSamples(): readonly number[] {
  return captureToDecisionMs;
}

export function getGranotLifecycleDecisionToEffectSamples(): readonly number[] {
  return decisionToEffectMs;
}

export function getGranotLifecycleActivationsTotal(): number {
  return activationsTotal;
}

export function getGranotLifecycleQueueDue(): number {
  return queueDue;
}

export function getGranotLifecycleOldestDueSeconds(): number {
  return oldestDueSeconds;
}

export function getGranotLifecycleClaimRecoveriesTotal(): number {
  return claimRecoveriesTotal;
}

export function getGranotLifecycleTechnicalRetriesTotal(code: string): number {
  return technicalRetriesTotal.get(code) ?? 0;
}

export function getGranotLifecycleDeadLettersTotal(code: string): number {
  return deadLettersTotal.get(code) ?? 0;
}

export function getGranotLifecycleCommandConflictsTotal(code: string): number {
  return commandConflictsTotal.get(code) ?? 0;
}

export function resetGranotLifecycleMetrics(): void {
  receiptsTotal.clear();
  captureFailuresTotal = 0;
  queuePublishFailuresTotal = 0;
  decisionsTotal.clear();
  captureToDecisionMs.length = 0;
  decisionToEffectMs.length = 0;
  activationsTotal = 0;
  queueDue = 0;
  oldestDueSeconds = 0;
  claimRecoveriesTotal = 0;
  technicalRetriesTotal.clear();
  deadLettersTotal.clear();
  openCases.clear();
  openDiscrepancies.clear();
  commandConflictsTotal.clear();
}
