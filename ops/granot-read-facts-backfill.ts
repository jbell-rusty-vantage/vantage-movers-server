import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { getGranotObservationModel } from "../src/models/GranotObservation";
import { OBSERVATION_KINDS } from "../src/models/granotLifecycleSchemas";
import {
  caseObservations, hasInvalidPriority, invalidFilter, isPairingCandidate, observationReadFacts, pairingFilter,
} from "../src/services/granotLifecycle/observationReadFacts";
import { backfillWebhookDay } from "../src/services/dailyOperations/rebuild";
import { getDailyOperationsDayModel } from "../src/models/DailyOperationsDay";
import { buildDaySeed, easternDayKey, easternInstantBounds } from "../src/services/dailyOperations/dayDocument";

/** Cut over only webhook counters. Concurrent facts win the revision race and cause a re-read. */
export async function qualifyOpenWebhookDay(now = new Date()) {
  const day = easternDayKey(now), Day = getDailyOperationsDayModel();
  for (let attempt = 0; attempt < 10; attempt++) {
    const previous = await Day.findOne({ day }).select("status revision webhook_counts_version").lean();
    if (previous?.status === "closed" || previous?.webhook_counts_version === 1) return { day, status: "already_settled" };
    const seed = buildDaySeed(day);
    await backfillWebhookDay(day, easternInstantBounds(day), seed, seed.hourly);
    if (!previous) {
      try {
        await Day.create({ ...seed, revision: 1, webhook_counts_version: 1 });
        return { day, status: "created" };
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        continue;
      }
    }
    const hourly: Record<string, number> = {};
    for (const bucket of seed.hourly) hourly[`hourly.${bucket.hour}.webhooks`] = bucket.webhooks;
    const updated = await Day.updateOne({ _id: previous._id, revision: previous.revision, status: "open" }, {
      $set: { webhooks: seed.webhooks, webhook_counts_version: 1, ...hourly }, $inc: { revision: 1 },
    });
    if (updated.matchedCount) return { day, status: "qualified" };
  }
  throw new Error("The open day changed during all ten qualification attempts");
}

export async function backfillObservationReadFacts(maxPages = Infinity) {
  const model = getGranotObservationModel();
  const facts = observationReadFacts();
  const marker = { _id: "historical-v1" };
  const obj = mongoose.Types.ObjectId;
  const zero = new obj("000000000000000000000000");
  await caseObservations().createIndex({ "identity.normalized_job_no": 1, captured_at: -1 }, { name: "case_observation_job_captured" });
  const previous = await facts.findOne(marker);
  if (previous?.complete) return { complete: true, resumed: true };
  const latest = await model.findOne({ kind: { $in: [...OBSERVATION_KINDS] } }).sort({ captured_at: -1 }).select("captured_at").lean();
  if (latest) await facts.updateOne({ _id: "latest" }, { $max: { captured_at: latest.captured_at } }, { upsert: true });
  const last = await model.findOne({}).sort({ _id: -1 }).select("_id").lean();
  await facts.updateOne(marker, { $setOnInsert: { until: last?._id ?? zero, cursor: zero, complete: false } }, { upsert: true });
  const checkpoint = await facts.findOne(marker);
  const until = checkpoint!.until!;
  let cursor = checkpoint!.cursor!;
  let pages = 0, pinned = 0, invalidJobs = 0;
  while (cursor < until && pages < maxPages) {
    const end = (await model.findOne({ _id: { $gt: cursor, $lte: until } }, { _id: 1 })
      .sort({ _id: 1 }).skip(4095).maxTimeMS(8000).lean())?._id ?? until;
    const rows = await model.find({ _id: { $gt: cursor, $lte: end }, $or: [invalidFilter, pairingFilter] })
      .hint("_id_").maxTimeMS(8000).lean();
    const invalid = new Map<string, Date>();
    const pairs = rows.filter(isPairingCandidate);
    for (const row of rows.filter(hasInvalidPriority)) {
      const job = row.identity.normalized_job_no!;
      if (!invalid.has(job) || invalid.get(job)! < row.captured_at) invalid.set(job, row.captured_at);
    }
    if (invalid.size) await facts.bulkWrite([...invalid].map(([job, captured_at]) => ({ updateOne: {
      filter: { _id: `invalid:${job}` }, update: { $max: { captured_at } }, upsert: true,
    } })));
    if (pairs.length) await caseObservations().bulkWrite(pairs.map(row => ({ updateOne: {
      filter: { _id: row._id }, update: { $setOnInsert: row }, upsert: true,
    } })));
    await facts.updateOne(marker, { $max: { cursor: end } });
    cursor = end;
    pages++;
    pinned += pairs.length;
    invalidJobs += invalid.size;
    if (pages % 25 === 0) console.log(JSON.stringify({ pages, pinned, invalidJobs, cursor }));
  }
  if (cursor < until) return { complete: false, pages, pinned, invalidJobs, cursor };
  const result = await facts.updateOne({ ...marker, cursor: until }, { $set: { complete: true } });
  if (!result.matchedCount) throw new Error("Observation backfill checkpoint changed");
  return { complete: true, pages, pinned, invalidJobs };
}

async function main() {
  const [mode, option, count] = process.argv.slice(2);
  const maxPages = option === "--pages" ? Number(count) : Infinity;
  if (mode !== "--apply" || (option !== undefined && (option !== "--pages" || !Number.isSafeInteger(maxPages) || maxPages <= 0))) {
    throw new Error("Expected --apply [--pages <positive page count>]");
  }
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await connectMongo();
  const day = await qualifyOpenWebhookDay();
  console.log(JSON.stringify({ day }));
  console.log(JSON.stringify(await backfillObservationReadFacts(maxPages)));
}
if (require.main === module) main().catch(error => { console.error(error.name, error.code, error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
