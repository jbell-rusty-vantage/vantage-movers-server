/** Only a new database on the dedicated loopback replica may run this synthetic proof. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";

const uri = "mongodb://127.0.0.1:27216/?replicaSet=capacityp1&directConnection=true&monitorCommands=true";
async function main() {
  const database = "testvantagemovers_granotphase2" + randomUUID().replaceAll("-", "");
  const output = process.argv[2];
  assert.ok(output, "Pass a new output JSON path");
  assert.ok(!existsSync(output), "Refusing to overwrite existing evidence");
  const dotenv = resolve("ops/capacity/.granot-phase-two-no-dotenv");
  assert.ok(!existsSync(dotenv));
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(database);
    const hello = await db.admin().command({ hello: 1 });
    assert.equal(hello.setName, "capacityp1");
    assert.equal(hello.isWritablePrimary, true);
    assert.deepEqual(hello.hosts, ["127.0.0.1:27216"]);
    assert.equal((hello.passives ?? []).length + (hello.arbiters ?? []).length, 0);
    assert.deepEqual(await db.listCollections().toArray(), []);
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "SystemRoot", "TEMP", "TMP"]) env[key] = process.env[key];
    const emptyProfile = resolve(dotenv + "-" + database);
    assert.ok(!existsSync(emptyProfile));
    Object.assign(env, { HOME: emptyProfile, USERPROFILE: emptyProfile, LOCALAPPDATA: emptyProfile, APPDATA: emptyProfile });
    Object.assign(env, {
      MONGO_URI: uri, TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database,
      DOTENV_CONFIG_PATH: dotenv, NODE_ENV: "test", SALES_INTELLIGENCE_DEPLOYMENT_ID: "granot-phase-two-local",
      SHEET_SYNC_MODE: "queued", GRANOT_LIFECYCLE_SHADOW_MODE: "false", GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED: "true",
      GRANOT_AUTOMATION_APPLY_ENABLED: "true", GRANOT_USERNAME: "fixture", GRANOT_PASSWORD: "fixture",
      GRANOT_NETWORK_USERNAME: "fixture", GRANOT_NETWORK_PASSWORD: "fixture",
    });
    for (const name of ["MASTER_LEADS", "MASTER_BOOKED", "TBM_LEADS", "TBM_PRIME_LEADS", "TOP10_LEADS", "BEST_RELOCATION_LEADS", "GETMOVERS_LEADS", "MAINSITE_LEADS"]) env["TEST_" + name + "_SHEET_ID"] = "synthetic-" + name;
    try {
      const child = spawnSync(process.execPath, ["--import", "tsx", "--import", "./ops/test-setup.ts",
        "ops/capacity/granot-sealed-measurement.ts", resolve(output)], { env, stdio: "inherit" });
      if (child.error) throw child.error;
      assert.equal(child.status, 0, "Sealed-run measurement failed");
    } finally {
      await db.dropDatabase();
    }
  } finally {
    await client.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
