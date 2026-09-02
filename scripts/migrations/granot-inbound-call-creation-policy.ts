/**
 * Owner-authorized inbound Call create_if_missing flip.
 *
 * Verifies each Granot CRM Source references the exact Call Source
 * Granularity on its Lead Source Company, and that RingCentral
 * assignments are 0-or-1 active valid. Writes only through
 * createOrUpdateGranotCrmSource. Does not enable outbound_sms.
 *
 *   pnpm migration:granot-inbound-call-creation-policy -- --report
 *   pnpm migration:granot-inbound-call-creation-policy -- --apply --confirm-production=<db>
 *   pnpm migration:granot-inbound-call-creation-policy -- --verify
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import { getGranotCrmSourceModel } from "../../src/models/GranotCrmSource.js";
import { getLeadSourceCompanyModel } from "../../src/models/LeadSourceCompany.js";
import { getLeadSourceGranularityModel } from "../../src/models/LeadSourceGranularity.js";
import { getRingCentralInboundRouteAssignmentModel } from "../../src/models/RingCentralInboundRouteAssignment.js";
import { getRingCentralInboundRouteModel } from "../../src/models/RingCentralInboundRoute.js";
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
  INBOUND_CALL_CREATION_POLICY_ACTOR_ID,
  INBOUND_CALL_CREATION_POLICY_REASON,
  INBOUND_CALL_CREATION_POLICY_SCRIPT_VERSION,
  INBOUND_CALL_CREATION_TARGETS,
  assertInboundCallCreationReady,
  targetForNormalizedLabel,
  verifyInboundCallCreationTargets,
  type InboundCallCreationAssignmentRow,
  type InboundCallCreationCompanyRow,
  type InboundCallCreationGranularityRow,
  type InboundCallCreationInventory,
  type InboundCallCreationRouteRow,
  type InboundCallCreationSourceRow,
} from "./granot-inbound-call-creation-policy.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory(
  "granot-inbound-call-creation-policy",
);

function migrationActor(suffix: string): RegistryActorContext {
  return {
    actorType: "system",
    actorId: INBOUND_CALL_CREATION_POLICY_ACTOR_ID,
    actorLabel: "Inbound Call create_if_missing Owner flip",
    actorRole: "owner",
    requestId: `${INBOUND_CALL_CREATION_POLICY_ACTOR_ID}:${suffix}`,
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
    const target = targetForNormalizedLabel(normalized);
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

  const [companyRows, granularityRows, assignmentRows] = await Promise.all([
    getLeadSourceCompanyModel()
      .find({ _id: { $in: companyIds } })
      .lean()
      .exec(),
    getLeadSourceGranularityModel()
      .find({ _id: { $in: granularityIds } })
      .lean()
      .exec(),
    getRingCentralInboundRouteAssignmentModel()
      .find({
        source_company: { $in: companyIds },
        source_granularity: { $in: granularityIds },
      })
      .lean()
      .exec(),
  ]);

  const companies: InboundCallCreationCompanyRow[] = companyRows.map((row) => ({
    id: String(row._id),
    company_slug: String(row.company_slug ?? ""),
    active: row.active === true,
  }));
  const granularities: InboundCallCreationGranularityRow[] = granularityRows.map(
    (row) => ({
      id: String(row._id),
      granularity_key: String(row.granularity_key ?? ""),
      source_company_id: String(row.source_company ?? ""),
      channel: String(row.channel ?? ""),
      active: row.active === true,
    }),
  );
  const assignments: InboundCallCreationAssignmentRow[] = assignmentRows.map(
    (row) => ({
      id: String(row._id),
      source_company_id: String(row.source_company ?? ""),
      source_granularity_id: String(row.source_granularity ?? ""),
      route_id: String(row.route ?? ""),
      active: row.active === true,
      effective_from: new Date(row.effective_from),
      effective_until: row.effective_until ? new Date(row.effective_until) : null,
    }),
  );
  const routeIds = [...new Set(assignments.map((row) => row.route_id))];
  const routeRows = routeIds.length
    ? await getRingCentralInboundRouteModel()
        .find({ _id: { $in: routeIds } })
        .lean()
        .exec()
    : [];
  const routes: InboundCallCreationRouteRow[] = routeRows.map((row) => ({
    id: String(row._id),
    active: row.active === true,
    validation_status: String(row.validation_status ?? ""),
  }));

  return {
    sources,
    companies,
    granularities,
    assignments,
    routes,
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
  const findings = verifyInboundCallCreationTargets(inventory);
  assertInboundCallCreationReady(findings);

  if (mode === "apply") {
    assertGranotLifecycleApplyAuthorized({
      args: process.argv,
      databaseName,
    });
    const applied = [];
    for (const finding of findings) {
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
          lead_created_policy: "create_if_missing",
          lead_source_company: source.lead_source_company ?? null,
          lifecycle_routes: source.lifecycle_routes.map((route) => ({
            route_key: route.route_key,
            lead_model: route.lead_model as "FormLead" | "CallLead",
            move_type: route.move_type as "local" | "long_distance" | "any",
            source_granularity_id: route.source_granularity_id,
          })),
          lifecycle_policy_version: source.lifecycle_policy_version,
          reason: INBOUND_CALL_CREATION_POLICY_REASON,
        },
        migrationActor(finding.family),
      );
      if (updated.outbound_sms?.enabled === true) {
        throw new Error(
          `${source.granot_label} unexpectedly has outbound_sms enabled after the policy flip.`,
        );
      }
      applied.push({
        id: updated.id,
        family: finding.family,
        granot_label: updated.granot_label,
        lead_created_policy: updated.lead_created_policy,
        lead_source_company: updated.lead_source_company,
        granularity_id: updated.lifecycle_routes[0]?.source_granularity_id,
        outbound_sms_enabled: updated.outbound_sms?.enabled === true,
      });
    }
    await writeGranotLifecycleManifest({
      directory: OUTPUT_DIR,
      runId: `inbound-call-creation-${mode}-${Date.now()}`,
      manifest: {
        script_version: INBOUND_CALL_CREATION_POLICY_SCRIPT_VERSION,
        mode,
        database: databaseName,
        targets: INBOUND_CALL_CREATION_TARGETS.map((target) => ({
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
    const notFlipped = findings.filter(
      (finding) => finding.current_policy !== "create_if_missing",
    );
    if (notFlipped.length > 0) {
      throw new Error(
        `Verify failed: ${notFlipped
          .map((finding) => finding.granot_label)
          .join(", ")} still ${notFlipped
          .map((finding) => finding.current_policy)
          .join("/")}.`,
      );
    }
    const smsOn = findings.filter((finding) => finding.outbound_sms_enabled);
    if (smsOn.length > 0) {
      throw new Error(
        `Verify failed: ${smsOn.map((finding) => finding.granot_label).join(", ")} have outbound_sms enabled.`,
      );
    }
    await writeGranotLifecycleManifest({
      directory: OUTPUT_DIR,
      runId: `inbound-call-creation-${mode}-${Date.now()}`,
      manifest: {
        script_version: INBOUND_CALL_CREATION_POLICY_SCRIPT_VERSION,
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
    runId: `inbound-call-creation-${mode}-${Date.now()}`,
    manifest: {
      script_version: INBOUND_CALL_CREATION_POLICY_SCRIPT_VERSION,
      mode,
      database: databaseName,
      findings,
    },
  });
  console.log(
    JSON.stringify({ ok: true, mode, database: databaseName, findings }, null, 2),
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
