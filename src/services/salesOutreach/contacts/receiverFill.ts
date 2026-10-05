import type { ContactEventDraft } from "./derive";

/**
 * Call-inferred assignment: a desk Lead with no `receiver_agent` takes the reviewed rep who most recently
 * called it (or answered its call) as a `ringcentral_rep_call` receiver. The Lead write goes through
 * `writeReceiverAgent` (EntityChange + revision stamp), so the subject feed re-syncs the subject and
 * IMPL-01 assigns it. The receiver is a placeholder: a matching Granot rep replaces it
 * (`granotLifecycle/leadDesiredState.ts` `receiverFillableByGranot`), and a desk reassignment (`manual`) wins.
 *
 * Only an empty receiver is filled: a Lead whose receiver is an unreviewed Agent stays as it is.
 */

export type ReceiverFillCandidate = Readonly<{
  subject_id: string;
  agent_id: string;
  /** The contact event source (`call_interactions` id) that named the rep. */
  source_id: string;
  event_at: Date;
}>;

const REP_CALL_KINDS = new Set(["outbound_attempt", "inbound_answered"]);
const REP_CALL_VERIFICATIONS = new Set(["confirmed", "awaiting_confirmation"]);

/** Does this derived event show a reviewed rep working exactly one desk subject by phone? */
export function isRepCallOnSubject(draft: ContactEventDraft): boolean {
  return (
    draft.source_kind === "call" &&
    draft.association === "unique" &&
    draft.subject_id !== null &&
    draft.actor_agent_id !== null &&
    REP_CALL_KINDS.has(draft.kind) &&
    REP_CALL_VERIFICATIONS.has(draft.verification)
  );
}

/** The most recent qualifying rep call per subject (ties: the larger source id, so a replay picks the same row). */
export function receiverFillCandidates(drafts: readonly ContactEventDraft[]): ReceiverFillCandidate[] {
  const latest = new Map<string, ReceiverFillCandidate>();
  for (const draft of drafts) {
    if (!isRepCallOnSubject(draft)) continue;
    const candidate = { subject_id: draft.subject_id!, agent_id: draft.actor_agent_id!, source_id: draft.source_id, event_at: draft.event_at };
    const current = latest.get(candidate.subject_id);
    if (!current || +candidate.event_at > +current.event_at || (+candidate.event_at === +current.event_at && candidate.source_id > current.source_id))
      latest.set(candidate.subject_id, candidate);
  }
  return [...latest.values()];
}
