import assert from "node:assert/strict";
import test from "node:test";
import { MongoClient, ObjectId } from "mongodb";
import {
  normalizedJobCandidates,
  legacyBookingJobFilter,
} from "./indexedJobLookup";
import { jobNumberDigitCore } from "./bookingIdentity";
import { poolBookingBlocks } from "../salesOutreach/pool/admission";

test("indexed aliases and selective legacy booking reads preserve the original Mongo matches", async (t) => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true")
    return t.skip("requires disposable loopback replica");
  const c = new MongoClient("mongodb://127.0.0.1:27961/?replicaSet=storageRs", {
    serverSelectionTimeoutMS: 2000,
  });
  t.after(() => c.close());
  const db = c.db("testvantagemovers_j" + new ObjectId().toHexString());
  const col = db.collection("lookup");
  const variants = [
    "",
    "Q",
    "RF",
    "AAA",
    "PNWD",
    "ZZA",
    "ZZ",
    "abc",
    "α",
    "É",
    "abC",
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ];
  const keys = [
    ...new Set(
      variants.flatMap((p) =>
        ["1", "001", "10", "1000", "1100"].flatMap((core) => [
          p + core,
          p + core + "\n",
          p + core + "\r\n",
          p + core + "extra",
        ]),
      ),
    ),
  ];
  await col.insertMany(
    keys.map((normalized_job_no) => ({ normalized_job_no })),
  );
  await col.createIndex({ normalized_job_no: 1 });
  for (const jobs of [
    [],
    ["001"],
    ["P1", "RF001", "NOT A CORE"],
    ["SPEC"],
    ["Q1", "A10", "1100", "X001", "1000"],
  ]) {
    const cores = [
      ...new Set(jobs.flatMap((j) => jobNumberDigitCore(j) ?? [])),
    ];
    const exact = { normalized_job_no: { $in: [...jobs, ...cores] } };
    const old = cores.length
      ? {
          $or: [
            exact,
            {
              normalized_job_no: {
                $regex: "^[A-Z]+(?:" + cores.join("|") + ")$",
              },
            },
          ],
        }
      : exact;
    const ids = async (filter: Record<string, unknown>) =>
      (
        await col
          .find(filter, { projection: { _id: 1 } })
          .sort({ _id: 1 })
          .toArray()
      ).map((r) => String(r._id));
    assert.deepEqual(await ids(normalizedJobCandidates(jobs)), await ids(old));
  }
  const bookings = db.collection<Parameters<typeof poolBookingBlocks>[0]>("bookings"),
    ref = { model: "FormLead" as const, id: new ObjectId().toString() };
  for (const [i, raw] of [
    "P001",
    "001",
    "Ｐ００１",
    "p001",
    " P001 ",
    "P001\n",
    "AAA001",
    "OTHER",
    "Q-001",
    "OTHER",
  ].entries()) {
    await bookings.insertOne({
      job_no: raw,
      ...(i === 8 ? {} : { normalized_job_no: i % 2 === 0 ? raw : "OTHER" }),
      ...(i === 9 ? { lead_ref: ref.id } : {}),
    });
  }
  const job = "001";
  const effective = async (extra: Record<string, unknown>) =>
    (
      await bookings
        .find({
          $or: [normalizedJobCandidates([job], "scan"), { lead_ref: ref.id }, extra],
        })
        .toArray()
    )
      .filter((r) => poolBookingBlocks(r, ref, job))
      .map((r) => String(r._id))
      .sort();
  assert.deepEqual(
    await effective(legacyBookingJobFilter),
    await effective({ job_no: { $type: "string" } }),
  );
});
