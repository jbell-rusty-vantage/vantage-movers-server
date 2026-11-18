import dns from "node:dns";
import { MongoClient } from "mongodb";
import { legacyScheduled, migrateScheduledEnrollment, migrationStatus } from "./granot-scheduled-enrollment-migration";

/** Admit a bounded page of verified-terminal scheduled runs. Only their storage expiry changes. */
async function main() {
  const [mode, rawCutoff, rawLimit, rawSize] = process.argv.slice(2);
  const until = new Date(rawCutoff ?? "");
  const limit = Number(rawLimit ?? (mode === "--migrate" ? 8 : 200));
  if (!["--preview", "--apply", "--migrate", "--migration-status"].includes(mode) ||
      (mode !== "--migration-status" && (!Number.isFinite(+until) || +until > Date.now() ||
      !Number.isInteger(limit) || limit < 1 || limit > 1000))) throw new Error("Supply a valid mode, cutover and page bounds");
  if (process.env.MONGO_DNS_SERVERS) dns.setServers(process.env.MONGO_DNS_SERVERS.split(",").map(v => v.trim()));
  const client = new MongoClient(process.env.MONGO_URI!, { appName: "granot-terminal-archive-enrollment", maxPoolSize: 1 });
  try {
    const db = client.db("vantagemovers");
    if (mode === "--migrate" || mode === "--migration-status") {
      console.log(JSON.stringify(mode === "--migrate" ? await migrateScheduledEnrollment(db, until, limit, Number(rawSize ?? 200)) : await migrationStatus(db)));
      return;
    }
    const runs = db.collection("granot_automation_runs");
    const predicate = { ...legacyScheduled, status: "completed", expires_at: { $lte: until }, completed_at: { $lte: until } };
    const rows = await runs.find(predicate, { projection: { _id: 1, expires_at: 1 }, sort: { expires_at: 1 }, limit, maxTimeMS: 5000 }).toArray();
    let enrolled = 0;
    if (mode === "--apply" && rows.length) {
      const indices = await runs.indexes();
      if (!indices.some(i => i.name === "granot_scheduled_archive_due" && i.key?.archive_review_at === 1 && i.sparse))
        throw new Error("Scheduled archive review index missing");
      const result = await runs.updateMany({ ...predicate, _id: { $in: rows.map(r => r._id) } },
        [{ $set: { archive_review_at: "$expires_at", purge_at: null } }], { writeConcern: { w: "majority" }, maxTimeMS: 5000 });
      enrolled = result.modifiedCount;
    }
    console.log(JSON.stringify({ mode, cutoff: until, selected: rows.length, enrolled }));
  } finally {
    await client.close();
  }
}
main().catch(error => { console.error(error.name, error.codeName ?? "enrollment_failed"); process.exitCode = 1; });
