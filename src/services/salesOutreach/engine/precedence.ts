/**
 * Deterministic precedence (P06f): authoritative closure → channel restriction → explicit human
 * schedule → accepted-priority routine cadence. The daily goal never overrides any of them.
 *
 * In the evaluator this order is realized as: closure periods end every routine requirement and cancel
 * pending callbacks (no reopening); restriction waivers/blocks are applied before callback suspension;
 * callbacks suspend routine calls; routine cadence comes last. Ties between terminations at the same
 * instant keep the first recorded, which follows this order.
 */
import type { EnginePolicyPeriod, EngineSubjectFacts, OutreachWorkflow, SubjectEngineState } from "./types";

export const PRECEDENCE = ["authoritative_closure", "channel_restriction", "explicit_human_schedule", "accepted_priority_routine_cadence"] as const;

export interface TimedPeriod extends EnginePolicyPeriod {
  startMs: number;
  /** Infinity when active. */
  endMs: number;
}

export function timedPeriods(periods: readonly EnginePolicyPeriod[]): TimedPeriod[] {
  const sorted = periods
    .map((p) => ({ ...p, startMs: Date.parse(p.started_at), endMs: p.ended_at === null ? Number.POSITIVE_INFINITY : Date.parse(p.ended_at) }))
    .filter((p) => Number.isFinite(p.startMs))
    .sort((a, b) => a.startMs - b.startMs || a.period_id.localeCompare(b.period_id));
  // A period implicitly ends when the next one starts (one active period per subject).
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const next = sorted[i + 1]!;
    if (sorted[i]!.endMs > next.startMs) sorted[i]!.endMs = next.startMs;
  }
  return sorted;
}

export function periodAt(periods: readonly TimedPeriod[], ms: number): TimedPeriod | null {
  for (let i = periods.length - 1; i >= 0; i -= 1) {
    const p = periods[i]!;
    if (p.startMs <= ms && ms < p.endMs) return p;
  }
  return null;
}

/** First instant an authoritative closure applies, if any. */
export function closureInstant(subject: EngineSubjectFacts, periods: readonly TimedPeriod[]): number | null {
  const closedPeriod = periods.find((p) => p.workflow === "closed");
  const candidates: number[] = [];
  if (closedPeriod) candidates.push(closedPeriod.startMs);
  if (subject.status === "closed" && subject.closed_at !== null) {
    const ms = Date.parse(subject.closed_at);
    if (Number.isFinite(ms)) candidates.push(ms);
  }
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

export function subjectState(subject: EngineSubjectFacts, current: TimedPeriod | null, closedAtOrBefore: boolean, hasAge: boolean): SubjectEngineState {
  if (closedAtOrBefore || subject.status === "closed") return "closed";
  if (subject.status === "review" || current === null) return "review";
  const workflow: OutreachWorkflow = current.workflow;
  if (workflow === "closed") return "closed";
  if (workflow === "discretion") return "no_routine_cadence";
  if (workflow === "none") return "no_policy_configured";
  if (workflow === "new" && !hasAge) return "review";
  return "active";
}
