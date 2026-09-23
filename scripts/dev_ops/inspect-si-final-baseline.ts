/**
 * Read-only S0 baseline counts for the Sales Intelligence final-data delivery.
 *
 *   node --env-file=.env --import tsx scripts/dev_ops/inspect-si-final-baseline.ts
 *
 * Only `countDocuments`, `estimatedDocumentCount` and projected `find` with a
 * limit; no write of any kind. Prints counts and dates, never documents,
 * phone numbers or secrets.
 */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";

async function main() {
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  const since = new Date(Date.UTC(2026, 8, 23)); // flag enabled 2026-09-23
  const jobs = db.collection("sales_intelligence_jobs");
  const [d4Legacy, maCompletedSinceFlag, maQueued, maLatest, numbers, numbersWithCalls, outreach, closed, conversations, analysed] = await Promise.all([
    db.collection("lead_conversations").countDocuments({ contact_number_id: null, provider_recording_id: { $exists: true } }),
    jobs.countDocuments({ stage: "move_assessment", status: "completed", updatedAt: { $gte: since } }),
    jobs.countDocuments({ stage: "move_assessment", status: { $in: ["pending", "leased", "retry"] } }),
    jobs.find({ stage: "move_assessment", status: "completed" }, { projection: { updatedAt: 1, priority: 1 } }).sort({ updatedAt: -1 }).limit(3).toArray(),
    db.collection("contact_numbers").estimatedDocumentCount(),
    db.collection("contact_numbers").countDocuments({ "rollups.interactions_total": { $gt: 0 } }),
    db.collection("outreach_records").countDocuments({ purged_at: null }),
    db.collection("outreach_records").countDocuments({ purged_at: null, state: "closed", closed_at: { $gte: new Date(Date.now() - 90 * 86_400_000) } }),
    db.collection("lead_conversations").estimatedDocumentCount(),
    db.collection("lead_conversations").countDocuments({ latest_completed_run_id: { $ne: null } }),
  ]);
  console.log(JSON.stringify({
    database: db.databaseName,
    d4_legacy_conversations_without_number: d4Legacy,
    move_assessment: { completed_since_2026_09_23: maCompletedSinceFlag, queued_now: maQueued,
      latest_completed: maLatest.map(job => ({ updated_at: job.updatedAt, priority: job.priority ?? null })) },
    volume: { contact_numbers: numbers, contact_numbers_with_interactions: numbersWithCalls, outreach_records_live: outreach,
      closed_last_90d: closed, lead_conversations: conversations, analysed_conversations: analysed },
  }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "failed"); process.exitCode = 1; }).finally(() => mongoose.disconnect());
