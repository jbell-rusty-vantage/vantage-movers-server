import { payloadHash } from "../transactions";
import { customerEvidenceDigest } from "./build";
import { emptyTrimState, renderWith, sizeText, type TrimState } from "./render";
import { CASE_FILE_BUDGET, type CaseFile, type CaseFileBudget, type RenderedCaseFile, type TrimStep } from "./types";

/**
 * F7 budget (spec §4.8), in UTF-8 bytes of the rendered text. At or below the soft 60 KB nothing is
 * trimmed. Above it, the steps below run in this order, item by item (oldest first), until the text
 * is at most 60 KB or only never-trim content remains:
 *
 *   1. older digests keep only the overview sentence   4. Owner notes beyond the newest 5
 *   2. older digests drop to fact lines                 5. the three newest non-focus Full calls → 1
 *   3. attempt lines older than 30 days                 6. resolved/retracted prior findings
 *
 * Never trimmed: §1, §2, §3, §5, Lead arrivals, attachments, Bookings, cancellations, closures, focus
 * calls at full depth, the rolling summary. Above the hard 100 KB after all steps, the file is still
 * rendered and `over_hard_budget` is true. §7 states the counts per step and the final size.
 */
const bytes = (text: string) => Buffer.byteLength(text, "utf8");
const RESOLVED_REVIEW_STATES = new Set(["confirmed", "corrected", "retracted", "resolved"]);
const OWNER_NOTES_KEPT = 5;

type Candidate = { step: TrimStep; apply: (state: TrimState) => void };

/** Every trim action in spec order, oldest first within a step. Pure. */
export function trimCandidates(file: CaseFile): Candidate[] {
  const blocks = file.timeline.flatMap(item => item.calls);
  const digests = blocks.filter(b => b.tier === "digest" && !b.focus).sort((a, b) => a.c - b.c);
  const out: Candidate[] = [];
  for (const b of digests) if (b.digest.outcome) out.push({ step: "digest_overview_only", apply: s => { s.overview_only.add(b.conversation_id); } });
  for (const b of digests) out.push({ step: "digest_to_fact", apply: s => { s.to_fact.add(b.conversation_id); } });
  for (const item of file.timeline) if (item.old_attempt && !item.protected) out.push({ step: "old_attempts_dropped", apply: s => { s.dropped_events.add(item.event_id); } });
  const notes = file.timeline.filter(i => i.owner_note && !i.protected);
  for (const item of notes.slice(0, Math.max(0, notes.length - OWNER_NOTES_KEPT))) out.push({ step: "owner_notes_dropped", apply: s => { s.dropped_events.add(item.event_id); } });
  const full = blocks.filter(b => b.tier === "full" && !b.focus && b.full_rank !== null && b.full_rank > 0).sort((a, b) => (b.full_rank ?? 0) - (a.full_rank ?? 0));
  for (const b of full) out.push({ step: "full_to_digest", apply: s => { s.full_to_digest.add(b.conversation_id); } });
  const resolved = file.prior.findings.filter(f => f.review_state && RESOLVED_REVIEW_STATES.has(f.review_state)).sort((a, b) => b.p - a.p);
  for (const f of resolved) out.push({ step: "resolved_prior_findings_dropped", apply: s => { s.dropped_prior.add(f.p); } });
  return out;
}

function finalize(file: CaseFile, state: TrimState, budget: CaseFileBudget): { text: string; size: number } {
  // The §7 line states the size of the whole text, itself included; two passes settle the digits.
  let size = 0, text = "";
  for (let pass = 0; pass < 4; pass++) {
    const over = size > budget.hard_bytes ? " Over the hard budget: only never-trimmed content remains." : "";
    text = renderWith(file, state, `Size ${sizeText(size)}.${over}`);
    const next = bytes(text);
    if (next === size) break;
    size = next;
  }
  return { text, size: bytes(text) };
}

export function applyCaseFileBudget(file: CaseFile, budget: CaseFileBudget = CASE_FILE_BUDGET): RenderedCaseFile {
  const state = emptyTrimState();
  let current = finalize(file, state, budget);
  if (current.size > budget.soft_bytes) {
    for (const candidate of trimCandidates(file)) {
      candidate.apply(state);
      state.counts[candidate.step] += 1;
      current = finalize(file, state, budget);
      if (current.size <= budget.soft_bytes) break;
    }
  }
  const trimmed_steps = (Object.keys(state.counts) as TrimStep[]).filter(step => state.counts[step] > 0).map(step => ({ step, count: state.counts[step] }));
  return { text: current.text, bytes: current.size, digest: payloadHash(current.text), customer_evidence_digest: customerEvidenceDigest(file),
    trimmed_steps, over_hard_budget: current.size > budget.hard_bytes };
}

/** `renderCaseFile(caseFile) → string` (spec §4.1): the budgeted text. Pure and byte-stable. */
export const renderCaseFile = (file: CaseFile, budget: CaseFileBudget = CASE_FILE_BUDGET) => applyCaseFileBudget(file, budget).text;
