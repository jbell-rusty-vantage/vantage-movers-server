/**
 * AC1 K4 (Attention and Case File spec §3.4): rewrite stored Number fingerprints to the split
 * rule WITHOUT enqueuing analysis.
 *
 * AC1 changes what `intelligenceSources` hashes. Every stored `contact_numbers.intelligence_schedule.fingerprint`
 * was written with the old rule. Since decision T4-D4 the scheduler itself re-stamps such a value the first
 * time it visits a Number that has not changed (`scheduleNumberIntelligence`, one-time migration branch), so
 * no wave of runs follows the deploy and this script is a **verifier** (dry run: `rewrite` falls to 0 over one
 * sweep lap) and an optional accelerator (`--apply` re-stamps every settled Number at once): for each Number
 * whose stored fingerprint equals the OLD rule's hash of its current state, it stores the NEW rule's hash.
 *
 * It never enqueues, never touches a Number whose scheduled job is still active or applying, and
 * never touches a Number with a real pending change (stored != old hash): the new build schedules
 * that one exactly as the old build would have.
 *
 *   node --env-file=.env --import tsx ops/refingerprint-numbers.ts [--limit N] [--sample N]
 *        [--apply] [--allow-production] [--allow-schema-drift] [--include-unscheduled] [--json <path>]
 *
 * - Dry run (default): reads only and prints counts. Writes nothing.
 * - `--apply`: rewrites `intelligence_schedule.fingerprint` only (fenced on the Number revision and the
 *   stored value; the revision is not incremented, so no editor fence is invalidated).
 * - Production (database `vantagemovers`) needs `--allow-production` for any run, and `--apply` there also
 *   passes the CC-00 drift guard: run it from a clean checkout of the deployed commit, AFTER the deploy.
 */
import { writeFile } from "node:fs/promises";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { csiDataset } from "../src/config/domain/salesIntelligence";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getIntelligenceSubmissionModel } from "../src/models/IntelligenceSubmission";
import { intelligenceSources } from "../src/services/salesIntelligence/analysis/sources";
import { legacyOutreachFingerprint } from "./lib/legacy-outreach-fingerprint";
import { CsiError } from "../src/services/salesIntelligence/auth";
import { assertProductionWriterMatchesDeployment } from "./lib/production-writer-guard";

type Sources = Awaited<ReturnType<typeof intelligenceSources>>;

/** The 01bcf18 rule (the scheduler re-stamp that shared it was removed after `rewrite = 0`, Team 3 2026-09-24). */
export const legacyFingerprint = (sources: Sources) => legacyOutreachFingerprint(sources);

export type RefingerprintOutcome =
  | "unchanged"          // stored == new rule: nothing to do (already current, or the rules agree)
  | "rewrite"            // stored == old rule != new rule: the wave this script removes
  | "pending_change"     // stored matches neither: a real change is waiting; the new build schedules it (as the old one would)
  | "active_job"         // the scheduled job is still running/applying: left for the worker
  | "evidence_limit"     // EVIDENCE_LIMIT_REACHED: the overflow path is unchanged by AC1
  | "unavailable"        // purged / ORIGINAL_EVIDENCE_UNAVAILABLE
  | "raced";             // --apply only: the Number changed between read and write

type NumberRow = { _id: mongoose.Types.ObjectId; revision: number; intelligence_schedule: { fingerprint: string; generation: number; job_id: mongoose.Types.ObjectId } | null };

/** Same "still active" test as `scheduleNumberIntelligence`, so a job it would wait for is never re-fingerprinted. */
async function scheduledJobActive(jobId: mongoose.Types.ObjectId, session: mongoose.ClientSession) {
  const active = await getSalesIntelligenceJobModel().findOne({ _id: jobId, ...csiDataset() }).session(session).lean();
  if (active && !["completed", "dead_letter"].includes(active.status)) return true;
  const applying = active ? await getIntelligenceRunModel().findOne({ job_id: active._id, ...csiDataset(), status: "submitted" }).session(session).lean() : null;
  if (!applying) return false;
  const receipt = await getIntelligenceSubmissionModel().findOne({ run_id: applying._id }).session(session).lean();
  return Boolean(receipt && await getSalesIntelligenceJobModel().exists({ _id: receipt.application_job_id, status: { $nin: ["completed", "dead_letter"] } }).session(session));
}

export async function classifyNumber(number: NumberRow, session: mongoose.ClientSession): Promise<{ outcome: RefingerprintOutcome; next?: string; transcribed?: boolean }> {
  const stored = number.intelligence_schedule!;
  if (await scheduledJobActive(stored.job_id, session)) return { outcome: "active_job" };
  let sources: Sources;
  try { sources = await intelligenceSources(String(number._id), session); }
  catch (error) {
    if (error instanceof CsiError && error.code === "EVIDENCE_LIMIT_REACHED") return { outcome: "evidence_limit" };
    if (error instanceof CsiError && error.code === "ORIGINAL_EVIDENCE_UNAVAILABLE") return { outcome: "unavailable" };
    throw error;
  }
  const transcribed = sources.conversations.length > 0;
  if (stored.fingerprint === sources.fingerprint) return { outcome: "unchanged", transcribed };
  if (stored.fingerprint === legacyFingerprint(sources)) return { outcome: "rewrite", next: sources.fingerprint, transcribed };
  return { outcome: "pending_change", transcribed };
}

export type RefingerprintReport = {
  mode: "dry_run" | "apply"; database: string; scanned: number; limit: number; truncated: boolean;
  without_schedule: number; counts: Record<RefingerprintOutcome, number>;
  rewrite_transcribed: number; pending_change_transcribed: number; applied: number; sample_rewrite: string[];
  /** --include-unscheduled (informational, read-only): Numbers without a stored schedule whose old and new rule hashes differ. */
  unscheduled?: { scanned: number; rules_differ: number; rules_differ_transcribed: number; errors: number };
};

/**
 * Walks Numbers that carry a stored schedule, `_id` ascending, at most `limit`. Dry run: a plain
 * session, reads only. Apply: one transaction per Number, read and fenced write together.
 */
export async function refingerprintNumbers(options: { apply: boolean; limit: number; sample?: number; page?: number; includeUnscheduled?: boolean; log?: (line: string) => void }): Promise<RefingerprintReport> {
  const Numbers = getContactNumberModel();
  const counts: Record<RefingerprintOutcome, number> = { unchanged: 0, rewrite: 0, pending_change: 0, active_job: 0, evidence_limit: 0, unavailable: 0, raced: 0 };
  const report: RefingerprintReport = { mode: options.apply ? "apply" : "dry_run", database: getMongoDatabaseName(), scanned: 0, limit: options.limit, truncated: false,
    without_schedule: await Numbers.countDocuments({ intelligence_schedule: null }), counts, rewrite_transcribed: 0, pending_change_transcribed: 0, applied: 0, sample_rewrite: [] };
  const page = options.page ?? 200;
  let after: mongoose.Types.ObjectId | null = null;
  const session = options.apply ? null : await mongoose.startSession();
  try {
    for (;;) {
      const rows = await Numbers.find({ intelligence_schedule: { $ne: null }, ...(after ? { _id: { $gt: after } } : {}) })
        .select({ _id: 1, revision: 1, intelligence_schedule: 1 }).sort({ _id: 1 }).limit(page).lean() as unknown as NumberRow[];
      if (!rows.length) break;
      for (const row of rows) {
        if (report.scanned >= options.limit) { report.truncated = true; break; }
        report.scanned++;
        after = row._id;
        const decided = options.apply
          ? await withTransaction(async s => {
            const current = await Numbers.findById(row._id).select({ _id: 1, revision: 1, intelligence_schedule: 1 }).session(s).lean() as unknown as NumberRow | null;
            if (!current?.intelligence_schedule) return { outcome: "raced" as const };
            const result = await classifyNumber(current, s);
            if (result.outcome !== "rewrite") return result;
            const written = await Numbers.updateOne({ _id: current._id, revision: current.revision, "intelligence_schedule.fingerprint": current.intelligence_schedule.fingerprint,
              "intelligence_schedule.job_id": current.intelligence_schedule.job_id }, { $set: { "intelligence_schedule.fingerprint": result.next } }, { session: s });
            return written.modifiedCount === 1 ? { ...result, applied: true } : { outcome: "raced" as const };
          })
          : await classifyNumber(row, session!);
        counts[decided.outcome]++;
        if (decided.outcome === "rewrite" && decided.transcribed) report.rewrite_transcribed++;
        if (decided.outcome === "pending_change" && decided.transcribed) report.pending_change_transcribed++;
        if ("applied" in decided && decided.applied) report.applied++;
        if (decided.outcome === "rewrite" && report.sample_rewrite.length < (options.sample ?? 10)) report.sample_rewrite.push(String(row._id));
      }
      if (report.truncated || rows.length < page) break;
      options.log?.(JSON.stringify({ progress: report.scanned, counts }));
    }
    if (options.includeUnscheduled) {
      const unscheduled = { scanned: 0, rules_differ: 0, rules_differ_transcribed: 0, errors: 0 };
      const probe = session ?? await mongoose.startSession();
      try {
        for (const row of await Numbers.find({ intelligence_schedule: null, kind: "external" }).select({ _id: 1 }).sort({ _id: 1 }).limit(options.limit).lean()) {
          unscheduled.scanned++;
          try {
            const sources = await intelligenceSources(String(row._id), probe);
            if (legacyFingerprint(sources) !== sources.fingerprint) { unscheduled.rules_differ++; if (sources.conversations.length) unscheduled.rules_differ_transcribed++; }
          } catch (error) { if (!(error instanceof CsiError)) throw error; unscheduled.errors++; }
        }
      } finally { if (probe !== session) await probe.endSession(); }
      report.unscheduled = unscheduled;
    }
  } finally { await session?.endSession(); }
  return report;
}

function option(name: string) {
  const at = process.argv.indexOf(name);
  if (at < 0) return undefined;
  const value = process.argv[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name} value`);
  return value;
}
const localDatabase = (database: string, uri: string | undefined) =>
  /^testvantagemovers_[a-z0-9]+$/i.test(database) && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri ?? "");

async function main() {
  const apply = process.argv.includes("--apply");
  const limit = Number(option("--limit") ?? 100_000);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) throw new Error("--limit must be 1..100000");
  const sample = Number(option("--sample") ?? 10);
  // S10-REPAIR: a verifier sends no DDL (model autoIndex would re-create a missing index, e.g. the sheet-sync TTL).
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  await connectMongo();
  const database = getMongoDatabaseName();
  if (!localDatabase(database, process.env.MONGO_URI)) {
    if (!process.argv.includes("--allow-production")) throw new Error("the database is not a local testvantagemovers_* one; pass --allow-production to read it");
    if (apply) await assertProductionWriterMatchesDeployment(); // CC-00 §5.2: only the deployed build writes production
  }
  const report = await refingerprintNumbers({ apply, limit, sample, includeUnscheduled: process.argv.includes("--include-unscheduled"), log: line => console.error(line) });
  console.log(JSON.stringify(report, null, 1));
  const out = option("--json");
  if (out) await writeFile(out, JSON.stringify(report, null, 1) + "\n");
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ stopped: true, error: error instanceof CsiError ? error.code : error instanceof Error ? error.message.slice(0, 200) : "setup_failed" }));
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}
