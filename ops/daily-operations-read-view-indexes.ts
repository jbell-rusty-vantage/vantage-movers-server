import { connectMongo } from "../src/db";
import { getDailyOperationsEventModel } from "../src/models/DailyOperationsEvent";
import { getMongoDatabaseName } from "../src/config/domain/runtime";

/** Additive only; never drops/rebuilds existing indexes or edits historical rows. */
async function main() {
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify({ dry_run: true, index: "dailyops_day_kind_order", key: { day: 1, kind: 1, occurred_at: -1, _id: -1 } }));
    return;
  }
  await connectMongo();
  const model = getDailyOperationsEventModel();
  await model.collection.createIndex({ day: 1, kind: 1, occurred_at: -1, _id: -1 }, { name: "dailyops_day_kind_order" });
  console.log(JSON.stringify({ applied: true, database: getMongoDatabaseName(), collection: model.collection.collectionName, index: "dailyops_day_kind_order" }));
}
void main().catch((error: unknown) => {
  console.error(JSON.stringify({ failed: true, errorName: error instanceof Error ? error.name : "Error" }));
  process.exitCode = 1;
}).finally(async () => { const { default: mongoose } = await import("mongoose"); await mongoose.disconnect(); });
