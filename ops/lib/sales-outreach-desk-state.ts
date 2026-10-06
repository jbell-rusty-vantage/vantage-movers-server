/**
 * Read-only state snapshot of the Sales Outreach Desk (outreach lifecycle repair OPS-0): the queries
 * the operator runs before and after every deploy and every operator step (PRODUCTION-STATE.md),
 * shaped into one JSON summary. `ops/sales-outreach/desk-state.ts` is the CLI.
 *
 * Read-only by construction: the collector only sees `DeskStateReader` (counts, bounded finds and
 * aggregations whose pipelines are refused when they contain `$out`/`$merge`), and the CLI also
 * installs the driver-level read guard (`installReadOnlyCommandGuard`) that exits before any
 * non-read command is sent. The summary carries counts, instants, run keys, configuration values and
 * Agent/subject id tails only: no customer, message or token field is projected. The one exception is
 * read in memory and never printed: the Lead phone paths of open subjects without a number, reduced to
 * a phone state (OPS-0b, OPS-0c). Full subject ids leave only in the closed-row snapshot the CLI writes
 * to a local file on `--out` (OPS-0c).
 */
import { createHash } from "node:crypto";
import type { Db, Document, Filter, MongoClient } from "mongodb";
import { SALES_OUTREACH_LEAD_MODELS, type SalesOutreachLeadModel } from "../../src/config/domain/salesOutreach";
import {
  OUTREACH_CONTACT_CALLS_SCOPE,
  OUTREACH_CONTACT_SMS_SCOPE,
  SALES_OUTREACH_OTHER_OUTBOUND_BUCKETS,
  type SalesOutreachAssociationReason,
} from "../../src/config/domain/salesOutreachContacts";
import {
  SALES_OUTREACH_CONFIGURATION_POINTER_KEY,
  salesOutreachConfigurationVersionKey,
} from "../../src/models/salesOutreach/configuration";
import { leadNumberE164s, leadPhonesOf } from "../../src/services/numberActivity/leadContactNumber";
import type { LeadRow } from "../../src/services/numberActivity/leadLink";
import { configuredRingCentralAccountId } from "../../src/services/numberActivity/accountIdentity";
import { reviewedRepMailboxes } from "../../src/services/ringcentral/repSms/mailboxes";
import { getRingCentralCollectionName } from "../../src/services/ringcentral/ringcentral-config";
import { canonicalJson } from "../../src/services/durableWork/checksum";
import { addDays } from "../../src/services/salesOutreach/engine/calendar";
import { createConfigurationLoader, type ConfigurationInspection } from "../../src/services/salesOutreach/config/load";
import { configurationContentHash, type ConfigurationStore } from "../../src/services/salesOutreach/config/store";
import { otherOutboundBucketOf, repDayCoverage } from "../../src/services/salesOutreach/contacts/repDay";
import { deskTimingOf, type DeskTiming } from "../../src/services/salesOutreach/config/timing";
import { engineCoverageOf } from "../../src/services/salesOutreach/evaluation/inputs";
import { currentSmsMailboxRows, smsCoverage, type CallWatermarks, type ChannelCoverage } from "../../src/services/salesOutreach/evidence/coverage";
import { newYorkBusinessDay, newYorkDayBounds } from "../../src/services/salesOutreach/reads/businessDay";
import { mongoOverdueFilter, overdueCutoffs, type OverdueCutoffs } from "../../src/services/salesOutreach/reads/deskStore";
import { composeFreshness, inStaffedCaptureWindow } from "../../src/services/salesOutreach/reads/freshness";
import { composeRepDay, fallbackCountScope, resolveRepDayGoal, type RepDayRow } from "../../src/services/salesOutreach/reads/goals";
import { deriveChannelAt, type StoredChannel } from "../../src/services/salesOutreach/reads/present";
import { toCallsCaptureRow, type SyncStateLean } from "../../src/services/salesOutreach/reads/store";
import { salesOutreachConfigurationValueSchema } from "../../src/validation/v1/salesOutreach";
import { assertReadOnlyPipeline, isCommandAllowed } from "../slimming/lib/guarded-mongo";

/**
 * 2 (OPS-0b): unconfirmed calls by direction + the OPS-1 acceptance split, served rep-day `actual_basis`, calls freshness inputs, subjects without numbers by Lead phone.
 * 3 (OPS-0c): calls freshness from the sticky `reconcile_sync_success_at` plus the served state; subjects without numbers under the CW1 mint rule
 * (`not_candidate` apart); `wave2_acceptance` (read-time verification per channel, `distinct_overdue_leads` vs the design count, `coverage_wait`
 * against the current cadence coverage, closed-row `publication_revision` snapshot and diff); `next_evaluation_at` split open/closed; C8 other
 * outbound and `association_reason` per day.
 */
export const DESK_STATE_SUMMARY_VERSION = 3;

/**
 * CC-04 commit instant: `call_interactions` rows started before it predate the `call_log_state`
 * stamp (OPS-1 settles the Inbound/Outbound ones; `Internal` rows stay null on purpose). Same
 * instant as `CC04_INSTANT` in `sales-outreach-settle-pre-cc04.ts` (a unit test pins it).
 */
export const DESK_STATE_CC04_INSTANT = new Date("2026-09-24T01:28:03Z");
/** Directions OPS-1 settles; every other direction (`Internal`, null) is reported apart. */
export const EXTERNAL_CALL_DIRECTIONS = ["Inbound", "Outbound"] as const;
/** Lead collection per subject `lead_model` (a unit test pins them to the models). */
export const LEAD_COLLECTIONS: Readonly<Record<SalesOutreachLeadModel, string>> = { FormLead: "form_leads", CallLead: "call_leads" };
/**
 * The Lead fields the mint's phone rule reads (olr CW1 `leadNumberE164s`: the four phone paths of `leadPhonesOf`
 * plus the Duplicate / Bad Lead skips); only these are fetched, and they never leave the process.
 */
export const LEAD_PHONE_PROJECTION = {
  _id: 1,
  normalized_phone_number: 1,
  "ingested_contact_snapshot.normalized_phone_number": 1,
  "granot_contact_snapshot.normalized_phone_number": 1,
  "ringcentral.original_caller.normalized_phone_number": 1,
  duplicate: 1,
  bad_lead: 1,
} as const;

/** Sync-state scopes the snapshot reads (the owning services export the same literals; a unit test pins them). */
export const DESK_STATE_SCOPES = {
  call_log: "call_log_all_directions",
  contact_calls: OUTREACH_CONTACT_CALLS_SCOPE,
  contact_sms: OUTREACH_CONTACT_SMS_SCOPE,
  subscription_maintenance: "webhook_subscription_maintenance",
  subscription_health_calls: "webhook_subscription_health:calls",
  subscription_health_rep_sms: "webhook_subscription_health:rep_sms",
} as const;

/** Job statuses that are still owed work (or need an operator): everything but completed/retired. */
export const OPEN_JOB_STATUSES = ["pending", "leased", "retry", "paused", "dead_letter"] as const;
/** Engineering bounds of the summary (not tunables): histogram buckets, recent days, listed runs. */
export const NEXT_EVALUATION_HISTOGRAM_BUCKETS = 48;
export const RECENT_REP_DAYS = 10;
export const LISTED_DAYS = 15;
export const LISTED_ENROLLMENT_RUNS = 30;
/** Open subjects without a number read per snapshot (production: 71); `truncated` says when the cap was hit. */
export const SUBJECTS_WITHOUT_NUMBERS_CAP = 1_000;
/** Projection rows one paged read collects at most (active rows for verification, closed rows for the snapshot; production ≈ 800 in all). */
export const PROJECTION_SCAN_CAP = 20_000;
/** Subjects whose closed-row `publication_revision` went up that the comparison lists (id tails). */
export const LISTED_CHANGED_SUBJECTS = 20;

// ---------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------

export type DeskStateArgs = { target: string; pretty: boolean; out: string | null; compare: string | null };

/**
 * `--target=<database>` is required (never inferred) and must later equal the resolved database;
 * `--pretty` indents the JSON; `--out=<file.json>` writes the closed-row `publication_revision` snapshot
 * to a local file (OPS-0c, for the plan §6 midnight check); `--compare=<file.json>` diffs this run's
 * closed rows against such a file. There is no write mode on the database, so no `--apply`; unknown
 * flags are refused.
 */
export function parseDeskStateArgs(argv: readonly string[]): DeskStateArgs {
  let target: string | null = null;
  let pretty = false;
  let out: string | null = null;
  let compare: string | null = null;
  for (const arg of argv) {
    if (arg.startsWith("--target=")) target = arg.slice("--target=".length).trim();
    else if (arg === "--pretty") pretty = true;
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length).trim();
    else if (arg.startsWith("--compare=")) compare = arg.slice("--compare=".length).trim();
    else if (arg === "--apply") throw new Error("desk-state is read-only; there is no --apply");
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!target) throw new Error("--target=<database name> is required (for example --target=vantagemovers)");
  if (!/^[A-Za-z0-9_]+$/.test(target)) throw new Error("--target must be a plain database name");
  if (out !== null && !out) throw new Error("--out=<file.json> needs a path");
  if (compare !== null && !compare) throw new Error("--compare=<file.json> needs a path");
  return { target, pretty, out, compare };
}

// ---------------------------------------------------------------------------------------------
// Read-only access
// ---------------------------------------------------------------------------------------------

export type DeskStateReader = {
  count(collection: string, filter?: Filter<Document>): Promise<number>;
  aggregate(collection: string, pipeline: Document[]): Promise<Document[]>;
  findOne(collection: string, filter: Filter<Document>, projection?: Document): Promise<Document | null>;
  find(collection: string, filter: Filter<Document>, options: { projection: Document; sort?: Document; limit: number }): Promise<Document[]>;
};

/** Maximum rows one bounded `find` may return. */
const FIND_LIMIT_CAP = 1_000;

/** The collector's only database access: reads, with write stages refused before anything is sent. */
export function readOnlyDeskStateReader(db: Pick<Db, "collection">): DeskStateReader {
  return {
    count: (collection, filter = {}) => db.collection(collection).countDocuments(filter),
    async aggregate(collection, pipeline) {
      assertReadOnlyPipeline(pipeline);
      return db.collection(collection).aggregate(pipeline, { allowDiskUse: false }).toArray();
    },
    findOne: (collection, filter, projection) => db.collection(collection).findOne(filter, projection ? { projection } : {}),
    find: (collection, filter, { projection, sort, limit }) =>
      db
        .collection(collection)
        .find(filter, { projection, ...(sort ? { sort: sort as never } : {}), limit: Math.min(Math.max(1, limit), FIND_LIMIT_CAP) })
        .toArray(),
  };
}

export const READ_GUARD_EXIT_CODE = 97;

/**
 * Driver-level net under the reader: every command the client is about to send passes the read
 * allowlist (`ops/slimming/lib/guarded-mongo.ts`), otherwise the process exits before sending it.
 * The client must be created with `monitorCommands: true`.
 */
export function installReadOnlyCommandGuard(
  client: Pick<MongoClient, "on">,
  io: { exit: (code: number) => never; report: (line: string) => void } = { exit: process.exit, report: (line) => process.stderr.write(line) },
): void {
  client.on("commandStarted", (event) => {
    if (isCommandAllowed("read", event.commandName, event.command)) return;
    io.report(`\n[desk-state guard] refused command '${event.commandName}'; exiting before it is sent.\n`);
    io.exit(READ_GUARD_EXIT_CODE);
  });
}

// ---------------------------------------------------------------------------------------------
// Pure shaping
// ---------------------------------------------------------------------------------------------

type Counts = Record<string, number>;

const keyOf = (value: unknown): string => (value === null || value === undefined || value === "" ? "null" : String(value));

/** `[{_id, n}]` group rows → `{ key: n }` with keys sorted; a compound `_id` joins its values with `/` in field order. */
export function countsOf(rows: readonly Document[], field = "n"): Counts {
  const out: Counts = {};
  for (const row of rows) {
    const id = row._id;
    const key =
      id !== null && typeof id === "object" && !(id instanceof Date) && !("_bsontype" in (id as object))
        ? Object.values(id as Record<string, unknown>).map(keyOf).join("/")
        : keyOf(id);
    out[key] = (out[key] ?? 0) + Number(row[field] ?? 0);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** `[{_id: {outer, inner}, n}]` → `{ outer: { inner: n } }`, both levels sorted. */
export function nestedCountsOf(rows: readonly Document[], outer: string, inner: string): Record<string, Counts> {
  const out: Record<string, Counts> = {};
  for (const row of rows) {
    const id = (row._id ?? {}) as Record<string, unknown>;
    const o = keyOf(id[outer]);
    const i = keyOf(id[inner]);
    out[o] = { ...(out[o] ?? {}), [i]: (out[o]?.[i] ?? 0) + Number(row.n ?? 0) };
  }
  return Object.fromEntries(
    Object.entries(out)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))]),
  );
}

const asDate = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

export const isoOrNull = (value: unknown): string | null => asDate(value)?.toISOString() ?? null;

/** Whole minutes from `instant` to `now` (negative when `instant` is in the future); null when unknown. */
export function lagMinutes(instant: unknown, now: Date): number | null {
  const d = asDate(instant);
  return d ? Math.round((now.getTime() - d.getTime()) / 60_000) : null;
}

/** Last six characters of an Agent id: enough to tell rows apart in evidence, not an identifier dump. */
export const agentTail = (id: unknown): string => (id === null || id === undefined ? "null" : String(id).slice(-6));

export type WatermarkSummary = {
  scope: string;
  present: boolean;
  known_complete_through: string | null;
  lag_min: number | null;
  observed_complete_through: string | null;
  observed_lag_min: number | null;
  last_run: { started_at: string | null; finished_at: string | null; error_code: string | null } | null;
  coverage_from: string | null;
  isync_lane?: { last_run_at: string | null; last_success_at: string | null; success_lag_min: number | null; last_error_code: string | null; last_records: number | null };
  call_log_sync?: { sync_time: string | null; last_full_sync_at: string | null; consecutive_expiries: number | null };
};

/**
 * One sync-state row. Only instants, counts and error codes are read: provider tokens
 * (`call_log_sync.token`, `message_sync.token`) are never projected, so they cannot leak here.
 * `observed_complete_through` is reported when present (A3-cap adds it).
 */
export function summarizeWatermark(scope: string, row: Document | null, now: Date): WatermarkSummary {
  const out: WatermarkSummary = {
    scope,
    present: Boolean(row),
    known_complete_through: isoOrNull(row?.known_complete_through),
    lag_min: lagMinutes(row?.known_complete_through, now),
    observed_complete_through: isoOrNull(row?.observed_complete_through),
    observed_lag_min: lagMinutes(row?.observed_complete_through, now),
    last_run: row?.last_run
      ? {
          started_at: isoOrNull(row.last_run.started_at),
          finished_at: isoOrNull(row.last_run.finished_at),
          error_code: row.last_run.error_code ?? null,
        }
      : null,
    coverage_from: isoOrNull(row?.cursor?.outreach_coverage_from),
  };
  if (row?.isync_lane)
    out.isync_lane = {
      last_run_at: isoOrNull(row.isync_lane.last_run_at),
      last_success_at: isoOrNull(row.isync_lane.last_success_at),
      success_lag_min: lagMinutes(row.isync_lane.last_success_at, now),
      last_error_code: row.isync_lane.last_error_code ?? null,
      last_records: typeof row.isync_lane.last_records === "number" ? row.isync_lane.last_records : null,
    };
  if (row?.call_log_sync)
    out.call_log_sync = {
      sync_time: isoOrNull(row.call_log_sync.sync_time),
      last_full_sync_at: isoOrNull(row.call_log_sync.last_full_sync_at),
      consecutive_expiries: typeof row.call_log_sync.consecutive_expiries === "number" ? row.call_log_sync.consecutive_expiries : null,
    };
  return out;
}

/**
 * The extension ids of the current rep SMS mailboxes at `now`: the configured account's links effective at `now`,
 * resolved by `reviewedRepMailboxes` (an extension resolves `reviewed` only through a `sales_rep` authority, so
 * reading every effective link of the account yields the same set as `listReviewedRepMailboxes`). No account → none.
 */
async function currentRepMailboxIds(reader: DeskStateReader, now: Date): Promise<string[]> {
  const account = configuredRingCentralAccountId();
  if (!account) return [];
  const links = await reader.find(
    "rep_identity_links",
    { rc_account_id: account, effective_from: { $lte: now }, $or: [{ effective_to: null }, { effective_to: { $gt: now } }] },
    {
      projection: { _id: 1, revision: 1, agent_id: 1, rc_account_id: 1, rc_extension_id: 1, role_kind: 1, status: 1, effective_from: 1, effective_to: 1, reviewed_at: 1, reviewed_by: 1 },
      limit: 1_000,
    },
  );
  return reviewedRepMailboxes(links as never, account, now).map((mailbox) => mailbox.extension_id);
}

/** Rep SMS mailboxes (`rep_sms:<extension>` rows): how many, never synced, worst lag. Extension ids are not listed. */
export function summarizeRepSmsMailboxes(rows: readonly Document[], now: Date) {
  const lags = rows.map((r) => lagMinutes(r.message_sync?.last_success_at, now));
  const known = lags.filter((l): l is number => l !== null);
  return {
    mailboxes: rows.length,
    never_synced: lags.length - known.length,
    worst_lag_min: known.length ? Math.max(...known) : null,
    best_lag_min: known.length ? Math.min(...known) : null,
  };
}

export type RepDaySummary = {
  business_day: string;
  rows: number;
  totals: { confirmed: number; awaiting_confirmation: number; other_outbound: number };
  count_scope: Counts;
  coverage_state: Counts;
  goal_state: Counts;
  reps: Array<{
    agent: string;
    count_scope: string;
    confirmed: number;
    awaiting_confirmation: number;
    other_outbound: number;
    goal: number | null;
    goal_state: string;
    coverage_state: string;
    coverage_reason: string | null;
    computed_as_of: string | null;
  }>;
};

const tally = (values: readonly string[]): Counts =>
  Object.fromEntries(
    Object.entries(values.reduce<Counts>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {})).sort(([a], [b]) => a.localeCompare(b)),
  );

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** One business day's rep-day rows, newest-confirmed first. `unattributed` is reported as other outbound. */
export function summarizeRepDays(businessDay: string, rows: readonly Document[]): RepDaySummary {
  const reps = rows
    .filter((r) => r.business_day === businessDay)
    .map((r) => ({
      agent: agentTail(r.agent_id),
      count_scope: keyOf(r.count_scope),
      confirmed: num(r.actual_confirmed),
      awaiting_confirmation: num(r.actual_awaiting_confirmation),
      other_outbound: num(r.unattributed),
      goal: typeof r.goal_snapshot?.goal === "number" ? r.goal_snapshot.goal : null,
      goal_state: keyOf(r.goal_state),
      coverage_state: keyOf(r.coverage?.state),
      coverage_reason: typeof r.coverage?.reason === "string" ? r.coverage.reason : null,
      computed_as_of: isoOrNull(r.computed_as_of),
    }))
    .sort((a, b) => b.confirmed - a.confirmed || a.agent.localeCompare(b.agent));
  return {
    business_day: businessDay,
    rows: reps.length,
    totals: {
      confirmed: reps.reduce((s, r) => s + r.confirmed, 0),
      awaiting_confirmation: reps.reduce((s, r) => s + r.awaiting_confirmation, 0),
      other_outbound: reps.reduce((s, r) => s + r.other_outbound, 0),
    },
    count_scope: tally(reps.map((r) => r.count_scope)),
    coverage_state: tally(reps.map((r) => r.coverage_state)),
    goal_state: tally(reps.map((r) => r.goal_state)),
    reps,
  };
}

/** A raw rep-day document as the desk read store maps it (`reads/store.ts` `findRepDayRows`). */
export function repDayRowOf(doc: Document): RepDayRow {
  const snapshot = doc.goal_snapshot;
  return {
    agent_id: String(doc.agent_id),
    business_day: String(doc.business_day),
    count_scope: doc.count_scope,
    goal_snapshot: snapshot
      ? {
          roster_version: snapshot.roster_version ?? null,
          configuration_version: snapshot.configuration_version ?? null,
          goal: snapshot.goal ?? null,
          scheduled: snapshot.scheduled ?? false,
          override: snapshot.override ?? null,
        }
      : null,
    actual_confirmed: num(doc.actual_confirmed),
    actual_awaiting_confirmation: num(doc.actual_awaiting_confirmation),
    unattributed: num(doc.unattributed),
    coverage: doc.coverage ?? null,
    computed_as_of: asDate(doc.computed_as_of),
    publication_revision: num(doc.publication_revision),
  };
}

export type ServedRepDays =
  | { business_day: string; available: false; reason: "configuration_not_active" }
  | {
      business_day: string;
      available: true;
      goal_metrics_enabled: boolean;
      /** The day's capture coverage before any row's own coverage is merged in (`repDayCoverage`). */
      capture_coverage: { state: string; known_complete_through: string | null; required_through: string | null };
      actual_basis: Counts;
      /** Roster reps with no rep-day row whose count still reads Pending (wave 1 expects 0 once coverage is complete). */
      pending_without_row: number;
      reps: Array<{
        agent: string;
        on_roster: boolean;
        has_row: boolean;
        goal_state: string;
        actual_basis: string;
        actual_confirmed: number | null;
        coverage_state: string;
      }>;
    };

/**
 * What `GET /rep-days` would serve for one day under this build, per rep: roster reps (roster order)
 * then Agents with a row that are not on the roster, the same composition as
 * `reads/service.ts` `composeRepDays` (`repDayCoverage` → `resolveRepDayGoal` → `composeRepDay`), so
 * `actual_basis` reads `projection`, `no_activity_recorded` or `pending` exactly as served. Names are
 * not read; agents are id tails. Served regardless of `controls.goal_metrics_enabled` (reported).
 */
export function composeServedRepDays(input: {
  business_day: string;
  today: string;
  now: Date;
  configuration: ConfigurationInspection;
  rows: readonly RepDayRow[];
  /** Capture + derivation call watermarks, as the read assembles them (`reads/service.ts` `repDayCallWatermarks`). */
  marks: CallWatermarks;
}): ServedRepDays {
  const { business_day, today, now, configuration } = input;
  if (configuration.state !== "active") return { business_day, available: false, reason: "configuration_not_active" };
  const goals = configuration.value.goals;
  const roster = (goals.rep_work_schedules ?? []).map((entry) => entry.agent_id);
  const rows = input.rows.filter((row) => row.business_day === business_day);
  const rowByAgent = new Map(rows.map((row) => [row.agent_id, row]));
  const agents = [...roster, ...rows.map((row) => row.agent_id).filter((id) => !roster.includes(id)).sort()];
  const capture = repDayCoverage(business_day, today, now, input.marks, deskTimingOf(configuration.value));
  const fallback = fallbackCountScope(goals, business_day);
  const reps = agents.map((agent_id) => {
    const row = rowByAgent.get(agent_id) ?? null;
    const served = composeRepDay({
      agent_id,
      agent_name: null,
      reviewed_link: false,
      goal: resolveRepDayGoal({ goals, configuration_version: configuration.version, agent_id, business_day, today, row }),
      row,
      fallback_scope: fallback,
      capture_coverage: capture,
    });
    return {
      agent: agentTail(agent_id),
      on_roster: roster.includes(agent_id),
      has_row: row !== null,
      goal_state: served.goal_state,
      actual_basis: served.actual_basis,
      actual_confirmed: served.actual_confirmed,
      coverage_state: served.coverage.state,
    };
  });
  return {
    business_day,
    available: true,
    goal_metrics_enabled: configuration.value.controls.goal_metrics_enabled,
    capture_coverage: { state: capture.state, known_complete_through: capture.known_complete_through ?? null, required_through: capture.required_through ?? null },
    actual_basis: tally(reps.map((rep) => rep.actual_basis)),
    pending_without_row: reps.filter((rep) => rep.on_roster && !rep.has_row && rep.actual_basis === "pending").length,
    reps,
  };
}

export type CallsFreshnessInputs = {
  /** `now` inside the staffed capture window [07:45, 20:30) New York, where the webhook counts (`reads/freshness.ts` `inStaffedCaptureWindow`). */
  in_staffed_window: boolean;
  lane_success_at: string | null;
  lane_success_lag_min: number | null;
  /**
   * The reconcile's sync success as the read takes it (`reads/store.ts` `toCallsCaptureRow`): the sticky
   * `reconcile_sync_success_at` (A3-cap), or the last run's `finished_at` when that run was in sync mode `on`,
   * stored a token and hit no sync error (the fallback for a row written before the sticky field); the later of the two.
   */
  reconcile: {
    finished_at: string | null;
    sync_mode: string | null;
    sync_token_stored: boolean | null;
    sync_error_code: string | null;
    sticky_success_at: string | null;
    success_at: string | null;
    success_lag_min: number | null;
  };
  /** max(lane success, reconcile success): the calls confirmation instant (`confirmation_success_at`). */
  confirmation_at: string | null;
  confirmation_lag_min: number | null;
  /** Newest call webhook receipt (`ringcentral_webhook_events`, telephony session present). */
  last_webhook_at: string | null;
  webhook_lag_min: number | null;
  known_complete_through_lag_min: number | null;
  observed_complete_through_lag_min: number | null;
  last_error_code: string | null;
  /** `freshness.calls` as `GET /team` serves it under this build (`composeFreshness` with these inputs); null while the configuration is not active. */
  served: { state: string; reason: string | null; last_updated_at: string | null; age_seconds: number | null } | null;
};

/**
 * The inputs of `freshness.calls.state`/`reason` (lane A A3-fresh) at `now`, read with the read's own
 * row mapping (`toCallsCaptureRow`), plus the served state itself (`composeFreshness`) when `timing`
 * (the active configuration's `deskTimingOf`) is given: the ISync lane success, the reconcile's sticky
 * sync success, their max, the newest call webhook receipt and the coverage lags.
 */
export function summarizeCallsFreshnessInputs(row: Document | null, lastWebhookAt: unknown, now: Date, timing: DeskTiming | null = null): CallsFreshnessInputs {
  const capture = row ? toCallsCaptureRow({ ...(row as SyncStateLean), scope: DESK_STATE_SCOPES.call_log }) : null;
  const lane = asDate(row?.isync_lane?.last_success_at);
  const run = row?.last_run ?? null;
  const tokenStored = typeof run?.sync_token_stored === "boolean" ? run.sync_token_stored : null;
  const syncError = typeof run?.sync_error_code === "string" && run.sync_error_code ? run.sync_error_code : null;
  const sticky = asDate(row?.reconcile_sync_success_at);
  // The reconcile's part of the confirmation: the read's own rule without the lane (`toCallsCaptureRow` minus `isync_lane`).
  const reconcile = row ? toCallsCaptureRow({ ...(row as SyncStateLean), scope: DESK_STATE_SCOPES.call_log, isync_lane: null }).confirmation_success_at ?? null : null;
  const confirmation = capture?.confirmation_success_at ?? null;
  const webhook = asDate(lastWebhookAt);
  const served = timing
    ? composeFreshness({ now, timing, calls: capture, last_call_webhook_at: webhook, sms_capture_enabled: false, sms_mailboxes: [], granot_last_observed_at: null }).calls
    : null;
  return {
    in_staffed_window: inStaffedCaptureWindow(now),
    lane_success_at: isoOrNull(lane),
    lane_success_lag_min: lagMinutes(lane, now),
    reconcile: {
      finished_at: isoOrNull(run?.finished_at),
      sync_mode: typeof run?.sync_mode === "string" ? run.sync_mode : null,
      sync_token_stored: tokenStored,
      sync_error_code: syncError,
      sticky_success_at: isoOrNull(sticky),
      success_at: isoOrNull(reconcile),
      success_lag_min: lagMinutes(reconcile, now),
    },
    confirmation_at: isoOrNull(confirmation),
    confirmation_lag_min: lagMinutes(confirmation, now),
    last_webhook_at: isoOrNull(webhook),
    webhook_lag_min: lagMinutes(webhook, now),
    known_complete_through_lag_min: lagMinutes(row?.known_complete_through, now),
    observed_complete_through_lag_min: lagMinutes(row?.observed_complete_through, now),
    last_error_code: typeof run?.error_code === "string" && run.error_code ? run.error_code : null,
    served: served ? { state: served.state, reason: served.reason ?? null, last_updated_at: served.last_updated_at ?? null, age_seconds: served.age_seconds ?? null } : null,
  };
}

export type SubjectsWithoutNumbersSummary = {
  /** Open (not closed) subjects with `contact_number_ids` empty or null that were checked. */
  checked: number;
  truncated: boolean;
  /**
   * Keys `status/lead_model/lead_phone`, lead_phone under the mint's rule (olr CW1 `leadNumberE164s`): `has_phone` (a
   * phone the mint can number), `no_phone` (no path forms an E.164), `not_candidate` (a Duplicate or Bad Lead: the mint
   * skips it whatever its phone) or `lead_missing`.
   */
  by_status_model_phone: Counts;
  /**
   * The wave-1 acceptance number (plan §6): active subjects without a number whose Lead the mint would number; 0 after
   * the C2b mint. A Lead whose only phones are company DIDs still counts (the full classification is the C2a diagnostic).
   */
  active_lead_has_phone: number;
};

/** A Lead's phone state under the mint's rule (olr CW1): the four phone paths through `leadPhonesOf`, the Duplicate / Bad Lead skips. */
export function leadPhoneStateOf(model: SalesOutreachLeadModel, lead: Document): "has_phone" | "no_phone" | "not_candidate" {
  const decision = leadNumberE164s(model, { ...leadPhonesOf(lead as LeadRow), duplicate: lead.duplicate ?? null, bad_lead: lead.bad_lead ?? null });
  if ("e164s" in decision) return "has_phone";
  return decision.skip === "no_phone" ? "no_phone" : "not_candidate";
}

/**
 * Subjects without a callable number, split by whether the C2b mint would number their Lead
 * (`leadPhoneStateOf`, the one phone rule of the mint, the C2a diagnostic and C2c). Only counts leave
 * this function: no phone, Lead or subject id.
 */
export function summarizeSubjectsWithoutNumbers(
  subjects: readonly Document[],
  leads: Readonly<Partial<Record<SalesOutreachLeadModel, readonly Document[]>>>,
  truncated: boolean,
): SubjectsWithoutNumbersSummary {
  const stateByLead = new Map<string, string>();
  for (const model of SALES_OUTREACH_LEAD_MODELS)
    for (const lead of leads[model] ?? []) stateByLead.set(`${model}:${String(lead._id)}`, leadPhoneStateOf(model, lead));
  const keys = subjects.map((subject) => {
    const model = keyOf(subject.lead_model);
    const state = stateByLead.get(`${model}:${String(subject.lead_id)}`) ?? "lead_missing";
    return { status: keyOf(subject.status), key: `${keyOf(subject.status)}/${model}/${state}` };
  });
  return {
    checked: subjects.length,
    truncated,
    by_status_model_phone: tally(keys.map((k) => k.key)),
    active_lead_has_phone: keys.filter((k) => k.status === "active" && k.key.endsWith("/has_phone")).length,
  };
}

// ---------------------------------------------------------------------------------------------
// Wave 2 acceptance (OPS-0c; plan §6 "wave 2, 20:25 ET" and "midnight")
// ---------------------------------------------------------------------------------------------

/** Channel fields read per active projection for the read-time verification tally (no display or customer field). */
export const VERIFICATION_PROJECTION = {
  _id: 0,
  subject_id: 1,
  exposure: 1,
  "call.status": 1,
  "call.due_at": 1,
  "call.oldest_actionable_due_at": 1,
  "sms.status": 1,
  "sms.due_at": 1,
  "sms.oldest_actionable_due_at": 1,
} as const;

/** A stored channel as `deriveChannelAt` needs it (status and deadlines; the rest is not read by the rule). */
function storedChannelOf(raw: unknown): StoredChannel {
  const c = (raw ?? {}) as Record<string, unknown>;
  return {
    required: null,
    verified_completed: null,
    remaining: null,
    due_at: asDate(c.due_at),
    oldest_actionable_due_at: asDate(c.oldest_actionable_due_at),
    status: (typeof c.status === "string" ? c.status : "pending") as StoredChannel["status"],
    completion_kind: null,
    coverage: null,
    blocked_reason: null,
  };
}

export type ChannelVerificationTally = {
  /** The channel's cadence coverage the rule judged with (null = no coverage: every passed deadline is unverified). */
  coverage_through: string | null;
  /** Stored `status` of the channel on active rows. */
  stored_status: Counts;
  /** Stored `overdue` (the engine stored it once coverage proved the deadline): the 20:25 ET number. */
  stored_overdue: number;
  /** Stored `due` whose `due_at` has passed by `as_of`. */
  due_passed: number;
  /** What the reads label overdue (`deriveChannelAt`): stored overdue + passed `due` proven by coverage. */
  read_overdue: number;
  /** What the reads label "due — not yet verified": passed `due` that coverage cannot prove yet (the 20:00 ET number). */
  read_due_unverified: number;
  oldest_unverified_since: string | null;
};

/**
 * One channel of active projections read at `now` with the read's own rule (`reads/present.ts`
 * `deriveChannelAt`, olr A2) and the channel's cadence `coverage`. Exposure masking is not applied (a
 * shadow row is counted as the engine stored it; `shadow_rows` says how many there are).
 */
export function tallyChannelVerification(rows: readonly Document[], channel: "call" | "sms", now: Date, coverage: Date | null): ChannelVerificationTally {
  let storedOverdue = 0;
  let duePassed = 0;
  let readOverdue = 0;
  let unverified = 0;
  let oldest: Date | null = null;
  const statuses: string[] = [];
  for (const row of rows) {
    const stored = storedChannelOf(row[channel]);
    statuses.push(stored.status);
    if (stored.status === "overdue") storedOverdue++;
    if (stored.status === "due" && stored.due_at && +stored.due_at <= +now) duePassed++;
    const read = deriveChannelAt(stored, now, coverage);
    if (read.status === "overdue") readOverdue++;
    if (read.verification?.state === "unverified") {
      unverified++;
      const since = read.verification.unverified_since;
      if (since && (!oldest || +since < +oldest)) oldest = since;
    }
  }
  return {
    coverage_through: isoOrNull(coverage),
    stored_status: tally(statuses),
    stored_overdue: storedOverdue,
    due_passed: duePassed,
    read_overdue: readOverdue,
    read_due_unverified: unverified,
    oldest_unverified_since: isoOrNull(oldest),
  };
}

/** Active rows the reads label overdue on either channel (`deriveChannelAt`); the label view of the team overdue count. */
export function rowsReadingOverdue(rows: readonly Document[], now: Date, coverage: ChannelCoverage): number {
  return rows.filter(
    (row) => deriveChannelAt(storedChannelOf(row.call), now, coverage.call).status === "overdue" || deriveChannelAt(storedChannelOf(row.sms), now, coverage.sms).status === "overdue",
  ).length;
}

/**
 * The design's independent count for `GET /team distinct_overdue_leads` (LANE-A A2 acceptance): active rows whose
 * `queue_keys.call_due` ≤ the call cutoff or `queue_keys.sms_due` ≤ the SMS cutoff, cutoff = min(as_of, cadence
 * coverage). Unlike the served rule (`reads/deskStore.ts` `mongoOverdueFilter`) it has no fallback for rows written
 * before A2 (no `sms_due`), so the two agree once engine v2 has rewritten every active row.
 */
export function designOverdueFilter(cutoffs: OverdueCutoffs): Filter<Document> {
  const or: Document[] = [{ "queue_keys.call_due": { $lte: cutoffs.call } }];
  if (cutoffs.sms) or.push({ "queue_keys.sms_due": { $lte: cutoffs.sms } });
  return { subject_status: "active", $or: or };
}

/** The closed-row `publication_revision` snapshot `--out` writes and `--compare` reads (subject id hex → revision). */
export type ClosedPublicationSnapshot = {
  tool: "sales-outreach-desk-state/closed-publication";
  version: 1;
  database: string;
  as_of: string;
  truncated: boolean;
  rows: Record<string, number>;
};

export const CLOSED_PUBLICATION_SNAPSHOT_TOOL = "sales-outreach-desk-state/closed-publication" as const;

/** A snapshot read back from a file; refuses anything that is not one (wrong tool, version, database name or row values). */
export function parseClosedPublicationSnapshot(raw: unknown): ClosedPublicationSnapshot {
  const doc = raw as Partial<ClosedPublicationSnapshot> | null;
  if (!doc || typeof doc !== "object" || doc.tool !== CLOSED_PUBLICATION_SNAPSHOT_TOOL || doc.version !== 1)
    throw new Error("--compare file is not a desk-state closed-publication snapshot (version 1)");
  if (typeof doc.database !== "string" || !/^[A-Za-z0-9_]+$/.test(doc.database)) throw new Error("--compare snapshot has no plain database name");
  if (typeof doc.as_of !== "string" || Number.isNaN(Date.parse(doc.as_of))) throw new Error("--compare snapshot has no valid as_of");
  if (!doc.rows || typeof doc.rows !== "object" || Array.isArray(doc.rows)) throw new Error("--compare snapshot has no rows map");
  for (const [id, revision] of Object.entries(doc.rows))
    if (!/^[0-9a-f]{24}$/.test(id) || typeof revision !== "number" || !Number.isFinite(revision)) throw new Error("--compare snapshot has an invalid row");
  return { tool: doc.tool, version: 1, database: doc.database, as_of: doc.as_of, truncated: doc.truncated === true, rows: doc.rows };
}

export type ClosedPublicationComparison = {
  previous_as_of: string;
  /** Closed rows present in both snapshots. */
  compared: number;
  unchanged: number;
  /** Plan §6 midnight check: closed rows unchanged, so this reads 0. */
  increased: number;
  decreased: number;
  /** Closed now, not in the previous snapshot (closed since it was taken). */
  newly_closed: number;
  /** In the previous snapshot, no longer a closed projection (cannot happen: closed is final; investigate). */
  missing: number;
  max_increase: number;
  /** Id tails of the first rows whose revision went up (sorted). */
  increased_subjects: string[];
};

/** Closed rows now against a previous snapshot (pure). */
export function compareClosedPublication(previous: ClosedPublicationSnapshot, current: Readonly<Record<string, number>>): ClosedPublicationComparison {
  let unchanged = 0;
  let decreased = 0;
  let maxIncrease = 0;
  const increased: string[] = [];
  for (const [id, before] of Object.entries(previous.rows)) {
    const now = current[id];
    if (now === undefined) continue;
    if (now === before) unchanged++;
    else if (now > before) {
      increased.push(id);
      maxIncrease = Math.max(maxIncrease, now - before);
    } else decreased++;
  }
  const compared = unchanged + increased.length + decreased;
  return {
    previous_as_of: previous.as_of,
    compared,
    unchanged,
    increased: increased.length,
    decreased,
    newly_closed: Object.keys(current).filter((id) => !(id in previous.rows)).length,
    missing: Object.keys(previous.rows).length - compared,
    max_increase: maxIncrease,
    increased_subjects: increased.sort().slice(0, LISTED_CHANGED_SUBJECTS).map(agentTail),
  };
}

export type OtherOutboundByDay = Record<string, Counts & { total: number }>;

/**
 * Confirmed events without an eligible subject, per business day and C8 bucket, from rows grouped by
 * `{day, reason}` after the rep-day dedupe (one source per rep-day). The bucket is the rep-day's own
 * (`contacts/repDay.ts` `otherOutboundBucketOf`: a missing reason or `eligible` reads `unknown`), so a day's
 * total is the sum of that day's rep-day `unattributed`.
 */
export function otherOutboundByDayOf(rows: readonly Document[]): OtherOutboundByDay {
  const out: OtherOutboundByDay = {};
  for (const row of rows) {
    const id = (row._id ?? {}) as { day?: unknown; reason?: unknown };
    const day = keyOf(id.day);
    const bucket = otherOutboundBucketOf((typeof id.reason === "string" ? id.reason : null) as SalesOutreachAssociationReason | null);
    const entry = (out[day] ??= { ...Object.fromEntries(SALES_OUTREACH_OTHER_OUTBOUND_BUCKETS.map((b) => [b, 0])), total: 0 } as Counts & { total: number });
    entry[bucket] = (entry[bucket] ?? 0) + num(row.n);
    entry.total += num(row.n);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => b.localeCompare(a)));
}

export type RepDayOtherOutboundByDay = Record<string, { rows: number; rows_with_breakdown: number; unattributed: number; breakdown: Counts; breakdown_total: number }>;

/** Stored rep-day rows summed per business day (`$group` by `business_day`): the breakdown the team card sums, against `unattributed`. */
export function repDayOtherOutboundOf(rows: readonly Document[]): RepDayOtherOutboundByDay {
  return Object.fromEntries(
    rows
      .map((row) => {
        const breakdown = Object.fromEntries(SALES_OUTREACH_OTHER_OUTBOUND_BUCKETS.map((b) => [b, num(row[b])]));
        return [
          keyOf(row._id),
          {
            rows: num(row.rows),
            rows_with_breakdown: num(row.rows_with_breakdown),
            unattributed: num(row.unattributed),
            breakdown,
            breakdown_total: Object.values(breakdown).reduce((s, n) => s + n, 0),
          },
        ] as const;
      })
      .sort(([a], [b]) => b.localeCompare(a)),
  );
}

export type ConfigurationSummary = {
  state: ConfigurationInspection["state"];
  reason: string | null;
  revision: number | null;
  version: string | null;
  updated_at: string | null;
  approval_ref: string | null;
  versions_stored: number;
  /** R0: the stored hash against the stored raw value (A0's path) and against this build's parsed value (legacy path). */
  integrity: { stored_hash_present: boolean; pointer_matches_version: boolean | null; raw_hash_matches: boolean | null; parsed_hash_matches: boolean | null; parse_ok: boolean | null };
  namespace_key_counts: Counts;
  controls: unknown;
  transition: unknown;
  migration: unknown;
  evidence: unknown;
  operations: unknown;
  cadence: { policy_version: unknown; approval_ref: unknown; priority_map: unknown; intake_default_rule: unknown; no_contact_number_rule: unknown };
  goals: { roster_size: number | null; roster_version: unknown; default_scheduled_goal: unknown; day_overrides: number | null; count_scope_schedule: unknown };
};

const sha256Of = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

/**
 * Configuration facts. `inspection` is this build's loader verdict (what `GET /configuration` would
 * say if this commit were deployed); `integrity` shows both hash paths so the R0 hazard is visible
 * before a schema change ships. Goal roster entries are counted, never listed.
 */
export function summarizeConfiguration(input: {
  inspection: ConfigurationInspection;
  pointer: Document | null;
  version: Document | null;
  versions_stored: number;
}): ConfigurationSummary {
  const { inspection, pointer, version } = input;
  const raw = (version?.value ?? null) as Record<string, Record<string, unknown> | undefined> | null;
  const stored = typeof version?.content_hash === "string" && version.content_hash ? version.content_hash : null;
  const parsed = raw ? salesOutreachConfigurationValueSchema.safeParse(raw) : null;
  const goals = raw?.goals;
  return {
    state: inspection.state,
    reason: inspection.state === "unavailable" ? inspection.reason : null,
    revision: typeof pointer?.revision === "number" ? pointer.revision : null,
    version: typeof pointer?.version === "string" ? pointer.version : null,
    updated_at: isoOrNull(pointer?.updatedAt),
    approval_ref: typeof version?.approval_ref === "string" ? version.approval_ref : null,
    versions_stored: input.versions_stored,
    integrity: {
      stored_hash_present: Boolean(stored),
      pointer_matches_version: pointer && version ? pointer.content_hash === version.content_hash : null,
      raw_hash_matches: raw && stored ? sha256Of(raw) === stored : null,
      parsed_hash_matches: parsed?.success && stored ? configurationContentHash(parsed.data) === stored : null,
      parse_ok: parsed ? parsed.success : null,
    },
    namespace_key_counts: raw ? Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v && typeof v === "object" ? Object.keys(v).length : 0])) : {},
    controls: raw?.controls ?? null,
    transition: raw?.transition ?? null,
    migration: raw?.migration ?? null,
    evidence: raw?.evidence ?? null,
    operations: raw?.operations ?? null,
    cadence: {
      policy_version: raw?.cadence?.policy_version ?? null,
      approval_ref: raw?.cadence?.approval_ref ?? null,
      priority_map: raw?.cadence?.priority_map ?? null,
      intake_default_rule: raw?.cadence?.intake_default_rule ?? null,
      no_contact_number_rule: raw?.cadence?.no_contact_number_rule ?? null,
    },
    goals: {
      roster_size: Array.isArray(goals?.rep_work_schedules) ? goals.rep_work_schedules.length : null,
      roster_version: goals?.roster_version ?? null,
      default_scheduled_goal: goals?.default_scheduled_goal ?? null,
      day_overrides: Array.isArray(goals?.effective_day_overrides) ? goals.effective_day_overrides.length : null,
      count_scope_schedule: goals?.count_scope_schedule ?? null,
    },
  };
}

/** A configuration store over the read-only reader, so the snapshot runs this build's real loader. */
export function readerConfigurationStore(reader: DeskStateReader): ConfigurationStore {
  return {
    async readPointer() {
      const row = await reader.findOne("sales_outreach_configuration", { kind: "pointer", key: SALES_OUTREACH_CONFIGURATION_POINTER_KEY });
      if (!row) return null;
      return {
        id: String(row._id),
        version: String(row.version),
        content_hash: row.content_hash ?? "",
        revision: row.revision ?? 0,
        updated_by: row.updated_by ?? null,
        updated_at: row.updatedAt ?? null,
      };
    },
    async readVersion(version) {
      const row = await reader.findOne("sales_outreach_configuration", { kind: "version", key: salesOutreachConfigurationVersionKey(version) });
      if (!row) return null;
      return {
        version: String(row.version),
        value: row.value,
        content_hash: row.content_hash ?? "",
        approval_ref: row.approval_ref ?? null,
        created_by: row.created_by?.id ?? null,
        created_at: row.createdAt ?? null,
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------------------------

const groupCount = (field: string) => [{ $group: { _id: `$${field}`, n: { $sum: 1 } } }];
const flagSum = (flag: string) => ({ $sum: { $cond: [`$status_flags.${flag}`, 1, 0] } });
const STATUS_FLAGS = ["needs_contact", "overdue", "pending", "blocked", "job_pending", "move_date_passed", "move_date_unknown", "advisory_cooldown"] as const;

/**
 * Every row of `collection` matching `filter`, keyset-paged on the unique `subject_id` (pages of the reader's
 * find cap), up to `cap` rows; `truncated` when the cap stopped it.
 */
export async function findBySubjectPages(
  reader: DeskStateReader,
  collection: string,
  filter: Filter<Document>,
  projection: Document,
  cap = PROJECTION_SCAN_CAP,
): Promise<{ rows: Document[]; truncated: boolean }> {
  const rows: Document[] = [];
  let after: unknown = null;
  while (rows.length < cap) {
    const limit = Math.min(FIND_LIMIT_CAP, cap - rows.length);
    const page = await reader.find(collection, after === null ? filter : { $and: [filter, { subject_id: { $gt: after } }] }, { projection: { ...projection, subject_id: 1 }, sort: { subject_id: 1 }, limit });
    rows.push(...page);
    if (page.length < limit) return { rows, truncated: false };
    after = page.at(-1)!.subject_id;
  }
  return { rows, truncated: true };
}

export type DeskStateContext = {
  database: string;
  now: Date;
  /** A previous closed-row snapshot (`--compare`); it must be of the same database. */
  previous_closed_snapshot?: ClosedPublicationSnapshot | null;
};

export type DeskState = Awaited<ReturnType<typeof collectDeskState>>;

/** Every query of PRODUCTION-STATE.md, read-only, against one database at one reference instant. */
export async function collectDeskState(reader: DeskStateReader, context: DeskStateContext) {
  return (await collectDeskStateWithSnapshot(reader, context)).state;
}

/** `collectDeskState` plus this run's closed-row `publication_revision` snapshot (what `--out` writes; ids are not in the summary). */
export async function collectDeskStateWithSnapshot(reader: DeskStateReader, context: DeskStateContext) {
  const { now } = context;
  const previous = context.previous_closed_snapshot ?? null;
  if (previous && previous.database !== context.database)
    throw new Error(`--compare snapshot is of database '${previous.database}', not '${context.database}'`);
  const today = newYorkBusinessDay(now);
  const yesterday = addDays(today, -1);
  const ago = (ms: number) => new Date(now.getTime() - ms);

  // Configuration
  const pointer = await reader.findOne("sales_outreach_configuration", { kind: "pointer", key: SALES_OUTREACH_CONFIGURATION_POINTER_KEY });
  const versionRow =
    pointer && typeof pointer.version === "string"
      ? await reader.findOne("sales_outreach_configuration", { kind: "version", key: salesOutreachConfigurationVersionKey(pointer.version) })
      : null;
  const inspection = await createConfigurationLoader(readerConfigurationStore(reader)).inspect();
  const configuration = summarizeConfiguration({
    inspection,
    pointer,
    version: versionRow,
    versions_stored: await reader.count("sales_outreach_configuration", { kind: "version" }),
  });
  /** The active configuration's timing (`deskTimingOf`); null while it is not active (served values are then not computed). */
  const timing = inspection.state === "active" ? deskTimingOf(inspection.value) : null;

  // Subjects and periods
  const S = "sales_outreach_subjects";
  const subjects = {
    total: await reader.count(S),
    by_status: countsOf(await reader.aggregate(S, groupCount("status"))),
    by_enrollment_kind: countsOf(await reader.aggregate(S, groupCount("enrollment.kind"))),
    unassigned_active: await reader.count(S, { status: "active", assigned_agent_id: null }),
    active_without_contact_number: await reader.count(S, { status: "active", $or: [{ contact_number_ids: { $size: 0 } }, { contact_number_ids: null }] }),
    active_by_priority: countsOf(await reader.aggregate(S, [{ $match: { status: "active" } }, ...groupCount("priority.raw")])),
    review_reasons: countsOf(await reader.aggregate(S, [{ $unwind: "$review_reasons" }, ...groupCount("review_reasons")])),
  };
  const P = "sales_outreach_policy_periods";
  const periods = {
    total: await reader.count(P),
    ended: await reader.count(P, { ended_at: { $ne: null } }),
    active_by_workflow_start: countsOf(
      await reader.aggregate(P, [{ $match: { ended_at: null } }, { $group: { _id: { workflow: "$workflow", start_kind: "$start_kind" }, n: { $sum: 1 } } }]),
    ),
  };

  // Projections
  const J = "sales_outreach_projections";
  const active = { subject_status: "active" };
  const closed = { subject_status: "closed" };
  const notClosed = { subject_status: { $ne: "closed" } };
  const evaluationHistogram = async (match: Document) =>
    countsOf(
      await reader.aggregate(J, [
        { $match: { ...match, next_evaluation_at: { $ne: null } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%dT%HZ", date: "$next_evaluation_at" } }, n: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $limit: NEXT_EVALUATION_HISTOGRAM_BUCKETS },
      ]),
    );
  const [flags] = await reader.aggregate(J, [
    { $match: active },
    { $group: { _id: null, ...Object.fromEntries(STATUS_FLAGS.map((f) => [f, flagSum(f)])) } },
  ]);
  const projections = {
    total: await reader.count(J),
    by_subject_status: countsOf(await reader.aggregate(J, groupCount("subject_status"))),
    by_exposure: countsOf(await reader.aggregate(J, groupCount("exposure"))),
    by_workflow: countsOf(await reader.aggregate(J, groupCount("workflow"))),
    by_engine_version: countsOf(await reader.aggregate(J, groupCount("engine_version"))),
    by_configuration_version: countsOf(await reader.aggregate(J, groupCount("configuration_version"))),
    active_call_status: countsOf(await reader.aggregate(J, [{ $match: active }, ...groupCount("call.status")])),
    active_sms_status: countsOf(await reader.aggregate(J, [{ $match: active }, ...groupCount("sms.status")])),
    active_status_flags: Object.fromEntries(STATUS_FLAGS.map((f) => [f, num(flags?.[f])])),
    /** The team overdue card's figure: active rows whose earliest actionable deadline has passed. */
    team_overdue_urgency_due_passed: await reader.count(J, { ...active, "queue_keys.urgency_due": { $lte: now } }),
    unassigned_due_calls: await reader.count(J, { ...active, assigned_agent_id: null, "call.status": { $in: ["due", "overdue"] } }),
    next_evaluation: {
      past_due: await reader.count(J, { next_evaluation_at: { $lte: now } }),
      none: await reader.count(J, { next_evaluation_at: null }),
      by_utc_hour: await evaluationHistogram({}),
      /** OPS-0c (A4): active and review rows. */
      by_utc_hour_open: await evaluationHistogram(notClosed),
      /** OPS-0c (A4): closed rows still scheduled; empty once engine v2 has rewritten them. */
      by_utc_hour_closed: await evaluationHistogram(closed),
      /** A4 acceptance: 0 within 15 min of the engine-v2 deploy. */
      closed_scheduled: await reader.count(J, { ...closed, next_evaluation_at: { $ne: null } }),
      open_none: await reader.count(J, { ...notClosed, next_evaluation_at: null }),
    },
    oldest_computed_as_of: isoOrNull((await reader.find(J, {}, { projection: { _id: 0, computed_as_of: 1 }, sort: { computed_as_of: 1 }, limit: 1 }))[0]?.computed_as_of),
  };

  // Jobs (`completed_at` is the TTL-indexed completion instant)
  const Q = "sales_intelligence_jobs";
  const open = await reader.aggregate(Q, [
    { $match: { status: { $in: [...OPEN_JOB_STATUSES] } } },
    { $group: { _id: { stage: "$stage", status: "$status" }, n: { $sum: 1 } } },
  ]);
  const completedSince = async (ms: number) =>
    countsOf(await reader.aggregate(Q, [{ $match: { completed_at: { $gte: ago(ms) } } }, ...groupCount("stage")]));
  const oldestDue = await reader.aggregate(Q, [
    { $match: { status: { $in: ["pending", "retry"] } } },
    { $group: { _id: "$stage", oldest_next_attempt_at: { $min: "$next_attempt_at" } } },
    { $sort: { _id: 1 } },
  ]);
  const jobs = {
    open_by_stage_status: nestedCountsOf(open, "stage", "status"),
    dead_letters_total: open.filter((r) => r._id?.status === "dead_letter").reduce((s, r) => s + num(r.n), 0),
    pending_or_retry_due_now: await reader.count(Q, { status: { $in: ["pending", "retry"] }, next_attempt_at: { $lte: now } }),
    oldest_pending_or_retry_by_stage: Object.fromEntries(oldestDue.map((r) => [keyOf(r._id), isoOrNull(r.oldest_next_attempt_at)])),
    completed_last_10_min_by_stage: await completedSince(10 * 60_000),
    completed_last_hour_by_stage: await completedSince(60 * 60_000),
  };

  // Watermarks and subscriptions (no token field is projected)
  const W = "sales_intelligence_sync_state";
  const watermarkProjection = {
    _id: 0,
    scope: 1,
    known_complete_through: 1,
    observed_complete_through: 1,
    "last_run.started_at": 1,
    "last_run.finished_at": 1,
    "last_run.error_code": 1,
    "last_run.sync_token_stored": 1,
    "last_run.sync_error_code": 1,
    "last_run.sync_mode": 1,
    reconcile_sync_success_at: 1,
    "cursor.outreach_coverage_from": 1,
    "isync_lane.last_run_at": 1,
    "isync_lane.last_success_at": 1,
    "isync_lane.last_error_code": 1,
    "isync_lane.last_records": 1,
    "call_log_sync.sync_time": 1,
    "call_log_sync.last_full_sync_at": 1,
    "call_log_sync.consecutive_expiries": 1,
  };
  const scopeRows = await reader.find(W, { scope: { $in: Object.values(DESK_STATE_SCOPES) } }, { projection: watermarkProjection, limit: 20 });
  const rowOf = (scope: string) => scopeRows.find((r) => r.scope === scope) ?? null;
  const watermarks = Object.fromEntries(Object.entries(DESK_STATE_SCOPES).map(([name, scope]) => [name, summarizeWatermark(scope, rowOf(scope), now)]));
  const mailboxes = await reader.find(W, { scope: { $regex: /^rep_sms:/ } }, { projection: { _id: 0, scope: 1, known_complete_through: 1, "message_sync.last_success_at": 1 }, limit: 500 });
  const subscriptions = countsOf(
    await reader.aggregate("ringcentral_webhook_subscriptions", [{ $group: { _id: { purpose: "$purpose", status: "$status" }, n: { $sum: 1 } } }]),
  );
  // Newest call webhook receipt (`{provider, receivedAt}` index); only `receivedAt` is projected.
  const webhookCollection = getRingCentralCollectionName("webhookEvents");
  const [lastCallWebhook] = await reader.find(
    webhookCollection,
    { provider: "ringcentral", telephonySessionId: { $type: "string" } },
    { projection: { _id: 0, receivedAt: 1 }, sort: { receivedAt: -1 }, limit: 1 },
  );
  const freshness_inputs = {
    webhook_collection: webhookCollection,
    calls: summarizeCallsFreshnessInputs(rowOf(DESK_STATE_SCOPES.call_log), lastCallWebhook?.receivedAt ?? null, now, timing),
  };

  // Rep-days
  const R = "sales_outreach_rep_day_projections";
  const repDayRows = await reader.find(
    R,
    { business_day: { $in: [yesterday, today] } },
    {
      projection: {
        _id: 0,
        agent_id: 1,
        business_day: 1,
        count_scope: 1,
        actual_confirmed: 1,
        actual_awaiting_confirmation: 1,
        unattributed: 1,
        goal_snapshot: 1,
        goal_state: 1,
        coverage: 1,
        computed_as_of: 1,
        publication_revision: 1,
      },
      limit: 500,
    },
  );
  const recentFrom = addDays(today, -(RECENT_REP_DAYS - 1));
  const recent = await reader.aggregate(R, [
    { $match: { business_day: { $gte: recentFrom } } },
    {
      $group: {
        _id: { day: "$business_day", scope: "$count_scope" },
        rows: { $sum: 1 },
        confirmed: { $sum: "$actual_confirmed" },
        awaiting_confirmation: { $sum: "$actual_awaiting_confirmation" },
        other_outbound: { $sum: "$unattributed" },
      },
    },
    { $sort: { "_id.day": -1, "_id.scope": 1 } },
  ]);
  const contactCallsRow = rowOf(DESK_STATE_SCOPES.contact_calls);
  const callLogRow = rowOf(DESK_STATE_SCOPES.call_log);
  const marks: CallWatermarks = {
    capture_known: asDate(callLogRow?.known_complete_through),
    capture_observed: asDate(callLogRow?.observed_complete_through),
    derived_known: asDate(contactCallsRow?.known_complete_through),
    derived_observed: asDate(contactCallsRow?.observed_complete_through),
    coverage_from: asDate(contactCallsRow?.cursor?.outreach_coverage_from),
  };
  const servedRows = repDayRows.map(repDayRowOf);
  const served = (business_day: string) => composeServedRepDays({ business_day, today, now, configuration: inspection, rows: servedRows, marks });
  const rep_days = {
    today: summarizeRepDays(today, repDayRows),
    yesterday: summarizeRepDays(yesterday, repDayRows),
    /** What `GET /rep-days` serves under this build: `actual_basis` per rep, roster reps without a row included. */
    today_served: served(today),
    yesterday_served: served(yesterday),
    recent_by_day_scope: recent.map((r) => ({
      business_day: keyOf(r._id?.day),
      count_scope: keyOf(r._id?.scope),
      rows: num(r.rows),
      confirmed: num(r.confirmed),
      awaiting_confirmation: num(r.awaiting_confirmation),
      other_outbound: num(r.other_outbound),
    })),
    /** OPS-0c (C8): stored rows' "Other outbound" breakdown summed per day (`rows_with_breakdown` < `rows` until the re-derive/recount), against `unattributed`. */
    other_outbound_by_day: repDayOtherOutboundOf(
      await reader.aggregate(R, [
        { $match: { business_day: { $gte: recentFrom } } },
        {
          $group: {
            _id: "$business_day",
            rows: { $sum: 1 },
            rows_with_breakdown: { $sum: { $cond: [{ $eq: [{ $type: "$other_outbound" }, "object"] }, 1, 0] } },
            unattributed: { $sum: "$unattributed" },
            ...Object.fromEntries(SALES_OUTREACH_OTHER_OUTBOUND_BUCKETS.map((b) => [b, { $sum: `$other_outbound.${b}` }])),
          },
        },
      ]),
    ),
  };

  // Contact events
  const E = "sales_outreach_contact_events";
  const eventsOn = async (day: string) =>
    countsOf(
      await reader.aggregate(E, [
        { $match: { business_date: day } },
        {
          $group: {
            _id: { source_kind: "$source_kind", direction: "$direction", goal_credit: "$goal_credit", association: "$association", eligible: "$goal_scope_eligible" },
            n: { $sum: 1 },
          },
        },
      ]),
    );
  const contact_events = {
    total: await reader.count(E),
    by_kind: countsOf(await reader.aggregate(E, groupCount("kind"))),
    by_goal_credit: countsOf(await reader.aggregate(E, groupCount("goal_credit"))),
    by_association: countsOf(await reader.aggregate(E, groupCount("association"))),
    awaiting_by_business_date: countsOf(
      await reader.aggregate(E, [{ $match: { goal_credit: "awaiting_confirmation" } }, ...groupCount("business_date"), { $sort: { _id: -1 } }, { $limit: LISTED_DAYS }]),
    ),
    /** Keys: `source_kind/direction/goal_credit/association/goal_scope_eligible`. */
    today_by_source_direction_credit_association_eligible: await eventsOn(today),
    yesterday_by_source_direction_credit_association_eligible: await eventsOn(yesterday),
    /** OPS-0c (C8): every event of the last ten business days by stored `association_reason` (`null` = derived before C8 or excluded before association). */
    association_reason_by_day: nestedCountsOf(
      await reader.aggregate(E, [
        { $match: { business_date: { $gte: recentFrom } } },
        { $group: { _id: { day: "$business_date", reason: "$association_reason" }, n: { $sum: 1 } } },
      ]),
      "day",
      "reason",
    ),
    /**
     * OPS-0c (C8 acceptance): confirmed rep-attributed events without an eligible subject, one per source per
     * rep-day (the rep-day count's dedupe), by "Other outbound" bucket per day; a day's `total` is the sum of
     * its rep-days' `unattributed`.
     */
    other_outbound_by_day: otherOutboundByDayOf(
      await reader.aggregate(E, [
        { $match: { business_date: { $gte: recentFrom }, goal_agent_id: { $ne: null }, goal_credit: "confirmed", goal_scope_eligible: { $ne: true } } },
        { $group: { _id: { day: "$business_date", agent: "$goal_agent_id", source: "$source_id" }, reason: { $first: "$association_reason" } } },
        { $group: { _id: { day: "$_id.day", reason: "$reason" }, n: { $sum: 1 } } },
      ]),
    ),
  };

  // Calls not yet confirmed by the Call Log (`terminal` false or never seen in the Call Log)
  const C = "call_interactions";
  const unconfirmed = { $or: [{ terminal: { $ne: true } }, { call_log_state: null }] };
  const beforeCc04 = { started_at: { $lt: DESK_STATE_CC04_INSTANT } };
  const unconfirmedByDirection = countsOf(await reader.aggregate(C, [{ $match: unconfirmed }, ...groupCount("direction")]));
  const call_interactions = {
    total: await reader.count(C),
    unconfirmed_total: await reader.count(C, unconfirmed),
    unconfirmed_by_utc_day: countsOf(
      await reader.aggregate(C, [
        { $match: unconfirmed },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$started_at" } }, n: { $sum: 1 } } },
        { $sort: { _id: -1 } },
        { $limit: LISTED_DAYS },
      ]),
    ),
    /** `Internal` rows (left null by OPS-1 on purpose) apart from `Inbound`/`Outbound`; a null direction reads `null`. */
    unconfirmed_by_direction: unconfirmedByDirection,
    unconfirmed_inbound_outbound_total: EXTERNAL_CALL_DIRECTIONS.reduce((sum, d) => sum + (unconfirmedByDirection[d] ?? 0), 0),
    unconfirmed_internal_total: unconfirmedByDirection.Internal ?? 0,
    unconfirmed_by_utc_day_direction: nestedCountsOf(
      await reader.aggregate(C, [
        { $match: unconfirmed },
        { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$started_at" } }, direction: "$direction" }, n: { $sum: 1 } } },
        { $sort: { "_id.day": -1, "_id.direction": 1 } },
        { $limit: LISTED_DAYS * 4 },
      ]),
      "day",
      "direction",
    ),
    /** Plan §6 wave 0 after OPS-1: `inbound_outbound` reads 0; `internal` keeps the Internal rows OPS-1 leaves alone. */
    before_cc04: {
      instant: DESK_STATE_CC04_INSTANT.toISOString(),
      inbound_outbound: await reader.count(C, { ...unconfirmed, ...beforeCc04, direction: { $in: [...EXTERNAL_CALL_DIRECTIONS] } }),
      internal: await reader.count(C, { ...unconfirmed, ...beforeCc04, direction: "Internal" }),
    },
  };

  // Open subjects without a Contact Number, by whether their Lead has a phone (C2 acceptance).
  const withoutNumbers = await reader.find(
    S,
    { status: { $ne: "closed" }, $or: [{ contact_number_ids: { $size: 0 } }, { contact_number_ids: null }] },
    { projection: { _id: 0, status: 1, lead_model: 1, lead_id: 1 }, limit: SUBJECTS_WITHOUT_NUMBERS_CAP },
  );
  const leadsByModel: Partial<Record<SalesOutreachLeadModel, Document[]>> = {};
  for (const model of SALES_OUTREACH_LEAD_MODELS) {
    const ids = withoutNumbers.filter((s) => s.lead_model === model).map((s) => s.lead_id);
    if (ids.length) leadsByModel[model] = await reader.find(LEAD_COLLECTIONS[model], { _id: { $in: ids } }, { projection: LEAD_PHONE_PROJECTION, limit: ids.length });
  }
  const subjects_without_numbers = summarizeSubjectsWithoutNumbers(withoutNumbers, leadsByModel, withoutNumbers.length >= SUBJECTS_WITHOUT_NUMBERS_CAP);

  const rep_sms_evidence = {
    total: await reader.count("ringcentral_rep_sms_evidence"),
    by_identity_status: countsOf(
      await reader.aggregate("ringcentral_rep_sms_evidence", [{ $group: { _id: { identity: "$identity_state", status: "$status" }, n: { $sum: 1 } } }]),
    ),
  };

  const enrollment_runs = (
    await reader.find(
      "sales_outreach_enrollment_runs",
      {},
      { projection: { _id: 0, run_key: 1, mode: 1, kind: 1, status: 1, activation_at: 1, started_at: 1, finished_at: 1, counts: 1 }, sort: { started_at: -1 }, limit: LISTED_ENROLLMENT_RUNS },
    )
  ).map((r) => ({
    run_key: keyOf(r.run_key),
    mode: keyOf(r.mode),
    kind: keyOf(r.kind),
    status: keyOf(r.status),
    activation_at: isoOrNull(r.activation_at),
    started_at: isoOrNull(r.started_at),
    finished_at: isoOrNull(r.finished_at),
    counts: Object.fromEntries(Object.entries((r.counts ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === "number")),
  }));

  // Wave 2 acceptance (OPS-0c): read-time verification, overdue counts, coverage waits, quiet closed rows.
  const smsCaptureEnabled = inspection.state === "active" && inspection.value.controls.rep_sms_capture_enabled;
  /**
   * The channels' cadence coverage, as the evaluation, the evaluate sweep and every desk read compute it (`engineCoverageOf`);
   * SMS over the current mailboxes only (`currentSmsMailboxRows`, the same `reviewedRepMailboxes` rule as `listReviewedRepMailboxes`).
   */
  const smsThrough = smsCaptureEnabled ? smsCoverage(currentSmsMailboxRows(mailboxes, await currentRepMailboxIds(reader, now))) : null;
  const cadence: ChannelCoverage = timing ? engineCoverageOf({ calls: marks, sms_known_complete_through: smsThrough }, timing) : { call: null, sms: null };
  const activeRows = await findBySubjectPages(reader, J, active, VERIFICATION_PROJECTION);
  const cutoffs = overdueCutoffs(now, cadence);
  const coverageWait = async (channel: "call" | "sms") => {
    const path = `coverage_wait.${channel}`;
    const through = cadence[channel];
    const proven = through ? { [path]: { $ne: null, $lte: through } } : null;
    return {
      through: isoOrNull(through),
      waiting: await reader.count(J, { [path]: { $ne: null } }),
      /** The sweep's coverage-repair set (`coverage_wait` ≤ current cadence coverage): 0 once the nominated jobs have drained. */
      proven: proven ? await reader.count(J, proven) : null,
      proven_and_pending: proven ? await reader.count(J, { ...proven, "status_flags.pending": true }) : null,
      oldest_proven_wait: proven
        ? isoOrNull((await reader.find(J, proven, { projection: { _id: 0, [path]: 1 }, sort: { [path]: 1 }, limit: 1 }))[0]?.coverage_wait?.[channel])
        : null,
      closed_waiting: await reader.count(J, { ...closed, [path]: { $ne: null } }),
    };
  };
  const closedRows = await findBySubjectPages(reader, J, closed, { _id: 0, publication_revision: 1 });
  const closedSnapshot: ClosedPublicationSnapshot = {
    tool: CLOSED_PUBLICATION_SNAPSHOT_TOOL,
    version: 1,
    database: context.database,
    as_of: now.toISOString(),
    truncated: closedRows.truncated,
    rows: Object.fromEntries(closedRows.rows.map((row) => [String(row.subject_id), num(row.publication_revision)])),
  };
  const wave2_acceptance = {
    cadence_coverage: { available: timing !== null, call_through: isoOrNull(cadence.call), sms_through: isoOrNull(cadence.sms), sms_capture_enabled: smsCaptureEnabled },
    active_rows: activeRows.rows.length,
    active_rows_truncated: activeRows.truncated,
    shadow_rows: activeRows.rows.filter((row) => row.exposure === "shadow").length,
    /** Plan §6: at 20:00 ET `call.read_due_unverified`; at 20:25 ET `call.stored_overdue` ≈ that minus the calls confirmed since. */
    call: tallyChannelVerification(activeRows.rows, "call", now, cadence.call),
    sms: tallyChannelVerification(activeRows.rows, "sms", now, cadence.sms),
    rows_reading_overdue: rowsReadingOverdue(activeRows.rows, now, cadence),
    /** Plan §6: `served_rule` is `GET /team distinct_overdue_leads` under this build; `design_count` the LANE-A A2 formula; equal once every active row carries `sms_due`. */
    distinct_overdue_leads: cutoffs
      ? {
          available: true as const,
          cutoffs: { call: cutoffs.call.toISOString(), sms: isoOrNull(cutoffs.sms) },
          served_rule: await reader.count(J, mongoOverdueFilter(cutoffs)),
          design_count: await reader.count(J, designOverdueFilter(cutoffs)),
          active_without_sms_due: await reader.count(J, { ...active, "queue_keys.sms_due": { $exists: false } }),
        }
      : { available: false as const, unknown_reason: "coverage_incomplete" as const },
    /** Plan §6: no projection waits on coverage the cadence coverage already proves (`proven` 0 outside the sweep's minute). */
    coverage_wait: { call: await coverageWait("call"), sms: await coverageWait("sms") },
    /** Plan §6 midnight: closed rows keep their `publication_revision` (`comparison.increased` 0 with `--compare`). */
    closed_publication: {
      rows: closedRows.rows.length,
      truncated: closedRows.truncated,
      revision_sum: Object.values(closedSnapshot.rows).reduce((s, n) => s + n, 0),
      rewritten_since_ny_midnight: await reader.count(J, { ...closed, computed_as_of: { $gte: newYorkDayBounds(today).start } }),
      comparison: previous ? compareClosedPublication(previous, closedSnapshot.rows) : null,
    },
  };

  const state = {
    tool: "sales-outreach-desk-state" as const,
    summary_version: DESK_STATE_SUMMARY_VERSION,
    database: context.database,
    as_of: now.toISOString(),
    ny_today: today,
    ny_yesterday: yesterday,
    configuration,
    subjects,
    periods,
    projections,
    jobs,
    watermarks,
    rep_sms_mailboxes: summarizeRepSmsMailboxes(mailboxes, now),
    subscriptions,
    freshness_inputs,
    rep_days,
    contact_events,
    call_interactions,
    rep_sms_evidence,
    subjects_without_numbers,
    enrollment_runs,
    wave2_acceptance,
  };
  return { state, closed_snapshot: closedSnapshot };
}
