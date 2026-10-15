/** Recover missing Call Lead dates from their accepted Granot evidence. Dry-run by default. */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { inspectCallMoveDateRecovery, recoverCallMoveDate } from "../../src/services/granotLifecycle/callLeadMoveDateRepair";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply" && !arg.startsWith("--target="))) throw new Error("Use --target=<database> [--apply]");
  const target = args.find((arg) => arg.startsWith("--target="))?.slice(9);
  if (!target) throw new Error("An explicit --target=<database> is required");
  assertTargetMatchesDatabase(target, getMongoDatabaseName());
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  await connectMongo();
  const before = await inspectCallMoveDateRecovery();
  const summary = (value: typeof before) => ({ leads: value.leads, dated: value.dated, recoverable: value.candidates.length, unknown: value.unknown });
  if (!args.includes("--apply")) { console.log(JSON.stringify({ mode: "dry_run", ...summary(before) })); return; }
  await assertProductionWriterMatchesDeployment();
  let changed = 0;
  for (let offset = 0; offset < before.candidates.length; offset += 3) {
    const batch = await Promise.all(before.candidates.slice(offset, offset + 3).map(recoverCallMoveDate));
    changed += batch.filter(Boolean).length;
    if ((offset + 3) % 30 === 0) console.log(JSON.stringify({ progress: Math.min(offset + 3, before.candidates.length), changed }));
  }
  const after = await inspectCallMoveDateRecovery();
  console.log(JSON.stringify({ mode: "apply", before: summary(before), changed, after: summary(after) }));
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Recovery failed"); process.exitCode = 1; }).finally(() => mongoose.disconnect());
