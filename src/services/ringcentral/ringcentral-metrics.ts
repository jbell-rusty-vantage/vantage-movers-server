/**
 * Final-spec Section 33 RingCentral source metrics.
 *
 * These are process-local counters/samples in the same shape the Granot
 * lifecycle metrics helpers already use. Operational Events remain the durable
 * operational record; Unit 30 owns aggregation, the health projection, and
 * alerting. This module only guarantees the exact metric names, a closed label
 * set, and that no caller, payload, credential, or provider content can enter
 * a label.
 *
 *   ringcentral_call_log_runtime_ms
 *   ringcentral_adoptions_total{outcome}
 *   ringcentral_call_log_lease_contention_total
 */

/** Closed outcome label set for `ringcentral_adoptions_total`. */
export const RINGCENTRAL_ADOPTION_OUTCOMES = [
  "adopted",
  "conflict",
  "not_found",
  "ineligible",
  "disabled",
] as const;

export type RingCentralAdoptionOutcome =
  (typeof RINGCENTRAL_ADOPTION_OUTCOMES)[number];

const callLogRuntimeMs: number[] = [];
const adoptionsTotal = new Map<RingCentralAdoptionOutcome, number>();
let callLogLeaseContentionTotal = 0;

export function recordRingCentralCallLogRuntimeMs(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return;
  }
  callLogRuntimeMs.push(Math.floor(durationMs));
}

export function incrementRingCentralAdoptionsTotal(
  outcome: string,
  amount = 1,
): void {
  if (!(RINGCENTRAL_ADOPTION_OUTCOMES as readonly string[]).includes(outcome)) {
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return;
  }
  const label = outcome as RingCentralAdoptionOutcome;
  adoptionsTotal.set(label, (adoptionsTotal.get(label) ?? 0) + Math.floor(amount));
}

export function incrementRingCentralCallLogLeaseContentionTotal(): void {
  callLogLeaseContentionTotal += 1;
}

export function getRingCentralCallLogRuntimeMsSamples(): readonly number[] {
  return callLogRuntimeMs;
}

export function getRingCentralAdoptionsTotal(
  outcome: RingCentralAdoptionOutcome,
): number {
  return adoptionsTotal.get(outcome) ?? 0;
}

export function getRingCentralCallLogLeaseContentionTotal(): number {
  return callLogLeaseContentionTotal;
}

export function resetRingCentralMetrics(): void {
  callLogRuntimeMs.length = 0;
  adoptionsTotal.clear();
  callLogLeaseContentionTotal = 0;
}
