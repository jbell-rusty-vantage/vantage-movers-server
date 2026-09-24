import type { CaseCallBlock, CaseFile, TrimStep } from "./types";

/**
 * Pure rendering (spec §4.3): fixed ASCII section headers in a fixed order, one line per fact.
 * The same `CaseFile` and trim state always render the same bytes. Nothing here reads a clock.
 */
export type TrimState = {
  /** Step 1: digests that keep only their overview sentence. */
  overview_only: Set<string>;
  /** Step 2: digests dropped to the call line. */
  to_fact: Set<string>;
  /** Steps 3–4: timeline events not rendered (old attempt lines, older Owner notes). */
  dropped_events: Set<string>;
  /** Step 5: non-focus Full calls rendered as digests. */
  full_to_digest: Set<string>;
  /** Step 6: resolved/retracted prior findings not rendered (P index). */
  dropped_prior: Set<number>;
  counts: Record<TrimStep, number>;
};
export const emptyTrimState = (): TrimState => ({ overview_only: new Set(), to_fact: new Set(), dropped_events: new Set(), full_to_digest: new Set(), dropped_prior: new Set(),
  counts: { digest_overview_only: 0, digest_to_fact: 0, old_attempts_dropped: 0, owner_notes_dropped: 0, full_to_digest: 0, resolved_prior_findings_dropped: 0 } });

export const TIMELINE_HEADER = "§4 TIMELINE   (oldest → newest; [Tn] = story index n; Cn = call_index n; times ET)";
export const PRIOR_HEADER = "§6 PRIOR ANALYSIS   (earlier model outputs — what was concluded before, not facts)";

function blockLines(block: CaseCallBlock, state: TrimState): string[] {
  const tier = block.tier === "full" && !state.full_to_digest.has(block.conversation_id) ? "full" : "digest";
  if (tier === "full") return [...block.full, ...block.evidence];
  if (state.to_fact.has(block.conversation_id)) return [];
  const lines = [block.digest.overview];
  if (block.digest.outcome && !state.overview_only.has(block.conversation_id)) lines.push(block.digest.outcome);
  return [...lines, ...block.evidence];
}

/** Everything but the §7 footer line, which the budget fills in once the size is known. */
export function renderBody(file: CaseFile, state: TrimState): string[] {
  const lines: string[] = [...file.header, "", ...file.who, "", ...file.origins, "", ...file.granot, "", TIMELINE_HEADER];
  for (const item of file.timeline) {
    if (state.dropped_events.has(item.event_id)) continue;
    lines.push(...item.lines);
    for (const block of item.calls) lines.push(...blockLines(block, state));
  }
  if (file.tail) lines.push(file.tail);
  lines.push("", ...file.open_work, "", PRIOR_HEADER);
  if (file.audience === "findings") {
    lines.push(...(file.prior.rolling.length ? file.prior.rolling : ["Rolling summary: none (no Number synthesis yet)."]));
    const findings = file.prior.findings.filter(f => !state.dropped_prior.has(f.p));
    lines.push(findings.length ? "Prior findings (not superseded; earlier model output):" : "Prior findings: none.");
    lines.push(...findings.map(f => f.text));
  }
  lines.push(...(file.prior.assessment.length ? file.prior.assessment : ["Move assessment: none published."]), ...file.prior.notes);
  lines.push("", "§7 THIS RUN", file.run.analyze);
  return lines;
}

const TRIM_LABELS: Record<TrimStep, [string, string]> = {
  digest_overview_only: ["digest to its overview sentence", "digests to their overview sentence"],
  digest_to_fact: ["digest to a fact line", "digests to fact lines"],
  old_attempts_dropped: ["attempt line older than 30 days", "attempt lines older than 30 days"],
  owner_notes_dropped: ["Owner note beyond the newest 5", "Owner notes beyond the newest 5"],
  full_to_digest: ["full summary to a digest", "full summaries to digests"],
  resolved_prior_findings_dropped: ["resolved or retracted prior finding", "resolved or retracted prior findings"],
};
export function trimmedText(state: TrimState): string {
  const parts = (Object.keys(TRIM_LABELS) as TrimStep[]).filter(step => state.counts[step] > 0)
    .map(step => `${state.counts[step]} ${TRIM_LABELS[step][state.counts[step] === 1 ? 0 : 1]}`);
  return parts.length ? `Trimmed: ${parts.join(", ")}.` : "Trimmed: none.";
}
export const sizeText = (bytes: number) => `${(bytes / 1000).toFixed(1)} KB`;

/** The whole text for a trim state; `footer` is the size/over-budget tail of the §7 coverage line. */
export function renderWith(file: CaseFile, state: TrimState, footer: string): string {
  return [...renderBody(file, state), `${file.run.coverage} ${trimmedText(state)} ${footer}`].join("\n");
}
