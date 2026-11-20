import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { connectMongo } from "../../../db";
import { BookedLead } from "../../../models/BookedLead";
import { normalizeJobNo } from "../../bookings/bookingIdentity";
import { poolBookedIdentities, poolBookingFilter, type RawPoolBooking } from "./admission";

/**
 * Pool admission's official-Booking hold on a real replica, without the retired raw-Job scan:
 * a Booking linked by `lead_ref`, or holding any valid Job Number class of the candidate's Job,
 * still refuses admission, and the read plan never scans the collection.
 * Opt-in like the other replica proofs (GRANOT_LIFECYCLE_REPLICA_TESTS=true, TEST_MODE=true,
 * isolated TEST_MONGO_DATABASE_NAME, loopback MONGO_URI). The isolated database is dropped.
 */
const ISOLATED_DB = /^testvantagemovers_[a-z0-9]+$/i;
let ready = false;

before(async () => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true" || !ISOLATED_DB.test(getMongoDatabaseName())) return;
  await connectMongo();
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello?.setName || !ISOLATED_DB.test(mongoose.connection.db?.databaseName ?? "")) return;
  await BookedLead.createCollection().catch(() => undefined);
  // The production index set relevant to this read (booked_leads, read 2026-11-20).
  await BookedLead.collection.createIndex({ normalized_job_no: 1 }, { unique: true, name: "normalized_job_no_1", partialFilterExpression: { normalized_job_no: { $type: "string" } } });
  await BookedLead.collection.createIndex({ lead_ref: 1, lead_model: 1 }, { name: "lead_ref_1_lead_model_1" });
  await BookedLead.collection.createIndex({ lead_ref: 1 }, { name: "lead_ref_1" });
  await BookedLead.collection.createIndex({ job_no: 1 }, { name: "job_no_1" });
  ready = true;
});

after(async () => {
  if (mongoose.connection.readyState === 1 && ISOLATED_DB.test(mongoose.connection.db?.databaseName ?? "")) {
    await mongoose.connection.db?.dropDatabase().catch(() => undefined);
  }
  await mongoose.disconnect().catch(() => undefined);
});

const booking = (jobNo: string, extra: Record<string, unknown> = {}) => new BookedLead({
  book_date: new Date("2026-11-20T12:00:00.000Z"),
  job_no: jobNo,
  agent_allocations: [{ agent: new mongoose.Types.ObjectId(), agent_name_snapshot: "Pool Agent", binder_amount: 100 }],
  total_binder_amount: 100,
  deposit_amount: 500,
  merchant: "Pool Merchant",
  source: "main_site",
  is_leadless_booking: true,
  ...extra,
}).save();

const ref = () => ({ model: "FormLead" as const, id: new mongoose.Types.ObjectId().toHexString() });

async function holds(refs: ReturnType<typeof ref>[], leadJob: string | undefined) {
  const jobs = leadJob ? [normalizeJobNo(leadJob)!] : [];
  const rows = await mongoose.connection.db!.collection<RawPoolBooking>(BookedLead.collection.collectionName)
    .find(poolBookingFilter(refs, jobs), { projection: { lead_ref: 1, normalized_job_no: 1, job_no: 1 } }).toArray();
  const identities = poolBookedIdentities(rows);
  return refs.map((r) => identities.holds(r, jobs[0]));
}

test("a Booking holding any valid Job Number class blocks the matching Lead; unrelated Jobs do not", async (t) => {
  if (!ready) return t.skip("requires the loopback replica and an isolated TEST_MONGO_DATABASE_NAME");
  // Booking spelling → Lead spellings that are the same Job.
  const cases: Array<[string, string[]]> = [
    ["5571001", ["5571001", "P5571001", "RF5571001", "p-5571001", "P5571001 new"]],
    ["P5571002", ["5571002", "P5571002", "PA5571002", " p5571002 "]],
    ["RF5571003", ["5571003", "P5571003"]],
    ["p-5571004", ["5571004", "P5571004"]],
    ["P5571005 VIP RIGOS", ["5571005", "P5571005", "P5571005 NEW"]],
    ["Ｐ５５７１００６", ["P5571006", "5571006"]],
  ];
  for (const [bookingJob] of cases) await booking(bookingJob);
  for (const [bookingJob, leadJobs] of cases)
    for (const leadJob of leadJobs)
      assert.deepEqual(await holds([ref()], leadJob), [true], `${bookingJob} holds Lead job ${leadJob}`);
  for (const unrelated of ["5571999", "P5571998", "P557100", "55710011", "P5571001 5571002"])
    assert.deepEqual(await holds([ref()], unrelated), [false], `unrelated ${unrelated}`);
});

test("a Booking linked by lead_ref blocks its Lead whatever its Job, including legacy invalid values", async (t) => {
  if (!ready) return t.skip("requires the loopback replica and an isolated TEST_MONGO_DATABASE_NAME");
  const linked = ref(), other = ref(), upper = ref(), stringRef = ref();
  await booking("Legacy Customer Name", { is_leadless_booking: false, lead_model: "FormLead", lead_ref: new mongoose.Types.ObjectId(linked.id) });
  await mongoose.connection.db!.collection(BookedLead.collection.collectionName).insertMany([
    { job_no: "P5572001", normalized_job_no: "P5572001", lead_ref: upper.id.toUpperCase() },
    { job_no: "P5572002", normalized_job_no: "P5572002", lead_ref: stringRef.id },
  ]);
  assert.deepEqual(await holds([linked, other, upper, stringRef], "P5579999"), [true, false, true, true]);
  assert.deepEqual(await holds([linked], undefined), [true]);
});

test("the Pool Booking read uses indexes only (no COLLSCAN) for single and wide batches", async (t) => {
  if (!ready) return t.skip("requires the loopback replica and an isolated TEST_MONGO_DATABASE_NAME");
  const stages = (plan: unknown): string[] => {
    const out: string[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const row = node as Record<string, unknown>;
      if (typeof row.stage === "string") out.push(row.stage);
      for (const value of Object.values(row)) if (value && typeof value === "object") walk(value);
    };
    walk(plan);
    return out;
  };
  for (const size of [1, 40, 1000]) {
    const refs = Array.from({ length: size }, ref);
    const jobs = Array.from({ length: size }, (_, i) => (i % 2 ? `P${5_580_000 + i}` : String(5_580_000 + i)));
    const explain = await mongoose.connection.db!.collection(BookedLead.collection.collectionName)
      .find(poolBookingFilter(refs, jobs)).explain("executionStats");
    const winning = stages((explain as { queryPlanner: { winningPlan: unknown } }).queryPlanner.winningPlan);
    assert.equal(winning.includes("COLLSCAN"), false, `batch ${size}: ${winning.join(">")}`);
    assert.ok(winning.includes("IXSCAN"), `batch ${size}: ${winning.join(">")}`);
  }
});
