/**
 * Internal working model of one requirement while the evaluator runs. Exported shapes live in types.ts.
 */
import type { BusinessDate, Channel, ObligationKind, ObligationOutcome } from "./types";

/** A reason the obligation stops being creditable (no miss when it happens at or before the deadline). */
export interface Termination {
  at: number;
  outcome: Extract<ObligationOutcome, "waived_restriction" | "suspended_callback" | "superseded" | "cancelled" | "blocked_reschedule" | "legacy_review">;
}

export interface WorkingObligation {
  id: string;
  period_id: string;
  channel: Channel;
  kind: ObligationKind;
  date: BusinessDate;
  slot: number;
  opens: number;
  /** Null = deadline cannot be computed (initial response paused by an open-ended restriction). */
  due: number | null;
  /** End of the crediting window; Infinity = until fulfilled (initial response, callback). */
  closes: number;
  plan_id: string | null;
  terminations: Termination[];
  fulfilledAt: number | null;
  fulfilledBy: string | null;
}

export function makeObligation(fields: Omit<WorkingObligation, "terminations" | "fulfilledAt" | "fulfilledBy" | "id"> & { id?: string }): WorkingObligation {
  return {
    ...fields,
    id: fields.id ?? `${fields.period_id}:${fields.kind}:${fields.channel}:${fields.date}:${fields.slot}`,
    terminations: [],
    fulfilledAt: null,
    fulfilledBy: null,
  };
}

/** The earliest termination (ties keep the first recorded, which follows P06f precedence order). */
export function earliestTermination(ob: WorkingObligation): Termination | null {
  let best: Termination | null = null;
  for (const t of ob.terminations) if (best === null || t.at < best.at) best = t;
  return best;
}

/** Creditable at `t`: open, inside its window, not fulfilled and not terminated yet. */
export function isCreditableAt(ob: WorkingObligation, t: number): boolean {
  if (ob.fulfilledAt !== null || t < ob.opens || t >= ob.closes) return false;
  const term = earliestTermination(ob);
  return term === null || t < term.at;
}

/** Terminated at or before its deadline (and before any fulfillment): never a miss. */
export function terminatedBeforeDeadline(ob: WorkingObligation, asOf: number): Termination | null {
  const term = earliestTermination(ob);
  if (term === null || term.at > asOf) return null;
  if (ob.fulfilledAt !== null && ob.fulfilledAt <= term.at) return null;
  if (ob.due !== null && term.at > ob.due) return null;
  return term;
}
