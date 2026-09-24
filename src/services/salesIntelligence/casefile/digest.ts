import { redactTranscript } from "../../conversations/redaction";
import type { SummaryStep } from "../analysis/structuredContract";

/**
 * F7 tiered call depth (spec §4.6). A human conversation is a call with a completed summary.
 * Full: every focus call and the three newest other human conversations. Digest: older ones.
 * Fact: everything else (the call line only). `move_evidence` is never rendered for findings.
 */
export const FULL_NON_FOCUS = 3;
export const SAID_MAX = 30;
export const DIGEST_OVERVIEW_MAX = 200;
export const DIGEST_OUTCOME_MAX = 300;

export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
export const cleanText = (value: unknown, max = 4000): string => {
  if (value === null || value === undefined) return "";
  const text = redactTranscript(String(value)).text.replace(/\s+/g, " ").trim();
  return clip(text, max);
};

export type TierCall = { conversation_id: string; started_at: string; focus: boolean };
/** Tier per conversation: focus → full; the newest three others → full (rank 0 = newest); the rest → digest. */
export function assignTiers(calls: readonly TierCall[]): Map<string, { tier: "full" | "digest"; full_rank: number | null }> {
  const out = new Map<string, { tier: "full" | "digest"; full_rank: number | null }>();
  for (const call of calls) if (call.focus) out.set(call.conversation_id, { tier: "full", full_rank: null });
  const others = calls.filter(c => !c.focus).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at) || (a.conversation_id < b.conversation_id ? 1 : -1));
  others.forEach((call, index) => out.set(call.conversation_id, index < FULL_NON_FOCUS ? { tier: "full", full_rank: index } : { tier: "digest", full_rank: null }));
  return out;
}

/** Kinds shown first in `Cn SAID` (commitment, money, date, objection, competitor, restriction). */
const PRIORITY_KINDS = new Set(["promised_callback", "customer_requested_callback", "customer_will_call", "next_step", "completion_claim", "reschedule",
  "quoted_amount", "payment_claim", "booking_claim", "objection", "competitor_mention", "contact_restriction"]);
type Said = SummaryStep["said_on_call"][number];
const isPriority = (fact: Said) => PRIORITY_KINDS.has(fact.kind) || (fact.kind === "move_fact" && (fact.value as { field?: string }).field === "move_date");

/** Priority claims in order, then the rest, up to 30. Returns the original indices so commitment tags can follow. */
export function saidOrder(summary: SummaryStep): number[] {
  const facts = summary.said_on_call;
  const first = facts.map((f, i) => [f, i] as const).filter(([f]) => isPriority(f)).map(([, i]) => i);
  const rest = facts.map((f, i) => [f, i] as const).filter(([f]) => !isPriority(f)).map(([, i]) => i);
  return [...first, ...rest].slice(0, Math.max(SAID_MAX, first.length));
}
/** `[rep promised] email estimate today` — speaker and action status as said, never re-attributed. */
export function saidText(fact: Said): string {
  const status = fact.action_status ? ` ${fact.action_status}` : "";
  return `[${fact.speaker}${status}] ${cleanText(fact.claim, 300)}`;
}

const SECTIONS: Array<[keyof SummaryStep["summary"], string | null]> = [["overview", null], ["customer_wanted", "wanted"], ["money_and_dates", "money & dates"],
  ["outcome", "outcome"], ["commitments", "commitments"], ["discrepancies", "discrepancies"]];
/** All six sections, empty ones omitted. */
export function fullSummaryText(summary: SummaryStep): string {
  return SECTIONS.flatMap(([key, label]) => { const text = cleanText(summary.summary[key]); return text ? [label ? `${label}: ${text}` : text] : []; }).join(" | ");
}
export function firstSentence(text: string, max = DIGEST_OVERVIEW_MAX): string {
  const clean = cleanText(text, 2000);
  const first = clean.split(/(?<=[.!?])\s+/)[0] ?? clean;
  return clip(first, max);
}
/** Digest line 2: `outcome` + `commitments` (≤ 300), then the ledger tags. */
export function digestOutcome(summary: SummaryStep, tags: readonly string[]): string | null {
  const outcome = cleanText(summary.summary.outcome), commitments = cleanText(summary.summary.commitments);
  // The line is already labelled `Cn OUTCOME:`; only the commitments part names itself (V-AC N7).
  const body = [outcome || null, commitments ? `commitments: ${commitments}` : null].filter(Boolean).join(" | ");
  if (!body && !tags.length) return null;
  return `${clip(body, DIGEST_OUTCOME_MAX)}${tags.length ? `${body ? " " : ""}[${tags.join("; ")}]` : ""}`;
}
