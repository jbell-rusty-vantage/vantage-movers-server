/**
 * Owner-authorized inbound Granot CRM Source create_if_missing revert.
 *
 * Takes create_if_missing off Main Site, 10best, TBM Prime, and Top10
 * Inbounds. Best Relocation Forms and Inbounds keep create_if_missing.
 * Writes only through createOrUpdateGranotCrmSource.
 *
 *   pnpm migration:granot-inbound-call-creation-policy-revert -- --report
 *   pnpm migration:granot-inbound-call-creation-policy-revert -- --apply --confirm-production=<db>
 *   pnpm migration:granot-inbound-call-creation-policy-revert -- --verify
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import { getGranotCrmSourceModel } from "../../src/models/GranotCrmSource.js";
import { getLeadSourceCompanyModel } from "../../src/models/LeadSourceCompany.js";
import { getLeadSourceGranularityModel } from "../../src/models/LeadSourceGranularity.js";
import { normalizeGranotSourceLabel } from "../../src/services/granotLifecycle/sourceLabel.js";
import { createOrUpdateGranotCrmSource } from "../../src/services/operationsRegistry/granotCrmSources.js";
import { toSmsView } from "../../src/services/operationsRegistry/crmSourceOutboundSms.js";
import type { RegistryActorContext } from "../../src/services/operationsRegistry/types.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
  parseGranotLifecycleMigrationMode,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";
import {
  INBOUND_CALL_CREATION_REVERT_ACTOR_ID,
  INBOUND_CALL_CREATION_REVERT_REASON,
  INBOUND_CALL_CREATION_REVERT_SCRIPT_VERSION,
  INBOUND_CALL_CREATION_REVERT_TARGETS,
  assertInboundCallCreationRevertReady,
  revertTargetForNormalizedLabel,
  sourcesNeedingRevert,
  verifyInboundCallCreationRevertTargets,
  type InboundCallCreationInventory,
  type InboundCallCreationSourceRow,
} from "./granot-inbound-call-creation-policy-revert.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory(
  "granot-inbound-call-creation-policy-revert",
);

function migrationActor(suffix: string): RegistryActorContext {
  return {
    actorType: "system",
    actorId: INBOUND_CALL_CREATION_REVERT_ACTOR_ID,
    actorLabel: "Inbound Call create_if_missing Owner revert",
    actorRole: "owner",
    requestId: `${INBOUND_CALL_CREATION_REVERT_ACTOR_ID}:${suffix}`,
  };
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

function toSourceRow(row: Record<string, unknown>): InboundCallCreationSourceRow {
  const sms = toSmsView(String(row._id), row.outbound_sms);
  const routes = Array.isArray(row.lifecycle_routes) ? row.lifecycle_routes : [];
  return {
    id: String(row._id),
    granot_label: String(row.granot_label ?? ""),
    normalized_granot_label: resolvedNormalizedLabel(row),
    crm_origin: String(row.crm_origin ?? ""),
    workspace_slug: String(row.workspace_slug ?? ""),
    default_channel:
      row.default_channel === "form" || row.default_channel === "call"
        ? row.default_channel
        : "unknown",
    source_company: String(row.source_company ?? ""),
    enabled: row.enabled !== false,
    lifecycle_enabled: row.lifecycle_enabled === true,
    lifecycle_disposition: String(row.lifecycle_disposition ?? ""),
    lead_created_policy: String(row.lead_created_policy ?? ""),
    lead_source_company: row.lead_source_company
      ? String(row.lead_source_company)
      : undefined,
    lifecycle_routes: routes.map((route) => {
      const value = route as Record<string, unknown>;
      return {
        route_key: String(value.route_key ?? ""),
        lead_model: String(value.lead_model ?? ""),
        move_type: String(value.move_type ?? ""),
        source_granularity_id: String(value.source_granularity_id ?? ""),
      };
    }),
    lifecycle_policy_version: String(row.lifecycle_policy_version ?? ""),
    outbound_sms_enabled: sms.enabled,
  };
}

async function loadInventory(): Promise<InboundCallCreationInventory> {
  const Source = getGranotCrmSourceModel();
  const crmRows = await Source.find({}).lean().exec();
  const sources: InboundCallCreationSourceRow[] = [];
  const seenFamilies = new Set<string>();
  for (const row of crmRows) {
    const normalized = resolvedNormalizedLabel(row);
    const target = revertTargetForNormalizedLabel(normalized);
    if (!target) continue;
    if (seenFamilies.has(target.family)) {
      throw new Error(`More than one CRM Source matched ${target.family}.`);
    }
    seenFamilies.add(target.family);
    sources.push(toSourceRow(row as unknown as Record<string, unknown>));
  }

  const companyIds = [
    ...new Set(sources.map((source) => source.lead_source_company).filter(Boolean)),
  ] as string[];
  const granularityIds = [
    ...new Set(
      sources.flatMap((source) =>
        source.lifecycle_routes.map((route) => route.source_granularity_id),
      ),
    ),
  ];

  const [companyRows, granularityRows] = await Promise.all([
    getLeadSourceCompanyModel()
      .find({ _id: { $in: companyIds } })
      .lean()
      .exec(),
    getLeadSourceGranularityModel()
      .find({ _id: { $in: granularityIds } })
      .lean()
      .exec(),
  ]);

  return {
    sources,
    companies: companyRows.map((row) => ({
      id: String(row._id),
      company_slug: String(row.company_slug ?? ""),
      active: row.active === true,
    })),
    granularities: granularityRows.map((row) => ({
      id: String(row._id),
      granularity_key: String(row.granularity_key ?? ""),
      source_company_id: String(row.source_company ?? ""),
      channel: String(row.channel ?? ""),
      active: row.active === true,
    })),
    assignments: [],
    routes: [],
    now: new Date(),
  };
}

async function main(): Promise<void> {
  const mode = parseGranotLifecycleMigrationMode(process.argv);
  const configuredDatabase = getMongoDatabaseName();
  assertGranotLifecycleDatabaseAllowed(configuredDatabase);
  await connectMongo();
  const databaseName = mongoose.connection.db?.databaseName;
  assertGranotLifecycleDatabaseAllowed(databaseName);
  if (databaseName !== configuredDatabase) {
    throw new Error("Connected database does not match migration preflight database.");
  }

  const inventory = await loadInventory();
  const findings = verifyInboundCallCreationRevertTargets(inventory);
  assertInboundCallCreationRevertReady(findings);
  const pending = sourcesNeedingRevert(findings);

  if (mode === "apply") {
    assertGranotLifecycleApplyAuthorized({
      args: process.argv,
      databaseName,
    });
    const applied = [];
    for (const finding of pending) {
      const source = inventory.sources.find((row) => row.id === finding.source_id);
      if (!source) {
        throw new Error(`Missing loaded source for ${finding.granot_label}.`);
      }
      const updated = await createOrUpdateGranotCrmSource(
        {
          id: source.id,
          crm_origin: source.crm_origin,
          workspace_slug: source.workspace_slug,
          granot_label: source.granot_label,
          default_channel: source.default_channel,
          source_company: source.source_company,
          enabled: source.enabled,
          lifecycle_enabled: source.lifecycle_enabled,
          lifecycle_disposition: source.lifecycle_disposition as
            | "source_scoped_lead"
            | "referral_booking"
            | "deferred",
          lead_created_policy: "link_only",
          lead_source_company: source.lead_source_company ?? null,
          lifecycle_routes: source.lifecycle_routes.map((route) => ({
            route_key: route.route_key,
            lead_model: route.lead_model as "FormLead" | "CallLead",
            move_type: route.move_type as "local" | "long_distance" | "any",
            source_granularity_id: route.source_granularity_id,
          })),
          lifecycle_policy_version: source.lifecycle_policy_version,
          reason: INBOUND_CALL_CREATION_REVERT_REASON,
        },
        migrationActor(finding.family),
      );
      applied.push({
        id: updated.id,
        family: finding.family,
        granot_label: updated.granot_label,
        lead_created_policy: updated.lead_created_policy,
        outbound_sms_enabled: updated.outbound_sms?.enabled === true,
        sms_deactivated: finding.would_deactivate_sms,
      });
    }
    await writeGranotLifecycleManifest({
      directory: OUTPUT_DIR,
      runId: `inbound-call-creation-revert-${mode}-${Date.now()}`,
      manifest: {
        script_version: INBOUND_CALL_CREATION_REVERT_SCRIPT_VERSION,
        mode,
        database: databaseName,
        targets: INBOUND_CALL_CREATION_REVERT_TARGETS.map((target) => ({
          family: target.family,
          granot_label: target.granot_label,
          company_slug: target.company_slug,
          granularity_key: target.granularity_key,
        })),
        findings,
        applied,
      },
    });
    console.log(
      JSON.stringify(
        { ok: true, mode, database: databaseName, applied, findings },
        null,
        2,
      ),
    );
    return;
  }

  if (mode === "verify") {
    if (pending.length > 0) {
      throw new Error(
        `Verify failed: ${pending
          .map((finding) => `${finding.granot_label} still ${finding.current_policy}`)
          .join(", ")}.`,
      );
    }
    const smsOn = findings.filter((finding) => finding.outbound_sms_enabled);
    if (smsOn.length > 0) {
      throw new Error(
        `Verify failed: ${smsOn
          .map((finding) => finding.granot_label)
          .join(", ")} still have outbound_sms enabled after leaving create_if_missing.`,
      );
    }
    await writeGranotLifecycleManifest({
      directory: OUTPUT_DIR,
      runId: `inbound-call-creation-revert-${mode}-${Date.now()}`,
      manifest: {
        script_version: INBOUND_CALL_CREATION_REVERT_SCRIPT_VERSION,
        mode,
        database: databaseName,
        findings,
      },
    });
    console.log(
      JSON.stringify({ ok: true, mode, database: databaseName, findings }, null, 2),
    );
    return;
  }

  await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId: `inbound-call-creation-revert-${mode}-${Date.now()}`,
    manifest: {
      script_version: INBOUND_CALL_CREATION_REVERT_SCRIPT_VERSION,
      mode,
      database: databaseName,
      findings,
      pending,
    },
  });
  console.log(
    JSON.stringify(
      { ok: true, mode, database: databaseName, pending, findings },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
