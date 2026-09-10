/**
 * September 2026 Form Lead Move Type repair.
 *
 * When pickup or delivery state is `not_found`, Move Type must be Local Move.
 * Report is default. Apply writes Mongo `local` and runs the official Form
 * Lead correction Sheet Sync path (booking chain when Booked).
 *
 *   pnpm migration:form-lead-unknown-state-local -- --report
 *   pnpm migration:form-lead-unknown-state-local -- --apply --confirm-production=vantagemovers
 *   pnpm migration:form-lead-unknown-state-local -- --verify --confirm-production=vantagemovers
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import { getFormLeadModel } from "../../src/models/FormLead.js";
import { persistTheCorrectionAndRefreshTheBookingChain } from "../../src/services/leads/formLead.service.js";
import {
  finalizeSheetSync,
  runSheetSyncWrite,
} from "../../src/services/sheetSync/index.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
  parseGranotLifecycleMigrationMode,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";
import {
  classifyUnknownStateLocalRow,
  FORM_LEAD_UNKNOWN_STATE_LOCAL_SCRIPT_VERSION,
  september2026FloridaWindow,
  summarizeUnknownStateLocalInventory,
  unknownStateFormLeadFilter,
} from "./form-lead-unknown-state-local.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("form-lead-unknown-state-local");

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = parseGranotLifecycleMigrationMode(args);
  const configuredDatabase = getMongoDatabaseName();
  assertGranotLifecycleDatabaseAllowed(configuredDatabase);
  await connectMongo();
  const databaseName = mongoose.connection.db?.databaseName ?? configuredDatabase;
  if (databaseName !== configuredDatabase) {
    throw new Error(
      `Connected database ${databaseName} does not match configured ${configuredDatabase}.`,
    );
  }

  const FormLead = getFormLeadModel();
  const window = september2026FloridaWindow();
  const rows = (
    await FormLead.find(unknownStateFormLeadFilter(window))
      .select({
        timestamp: 1,
        pickup_state: 1,
        delivery_state: 1,
        local: 1,
        source_company: 1,
        duplicate: 1,
        no_sync: 1,
        booked: 1,
      })
      .sort({ timestamp: 1 })
      .lean()
      .exec()
  ).map((row) => classifyUnknownStateLocalRow(row));
  const summary = summarizeUnknownStateLocalInventory(rows);
  const needsUpdate = rows.filter((row) => row.needs_update);

  if (mode === "report") {
    await writeGranotLifecycleManifest({
      directory: OUTPUT_DIR,
      runId: `form-lead-unknown-state-local-${mode}-${Date.now()}`,
      manifest: {
        script_version: FORM_LEAD_UNKNOWN_STATE_LOCAL_SCRIPT_VERSION,
        mode,
        database: databaseName,
        window: { start: window.start.toISOString(), end: window.end.toISOString() },
        summary,
        needs_update: needsUpdate,
      },
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode,
          database: databaseName,
          summary,
          needs_update: needsUpdate,
        },
        null,
        2,
      ),
    );
    return;
  }

  assertGranotLifecycleApplyAuthorized({ args, databaseName });

  if (mode === "verify") {
    await writeGranotLifecycleManifest({
      directory: OUTPUT_DIR,
      runId: `form-lead-unknown-state-local-${mode}-${Date.now()}`,
      manifest: {
        script_version: FORM_LEAD_UNKNOWN_STATE_LOCAL_SCRIPT_VERSION,
        mode,
        database: databaseName,
        summary,
        remaining: needsUpdate,
      },
    });
    console.log(
      JSON.stringify(
        {
          ok: needsUpdate.length === 0,
          mode,
          database: databaseName,
          summary,
          remaining: needsUpdate,
        },
        null,
        2,
      ),
    );
    if (needsUpdate.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  let updated = 0;
  let sheet_sync_failed = 0;
  const failures: Array<{ id: string; error: string }> = [];
  for (const row of needsUpdate) {
    try {
      const lead = await FormLead.findById(row.id);
      if (!lead) {
        failures.push({ id: row.id, error: "missing" });
        continue;
      }
      if (lead.local === "local") continue;
      lead.local = "local";
      const job = await runSheetSyncWrite((session) =>
        persistTheCorrectionAndRefreshTheBookingChain(lead, {
          session,
          now: new Date(),
        }),
      );
      try {
        await finalizeSheetSync(job);
      } catch (error) {
        sheet_sync_failed += 1;
        failures.push({
          id: row.id,
          error: `sheet_sync: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      updated += 1;
    } catch (error) {
      failures.push({
        id: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId: `form-lead-unknown-state-local-${mode}-${Date.now()}`,
    manifest: {
      script_version: FORM_LEAD_UNKNOWN_STATE_LOCAL_SCRIPT_VERSION,
      mode,
      database: databaseName,
      summary,
      updated,
      sheet_sync_failed,
      failures,
    },
  });
  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        mode,
        database: databaseName,
        summary,
        updated,
        sheet_sync_failed,
        failures,
      },
      null,
      2,
    ),
  );
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
