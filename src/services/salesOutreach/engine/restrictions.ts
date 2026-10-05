/**
 * Contact restrictions (P06c) and restricted-contact credit (P07g).
 *
 * - When a restriction takes effect, unfinished routine requirements of its channels are waived; no
 *   new routine requirement opens while it is active; earlier genuine misses stay.
 * - Ordinary quotas resume on the first working date on/after release when release is at/before that
 *   date's opening, otherwise the following working date. Contact is permitted immediately on release.
 * - The initial response pauses (handled by `blockIntervals` in the working-minute clock).
 * - A due callback whose appointment the restriction prevents becomes blocked — rescheduling needed.
 * - Contact made while restricted earns zero cadence and goal credit.
 */
import type { BusinessCalendar } from "./calendar";
import type { WorkingObligation } from "./obligation";
import type { Channel, EngineRestrictionInterval } from "./types";

export interface RestrictionWindow {
  restriction: EngineRestrictionInterval;
  startMs: number;
  /** Infinity when there is no release. */
  releaseMs: number;
  /** Opening of the date ordinary quotas resume (Infinity when unreleased). */
  resumeMs: number;
}

export function restrictionWindows(cal: BusinessCalendar, restrictions: readonly EngineRestrictionInterval[]): RestrictionWindow[] {
  return restrictions
    .map((restriction) => {
      const startMs = Date.parse(restriction.effective_at);
      const releaseMs = restriction.released_at === null ? Number.POSITIVE_INFINITY : Date.parse(restriction.released_at);
      return { restriction, startMs, releaseMs, resumeMs: resumeInstant(cal, releaseMs) };
    })
    .filter((w) => Number.isFinite(w.startMs) && w.releaseMs > w.startMs)
    .sort((a, b) => a.startMs - b.startMs);
}

/** P06c resume rule: release at/before opening resumes that working date, otherwise the next one. */
export function resumeInstant(cal: BusinessCalendar, releaseMs: number): number {
  if (!Number.isFinite(releaseMs)) return Number.POSITIVE_INFINITY;
  const date = cal.dateOf(releaseMs);
  if (cal.isWorkingDate(date) && releaseMs <= cal.opening(date)) return cal.opening(date);
  const next = cal.nextWorkingDateAfter(date);
  return next === null ? Number.POSITIVE_INFINITY : cal.opening(next);
}

export function covers(window: RestrictionWindow, channel: Channel): boolean {
  return window.restriction.channels.includes(channel);
}

export function activeRestrictionAt(windows: readonly RestrictionWindow[], channel: Channel, ms: number): RestrictionWindow | null {
  return windows.find((w) => covers(w, channel) && ms >= w.startMs && ms < w.releaseMs) ?? null;
}

/** Intervals during which calling is prohibited (pause the initial-response working-minute clock). */
export function blockIntervals(windows: readonly RestrictionWindow[], channel: Channel): Array<[number, number]> {
  return windows.filter((w) => covers(w, channel)).map((w) => [w.startMs, w.releaseMs] as [number, number]);
}

export function applyRestrictionWaivers(windows: readonly RestrictionWindow[], obligations: readonly WorkingObligation[]): void {
  for (const w of windows) {
    for (const ob of obligations) {
      if (!covers(w, ob.channel)) continue;
      if (ob.kind === "callback") {
        const due = ob.due ?? ob.opens;
        if (w.startMs <= due && w.releaseMs > ob.opens) {
          ob.terminations.push({ at: Math.max(w.startMs, ob.opens), outcome: "blocked_reschedule" });
        }
        continue;
      }
      if (ob.kind === "initial_response") continue; // paused, not waived
      if (ob.opens >= w.startMs && ob.opens < w.resumeMs) {
        ob.terminations.push({ at: ob.opens, outcome: "waived_restriction" });
      } else if (ob.opens < w.startMs && ob.closes > w.startMs) {
        // Open at the restriction start: waived when the deadline was still ahead; otherwise its genuine
        // miss stays and the window simply stops being creditable.
        ob.terminations.push({ at: w.startMs, outcome: "waived_restriction" });
      }
    }
  }
}
