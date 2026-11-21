/**
 * Granot storage retention setup. Idempotent; run with the server environment loaded:
 *   node --import tsx ops/granot-retention-install.ts --install
 *   node --import tsx ops/granot-retention-install.ts --enable <ISO instant>   # start retire on use from this capture time
 *   node --import tsx ops/granot-retention-install.ts --disable                # stop the online pass (rollback)
 * Retired records stay readable by original ID after --disable. Runbook:
 * docs/knowledge/granot-lifecycle/storage-retention-operations.md#retire-on-use.
 */
import dns from "node:dns";
import { MongoClient, type Db } from "mongodb";
import { installRetiredOperationIndex, RETIRE_ON_USE_CONTROL } from "../src/services/granotHistory/retireOnUse";

const control = (db: Db) => db.collection<{ _id: string; enabled_from?: Date; updated_at?: Date }>("granot_retention_control");

export async function installRetention(db: Db) {
  await db.collection("granot_completed_estimate_windows").createIndex({purge_at:1},{name:"granot_completed_window_ttl",expireAfterSeconds:0});
  await db.collection("granot_completed_estimate_windows").createIndex({"request_snapshot.scheduled_coverage.slotKey":1},{name:"granot_completed_window_slot"});
  await db.collection("granot_automation_runs").createIndex(
    { archive_review_at: 1 }, { sparse: true, name: "granot_scheduled_archive_due" },
  );
  await db
    .collection("granot_webhook_receipts")
    .createIndex(
      { "processing.retention_review_at": 1 },
      { sparse: true, name: "granot_retention_review_v1" },
    );
  await db
    .collection("granot_history_archive_chunks")
    .createIndex(
      { job_key: 1, newest: -1 },
      { name: "granot_archive_job_newest" },
    );
  await db.collection("granot_history_archive_chunks").createIndex({evidence_ids:1},{sparse:true,name:"granot_archived_evidence_id"});
  // Retired channel operations keep their unique key here, so the online pass refuses them until it exists.
  await installRetiredOperationIndex(db);
  return control(db).findOne({ _id: RETIRE_ON_USE_CONTROL });
}

async function main() {
  const [mode, at] = process.argv.slice(2);
  if (!["--install", "--enable", "--disable"].includes(mode)) throw new Error("Expected --install | --enable <ISO instant> | --disable");
  if (process.env.MONGO_DNS_SERVERS)
    dns.setServers(
      process.env.MONGO_DNS_SERVERS.split(",").map((s) => s.trim()),
    );
  const client = new MongoClient(process.env.MONGO_URI!, {
    maxPoolSize: 1,
    appName: "granot-retention-install",
  });
  try {
    const db = client.db("vantagemovers");
    if (mode === "--install") return console.log(JSON.stringify(await installRetention(db)));
    if (mode === "--disable") {
      await control(db).deleteOne({ _id: RETIRE_ON_USE_CONTROL });
      return console.log(JSON.stringify({ retire_on_use: "disabled" }));
    }
    const from = new Date(at ?? "");
    if (!Number.isFinite(+from)) throw new Error("Supply the first capture instant to retire on use");
    await installRetention(db);
    await control(db).updateOne({ _id: RETIRE_ON_USE_CONTROL }, { $setOnInsert: { enabled_from: from, updated_at: new Date() } }, { upsert: true });
    console.log(JSON.stringify(await control(db).findOne({ _id: RETIRE_ON_USE_CONTROL })));
  } finally {
    await client.close();
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.name, e.code ?? "install_failed");
    process.exitCode = 1;
  });
