/**
 * S5c-RECOVERY one-time stamp (reconciliation addendum §3.3 G4; S10 step 5).
 *
 * Stamps `CallInteraction.capture_recovery = { run_id, at, kind }` on the calls the 2026-09-20 Call
 * Log repair inserted (`added`) or completed (`completed`), so the Owner timeline says `recovered`
 * and the Case File says "(recovered by a capture repair on {date})".
 *
 * Source of truth: the repair manifest (`call-log-repair-v1`). Its `interactions[]` name the call,
 * its Call Log record and the repair's verdict: `created: true` → `added`; `STALE` → `completed`;
 * `unchanged` (label-only rewrites) → nothing. Each entry must match its repair audit row
 * (`subject_key: interaction:<id>`, `current.proof_ref: call_log_repair:<record_id>`); an entry
 * without one is reported, never stamped. `at` is that audit row's `recorded_at` (when the repair
 * wrote the call); `run_id` is the manifest's.
 *
 * The write is provenance only (`lib/call-log-repair-recovery.ts`): one `$set` on a row with no
 * `capture_recovery`, no `projection_revision` bump, no `updatedAt`, no rollup, no job. It makes zero
 * model calls and creates zero jobs, asserted with the job-table count before and after.
 *
 *   dry run (default, read only):
 *     node --env-file=.env --import tsx ops/stamp-capture-recovery.ts \
 *       --manifest ops/output/call-log-repair-2026-09-20.json --allow-production
 *   apply (from the deployed commit; the production-writer guard refuses otherwise):
 *     node --env-file=.env --import tsx ops/stamp-capture-recovery.ts \
 *       --manifest ops/output/call-log-repair-2026-09-20.json --apply --allow-production
 *
 * Resumable: `--apply` keeps a checkpoint (`<out>/stamp-capture-recovery-<run_id>.checkpoint.json`) of
 * the entries already settled; a re-run skips them, and re-stamping is a no-op anyway. Every entry's
 * outcome goes to `<out>/stamp-capture-recovery-<run_id>-<mode>.jsonl`. The report is written to
 * `--report` (default `../sales-intelligence-ui-ux-workspace/evidence/S10-5-<env>.md`, the workspace
 * next to the `vantage-main-server` checkout). Identifiers and counts only.
 */
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { getCallInteractionModel } from "../src/models/CallInteraction";
import { getSalesIntelligenceAuditEventModel } from "../src/models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { recoveryKindFor, stampCaptureRecovery, type CaptureRecoveryKind } from "./lib/call-log-repair-recovery";
import { assertProductionWriterMatchesDeployment } from "./lib/production-writer-guard";

export const STAMP_VERSION = "stamp-capture-recovery-v1";
const BATCH = 100;

type ManifestEntry = { interaction_id: string; record_id: string | null; classification: string; created: boolean; day?: string };
type Manifest = { version: string; run_id: string; mode: string; created_at: string; dataset?: { deployment?: string; database?: string }; interactions: ManifestEntry[] };
export type StampOutcome = "would_stamp" | "stamped" | "already_stamped" | "stamped_by_other_run" | "unmatched_audit" | "missing_call" | "merged";
export type StampEntryResult = { interaction_id: string; record_id: string | null; kind: CaptureRecoveryKind; outcome: StampOutcome; at: string | null; audit_event: string | null };
export type StampReport = {
  version: typeof STAMP_VERSION; mode: "dry_run" | "apply"; database: string; env: string; manifest: string; manifest_run_id: string;
  manifest_database: string | null; dataset_matches: boolean; started_at: string; finished_at: string;
  candidates: { added: number; completed: number; total: number }; skipped_by_checkpoint: number;
  outcomes: Record<StampOutcome, number>; by_kind: Record<CaptureRecoveryKind, Partial<Record<StampOutcome, number>>>;
  jobs: { before: number; after: number; created: number }; unmatched: string[]; report_path: string | null;
};
export type StampOptions = {
  manifestPath: string; apply: boolean; outDir: string; reportPath: string | null; now?: () => Date; log?: (line: string) => void;
};

const OUTCOMES: StampOutcome[] = ["would_stamp", "stamped", "already_stamped", "stamped_by_other_run", "unmatched_audit", "missing_call", "merged"];

async function loadManifest(path: string): Promise<Manifest> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as Manifest;
  if (parsed.version !== "call-log-repair-v1") throw new Error(`${path} is not a call-log-repair-v1 manifest`);
  if (!parsed.run_id || !Array.isArray(parsed.interactions)) throw new Error(`${path} has no run_id or interactions`);
  if (parsed.mode !== "apply") throw new Error(`${path} is a ${parsed.mode} manifest: only an applied repair recovered calls`);
  return parsed;
}
const envName = (database: string) => (database === "vantagemovers" ? "production" : "replica");
async function writeAtomic(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, text);
  await rename(`${path}.tmp`, path);
}

/** The whole run for an already connected process. Throws when a job was created (it must never be). */
export async function runStampCaptureRecovery(opts: StampOptions): Promise<StampReport> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (line => console.log(line));
  const database = getMongoDatabaseName();
  const manifest = await loadManifest(opts.manifestPath);
  const mode = opts.apply ? "apply" : "dry_run";
  const base = `${opts.outDir}/stamp-capture-recovery-${manifest.run_id}`;
  const checkpointPath = `${base}.checkpoint.json`;
  const jsonlPath = `${base}-${mode}.jsonl`;
  await mkdir(opts.outDir, { recursive: true });
  const line = async (event: string, fields: Record<string, unknown> = {}) =>
    appendFile(jsonlPath, `${JSON.stringify({ at: now().toISOString(), run_id: manifest.run_id, mode, event, ...fields })}\n`);

  const candidates = manifest.interactions.flatMap(e => {
    const kind = recoveryKindFor(e.classification, e.created);
    return kind && mongoose.isValidObjectId(e.interaction_id) ? [{ ...e, kind }] : [];
  });
  const done = new Set<string>(opts.apply && existsSync(checkpointPath)
    ? ((JSON.parse(await readFile(checkpointPath, "utf8")) as { done?: string[] }).done ?? []) : []);
  const todo = candidates.filter(c => !done.has(c.interaction_id));
  const started = now();
  const Jobs = getSalesIntelligenceJobModel();
  const jobsBefore = await Jobs.countDocuments({});
  await line("start", { database, manifest: opts.manifestPath, candidates: candidates.length, todo: todo.length, jobs_before: jobsBefore });

  const outcomes = Object.fromEntries(OUTCOMES.map(o => [o, 0])) as Record<StampOutcome, number>;
  const byKind: StampReport["by_kind"] = { added: {}, completed: {} };
  const unmatched: string[] = [];
  const Calls = getCallInteractionModel(), Audits = getSalesIntelligenceAuditEventModel();
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const ids = batch.map(c => new mongoose.Types.ObjectId(c.interaction_id));
    const proofs = batch.map(c => `call_log_repair:${c.record_id ?? "unknown"}`);
    const [audits, calls] = await Promise.all([
      Audits.find({ subject_key: { $in: batch.map(c => `interaction:${c.interaction_id}`) }, "current.proof_ref": { $in: proofs },
        event_kind: { $in: ["interaction.created", "interaction.updated"] } }).select("subject_key event_kind recorded_at current.proof_ref").sort({ recorded_at: 1, _id: 1 })
        .limit(batch.length * 10).lean(),
      Calls.find({ _id: { $in: ids } }).select("capture_recovery merged_into_id").limit(batch.length).lean(),
    ]);
    const callById = new Map(calls.map(c => [String(c._id), c as unknown as { merged_into_id?: unknown; capture_recovery?: { run_id?: string } | null }]));
    for (const entry of batch) {
      const proof = `call_log_repair:${entry.record_id ?? "unknown"}`;
      const mine = (audits as unknown as Array<{ _id: unknown; subject_key: string; event_kind: string; recorded_at: Date; current?: { proof_ref?: string } }>)
        .filter(a => a.subject_key === `interaction:${entry.interaction_id}` && a.current?.proof_ref === proof);
      // `added` is proven by the repair's creation row; `completed` by its (first) update row.
      const audit = mine.find(a => a.event_kind === (entry.kind === "added" ? "interaction.created" : "interaction.updated")) ?? null;
      const call = callById.get(entry.interaction_id);
      let outcome: StampOutcome;
      if (!audit) { outcome = "unmatched_audit"; unmatched.push(entry.interaction_id); }
      else if (!call) outcome = "missing_call";
      else if (call.merged_into_id) outcome = "merged";
      else if (call.capture_recovery) outcome = call.capture_recovery.run_id === manifest.run_id ? "already_stamped" : "stamped_by_other_run";
      else if (!opts.apply) outcome = "would_stamp";
      else outcome = await stampCaptureRecovery(entry.interaction_id, { run_id: manifest.run_id, at: audit.recorded_at, kind: entry.kind }) ? "stamped" : "already_stamped";
      outcomes[outcome]++;
      byKind[entry.kind][outcome] = (byKind[entry.kind][outcome] ?? 0) + 1;
      const result: StampEntryResult = { interaction_id: entry.interaction_id, record_id: entry.record_id, kind: entry.kind, outcome,
        at: audit ? audit.recorded_at.toISOString() : null, audit_event: audit ? String(audit._id) : null };
      await line("entry", result);
      if (opts.apply && outcome !== "unmatched_audit" && outcome !== "missing_call") done.add(entry.interaction_id);
    }
    if (opts.apply) await writeAtomic(checkpointPath, JSON.stringify({ version: STAMP_VERSION, manifest_run_id: manifest.run_id, done: [...done].sort() }, null, 1));
  }

  const jobsAfter = await Jobs.countDocuments({});
  const report: StampReport = {
    version: STAMP_VERSION, mode, database, env: envName(database), manifest: opts.manifestPath, manifest_run_id: manifest.run_id,
    manifest_database: manifest.dataset?.database ?? null, dataset_matches: (manifest.dataset?.database ?? null) === database,
    started_at: started.toISOString(), finished_at: now().toISOString(),
    candidates: { added: candidates.filter(c => c.kind === "added").length, completed: candidates.filter(c => c.kind === "completed").length, total: candidates.length },
    skipped_by_checkpoint: candidates.length - todo.length, outcomes, by_kind: byKind,
    jobs: { before: jobsBefore, after: jobsAfter, created: jobsAfter - jobsBefore }, unmatched, report_path: opts.reportPath,
  };
  await line("summary", report as unknown as Record<string, unknown>);
  if (opts.reportPath) await writeAtomic(opts.reportPath, renderReport(report));
  log(JSON.stringify({ done: true, mode, database, candidates: report.candidates, outcomes, jobs: report.jobs }));
  // Zero jobs is the contract. A concurrent writer (production traffic) can move the count; the report says so and the run fails loudly.
  if (report.jobs.created !== 0) throw new Error(`job table changed during the stamp (${jobsBefore} → ${jobsAfter}); this script creates none — check for concurrent writers`);
  return report;
}

export function renderReport(r: StampReport): string {
  const kinds = (k: CaptureRecoveryKind) => OUTCOMES.filter(o => r.by_kind[k][o]).map(o => `${o} ${r.by_kind[k][o]}`).join(", ") || "none";
  return [
    `# S10 step 5: capture_recovery stamp (${r.env})`,
    "",
    `Generated by \`ops/stamp-capture-recovery.ts\` (${r.version}). Identifiers and counts only.`,
    "",
    "| Fact | Value |", "|---|---|",
    `| Mode | ${r.mode === "apply" ? "apply" : "dry run (read only)"} |`,
    `| Database | \`${r.database}\` |`,
    `| Manifest | \`${r.manifest}\` (repair run \`${r.manifest_run_id}\`, dataset \`${r.manifest_database ?? "unknown"}\`${r.dataset_matches ? "" : ", **differs from this database**"}) |`,
    `| Window | ${r.started_at} → ${r.finished_at} |`,
    `| Candidates | ${r.candidates.total} (added ${r.candidates.added}, completed ${r.candidates.completed}) |`,
    `| Skipped by checkpoint | ${r.skipped_by_checkpoint} |`,
    ...OUTCOMES.map(o => `| ${o} | ${r.outcomes[o]} |`),
    `| Added | ${kinds("added")} |`,
    `| Completed | ${kinds("completed")} |`,
    `| Jobs before → after | ${r.jobs.before} → ${r.jobs.after} (created ${r.jobs.created}) |`,
    "",
    r.unmatched.length ? `Entries without a matching repair audit row (not stamped): ${r.unmatched.map(id => `\`${id}\``).join(", ")}` : "Every candidate matched its repair audit row.",
    "",
  ].join("\n");
}

// ── Entry point ──────────────────────────────────────────────────────────────
function option(name: string) {
  const at = process.argv.indexOf(name);
  if (at < 0) return undefined;
  const value = process.argv[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name} value`);
  return value;
}
const flag = (name: string) => process.argv.includes(name);
const localDatabase = (database: string, uri: string | undefined) =>
  /^testvantagemovers_[a-z0-9]+$/i.test(database) && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri ?? "");

async function main() {
  const manifestPath = option("--manifest");
  if (!manifestPath) throw new Error("--manifest <call-log-repair manifest> is required");
  const apply = flag("--apply");
  await connectMongo();
  const database = getMongoDatabaseName();
  if (!localDatabase(database, process.env.MONGO_URI) && !flag("--allow-production"))
    throw new Error("the database is not a local testvantagemovers_* one; pass --allow-production to proceed");
  // CC-00 §5.2: only the deployed build writes production (override: --allow-schema-drift). A dry run writes nothing.
  if (apply) await assertProductionWriterMatchesDeployment();
  const reportPath = option("--report") ?? resolve("..", "sales-intelligence-ui-ux-workspace", "evidence", `S10-5-${envName(database)}.md`);
  await runStampCaptureRecovery({ manifestPath: resolve(manifestPath), apply, outDir: resolve(option("--out") ?? "ops/output"), reportPath });
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ stopped: true, error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 400) : "setup_failed" }));
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}
