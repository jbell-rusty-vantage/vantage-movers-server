/**
 * One cap and one owner for `contact_numbers.search_terms` (14 §6).
 *
 * `search_terms` is what makes a Contact Number findable by customer name,
 * Job Number and agent name (`buildNumberSearchFilter`). Three writers used to
 * maintain it under two different caps: the attachment rebuild and the durable
 * rebuild filled it to fifty from the attached Leads, then the next inbound or
 * outbound call on the number shifted the list down to twenty and dropped the
 * oldest thirty — typically exactly the Job Numbers and names that matter.
 * The number silently stopped being findable by them until an attachment
 * refresh or an Owner rebuild restored the set.
 *
 * Contract:
 *  - `rebuildAttachmentSearchTerms` and `recountNumber` own the set. They see
 *    every edge, so they may replace it wholesale, bounded by `MAX_SEARCH_TERMS`.
 *  - Capture (`applyRollupDelta`) may only *add* an observed caller-ID name.
 *    It never truncates, never reorders, and never evicts a term it did not
 *    write. At the cap it declines the addition; `provider_names` still records
 *    the name, and the owning rebuild seeds terms from `provider_names`, so the
 *    name is not lost — only deferred.
 */
export const MAX_SEARCH_TERMS = 50;

/** Owner-side truncation: dedupes, preserves order, bounded by the shared cap. */
export function boundSearchTerms(terms: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of terms) {
    const term = raw.trim().toLowerCase();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length === MAX_SEARCH_TERMS) break;
  }
  return out;
}

/**
 * Capture-side addition. Returns the same array instance when nothing changes
 * so callers can skip the write. Never removes a lead-derived term.
 */
export function addObservedSearchTerm(
  current: readonly string[],
  observed: string | null | undefined,
): string[] {
  const term = observed?.trim().toLowerCase();
  const terms = [...current];
  if (!term || terms.includes(term) || terms.length >= MAX_SEARCH_TERMS) return terms;
  terms.push(term);
  return terms;
}
