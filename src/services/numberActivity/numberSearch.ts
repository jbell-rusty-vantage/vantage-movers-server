import { toE164 } from "./phone";

/**
 * The All Numbers `q` term (CONTRACT §4.1), the same rules the interim Numbers search used.
 * Digits-only (after stripping phone formatting) with >= 10 digits → exact E.164 **or** the same
 * digits as a suffix; 3..9 digits → suffix over `digits_reversed`; anything else is a lowercased
 * term matched as an anchored prefix against `search_terms` (caller names, Lead names, Job Numbers,
 * reps).
 *
 * The suffix arm on long digit input matters: a pasted number carrying a wrong or extra country
 * prefix normalizes to an E.164 value the system never stored, and exact-only matching reported "the
 * number isn't in the system" for what is really a search miss (14 §10). Both arms are index-served,
 * so widening the predicate does not widen the work.
 */
export type ParsedSearchTerm =
  | { kind: "none" }
  /** `reversed` is always present so an exact miss still tries the suffix. */
  | { kind: "e164"; e164: string; reversed: string }
  | { kind: "suffix"; reversed: string }
  | { kind: "term"; term: string };

const PHONE_FORMATTING = /[\s().+\-]/g;

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseSearchTerm(q: string | undefined): ParsedSearchTerm {
  const trimmed = q?.trim() ?? "";
  if (!trimmed) return { kind: "none" };
  const stripped = trimmed.replace(PHONE_FORMATTING, "");
  if (/^\d+$/.test(stripped)) {
    const reversed = stripped.split("").reverse().join("");
    if (stripped.length >= 10) {
      const e164 = toE164(trimmed);
      if (e164) return { kind: "e164", e164, reversed };
    }
    if (stripped.length >= 3) {
      return { kind: "suffix", reversed };
    }
  }
  return { kind: "term", term: trimmed.toLowerCase() };
}
