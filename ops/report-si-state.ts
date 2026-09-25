/**
 * S10-REPAIR step 9 (reconciliation addendum §5): the read-only Sales Intelligence state report.
 *
 *   node --env-file=.env --import tsx ops/report-si-state.ts --allow-production [--before=<S10-6 summary>] [--since=<ISO>]
 *
 * It reports, at one `as_of`:
 *   1. band counts before (step 6's `S10-6-<env>.json`: `bands_before`, and `bands_after` when it was an apply) vs
 *      after (the current Attention snapshot: every row's `filter_keys.band`, and the Needs Attention view);
 *   2. band transitions by `cause.kind` × `estimated` (`outreach_band_transitions`, S9-PUBLISH) since `--since`
 *      (default: the step-6 `as_of`, else 30 days);
 *   3. the `live_call` count (snapshot `filter_keys.live_call`);
 *   4. `capture_health` (the Owner coverage read's block, and `readCaptureHealthStatus` at `as_of`);
 *   5. Numbers by `created_via` (absent = `call`) × `has_calls`;
 *   6. Outreach records by `assignment.origin` (active, and closed in the last 90 days);
 *   7. open follow-ups by `origin` × `date_resolution.precision`.
 *
 * READ-ONLY. It never writes: reads, aggregations and `explain` only (replica proof: the server's `top`
 * write counters and dbHash around the CLI, `test-si-s10-dry-runs.ts`). The S10 drift guard applies to
 * writers only, so it is not called; `--allow-production` is still required for any database that is not a
 * loopback `testvantagemovers_*` one. Each aggregation is indexed or bounded, and its cost is measured with
 * `explain("executionStats")` (docs / keys examined, index, ms) and printed in the report (`--no-explain`
 * skips that second pass).
 *
 * Output: `sales-intelligence-ui-ux-workspace/evidence/S10-9-<env>.md` + `.json` (or `--report-dir`).
 * Identifiers and counts only.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import mongoose, { type PipelineStage } from "mongoose";
import { connectMongo } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { csiFlag } from "../src/config/domain/salesIntelligence";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../src/models/OutreachFollowup";
import { getOutreachBandTransitionModel } from "../src/models/salesIntelligence/outreach";
import { readOverviewIndex, tallyNow } from "../src/services/salesIntelligence/overview/now";
import { readCaptureHealthStatus, readOwnerCoverage } from "../src/services/salesIntelligence/ownerCoverage";
import { resolvePolicy } from "../src/services/salesIntelligence/policy";

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);
const WORKSPACE_EVIDENCE = resolve(process.cwd(), "../sales-intelligence-ui-ux-workspace/evidence");
const localDatabase = (database: string, uri: string | undefined) =>
  /^testvantagemovers_[a-z0-9]+$/i.test(database) && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri ?? "");
const ACTIVE_STATES = ["unworked", "open", "waiting_on_customer", "identity_review"];
const CLOSED_LOOKBACK_MS = 90 * 86_400_000;
const BANDS = ["1", "2", "3", "4", "5", "6", "7", "none"] as const;

type Tally = Record<string, number>;
export type QueryCost = { name: string; collection: string; docs_examined: number | null; keys_examined: number | null; returned: number | null; index: string[]; ms: number | null; wall_ms: number };
export type SiStateReport = {
  version: "report-si-state-v1"; database: string; env: string; as_of: string; generated_at: string;
  before: { source: string | null; mode: string | null; as_of: string | null; bands_before: Tally | null; bands_after: Tally | null };
  snapshot: { snapshot_id: string | null; as_of: string | null; rows: number; bands_all: Tally; bands_active: Tally; bands_closed_partition: Tally; needs_attention: Tally;
    live_call_rows: number; live_calls_active: number; needs_review: number; unassigned: number; active: number } | null;
  transitions: { since: string; total: number; by_cause: Array<{ kind: string; estimated: boolean; count: number }>; all_time_estimate: number };
  capture_health: { status_at_as_of: string; block: unknown | null; error: string | null };
  numbers_by_created_via: Array<{ created_via: string; has_calls: boolean; count: number }>;
  records_by_assignment_origin: { active: Array<{ origin: string; state: string; count: number }>; closed_90d: Array<{ origin: string; count: number }> };
  open_followups: Array<{ origin: string; precision: string; kind: string; count: number }>;
  flags: Record<string, boolean>;
  costs: QueryCost[];
};

/** The first numeric value of `key` anywhere in an explain document (classic and SBE layouts differ). */
function deepNumber(doc: unknown, key: string): number | null {
  if (!doc || typeof doc !== "object") return null;
  const record = doc as Record<string, unknown>;
  if (typeof record[key] === "number") return record[key] as number;
  for (const value of Object.values(record)) {
    const hit = Array.isArray(value) ? value.map(v => deepNumber(v, key)).find(v => v !== null) ?? null : deepNumber(value, key);
    if (hit !== null) return hit;
  }
  return null;
}
function indexNames(doc: unknown, out = new Set<string>()): string[] {
  if (!doc || typeof doc !== "object") return [...out];
  const record = doc as Record<string, unknown>;
  if (typeof record.indexName === "string") out.add(record.indexName);
  if (record.stage === "COLLSCAN") out.add("COLLSCAN");
  for (const value of Object.values(record)) (Array.isArray(value) ? value : [value]).forEach(v => indexNames(v, out));
  return [...out];
}

/** One aggregation, timed, plus (unless `--no-explain`) its `explain("executionStats")` cost. */
async function measured<T>(costs: QueryCost[], name: string, model: mongoose.Model<any>, pipeline: PipelineStage[], explain: boolean): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const t0 = Date.now();
  const rows = await model.aggregate<T>(pipeline);
  const cost: QueryCost = { name, collection: model.collection.collectionName, docs_examined: null, keys_examined: null, returned: rows.length, index: [], ms: null, wall_ms: Date.now() - t0 };
  if (explain) {
    const plan = await model.aggregate(pipeline).explain("executionStats");
    cost.docs_examined = deepNumber(plan, "totalDocsExamined");
    cost.keys_examined = deepNumber(plan, "totalKeysExamined");
    cost.ms = deepNumber(plan, "executionTimeMillis") ?? deepNumber(plan, "executionTimeMillisEstimate");
    cost.index = indexNames(plan);
  }
  costs.push(cost);
  return rows;
}

function readBefore(path: string | null) {
  if (!path || !existsSync(path)) return { source: null, mode: null, as_of: null, bands_before: null, bands_after: null };
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { mode?: string; as_of?: string; bands_before?: Tally | null; bands_after?: Tally | null };
  return { source: path, mode: parsed.mode ?? null, as_of: parsed.as_of ?? null, bands_before: parsed.bands_before ?? null, bands_after: parsed.bands_after ?? null };
}

export async function buildSiStateReport(options: { asOf: Date; beforePath: string | null; since: Date | null; explain: boolean; env: string }): Promise<SiStateReport> {
  const { asOf } = options;
  const costs: QueryCost[] = [];
  const before = readBefore(options.beforePath);
  const since = options.since ?? (before.as_of ? new Date(before.as_of) : new Date(+asOf - 30 * 86_400_000));

  // 1 + 3. The current Attention snapshot (header + payload by _id: two indexed reads).
  const t0 = Date.now();
  const index = await readOverviewIndex(asOf);
  costs.push({ name: "attention_snapshot (header + index payload)", collection: "sales_intelligence_attention_snapshots", docs_examined: null, keys_examined: null,
    returned: index?.entries.length ?? 0, index: ["dataset/as_of header lookup", "_id"], ms: null, wall_ms: Date.now() - t0 });
  let snapshot: SiStateReport["snapshot"] = null;
  if (index) {
    const bands_all: Tally = {}, bands_active: Tally = {}, bands_closed_partition: Tally = {};
    let liveRows = 0;
    for (const entry of index.entries) {
      const band = entry.filter_keys.band == null ? "none" : String(entry.filter_keys.band);
      bands_all[band] = (bands_all[band] ?? 0) + 1;
      if (entry.partition === "closed") bands_closed_partition[band] = (bands_closed_partition[band] ?? 0) + 1;
      else if (entry.filter_keys.state !== "closed") bands_active[band] = (bands_active[band] ?? 0) + 1;
      if (entry.filter_keys.live_call) liveRows++;
    }
    const now = tallyNow(index.entries, {}, index.as_of);
    snapshot = { snapshot_id: index.snapshot_id, as_of: index.as_of.toISOString(), rows: index.entries.length, bands_all, bands_active, bands_closed_partition,
      needs_attention: Object.fromEntries(Object.entries(now.bands).filter(([, v]) => v > 0)), live_call_rows: liveRows, live_calls_active: now.live_calls,
      needs_review: now.needs_review, unassigned: now.unassigned, active: now.active };
  }

  // 2. Band transitions by cause (band_transition_at {at:1}).
  const Transitions = getOutreachBandTransitionModel();
  const byCause = await measured<{ _id: { kind: string | null; estimated: boolean | null }; count: number }>(costs, "band transitions by cause", Transitions,
    [{ $match: { at: { $gte: since, $lte: asOf } } }, { $group: { _id: { kind: "$cause.kind", estimated: "$estimated" }, count: { $sum: 1 } } }, { $sort: { "_id.kind": 1, "_id.estimated": 1 } }], options.explain);
  const allTime = await Transitions.estimatedDocumentCount();

  // 4. capture_health.
  const policy = await resolvePolicy();
  const status = await readCaptureHealthStatus(asOf, { timezone: policy.timezone, staffed_hours: policy.staffed_hours });
  let block: unknown = null, error: string | null = null;
  try { block = (await readOwnerCoverage()).capture_health ?? null; } catch (e) { error = e instanceof Error ? e.message : String(e); }

  // 5. Numbers by created_via × has_calls (the `contact_number_kind_*` indexes: `kind` prefix).
  const numbers = await measured<{ _id: { created_via: string; has_calls: boolean }; count: number }>(costs, "Numbers by created_via × has_calls", getContactNumberModel(), [
    { $match: { kind: "external", purged_at: null } },
    { $group: { _id: { created_via: { $ifNull: ["$created_via", "call (absent)"] }, has_calls: { $gt: [{ $ifNull: ["$rollups.interactions_total", 0] }, 0] } }, count: { $sum: 1 } } },
    { $sort: { "_id.created_via": 1, "_id.has_calls": 1 } },
  ], options.explain);

  // 6. Records by assignment.origin: active (`outreach_state_due` {state}) and closed in 90 days (`outreach_state_closed` {state, closed_at}).
  const Records = getOutreachRecordModel();
  const activeOrigins = await measured<{ _id: { origin: string; state: string }; count: number }>(costs, "active records by assignment.origin", Records, [
    { $match: { state: { $in: ACTIVE_STATES }, purged_at: null } },
    { $group: { _id: { origin: { $ifNull: ["$assignment.origin", "none"] }, state: "$state" }, count: { $sum: 1 } } },
    { $sort: { "_id.origin": 1, "_id.state": 1 } },
  ], options.explain);
  const closedOrigins = await measured<{ _id: string; count: number }>(costs, "records closed in 90 days by assignment.origin", Records, [
    { $match: { state: "closed", closed_at: { $gte: new Date(+asOf - CLOSED_LOOKBACK_MS), $lte: asOf }, purged_at: null } },
    { $group: { _id: { $ifNull: ["$assignment.origin", "none"] }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ], options.explain);

  // 7. Open follow-ups by origin × precision (`followup_due` {status, due_at}).
  const followups = await measured<{ _id: { origin: string; precision: string; kind: string }; count: number }>(costs, "open follow-ups by origin × precision", getOutreachFollowupModel(), [
    { $match: { status: "open" } },
    { $group: { _id: { origin: { $ifNull: ["$origin", "none"] }, precision: { $ifNull: ["$date_resolution.precision", "none"] }, kind: { $ifNull: ["$kind", "none"] } }, count: { $sum: 1 } } },
    { $sort: { "_id.origin": 1, "_id.precision": 1, "_id.kind": 1 } },
  ], options.explain);

  return {
    version: "report-si-state-v1", database: getMongoDatabaseName(), env: options.env, as_of: asOf.toISOString(), generated_at: new Date().toISOString(),
    before, snapshot,
    transitions: { since: since.toISOString(), total: byCause.reduce((s, r) => s + r.count, 0), by_cause: byCause.map(r => ({ kind: r._id.kind ?? "none", estimated: Boolean(r._id.estimated), count: r.count })), all_time_estimate: allTime },
    capture_health: { status_at_as_of: status, block, error },
    numbers_by_created_via: numbers.map(r => ({ created_via: r._id.created_via, has_calls: r._id.has_calls, count: r.count })),
    records_by_assignment_origin: { active: activeOrigins.map(r => ({ origin: r._id.origin, state: r._id.state, count: r.count })), closed_90d: closedOrigins.map(r => ({ origin: r._id, count: r.count })) },
    open_followups: followups.map(r => ({ origin: r._id.origin, precision: r._id.precision, kind: r._id.kind, count: r.count })),
    flags: Object.fromEntries((["OVERVIEW", "ATTENTION_V2", "ATTENTION_EVOLUTION", "PRIORITY5_CLOSURE", "RECEIVER_ASSIGNMENT", "FORM_LEAD_NUMBERS", "CAPTURE_WEBHOOK"] as const).map(n => [n, csiFlag(n as never)])),
    costs,
  };
}

export function renderSiStateReport(r: SiStateReport): string {
  const table = (head: string[], rows: Array<Array<string | number>>) => rows.length ? [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map(row => `| ${row.join(" | ")} |`)] : ["(none)"];
  const b = (t: Tally | null | undefined, k: string) => (t ? t[k] ?? 0 : "—");
  const s = r.snapshot;
  const health = r.capture_health.block as { status?: string; reasons?: unknown[] } | null;
  return [
    `# S10 step 9: Sales Intelligence state report (${r.env})`, "",
    `- Database \`${r.database}\`; as_of ${r.as_of}; generated ${r.generated_at}. Read only (\`ops/report-si-state.ts\`).`,
    `- Before: ${r.before.source ? `\`${r.before.source}\` (${r.before.mode}, as_of ${r.before.as_of})` : "no step-6 summary found"}. Snapshot: ${s ? `\`${s.snapshot_id}\` as_of ${s.as_of}, ${s.rows} rows` : "none published"}.`,
    `- Flags in this process: ${Object.entries(r.flags).map(([k, v]) => `${k}=${v}`).join(", ")}`, "",
    "## 1. Bands before (step 6) vs after (current snapshot)", "",
    "Step 6 derives every candidate (active, plus closed in 90 days) at its `as_of`; the snapshot columns are the published rows. `Needs Attention` is what `GET /attention` counts.", "",
    ...table(["Band", "Step 6 before", "Step 6 after (apply)", "Snapshot: active rows", "Snapshot: closed partition", "Snapshot: all rows", "Needs Attention now"],
      BANDS.map(k => [k, b(r.before.bands_before, k), b(r.before.bands_after, k), b(s?.bands_active, k), b(s?.bands_closed_partition, k), b(s?.bands_all, k), k === "none" ? "—" : b(s?.needs_attention, k)])), "",
    s ? `Active rows ${s.active}; needs review ${s.needs_review}; unassigned (Needs Attention) ${s.unassigned}.` : "", "",
    `## 2. Band transitions by cause (since ${r.transitions.since})`, "",
    ...table(["cause.kind", "estimated", "count"], r.transitions.by_cause.map(x => [`\`${x.kind}\``, String(x.estimated), x.count])), "",
    `Total in window ${r.transitions.total}; collection size (estimate) ${r.transitions.all_time_estimate}. Baseline and \`policy\` rows are excluded from flow metrics (addendum §4.3).`, "",
    "## 3. Live calls", "",
    s ? `Rows with \`filter_keys.live_call\`: **${s.live_call_rows}** (active records: ${s.live_calls_active}; the Overview "now" \`live_calls\`).` : "No snapshot.", "",
    "## 4. `capture_health`", "",
    `Status at as_of: **${r.capture_health.status_at_as_of}**. Owner coverage block: ${health ? `status \`${health.status}\`, reasons \`${JSON.stringify(health.reasons ?? [])}\`` : `unavailable (${r.capture_health.error ?? "absent"})`}.`, "",
    "## 5. Numbers by `created_via` (external, not purged)", "",
    ...table(["created_via", "has_calls", "count"], r.numbers_by_created_via.map(x => [`\`${x.created_via}\``, String(x.has_calls), x.count])), "",
    "## 6. Records by `assignment.origin`", "",
    ...table(["origin", "state", "count"], r.records_by_assignment_origin.active.map(x => [`\`${x.origin}\``, x.state, x.count])), "",
    "Closed in the last 90 days:", "",
    ...table(["origin", "count"], r.records_by_assignment_origin.closed_90d.map(x => [`\`${x.origin}\``, x.count])), "",
    "## 7. Open follow-ups by origin and precision", "",
    ...table(["origin", "precision", "kind", "count"], r.open_followups.map(x => [`\`${x.origin}\``, x.precision, x.kind, x.count])), "",
    "## Query cost", "",
    ...table(["query", "collection", "index", "docs examined", "keys examined", "rows", "ms (explain)", "ms (wall)"],
      r.costs.map(c => [c.name, c.collection, c.index.join(", ") || "—", c.docs_examined ?? "—", c.keys_examined ?? "—", c.returned ?? "—", c.ms ?? "—", c.wall_ms])), "",
    "Plus: `capture_health` = the Owner coverage read (its bounded reads, S5c-HEALTH: ≤ 6 indexed queries for the block) and `readCaptureHealthStatus`; the transitions collection size is `estimatedDocumentCount` (metadata).", "",
  ].join("\n");
}

async function main() {
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  await connectMongo();
  const database = getMongoDatabaseName();
  const production = database === "vantagemovers";
  const local = localDatabase(database, process.env.MONGO_URI);
  if (!local && !flag("allow-production")) throw new Error(`${database} is not a loopback testvantagemovers_* database; pass --allow-production`);
  const env = production ? "production" : local ? "replica" : database;
  const asOf = arg("as-of") ? new Date(arg("as-of")!) : new Date();
  if (arg("as-of") && (!local || !Number.isFinite(+asOf))) throw new Error("--as-of is a replica-only fixed clock");
  const reportDir = arg("report-dir") ?? (existsSync(WORKSPACE_EVIDENCE) ? WORKSPACE_EVIDENCE : "ops/output");
  const defaultBefore = [join(reportDir, `S10-6-${env}.json`), join(reportDir, `S10-6-${env}-dry-run.json`)].find(p => existsSync(p)) ?? null;
  const report = await buildSiStateReport({ asOf, beforePath: arg("before") ?? defaultBefore, since: arg("since") ? new Date(arg("since")!) : null, explain: !flag("no-explain"), env });
  await mkdir(reportDir, { recursive: true });
  const base = join(reportDir, `S10-9-${env}`);
  await writeFile(`${base}.json`, JSON.stringify(report, null, 1) + "\n");
  await writeFile(`${base}.md`, renderSiStateReport(report));
  console.log(JSON.stringify({ report: `${base}.md`, json: `${base}.json`, snapshot: report.snapshot?.snapshot_id ?? null, transitions: report.transitions.total,
    live_calls: report.snapshot?.live_call_rows ?? null, capture_health: report.capture_health.status_at_as_of }));
}
if (require.main === module) {
  main().then(() => mongoose.disconnect()).then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
}
