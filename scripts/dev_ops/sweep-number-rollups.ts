/**
 * S1-ROLLUP one-time backfill (data spec §8): enqueue the existing Number `rebuild` job for every
 * Contact Number with `rollups.interactions_total > 0`, so `recordings_total`,
 * `conversations_analyzed_total`, `last_analyzed_at` and `outreach_records_total` are recounted
 * from evidence. No new job kind, worker or key shape: the job is the one `enqueueRebuildAll`'s
 * fan-out creates (`stage: "rebuild"`, `input_revision: 1`, dedupe key
 * `csi:rebuild:number:<id>:all:<sweep id>`), drained by the normal rebuild worker. A rerun with the
 * same `--sweep-id` creates nothing new.
 *
 *   node --env-file=.env --import tsx scripts/dev_ops/sweep-number-rollups.ts            # dry run: prints the count
 *   ... --confirm-write [--allow-production] [--sweep-id s1-rollups] [--inline]
 *
 * Writing needs `--confirm-write`; a database that is not a loopback `testvantagemovers_*` one also
 * needs `--allow-production` (the operator runs that). `--inline` runs each enqueued rebuild in this
 * process and is refused outside a loopback test database; production uses the rebuild worker.
 * Output is ids and counts only.
 */
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { CsiError } from "../../src/services/salesIntelligence/auth";
import { enqueueCsiJob } from "../../src/services/salesIntelligence/jobs";
import { REBUILD_STAGE, runRebuildJob, type RebuildOutcome } from "../../src/services/numberActivity/rebuild";

export const DEFAULT_SWEEP_ID = "s1-rollups";
const BATCH = 500;

export type SweepOptions = { write: boolean; inline: boolean; sweepId?: string; now?: () => Date };
export type SweepSummary = {
  database: string; write: boolean; inline: boolean; sweep_id: string;
  numbers: number; jobs_created: number; jobs_existing: number;
  inline_outcomes: Record<string, number>;
};

export const sweepDedupeKey = (numberId: string, sweepId: string) => `csi:rebuild:number:${numberId}:all:${sweepId}`;
export const isLoopbackTestDatabase = (database: string, uri: string | undefined) =>
  /^testvantagemovers_[a-z0-9]+$/i.test(database) && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri ?? "");

export async function sweepNumberRollups(options: SweepOptions): Promise<SweepSummary> {
  const sweepId = options.sweepId ?? DEFAULT_SWEEP_ID;
  if (!/^[a-z0-9-]{1,40}$/i.test(sweepId)) throw new Error("--sweep-id must be 1-40 letters, digits or dashes");
  const now = options.now ?? (() => new Date());
  const database = getMongoDatabaseName();
  if (options.inline && !isLoopbackTestDatabase(database, process.env.MONGO_URI)) throw new Error("--inline runs only on a loopback testvantagemovers_* database");
  const summary: SweepSummary = { database, write: options.write, inline: options.inline, sweep_id: sweepId, numbers: 0, jobs_created: 0, jobs_existing: 0, inline_outcomes: {} };
  const Jobs = getSalesIntelligenceJobModel();
  let after: mongoose.Types.ObjectId | null = null;
  for (;;) {
    const batch: Array<{ _id: mongoose.Types.ObjectId }> = await getContactNumberModel()
      .find({ "rollups.interactions_total": { $gt: 0 }, ...(after ? { _id: { $gt: after } } : {}) }, { _id: 1 })
      .sort({ _id: 1 }).limit(BATCH).lean();
    if (!batch.length) break;
    summary.numbers += batch.length;
    after = batch.at(-1)!._id;
    if (options.write) {
      let created = 0, existing = 0;
      const jobIds: string[] = [];
      await withTransaction(async (session) => {
        created = 0; existing = 0; jobIds.length = 0;
        for (const number of batch) {
          const id = String(number._id);
          const dedupe_key = sweepDedupeKey(id, sweepId);
          const prior = await Jobs.findOne({ dedupe_key }, { _id: 1 }).session(session).lean();
          try {
            const job = await enqueueCsiJob({ dedupe_key, stage: REBUILD_STAGE, subject_key: `number:${id}`, input_revision: 1, input_refs: [id] }, session, now());
            jobIds.push(String(job._id));
            if (prior) existing += 1; else created += 1;
          } catch (error) {
            if (error instanceof CsiError && error.code === "IDEMPOTENCY_CONFLICT") { existing += 1; continue; }
            throw error;
          }
        }
      });
      summary.jobs_created += created;
      summary.jobs_existing += existing;
      if (options.inline) {
        for (const jobId of jobIds) {
          const outcome: RebuildOutcome = await runRebuildJob(jobId, { now });
          const key = outcome.status === "failed" ? `failed:${outcome.error_code}` : outcome.status;
          summary.inline_outcomes[key] = (summary.inline_outcomes[key] ?? 0) + 1;
        }
      }
    }
    if (batch.length < BATCH) break;
  }
  return summary;
}

function flag(name: string) { return process.argv.includes(name); }
function option(name: string) {
  const at = process.argv.indexOf(name);
  if (at < 0) return undefined;
  const value = process.argv[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name} value`);
  return value;
}

async function main() {
  await connectMongo();
  const database = getMongoDatabaseName();
  const write = flag("--confirm-write");
  if (write && !isLoopbackTestDatabase(database, process.env.MONGO_URI) && !flag("--allow-production"))
    throw new Error("the database is not a loopback testvantagemovers_* one; pass --allow-production to write");
  const summary = await sweepNumberRollups({ write, inline: flag("--inline"), sweepId: option("--sweep-id") });
  console.log(JSON.stringify({ ...summary, dry_run: !write }));
}

if (require.main === module) {
  main().then(() => mongoose.disconnect()).catch(async (error) => {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    await mongoose.disconnect().catch(() => undefined);
    process.exitCode = 1;
  });
}
