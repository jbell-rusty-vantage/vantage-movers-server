/**
 * Read-only explain of Pool admission's Booked Lead read on the target database.
 *
 *   node --env-file=.env --import tsx ops/booking-job-number/explain-pool-read.ts [--batch=40]
 *
 * Builds one realistic batch from the newest Form Leads with a Job Number, then explains
 * (`executionStats`, no writes) the current read (`poolBookingFilter`) and, for comparison, the
 * retired shape that also OR-ed the raw-Job `$expr` fallback. Prints winning stages and counts only.
 */
import { MongoClient, type Document } from "mongodb";
import { normalizedJobCandidates } from "../../src/services/bookings/indexedJobLookup";
import { poolBookingFilter } from "../../src/services/salesOutreach/pool/admission";

const batch = Number(process.argv.find((arg) => arg.startsWith("--batch="))?.slice(8) ?? 40);
const uri = process.env.MONGO_URI;
if (!uri) throw new Error("MONGO_URI is required");
const client = new MongoClient(uri, { readPreference: "secondaryPreferred" });

const retiredRawJobFallback = {
  job_no: { $type: "string" },
  $or: [
    { $expr: { $ne: ["$job_no", { $ifNull: ["$normalized_job_no", null] }] } },
    { job_no: { $regex: "[^A-Z0-9]" } },
  ],
};

function stages(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  const row = node as Record<string, unknown>;
  if (typeof row.stage === "string") out.push(row.stage + (typeof row.indexName === "string" ? `(${row.indexName})` : ""));
  for (const value of Object.values(row)) if (value && typeof value === "object") stages(value, out);
  return out;
}

async function main() {
  await client.connect();
  const db = client.db("vantagemovers");
  const leads = await db.collection("form_leads").find({ normalized_job_no: { $type: "string" } }, { projection: { normalized_job_no: 1 } })
    .sort({ _id: -1 }).limit(batch).toArray();
  const refs = leads.map((lead) => ({ model: "FormLead" as const, id: String(lead._id) }));
  const jobs = [...new Set(leads.map((lead) => String(lead.normalized_job_no)))];
  const bookings = db.collection("booked_leads");
  const retired = { $or: [
    { lead_ref: { $in: refs.flatMap((r) => [r.id, r.id.toUpperCase()]) } }, normalizedJobCandidates(jobs, "scan"), retiredRawJobFallback,
  ] };
  const report: Record<string, unknown> = { generated_at: new Date().toISOString(), batch: refs.length, jobs: jobs.length,
    booked_leads: await bookings.estimatedDocumentCount() };
  for (const [name, filter] of [["current", poolBookingFilter(refs, jobs)], ["retired_with_raw_fallback", retired]] as const) {
    const explain = await bookings.find(filter as Document, { projection: { lead_ref: 1, normalized_job_no: 1, job_no: 1 } }).explain("executionStats") as Document;
    const winning = stages(explain.queryPlanner?.winningPlan);
    report[name] = {
      winning_stages: [...new Set(winning)],
      collscan: winning.some((stage) => stage.startsWith("COLLSCAN")),
      n_returned: explain.executionStats?.nReturned,
      keys_examined: explain.executionStats?.totalKeysExamined,
      docs_examined: explain.executionStats?.totalDocsExamined,
      millis: explain.executionStats?.executionTimeMillis,
    };
  }
  console.log(JSON.stringify(report, null, 1));
}

main().finally(() => client.close()).catch((error) => { console.error(error); process.exitCode = 1; });
