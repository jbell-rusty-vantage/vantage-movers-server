/** Additional collector schedule retention index; ordinary Outreach/Pool indexes use outreach:indexes. */
import mongoose from "mongoose";
async function main() {
  const args = process.argv.slice(2), apply = args.includes("--apply");
  if (args.some(a => a !== "--apply" && !a.startsWith("--target="))) throw new Error("Unknown index option");
  const target = args.find(a => a.startsWith("--target="))?.slice(9);
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  const { connectMongo } = await import("../../src/db.js");
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime.js");
  const { assertProductionWriterMatchesDeployment } = await import("../lib/production-writer-guard.js");
  if (!target || getMongoDatabaseName() !== target) throw new Error("Named target must equal the resolved database");
  await connectMongo();
  const db = mongoose.connection.useDb(target, { useCache: true }).db!, name = "granot_estimates_schedule_retention", collection = "granot_estimates_schedule_slots";
  const exists = await db.listCollections({ name: collection }).hasNext();
  const indexes = exists ? await db.collection(collection).indexes() : [];
  const previous = indexes.find(i => i.name === name);
  if (previous && (JSON.stringify(previous.key) !== JSON.stringify({ purge_at: 1 }) || previous.expireAfterSeconds !== 0)) throw new Error("Retention index conflicts with declared spec");
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry_run", database: target, collection, name, key: { purge_at: 1 }, expireAfterSeconds: 0, action: previous ? "exists" : "create" }));
  if (apply && !previous) { await assertProductionWriterMatchesDeployment({ argv: [] }); await db.collection(collection).createIndex({ purge_at: 1 }, { name, expireAfterSeconds: 0 }); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Pool index operation failed"); process.exitCode = 1; }).finally(() => mongoose.disconnect());
