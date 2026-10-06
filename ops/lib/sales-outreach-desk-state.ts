/**
 * Read-only state snapshot of the Sales Outreach Desk (outreach lifecycle repair OPS-0): the queries
 * the operator runs before and after every deploy and every operator step (PRODUCTION-STATE.md),
 * shaped into one JSON summary. `ops/sales-outreach/desk-state.ts` is the CLI.
 *
 * Read-only by construction: the collector only sees `DeskStateReader` (counts, bounded finds and
 * aggregations whose pipelines are refused when they contain `$out`/`$merge`), and the CLI also
 * installs the driver-level read guard (`installReadOnlyCommandGuard`) that exits before any
 * non-read command is sent. The summary carries counts, instants, run keys, configuration values and
 * Agent id tails only: no Lead, customer, phone, message or token field is ever projected.
 */
import { createHash } from "node:crypto";
import type { Db, Document, Filter, MongoClient } from "mongodb";
import { OUTREACH_CONTACT_CALLS_SCOPE, OUTREACH_CONTACT_SMS_SCOPE } from "../../src/config/domain/salesOutreachContacts";
import {
  SALES_OUTREACH_CONFIGURATION_POINTER_KEY,
  salesOutreachConfigurationVersionKey,
} from "../../src/models/salesOutreach/configuration";
import { canonicalJson } from "../../src/services/durableWork/checksum";
import { addDays } from "../../src/services/salesOutreach/engine/calendar";
import { createConfigurationLoader, type ConfigurationInspection } from "../../src/services/salesOutreach/config/load";
import { configurationContentHash, type ConfigurationStore } from "../../src/services/salesOutreach/config/store";
import { newYorkBusinessDay } from "../../src/services/salesOutreach/reads/businessDay";
import { salesOutreachConfigurationValueSchema } from "../../src/validation/v1/salesOutreach";
import { assertReadOnlyPipeline, isCommandAllowed } from "../slimming/lib/guarded-mongo";

export const DESK_STATE_SUMMARY_VERSION = 1;

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

// ---------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------

export type DeskStateArgs = { target: string; pretty: boolean };

/**
 * `--target=<database>` is required (never inferred) and must later equal the resolved database;
 * `--pretty` indents the JSON. There is no write mode, so no `--apply`; unknown flags are refused.
 */
export function parseDeskStateArgs(argv: readonly string[]): DeskStateArgs {
  let target: string | null = null;
  let pretty = false;
  for (const arg of argv) {
    if (arg.startsWith("--target=")) target = arg.slice("--target=".length).trim();
    else if (arg === "--pretty") pretty = true;
    else if (arg === "--apply") throw new Error("desk-state is read-only; there is no --apply");
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!target) throw new Error("--target=<database name> is required (for example --target=vantagemovers)");
  if (!/^[A-Za-z0-9_]+$/.test(target)) throw new Error("--target must be a plain database name");
  return { target, pretty };
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

export type DeskState = Awaited<ReturnType<typeof collectDeskState>>;

/** Every query of PRODUCTION-STATE.md, read-only, against one database at one reference instant. */
export async function collectDeskState(reader: DeskStateReader, context: { database: string; now: Date }) {
  const { now } = context;
  const today = newYorkBusinessDay(now);
  const yesterday = addDays(today, -1);
  const ago = (ms: number) => new Date(now.getTime() - ms);

  // Configuration
  const pointer = await reader.findOne("sales_outreach_configuration", { kind: "pointer", key: SALES_OUTREACH_CONFIGURATION_POINTER_KEY });
  const versionRow =
    pointer && typeof pointer.version === "string"
      ? await reader.findOne("sales_outreach_configuration", { kind: "version", key: salesOutreachConfigurationVersionKey(pointer.version) })
      : null;
  const configuration = summarizeConfiguration({
    inspection: await createConfigurationLoader(readerConfigurationStore(reader)).inspect(),
    pointer,
    version: versionRow,
    versions_stored: await reader.count("sales_outreach_configuration", { kind: "version" }),
  });

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
      by_utc_hour: countsOf(
        await reader.aggregate(J, [
          { $match: { next_evaluation_at: { $ne: null } } },
          { $group: { _id: { $dateToString: { format: "%Y-%m-%dT%HZ", date: "$next_evaluation_at" } }, n: { $sum: 1 } } },
          { $sort: { _id: 1 } },
          { $limit: NEXT_EVALUATION_HISTOGRAM_BUCKETS },
        ]),
      ),
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
  const mailboxes = await reader.find(W, { scope: { $regex: /^rep_sms:/ } }, { projection: { _id: 0, "message_sync.last_success_at": 1 }, limit: 500 });
  const subscriptions = countsOf(
    await reader.aggregate("ringcentral_webhook_subscriptions", [{ $group: { _id: { purpose: "$purpose", status: "$status" }, n: { $sum: 1 } } }]),
  );

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
        "goal_snapshot.goal": 1,
        goal_state: 1,
        "coverage.state": 1,
        "coverage.reason": 1,
        computed_as_of: 1,
      },
      limit: 500,
    },
  );
  const recent = await reader.aggregate(R, [
    { $match: { business_day: { $gte: addDays(today, -(RECENT_REP_DAYS - 1)) } } },
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
  const rep_days = {
    today: summarizeRepDays(today, repDayRows),
    yesterday: summarizeRepDays(yesterday, repDayRows),
    recent_by_day_scope: recent.map((r) => ({
      business_day: keyOf(r._id?.day),
      count_scope: keyOf(r._id?.scope),
      rows: num(r.rows),
      confirmed: num(r.confirmed),
      awaiting_confirmation: num(r.awaiting_confirmation),
      other_outbound: num(r.other_outbound),
    })),
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
  };

  // Calls not yet confirmed by the Call Log (`terminal` false or never seen in the Call Log)
  const C = "call_interactions";
  const unconfirmed = { $or: [{ terminal: { $ne: true } }, { call_log_state: null }] };
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
  };

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

  return {
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
    rep_days,
    contact_events,
    call_interactions,
    rep_sms_evidence,
    enrollment_runs,
  };
}
