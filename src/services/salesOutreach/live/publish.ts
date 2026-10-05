import mongoose from "mongoose";
import type { SalesOutreachLiveTopic } from "../../../config/domain/salesOutreach";
import { logger } from "../../../logger";
import { getSalesOutreachLiveEventModel } from "../../../models/salesOutreach/liveEvents";

/**
 * Publishes committed desk changes to `GET /live` (CONTRACTS "SSE"). Call it **after** the write's
 * transaction commits, with ids and revisions only:
 *
 * - `outreach_desk` — a projection, plan or assignment changed: the subject ids and every Agent whose
 *   view changed (assignee, previous assignee). The evaluate consumer and the desk commands call it.
 * - `outreach_goal` — a rep-day row changed: the Agent and business day (S3's rep-day writer calls it;
 *   the day-override command calls it too).
 * - `outreach_configuration` — the configuration pointer moved: its revision (every desk viewer).
 *
 * It never throws: a lost hint only delays the browser until its 30-second fallback refetch. With no
 * live database connection (unit tests, scripts before `connectMongo`) it publishes nothing.
 */

export type OutreachLivePublication = Readonly<{
  topic: SalesOutreachLiveTopic;
  subject_ids?: ReadonlyArray<string | null | undefined>;
  agent_ids?: ReadonlyArray<string | null | undefined>;
  business_day?: string | null;
  revision?: number | null;
  cause: "evaluation" | "command" | "configuration" | "rep_day";
}>;

export type OutreachLiveDoc = Readonly<{
  topic: SalesOutreachLiveTopic;
  subject_ids: string[];
  agent_ids: string[];
  business_day: string | null;
  revision: number | null;
  cause: string;
}>;

const MAX_SUBJECTS_PER_EVENT = 100;
const MAX_AGENTS_PER_EVENT = 10;
const isId = (value: string | null | undefined): value is string => typeof value === "string" && /^[a-f\d]{24}$/.test(value);

/** Normalizes publications into bounded documents (subject ids chunked by 100; agents de-duplicated). */
export function toLiveDocs(publications: readonly OutreachLivePublication[]): OutreachLiveDoc[] {
  const docs: OutreachLiveDoc[] = [];
  for (const p of publications) {
    const subjects = [...new Set((p.subject_ids ?? []).filter(isId))];
    const agents = [...new Set((p.agent_ids ?? []).filter(isId))].slice(0, MAX_AGENTS_PER_EVENT);
    const base = { topic: p.topic, agent_ids: agents, business_day: p.business_day ?? null, revision: p.revision ?? null, cause: p.cause };
    if (!subjects.length) docs.push({ ...base, subject_ids: [] });
    for (let i = 0; i < subjects.length; i += MAX_SUBJECTS_PER_EVENT) docs.push({ ...base, subject_ids: subjects.slice(i, i + MAX_SUBJECTS_PER_EVENT) });
  }
  return docs;
}

export type LiveInsert = (docs: readonly OutreachLiveDoc[]) => Promise<void>;

const oid = (id: string) => new mongoose.Types.ObjectId(id);

export const mongoLiveInsert: LiveInsert = async (docs) => {
  // No connection = nothing listening in this process's database (tests, scripts): skip, never buffer.
  if (mongoose.connection.readyState !== 1) return;
  await getSalesOutreachLiveEventModel().insertMany(
    docs.map((d) => ({ ...d, subject_ids: d.subject_ids.map(oid), agent_ids: d.agent_ids.map(oid) })),
    { ordered: false },
  );
};

export async function publishOutreachLive(
  publications: OutreachLivePublication | readonly OutreachLivePublication[],
  insert: LiveInsert = mongoLiveInsert,
): Promise<void> {
  const list = Array.isArray(publications) ? (publications as readonly OutreachLivePublication[]) : [publications as OutreachLivePublication];
  const docs = toLiveDocs(list);
  if (!docs.length) return;
  try {
    await insert(docs);
  } catch (error) {
    logger.warn({ msg: "sales_outreach.live.publish_failed", events: docs.length, errorName: error instanceof Error ? error.name : "Error" });
  }
}
