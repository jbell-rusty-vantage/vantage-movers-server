/**
 * Read-only: print the Case File (Attention and Case File spec §4.13) for one subject, with its size,
 * trimming and digests — or measure the size distribution over a sample.
 *
 *   node --env-file=.env --import tsx scripts/dev_ops/inspect-case-file.ts <number_id|+1phone|lead:Model:id> [--audience assessment] [--as-of ISO]
 *   node --import tsx scripts/dev_ops/inspect-case-file.ts --replica testvantagemovers_finalui <subject|--all> [--dump <dir>]
 *   node --env-file=.env --import tsx scripts/dev_ops/inspect-case-file.ts --sample 20 [--dump <dir>]      (production, read only)
 *
 * Provably read only: before anything connects, every write, index, collection-creation and
 * transaction method of the MongoDB driver is replaced by a function that throws, Mongoose
 * auto-create/auto-index are off, and the run ends by printing the number of write attempts (0).
 * Without `--replica` it reads whatever `MONGO_URI` names (the production `.env`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const REPLICA = "mongodb://127.0.0.1:27189/?replicaSet=csi01";
const replicaDb = flag("--replica");
if (replicaDb) {
  if (!/^testvantagemovers_[a-z0-9]+$/.test(replicaDb)) throw new Error(`refusing database ${replicaDb}`);
  Object.assign(process.env, { TEST_MODE: "true", CSI_REPLICA_TEST: "true", TEST_MONGO_DATABASE_NAME: replicaDb, MONGO_URI: REPLICA, MONGODB_URI: REPLICA,
    SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SHEET_SYNC_MODE: "disabled" });
}

let writeAttempts = 0;
async function installReadOnlyGuard() {
  const driver = await import("mongodb");
  const refuse = (where: string) => function refused() { writeAttempts++; throw new Error(`inspect-case-file is read only: ${where} refused`); };
  const collectionWrites = ["insertOne", "insertMany", "updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany", "findOneAndUpdate", "findOneAndReplace",
    "findOneAndDelete", "bulkWrite", "createIndex", "createIndexes", "dropIndex", "dropIndexes", "drop", "rename"] as const;
  for (const name of collectionWrites) (driver.Collection.prototype as unknown as Record<string, unknown>)[name] = refuse(`Collection.${name}`);
  for (const name of ["createCollection", "dropDatabase", "dropCollection", "renameCollection"] as const) (driver.Db.prototype as unknown as Record<string, unknown>)[name] = refuse(`Db.${name}`);
  (driver.ClientSession.prototype as unknown as Record<string, unknown>).startTransaction = refuse("ClientSession.startTransaction");
  (driver.ClientSession.prototype as unknown as Record<string, unknown>).withTransaction = refuse("ClientSession.withTransaction");
  const mongoose = (await import("mongoose")).default;
  mongoose.set("autoCreate", false);
  mongoose.set("autoIndex", false);
}

const percentile = (sorted: number[], p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]! : 0;

async function main() {
  await installReadOnlyGuard();
  const mongoose = (await import("mongoose")).default;
  const { connectMongo } = await import("../../src/db");
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime");
  const { resolveStorySubject } = await import("../../src/services/salesIntelligence/story/assemble");
  const { selectPriorAnalyses } = await import("../../src/services/salesIntelligence/analysis/prior");
  const { readCaptureCoverage } = await import("../../src/services/numberActivity/coverage");
  const { assembleCaseFile } = await import("../../src/services/salesIntelligence/casefile/assemble");
  const { getLeadConversationModel } = await import("../../src/models/LeadConversation");
  const { getContactNumberModel } = await import("../../src/models/ContactNumber");
  await connectMongo();
  const database = getMongoDatabaseName();
  const audience = flag("--audience") === "assessment" ? "assessment" as const : "findings" as const;
  const asOf = flag("--as-of") ? new Date(flag("--as-of")!) : new Date();
  const dump = flag("--dump");
  if (dump) mkdirSync(dump, { recursive: true });
  const coverage = await readCaptureCoverage();

  async function one(arg: string) {
    const lead = /^lead:(FormLead|CallLead):([a-f0-9]{24})$/.exec(arg);
    const subject = await resolveStorySubject(lead ? { lead: { model: lead[1] as "FormLead" | "CallLead", id: lead[2]! }, as_of: asOf }
      : arg.startsWith("+") ? { phone: arg, as_of: asOf } : { contact_number_id: arg, as_of: asOf });
    if (!subject) throw new Error(`no subject for ${arg}`);
    const prior = subject.contact_number_id ? await selectPriorAnalyses({ contact_number_id: subject.contact_number_id, subject_key: `number:${subject.contact_number_id}`,
      outreach_record_id: null, exclude_conversation_id: null, as_of: asOf }, coverage) : null;
    const started = Date.now();
    const assembled = await assembleCaseFile({ contact_number_id: subject.contact_number_id, e164: subject.e164, lead_refs: subject.lead_refs, outreach_record_ids: subject.outreach_record_ids,
      conversation_ids: subject.conversation_ids, focus_conversation_ids: null, summaries: new Map(), prior, as_of: asOf, timezone: "America/New_York", audience, coverage });
    return { arg, ms: Date.now() - started, assembled };
  }

  const summary = (row: Awaited<ReturnType<typeof one>>) => {
    const { rendered, file } = row.assembled;
    return { subject: row.arg, bytes: rendered.bytes, over_60kb: rendered.bytes > 60_000, over_hard_budget: rendered.over_hard_budget, trimmed_steps: rendered.trimmed_steps,
      digest: rendered.digest, customer_evidence_digest: rendered.customer_evidence_digest, story_events: file.story_events.length, calls_C: file.call_conversation_ids.length,
      prior_findings: file.prior_finding_ids.length, timeline_dropped: file.coverage.timeline_dropped, truncated_sources: file.coverage.truncated_sources, assemble_ms: row.ms };
  };

  const sample = flag("--sample");
  const all = argv.includes("--all");
  if (sample || all) {
    let subjects: string[];
    if (all) subjects = (await getContactNumberModel().find({ purged_at: null }).select("_id").sort({ _id: 1 }).limit(500).lean()).map(r => String(r._id));
    else {
      // The newest Numbers with an analyzed conversation: the population the findings step actually runs on.
      const rows = await getLeadConversationModel().aggregate([{ $match: { latest_completed_run_id: { $ne: null }, contact_number_id: { $ne: null } } }, { $sort: { started_at: -1 } },
        { $group: { _id: "$contact_number_id", at: { $first: "$started_at" } } }, { $sort: { at: -1 } }, { $limit: Number(sample) }]);
      subjects = rows.map(r => String(r._id));
    }
    const rows = [] as Array<ReturnType<typeof summary>>;
    for (const subject of subjects) {
      try {
        const row = await one(subject);
        rows.push(summary(row));
        if (dump) writeFileSync(join(dump, `${subject}.txt`), row.assembled.rendered.text);
      } catch (error) { console.error(`${subject}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const sizes = rows.map(r => r.bytes).sort((a, b) => a - b);
    console.log(JSON.stringify({ database, as_of: asOf.toISOString(), audience, subjects: rows.length,
      distribution: { p50_bytes: percentile(sizes, 0.5), p95_bytes: percentile(sizes, 0.95), max_bytes: sizes.at(-1) ?? 0, min_bytes: sizes[0] ?? 0,
        share_over_60kb: rows.length ? rows.filter(r => r.bytes > 60_000).length / rows.length : 0, share_over_100kb: rows.length ? rows.filter(r => r.bytes > 100_000).length / rows.length : 0,
        trimmed_subjects: rows.filter(r => r.trimmed_steps.length).length, over_hard_budget: rows.filter(r => r.over_hard_budget).length },
      rows: argv.includes("--rows") ? rows : undefined, write_attempts: writeAttempts }, null, 1));
  } else {
    const arg = argv.find(a => !a.startsWith("--") && ![flag("--audience"), flag("--as-of"), flag("--replica"), flag("--dump")].includes(a));
    if (!arg) throw new Error("subject required: <number_id|+1phone|lead:Model:id>");
    const row = await one(arg);
    console.log(JSON.stringify({ database, ...summary(row), write_attempts: writeAttempts }, null, 1));
    console.log(`\n${row.assembled.rendered.text}`);
    if (dump) writeFileSync(join(dump, `${arg.replace(/[^a-zA-Z0-9]/g, "_")}.txt`), row.assembled.rendered.text);
  }
  console.error(`read-only guard: ${writeAttempts} write attempts`);
  await mongoose.disconnect();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
