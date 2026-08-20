/**
 * 34.2 — Granot source Registry classification and automation reference migration.
 *
 * Dry-run / --report by default. Mutation requires
 * --apply --confirm-production=<database-name>.
 *
 *   pnpm migration:granot-lifecycle:sources -- --report
 *   pnpm migration:granot-lifecycle:sources -- --apply --confirm-production=testvantagemovers
 *   pnpm migration:granot-lifecycle:sources -- --verify
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import { GranotAutomationSource } from "../../src/models/GranotAutomationSource.js";
import { getGranotCrmSourceModel } from "../../src/models/GranotCrmSource.js";
import { getLeadSourceCompanyModel } from "../../src/models/LeadSourceCompany.js";
import { getLeadSourceGranularityModel } from "../../src/models/LeadSourceGranularity.js";
import { OperationsRegistryChange } from "../../src/models/OperationsRegistryChange.js";
import { normalizeGranotSourceLabel } from "../../src/services/granotLifecycle/sourceLabel.js";
import {
  createOrUpdateGranotCrmSource,
  type GranotCrmSourceRecord,
} from "../../src/services/operationsRegistry/granotCrmSources.js";
import { setGranotAutomationSourceReference } from "../../src/services/operationsRegistry/granotAutomationSources.js";
import type { RegistryActorContext } from "../../src/services/operationsRegistry/types.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  GRANOT_LIFECYCLE_PRODUCTION_DATABASE,
  granotLifecycleOutputDirectory,
  parseGranotLifecycleMigrationMode,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";
import {
  SOURCE_REGISTRY_MIGRATION_ACTOR_ID,
  SOURCE_REGISTRY_MIGRATION_SCRIPT_VERSION,
  assertPlanHasNoForbiddenPayload,
  migrationReasonForScope,
  planGranotLifecycleSourceRegistry,
  readSourceRegistryApplyScope,
  selectAutomationMutationsForApply,
  selectCrmMutationsForApply,
  type InventoryAutomationSource,
  type InventoryCompany,
  type InventoryCrmSource,
  type InventoryGranularity,
  type SourceRegistryPlan,
  type SourceRegistryApplyScope,
} from "./granot-lifecycle-source-registry.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("granot-lifecycle-source-registry");

async function loadInventory() {
  const [crmRows, automationRows, companyRows, granularityRows] = await Promise.all([
    getGranotCrmSourceModel().find({}).lean().exec(),
    GranotAutomationSource.find({}).lean().exec(),
    getLeadSourceCompanyModel().find({}).lean().exec(),
    getLeadSourceGranularityModel().find({}).lean().exec(),
  ]);
  return {
    crm_sources: crmRows.map((row) =>
      toCrmInventory(row as unknown as Record<string, unknown>),
    ),
    automation_sources: automationRows.map((row) =>
      toAutomationInventory(row as unknown as Record<string, unknown>),
    ),
    companies: companyRows.map((row) =>
      toCompanyInventory(row as unknown as Record<string, unknown>),
    ),
    granularities: granularityRows.map((row) =>
      toGranularityInventory(row as unknown as Record<string, unknown>),
    ),
  };
}

async function main(): Promise<void> {
  const mode = parseGranotLifecycleMigrationMode(process.argv);
  const applyScope = readSourceRegistryApplyScope(process.argv);
  const configuredDatabase = getMongoDatabaseName();
  assertGranotLifecycleDatabaseAllowed(configuredDatabase);
  if (mode === "apply") assertGranotLifecycleApplyAuthorized({ args: process.argv, databaseName: configuredDatabase });
  await connectMongo();
  const databaseName = mongoose.connection.db?.databaseName;
  assertGranotLifecycleDatabaseAllowed(databaseName);
  if (databaseName !== configuredDatabase) throw new Error("Connected database does not match migration preflight database.");
  if (mode === "apply") {
    assertGranotLifecycleApplyAuthorized({
      args: process.argv,
      databaseName,
    });
  }

  const inventory = await loadInventory();
  const plan = planGranotLifecycleSourceRegistry(inventory);
  assertPlanHasNoForbiddenPayload(plan);

  const changed_crm_ids: string[] = [];
  const changed_automation_ids: string[] = [];
  const apply_errors: string[] = [];

  if (mode === "apply") {
    if (!plan.required_dependencies_ok || plan.refused_families.length > 0) {
      await writeRunManifest({
        databaseName,
        mode,
        applyScope,
        plan,
        changed_crm_ids,
        changed_automation_ids,
        apply_errors: [
          "Refusing reviewed classification apply because a required dependency or family is invalid.",
        ],
        verify: undefined,
      });
        throw new Error(
        "Refusing source Registry apply: required reviewed dependencies are invalid or a reviewed family was refused.",
      );
    }
    const applyReason = migrationReasonForScope(applyScope);
    const crmMutations = selectCrmMutationsForApply(plan, applyScope);
    for (const mutation of crmMutations) {
      if (mutation.action === "noop") continue;
      try {
        const current = inventory.crm_sources.find((row) => row.id === mutation.id);
        if (!current) continue;
        await createOrUpdateGranotCrmSource(
          {
            id: mutation.id,
            crm_origin: current.crm_origin,
            workspace_slug: current.workspace_slug,
            granot_label: current.granot_label,
            default_channel: mutation.intended.default_channel,
            source_company: current.source_company,
            enabled: current.enabled,
            lifecycle_enabled: mutation.intended.lifecycle_enabled,
            lifecycle_disposition: mutation.intended.lifecycle_disposition,
            lead_created_policy: mutation.intended.lead_created_policy,
            lead_source_company: mutation.intended.lead_source_company ?? null,
            lifecycle_routes: mutation.intended.lifecycle_routes,
            lifecycle_policy_version: mutation.intended.lifecycle_policy_version,
            reason: applyReason,
          },
          migrationActor(`crm:${mutation.id}:${mutation.action}`),
        );
        changed_crm_ids.push(mutation.id);
      } catch {
        apply_errors.push(`crm:${mutation.masked_id}:mutation_failed`);
      }
    }
    for (const mutation of selectAutomationMutationsForApply(plan, applyScope)) {
      if (mutation.action !== "link" || !mutation.intended_reference) continue;
      try {
        await setGranotAutomationSourceReference(
          {
            id: mutation.id,
            granot_crm_source: mutation.intended_reference,
            reason: applyReason,
          },
          migrationActor(`automation:${mutation.id}:link`),
        );
        changed_automation_ids.push(mutation.id);
      } catch {
        apply_errors.push(`automation:${mutation.masked_id}:mutation_failed`);
      }
    }
    if (apply_errors.length > 0) {
      await writeRunManifest({
        databaseName,
        mode,
        applyScope,
        plan,
        changed_crm_ids,
        changed_automation_ids,
        apply_errors,
        verify: undefined,
      });
      throw new Error(
        `Source Registry apply failed for ${apply_errors.length} item(s). Group is not verified.`,
      );
    }
  }

  let verify: ReturnType<typeof verifyPersistedPlan> | undefined;
  if (mode === "verify") {
    const reloaded = planGranotLifecycleSourceRegistry(await loadInventory());
    verify = verifyPersistedPlan(reloaded);
    if (!verify.ok) {
      await writeRunManifest({
        databaseName,
        mode,
        applyScope,
        plan: reloaded,
        changed_crm_ids,
        changed_automation_ids,
        apply_errors,
        verify,
      });
      throw new Error(
        `Source Registry verify failed: ${verify.failures.join("; ")}`,
      );
    }
  }

  await writeRunManifest({
    databaseName,
    mode,
    applyScope,
    plan: mode === "verify" ? planGranotLifecycleSourceRegistry(await loadInventory()) : plan,
    changed_crm_ids,
    changed_automation_ids,
    apply_errors,
    verify,
  });
}

function verifyPersistedPlan(plan: SourceRegistryPlan): {
  ok: boolean;
  failures: string[];
  classified_count: number;
  deferred_count: number;
  linked_automation_count: number;
} {
  const failures: string[] = [];
  if (!plan.required_dependencies_ok) {
    failures.push("required_dependencies_invalid");
  }
  if (plan.refused_families.length > 0) {
    failures.push(`refused_families:${plan.refused_families.join(",")}`);
  }
  if (!plan.unique_index_ready) {
    failures.push("normalized_label_collisions");
  }
  const pendingCrm = plan.crm_mutations.filter(
    (mutation) => mutation.action === "classify" || mutation.refused,
  );
  if (pendingCrm.length > 0) {
    failures.push(`crm_drift:${pendingCrm.length}`);
  }
  const pendingAutomation = plan.automation_mutations.filter(
    (mutation) => mutation.action === "link",
  );
  if (pendingAutomation.length > 0) {
    failures.push(`automation_drift:${pendingAutomation.length}`);
  }
  return {
    ok: failures.length === 0,
    failures,
    classified_count: plan.crm_mutations.filter((mutation) => mutation.family && !mutation.refused).length,
    deferred_count: plan.crm_mutations.filter((mutation) => !mutation.family || mutation.refused).length,
    linked_automation_count: plan.automation_mutations.filter(
      (mutation) => mutation.action === "noop" && mutation.intended_reference,
    ).length,
  };
}

async function writeRunManifest(input: {
  databaseName: string;
  mode: string;
  applyScope: SourceRegistryApplyScope;
  plan: SourceRegistryPlan;
  changed_crm_ids: string[];
  changed_automation_ids: string[];
  apply_errors: string[];
  verify?: ReturnType<typeof verifyPersistedPlan>;
}): Promise<void> {
  const audits = input.changed_crm_ids.length
    ? await OperationsRegistryChange.countDocuments({
        entity_type: "granot_crm_source",
        entity_id: { $in: input.changed_crm_ids },
      })
    : 0;
  await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId: `granot-lifecycle-source-registry-${input.mode}-${Date.now()}`,
    manifest: {
      script_version: SOURCE_REGISTRY_MIGRATION_SCRIPT_VERSION,
      database_name: input.databaseName,
      mode: input.mode,
      apply_scope: input.applyScope,
      production_apply:
        input.mode === "apply" &&
        input.databaseName === GRANOT_LIFECYCLE_PRODUCTION_DATABASE,
      reviewed_labels: input.plan.reviewed_labels,
      excluded_provider_types: input.plan.excluded_provider_types,
      required_registry_keys: input.plan.required_registry_keys,
      dependency_findings: input.plan.dependency_findings,
      required_dependencies_ok: input.plan.required_dependencies_ok,
      normalized_label_collisions: input.plan.normalized_label_collisions,
      unknown_labels: input.plan.unknown_labels,
      refused_families: input.plan.refused_families,
      unique_index_ready: input.plan.unique_index_ready,
      crm_mutations: input.plan.crm_mutations,
      automation_mutations: input.plan.automation_mutations,
      rollback: {
        changed_crm_ids: input.changed_crm_ids,
        changed_automation_ids: input.changed_automation_ids,
      },
      apply_errors: input.apply_errors,
      audit_count: audits,
      verify: input.verify,
    },
  });
}

function migrationActor(suffix: string): RegistryActorContext {
  return {
    actorType: "system",
    actorId: SOURCE_REGISTRY_MIGRATION_ACTOR_ID,
    actorLabel: "Granot lifecycle source registry migration",
    actorRole: "owner",
    requestId: `${SOURCE_REGISTRY_MIGRATION_ACTOR_ID}:${suffix}`,
  };
}

function toCrmInventory(row: Record<string, unknown>): InventoryCrmSource {
  const record = row as GranotCrmSourceRecord & { _id?: unknown };
  return {
    id: String(row._id ?? record.id),
    granot_label: String(row.granot_label ?? ""),
    normalized_granot_label:
      typeof row.normalized_granot_label === "string"
        ? row.normalized_granot_label
        : normalizeGranotSourceLabel(String(row.granot_label ?? "")),
    enabled: row.enabled !== false,
    lifecycle_enabled: row.lifecycle_enabled === true,
    lifecycle_disposition:
      (row.lifecycle_disposition as InventoryCrmSource["lifecycle_disposition"]) ??
      "deferred",
    lead_created_policy:
      (row.lead_created_policy as InventoryCrmSource["lead_created_policy"]) ??
      "observation_only",
    lead_source_company: row.lead_source_company
      ? String(row.lead_source_company)
      : undefined,
    lifecycle_routes: Array.isArray(row.lifecycle_routes)
      ? row.lifecycle_routes.map((route) => {
          const item = (route ?? {}) as Record<string, unknown>;
          return {
            route_key: String(item.route_key ?? ""),
            lead_model: item.lead_model as InventoryCrmSource["lifecycle_routes"][number]["lead_model"],
            move_type: item.move_type as InventoryCrmSource["lifecycle_routes"][number]["move_type"],
            source_granularity_id: String(item.source_granularity_id ?? ""),
          };
        })
      : [],
    lifecycle_policy_version: String(row.lifecycle_policy_version ?? ""),
    crm_origin: String(row.crm_origin ?? ""),
    workspace_slug: String(row.workspace_slug ?? ""),
    default_channel:
      (row.default_channel as InventoryCrmSource["default_channel"]) ?? "unknown",
    source_company: String(row.source_company ?? "not_provided"),
  };
}

function toAutomationInventory(row: Record<string, unknown>): InventoryAutomationSource {
  return {
    id: String(row._id),
    label: String(row.label ?? ""),
    active: row.active !== false,
    supported_operations: Array.isArray(row.supported_operations)
      ? row.supported_operations.filter(
          (value): value is "form_leads" | "call_leads" =>
            value === "form_leads" || value === "call_leads",
        )
      : [],
    ...(row.granot_crm_source ? { granot_crm_source: String(row.granot_crm_source) } : {}),
  };
}

function toCompanyInventory(row: Record<string, unknown>): InventoryCompany {
  return {
    id: String(row._id),
    company_slug: String(row.company_slug ?? ""),
    owner_label: String(row.owner_label ?? row.name ?? ""),
    active: row.active === true,
  };
}

function toGranularityInventory(row: Record<string, unknown>): InventoryGranularity {
  return {
    id: String(row._id),
    granularity_key: String(row.granularity_key ?? ""),
    owner_label: String(row.owner_label ?? ""),
    source_company_id: String(row.source_company ?? ""),
    channel: row.channel === "call" ? "call" : "form",
    ...(row.local === "local" || row.local === "long_distance"
      ? { local: row.local }
      : {}),
    active: row.active === true,
  };
}

main()
  .catch(() => {
    console.error("Granot lifecycle source migration failed with a bounded technical error.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
