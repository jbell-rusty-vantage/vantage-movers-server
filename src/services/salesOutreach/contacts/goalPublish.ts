/**
 * Live notification seam for rep-day changes (IMPLEMENTATION-PLAN §5 `GET /live`, topic
 * `outreach_goal`). Called after the transaction that wrote a rep-day row commits, with the rows whose
 * `publication_revision` moved. A failure never fails the recount (clients refetch on reconnect).
 *
 * TODO(S1 phase 4b, live stream): replace the body with the `outreach_goal` publish helper S1 exports
 * (scope each hint to its `agent_id` so a Rep only receives its own rep-days). Until then this is a
 * deliberate no-op: the desk reads stay correct, only the push hint is missing.
 */
export type OutreachGoalChange = Readonly<{ agent_id: string; business_day: string; publication_revision: number }>;

export type OutreachGoalPublisher = (changes: readonly OutreachGoalChange[]) => Promise<void>;

export const publishOutreachGoalChanges: OutreachGoalPublisher = async () => {
  // TODO(S1 phase 4b): publish `outreach_goal` hints here.
};

/** Publishes after commit and swallows failures (the next read or reconnect resnapshot repairs it). */
export async function publishGoalChangesSafely(changes: readonly OutreachGoalChange[], publish: OutreachGoalPublisher = publishOutreachGoalChanges): Promise<void> {
  if (!changes.length) return;
  await publish(changes).catch(() => undefined);
}
