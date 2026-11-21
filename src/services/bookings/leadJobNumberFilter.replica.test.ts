/**
 * `leadJobNumberFilter` matches exactly what `equivalentNormalizedJobFilter` matched, on real MongoDB semantics
 * (PCRE `$`, collation-free string ranges, the `normalized_job_no_1` index). Opt-in: GRANOT_LIFECYCLE_REPLICA_TESTS=true
 * with TEST_MODE=true on a loopback replica.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { equivalentNormalizedJobFilter } from "./bookingIdentity";
import { leadJobNumberFilter } from "./indexedJobLookup";

after(async () => { await mongoose.disconnect().catch(() => undefined); });

/** Every class of stored value: digits only, leading zeros, one to four letter prefixes at every lexical edge,
 * trailing newline, lowercase, punctuation, a longer or shorter core, and suffixes after the core. */
const STORED = [
  "123", "0123", "00123", "1123", "1230", "12", "123\n", "0123\n",
  "A123", "P123", "Z123", "P0123", "P00123", "A0123", "P123\n", "A123\n", "Z123\n",
  "AA123", "AB123", "PA123", "PZ123", "ZZ123", "AAA123", "PQR123", "EJBA123", "ZZZZ123", "RF123", "AB0123", "AB123\n", "ZZ123\n",
  "p123", "pa123", "Pa123", "aP123", "P-123", "P 123", "P_123", "-123", "[123", "P[123", "@123", "P@123", "`123",
  "P1234", "P12", "P123A", "AB1234", "X123Y", "123P", "P", "", "PP", "AB",
  "P1", "1", "01", "P01", "AB01",
];
const QUERIES = ["123", "0123", "P123", "AB123", "P0123", "EJBA123", "1", "01", "P1", "P", "AB", "123P", "P-123"];

test("leadJobNumberFilter returns the same Leads as the regex filter for every stored variant class", async (t) => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true" || !/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) {
    t.skip("Replica proof is opt-in (GRANOT_LIFECYCLE_REPLICA_TESTS=true, TEST_MODE=true).");
    return;
  }
  await connectMongo();
  const db = mongoose.connection.db!;
  assert.match(db.databaseName, /^testvantagemovers(?:_[a-z0-9]+)?$/i);
  const coll = db.collection(`job_lookup_equivalence_${new mongoose.Types.ObjectId().toHexString()}`);
  try {
    await coll.createIndex({ normalized_job_no: 1 });
    await coll.insertMany(STORED.map((normalized_job_no, i) => ({ _id: i, normalized_job_no } as never)));
    let compared = 0;
    for (const job of QUERIES) {
      const ids = async (filter: Record<string, unknown>) => (await coll.find(filter, { projection: { _id: 1 } }).toArray()).map((row) => row._id as unknown as number).sort((a, b) => a - b);
      const before = await ids(equivalentNormalizedJobFilter(job));
      const afterIds = await ids(leadJobNumberFilter(job));
      assert.deepEqual(afterIds.map((i) => STORED[i]), before.map((i) => STORED[i]), `query ${JSON.stringify(job)}`);
      compared += before.length;
    }
    assert.ok(compared > 40, "the fixture exercises many matches");
    // The new filter is index-bounded: no full walk of the letter-prefixed keys.
    const plan = await coll.find(leadJobNumberFilter("123")).explain("executionStats") as unknown as { executionStats: { totalKeysExamined: number } };
    const regex = await coll.find(equivalentNormalizedJobFilter("123")).explain("executionStats") as unknown as { executionStats: { totalKeysExamined: number } };
    assert.ok(plan.executionStats.totalKeysExamined < regex.executionStats.totalKeysExamined, JSON.stringify([plan.executionStats.totalKeysExamined, regex.executionStats.totalKeysExamined]));
  } finally {
    await coll.drop().catch(() => undefined);
  }
});
