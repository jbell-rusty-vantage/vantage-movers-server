import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Db } from "mongodb";
import { archiveObject, digest } from "../granotHistory/archiveCodec";
import { isCloudStorageError } from "./contract";
import { createFakeBucket } from "./fakeBucket";
import {
  CLOUD_STORAGE_CONTROL_COLLECTION,
  CLOUD_STORAGE_NAMESPACES,
  checkRecoveryPolicy,
  granotHistoryObjectName,
  openObjectStore,
  readCloudStorageConfig,
  salesIntelligencePackObjectName,
} from "./namespaces";

function dbWith(rows: Record<string, unknown>) {
  const reads: Array<{ collection: string; filter: unknown }> = [];
  const db = {
    collection: (name: string) => ({
      findOne: async (filter: { _id: string }) => {
        reads.push({ collection: name, filter });
        return name === CLOUD_STORAGE_CONTROL_COLLECTION ? (rows[filter._id] ?? null) : null;
      },
    }),
  } as unknown as Db;
  return { db, reads };
}

test("a missing control document resolves to today's production values", async () => {
  const { db, reads } = dbWith({});
  const config = await readCloudStorageConfig(db, "granot-history");
  assert.deepEqual(reads, [{ collection: "cloud_storage_control", filter: { _id: "granot-history" } }]);
  assert.equal(config.source, "default");
  assert.equal(config.bucket, "vantage-mongodb-backups-496816");
  assert.equal(config.prefix, "history/granot/v1/");
  assert.equal(config.recoveryDays, 30);
  const packs = await readCloudStorageConfig(db, "sales-intelligence-packs");
  assert.equal(packs.prefix, "history/sales-intelligence/v1/");
  assert.deepEqual(packs.reuse, { mode: "refuse_released" });
});

test("Mongo runtime configuration overrides bucket, prefix and recovery days", async () => {
  const { db } = dbWith({ "granot-history": { _id: "granot-history", bucket: "vantage-archive-test", prefix: "history/granot/v2/", recovery_days: 45 } });
  const config = await readCloudStorageConfig(db, "granot-history");
  assert.equal(config.source, "mongo");
  assert.equal(config.bucket, "vantage-archive-test");
  assert.equal(config.prefix, "history/granot/v2/");
  assert.equal(config.recoveryDays, 45);
  assert.deepEqual(config.holdKeys, CLOUD_STORAGE_NAMESPACES["granot-history"].holdKeys, "hold keys stay code constants");
});

test("an invalid control document fails closed", async () => {
  for (const row of [{ bucket: "Bad Bucket" }, { prefix: "/abs/" }, { prefix: "no-slash" }, { recovery_days: 0 }, { recovery_days: "30" }]) {
    const { db } = dbWith({ "granot-history": { _id: "granot-history", ...row } });
    await assert.rejects(readCloudStorageConfig(db, "granot-history"), (e) => isCloudStorageError(e, "invalid_configuration"));
  }
});

test("openObjectStore scopes the store to the configured bucket and prefix", async () => {
  const { db } = dbWith({});
  const { store, config } = await openObjectStore(db, "granot-history", createFakeBucket({ bucket: "vantage-mongodb-backups-496816" }));
  assert.equal(store.bucket, config.bucket);
  assert.equal(store.prefix, "history/granot/v1/");
  await assert.rejects(store.put({ name: "history/sales-intelligence/v1/x", bytes: Buffer.from("x"), contentType: "text/plain" }),
    (e) => isCloudStorageError(e, "invalid_name"));
});

test("Granot object names are byte-identical to archiveCodec.archiveObject", () => {
  const prefix = CLOUD_STORAGE_NAMESPACES["granot-history"].prefix;
  for (let i = 0; i < 64; i++) {
    const hash = digest(Buffer.from(randomUUID()));
    for (const database of ["vantagemovers", "testvantagemovers", "testvantagemovers_abc123"]) {
      assert.equal(granotHistoryObjectName(prefix, database, hash), archiveObject(database, hash));
    }
  }
  for (const [database, hash] of [["../other", "a".repeat(64)], ["vantagemovers", "A".repeat(64)], ["vantagemovers", "a".repeat(63)]]) {
    assert.throws(() => granotHistoryObjectName(prefix, database, hash), /Invalid Granot archive address/);
    assert.throws(() => archiveObject(database, hash), /Invalid Granot archive address/);
  }
});

test("Sales Intelligence pack names match ops/sales-outreach/retire-historical-jobs.cjs", () => {
  const prefix = CLOUD_STORAGE_NAMESPACES["sales-intelligence-packs"].prefix;
  const run = "df5fb1c2-dd3d-47ab-b1ba-57f8e7b2af71";
  const file = "a".repeat(64) + ".bson.gz";
  const scriptPrefix = "history/sales-intelligence/v1/vantagemovers/";
  assert.equal(salesIntelligencePackObjectName(prefix, "vantagemovers", run, file), scriptPrefix + run + "/" + file);
  assert.equal(salesIntelligencePackObjectName(prefix, "vantagemovers", run, "catalog.json"),
    "history/sales-intelligence/v1/vantagemovers/df5fb1c2-dd3d-47ab-b1ba-57f8e7b2af71/catalog.json");
  assert.throws(() => salesIntelligencePackObjectName(prefix, "vantagemovers", "../x", file), /Invalid pack address/);
});

test("the recovery policy check accepts today's Granot and Sales Intelligence rules and rejects drift", () => {
  const backup = [
    { action: { type: "Delete" }, condition: { age: 8, matchesPrefix: ["backups/mongodb/vantagemovers/daily/", "backups/mongodb/vantagemovers/manifests/"] } },
    { action: { type: "Delete" }, condition: { age: 29, matchesPrefix: ["backups/mongodb/vantagemovers/weekly/"] } },
  ];
  const granot = { action: { type: "Delete" }, condition: { daysSinceCustomTime: 30, matchesPrefix: ["history/granot/v1/vantagemovers/", "history/granot/released/vantagemovers/"] } };
  const packs = { action: { type: "Delete" }, condition: { daysSinceCustomTime: 30, matchesPrefix: ["history/sales-intelligence/v1/vantagemovers/"] } };
  const rules = [...backup, granot, packs];
  assert.deepEqual(checkRecoveryPolicy(rules, "history/granot/v1/vantagemovers/", 30), { ok: true });
  assert.deepEqual(checkRecoveryPolicy(rules, "history/sales-intelligence/v1/vantagemovers/", 30), { ok: true });
  assert.equal(checkRecoveryPolicy(rules, "history/granot/v1/vantagemovers/", 45).ok, false);
  assert.equal(checkRecoveryPolicy([...rules, { action: { type: "Delete" }, condition: { age: 1 } }], "history/granot/v1/vantagemovers/", 30).ok, false);
  assert.equal(checkRecoveryPolicy(backup, "history/granot/v1/vantagemovers/", 30).ok, false);
  assert.equal(checkRecoveryPolicy([{ ...packs, condition: { ...packs.condition, age: 1 } }], "history/sales-intelligence/v1/vantagemovers/", 30).ok, false);
});
