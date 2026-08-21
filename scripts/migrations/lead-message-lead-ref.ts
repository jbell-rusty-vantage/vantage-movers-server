/**
 * Phase 1 LeadMessage.lead_ref backfill.
 *
 *   pnpm migration:lead-message-lead-ref -- --report
 *   pnpm migration:lead-message-lead-ref -- --backfill --confirm-production=testvantagemovers
 *   pnpm migration:lead-message-lead-ref -- --verify
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import { getFormLeadModel } from "../../src/models/FormLead.js";
import { getLeadMessageModel } from "../../src/models/LeadMessage.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";
import {
  LEAD_MESSAGE_LEAD_REF_SCRIPT_VERSION,
  leadRefBackfillUpdate,
  leadRefMatchesFormLead,
  needsLeadRefBackfill,
  summarizeLeadRefInventory,
  toLeadRefInventoryRow,
} from "./lead-message-lead-ref.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("lead-message-lead-ref");
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
  const Message = getLeadMessageModel();
  const FormLead = getFormLeadModel();
  const rows = await Message.find({})
    .select({ form_lead: 1, lead_ref: 1, origin: 1 })
    .lean()
    .exec();
  const formIds = [
    ...new Set(
      rows
        .map((row) => (row.form_lead ? String(row.form_lead) : null))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const existingForms = new Set(
    (
      await FormLead.find({ _id: { $in: formIds } })
        .select({ _id: 1 })
        .lean()
        .exec()
    ).map((row) => String(row._id)),
  );
  const inventory = rows.map((row) => {
    const item = toLeadRefInventoryRow(row as unknown as Record<string, unknown>);
    return {
      ...item,
      has_form_lead: item.has_form_lead && existingForms.has(item.form_lead ?? ""),
    };
  });
  const summary = summarizeLeadRefInventory(inventory);

  if (mode === "backfill") {
    assertGranotLifecycleApplyAuthorized({
      args: process.argv,
      databaseName: configuredDatabase,
    });
    const missing = rows.filter((row) =>
      needsLeadRefBackfill(row as { lead_ref?: { id?: unknown } | null }),
    );
    let updated = 0;
    for (let index = 0; index < missing.length; index += BATCH_SIZE) {
      const batch = missing.slice(index, index + BATCH_SIZE);
      for (const row of batch) {
        if (!row.form_lead) continue;
        const result = await Message.updateOne(
          { _id: row._id, "lead_ref.id": { $exists: false } },
          { $set: leadRefBackfillUpdate(row.form_lead) },
        );
        updated += result.modifiedCount;
      }
    }
    await writeGranotLifecycleManifest({
      directory: OUTPUT_DIR,
      runId: `lead-message-lead-ref-${mode}-${Date.now()}`,
      manifest: {
        script_version: LEAD_MESSAGE_LEAD_REF_SCRIPT_VERSION,
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
    const missing = rows.filter((row) =>
      needsLeadRefBackfill(row as { lead_ref?: { id?: unknown } | null }),
    );
    const mismatched = rows.filter(
      (row) => !leadRefMatchesFormLead(row as { form_lead?: unknown; lead_ref?: { id?: unknown } }),
    );
    if (missing.length > 0 || mismatched.length > 0) {
      throw new Error(
        `Verify failed: missing_lead_ref=${missing.length} mismatched=${mismatched.length}.`,
      );
    }
    await writeGranotLifecycleManifest({
      directory: OUTPUT_DIR,
      runId: `lead-message-lead-ref-${mode}-${Date.now()}`,
      manifest: {
        script_version: LEAD_MESSAGE_LEAD_REF_SCRIPT_VERSION,
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
    runId: `lead-message-lead-ref-${mode}-${Date.now()}`,
    manifest: {
      script_version: LEAD_MESSAGE_LEAD_REF_SCRIPT_VERSION,
      mode,
      database: configuredDatabase,
      summary,
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
