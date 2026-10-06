import type { SalesOutreachCallAssociationRule } from "../../src/validation/v1/salesOutreach";

/** One open desk subject as `ops/numbers-v2/desk-resync.ts` reads it (closed subjects are not loaded). */
export type ResyncSubject = Readonly<{ id: string; activation_at: Date | null }>;

/**
 * The subject a settled call's contact event should credit, as the desk-resync drift check sees it
 * (an approximation of `contacts/derive.ts` `associate` over open subjects only): the subject of the
 * number's current `lead` when it was active at the call; otherwise, only under olr C2d
 * `single_active_subject_on_link`, the single open subject among the number's `other_leads` active at the
 * call (two or more: none, as `ambiguous` credits nobody). Without this, every call credited to a shadow
 * subject under C2d would be counted as drift and get a no-op re-derive job. Pure.
 */
export function expectedCallSubject(input: {
  number_lead: string | null;
  other_leads: readonly string[];
  started_at: Date;
  subject_by_lead: ReadonlyMap<string, ResyncSubject>;
  rule: SalesOutreachCallAssociationRule | undefined;
}): string | null {
  const activeAt = (lead: string | null) => {
    const subject = lead ? input.subject_by_lead.get(lead) : undefined;
    return subject?.activation_at && +subject.activation_at <= +input.started_at ? subject.id : null;
  };
  const primary = activeAt(input.number_lead);
  if (primary || input.rule !== "single_active_subject_on_link") return primary;
  const shadows = new Set(input.other_leads.filter((lead) => lead !== input.number_lead).map(activeAt).filter((id): id is string => id !== null));
  return shadows.size === 1 ? [...shadows][0]! : null;
}
