import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import { z } from "zod";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import {
  reportCsiMigration,
  applyCsiMigration,
} from "./sales-intelligence.lib";
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
  if (mode === "apply")
    assertGranotLifecycleApplyAuthorized({ args, databaseName });
  const mappingPath = args
    .find((v) => v.startsWith("--account-mappings="))
    ?.slice("--account-mappings=".length);
  const mappings = mappingPath
    ? z
        .array(
          z
            .object({
              conversation_id: z.string().regex(/^[a-f\d]{24}$/i),
              provider_account_id: z.string().trim().min(1),
              evidence_ref: z.string().trim().min(1),
            })
            .strict(),
        )
        .parse(JSON.parse(await readFile(mappingPath, "utf8")))
    : [];
  await connectMongo();
  const report =
    mode === "apply"
      ? await applyCsiMigration(mappings)
      : await reportCsiMigration(mappings);
  const artifact = await writeGranotLifecycleManifest({
    directory: granotLifecycleOutputDirectory("sales-intelligence"),
    runId: `${mode}-${Date.now()}`,
    manifest: report,
  });
  // Exact record ids are in the access-limited manifest, not console output.
  console.log(
    JSON.stringify({
      mode,
      database: report.database,
      ready: report.ready,
      unresolved_accounts: report.unresolved_account_ids.length,
      collections: report.collections,
      artifact,
    }),
  );
  if (
    mode === "verify" &&
    (!report.ready || report.collections.some((v) => v.missing.length))
  )
    throw new Error("CSI verification incomplete");
}
main()
  .catch(() => {
    console.error(
      "CSI migration failed; inspect the report and reviewed mapping artifact.",
    );
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
