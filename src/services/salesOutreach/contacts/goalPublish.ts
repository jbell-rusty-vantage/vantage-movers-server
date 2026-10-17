import { publishOutreachLive } from "../live/publish";
import { recordGoalMilestones } from "./goalMilestones";

/**
 * Live notification for rep-day changes (IMPLEMENTATION-PLAN §5 `GET /live`, topic `outreach_goal`).
 * Called after the transaction that wrote a rep-day row commits, with the rows whose
 * `publication_revision` moved. Each hint is scoped to its `agent_id`, so a Rep's stream receives only
 * its own rep-days (Owner/Manager receive all). A failure never fails the recount (clients refetch on
 * reconnect and on their 30-second fallback).
 */
export type OutreachGoalChange = Readonly<{
  agent_id: string;
  business_day: string;
  publication_revision: number;
  /** The write crossed today's goal (`RepDayRecount.goal_crossed`): a rep milestone candidate. */
  goal_crossed?: boolean;
}>;

export type OutreachGoalPublisher = (changes: readonly OutreachGoalChange[]) => Promise<void>;

export const publishOutreachGoalChanges: OutreachGoalPublisher = (changes) =>
  publishOutreachLive(
    changes.map((change) => ({
      topic: "outreach_goal" as const,
      agent_ids: [change.agent_id],
      business_day: change.business_day,
      revision: change.publication_revision,
      cause: "rep_day" as const,
    })),
  );

/**
 * Publishes after commit and swallows failures (the next read or reconnect resnapshot repairs it), then records
 * any goal milestones on Daily Operations (`goalMilestones.ts`; it never throws and is idempotent per day).
 */
export async function publishGoalChangesSafely(
  changes: readonly OutreachGoalChange[],
  publish: OutreachGoalPublisher = publishOutreachGoalChanges,
  milestones: (changes: readonly OutreachGoalChange[]) => Promise<void> = recordGoalMilestones,
): Promise<void> {
  if (!changes.length) return;
  await publish(changes).catch(() => undefined);
  await milestones(changes).catch(() => undefined);
}
