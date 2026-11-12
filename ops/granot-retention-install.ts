import dns from "node:dns";
import { MongoClient, type Db } from "mongodb";
import { policies } from "../src/services/granotHistory/futureRetention";

export async function installRetention(db: Db, now = new Date()) {
  for (const name of [
    "granot_webhook_receipts",
    "granot_observations",
    "synchronization_decisions",
  ]) {
    const col = db.collection(name),
      indexName = "granot_retention_purge_v1";
    const old = (await col.indexes()).find((i) => i.name === indexName);
    if (!old)
      await col.createIndex(
        { retention_purge_at: 1 },
        { sparse: true, name: indexName },
      );
    if (old?.expireAfterSeconds === 0) continue;
    if (
      await col.findOne(
        { retention_purge_at: { $exists: true } },
        { hint: indexName, projection: { _id: 1 }, maxTimeMS: 3000 },
      )
    ) {
      throw new Error(
        "Existing purge dates require review before TTL activation",
      );
    }
    await db.command({
      collMod: name,
      index: { name: indexName, expireAfterSeconds: 0 },
    });
  }
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
  await policies(db).updateOne(
    { _id: "v1" },
    { $setOnInsert: { mode: "shadow", new_data_from: now } },
    { upsert: true },
  );
  return policies(db).findOne(
    { _id: "v1" },
    { projection: { mode: 1, new_data_from: 1 } },
  );
}
async function main() {
  if (!["--install-shadow", "--arm-future"].includes(process.argv[2]))
    throw new Error("Expected --install-shadow");
  if (process.env.MONGO_DNS_SERVERS)
    dns.setServers(
      process.env.MONGO_DNS_SERVERS.split(",").map((s) => s.trim()),
    );
  const client = new MongoClient(process.env.MONGO_URI!, {
    maxPoolSize: 1,
    appName: "granot-retention-install",
  });
  try {
    if (process.argv[2] === "--arm-future") {
      const cutoff = new Date(process.argv[3] ?? "");
      if (!Number.isFinite(+cutoff))
        throw new Error("Supply the existing new_data_from timestamp");
      const col = policies(client.db("vantagemovers"));
      await col.updateOne(
        {
          _id: "v1",
          mode: "shadow",
          new_data_from: cutoff,
          armed_at: { $exists: false },
        },
        { $set: { armed_at: new Date() } },
      );
      const state = await col.findOne(
        { _id: "v1", new_data_from: cutoff },
        { projection: { mode: 1, new_data_from: 1, armed_at: 1 } },
      );
      if (!state?.armed_at)
        throw new Error("Retention cutoff mismatch or policy unavailable");
      console.log(JSON.stringify(state));
      return;
    }
    console.log(
      JSON.stringify(await installRetention(client.db("vantagemovers"))),
    );
  } finally {
    await client.close();
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.name, e.code ?? "install_failed");
    process.exitCode = 1;
  });
