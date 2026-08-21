/**
 * Backfill GranotCrmSource.outbound_sms defaults.
 *
 * Dry-run / --report by default. Mutation requires
 * --backfill --confirm-production=<database-name>.
 *
 *   pnpm migration:granot-crm-source-outbound-sms -- --report
 *   pnpm migration:granot-crm-source-outbound-sms -- --backfill --confirm-production=testvantagemovers
 *   pnpm migration:granot-crm-source-outbound-sms -- --verify
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import { getGranotCrmSourceModel } from "../../src/models/GranotCrmSource.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";
import {
  CRM_SOURCE_OUTBOUND_SMS_SCRIPT_VERSION,
  DEFAULT_CRM_SOURCE_OUTBOUND_SMS,
  needsOutboundSmsBackfill,
  summarizeOutboundSmsInventory,
  toInventoryRow,
} from "./granot-crm-source-outbound-sms.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("granot-crm-source-outbound-sms");
const BATCH_SIZE = 200;

function parseMode(args: readonly string[]): "report" | "backfill" | "verify" {
  const report = args.includes("--report");
  const backfill = args.includes("--backfill");
  const verify = args.includes("--verify");
  const selected = [report, backfill, verify].filter(Boolean).length;
  if (selected > 1) {
    throw new Error("Refusing combined --report, --backfill, and --verify flags.");
  }
  if (backfill) return "backfill";
  if (verify) return "verify";
  return "report";
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv);
  const configuredDatabase = getMongoDatabaseName();
  assertGranotLifecycleDatabaseAllowed(configuredDatabase);
  await connectMongo();
  const Source = getGranotCrmSourceModel();
  const rows = await Source.find({})
    .select({ granot_label: 1, outbound_sms: 1 })
    .lean()
    .exec();
  const inventory = rows.map((row) => toInventoryRow(row as unknown as Record<string, unknown>));
  const summary = summarizeOutboundSmsInventory(inventory);
  const missingIds = inventory
    .filter((row) => !row.has_outbound_sms)
    .map((row) => row.id);

  if (mode === "backfill") {
    assertGranotLifecycleApplyAuthorized({
      args: process.argv,
      databaseName: configuredDatabase,
    });
    let updated = 0;
    for (let index = 0; index < missingIds.length; index += BATCH_SIZE) {
      const batch = missingIds.slice(index, index + BATCH_SIZE);
      const result = await Source.updateMany(
        {
          _id: { $in: batch },
          $or: [
            { outbound_sms: { $exists: false } },
            { outbound_sms: null },
          ],
        },
        { $set: { outbound_sms: DEFAULT_CRM_SOURCE_OUTBOUND_SMS } },
      );
      updated += result.modifiedCount;
    }
    await writeGranotLifecycleManifest({
      directory: OUTPUT_DIR,
      runId: `granot-crm-source-outbound-sms-${mode}-${Date.now()}`,
      manifest: {
        script_version: CRM_SOURCE_OUTBOUND_SMS_SCRIPT_VERSION,
        mode,
        database: configuredDatabase,
        summary,
        updated,
      },
    });
    console.log(JSON.stringify({ ok: true, mode, summary, updated }, null, 2));
    return;
  }

  if (mode === "verify") {
    const stillMissing = rows.filter((row) =>
      needsOutboundSmsBackfill(row as { outbound_sms?: unknown }),
    );
    if (stillMissing.length > 0) {
      throw new Error(
        `Verify failed: ${stillMissing.length} Granot CRM sources still lack outbound_sms.`,
      );
    }
    await writeGranotLifecycleManifest({
      directory: OUTPUT_DIR,
      runId: `granot-crm-source-outbound-sms-${mode}-${Date.now()}`,
      manifest: {
        script_version: CRM_SOURCE_OUTBOUND_SMS_SCRIPT_VERSION,
        mode,
        database: configuredDatabase,
        summary,
      },
    });
    console.log(JSON.stringify({ ok: true, mode, summary }, null, 2));
    return;
  }

  await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId: `granot-crm-source-outbound-sms-${mode}-${Date.now()}`,
    manifest: {
      script_version: CRM_SOURCE_OUTBOUND_SMS_SCRIPT_VERSION,
      mode,
      database: configuredDatabase,
      summary,
      missing_ids: missingIds,
    },
  });
  console.log(JSON.stringify({ ok: true, mode, summary }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
