/**
 * Read-only replay of every stored Job Number through the Booking Job Number rule.
 *
 *   node --env-file=.env --import tsx ops/booking-job-number/replay.ts [--json=<path>]
 *
 * Streams each field in `sources.ts` (projection only, secondaryPreferred), classifies every
 * value and prints counts per class and per rejection reason. Raw values are never printed:
 * rejects are reported by collection, field, document ID, shape and reason. Empty strings are
 * reported as `missing` separately (they are absent Job Numbers, not Booking inputs).
 */
import { writeFileSync } from "node:fs";
import { MongoClient } from "mongodb";
import { classifyBookingJobNumber } from "../../src/services/bookings/bookingJobNumber";
import { JOB_NUMBER_SOURCES, jobNumberShape } from "./sources";

const jsonArg = process.argv.find((arg) => arg.startsWith("--json="))?.slice(7);
const uri = process.env.MONGO_URI;
if (!uri) throw new Error("MONGO_URI is required");
const client = new MongoClient(uri, { readPreference: "secondaryPreferred" });
const get = (row: unknown, path: string) =>
  path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), row);

async function main() {
  await client.connect();
  const db = client.db("vantagemovers");
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((row) => row.name));
  const report: Record<string, unknown> = {};
  const totals = { values: 0, valid: 0, missing: 0, rejected: 0, classes: {} as Record<string, number>, normalized_input: 0 };
  const rejects: Array<{ source: string; id: string; shape: string; reason: string }> = [];
  for (const [collection, fields] of Object.entries(JOB_NUMBER_SOURCES)) {
    if (!names.has(collection)) { report[collection] = "absent"; continue; }
    const projection = Object.fromEntries(fields.map((field) => [field, 1]));
    const filter = { $or: fields.map((field) => ({ [field]: { $type: "string" } })) };
    const perField: Record<string, Record<string, number>> = Object.fromEntries(fields.map((field) => [field, {}]));
    for await (const row of db.collection(collection).find(filter, { projection, batchSize: 5000 })) {
      for (const field of fields) {
        const value = get(row, field);
        if (typeof value !== "string") continue;
        totals.values += 1;
        const verdict = classifyBookingJobNumber(value);
        const key = verdict.valid ? verdict.job_class : `reject:${verdict.reason}`;
        perField[field]![key] = (perField[field]![key] ?? 0) + 1;
        if (verdict.valid) {
          totals.valid += 1;
          totals.classes[verdict.job_class] = (totals.classes[verdict.job_class] ?? 0) + 1;
          if (verdict.normalized_input) totals.normalized_input += 1;
        } else if (verdict.reason === "missing") totals.missing += 1;
        else {
          totals.rejected += 1;
          rejects.push({ source: `${collection}.${field}`, id: String(row._id), shape: jobNumberShape(value), reason: verdict.reason });
        }
      }
    }
    report[collection] = perField;
  }
  const out = { generated_at: new Date().toISOString(), database: "vantagemovers", totals, rejects, report };
  console.log(JSON.stringify({ totals, rejects }, null, 1));
  if (jsonArg) writeFileSync(jsonArg, JSON.stringify(out, null, 1));
}

main().finally(() => client.close()).catch((error) => { console.error(error); process.exitCode = 1; });
