/**
 * Outreach lifecycle repair C8: re-derive `sales_outreach_contact_events` from a New York business day
 * on, so every event stores its `association_reason` and the rep-days carry the "Other outbound"
 * breakdown.
 *
 * - sources: `call_interactions` with `started_at` at or after the New York start of `--from`, paged by
 *   `(started_at, _id)` on `call_interaction_started_window`; `ringcentral_rep_sms_evidence` with
 *   `provider_created_at` at or after it, paged by `_id` from one day before `--from` (an evidence row is
 *   inserted after its message exists, so the `_id` bound only skips rows that cannot match);
 * - each page of `REDERIVE_PAGE` sources runs `applyContactSources` in one transaction with
 *   `queueRepDays: false`, exactly as the minute sweep does: only rows whose fingerprint changed are
 *   written (revision + 1), and their subjects get one `outreach_evaluate` nomination each; then
 *   `recountRepDays` recounts every dirty rep-day (each key in its own transaction);
 * - dry run (default): the same pages through a store that writes and enqueues nothing; the report says
 *   what an apply would change, by `association_reason`;
 * - idempotent: a second run changes nothing (`verify.would_change` is 0 after an apply).
 *
 * Pure parts (argument parsing, the range, the report) are unit-tested; the Mongo path is proven on the
 * replica (`ops/sales-outreach/contact-events.replica.ts`).
 */
import mongoose, { type ClientSession } from "mongoose";
import type { SalesOutreachAssociationReason } from "../../src/config/domain/salesOutreachContacts";
import { SALES_OUTREACH_ASSOCIATION_REASONS } from "../../src/config/domain/salesOutreachContacts";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getRingCentralRepSmsEvidenceModel } from "../../src/models/salesOutreach/repSmsEvidence";
import type { ConfigurationLoader } from "../../src/services/salesOutreach/config/load";
import { applyContactSources, repDayKeyOf, type ContactEventStore, type RepDayKey } from "../../src/services/salesOutreach/contacts/apply";
import type { ContactEventDraft } from "../../src/services/salesOutreach/contacts/derive";
import type { OutreachGoalPublisher } from "../../src/services/salesOutreach/contacts/goalPublish";
import { emptyOtherOutboundBreakdown, otherOutboundBucketOf } from "../../src/services/salesOutreach/contacts/repDay";
import type { RepDayRecount, RepDayStore } from "../../src/services/salesOutreach/contacts/repDayService";
import { recountRepDays } from "../../src/services/salesOutreach/contacts/sweep";
import { addDays, daysBetween } from "../../src/services/salesOutreach/engine/calendar";
import { newYorkDayBounds } from "../../src/services/salesOutreach/reads/businessDay";

/** Sources per transaction (the minute sweep's page). */
export const REDERIVE_PAGE = 200;
/** Longest range one run may cover (2026-09-20, the first call, is ~17 days before C8). */
export const MAX_REDERIVE_DAYS = 120;
/** Pages one run may walk (a runaway guard: 500 × 200 = 100,000 sources). */
export const MAX_REDERIVE_PAGES = 500;
/** SMS evidence `_id` lower bound: one day before `--from` (insert time is after the message exists). */
const SMS_ID_MARGIN_MS = 24 * 60 * 60_000;
const ALLOW_SCHEMA_DRIFT = "--allow-schema-drift";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const REDERIVE_KINDS = ["call", "sms", "all"] as const;
export type RederiveKind = (typeof REDERIVE_KINDS)[number];
export type SourceKind = "call" | "sms";

/**
 *   --target=<database>      required; must equal the database this process resolves
 *   --from=YYYY-MM-DD        first New York business day (default: yesterday, New York)
 *   --kind=call|sms|all      which sources (default: all)
 *   --apply                  write (default: dry run)
 *   --allow-schema-drift     passed through to the production-writer guard
 */
export type RederiveCliArgs = Readonly<{ target: string; from: string | null; kind: RederiveKind; apply: boolean }>;

const isDay = (value: string) => DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && addDays(value, 0) === value;

export function parseRederiveArgs(argv: readonly string[]): RederiveCliArgs {
  let target: string | null = null;
  let from: string | null = null;
  let kind: RederiveKind = "all";
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--target=")) target = arg.slice("--target=".length).trim();
    else if (arg.startsWith("--from=")) from = arg.slice("--from=".length).trim();
    else if (arg.startsWith("--kind=")) {
      const value = arg.slice("--kind=".length).trim();
      if (!(REDERIVE_KINDS as readonly string[]).includes(value)) throw new Error("--kind must be call, sms or all");
      kind = value as RederiveKind;
    } else if (arg === ALLOW_SCHEMA_DRIFT) continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!target) throw new Error("--target=<database name> is required (for example --target=vantagemovers)");
  if (!/^[A-Za-z0-9_]+$/.test(target)) throw new Error("--target must be a plain database name");
  if (from !== null && !isDay(from)) throw new Error("--from must be a YYYY-MM-DD business day");
  return { target, from, kind, apply };
}

/** The first day (default yesterday) and its New York start instant; never after today, at most `MAX_REDERIVE_DAYS` back. */
export function resolveRederiveRange(input: { from: string | null; today: string }): { from: string; from_instant: Date } {
  const from = input.from ?? addDays(input.today, -1);
  if (from > input.today) throw new Error(`--from=${from} is after today (${input.today}, New York)`);
  if (daysBetween(from, input.today) + 1 > MAX_REDERIVE_DAYS) throw new Error(`--from=${from} is more than ${MAX_REDERIVE_DAYS} days back; narrow it`);
  return { from, from_instant: newYorkDayBounds(from).start };
}

export const kindsOf = (kind: RederiveKind): SourceKind[] => (kind === "all" ? ["call", "sms"] : [kind]);

export type SourceCursor = Readonly<{ at: Date; id: string }> | null;

/** Pages of source ids at or after `from`, oldest first; `cursor` is the last row of the previous page. */
export type RederiveSourcePager = {
  page(kind: SourceKind, from: Date, cursor: SourceCursor, limit: number): Promise<Array<{ id: string; at: Date }>>;
};

const oid = (id: string) => new mongoose.Types.ObjectId(id);

export const mongoRederiveSourcePager: RederiveSourcePager = {
  async page(kind, from, cursor, limit) {
    if (kind === "call") {
      const after = cursor ? { $or: [{ started_at: { $gt: cursor.at } }, { started_at: cursor.at, _id: { $gt: oid(cursor.id) } }] } : {};
      const rows = (await getCallInteractionModel()
        .find({ started_at: { $gte: from }, ...after }, { _id: 1, started_at: 1 })
        .sort({ started_at: 1, _id: 1 })
        .limit(limit)
        .lean()) as unknown as Array<{ _id: unknown; started_at: Date }>;
      return rows.map((row) => ({ id: String(row._id), at: row.started_at }));
    }
    const floor = mongoose.Types.ObjectId.createFromTime(Math.floor((from.getTime() - SMS_ID_MARGIN_MS) / 1000));
    const rows = (await getRingCentralRepSmsEvidenceModel()
      .find({ _id: { $gt: cursor ? oid(cursor.id) : floor }, provider_created_at: { $gte: from } }, { _id: 1, provider_created_at: 1 })
      .sort({ _id: 1 })
      .limit(limit)
      .lean()) as unknown as Array<{ _id: unknown; provider_created_at: Date }>;
    return rows.map((row) => ({ id: String(row._id), at: row.provider_created_at }));
  },
};

/** A store that reads like `base` and writes nothing (the dry run): no event write, no job, no receiver fill. */
export function dryRunContactEventStore(base: ContactEventStore): ContactEventStore {
  return {
    loadCalls: (ids, session) => base.loadCalls(ids, session),
    loadSms: (ids, session) => base.loadSms(ids, session),
    loadContext: (request, session) => base.loadContext(request, session),
    loadEvents: (ids, session) => base.loadEvents(ids, session),
    subjectRevisions: (ids, session) => base.subjectRevisions(ids, session),
    writeEvent: async (_id, _draft, previous) => (previous?.revision ?? 0) + 1,
    enqueue: async () => ({ job_id: "dry-run", created: false }),
    fillEmptyReceivers: async () => 0,
  };
}

/** `association_reason` buckets of the report; `excluded` = rows excluded before association (null). */
export type ReasonCounts = Record<SalesOutreachAssociationReason | "excluded", number>;
const emptyReasons = (): ReasonCounts =>
  ({ ...Object.fromEntries(SALES_OUTREACH_ASSOCIATION_REASONS.map((reason) => [reason, 0])), excluded: 0 }) as ReasonCounts;

export type RederiveTally = {
  sources: Record<SourceKind, number>;
  pages: number;
  pages_failed: number;
  /** Error names of failed page attempts (no messages: they could carry customer data). */
  page_errors: string[];
  derived: number;
  changed: number;
  /** Rows whose fingerprint differs from the stored row (written on apply), by `association_reason`. */
  changed_by_reason: ReasonCounts;
  /** Every derived row by `association_reason`. */
  derived_by_reason: ReasonCounts;
  /**
   * The rep-day "Other outbound" breakdown the derived rows give, by business day, over every reviewed
   * initiator (the team read sums roster reps only): confirmed goal credit without an eligible subject.
   */
  other_outbound_by_day: Record<string, ReturnType<typeof emptyOtherOutboundBreakdown>>;
  /** `outreach_evaluate` nominations (apply: enqueued; dry run: would be). */
  evaluations: number;
  dirty_rep_days: RepDayKey[];
};

export function emptyTally(): RederiveTally {
  return {
    sources: { call: 0, sms: 0 },
    pages: 0,
    pages_failed: 0,
    page_errors: [],
    derived: 0,
    changed: 0,
    changed_by_reason: emptyReasons(),
    derived_by_reason: emptyReasons(),
    other_outbound_by_day: {},
    evaluations: 0,
    dirty_rep_days: [],
  };
}

/** Adds one derived row to the tally (the `applyContactSources` observer). */
export function observeDraft(tally: RederiveTally, draft: ContactEventDraft, changed: boolean): void {
  const reason = draft.association_reason ?? "excluded";
  tally.derived_by_reason[reason]++;
  if (changed) tally.changed_by_reason[reason]++;
  if (draft.goal_credit === "confirmed" && !draft.goal_scope_eligible && draft.goal_agent_id) {
    const day = (tally.other_outbound_by_day[draft.business_date] ??= emptyOtherOutboundBreakdown());
    day[otherOutboundBucketOf(draft.association_reason)]++;
  }
}

/**
 * Walks every source page of `kinds` from `from` and applies it in its own transaction. A page that
 * fails (e.g. a concurrent sweep moved one event's revision) is retried once, then counted in
 * `pages_failed` and skipped — a later run re-derives it (idempotent).
 */
export async function rederivePages(input: {
  kinds: readonly SourceKind[];
  from: Date;
  now: Date;
  pager: RederiveSourcePager;
  store: ContactEventStore;
  transaction: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>;
  pageSize?: number;
}): Promise<RederiveTally> {
  const tally = emptyTally();
  const dirty = new Map<string, RepDayKey>();
  const size = input.pageSize ?? REDERIVE_PAGE;
  for (const kind of input.kinds) {
    let cursor: SourceCursor = null;
    for (;;) {
      if (tally.pages >= MAX_REDERIVE_PAGES) throw new Error(`More than ${MAX_REDERIVE_PAGES} pages; narrow --from`);
      const rows = await input.pager.page(kind, input.from, cursor, size);
      if (!rows.length) break;
      tally.pages++;
      tally.sources[kind] += rows.length;
      const sources = rows.map((row) => ({ source_kind: kind, source_id: row.id }));
      const attempt = async () => {
        // Observed into a page-local tally so a retried page is not counted twice.
        const local = emptyTally();
        const result = await input.transaction((session) =>
          applyContactSources(sources, { now: input.now, queueRepDays: false, observe: (draft, changed) => observeDraft(local, draft, changed) }, input.store, session),
        );
        return { local, result };
      };
      let applied: Awaited<ReturnType<typeof attempt>> | null = null;
      for (let tries = 0; tries < 2 && !applied; tries++)
        applied = await attempt().catch((error: unknown) => {
          tally.page_errors.push(error instanceof Error ? error.name : "Error");
          return null;
        });
      if (applied) {
        mergeTally(tally, applied.local);
        tally.derived += applied.result.derived;
        tally.changed += applied.result.changed;
        tally.evaluations += applied.result.evaluations;
        for (const key of applied.result.rep_days) dirty.set(repDayKeyOf(key), key);
      } else tally.pages_failed++;
      const last = rows.at(-1)!;
      cursor = { at: last.at, id: last.id };
      if (rows.length < size) break;
    }
  }
  tally.dirty_rep_days = [...dirty.values()].sort((a, b) => a.business_day.localeCompare(b.business_day) || a.agent_id.localeCompare(b.agent_id));
  return tally;
}

function mergeTally(into: RederiveTally, from: RederiveTally): void {
  for (const reason of Object.keys(from.derived_by_reason) as Array<keyof ReasonCounts>) {
    into.derived_by_reason[reason] += from.derived_by_reason[reason];
    into.changed_by_reason[reason] += from.changed_by_reason[reason];
  }
  for (const [day, breakdown] of Object.entries(from.other_outbound_by_day)) {
    const target = (into.other_outbound_by_day[day] ??= emptyOtherOutboundBreakdown());
    for (const bucket of Object.keys(breakdown) as Array<keyof typeof breakdown>) target[bucket] += breakdown[bucket];
  }
}

export type RederiveRecount = Readonly<{ keys: number; outcomes: { written: number; unchanged: number; no_activity: number; failed: number } }>;

/** Recounts the dirty rep-days with the sweep's function (each key its own transaction). */
export async function recountDirtyRepDays(input: {
  keys: readonly RepDayKey[];
  loader: ConfigurationLoader;
  now: Date;
  store: RepDayStore;
  transaction: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>;
  publishGoal?: OutreachGoalPublisher;
}): Promise<RederiveRecount> {
  const outcomes = { written: 0, unchanged: 0, no_activity: 0, failed: 0 };
  await recountRepDays(input.keys, input.loader, input.now, input.store, input.transaction, input.publishGoal, (_key, result: RepDayRecount | null) => {
    if (result) outcomes[result.outcome]++;
    else outcomes.failed++;
  });
  return { keys: input.keys.length, outcomes };
}

/** The JSON summary fields of one pass (`would_change` in a dry run, `changed` on apply). */
export function summarizeRederive(tally: RederiveTally, mode: "dry_run" | "apply") {
  const days = Object.keys(tally.other_outbound_by_day).sort();
  return {
    sources: tally.sources,
    pages: tally.pages,
    pages_failed: tally.pages_failed,
    page_errors: tally.page_errors,
    derived: tally.derived,
    [mode === "apply" ? "changed" : "would_change"]: tally.changed,
    [mode === "apply" ? "changed_by_reason" : "would_change_by_reason"]: tally.changed_by_reason,
    derived_by_reason: tally.derived_by_reason,
    other_outbound_by_day: Object.fromEntries(days.map((day) => [day, tally.other_outbound_by_day[day]!])),
    [mode === "apply" ? "evaluations_enqueued" : "evaluations_would_enqueue"]: tally.evaluations,
    rep_days_dirty: tally.dirty_rep_days.length,
  };
}
