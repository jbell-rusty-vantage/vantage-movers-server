/**
 * Full Sales Intelligence backfill on the operator's personal gateway key (handoff
 * `CSI-PERSONAL-KEY-FULL-BACKFILL-HANDOFF.md` §4–§7). Used by `ops/backfill-csi-full-personal.ts` and its
 * replica proof (`ops/full-backfill.replica.test.ts`).
 *
 * Phases (§4): 0 configure the paid process (entry point) → 1 finish the CC-07 repair's held work
 * (the repair's own script, spawned by the entry point) → 2 free read-only work set + estimate →
 * 3 conversations grouped by Number, oldest first, each analysis claimed by id and its application
 * run in-process → 4 one Number synthesis per Number through the scheduled `csi:number-analysis:<id>:<gen>`
 * job, made due and claimed by id in the same moment → 5 verification (§7) into the manifest.
 *
 * Job-claim exclusivity (§5): every unit is claimed by id the instant it becomes due; a unit this run
 * creates is born on `operator_hold` (status `paused`, which no cron, drain or queue claim takes) and is
 * released and claimed in the same moment; anything that cannot run now goes back on `operator_hold`
 * with its `prior_status` / `prior_reason`. Holds the CC-07 repair owns are never touched; S10 (foreign)
 * holds are driven (`--s10-holds drive`, `by: "s10-hold"`) or left and listed (`leave`).
 *
 * Terminal runtime failures (paused `permission_denied`, paused `budget_exhausted`/`per_recording_ceiling`,
 * `dead_letter`) of in-scope conversations and Numbers are re-driven: the same job is re-armed by id when
 * its run can resume under the target layout and model (or it has no run yet), otherwise it is
 * superseded (paused → `completed` with `result.reason: superseded_by_full_backfill`, its unfinished run
 * `stale`; a dead letter is left as it is) and fresh work is made the normal way. The prior state is
 * recorded on the unit (`prior`). Application jobs paused as `shadow_analysis` are never touched.
 *
 * Manifests and logs carry identifiers, counts and outcomes only: no phone numbers, names or content.
 */
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import mongoose from "mongoose";
import { withTransaction } from "../../src/db";
import { CSI_BACKFILL_JOB_PRIORITY, CSI_EXTRACTION_MODELS, csiDataset } from "../../src/config/domain/salesIntelligence";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getLeadConversationModel } from "../../src/models/LeadConversation";
import { getIntelligenceRunModel } from "../../src/models/IntelligenceRun";
import { getIntelligenceSubmissionModel } from "../../src/models/IntelligenceSubmission";
import { getIntelligenceEvidenceSnapshotModel } from "../../src/models/IntelligenceEvidenceSnapshot";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceAiReservationModel } from "../../src/models/SalesIntelligenceAiReservation";
import { getSalesIntelligenceAiBudgetModel } from "../../src/models/SalesIntelligenceAiBudget";
import { enqueueCsiJob } from "../../src/services/salesIntelligence/jobs";
import { ensureCurrentCsiBudgetPeriod } from "../../src/services/salesIntelligence/budgetPeriod";
import { payloadHash } from "../../src/services/salesIntelligence/transactions";
import { intelligenceSources } from "../../src/services/salesIntelligence/analysis/sources";
import { scheduleNumberIntelligence } from "../../src/services/salesIntelligence/analysis/scheduling";
import { runIntelligenceJob } from "../../src/services/salesIntelligence/analysis/worker";
import { runIntelligenceApplicationJob } from "../../src/services/salesIntelligence/analysis/apply";
import {
  CASE_FILE_CONTEXT_STEP_VERSION, CASE_FILE_FINDINGS_PROMPT_VERSION, CASE_FILE_SUMMARY_PROMPT_VERSION, CONTEXT_STEP_VERSION,
  FINDINGS_PROMPT_VERSION, STRUCTURED_PIPELINE, SUMMARY_PROMPT_VERSION, structuredStepContracts,
} from "../../src/services/salesIntelligence/analysis/structuredPrompt";
import { continueStructuredAnalysis, runBoundedBackfill, waitForBackfillPeer } from "./backfill-csi-structured-analysis.lib";

export const FULL_BACKFILL_MANIFEST_VERSION = "csi-full-backfill-v1" as const;
export const OPERATOR_HOLD_REASON = "operator_hold";
export const REPAIR_MANIFEST_VERSION = "call-log-repair-v1";
/** Namespace of the fresh work this backfill creates; a dedupe in it proves the job is this backfill's. */
export const OWN_DEDUPE_MARK = ":full-backfill:";
export const OWN_NUMBER_DEDUPE_PREFIX = "csi:number-analysis:full-backfill:";
export const SUPERSEDED_REASON = "superseded_by_full_backfill";
/** One synthesis per Number; a second only when the first one's own application moved the fingerprint. */
export const MAX_SYNTHESES_PER_NUMBER = 2;
const CLAIM_ATTEMPTS = 3;
/**
 * Estimate report only: hours left in the active period. The paid run ensures the current period before the run and
 * before every paid unit (`ensureCurrentCsiBudgetPeriod`). A rollover is not seamless: activating the new period resumes
 * every `budget_exhausted` pause (`resumeBudgetPausedJobs`), so a unit paused in that instant can be released to
 * production before this run holds it; `runUnit` then claims it at once or records it as a peer.
 */
export const BUDGET_PERIOD_MIN_HOURS = 12;
/** Nominal per-step cents (`structuredGeneration.ts` fallback) when too few reconciled reservations exist. */
export const NOMINAL_CENTS = { summary: 2, findings: 5 } as const;
const MIN_SAMPLES = 20;
/** Paused reasons that are terminal runtime failures (or budget pauses production would resume on the company key). */
const REDRIVE_PAUSE_REASONS = new Set(["permission_denied", "budget_exhausted", "per_recording_ceiling"]);
/** Outcomes that stop the whole run: the process is misconfigured or out of budget. */
const FATAL_REASONS = new Set(["analysis_configuration_missing", "budget_exhausted", "no_active_period", "monthly_budget", "analysis_disabled"]);

// ── Layout and CLI ─────────────────────────────────────────────────────────────
export type Layout = "case_file" | "default";
export type TargetVersions = { layout: Layout; summary: string; findings: string; context: string; pipeline: string };
/** The versions a run records under the layout; read from `structuredPrompt.ts`, never hardcoded. */
export function targetVersions(layout: Layout): TargetVersions {
  return layout === "case_file"
    ? { layout, summary: CASE_FILE_SUMMARY_PROMPT_VERSION, findings: CASE_FILE_FINDINGS_PROMPT_VERSION, context: CASE_FILE_CONTEXT_STEP_VERSION, pipeline: STRUCTURED_PIPELINE }
    : { layout, summary: SUMMARY_PROMPT_VERSION, findings: FINDINGS_PROMPT_VERSION, context: CONTEXT_STEP_VERSION, pipeline: STRUCTURED_PIPELINE };
}
/** The step contracts a run prepared under the layout pins (`run.ts`); a paused run resumes only when they match. */
export const targetContractsDigest = (layout: Layout) => payloadHash(structuredStepContracts(layout === "case_file" ? "case_file" : "legacy"));

export type CliOptions = {
  mode: "estimate" | "apply";
  allowProduction: boolean;
  concurrency: number;
  numbers: string[] | null;
  maxNumbers: number | null;
  since: Date | null;
  resume: boolean;
  manifest: string | null;
  layout: Layout;
  s10Holds: "drive" | "leave";
  repairManifest: string | null;
  skipRepair: boolean;
  repairMaxWaitMinutes: number;
  /** Phase 1 watchdog: the repair child is stopped (phase failed, resumable) after this long with no output. */
  repairIdleMinutes: number;
  json: string | null;
};
const OBJECT_ID = /^[a-f\d]{24}$/i;
export function parseCliOptions(argv: readonly string[]): CliOptions {
  const value = (name: string) => {
    const at = argv.indexOf(name);
    if (at < 0) return undefined;
    const next = argv[at + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing ${name} value`);
    return next;
  };
  const has = (name: string) => argv.includes(name);
  if (has("--release-holds")) throw new Error("--release-holds is not supported: held units are driven in-process or left held");
  if (has("--allow-schema-drift")) throw new Error("--allow-schema-drift is never allowed on a paid run: run from the deployed commit");
  if (has("--estimate") && has("--confirm-write")) throw new Error("--estimate is read-only; drop it to write with --confirm-write");
  const concurrency = Number(value("--concurrency") ?? 2);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error("--concurrency must be 1..3");
  const layout = value("--layout") ?? "case_file";
  if (layout !== "case_file" && layout !== "default") throw new Error("--layout must be case_file or default");
  const s10 = value("--s10-holds") ?? "drive";
  if (s10 !== "drive" && s10 !== "leave") throw new Error("--s10-holds must be drive or leave");
  const numbers = value("--numbers")?.split(",").map(s => s.trim()).filter(Boolean) ?? null;
  if (numbers?.some(id => !OBJECT_ID.test(id))) throw new Error("--numbers takes comma-separated Contact Number ids");
  const max = value("--max-numbers");
  const maxNumbers = max === undefined ? null : Number(max);
  if (maxNumbers !== null && (!Number.isSafeInteger(maxNumbers) || maxNumbers < 1)) throw new Error("--max-numbers must be a positive integer");
  const sinceRaw = value("--since");
  const since = sinceRaw === undefined ? null : new Date(sinceRaw);
  if (since && Number.isNaN(since.getTime())) throw new Error("--since is not a date");
  const wait = Number(value("--repair-max-wait-minutes") ?? 120);
  if (!Number.isFinite(wait) || wait < 0) throw new Error("--repair-max-wait-minutes must be ≥ 0");
  if (has("--repair-timeout-minutes")) throw new Error("--repair-timeout-minutes was replaced by --repair-idle-minutes (no-output timeout)");
  const idle = Number(value("--repair-idle-minutes") ?? 60);
  if (!Number.isFinite(idle) || idle <= 0) throw new Error("--repair-idle-minutes must be > 0");
  return {
    mode: has("--confirm-write") ? "apply" : "estimate", allowProduction: has("--allow-production"), concurrency,
    numbers: numbers?.length ? numbers : null, maxNumbers, since, resume: has("--resume"), manifest: value("--manifest") ?? null,
    layout, s10Holds: s10, repairManifest: value("--repair-manifest") ?? null, skipRepair: has("--skip-repair"),
    repairMaxWaitMinutes: wait, repairIdleMinutes: idle, json: value("--json") ?? null,
  };
}

/**
 * Step 0 (§4): the operator's personal key only, the personal ledger, no queue publish out of the process,
 * Move assessment and the progress re-plan off (both would queue company-key work), the chosen layout,
 * production STT pricing, and no RingCentral token row. Mutates and returns `env`; throws on anything missing.
 * `rcTokenStore` is the value before the change, for the repair child (it fetches media through its own code).
 */
export function configurePaidProcess(env: NodeJS.ProcessEnv, layout: Layout) {
  const missing: string[] = [];
  const personal = env.PERSONAL_AI_GATEWAY_API_KEY?.trim() ?? "";
  if (!personal) missing.push("PERSONAL_AI_GATEWAY_API_KEY");
  if (!env.SALES_INTELLIGENCE_DEPLOYMENT_ID?.trim()) missing.push("SALES_INTELLIGENCE_DEPLOYMENT_ID");
  if (!env.SALES_INTELLIGENCE_ANALYSIS_PRICING_VERSION?.trim()) missing.push("SALES_INTELLIGENCE_ANALYSIS_PRICING_VERSION");
  for (const name of ["SALES_INTELLIGENCE_ANALYSIS_INPUT_CENTS_PER_MILLION", "SALES_INTELLIGENCE_ANALYSIS_OUTPUT_CENTS_PER_MILLION"])
    if (!(Number(env[name]) > 0)) missing.push(name);
  if (missing.length) throw new Error(`refusing to start, missing or invalid: ${missing.join(", ")} (never falls back to AI_GATEWAY_API_KEY)`);
  const rcTokenStore = env.RC_TOKEN_STORE ?? null;
  env.AI_GATEWAY_API_KEY = personal;
  delete env.VERCEL_OIDC_TOKEN;
  // No queue wake-up leaves this process: a published job id would be run by the production consumer.
  delete env.VERCEL;
  delete env.VERCEL_REGION;
  env.SALES_INTELLIGENCE_PERSONAL_LEDGER = "true";
  for (const name of ["ENABLED", "MEDIA_ENABLED", "STT_ENABLED", "EXTRACTION_ENABLED", "OUTREACH_ENSURE"]) env[`SALES_INTELLIGENCE_${name}`] = "true";
  env.SALES_INTELLIGENCE_MOVE_ASSESSMENT = "false";
  env.SALES_INTELLIGENCE_PROGRESS_PLAN = "false";
  env.SALES_INTELLIGENCE_CASE_FILE = layout === "case_file" ? "true" : "false";
  env.SALES_INTELLIGENCE_STT_CENTS_PER_SECOND = "0.003";
  env.SALES_INTELLIGENCE_EXTRACTION_MODEL ??= "openai/gpt-5.6-luna";
  env.SALES_INTELLIGENCE_ANALYSIS_V3 ??= "true";
  if (env.SALES_INTELLIGENCE_ANALYSIS_V3.trim().toLowerCase() === "false") throw new Error("SALES_INTELLIGENCE_ANALYSIS_V3=false: the backfill runs the structured pipeline only");
  if (!(CSI_EXTRACTION_MODELS as readonly string[]).includes(env.SALES_INTELLIGENCE_EXTRACTION_MODEL))
    throw new Error(`SALES_INTELLIGENCE_EXTRACTION_MODEL ${env.SALES_INTELLIGENCE_EXTRACTION_MODEL} is not in CSI_EXTRACTION_MODELS`);
  env.RC_TOKEN_STORE = "file";
  return { rcTokenStore, model: env.SALES_INTELLIGENCE_EXTRACTION_MODEL };
}

// ── Budget period preflight ────────────────────────────────────────────────────
export type BudgetPeriod = { month: string; period_start: Date; period_end: Date; activated_at?: Date | null } | null;
export function budgetHeadroom(period: BudgetPeriod, now: Date, minHours = BUDGET_PERIOD_MIN_HOURS) {
  if (!period || !period.activated_at) return { ok: false as const, reason: "no_active_budget_period", hours_left: null };
  const hours = (period.period_end.getTime() - now.getTime()) / 3_600_000;
  if (hours < minHours) return { ok: false as const, reason: `active_period_${period.month}_ends_in_${hours.toFixed(1)}h`, hours_left: hours };
  return { ok: true as const, reason: null, hours_left: hours };
}
export async function activeBudgetPeriod(now: Date): Promise<BudgetPeriod> {
  const row = await getSalesIntelligenceAiBudgetModel().findOne({ activated_at: { $ne: null }, period_start: { $lte: now }, period_end: { $gt: now } })
    .select("month period_start period_end activated_at").lean();
  return row ? { month: String(row.month), period_start: row.period_start as Date, period_end: row.period_end as Date, activated_at: row.activated_at as Date | null } : null;
}

// ── Exclusions ────────────────────────────────────────────────────────────────
export type NumberRow = { kind?: string | null; classification?: string | null; purged_at?: Date | null; content_purge_pending?: boolean | null;
  contact_eligibility?: { state?: string | null; until?: Date | null } | null; last_activity_at?: Date | null };
/** §4 step 2 exclusions: purged content, internal (non-external / company / non-customer), Owner suppression or active restriction. */
export function numberExclusion(number: NumberRow | null, now: Date, since: Date | null): string | null {
  if (!number) return "number_missing";
  if (number.purged_at || number.content_purge_pending) return "purged";
  if (number.kind !== "external" || ["company", "non_customer"].includes(number.classification ?? "")) return "internal";
  const eligibility = number.contact_eligibility?.state ?? "allowed";
  if (eligibility === "suppressed") return "suppressed";
  if (eligibility === "temporarily_blocked" && (!number.contact_eligibility?.until || number.contact_eligibility.until > now)) return "restricted";
  if (since && (!number.last_activity_at || number.last_activity_at < since)) return "inactive_since";
  return null;
}

// ── Cost basis ─────────────────────────────────────────────────────────────────
export function p95(values: readonly number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}
export type CostRow = { ledger: string; kind: "summary" | "findings"; subject: "conversation" | "number"; cents: number };
export type CostBucket = { ledger: string; kind: string; subject: string; n: number; p95: number | null; mean: number | null; total: number };
export function bucketize(rows: readonly CostRow[]): CostBucket[] {
  const groups = new Map<string, number[]>();
  for (const row of rows) for (const ledger of [row.ledger, "all"]) {
    const key = `${ledger}|${row.kind}|${row.subject}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row.cents);
  }
  return [...groups].map(([key, values]) => {
    const [ledger, kind, subject] = key.split("|") as [string, string, string];
    const total = values.reduce((n, v) => n + v, 0);
    return { ledger, kind, subject, n: values.length, p95: p95(values), mean: values.length ? total / values.length : null, total };
  }).sort((a, b) => `${a.ledger}${a.kind}${a.subject}`.localeCompare(`${b.ledger}${b.kind}${b.subject}`));
}
/** Per-call cents: the personal ledger's p95 when it has enough samples, else all ledgers, else the nominal. */
export function pickCost(buckets: readonly CostBucket[], kind: "summary" | "findings", subject: "conversation" | "number") {
  for (const ledger of ["personal", "all"]) {
    const bucket = buckets.find(b => b.ledger === ledger && b.kind === kind && b.subject === subject);
    if (bucket && bucket.n >= MIN_SAMPLES && bucket.p95 !== null) return { cents: bucket.p95, mean: bucket.mean ?? bucket.p95, basis: `${ledger}_p95_n${bucket.n}` };
  }
  return { cents: NOMINAL_CENTS[kind], mean: NOMINAL_CENTS[kind], basis: "nominal" };
}
/** Reconciled analysis reservations of the last 30 days, `actual_cents` by ledger × step kind × subject (conversation / Number run). */
export async function measureCostBasis(now: Date): Promise<CostBucket[]> {
  const rows: Array<{ ledger: string; kind: "summary" | "findings"; run_id: string | null; cents: number }> = [];
  const cursor = getSalesIntelligenceAiReservationModel().find({ stage: "analysis", status: "reconciled", actual_cents: { $ne: null },
    reconciled_at: { $gte: new Date(now.getTime() - 30 * 86_400_000) }, step: { $regex: "^(summary|findings):" } })
    .select("ledger step run_id actual_cents").lean().cursor();
  for await (const row of cursor) rows.push({ ledger: String(row.ledger ?? "owner"), kind: String(row.step).startsWith("summary:") ? "summary" : "findings",
    run_id: row.run_id ? String(row.run_id) : null, cents: Number(row.actual_cents ?? 0) });
  const conversationRun = new Map<string, boolean>();
  const ids = [...new Set(rows.flatMap(r => r.run_id ? [r.run_id] : []))];
  for (let i = 0; i < ids.length; i += 500) {
    for (const run of await getIntelligenceRunModel().find({ _id: { $in: ids.slice(i, i + 500) } }).select("conversation_id").lean())
      conversationRun.set(String(run._id), Boolean(run.conversation_id));
  }
  return bucketize(rows.map(r => ({ ledger: r.ledger, kind: r.kind, cents: r.cents,
    subject: r.run_id && conversationRun.get(r.run_id) === false ? "number" : "conversation" })));
}

// ── Manifest ───────────────────────────────────────────────────────────────────
export type UnitBy = "backfill" | "repair" | "s10-hold" | "peer" | "prior" | null;
export type PriorState = { status: string; reason: string | null; result_reason: string | null; attempts: number;
  /** rearmed: the same job re-driven by id; superseded: completed as superseded, fresh work made; left: a dead letter left as it is; driven: an S10 hold. */
  action: "rearmed" | "superseded" | "left" | "driven" };
export type UnitRecord = {
  stage: "analysis" | "application" | "number_refresh"; job_id: string;
  outcome: "done" | "deferred" | "blocked" | "failed" | "missing"; by: UnitBy; paid: boolean;
  reason?: string; run_id?: string; prior?: PriorState; superseded_job_id?: string;
  /** Number synthesis only: its run submitted (a synthesis that counts toward the one per Number). */
  submitted?: boolean;
};
export type ConversationEntry = {
  conversation_id: string; set: "a" | "b"; transcript_version: string;
  state: "pending" | "done" | "skipped" | "blocked" | "deferred" | "failed"; reason?: string; units: UnitRecord[];
};
export type NumberEntry = {
  number_id: string; sets: Array<"a" | "b" | "c">;
  state: "pending" | "conversations_done" | "done" | "skipped" | "blocked" | "deferred" | "failed"; reason?: string;
  conversations: ConversationEntry[]; synthesis: UnitRecord[];
  verification?: { summary_current: boolean; fingerprint_match: boolean | null; expected_mismatch: string | null; pass: boolean };
  /** `--s10-holds leave`: the scheduled job is an S10 hold, so the synthesis ran as the backfill's own job and the fingerprint stays with the held job. */
  expected_fingerprint_mismatch?: string;
};
export type HoldEntry = { job_id: string; stage: string; number_id: string; conversation_id: string | null; prior_status: string; prior_reason: string | null;
  due_at: string; held_at: string };
export type ForeignHold = { job_id: string; stage: string; subject_key: string; action: "driven" | "left"; number_id: string | null; note?: string };
export type FullBackfillManifest = {
  version: typeof FULL_BACKFILL_MANIFEST_VERSION;
  run_id: string;
  created_at: string;
  dataset: { deployment: string; database: string };
  credential: "PERSONAL_AI_GATEWAY_API_KEY";
  layout: Layout;
  prompt_versions: TargetVersions;
  models: Record<string, string | null>;
  deployed_commit: string | null;
  local_head: string | null;
  options: { concurrency: number; numbers: string[] | null; max_numbers: number | null; since: string | null; s10_holds: "drive" | "leave";
    repair_manifest: string | null };
  phases: {
    repair: { state: "pending" | "skipped" | "done" | "failed"; exit_code?: number | null; started_at?: string; finished_at?: string; holds_remaining?: number; attempts?: number };
    select: { state: "pending" | "done"; at?: string; excluded?: Record<string, number>; counts?: Record<string, number> };
    estimate?: Estimate;
    verify?: Verification;
  };
  numbers: NumberEntry[];
  holds: HoldEntry[];
  foreign_holds: ForeignHold[];
  /** Jobs this process is claiming right now; a lease on one of them after a kill is this backfill's, not a peer's. */
  inflight?: string[];
  stopped?: string;
};

export function newManifest(input: { now: Date; layout: Layout; models: Record<string, string | null>; deployed_commit: string | null;
  local_head: string | null; options: FullBackfillManifest["options"] }): FullBackfillManifest {
  return {
    version: FULL_BACKFILL_MANIFEST_VERSION, run_id: new mongoose.Types.ObjectId().toHexString(), created_at: input.now.toISOString(),
    dataset: csiDataset(), credential: "PERSONAL_AI_GATEWAY_API_KEY", layout: input.layout, prompt_versions: targetVersions(input.layout),
    models: input.models, deployed_commit: input.deployed_commit, local_head: input.local_head, options: input.options,
    phases: { repair: { state: input.options.repair_manifest ? "pending" : "skipped" }, select: { state: "pending" } },
    numbers: [], holds: [], foreign_holds: [],
  };
}
export async function loadManifest(path: string): Promise<FullBackfillManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as FullBackfillManifest;
    if (parsed.version !== FULL_BACKFILL_MANIFEST_VERSION) throw new Error(`manifest ${path} is not ${FULL_BACKFILL_MANIFEST_VERSION}`);
    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}
/** Atomic (temp file + rename), serialized saves. */
export function manifestSaver(path: string) {
  let pending = Promise.resolve();
  return (manifest: FullBackfillManifest) => {
    const contents = JSON.stringify(manifest) + "\n";
    pending = pending.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, contents);
      await rename(temporary, path);
    });
    return pending;
  };
}
export function jsonlLogger(path: string, runId: string, echo: (line: string) => void = () => undefined) {
  let pending = Promise.resolve();
  return (event: string, fields: Record<string, unknown> = {}) => {
    const line = JSON.stringify({ at: new Date().toISOString(), run_id: runId, event, ...fields });
    echo(line);
    pending = pending.then(async () => { await mkdir(dirname(path), { recursive: true }); await appendFile(path, line + "\n"); });
    return pending;
  };
}
/**
 * Phase 1 lock next to the backfill manifest: one repair child per manifest. A lock whose PID is still alive refuses
 * a second start (a resume while the first child still runs); a stale lock (dead PID) is taken over.
 */
export type RepairLock = { pid: number; started_at: string; repair_manifest: string };
export const repairLockPath = (manifestPath: string) => manifestPath.replace(/\.json$/, "") + ".repair.lock";
export function pidAlive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM"); }
}
export async function acquireRepairLock(path: string, lock: RepairLock, alive: (pid: number) => boolean = pidAlive) {
  let existing: RepairLock | null = null;
  try { existing = JSON.parse(await readFile(path, "utf8")) as RepairLock; }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  if (existing && Number.isInteger(existing.pid) && alive(existing.pid))
    throw new Error(`a repair child (pid ${existing.pid}, started ${existing.started_at}) is still running on this manifest; wait for it or stop it, then resume`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(lock) + "\n");
  return { replaced_stale: existing !== null };
}
/** Clears the lock only when it still names `pid` (a newer run's lock is left alone). */
export async function releaseRepairLock(path: string, pid: number) {
  try {
    const existing = JSON.parse(await readFile(path, "utf8")) as RepairLock;
    if (existing.pid === pid) await rm(path, { force: true });
  } catch { /* already gone */ }
}

/** The CC-07 repair's hold ids (it owns them; this run never releases them). */
export async function readRepairHoldIds(path: string | null): Promise<Set<string>> {
  if (!path) return new Set();
  const parsed = JSON.parse(await readFile(path, "utf8")) as { version?: string; mode?: string; holds?: Array<{ job_id: string }> };
  if (parsed.version !== REPAIR_MANIFEST_VERSION) throw new Error(`${path} is not a ${REPAIR_MANIFEST_VERSION} manifest`);
  if (parsed.mode !== "apply") throw new Error(`${path} is a ${parsed.mode} repair manifest; phase 1 needs the apply manifest`);
  return new Set((parsed.holds ?? []).map(h => h.job_id));
}

// ── Work set (§4 step 2) ─────────────────────────────────────────────────────────
type ConversationRow = { _id: unknown; contact_number_id?: unknown; started_at: Date; latest_transcript_version?: string | null;
  latest_completed_run_id?: unknown; summary?: { prompt_version?: string | null; created_at?: Date | null } | null };
export const ELIGIBLE_CONVERSATION = { latest_transcript_version: { $type: "string" }, content_purged_at: null,
  "analysis_eligibility.status": "eligible", contact_number_id: { $ne: null } } as const;

/**
 * (a) never analysed; (b) its latest completed run is not the target findings version, not the structured
 * pipeline, or analysed an older transcript version; null when current.
 */
export async function conversationSet(row: ConversationRow, target: TargetVersions): Promise<"a" | "b" | null> {
  if (!row.latest_completed_run_id) return "a";
  if (row.summary?.prompt_version !== target.findings) return "b";
  const run = await getIntelligenceRunModel().findById(row.latest_completed_run_id).select("analysis_pipeline prompt_version job_id").lean();
  if (!run || run.analysis_pipeline !== target.pipeline || run.prompt_version !== target.findings) return "b";
  const job = run.job_id ? await getSalesIntelligenceJobModel().findById(run.job_id).select("input_refs").lean() : null;
  const snapshotId = job?.input_refs?.[1];
  const snapshot = snapshotId ? await getIntelligenceEvidenceSnapshotModel().findById(String(snapshotId)).select("transcript_version").lean() : null;
  return snapshot?.transcript_version === row.latest_transcript_version ? null : "b";
}

export type WorkSet = {
  numbers: Array<{ number_id: string; sets: Array<"a" | "b" | "c">; conversations: Array<{ conversation_id: string; set: "a" | "b"; transcript_version: string }> }>;
  excluded: Record<string, number>;
  counts: { eligible_conversations: number; a: number; b: number; numbers_with_conversations: number; numbers_synthesis_only: number; numbers: number; truncated: number };
};
/** Streams eligible conversations once (cursor), keeps only identifiers per Number; oldest conversation first. */
export async function selectWorkSet(target: TargetVersions, filter: { numbers: string[] | null; since: Date | null; maxNumbers: number | null }, now: Date): Promise<WorkSet> {
  const byNumber = new Map<string, { first: number; newestSummary: number; convs: Array<{ conversation_id: string; set: "a" | "b"; transcript_version: string; started: number }> }>();
  const counts = { eligible_conversations: 0, a: 0, b: 0, numbers_with_conversations: 0, numbers_synthesis_only: 0, numbers: 0, truncated: 0 };
  const query = { ...ELIGIBLE_CONVERSATION, ...(filter.numbers ? { contact_number_id: { $in: filter.numbers.map(id => new mongoose.Types.ObjectId(id)) } } : {}) };
  const cursor = getLeadConversationModel().find(query)
    .select("contact_number_id started_at latest_transcript_version latest_completed_run_id summary.prompt_version summary.created_at").lean().cursor();
  for await (const raw of cursor) {
    const row = raw as unknown as ConversationRow;
    counts.eligible_conversations++;
    const numberId = String(row.contact_number_id);
    let group = byNumber.get(numberId);
    if (!group) byNumber.set(numberId, group = { first: Number.POSITIVE_INFINITY, newestSummary: 0, convs: [] });
    const started = new Date(row.started_at).getTime();
    group.first = Math.min(group.first, started);
    if (row.summary?.created_at) group.newestSummary = Math.max(group.newestSummary, new Date(row.summary.created_at).getTime());
    const set = await conversationSet(row, target);
    if (set) group.convs.push({ conversation_id: String(row._id), set, transcript_version: String(row.latest_transcript_version), started });
  }
  const excluded: Record<string, number> = {};
  const selected: Array<WorkSet["numbers"][number] & { first: number }> = [];
  for (const [numberId, group] of byNumber) {
    const number = await getContactNumberModel().findById(numberId)
      .select("kind classification purged_at content_purge_pending contact_eligibility last_activity_at running_summary").lean();
    const exclusion = numberExclusion(number as NumberRow | null, now, filter.since);
    if (exclusion) { excluded[exclusion] = (excluded[exclusion] ?? 0) + 1; continue; }
    const sets = [...new Set(group.convs.map(c => c.set))].sort() as Array<"a" | "b" | "c">;
    if (!sets.length) {
      // (c) no stale conversation, but the running summary is missing, on another version, or older than a conversation run.
      const summary = number!.running_summary as { run_id?: unknown; computed_at?: Date } | null;
      const run = summary?.run_id ? await getIntelligenceRunModel().findById(summary.run_id).select("prompt_version").lean() : null;
      if (summary && run?.prompt_version === target.findings && new Date(summary.computed_at ?? 0).getTime() >= group.newestSummary) continue;
      sets.push("c");
    }
    group.convs.sort((a, b) => a.started - b.started || a.conversation_id.localeCompare(b.conversation_id));
    selected.push({ number_id: numberId, sets, first: group.first,
      conversations: group.convs.map(({ started: _started, ...c }) => c) });
  }
  selected.sort((a, b) => a.first - b.first || a.number_id.localeCompare(b.number_id));
  const capped = filter.maxNumbers ? selected.slice(0, filter.maxNumbers) : selected;
  counts.truncated = selected.length - capped.length;
  for (const n of capped) {
    counts.a += n.conversations.filter(c => c.set === "a").length;
    counts.b += n.conversations.filter(c => c.set === "b").length;
    if (n.conversations.length) counts.numbers_with_conversations++; else counts.numbers_synthesis_only++;
  }
  counts.numbers = capped.length;
  return { numbers: capped.map(({ first: _first, ...n }) => n), excluded, counts };
}

// ── Estimate (free, read-only) ───────────────────────────────────────────────────
export type Estimate = {
  layout: Layout; model: string; prompt_versions: TargetVersions;
  sets: WorkSet["counts"]; excluded: Record<string, number>;
  /**
   * `number_summaries`: summary steps the Number syntheses run, one per current conversation of the Number (a v3
   * cache hit is free, so this is the upper bound; the conversation runs of this backfill fill most of the cache).
   * `number_summaries_uncached_now`: of those, the ones with no target-prompt summary yet.
   */
  calls: { conversation_summaries: number; conversation_summary_cache_hits: number; conversation_findings: number;
    number_summaries: number; number_summaries_uncached_now: number; number_findings: number };
  cost_basis: { summary: ReturnType<typeof pickCost>; number_summary: ReturnType<typeof pickCost>; conversation_findings: ReturnType<typeof pickCost>;
    number_findings: ReturnType<typeof pickCost>; buckets: CostBucket[] };
  /** `p95` / `mean` bill every Number summary step; `p95_cache_hits` bills only the ones uncached now. */
  projected_cents: { p95: number; mean: number; p95_cache_hits: number };
  jobs: Awaited<ReturnType<typeof inventoryJobs>>;
  budget: ReturnType<typeof budgetHeadroom> & { month: string | null; period_end: string | null };
};
export const summaryCacheKey = (conversationId: string, transcriptVersion: string, prompt: string, model: string) =>
  payloadHash({ ...csiDataset(), conversation_id: conversationId, transcript_version: transcriptVersion, prompt, model });

/** Paused / held / dead-letter jobs by stage and reason, the repair's holds still held, and foreign (S10) holds. */
export async function inventoryJobs(repairHoldIds: ReadonlySet<string>) {
  const Jobs = getSalesIntelligenceJobModel();
  const grouped = await Jobs.aggregate<{ _id: { stage: string; status: string; reason: string | null; result_reason: string | null }; n: number }>([
    { $match: { ...csiDataset(), stage: { $in: ["analysis", "number_refresh", "application"] }, status: { $in: ["paused", "dead_letter"] } } },
    { $group: { _id: { stage: "$stage", status: "$status", reason: "$reason", result_reason: "$result.reason" }, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  const holds = await Jobs.find({ ...csiDataset(), status: "paused", reason: OPERATOR_HOLD_REASON }).select("stage subject_key dedupe_key").lean();
  const repair = holds.filter(h => repairHoldIds.has(String(h._id)));
  const own = holds.filter(h => isOwnDedupe(h.dedupe_key));
  const foreign = holds.filter(h => !repairHoldIds.has(String(h._id)) && !isOwnDedupe(h.dedupe_key));
  const byStage = (rows: Array<{ stage: string }>) => rows.reduce<Record<string, number>>((out, r) => ({ ...out, [r.stage]: (out[r.stage] ?? 0) + 1 }), {});
  return {
    paused_and_dead: grouped.map(g => ({ ...g._id, n: g.n })),
    repair_holds: { in_manifest: repairHoldIds.size, still_held: repair.length, by_stage: byStage(repair) },
    own_holds: own.length,
    foreign_holds: { total: foreign.length, by_stage: byStage(foreign), job_ids: foreign.slice(0, 200).map(h => String(h._id)) },
  };
}

export async function estimateWorkSet(ws: WorkSet, target: TargetVersions, model: string, repairHoldIds: ReadonlySet<string>, now: Date): Promise<Estimate> {
  const Snapshots = getIntelligenceEvidenceSnapshotModel();
  const cached = async (conversationId: string, version: string) =>
    Boolean(await Snapshots.exists({ artifact_key: summaryCacheKey(conversationId, version, target.summary, model), ...csiDataset() }));
  const calls = { conversation_summaries: 0, conversation_summary_cache_hits: 0, conversation_findings: 0, number_summaries: 0,
    number_summaries_uncached_now: 0, number_findings: ws.numbers.length };
  const inSet = new Set<string>();
  for (const n of ws.numbers) for (const c of n.conversations) {
    inSet.add(c.conversation_id);
    calls.conversation_findings++;
    if (await cached(c.conversation_id, c.transcript_version)) calls.conversation_summary_cache_hits++; else calls.conversation_summaries++;
  }
  // A Number synthesis runs a summary step per current conversation; only a cache miss is billed.
  const ids = ws.numbers.map(n => new mongoose.Types.ObjectId(n.number_id));
  for (let i = 0; i < ids.length; i += 200) {
    const cursor = getLeadConversationModel().find({ ...ELIGIBLE_CONVERSATION, contact_number_id: { $in: ids.slice(i, i + 200) } })
      .select("latest_transcript_version").lean().cursor();
    for await (const row of cursor) {
      calls.number_summaries++;
      if (!inSet.has(String(row._id)) && !(await cached(String(row._id), String(row.latest_transcript_version)))) calls.number_summaries_uncached_now++;
    }
  }
  const buckets = await measureCostBasis(now);
  const basis = { summary: pickCost(buckets, "summary", "conversation"), number_summary: pickCost(buckets, "summary", "number"), conversation_findings: pickCost(buckets, "findings", "conversation"),
    number_findings: pickCost(buckets, "findings", "number"), buckets };
  const total = (pick: "cents" | "mean", numberSummaries: number) => Math.round(calls.conversation_summaries * basis.summary[pick] +
    numberSummaries * basis.number_summary[pick] + calls.conversation_findings * basis.conversation_findings[pick] + calls.number_findings * basis.number_findings[pick]);
  const period = await activeBudgetPeriod(now);
  return {
    layout: target.layout, model, prompt_versions: target, sets: ws.counts, excluded: ws.excluded, calls, cost_basis: basis,
    projected_cents: { p95: total("cents", calls.number_summaries), mean: total("mean", calls.number_summaries),
      p95_cache_hits: total("cents", calls.number_summaries_uncached_now) }, jobs: await inventoryJobs(repairHoldIds),
    budget: { ...budgetHeadroom(period, now), month: period?.month ?? null, period_end: period?.period_end.toISOString() ?? null },
  };
}

// ── Runners (in-process, by id, no queue wake-up) ───────────────────────────────────
export type StepResult = { status: string; reason?: string };
export type BackfillRunners = {
  analysis(jobId: string, stage: "analysis" | "number_refresh"): Promise<StepResult>;
  application(jobId: string): Promise<StepResult>;
};
/** No wake-up leaves this process: a published job id would be claimed by the production queue consumer. */
export const suppressWakeup = async () => ({ published: false, error_code: null });
export function createBackfillRunners(): BackfillRunners {
  const loadJob = (id: string) => getSalesIntelligenceJobModel().findById(id).select("status next_attempt_at result").lean().exec();
  return {
    // `historical` claims this row by id regardless of live work queued elsewhere; the run mode stays the worker's.
    analysis: (id, stage) => continueStructuredAnalysis(
      () => runIntelligenceJob(id, stage, { historical: true, publish: suppressWakeup }) as Promise<StepResult>, () => loadJob(id)),
    application: async id => {
      // Application commits in bounded batches; a checkpointed batch leaves the job pending and due.
      for (let round = 0; round < 50; round++) {
        const result = await runIntelligenceApplicationJob(id);
        const job = await loadJob(id);
        if (result.status !== "completed" || job?.status !== "pending") return result;
      }
      return { status: "retry", reason: "application_rounds_exhausted" };
    },
  };
}

// ── Driver ─────────────────────────────────────────────────────────────────────────
export type BackfillSeams = {
  runners: BackfillRunners;
  save: (manifest: FullBackfillManifest) => Promise<unknown>;
  log: (event: string, fields?: Record<string, unknown>) => Promise<unknown>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<unknown>;
  /** Phase 1: finish the repair's held work (the entry point spawns `ops/repair-call-log-capture.ts`). Returns its exit code. */
  runRepair?: (repairManifest: string) => Promise<number | null>;
  /** Before every paid unit: the current budget period exists and is active (the month rolls over mid-run). Default: the production helper. */
  ensureBudget?: (now: Date) => Promise<unknown>;
};
export type BackfillOptions = { concurrency: number; s10Holds: "drive" | "leave"; repairManifest: string | null; skipRepair: boolean;
  numbers: string[] | null; since: Date | null; maxNumbers: number | null; model: string };

type JobStatus = "pending" | "completed" | "retry" | "dead_letter" | "paused" | "leased";
type JobRow = { _id: unknown; status: JobStatus; reason?: string | null; result?: { reason?: string } | null; stage: string; dedupe_key: string;
  subject_key: string; next_attempt_at: Date; leased_until?: Date | null; completed_at?: Date | null; attempts: number; max_attempts: number; input_refs: unknown[] };
const JOB_FIELDS = "status reason result stage dedupe_key subject_key next_attempt_at leased_until completed_at attempts max_attempts input_refs";
export const isOwnDedupe = (key: string | null | undefined) => Boolean(key && (key.includes(OWN_DEDUPE_MARK) || key.startsWith(OWN_NUMBER_DEDUPE_PREFIX)));
const resultReason = (job: { result?: unknown }) => job.result && typeof job.result === "object" && "reason" in job.result ? String((job.result as { reason: unknown }).reason) : null;
/** Application pauses this backfill re-drives (shadow runs are never touched). */
const APPLICATION_REDRIVE_REASONS = new Set(["permission_denied", "invocation_pending", "consumer_unavailable"]);
type Pick = { job_id: string; by: UnitBy; prior?: PriorState; superseded_job_id?: string } | { blocked: UnitRecord["outcome"]; reason: string; by: UnitBy; job_id?: string };
type Existing = Pick | { supersede_foreign: string } | null;

/**
 * A run attached to a failed job resumes only when the worker would continue it under the target layout:
 * no run yet, or an unpurged structured run with the target step contracts and model. Anything else would
 * finish on an old prompt (or fail again), so it is superseded instead.
 */
export function resumeDecision(run: { purged_at?: Date | null; purge_started_at?: Date | null; analysis_pipeline?: string | null; model_version?: string | null;
  step_contracts?: unknown; status?: string | null } | null, targetDigest: string, model: string): { resumable: boolean; reason: string } {
  if (!run) return { resumable: true, reason: "no_run" };
  if (run.purged_at || run.purge_started_at) return { resumable: false, reason: "run_purged" };
  if (run.analysis_pipeline !== STRUCTURED_PIPELINE) return { resumable: false, reason: "legacy_pipeline" };
  if (run.model_version !== model) return { resumable: false, reason: "model_differs" };
  if (payloadHash(run.step_contracts ?? null) !== targetDigest) return { resumable: false, reason: "layout_differs" };
  if (!["running", "paused", "submitted"].includes(run.status ?? "")) return { resumable: false, reason: `run_${run.status}` };
  return { resumable: true, reason: "target_layout" };
}

class FullBackfill {
  private readonly targetDigest: string;
  private readonly target: TargetVersions;
  fatal: string | null = null;
  constructor(private readonly manifest: FullBackfillManifest, private readonly seams: BackfillSeams, private readonly options: BackfillOptions,
    private readonly repairHoldIds: ReadonlySet<string>) {
    this.target = manifest.prompt_versions;
    this.targetDigest = targetContractsDigest(manifest.layout);
  }
  private now() { return (this.seams.now ?? (() => new Date()))(); }
  private sleep(ms: number) { return (this.seams.sleep ?? (m => new Promise(r => setTimeout(r, m))))(ms); }
  private jobs() { return getSalesIntelligenceJobModel(); }
  private async load(jobId: string) { return (await this.jobs().findById(jobId).select(JOB_FIELDS).lean()) as JobRow | null; }
  private started() { return new Date(this.manifest.created_at); }

  holdOwner(job: { _id: unknown; dedupe_key: string }): "own" | "repair" | "foreign" {
    if (this.manifest.holds.some(h => h.job_id === String(job._id)) || isOwnDedupe(job.dedupe_key)) return "own";
    return this.repairHoldIds.has(String(job._id)) ? "repair" : "foreign";
  }

  /**
   * Paused jobs are claimed by no cron, queue consumer or drain; only this runner releases its own hold.
   * A `budget_exhausted` pause is held too, so production's `resumeBudgetPausedJobs` cannot hand it to the company key.
   */
  private async hold(job: JobRow, numberId: string, conversationId: string | null) {
    const update = { $set: { status: "paused" as const, reason: OPERATOR_HOLD_REASON } };
    const held = job.status === "paused"
      ? await this.jobs().updateOne({ _id: String(job._id), status: "paused", reason: job.reason ?? null }, update)
      : await this.jobs().updateOne({ _id: String(job._id), status: { $in: ["pending", "retry"] } }, update);
    if (held.modifiedCount !== 1) return false;
    this.recordHold(String(job._id), job.stage, numberId, conversationId, job.status, job.reason ?? null, job.next_attempt_at);
    await this.seams.save(this.manifest);
    await this.seams.log("hold", { job_id: String(job._id), stage: job.stage, number_id: numberId, prior_status: job.status, prior_reason: job.reason ?? null });
    return true;
  }
  private recordHold(jobId: string, stage: string, numberId: string, conversationId: string | null, priorStatus: string, priorReason: string | null, due: Date) {
    if (this.manifest.holds.some(h => h.job_id === jobId)) return;
    this.manifest.holds.push({ job_id: jobId, stage, number_id: numberId, conversation_id: conversationId, prior_status: priorStatus,
      prior_reason: priorReason, due_at: new Date(due).toISOString(), held_at: this.now().toISOString() });
  }
  /** Due now, so the by-id claim that immediately follows takes it; a held pause (budget) comes back as pending. */
  private async release(job: JobRow) {
    const jobId = String(job._id);
    const hold = this.manifest.holds.find(h => h.job_id === jobId);
    const runnable = hold !== undefined && ["pending", "retry"].includes(hold.prior_status);
    await this.jobs().updateOne({ _id: jobId, status: "paused", reason: OPERATOR_HOLD_REASON },
      { $set: { status: runnable ? hold.prior_status : "pending", reason: runnable ? hold.prior_reason : null, next_attempt_at: this.now() } });
    this.manifest.holds = this.manifest.holds.filter(h => h.job_id !== jobId);
    // Not awaited: the claim follows at once (the manifest is saved after it).
    void Promise.resolve(this.seams.log("release", { job_id: jobId, stage: job.stage })).catch(() => undefined);
  }
  /** After a throw between release and claim: a released job is never left pending and due. */
  private async rehold(jobId: string, numberId: string, conversationId: string | null) {
    const job = await this.load(jobId);
    if (job && ["pending", "retry"].includes(job.status)) await this.hold(job, numberId, conversationId);
  }
  /**
   * Take a failed (re-arm) or S10-held (drive) job onto this run's own hold, prior state recorded; the unit
   * runner then releases and claims it by id in the same moment. Null when it changed under us.
   */
  private async adopt(job: JobRow, numberId: string, conversationId: string | null, action: "rearmed" | "driven") {
    const prior = this.priorOf(job, action);
    const exhausted = job.status === "dead_letter" || job.attempts >= job.max_attempts - 1;
    const changed = await this.jobs().updateOne({ _id: String(job._id), status: job.status, reason: job.reason ?? null },
      { $set: { status: "paused", reason: OPERATOR_HOLD_REASON, ...(exhausted ? { attempts: 0 } : {}) } });
    if (changed.modifiedCount !== 1) return null;
    this.recordHold(String(job._id), job.stage, numberId, conversationId, "pending", null, this.now());
    if (action === "driven") this.noteForeign(job, "driven", numberId, "driven_by_backfill");
    await this.seams.save(this.manifest);
    await this.seams.log(action === "driven" ? "s10_hold_driven" : "rearmed", { job_id: String(job._id), stage: job.stage, number_id: numberId, prior });
    return prior;
  }
  private noteForeign(job: JobRow, action: "driven" | "left", numberId: string | null, note?: string) {
    const existing = this.manifest.foreign_holds.find(h => h.job_id === String(job._id));
    const entry: ForeignHold = { job_id: String(job._id), stage: job.stage, subject_key: job.subject_key, action, number_id: numberId, ...(note ? { note } : {}) };
    if (existing) Object.assign(existing, entry); else this.manifest.foreign_holds.push(entry);
  }
  private priorOf(job: JobRow, action: PriorState["action"]): PriorState {
    return { status: job.status, reason: job.reason ?? null, result_reason: resultReason(job), attempts: job.attempts, action };
  }
  /** A paused failure whose run cannot resume under the target layout: complete it as superseded and retire its unfinished run. */
  private async supersede(job: JobRow) {
    const prior = this.priorOf(job, job.status === "dead_letter" ? "left" : "superseded");
    if (job.status !== "dead_letter") {
      const now = this.now();
      await withTransaction(async session => {
        const done = await this.jobs().updateOne({ _id: String(job._id), status: job.status, reason: job.reason ?? null },
          { $set: { status: "completed", completed_at: now, reason: null, result: { reason: SUPERSEDED_REASON, backfill_run_id: this.manifest.run_id,
            prior_status: job.status, prior_reason: job.reason ?? null, prior_result_reason: resultReason(job) } } }, { session });
        if (done.modifiedCount !== 1) return;
        await getIntelligenceRunModel().updateOne({ job_id: String(job._id), finalized_at: null, status: { $in: ["running", "paused"] } },
          { $set: { status: "stale", processing_reason: SUPERSEDED_REASON, completed_at: now } }, { session });
      });
    }
    await this.seams.log("superseded", { job_id: String(job._id), stage: job.stage, prior });
    return prior;
  }
  private async resumable(job: JobRow) {
    const run = await getIntelligenceRunModel().findOne({ job_id: String(job._id) }).sort({ _id: -1 })
      .select("purged_at purge_started_at analysis_pipeline model_version step_contracts status").lean();
    return resumeDecision(run as Parameters<typeof resumeDecision>[0], this.targetDigest, this.options.model);
  }
  /** Fresh work born on `operator_hold`: nothing can claim it before this runner releases and claims it by id. */
  private async createHeld(input: { stage: "analysis" | "number_refresh"; subject_key: string; dedupe_key: string; input_refs: string[] }, numberId: string, conversationId: string | null) {
    const id = await withTransaction(async session => {
      const job = await enqueueCsiJob({ ...input, input_revision: 1, priority: CSI_BACKFILL_JOB_PRIORITY }, session);
      await this.jobs().updateOne({ _id: job._id, status: "pending" }, { $set: { status: "paused", reason: OPERATOR_HOLD_REASON } }, { session });
      return String(job._id);
    });
    this.recordHold(id, input.stage, numberId, conversationId, "pending", null, this.now());
    await this.seams.save(this.manifest);
    await this.seams.log("created", { job_id: id, stage: input.stage, number_id: numberId, conversation_id: conversationId });
    return id;
  }
  private checkFatal(reason: string | null | undefined, status?: string) {
    if (status === "disabled") this.fatal ??= "analysis_disabled";
    else if (reason && FATAL_REASONS.has(reason)) this.fatal ??= reason;
  }
  private async ensureBudget() {
    try { await (this.seams.ensureBudget ?? ensureCurrentCsiBudgetPeriod)(this.now()); return true; }
    catch (error) {
      this.fatal ??= "no_active_period";
      await this.seams.log("budget_period_unavailable", { error: error instanceof Error ? error.message.slice(0, 120) : "unknown" });
      return false;
    }
  }
  private async inflight(jobId: string, on: boolean) {
    const list = new Set(this.manifest.inflight ?? []);
    if (on) list.add(jobId); else list.delete(jobId);
    this.manifest.inflight = [...list];
    await this.seams.save(this.manifest);
  }

  /**
   * One unit by id: made due and claimed at once. A unit a production consumer claimed first is waited for
   * and recorded as `peer`; one still pending after the claim attempts goes back on `operator_hold`, and so
   * does any job left released or due when something throws.
   */
  async runUnit(numberId: string, conversationId: string | null, stage: UnitRecord["stage"], jobId: string, by: UnitBy, prior?: PriorState): Promise<UnitRecord> {
    const paid = stage !== "application";
    const record = (outcome: UnitRecord["outcome"], who: UnitBy, reason?: string): UnitRecord =>
      ({ stage, job_id: jobId, outcome, by: who, paid, ...(reason ? { reason } : {}), ...(prior ? { prior } : {}) });
    let invoked = false, peer = false;
    try {
      for (let attempt = 0; attempt < CLAIM_ATTEMPTS && !this.fatal; attempt++) {
        const job = await this.load(jobId);
        if (!job) return record("missing", null);
        if (job.status === "completed") {
          if (invoked) return record("done", peer ? "peer" : by, resultReason(job) ?? undefined);
          const who: UnitBy = by === "prior" || by === "s10-hold" ? by : isOwnDedupe(job.dedupe_key) ? "backfill"
            : job.completed_at && job.completed_at >= this.started() ? "peer" : "prior";
          return record("done", who, resultReason(job) ?? undefined);
        }
        if (job.status === "dead_letter") return record("failed", invoked ? by : null, resultReason(job) ?? job.reason ?? "dead_letter");
        if (job.status === "paused" && (job.reason !== OPERATOR_HOLD_REASON || this.holdOwner(job) !== "own"))
          return record("blocked", invoked ? by : null, resultReason(job) ?? job.reason ?? "paused");
        if (job.status === "leased" && job.leased_until && job.leased_until > this.now()) {
          // A lease this backfill held before a kill is its own: wait for it to expire, then claim; anything else is a peer.
          if (!(this.manifest.inflight ?? []).includes(jobId)) { peer = true; invoked = true; }
          await waitForBackfillPeer(async () => this.load(jobId), ms => this.sleep(ms));
          continue;
        }
        if (paid && !(await this.ensureBudget())) break;
        // The manifest write comes first: nothing sits between making the job due and claiming it.
        await this.inflight(jobId, true);
        if (job.status === "paused") await this.release(job);
        else await this.jobs().updateOne({ _id: jobId, status: { $in: ["pending", "retry"] }, next_attempt_at: { $gt: this.now() } }, { $set: { next_attempt_at: this.now() } });
        const result = stage === "application" ? await this.seams.runners.application(jobId) : await this.seams.runners.analysis(jobId, stage);
        await this.inflight(jobId, false);
        invoked = true;
        this.checkFatal(result.reason, result.status);
        if (result.status === "not_claimable" || result.status === "lease_lost") {
          peer = true;
          await waitForBackfillPeer(async () => this.load(jobId), ms => this.sleep(ms));
        }
        const after = await this.load(jobId);
        if (!after) return record("missing", null);
        this.checkFatal(resultReason(after) ?? after.reason);
        if (this.fatal === "budget_exhausted" && after.status !== "paused") {
          // The worker paused it for budget, but a rollover already released it: not a stop. Claim again (pending) or record the peer.
          await this.seams.log("budget_release_raced", { job_id: jobId, stage, status: after.status });
          this.fatal = null;
          if (after.status === "leased") { peer = true; await waitForBackfillPeer(async () => this.load(jobId), ms => this.sleep(ms)); continue; }
          if (after.status === "completed") return record("done", "peer", "released_to_production");
        }
        if (after.status === "completed") return record("done", peer ? "peer" : by, resultReason(after) ?? undefined);
        if (after.status === "dead_letter") return record("failed", by, resultReason(after) ?? after.reason ?? "dead_letter");
        if (after.status === "paused" && after.reason === "budget_exhausted") {
          if (await this.hold(after, numberId, conversationId)) return record("deferred", null, "budget_exhausted_held");
          // A budget rollover resumed it in between: claim it at once, or (a consumer got it first) record the peer.
          const raced = await this.load(jobId);
          await this.seams.log("budget_release_raced", { job_id: jobId, stage, status: raced?.status ?? null });
          if (this.fatal === "budget_exhausted") this.fatal = null;
          if (raced && ["pending", "retry"].includes(raced.status)) continue;
          if (raced?.status === "leased") { peer = true; await waitForBackfillPeer(async () => this.load(jobId), ms => this.sleep(ms)); continue; }
          if (raced?.status === "completed") return record("done", "peer", "released_to_production");
          return record("blocked", null, `budget_race:${raced?.status ?? "missing"}`);
        }
        if (after.status === "paused") return record("blocked", by, resultReason(after) ?? after.reason ?? "paused");
      }
      const last = await this.load(jobId);
      if (last && ["pending", "retry"].includes(last.status)) {
        await this.hold(last, numberId, conversationId);
        return record("deferred", null, `held:${this.fatal ?? resultReason(last) ?? last.reason ?? last.status}`);
      }
      if (last?.status === "paused" && last.reason === OPERATOR_HOLD_REASON) return record("deferred", null, `held:${this.fatal ?? "not_claimed"}`);
      return record(last?.status === "completed" ? "done" : "deferred", peer ? "peer" : by, last ? `still_${last.status}` : "missing");
    } catch (error) {
      // The in-flight marker stays: after a real kill it is what identifies this backfill's own lease.
      await this.rehold(jobId, numberId, conversationId).catch(() => undefined);
      throw error;
    }
  }

  /** Merges by job id, so the prior state recorded before a claim survives the outcome recorded after it. */
  private recordUnit(units: UnitRecord[], unit: UnitRecord) {
    const at = units.findIndex(u => u.job_id === unit.job_id);
    if (at >= 0) {
      const merged: UnitRecord = { ...units[at]!, ...unit };
      if (unit.reason === undefined) delete merged.reason;
      units[at] = merged;
    } else units.push(unit);
    return this.seams.log("unit", { ...unit });
  }
  /** Before the claim: the unit, its prior state and what it supersedes are saved, so a kill during the claim loses none of it. */
  private async recordClaiming(units: UnitRecord[], stage: UnitRecord["stage"], pick: Extract<Pick, { job_id: string; by: UnitBy; prior?: PriorState }>) {
    const earlier = units.find(u => u.job_id === pick.job_id);
    // On resume the job is this run's own hold again; the attribution recorded before the kill (prior / s10-hold) stands.
    if (earlier) return { ...pick, by: earlier.by === "prior" || earlier.by === "s10-hold" ? earlier.by : pick.by, prior: pick.prior ?? earlier.prior };
    units.push({ stage, job_id: pick.job_id, outcome: "deferred", by: pick.by, paid: stage !== "application", reason: "claiming",
      ...(pick.prior ? { prior: pick.prior } : {}), ...(pick.superseded_job_id ? { superseded_job_id: pick.superseded_job_id } : {}) });
    await this.seams.save(this.manifest);
    return pick;
  }

  /** Holds and live leases on an existing job; null when the caller decides (completed, failed, pending). */
  private async pickExisting(job: JobRow, numberId: string, conversationId: string | null): Promise<Existing> {
    const id = String(job._id);
    if (job.status === "paused" && job.reason === OPERATOR_HOLD_REASON) {
      const owner = this.holdOwner(job);
      if (owner === "own") return { job_id: id, by: "backfill" };
      if (owner === "repair") return { blocked: "blocked", reason: "repair_hold", by: "repair", job_id: id };
      if (this.options.s10Holds === "drive") {
        const prior = await this.adopt(job, numberId, conversationId, "driven");
        return prior ? { job_id: id, by: "s10-hold", prior } : { blocked: "blocked", reason: "s10_hold_changed", by: null, job_id: id };
      }
      this.noteForeign(job, "left", numberId, "superseded_by_backfill_work");
      return { supersede_foreign: id };
    }
    if (job.status === "paused" && job.reason === "eligibility_pending") return { blocked: "blocked", reason: "eligibility_pending", by: null, job_id: id };
    if (job.status === "paused" && !REDRIVE_PAUSE_REASONS.has(job.reason ?? "")) return { blocked: "blocked", reason: `paused:${job.reason}`, by: null, job_id: id };
    if (job.status === "leased") return { job_id: id, by: "backfill" };
    return null;
  }

  /** Re-arm when the job's run resumes under the target layout, otherwise supersede; pending jobs on an old run are superseded too. */
  private async failedOrPending(job: JobRow, numberId: string, conversationId: string | null): Promise<Pick | { superseded: PriorState } | null> {
    const failed = job.status === "dead_letter" || (job.status === "paused" && REDRIVE_PAUSE_REASONS.has(job.reason ?? ""));
    const pending = ["pending", "retry"].includes(job.status);
    if (!failed && !pending) return null;
    const decision = await this.resumable(job);
    if (pending && decision.resumable) return { job_id: String(job._id), by: "backfill" };
    if (failed && decision.resumable) {
      const prior = await this.adopt(job, numberId, conversationId, "rearmed");
      return prior ? { job_id: String(job._id), by: "prior", prior } : { blocked: "blocked", reason: "changed_concurrently", by: null, job_id: String(job._id) };
    }
    return { superseded: await this.supersede(job) };
  }

  /** Pick the analysis job for a conversation: an own job, the standard job (driven, re-armed or superseded), or fresh work. */
  private async pickAnalysisJob(n: NumberEntry, c: ConversationEntry, version: string, snapshotId: string): Promise<Pick> {
    const standard = `csi:analysis:conversation:${c.conversation_id}:${version}`, ownKey = `${standard}${OWN_DEDUPE_MARK}${this.target.findings}`;
    const own = await this.jobs().findOne({ dedupe_key: ownKey }).select("_id").lean();
    if (own) return { job_id: String(own._id), by: "backfill" };
    const std = (await this.jobs().findOne({ dedupe_key: standard }).select(JOB_FIELDS).lean()) as JobRow | null;
    let prior: PriorState | undefined, superseded: string | undefined;
    if (std) {
      const id = String(std._id);
      const existing = await this.pickExisting(std, n.number_id, c.conversation_id);
      if (existing && "supersede_foreign" in existing) { prior = this.priorOf(std, "left"); superseded = id; }
      else if (existing) return existing;
      else if (std.status === "completed") {
        // Its run may be a target-layout receipt still awaiting application: drive the application only.
        const run = await getIntelligenceRunModel().findOne({ job_id: id }).sort({ _id: -1 }).select("status step_contracts").lean();
        if (run?.status === "submitted" && payloadHash(run.step_contracts ?? null) === this.targetDigest) return { job_id: id, by: "prior" };
      } else {
        const decided = await this.failedOrPending(std, n.number_id, c.conversation_id);
        if (!decided) return { blocked: "blocked", reason: `standard_job_${std.status}:${std.reason ?? ""}`, by: null, job_id: id };
        if (!("superseded" in decided)) return decided;
        prior = decided.superseded; superseded = id;
      }
    }
    const jobId = await this.createHeld({ stage: "analysis", subject_key: `conversation:${c.conversation_id}`, dedupe_key: ownKey,
      input_refs: [c.conversation_id, snapshotId] }, n.number_id, c.conversation_id);
    return { job_id: jobId, by: "backfill", ...(prior ? { prior } : {}), ...(superseded ? { superseded_job_id: superseded } : {}) };
  }

  /** The analysis run's receipt → its application, by id; failed application pauses (never shadow runs) are re-armed. */
  private async driveApplication(numberId: string, conversationId: string | null, analysisJobId: string, units: UnitRecord[]) {
    const run = await getIntelligenceRunModel().findOne({ job_id: analysisJobId }).select("_id status").sort({ _id: -1 }).lean();
    const submission = run ? await getIntelligenceSubmissionModel().findOne({ run_id: run._id }).select("application_job_id").lean() : null;
    if (!run || !submission?.application_job_id) return { run_id: run ? String(run._id) : null, unit: null };
    const appId = String(submission.application_job_id);
    const app = await this.load(appId);
    let by: UnitBy = "backfill", prior: PriorState | undefined;
    if (app && resultReason(app) === "shadow_analysis") {
      const unit: UnitRecord = { stage: "application", job_id: appId, outcome: "blocked", by: null, paid: false, reason: "shadow_analysis", run_id: String(run._id) };
      await this.recordUnit(units, unit);
      return { run_id: String(run._id), unit };
    }
    if (app && (app.status === "dead_letter" || (app.status === "paused" && APPLICATION_REDRIVE_REASONS.has(app.reason ?? "")))) {
      prior = (await this.adopt(app, numberId, conversationId, "rearmed")) ?? undefined;
      if (prior) by = "prior";
    }
    const claim = await this.recordClaiming(units, "application", { job_id: appId, by, ...(prior ? { prior } : {}) });
    const unit = await this.runUnit(numberId, conversationId, "application", appId, claim.by, claim.prior);
    await this.recordUnit(units, { ...unit, run_id: String(run._id) });
    return { run_id: String(run._id), unit };
  }

  /** Application scheduled the Number synthesis 15 s ahead: hold it until this Number's conversations are done. */
  private async holdSchedule(numberId: string) {
    const number = await getContactNumberModel().findById(numberId).select("intelligence_schedule").lean();
    const jobId = number?.intelligence_schedule?.job_id ? String(number.intelligence_schedule.job_id) : null;
    const job = jobId ? await this.load(jobId) : null;
    if (job && job.stage === "number_refresh" && ["pending", "retry"].includes(job.status)) await this.hold(job, numberId, null);
  }

  private async conversationCurrent(conversationId: string) {
    const row = await getLeadConversationModel().findById(conversationId)
      .select("contact_number_id started_at latest_transcript_version latest_completed_run_id summary.prompt_version").lean();
    return row ? (await conversationSet(row as unknown as ConversationRow, this.target)) === null : false;
  }

  async driveConversation(n: NumberEntry, c: ConversationEntry) {
    if (c.state === "done" || c.state === "skipped") return;
    const conv = await getLeadConversationModel().findById(c.conversation_id)
      .select("contact_number_id content_purged_at analysis_eligibility latest_transcript_version").lean();
    if (!conv || conv.content_purged_at || conv.analysis_eligibility?.status !== "eligible" || !conv.latest_transcript_version || String(conv.contact_number_id) !== n.number_id) {
      c.state = "skipped"; c.reason = !conv ? "conversation_missing" : conv.content_purged_at ? "purged" : String(conv.contact_number_id) !== n.number_id ? "number_changed" : "not_eligible";
      return;
    }
    const version = String(conv.latest_transcript_version);
    c.transcript_version = version;
    if (await this.conversationCurrent(c.conversation_id)) {
      c.state = "done"; if (!c.units.length) c.reason = "already_current";
      return;
    }
    const snapshot = await getIntelligenceEvidenceSnapshotModel().findOne({ ...csiDataset(), source_type: "transcript", conversation_id: conv._id,
      transcript_version: version, purged_at: null }).select("_id").lean();
    if (!snapshot) { c.state = "skipped"; c.reason = "no_transcript_snapshot"; return; }
    const pick = await this.pickAnalysisJob(n, c, version, String(snapshot._id));
    if ("blocked" in pick) {
      if (pick.job_id) await this.recordUnit(c.units, { stage: "analysis", job_id: pick.job_id, outcome: pick.blocked, by: pick.by, paid: true, reason: pick.reason });
      c.state = "blocked"; c.reason = pick.reason;
      return;
    }
    const claim = await this.recordClaiming(c.units, "analysis", pick);
    const unit = await this.runUnit(n.number_id, c.conversation_id, "analysis", claim.job_id, claim.by, claim.prior);
    if (pick.superseded_job_id) unit.superseded_job_id = pick.superseded_job_id;
    await this.recordUnit(c.units, unit);
    await this.seams.save(this.manifest);
    if (unit.outcome !== "done") { c.state = unit.outcome === "missing" ? "failed" : unit.outcome; c.reason = `analysis:${unit.reason ?? unit.outcome}`; return; }
    const app = await this.driveApplication(n.number_id, c.conversation_id, pick.job_id, c.units);
    await this.holdSchedule(n.number_id);
    if (!app.unit) { c.state = "skipped"; c.reason = `no_receipt:${unit.reason ?? "none"}`; return; }
    if (app.unit.outcome !== "done") { c.state = app.unit.outcome === "missing" ? "failed" : app.unit.outcome; c.reason = `application:${app.unit.reason ?? app.unit.outcome}`; return; }
    c.state = "done"; delete c.reason;
  }

  /** The backfill's own synthesis, keyed by the Number's current fingerprint so a resume finds the same held job. */
  private async ownNumberJob(n: NumberEntry, extra: { prior?: PriorState; superseded_job_id?: string }): Promise<Pick> {
    const fingerprint = (await withTransaction(session => intelligenceSources(n.number_id, session))).fingerprint;
    const key = `${OWN_NUMBER_DEDUPE_PREFIX}${n.number_id}:${this.target.findings}:${fingerprint.slice(0, 16)}`;
    const existing = await this.jobs().findOne({ dedupe_key: key }).select("_id").lean();
    const id = existing ? String(existing._id) : await this.createHeld({ stage: "number_refresh", subject_key: `number:${n.number_id}`, dedupe_key: key,
      input_refs: [n.number_id] }, n.number_id, null);
    return { job_id: id, by: "backfill", ...extra };
  }

  /** The scheduled synthesis, or the normal scheduling path, or (fingerprint unchanged / S10-held and left) the backfill's own job. */
  private async pickNumberJob(n: NumberEntry): Promise<Pick | { none: true }> {
    const number = await getContactNumberModel().findById(n.number_id).select("intelligence_schedule").lean();
    const scheduled = number?.intelligence_schedule?.job_id ? await this.load(String(number.intelligence_schedule.job_id)) : null;
    let prior: PriorState | undefined, superseded: string | undefined;
    if (scheduled?.status === "completed") {
      // A synthesis already submitted on the target layout whose application never ran: apply it, don't pay for another.
      const run = await getIntelligenceRunModel().findOne({ job_id: String(scheduled._id) }).sort({ _id: -1 }).select("_id status step_contracts").lean();
      const submission = run?.status === "submitted" ? await getIntelligenceSubmissionModel().findOne({ run_id: run._id }).select("application_job_id").lean() : null;
      const app = submission?.application_job_id ? await this.load(String(submission.application_job_id)) : null;
      if (run && app && app.status !== "completed" && payloadHash(run.step_contracts ?? null) === this.targetDigest) return { job_id: String(scheduled._id), by: "prior" };
    } else if (scheduled) {
      const id = String(scheduled._id);
      if (scheduled.status === "paused" && scheduled.reason === "evidence_limit_reached") return { blocked: "blocked", reason: "evidence_limit_reached", by: null, job_id: id };
      const existing = await this.pickExisting(scheduled, n.number_id, null);
      if (existing && "supersede_foreign" in existing) {
        // `--s10-holds leave`: the held job stays held; the Number's one synthesis runs as the backfill's own job.
        n.expected_fingerprint_mismatch = "s10_hold_left";
        return this.ownNumberJob(n, { prior: this.priorOf(scheduled, "left"), superseded_job_id: id });
      }
      if (existing) return existing;
      const decided = await this.failedOrPending(scheduled, n.number_id, null);
      if (decided && !("superseded" in decided)) return decided;
      if (decided) { prior = decided.superseded; superseded = id; }
    }
    // The normal way (§4 step 4): scheduling compares the real fingerprint and, when it moved, creates the next generation.
    let jobId: string | null = null;
    for (let attempt = 0; ; attempt++) {
      try { jobId = await withTransaction(session => scheduleNumberIntelligence(n.number_id, session)); break; }
      catch (error) { if (attempt >= 2 || !(error instanceof Error && /REVISION_CONFLICT|WriteConflict/.test(`${error.message} ${(error as { code?: string }).code ?? ""}`))) throw error; }
    }
    const extra = { ...(prior ? { prior } : {}), ...(superseded ? { superseded_job_id: superseded } : {}) };
    if (jobId) {
      const job = await this.load(jobId);
      if (job && ["pending", "retry"].includes(job.status)) { await this.hold(job, n.number_id, null); return { job_id: jobId, by: "backfill", ...extra }; }
      if (job?.status === "paused" && job.reason === "evidence_limit_reached") return { blocked: "blocked", reason: "evidence_limit_reached", by: null, job_id: jobId };
      if (job && job.status !== "completed") return { blocked: "blocked", reason: `scheduled_${job.status}:${job.reason ?? ""}`, by: null, job_id: jobId };
    }
    // Fingerprint unchanged: synthesize only when the running summary is not on the target version yet.
    if (await this.runningSummaryCurrent(n.number_id)) return { none: true };
    return this.ownNumberJob(n, extra);
  }

  /** The running summary points to a completed target-version run newer than every conversation run of the Number. */
  async runningSummaryCurrent(numberId: string) {
    const number = await getContactNumberModel().findById(numberId).select("running_summary").lean();
    const summary = number?.running_summary as { run_id?: unknown } | null | undefined;
    if (!summary?.run_id) return false;
    const run = await getIntelligenceRunModel().findById(summary.run_id).select("status prompt_version createdAt").lean();
    if (!run || run.status !== "completed" || run.prompt_version !== this.target.findings) return false;
    const convRuns = (await getLeadConversationModel().find({ ...ELIGIBLE_CONVERSATION, contact_number_id: new mongoose.Types.ObjectId(numberId),
      latest_completed_run_id: { $ne: null } }).select("latest_completed_run_id").lean()).map(r => String(r.latest_completed_run_id));
    const newest = convRuns.length ? await getIntelligenceRunModel().findOne({ _id: { $in: convRuns } }).sort({ createdAt: -1 }).select("createdAt").lean() : null;
    return !newest || new Date(run.createdAt as Date).getTime() >= new Date(newest.createdAt as Date).getTime();
  }

  async driveSynthesis(n: NumberEntry) {
    if (n.conversations.some(c => c.state === "pending" || c.state === "deferred")) { n.state = "deferred"; n.reason = "conversations_pending"; return; }
    let submitted = n.synthesis.filter(u => u.stage === "number_refresh" && u.submitted).length;
    for (let round = 0; round < 2 * MAX_SYNTHESES_PER_NUMBER + 1 && !this.fatal; round++) {
      if (submitted >= MAX_SYNTHESES_PER_NUMBER) break;
      const pick = await this.pickNumberJob(n);
      if ("none" in pick) break;
      if ("blocked" in pick) {
        if (pick.job_id) await this.recordUnit(n.synthesis, { stage: "number_refresh", job_id: pick.job_id, outcome: pick.blocked, by: pick.by, paid: true, reason: pick.reason });
        n.state = "blocked"; n.reason = pick.reason;
        return;
      }
      const claim = await this.recordClaiming(n.synthesis, "number_refresh", pick);
      const unit = await this.runUnit(n.number_id, null, "number_refresh", claim.job_id, claim.by, claim.prior);
      if (pick.superseded_job_id) unit.superseded_job_id = pick.superseded_job_id;
      const run = await getIntelligenceRunModel().findOne({ job_id: pick.job_id }).select("_id status").sort({ _id: -1 }).lean();
      if (run) unit.run_id = String(run._id);
      await this.recordUnit(n.synthesis, unit);
      await this.seams.save(this.manifest);
      if (unit.outcome !== "done") { n.state = unit.outcome === "missing" ? "failed" : unit.outcome; n.reason = `number_refresh:${unit.reason ?? unit.outcome}`; return; }
      if (unit.reason && ["no_transcript_evidence", "excluded"].includes(unit.reason)) { n.state = "skipped"; n.reason = unit.reason; return; }
      if (!run || !["submitted", "completed"].includes(String(run.status))) continue; // stale / coalesced: the next generation follows.
      unit.submitted = true;
      await this.recordUnit(n.synthesis, unit);
      submitted++;
      const app = await this.driveApplication(n.number_id, null, pick.job_id, n.synthesis);
      if (app.unit && app.unit.outcome !== "done") { n.state = app.unit.outcome === "missing" ? "failed" : app.unit.outcome; n.reason = `application:${app.unit.reason ?? app.unit.outcome}`; return; }
      if (await this.followupScheduled(n.number_id, pick.job_id) === null) break;
    }
    // A generation scheduled after the last allowed synthesis stays held and is listed.
    const leftover = await this.followupScheduled(n.number_id, null);
    if (leftover) { await this.hold(leftover, n.number_id, null); n.reason = "followup_generation_held"; }
    if (!this.fatal) n.state = "done";
  }
  /** The Number's scheduled job when it is a new, runnable generation (not `exclude`). */
  private async followupScheduled(numberId: string, exclude: string | null) {
    const number = await getContactNumberModel().findById(numberId).select("intelligence_schedule").lean();
    const id = number?.intelligence_schedule?.job_id ? String(number.intelligence_schedule.job_id) : null;
    if (!id || id === exclude) return null;
    const job = await this.load(id);
    return job && ["pending", "retry"].includes(job.status) ? job : null;
  }

  async driveNumber(n: NumberEntry): Promise<boolean> {
    if (["done", "skipped"].includes(n.state)) return true;
    const number = await getContactNumberModel().findById(n.number_id)
      .select("kind classification purged_at content_purge_pending contact_eligibility last_activity_at").lean();
    const exclusion = numberExclusion(number as NumberRow | null, this.now(), null);
    if (exclusion) { n.state = "skipped"; n.reason = exclusion; await this.seams.save(this.manifest); return true; }
    for (const c of n.conversations) {
      await this.driveConversation(n, c);
      await this.seams.save(this.manifest);
      if (this.fatal) break;
    }
    if (!this.fatal) {
      n.state = "conversations_done";
      await this.driveSynthesis(n);
    }
    await this.seams.save(this.manifest);
    await this.seams.log("number", { number_id: n.number_id, state: n.state, reason: n.reason ?? null,
      conversations: n.conversations.length, syntheses: n.synthesis.filter(u => u.submitted).length });
    return !this.fatal;
  }

  /** Foreign holds seen now (by query), listed; notes where this run's Number synthesis supersedes them. */
  async listForeignHolds() {
    const holds = (await this.jobs().find({ ...csiDataset(), status: "paused", reason: OPERATOR_HOLD_REASON }).select(JOB_FIELDS).lean()) as JobRow[];
    for (const job of holds) {
      if (this.holdOwner(job) !== "foreign") continue;
      const numberId = job.subject_key.startsWith("number:") ? job.subject_key.slice(7) : null;
      const entry = numberId ? this.manifest.numbers.find(n => n.number_id === numberId) : null;
      const synthesized = entry?.synthesis.some(u => u.stage === "number_refresh" && u.submitted);
      const known = this.manifest.foreign_holds.find(h => h.job_id === String(job._id));
      this.noteForeign(job, "left", numberId, synthesized ? "superseded_by_backfill_synthesis" : known?.note ?? "not_superseded");
    }
  }
}

// ── Verification (§7) ─────────────────────────────────────────────────────────────
export type NumberVerdict = { number_id: string; state: string; reason: string | null; summary_current: boolean; fingerprint_match: boolean | null;
  expected_mismatch: string | null; conversations_left: number; pass: boolean };
export type Verification = {
  at: string;
  /** True only when every in-scope Number passes, no conversation is left and no hold this run or the repair owns remains. */
  complete: boolean;
  conversations_left: { a: number; b: number };
  numbers: { checked: number; passed: number; summary_current: number; fingerprint_match: number; expected_mismatch: string[]; skipped: Array<{ number_id: string; reason: string | null }> };
  leftovers: NumberVerdict[];
  holds: { own_left: number; repair_still_held: number; foreign: number };
  peer_paid_units: number;
  peer_units: Array<{ job_id: string; stage: string }>;
  spend: Array<{ ledger: string; step: string; reservations: number; actual_cents: number }>;
  /** §7: Owner-ledger spend in the run window against the same window a day earlier (it should be live traffic only). */
  owner_ledger: { window: { from: string; to: string; reservations: number; cents: number }; day_before: { from: string; to: string; reservations: number; cents: number } };
};
/** Pure: a Number passes when its summary is current, its fingerprint matches (or the mismatch is expected) and no conversation is left. */
export function numberVerdict(input: Omit<NumberVerdict, "pass">): NumberVerdict {
  return { ...input, pass: input.summary_current && (input.fingerprint_match === true || input.expected_mismatch !== null) && input.conversations_left === 0 };
}
export async function verifyBackfill(manifest: FullBackfillManifest, repairHoldIds: ReadonlySet<string>, model: string, now = new Date()): Promise<Verification> {
  const target = manifest.prompt_versions;
  const checker = new FullBackfill(manifest, { runners: createBackfillRunners(), save: async () => undefined, log: async () => undefined },
    { concurrency: 1, s10Holds: manifest.options.s10_holds, repairManifest: null, skipRepair: true, numbers: null, since: null, maxNumbers: null, model }, repairHoldIds);
  const left = { a: 0, b: 0 };
  const numbers: Verification["numbers"] = { checked: 0, passed: 0, summary_current: 0, fingerprint_match: 0, expected_mismatch: [], skipped: [] };
  const leftovers: NumberVerdict[] = [];
  for (const n of manifest.numbers) {
    if (n.state === "skipped") { numbers.skipped.push({ number_id: n.number_id, reason: n.reason ?? null }); continue; }
    numbers.checked++;
    let conversationsLeft = 0;
    const cursor = getLeadConversationModel().find({ ...ELIGIBLE_CONVERSATION, contact_number_id: new mongoose.Types.ObjectId(n.number_id) })
      .select("contact_number_id started_at latest_transcript_version latest_completed_run_id summary.prompt_version").lean().cursor();
    for await (const row of cursor) { const set = await conversationSet(row as unknown as ConversationRow, target); if (set) { left[set]++; conversationsLeft++; } }
    const summaryCurrent = await checker.runningSummaryCurrent(n.number_id);
    let fingerprintMatch: boolean | null = null;
    try {
      fingerprintMatch = await withTransaction(async session => {
        const sources = await intelligenceSources(n.number_id, session);
        return sources.number.intelligence_schedule?.fingerprint === sources.fingerprint;
      });
    } catch { fingerprintMatch = null; }
    const verdict = numberVerdict({ number_id: n.number_id, state: n.state, reason: n.reason ?? null, summary_current: summaryCurrent,
      fingerprint_match: fingerprintMatch, expected_mismatch: fingerprintMatch ? null : n.expected_fingerprint_mismatch ?? null, conversations_left: conversationsLeft });
    n.verification = { summary_current: summaryCurrent, fingerprint_match: fingerprintMatch, expected_mismatch: verdict.expected_mismatch, pass: verdict.pass };
    if (summaryCurrent) numbers.summary_current++;
    if (fingerprintMatch) numbers.fingerprint_match++;
    if (verdict.expected_mismatch) numbers.expected_mismatch.push(n.number_id);
    if (verdict.pass) numbers.passed++; else leftovers.push(verdict);
  }
  const Jobs = getSalesIntelligenceJobModel();
  const ownLeft = await Jobs.countDocuments({ status: "paused", reason: OPERATOR_HOLD_REASON, $or: [
    { _id: { $in: manifest.holds.map(h => new mongoose.Types.ObjectId(h.job_id)) } },
    { dedupe_key: { $regex: OWN_DEDUPE_MARK } }, { dedupe_key: { $regex: `^${OWN_NUMBER_DEDUPE_PREFIX}` } }] });
  const repairHeld = repairHoldIds.size ? await Jobs.countDocuments({ _id: { $in: [...repairHoldIds] }, status: "paused", reason: OPERATOR_HOLD_REASON }) : 0;
  const units = manifest.numbers.flatMap(n => [...n.conversations.flatMap(c => c.units), ...n.synthesis]);
  const peers = units.filter(u => u.paid && u.by === "peer");
  const Reservations = getSalesIntelligenceAiReservationModel();
  const spend = await Reservations.aggregate<{ _id: { ledger: string; step: string }; n: number; cents: number }>([
    { $match: { reserved_at: { $gte: new Date(manifest.created_at) } } },
    { $group: { _id: { ledger: "$ledger", step: { $arrayElemAt: [{ $split: ["$step", ":"] }, 0] } }, n: { $sum: 1 },
      cents: { $sum: { $ifNull: ["$actual_cents", { $ifNull: ["$observed_cents", 0] }] } } } },
    { $sort: { "_id.ledger": 1, "_id.step": 1 } },
  ]);
  const ownerWindow = async (from: Date, to: Date) => {
    const [row] = await Reservations.aggregate<{ n: number; cents: number }>([
      { $match: { ledger: { $ne: "personal" }, reserved_at: { $gte: from, $lt: to } } },
      { $group: { _id: null, n: { $sum: 1 }, cents: { $sum: { $ifNull: ["$actual_cents", { $ifNull: ["$observed_cents", 0] }] } } } },
    ]);
    return { from: from.toISOString(), to: to.toISOString(), reservations: row?.n ?? 0, cents: row?.cents ?? 0 };
  };
  const start = new Date(manifest.created_at), day = 86_400_000;
  const holds = { own_left: ownLeft, repair_still_held: repairHeld, foreign: manifest.foreign_holds.length };
  return {
    at: now.toISOString(), complete: leftovers.length === 0 && left.a + left.b === 0 && ownLeft === 0 && repairHeld === 0,
    conversations_left: left, numbers, leftovers, holds,
    peer_paid_units: peers.length, peer_units: peers.map(u => ({ job_id: u.job_id, stage: u.stage })),
    spend: spend.map(s => ({ ledger: s._id.ledger, step: s._id.step, reservations: s.n, actual_cents: s.cents })),
    owner_ledger: { window: await ownerWindow(start, now), day_before: await ownerWindow(new Date(start.getTime() - day), new Date(now.getTime() - day)) },
  };
}

// ── Summary and run ──────────────────────────────────────────────────────────────────
export function summarize(manifest: FullBackfillManifest) {
  const tally = (values: string[]) => values.reduce<Record<string, number>>((out, v) => ({ ...out, [v]: (out[v] ?? 0) + 1 }), {});
  const units = manifest.numbers.flatMap(n => [...n.conversations.flatMap(c => c.units), ...n.synthesis]);
  return {
    complete: manifest.phases.verify?.complete ?? false,
    numbers: tally(manifest.numbers.map(n => n.state)),
    conversations: tally(manifest.numbers.flatMap(n => n.conversations.map(c => c.state))),
    units_by: tally(units.map(u => `${u.stage}:${u.by ?? "none"}`)),
    rearmed: units.filter(u => u.prior?.action === "rearmed").length,
    superseded: units.filter(u => u.prior?.action === "superseded").length,
    peer_paid_units: units.filter(u => u.paid && u.by === "peer").length,
    holds: manifest.holds.length, foreign_holds: manifest.foreign_holds.length,
    leftovers: manifest.phases.verify?.leftovers.map(l => l.number_id) ?? [],
    ...(manifest.stopped ? { stopped: manifest.stopped } : {}),
  };
}

/** Phases 1–5 on an apply manifest. Resumable: done Numbers and units are skipped; own holds are released and claimed. */
export async function runFullBackfill(manifest: FullBackfillManifest, seams: BackfillSeams, options: BackfillOptions) {
  const now = seams.now ?? (() => new Date());
  delete manifest.stopped;
  // Phase 1: the CC-07 repair finishes its own held work through its own script (never `--release-holds`); a failed repair is re-run on resume.
  if (["pending", "failed"].includes(manifest.phases.repair.state) && options.repairManifest && !options.skipRepair) {
    if (!seams.runRepair) throw new Error("phase 1 needs a repair runner");
    manifest.phases.repair = { state: "pending", started_at: now().toISOString(), attempts: (manifest.phases.repair.attempts ?? 0) + 1 };
    await seams.save(manifest);
    await seams.log("repair_start", { repair_manifest: options.repairManifest, attempt: manifest.phases.repair.attempts });
    const code = await seams.runRepair(options.repairManifest);
    manifest.phases.repair = { ...manifest.phases.repair, state: code === 0 ? "done" : "failed", exit_code: code, finished_at: now().toISOString() };
    if (code !== 0) manifest.stopped = `repair_exit_${code}`;
    await seams.save(manifest);
    if (code !== 0) throw new Error(`repair exited ${code}; fix it and resume`);
  } else if (["pending", "failed"].includes(manifest.phases.repair.state) && options.skipRepair) manifest.phases.repair = { ...manifest.phases.repair, state: "skipped" };
  const repairHoldIds = await readRepairHoldIds(options.repairManifest);
  manifest.phases.repair.holds_remaining = repairHoldIds.size;

  // Phase 2: work set and estimate, after the repair (it adds analysed conversations).
  if (manifest.phases.select.state !== "done") {
    const ws = await selectWorkSet(manifest.prompt_versions, { numbers: options.numbers, since: options.since, maxNumbers: options.maxNumbers }, now());
    manifest.numbers = ws.numbers.map(n => ({ number_id: n.number_id, sets: n.sets, state: "pending", synthesis: [],
      conversations: n.conversations.map(c => ({ ...c, state: "pending", units: [] })) }));
    manifest.phases.select = { state: "done", at: now().toISOString(), excluded: ws.excluded, counts: ws.counts };
    manifest.phases.estimate = await estimateWorkSet(ws, manifest.prompt_versions, options.model, repairHoldIds, now());
    await seams.save(manifest);
    await seams.log("selected", { counts: ws.counts, excluded: ws.excluded, projected_cents: manifest.phases.estimate.projected_cents });
  }

  // Phases 3–4: per Number, its conversations oldest first, then one synthesis.
  const runner = new FullBackfill(manifest, seams, options, repairHoldIds);
  const pending = manifest.numbers.filter(n => !["done", "skipped"].includes(n.state));
  try {
    await runBoundedBackfill(pending, options.concurrency, async (entry, stop) => {
      const go = await runner.driveNumber(entry);
      if (!go) stop();
      return go;
    });
  } finally {
    if (runner.fatal) manifest.stopped = runner.fatal;
    await seams.save(manifest);
  }
  await runner.listForeignHolds();

  // Phase 5: verification of every Number in the work set.
  manifest.phases.verify = await verifyBackfill(manifest, repairHoldIds, options.model, now());
  await seams.save(manifest);
  const summary = summarize(manifest);
  await seams.log("summary", { ...summary, verify: manifest.phases.verify });
  return summary;
}
