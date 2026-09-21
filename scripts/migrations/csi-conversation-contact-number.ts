import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { backfillConversationContactNumbers } from "./csi-conversation-contact-number.lib";
import {
  parseGranotLifecycleMigrationMode,
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  writeGranotLifecycleManifest,
  granotLifecycleOutputDirectory,
} from "./granot-lifecycle-migration.lib";

async function main() {
  const args = process.argv.slice(2);
  const mode = parseGranotLifecycleMigrationMode(args);
  const databaseName = getMongoDatabaseName();
  assertGranotLifecycleDatabaseAllowed(databaseName);
  if (mode === "apply") assertGranotLifecycleApplyAuthorized({ args, databaseName });
  await connectMongo();
  const report = await backfillConversationContactNumbers(mode === "apply" ? "apply" : "verify");
  const artifact = await writeGranotLifecycleManifest({
    directory: granotLifecycleOutputDirectory("csi-conversation-contact-number"),
    runId: `${mode}-${Date.now()}`,
    manifest: report,
  });
  console.log(JSON.stringify({ ...report, artifact }));
}

main()
  .catch((error: unknown) => {
    console.error(
      "Conversation Contact Number backfill failed:",
      error instanceof Error ? error.name : "Error",
    );
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
