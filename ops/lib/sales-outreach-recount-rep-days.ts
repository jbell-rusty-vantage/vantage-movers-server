/**
 * Outreach lifecycle repair C1b (+ the C5 backfill): recount `sales_outreach_rep_day_projections` rows
 * over a range of New York business days with the same function the minute sweep uses
 * (`contacts/sweep.ts` `recountRepDays` → `repDayService.ts` `recountRepDay`).
 *
 * - keys: every `(agent, business_day)` row in `[from, to]`; with `--materialize-roster` also every rep
 *   on the active configuration's roster without a row on a past day of the range (`materialize`, olr
 *   C5: a frozen zero row; `materializesZeroRow` re-checks the roster inside the recount transaction);
 * - dry run (default): each key is recounted inside a transaction against a store whose `writeRow`
 *   writes nothing, so the report says what an apply would write;
 * - apply: the real store in slices of `RECOUNT_BATCH`, each key in its own transaction; goal changes
 *   are published as the sweep publishes them. Frozen goal snapshots stay frozen (`goalSnapshotFor`);
 *   only fingerprints, the two-scope counts and stale scopes move;
 * - idempotent: a second run reports every key `unchanged` (no row written twice).
 *
 * Pure parts (argument parsing, key planning, the summary) are unit-tested; the Mongo path is proven on
 * the replica (`ops/sales-outreach/contact-events.replica.ts`).
 */
import type { ClientSession } from "mongoose";
import { getSalesOutreachRepDayProjectionModel } from "../../src/models/salesOutreach";
import type { ConfigurationLoader } from "../../src/services/salesOutreach/config/load";
import type { RepDayKey } from "../../src/services/salesOutreach/contacts/apply";
import type { OutreachGoalPublisher } from "../../src/services/salesOutreach/contacts/goalPublish";
import type { RepDayRecount, RepDayStore } from "../../src/services/salesOutreach/contacts/repDayService";
import { recountRepDays } from "../../src/services/salesOutreach/contacts/sweep";
import { addDays, daysBetween } from "../../src/services/salesOutreach/engine/calendar";

/** Keys per `recountRepDays` call (each key is still its own transaction). */
export const RECOUNT_BATCH = 100;
/** Longest range one run may cover (production's derivation starts 2026-07-07). */
export const MAX_RECOUNT_DAYS = 400;
/** Rows one run may read; a larger range is refused (narrow it with --from/--to). */
export const MAX_RECOUNT_ROWS = 20_000;
const ALLOW_SCHEMA_DRIFT = "--allow-schema-drift";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 *   --target=<database>      required; must equal the database this process resolves
 *   --from=YYYY-MM-DD        first New York business day (default: the contact derivation's coverage start)
 *   --to=YYYY-MM-DD          last day (default: today, New York)
 *   --materialize-roster     also write frozen zero rows for roster reps without a row on a past day (olr C5)
 *   --apply                  write (default: dry run)
 *   --allow-schema-drift     passed through to the production-writer guard
 */
export type RecountCliArgs = Readonly<{ target: string; from: string | null; to: string | null; materialize_roster: boolean; apply: boolean }>;

const isDay = (value: string) => DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && addDays(value, 0) === value;

export function parseRecountArgs(argv: readonly string[]): RecountCliArgs {
  let target: string | null = null;
  let from: string | null = null;
  let to: string | null = null;
  let materialize_roster = false;
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--materialize-roster") materialize_roster = true;
    else if (arg.startsWith("--target=")) target = arg.slice("--target=".length).trim();
    else if (arg.startsWith("--from=")) from = arg.slice("--from=".length).trim();
    else if (arg.startsWith("--to=")) to = arg.slice("--to=".length).trim();
    else if (arg === ALLOW_SCHEMA_DRIFT) continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!target) throw new Error("--target=<database name> is required (for example --target=vantagemovers)");
  if (!/^[A-Za-z0-9_]+$/.test(target)) throw new Error("--target must be a plain database name");
  if (from !== null && !isDay(from)) throw new Error("--from must be a YYYY-MM-DD business day");
  if (to !== null && !isDay(to)) throw new Error("--to must be a YYYY-MM-DD business day");
  return { target, from, to, materialize_roster, apply };
}

/** The resolved range: `from` and `to` (both inclusive) not after today and at most `MAX_RECOUNT_DAYS` long. */
export function resolveRecountRange(input: { from: string | null; to: string | null; today: string; coverage_from_day: string | null }): { from: string; to: string } {
  const from = input.from ?? input.coverage_from_day;
  if (!from) throw new Error("No contact-event derivation yet: pass --from=YYYY-MM-DD");
  const to = input.to ?? input.today;
  if (to > input.today) throw new Error(`--to=${to} is after today (${input.today}, New York)`);
  if (from > to) throw new Error(`--from=${from} is after --to=${to}`);
  if (daysBetween(from, to) + 1 > MAX_RECOUNT_DAYS) throw new Error(`The range ${from}..${to} is longer than ${MAX_RECOUNT_DAYS} days; narrow it`);
  return { from, to };
}

/** A stored row as the report sees it before the recount. */
export type RecountRowBefore = Readonly<{
  agent_id: string;
  business_day: string;
  count_scope: string | null;
  actual_confirmed: number;
  /** `actual_confirmed_all` is stored (the row was written by a build with olr C1b). */
  both_counts: boolean;
}>;

/** The rows of `[from, to]`, by `sod_rep_day_day` (`{business_day, agent_id}`); refuses past `MAX_RECOUNT_ROWS`. */
export async function readRowsInRange(from: string, to: string): Promise<RecountRowBefore[]> {
  const rows = (await getSalesOutreachRepDayProjectionModel()
    .find({ business_day: { $gte: from, $lte: to } }, { agent_id: 1, business_day: 1, count_scope: 1, actual_confirmed: 1, actual_confirmed_all: 1 })
    .sort({ business_day: 1, agent_id: 1 })
    .limit(MAX_RECOUNT_ROWS + 1)
    .lean()) as unknown as Array<{ agent_id: unknown; business_day: string; count_scope?: string | null; actual_confirmed?: number | null; actual_confirmed_all?: number | null }>;
  if (rows.length > MAX_RECOUNT_ROWS) throw new Error(`More than ${MAX_RECOUNT_ROWS} rep-day rows in ${from}..${to}; narrow the range`);
  return rows.map((row) => ({
    agent_id: String(row.agent_id),
    business_day: row.business_day,
    count_scope: row.count_scope ?? null,
    actual_confirmed: row.actual_confirmed ?? 0,
    both_counts: typeof row.actual_confirmed_all === "number",
  }));
}

/**
 * The keys of a run, ordered by day then agent: every existing row, plus (with `materialize_roster`) a
 * `materialize` key for each roster rep without a row on each day of the range before `today`.
 */
export function planRecountKeys(input: {
  rows: readonly RecountRowBefore[];
  /** The roster: one list for every day, or (P08a-1 `desk_reps`) the effective roster of each day. */
  roster: readonly string[] | ((day: string) => readonly string[]);
  from: string;
  to: string;
  today: string;
  materialize_roster: boolean;
}): RepDayKey[] {
  const agentsByDay = new Map<string, string[]>();
  for (const row of input.rows) {
    const agents = agentsByDay.get(row.business_day) ?? [];
    agents.push(row.agent_id);
    agentsByDay.set(row.business_day, agents);
  }
  const rosterOf = typeof input.roster === "function" ? input.roster : () => input.roster as readonly string[];
  const keys: RepDayKey[] = [];
  for (let day = input.from; day <= input.to; day = addDays(day, 1)) {
    const agents = [...(agentsByDay.get(day) ?? [])].sort();
    const have = new Set(agents);
    for (const agent of agents) keys.push({ agent_id: agent, business_day: day });
    if (!input.materialize_roster || day >= input.today) continue;
    for (const agent of [...new Set(rosterOf(day))].sort()) if (!have.has(agent)) keys.push({ agent_id: agent, business_day: day, materialize: true });
  }
  return keys;
}

/** A store that reads like `base` and writes nothing (the dry run): `writeRow` only returns the next publication. */
export function dryRunRepDayStore(base: RepDayStore): RepDayStore {
  return {
    events: (key, session) => base.events(key, session),
    readRow: (key, session) => base.readRow(key, session),
    watermarks: (session) => base.watermarks(session),
    rowsOfDay: (day) => base.rowsOfDay(day),
    deskReps: (at, session) => base.deskReps(at, session),
    writeRow: async (_fields, previous) => (previous?.publication_revision ?? 0) + 1,
  };
}

export type RecountObservation = Readonly<{ key: RepDayKey; result: RepDayRecount | null }>;

type DayTotals = {
  actual_confirmed: number;
  actual_confirmed_all: number;
  actual_confirmed_eligible: number;
  actual_awaiting_all: number;
  actual_awaiting_eligible: number;
};

export type RecountSummary = Readonly<{
  keys: number;
  materialize_keys: number;
  outcomes: { written: number; unchanged: number; no_activity: number; failed: number };
  /** Written rows whose stored `count_scope` was different (or absent). */
  scope_changes: number;
  /** Written rows that did not store both scopes' counts before. */
  both_counts_added: number;
  /** Written rows that did not exist (materialized zero rows). */
  rows_created: number;
  by_day: Array<{
    business_day: string;
    rows_before: number;
    rows_after: number;
    writes: number;
    before: { actual_confirmed: number };
    after: DayTotals;
  }>;
}>;

/**
 * The report of a run from the rows before and each key's outcome. `after` sums the recounted fields of
 * every key that has (or would have) a row; a failed key keeps its stored `actual_confirmed`.
 */
export function summarizeRecount(rows: readonly RecountRowBefore[], observations: readonly RecountObservation[]): RecountSummary {
  const beforeOf = new Map(rows.map((row) => [`${row.agent_id}|${row.business_day}`, row]));
  const outcomes = { written: 0, unchanged: 0, no_activity: 0, failed: 0 };
  let scope_changes = 0;
  let both_counts_added = 0;
  let rows_created = 0;
  const days = new Map<string, RecountSummary["by_day"][number]>();
  const dayOf = (day: string) => {
    let entry = days.get(day);
    if (!entry) {
      entry = {
        business_day: day,
        rows_before: 0,
        rows_after: 0,
        writes: 0,
        before: { actual_confirmed: 0 },
        after: { actual_confirmed: 0, actual_confirmed_all: 0, actual_confirmed_eligible: 0, actual_awaiting_all: 0, actual_awaiting_eligible: 0 },
      };
      days.set(day, entry);
    }
    return entry;
  };
  for (const row of rows) {
    const entry = dayOf(row.business_day);
    entry.rows_before++;
    entry.before.actual_confirmed += row.actual_confirmed;
  }
  for (const { key, result } of observations) {
    const entry = dayOf(key.business_day);
    const before = beforeOf.get(`${key.agent_id}|${key.business_day}`) ?? null;
    if (!result) {
      outcomes.failed++;
      if (before) {
        entry.rows_after++;
        entry.after.actual_confirmed += before.actual_confirmed;
      }
      continue;
    }
    outcomes[result.outcome]++;
    if (result.outcome === "no_activity") continue;
    const fields = result.fields;
    entry.rows_after++;
    entry.after.actual_confirmed += fields.actual_confirmed;
    entry.after.actual_confirmed_all += fields.actual_confirmed_all;
    entry.after.actual_confirmed_eligible += fields.actual_confirmed_eligible;
    entry.after.actual_awaiting_all += fields.actual_awaiting_all;
    entry.after.actual_awaiting_eligible += fields.actual_awaiting_eligible;
    if (result.outcome !== "written") continue;
    entry.writes++;
    if (!before) rows_created++;
    else {
      if (before.count_scope !== fields.count_scope) scope_changes++;
      if (!before.both_counts) both_counts_added++;
    }
  }
  return {
    keys: observations.length,
    materialize_keys: observations.filter((o) => o.key.materialize === true).length,
    outcomes,
    scope_changes,
    both_counts_added,
    rows_created,
    by_day: [...days.values()].sort((a, b) => a.business_day.localeCompare(b.business_day)),
  };
}

/** Recounts `keys` in slices of `RECOUNT_BATCH` through `recountRepDays`, observing each outcome. */
export async function runRecount(input: {
  keys: readonly RepDayKey[];
  loader: ConfigurationLoader;
  now: Date;
  store: RepDayStore;
  transaction: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>;
  publishGoal?: OutreachGoalPublisher;
}): Promise<RecountObservation[]> {
  const observations: RecountObservation[] = [];
  for (let start = 0; start < input.keys.length; start += RECOUNT_BATCH) {
    await recountRepDays(input.keys.slice(start, start + RECOUNT_BATCH), input.loader, input.now, input.store, input.transaction, input.publishGoal, (key, result) =>
      observations.push({ key, result }),
    );
  }
  return observations;
}
