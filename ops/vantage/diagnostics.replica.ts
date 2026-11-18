/** Opt-in proof: owns only a fresh PID database on the fixed synthetic replica. */
import assert from "node:assert/strict";
import { MongoClient, ObjectId } from "mongodb";
import { assertLocalHello, publicFailure, SHEET_REPLICA } from "./local-safety";
import { inspectSheetSync, traceSheetSync } from "./sheet-sync";

async function main() {
  const client = new MongoClient(SHEET_REPLICA.uri, { monitorCommands: true, serverSelectionTimeoutMS: 2000 });
  const database = `${SHEET_REPLICA.database}${process.pid}`;
  let ownsDatabase = false;
  try {
    await client.connect();
    assertLocalHello(await client.db("admin").command({ hello: 1 }), SHEET_REPLICA);
    const present = await client.db("admin").admin().listDatabases({ nameOnly: true, filter: { name: database } });
    assert.equal(present.databases.length, 0, "fixture namespace already exists; refusing ownership");
    ownsDatabase = true;
    const db = client.db(database);
    const job = new ObjectId("000000000000000000000001");
    const run = new ObjectId("000000000000000000000002");
    const secret = "customer@example.com mongodb://secret:password@private";
    await db.collection("sheet_sync_jobs").insertOne({ _id: job, status: secret, resource: secret,
      attempts: secret, due_at: secret, run_id: run, tombstone: { name: secret }, last_error: secret });
    await db.collection("sheet_sync_attempts").insertMany(Array.from({ length: 26 }, () => ({
      job_id: job, run_id: run, status: "deferred", action: "append", error: secret, target: secret, createdAt: new Date(),
    })));
    await db.collection("sheet_sync_attempts").createIndex({ job_id: 1, createdAt: 1 });
    await db.collection("sheet_sync_runs").insertOne({ _id: run, status: "partial_failure", error_summary: secret, started_at: new Date() });
    const guardScope = "lead-reporting:tab-migration";
    const now = new Date();
    await db.collection("sheet_sync_leases").insertMany([
      { scope: guardScope, lease_owner: secret, leased_until: new Date(now.getTime() + 120_000) },
      { scope: "sheet-sync:drain", lease_owner: secret, leased_until: secret },
      { scope: secret, lease_owner: secret },
    ]);
    const reasons = ["structural_write_unconfirmed", "quota_budget_exhausted", "delivery_guard_stopped", "destination_upsert_pending"];
    await db.collection("sheet_sync_attempts").insertMany(reasons.map((reason, index) => ({
      job_id: job, run_id: run, status: "deferred", action: "append", error: reason + ":" + secret,
      createdAt: new Date(now.getTime() + index + 1),
    })));
    const window = Math.floor(now.getTime() / 60_000) * 60_000;
    // Cover a minute rollover between setup and trace.
    await db.collection("sheet_sync_quota_buckets").insertMany([window, window + 60_000].map((start) => ({
      scope: "user", op_class: "write", window_start: new Date(start), count: 3, other: secret,
    })));
    await db.collection("sheet_sync_leases").createIndex({ scope: 1 });
    await db.collection("sheet_sync_quota_buckets").createIndex({ scope: 1, op_class: 1, window_start: 1 });
    const before = await db.listCollections({}, { nameOnly: true }).toArray();
    const commands: string[] = [];
    const listener = (event: { commandName: string }) => commands.push(event.commandName);
    client.on("commandStarted", listener);
    const inspect = await inspectSheetSync(db);
    const trace = await traceSheetSync(db, job.toHexString());
    client.off("commandStarted", listener);
    assert.equal(inspect.status, "partial");
    assert.equal(inspect.jobs[0]!.status, "unknown");
    assert.equal(inspect.jobs[0]!.due_at, null);
    assert.equal(trace.more_attempts, true);
    assert.equal(trace.attempts.length, 25);
    assert.equal(trace.runs.length, 1);
    assert.deepEqual(trace.attempts.slice(0, reasons.length).map((row) => row.deferral_reason), [...reasons].reverse());
    assert.equal(trace.attempts.at(-1)?.deferral_reason, "unknown");
    assert.deepEqual(trace.guards.leases.map((row) => row.state), ["unknown", "held"]);
    assert.deepEqual(trace.guards.quota.reservations, [{ op_class: "write", count: 3 }]);
    assert.equal(trace.guards.quota.remaining_budget, "unknown");
    assert.doesNotMatch(JSON.stringify({ inspect, trace }), /customer|secret|password|private/);
    assert.ok(commands.length >= 4);
    assert.ok(commands.every((name) => ["aggregate", "getMore", "killCursors"].includes(name)), commands.join(","));
    assert.deepEqual(await db.listCollections({}, { nameOnly: true }).toArray(), before);
    console.log(JSON.stringify({ status: "passed", proof: "diagnostics_scalar_projection_and_read_only_commands", commands: commands.length }));
  } finally {
    try {
      if (ownsDatabase) {
        assert.equal(database, `testvantagemovers_sheetrecovery${process.pid}`);
        assertLocalHello(await client.db("admin").command({ hello: 1 }), SHEET_REPLICA);
        await client.db(database).dropDatabase();
      }
    } finally { await client.close(); }
  }
}
main().catch((error) => { console.log(JSON.stringify(publicFailure(error))); process.exitCode = 1; });
