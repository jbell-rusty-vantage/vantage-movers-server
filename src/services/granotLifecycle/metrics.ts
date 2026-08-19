import {
  SYNCHRONIZATION_OUTCOMES,
  SYNCHRONIZATION_REASON_CODES,
} from "../../models/granotLifecycleSchemas";
import { OBSERVATION_CHANNELS } from "../../models/granotLifecycleSchemas";
import type {
  ObservationChannel,
  SynchronizationOutcome,
  SynchronizationReasonCode,
} from "./types";
import type { GranotBookingReconciliationCaseDocument } from "../../models/GranotBookingReconciliationCase";

export type GranotLifecycleReceiptMetricLabels = {
  channel: string;
  event_class: string;
};

export type GranotLifecycleDecisionMetricLabels = {
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  channel: ObservationChannel;
};

const receiptsTotal = new Map<string, number>();
let captureFailuresTotal = 0;
let queuePublishFailuresTotal = 0;
const decisionsTotal = new Map<string, number>();
const captureToDecisionMs: number[] = [];
let activationsTotal = 0;
let queueDue = 0;
let oldestDueSeconds = 0;
let claimRecoveriesTotal = 0;
const technicalRetriesTotal = new Map<string, number>();
const deadLettersTotal = new Map<string, number>();
const openBookingCases = new Map<GranotBookingReconciliationCaseDocument["mode"], number>();

function boundedErrorCode(code: string): string | null {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(code)) {
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

function isBoundedDecisionLabel(
  labels: GranotLifecycleDecisionMetricLabels,
): boolean {
  return (
    (SYNCHRONIZATION_OUTCOMES as readonly string[]).includes(labels.outcome) &&
    (SYNCHRONIZATION_REASON_CODES as readonly string[]).includes(labels.reason_code) &&
    (OBSERVATION_CHANNELS as readonly string[]).includes(labels.channel)
  );
}

export function incrementGranotLifecycleReceiptsTotal(
  labels: GranotLifecycleReceiptMetricLabels,
): void {
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
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return;
  }
  captureToDecisionMs.push(durationMs);
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

export function setGranotLifecycleOpenBookingCases(
  mode: GranotBookingReconciliationCaseDocument["mode"],
  count: number,
): void {
  openBookingCases.set(
    mode,
    Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
  );
}

export function getGranotLifecycleOpenBookingCases(
  mode: GranotBookingReconciliationCaseDocument["mode"],
): number {
  return openBookingCases.get(mode) ?? 0;
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

export function resetGranotLifecycleMetrics(): void {
  receiptsTotal.clear();
  captureFailuresTotal = 0;
  queuePublishFailuresTotal = 0;
  decisionsTotal.clear();
  captureToDecisionMs.length = 0;
  activationsTotal = 0;
  queueDue = 0;
  oldestDueSeconds = 0;
  claimRecoveriesTotal = 0;
  technicalRetriesTotal.clear();
  deadLettersTotal.clear();
  openBookingCases.clear();
}
