import { createHash } from "node:crypto";
import type { ClientSession } from "mongoose";
import type { JobInput } from "../../salesIntelligence/jobs";
import {
  contactEventId,
  deriveCallContactEvent,
  deriveSmsContactEvent,
  type CallSourceRow,
  type ContactEventDraft,
  type DerivationContext,
  type SmsSourceRow,
} from "./derive";
import { receiverFillCandidates, type ReceiverFillCandidate } from "./receiverFill";

/**
 * Applies contact-event derivation for a set of sources inside one transaction (IMPLEMENTATION-PLAN
 * §6.2 `outreach_contact_change`). Shared by the queued consumer (one source per job) and the minute
 * sweep (a page of sources):
 *
 * 1. load the source rows and their context in bulk, derive one row per source;
 * 2. write only rows whose fingerprint changed (revision + 1), so a replay writes nothing;
 * 3. mark dirty — every subject the source moved from or to gets one `outreach_evaluate` nomination
 *    (S1's consumer evaluates it), and every `(goal_agent_id, business_date)` it moved from or to is
 *    returned for the rep-day recount (queued as `outreach_rep_day` by the consumer, recounted inline
 *    by the sweep);
 * 4. fill an empty Lead receiver from the most recent reviewed-rep call on its subject (`receiverFill.ts`).
 *
 * `observe` (olr C8, `ops/sales-outreach/rederive-contact-events.ts`) sees every derived row and whether
 * it differs from the stored one, so the operator re-derive can report by `association_reason`.
 */

export type ContactSource = Readonly<{ source_kind: "call" | "sms"; source_id: string }>;

export type StoredContactEvent = Readonly<{
  id: string;
  subject_id: string | null;
  goal_agent_id: string | null;
  business_date: string;
  input_fingerprint: string;
  revision: number;
}>;

export type ContextRequest = Readonly<{
  account_extensions: ReadonlyArray<{ account: string; extension: string }>;
  number_ids: readonly string[];
  e164s: readonly string[];
}>;

export type ContactEventStore = {
  loadCalls(ids: readonly string[], session: ClientSession): Promise<CallSourceRow[]>;
  loadSms(ids: readonly string[], session: ClientSession): Promise<SmsSourceRow[]>;
  loadContext(request: ContextRequest, session: ClientSession): Promise<DerivationContext>;
  loadEvents(ids: readonly string[], session: ClientSession): Promise<Map<string, StoredContactEvent>>;
  /** Writes the row (insert or replace of the derived fields); returns its new revision. */
  writeEvent(id: string, draft: ContactEventDraft, previous: StoredContactEvent | null, now: Date, session: ClientSession): Promise<number>;
  subjectRevisions(ids: readonly string[], session: ClientSession): Promise<Map<string, number>>;
  enqueue(job: JobInput, session: ClientSession, now: Date): Promise<{ job_id: string; created: boolean }>;
  /** Writes `ringcentral_rep_call` receivers on unassigned subjects whose Lead has none; returns how many. */
  fillEmptyReceivers(candidates: readonly ReceiverFillCandidate[], session: ClientSession, now: Date): Promise<number>;
};

export type RepDayKey = Readonly<{
  agent_id: string;
  business_day: string;
  /**
   * olr C5: the refresh pass's zero-activity key for a roster rep without a row yesterday (see
   * `recountRepDay` `materialize`). Not part of the identity: `repDayKeyOf` and `repDayJob` ignore it.
   */
  materialize?: boolean;
}>;

export type ApplyResult = {
  derived: number;
  changed: number;
  missing: number;
  evaluations: number;
  rep_days: RepDayKey[];
  /** Lead receivers filled from a rep call (call-inferred assignment). */
  receivers_filled: number;
  /** Jobs this call created (for the post-commit queue wake-up). */
  created_job_ids: string[];
};

/** `outreach_evaluate` nomination for a subject whose contact evidence changed (S1 consumer). */
const digestOf = (marks: readonly string[]) => createHash("sha256").update([...marks].sort().join("|")).digest("hex").slice(0, 16);

export function contactEvaluationJob(subjectId: string, subjectRevision: number, marks: readonly string[]): JobInput {
  const digest = digestOf(marks);
  return {
    stage: "outreach_evaluate",
    subject_key: `outreach-subject:${subjectId}`,
    dedupe_key: `sod:evaluate:${subjectId}:r${subjectRevision}:contacts:${digest}`,
    input_revision: subjectRevision,
    input_refs: [subjectId],
  };
}

/** `outreach_rep_day` recount job for one dirty rep-day (one identity per event version that dirtied it). */
export function repDayJob(key: RepDayKey, marks: readonly string[]): JobInput {
  return {
    stage: "outreach_rep_day",
    subject_key: `outreach-rep-day:${key.agent_id}:${key.business_day}`,
    dedupe_key: `sod:rep-day:${key.agent_id}:${key.business_day}:${digestOf(marks)}`,
    input_revision: 1,
    input_refs: [key.agent_id],
  };
}

export const repDayKeyOf = (key: RepDayKey) => `${key.agent_id}|${key.business_day}`;

/** Also used by the operator desk-receiver backfill (re-derives pre-activation calls). */
export function contextRequest(calls: readonly CallSourceRow[], sms: readonly SmsSourceRow[]): ContextRequest {
  const extensions = new Map<string, { account: string; extension: string }>();
  for (const row of calls) {
    const ids = [...row.parties.map((p) => p.extension_id), ...row.legs.map((l) => l.extension_id)];
    for (const extension of ids) if (extension) extensions.set(`${row.provider_account_id}|${extension}`, { account: row.provider_account_id, extension });
  }
  return {
    account_extensions: [...extensions.values()],
    number_ids: [...new Set(calls.flatMap((row) => (row.contact_number_id ? [row.contact_number_id] : [])))],
    e164s: [...new Set(sms.flatMap((row) => row.counterpart_numbers))],
  };
}

export type ApplyOptions = Readonly<{
  now: Date;
  queueRepDays: boolean;
  /** Sees each derived row and whether its fingerprint differs from the stored row (olr C8 re-derive report). */
  observe?: (draft: ContactEventDraft, changed: boolean) => void;
}>;

export async function applyContactSources(
  sources: readonly ContactSource[],
  options: ApplyOptions,
  store: ContactEventStore,
  session: ClientSession,
): Promise<ApplyResult> {
  const callIds = [...new Set(sources.filter((s) => s.source_kind === "call").map((s) => s.source_id))];
  const smsIds = [...new Set(sources.filter((s) => s.source_kind === "sms").map((s) => s.source_id))];
  // Sequential on purpose: a session cannot run two operations at once inside a transaction.
  const calls = callIds.length ? await store.loadCalls(callIds, session) : [];
  const sms = smsIds.length ? await store.loadSms(smsIds, session) : [];
  const context = await store.loadContext(contextRequest(calls, sms), session);
  const drafts = [...calls.map((row) => deriveCallContactEvent(row, context)), ...sms.map((row) => deriveSmsContactEvent(row, context))];
  const ids = drafts.map((d) => contactEventId(d.source_kind, d.source_id));
  const existing = await store.loadEvents(ids, session);

  const subjectMarks = new Map<string, string[]>();
  const repDays = new Map<string, { key: RepDayKey; marks: string[] }>();
  const markSubject = (subject: string | null, mark: string) => {
    if (subject) subjectMarks.set(subject, [...(subjectMarks.get(subject) ?? []), mark]);
  };
  const markRepDay = (agent: string | null, day: string, mark: string) => {
    if (!agent) return;
    const key: RepDayKey = { agent_id: agent, business_day: day };
    const entry = repDays.get(repDayKeyOf(key)) ?? { key, marks: [] };
    entry.marks.push(mark);
    repDays.set(repDayKeyOf(key), entry);
  };

  let changed = 0;
  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i]!;
    const id = ids[i]!;
    const previous = existing.get(id) ?? null;
    const differs = previous?.input_fingerprint !== draft.input_fingerprint;
    options.observe?.(draft, differs);
    if (!differs) continue;
    const revision = await store.writeEvent(id, draft, previous, options.now, session);
    changed++;
    const mark = `${draft.source_kind}:${draft.source_id}:v${revision}`;
    markSubject(previous?.subject_id ?? null, mark);
    markSubject(draft.subject_id, mark);
    if (previous) markRepDay(previous.goal_agent_id, previous.business_date, mark);
    markRepDay(draft.goal_agent_id, draft.business_date, mark);
  }

  const created: string[] = [];
  const revisions = subjectMarks.size ? await store.subjectRevisions([...subjectMarks.keys()], session) : new Map<string, number>();
  let evaluations = 0;
  for (const [subject, marks] of subjectMarks) {
    const revision = revisions.get(subject);
    if (revision === undefined) continue; // the subject no longer exists: nothing to evaluate
    const job = await store.enqueue(contactEvaluationJob(subject, revision, marks), session, options.now);
    evaluations++;
    if (job.created) created.push(job.job_id);
  }
  if (options.queueRepDays) {
    for (const { key, marks } of repDays.values()) {
      const job = await store.enqueue(repDayJob(key, marks), session, options.now);
      if (job.created) created.push(job.job_id);
    }
  }
  const candidates = receiverFillCandidates(drafts);
  const receiversFilled = candidates.length ? await store.fillEmptyReceivers(candidates, session, options.now) : 0;
  return {
    derived: drafts.length,
    changed,
    missing: callIds.length + smsIds.length - drafts.length,
    evaluations,
    rep_days: [...repDays.values()].map((entry) => entry.key),
    receivers_filled: receiversFilled,
    created_job_ids: created,
  };
}
