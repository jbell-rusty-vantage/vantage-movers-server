import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { Agent } from "./Agent";

/**
 * Replica proof on the csi01 loopback replica: Mongo builds the Agent indexes
 * (the Granot username index used to be refused with CannotCreateIndex 67) and
 * the database rejects a second Agent with the same Granot CRM username while
 * still allowing many Agents without one.
 */
const REPLICA_URI = "mongodb://127.0.0.1:27189/?replicaSet=csi01";
const DB_NAME = "testvantagemovers_agentidx";

test("Agent indexes build on Mongo 8 and enforce one Agent per Granot username", {
  skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 60_000,
}, async (t) => {
  assert.equal(process.env.MONGO_URI, REPLICA_URI);
  const conn = await mongoose.createConnection(REPLICA_URI, { dbName: DB_NAME, autoIndex: false }).asPromise();
  t.after(async () => {
    await conn.dropDatabase();
    await conn.close();
  });
  assert.equal((await conn.db!.admin().command({ hello: 1 })).setName, "csi01");
  await conn.dropDatabase();
  const model = conn.model("Agent", Agent.schema);

  await model.createIndexes();
  const usernameIndex = (await model.collection.indexes()).find(
    (index) => JSON.stringify(index.key) === JSON.stringify({ "granot_identity.username": 1 }),
  );
  assert.ok(usernameIndex, "granot_identity.username index exists");
  assert.equal(usernameIndex.unique, true);
  assert.equal(usernameIndex.sparse, undefined);
  assert.deepEqual(usernameIndex.partialFilterExpression, {
    "granot_identity.username": { $type: "string" },
  });

  await model.create({ name: "Replica Rep One", normalized_name: "replica rep one", granot_identity: { username: "repone" } });
  await model.create({ name: "Replica Rep Two", normalized_name: "replica rep two" });
  await model.create({ name: "Replica Rep Three", normalized_name: "replica rep three" });
  await assert.rejects(
    model.create({ name: "Replica Rep Four", normalized_name: "replica rep four", granot_identity: { username: "REPONE" } }),
    (error: { code?: number }) => error.code === 11000,
  );
  assert.equal(await model.countDocuments({}), 3);
});
