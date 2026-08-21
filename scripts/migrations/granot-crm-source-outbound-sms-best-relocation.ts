/**
 * Enable Granot lead_created confirmation SMS on Best Relocation Forms
 * and Inbounds after the global outbound_sms default backfill.
 *
 *   pnpm migration:granot-crm-source-sms-best-relocation -- --report
 *   pnpm migration:granot-crm-source-sms-best-relocation -- --apply --confirm-production=<db>
 *   pnpm migration:granot-crm-source-sms-best-relocation -- --verify
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import { getGranotCrmSourceModel } from "../../src/models/GranotCrmSource.js";
import { DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE } from "../../src/services/leadMessaging/granotCreatedLead.js";
import {
  setGranotCrmSourceOutboundSms,
  toSmsView,
} from "../../src/services/operationsRegistry/crmSourceOutboundSms.js";
import type { RegistryActorContext } from "../../src/services/operationsRegistry/types.js";
import { normalizeGranotSourceLabel } from "../../src/services/granotLifecycle/sourceLabel.js";
import type { OutboundSmsConsentBasis } from "../../src/config/domain/leadMessaging.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
  parseGranotLifecycleMigrationMode,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory(
  "granot-crm-source-outbound-sms-best-relocation",
);
const SCRIPT_VERSION = "granot-crm-source-outbound-sms-best-relocation/1";
const ACTOR_ID = "granot-crm-source-outbound-sms-best-relocation";
const APPLY_REASON =
  "Enable Granot lead_created confirmation texts for Best Relocation Forms and Inbounds.";

type TargetFamily = {
  family: "best_relocation_form" | "best_relocation_call";
  consent_basis: Exclude<OutboundSmsConsentBasis, "not_attested">;
  labels: readonly string[];
};

const TARGETS: readonly TargetFamily[] = [
  {
    family: "best_relocation_form",
    consent_basis: "customer_submitted_form",
    labels: ["best relocation forms", "bestrelocation forms"],
  },
  {
    family: "best_relocation_call",
    consent_basis: "existing_relationship",
    labels: ["bestrelocation inbounds", "best relocation inbounds"],
  },
];

type InventoryRow = {
  id: string;
  family: TargetFamily["family"];
  granot_label: string;
  normalized_granot_label: string;
  enabled: boolean;
  lead_created_policy: string;
  sms_enabled: boolean;
  consent_basis: string;
};

function migrationActor(suffix: string): RegistryActorContext {
  return {
    actorType: "system",
    actorId: ACTOR_ID,
    actorLabel: "Best Relocation Granot confirmation SMS enable",
    actorRole: "owner",
    requestId: `${ACTOR_ID}:${suffix}`,
  };
}

function familyForLabel(normalized: string): TargetFamily | undefined {
  return TARGETS.find((target) => target.labels.includes(normalized));
}

function resolvedNormalizedLabel(row: {
  normalized_granot_label?: unknown;
  granot_label?: unknown;
}): string {
  if (
    typeof row.normalized_granot_label === "string" &&
    row.normalized_granot_label.trim()
  ) {
    return row.normalized_granot_label;
  }
  return normalizeGranotSourceLabel(String(row.granot_label ?? "")) ?? "";
}

function toInventoryRow(
  row: Record<string, unknown>,
  family: TargetFamily,
): InventoryRow {
  const sms = toSmsView(String(row._id), row.outbound_sms);
  const normalized = resolvedNormalizedLabel(row);
  return {
    id: String(row._id),
    family: family.family,
    granot_label: String(row.granot_label ?? ""),
    normalized_granot_label: normalized,
    enabled: row.enabled !== false,
    lead_created_policy: String(row.lead_created_policy ?? ""),
    sms_enabled: sms.enabled,
    consent_basis: sms.consent_basis,
  };
}

function assertReadyToEnable(row: InventoryRow): void {
  if (!row.enabled) {
    throw new Error(`${row.granot_label} is inactive and cannot send texts.`);
  }
  if (row.lead_created_policy !== "create_if_missing") {
    throw new Error(
      `${row.granot_label} is ${row.lead_created_policy}, not create_if_missing.`,
    );
  }
}

async function loadTargets(): Promise<InventoryRow[]> {
  const Source = getGranotCrmSourceModel();
  const rows = await Source.find({})
    .select({
      granot_label: 1,
      normalized_granot_label: 1,
      enabled: 1,
      lead_created_policy: 1,
      outbound_sms: 1,
    })
    .lean()
    .exec();
  const matched: InventoryRow[] = [];
  const seenFamilies = new Set<string>();
  for (const row of rows) {
    const normalized = resolvedNormalizedLabel(row);
    const family = familyForLabel(normalized);
    if (!family) continue;
    if (seenFamilies.has(family.family)) {
      throw new Error(`More than one CRM Source matched ${family.family}.`);
    }
    seenFamilies.add(family.family);
    matched.push(toInventoryRow(row as unknown as Record<string, unknown>, family));
  }
  const missing = TARGETS.filter((target) => !seenFamilies.has(target.family)).map(
    (target) => target.family,
  );
  if (missing.length > 0) {
    throw new Error(`Missing Best Relocation CRM Sources: ${missing.join(", ")}.`);
  }
  return matched;
}

async function main(): Promise<void> {
  const mode = parseGranotLifecycleMigrationMode(process.argv);
  const configuredDatabase = getMongoDatabaseName();
  assertGranotLifecycleDatabaseAllowed(configuredDatabase);
  await connectMongo();
  const inventory = await loadTargets();

  if (mode === "apply") {
    assertGranotLifecycleApplyAuthorized({
      args: process.argv,
      databaseName: configuredDatabase,
    });
    const applied = [];
    for (const row of inventory) {
      assertReadyToEnable(row);
      const family = TARGETS.find((target) => target.family === row.family);
      if (!family) {
        throw new Error(`Unknown family ${row.family}.`);
      }
      const view = await setGranotCrmSourceOutboundSms(
        {
          granot_crm_source_id: row.id,
          enabled: true,
          body_template: DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE,
          consent_basis: family.consent_basis,
          reason: APPLY_REASON,
        },
        migrationActor(row.family),
      );
      applied.push({
        id: row.id,
        family: row.family,
        granot_label: row.granot_label,
        enabled: view.enabled,
        consent_basis: view.consent_basis,
      });
    }
    await writeGranotLifecycleManifest({
      directory: OUTPUT_DIR,
      runId: `best-relocation-sms-${mode}-${Date.now()}`,
      manifest: {
        script_version: SCRIPT_VERSION,
        mode,
        database: configuredDatabase,
        inventory,
        applied,
      },
    });
    console.log(JSON.stringify({ ok: true, mode, database: configuredDatabase, applied }, null, 2));
    return;
  }

  if (mode === "verify") {
    const notEnabled = inventory.filter((row) => !row.sms_enabled);
    if (notEnabled.length > 0) {
      throw new Error(
        `Verify failed: ${notEnabled.map((row) => row.granot_label).join(", ")} still have texting off.`,
      );
    }
    await writeGranotLifecycleManifest({
      directory: OUTPUT_DIR,
      runId: `best-relocation-sms-${mode}-${Date.now()}`,
      manifest: {
        script_version: SCRIPT_VERSION,
        mode,
        database: configuredDatabase,
        inventory,
      },
    });
    console.log(JSON.stringify({ ok: true, mode, database: configuredDatabase, inventory }, null, 2));
    return;
  }

  await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId: `best-relocation-sms-${mode}-${Date.now()}`,
    manifest: {
      script_version: SCRIPT_VERSION,
      mode,
      database: configuredDatabase,
      inventory,
    },
  });
  console.log(JSON.stringify({ ok: true, mode, database: configuredDatabase, inventory }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
