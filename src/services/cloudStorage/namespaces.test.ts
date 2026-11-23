import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Db } from "mongodb";
import { ARCHIVE_BUCKET, archiveObject, digest } from "../granotHistory/archiveCodec";
import { isCloudStorageError } from "./contract";
import { rejectsWith } from "./contractSuite";
import { createFakeBucket } from "./fakeBucket";
import {
  CLOUD_STORAGE_NAMESPACES,
  checkRecoveryPolicy,
  granotHistoryObjectName,
  openObjectStore,
  readCloudStorageConfig,
  salesIntelligencePackObjectName,
} from "./namespaces";

const dbWith = (row: Record<string, unknown> | null, databaseName = "vantagemovers") => ({
  databaseName,
  collection: (name: string) => ({ findOne: async () => (name === "cloud_storage_control" ? row : null) }),
}) as unknown as Db;

const granotRule = { action: { type: "Delete" }, condition: { daysSinceCustomTime: 90, matchesPrefix: ["history/granot/v1/vantagemovers/", "history/granot/released/vantagemovers/"] } };
const packRule = { action: { type: "Delete" }, condition: { daysSinceCustomTime: 90, matchesPrefix: ["history/sales-intelligence/v1/vantagemovers/"] } };
const backupRules = [
  { action: { type: "Delete" }, condition: { age: 8, matchesPrefix: ["backups/mongodb/vantagemovers/daily/", "backups/mongodb/vantagemovers/manifests/"] } },
  { action: { type: "Delete" }, condition: { age: 29, matchesPrefix: ["backups/mongodb/vantagemovers/weekly/"] } },
];

test("runtime configuration: defaults are production, recovery days may change, bucket and prefix may not move", async () => {
  const defaults = await readCloudStorageConfig(dbWith(null), "granot-history");
  assert.deepEqual([defaults.source, defaults.bucket, defaults.prefix, defaults.recoveryDays], ["default", ARCHIVE_BUCKET, "history/granot/v1/", 90]);
  assert.deepEqual(defaults.review, { holder: "review", drainMs: 800_000 });
  const restated = await readCloudStorageConfig(dbWith({ bucket: ARCHIVE_BUCKET, prefix: "history/granot/v1/", recovery_days: 45 }), "granot-history");
  assert.deepEqual([restated.source, restated.recoveryDays], ["mongo", 45]);
  for (const row of [
    { bucket: "vantage-archive-test" }, { prefix: "history/granot/v2/" }, { prefix: "backups/mongodb/vantagemovers/daily/" },
    { bucket: "Bad Bucket" }, { prefix: "/abs/" }, { recovery_days: 0 }, { recovery_days: "30" },
  ]) {
    await assert.rejects(readCloudStorageConfig(dbWith(row), "granot-history"), (e) => isCloudStorageError(e, "invalid_configuration"), JSON.stringify(row));
  }
});

test("only a lifecycle-checked release store can start a recovery clock or delete", async () => {
  const bucket = createFakeBucket({ bucket: ARCHIVE_BUCKET });
  const { store: writer } = await openObjectStore(dbWith(null), "granot-history", { driver: bucket });
  const name = granotHistoryObjectName(writer.prefix, "vantagemovers", digest(Buffer.from("x")));
  const stored = await writer.put({ name, bytes: Buffer.from("x"), contentType: "application/octet-stream" });
  const guard = { references: async () => false, reviewToken: "r" };
  await rejectsWith(writer.startRecoveryClock(stored, guard), "not_permitted");
  await rejectsWith(writer.deleteIfGeneration(stored, guard), "not_permitted");
  for (const [rules, database] of [[[], "vantagemovers"], [[...backupRules, { ...granotRule, condition: { ...granotRule.condition, daysSinceCustomTime: 7 } }], "vantagemovers"], [[granotRule], "testvantagemovers_x"]] as const) {
    bucket.setLifecycle([...rules]);
    await rejectsWith(openObjectStore(dbWith(null, database), "granot-history", { capability: "release", driver: bucket }), "invalid_configuration");
  }
  bucket.setLifecycle([...backupRules, granotRule, packRule]);
  const { store } = await openObjectStore(dbWith(null), "granot-history", { capability: "release", driver: bucket });
  await rejectsWith(store.startRecoveryClock(stored, guard), "hold_not_drained");
});

test("object names are byte-identical to today's Granot and Sales Intelligence code", () => {
  const prefix = CLOUD_STORAGE_NAMESPACES["granot-history"].prefix;
  for (let i = 0; i < 16; i++) {
    const hash = digest(Buffer.from(randomUUID()));
    for (const database of ["vantagemovers", "testvantagemovers", "testvantagemovers_abc123"]) {
      assert.equal(granotHistoryObjectName(prefix, database, hash), archiveObject(database, hash));
    }
  }
  for (const [database, hash] of [["../other", "a".repeat(64)], ["vantagemovers", "A".repeat(64)], ["vantagemovers", "a".repeat(63)]]) {
    assert.throws(() => granotHistoryObjectName(prefix, database, hash), /Invalid Granot archive address/);
    assert.throws(() => archiveObject(database, hash), /Invalid Granot archive address/);
  }
  assert.equal(CLOUD_STORAGE_NAMESPACES["granot-history"].bucket, ARCHIVE_BUCKET);

  // The pack script runs on require, so its constants are read from source rather than imported.
  const script = readFileSync("ops/sales-outreach/retire-historical-jobs.cjs", "utf8");
  const constant = (key: string) => script.match(new RegExp(`const ${key} = "([^"]+)";`))?.[1];
  assert.match(script, /const objectName = \(m,p\) => prefix \+ m\.run \+ "\/" \+ p\.file;/);
  assert.match(script, /const object = prefix \+ m\.run \+ "\/catalog\.json";/);
  const packs = CLOUD_STORAGE_NAMESPACES["sales-intelligence-packs"];
  assert.equal(packs.bucket, constant("bucket"));
  const run = randomUUID();
  for (const file of ["a".repeat(64) + ".bson.gz", "catalog.json"]) {
    assert.equal(salesIntelligencePackObjectName(packs.prefix, constant("database")!, run, file), constant("prefix") + run + "/" + file);
  }
  assert.throws(() => salesIntelligencePackObjectName(packs.prefix, "vantagemovers", "../x", "catalog.json"), /Invalid pack address/);
});

test("the recovery policy check accepts today's rules and rejects drift", () => {
  const rules = [...backupRules, granotRule, packRule];
  for (const [candidate, scope, days, ok] of [
    [rules, "history/granot/v1/vantagemovers/", 90, true],
    [rules, "history/sales-intelligence/v1/vantagemovers/", 90, true],
    [rules, "history/granot/v1/vantagemovers/", 45, false],
    [backupRules, "history/granot/v1/vantagemovers/", 90, false],
    [[...rules, { action: { type: "Delete" }, condition: { age: 1 } }], "history/granot/v1/vantagemovers/", 90, false],
    [[{ ...packRule, condition: { ...packRule.condition, age: 1 } }], "history/sales-intelligence/v1/vantagemovers/", 90, false],
  ] as const) {
    assert.equal(checkRecoveryPolicy([...candidate], scope, days).ok, ok, `${scope} ${days} ${ok}`);
  }
});
