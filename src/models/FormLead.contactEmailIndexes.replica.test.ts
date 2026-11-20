/**
 * With the two contact-email indexes, the identity contact match uses an index union instead of scanning the
 * Lead Source scope. Opt-in: GRANOT_LIFECYCLE_REPLICA_TESTS=true with TEST_MODE=true on a loopback replica.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../config/domain/runtime";
import { connectMongo } from "../db";
import { FORM_LEAD_CONTACT_EMAIL_INDEXES, FORM_LEAD_S08_INDEXES } from "./FormLead";
import { FORM_LEAD_ATTACHMENT_INDEXES } from "./leadContactPhoneIndexes";

after(async () => { await mongoose.disconnect().catch(() => undefined); });

test("the contact match plans an index union once both email paths are indexed", async (t) => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true" || !/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) {
    t.skip("Replica proof is opt-in (GRANOT_LIFECYCLE_REPLICA_TESTS=true, TEST_MODE=true).");
    return;
  }
  await connectMongo();
  const db = mongoose.connection.db!;
  assert.match(db.databaseName, /^testvantagemovers(?:_[a-z0-9]+)?$/i);
  const coll = db.collection(`contact_email_plan_${new mongoose.Types.ObjectId().toHexString()}`);
  const company = new mongoose.Types.ObjectId(), feed = new mongoose.Types.ObjectId();
  try {
    await coll.createIndexes([...FORM_LEAD_S08_INDEXES, ...FORM_LEAD_ATTACHMENT_INDEXES, { name: "email_1", key: { email: 1 } }].map((i) => ({ name: i.name, key: i.key })) as never);
    await coll.insertMany(Array.from({ length: 1500 }, (_, i) => ({
      lead_source_company: company, source_granularity_id: feed, duplicate: false,
      normalized_phone_number: `201555${String(i % 10_000).padStart(4, "0")}`, email: `lead${i}@example.test`,
      ingested_contact_snapshot: { email: `lead${i}@example.test`, normalized_phone_number: `201555${String(i % 10_000).padStart(4, "0")}` },
      ...(i % 3 === 0 ? { granot_contact_snapshot: { email: `granot${i}@example.test` } } : {}),
    })));
    const shape = { lead_source_company: company, source_granularity_id: feed, duplicate: { $ne: true }, $or: [
      { normalized_phone_number: { $in: ["2015550199"] } }, { "ingested_contact_snapshot.normalized_phone_number": { $in: ["2015550199"] } },
      { "granot_contact_snapshot.normalized_phone_number": { $in: ["2015550199"] } }, { email: { $in: ["nobody@example.test"] } },
      { "ingested_contact_snapshot.email": { $in: ["nobody@example.test"] } }, { "granot_contact_snapshot.email": { $in: ["nobody@example.test"] } },
    ] };
    const keys = async () => ((await coll.find(shape).explain("executionStats")) as unknown as { executionStats: { totalKeysExamined: number } }).executionStats.totalKeysExamined;
    const before = await keys();
    await coll.createIndexes(FORM_LEAD_CONTACT_EMAIL_INDEXES.map((i) => ({ name: i.name, key: i.key, sparse: i.sparse })) as never);
    const plan = JSON.stringify((await coll.find(shape).explain("executionStats") as unknown as { queryPlanner: unknown }).queryPlanner);
    const afterKeys = await keys();
    assert.ok(before >= 1000, `before scans the scope: ${before}`);
    assert.ok(afterKeys < 20, `after uses point lookups: ${afterKeys}`);
    for (const index of FORM_LEAD_CONTACT_EMAIL_INDEXES) assert.ok(plan.includes(index.name), index.name);
  } finally {
    await coll.drop().catch(() => undefined);
  }
});
