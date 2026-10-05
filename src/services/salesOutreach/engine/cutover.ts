/**
 * Prospective cutover (P10a). The subject's fixed activation boundary is persisted at enrollment so a
 * retry never reprices it. Before it: no new-policy requirement, miss or catch-up debt. Existing New
 * Leads get the partial-day activation allowance (reentry.ts, `start_kind: "activation"`), existing
 * Quoted Leads keep verified human dates (quoted.ts), and pending verified human callbacks stay; a
 * callback whose appointment was already past at activation goes to review without penalty.
 */
import type { WorkingObligation } from "./obligation";

/** Drops routine requirements due before activation; marks pre-activation past-due callbacks for review. */
export function applyCutoverGuard(activationMs: number, obligations: WorkingObligation[]): WorkingObligation[] {
  const kept: WorkingObligation[] = [];
  for (const ob of obligations) {
    if (ob.kind === "callback") {
      if (ob.opens < activationMs) ob.terminations.unshift({ at: ob.opens, outcome: "legacy_review" });
      kept.push(ob);
      continue;
    }
    if (ob.due !== null && ob.due < activationMs) continue;
    if (ob.opens < activationMs && ob.kind !== "initial_response") ob.opens = activationMs;
    kept.push(ob);
  }
  return kept;
}
