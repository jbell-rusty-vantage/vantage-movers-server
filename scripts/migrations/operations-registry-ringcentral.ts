/**
 * M5 — RingCentral route backfill and validation gate.
 *
 * Dry run (no writes, no RingCentral calls):
 *   pnpm migrations:operations-registry-ringcentral
 *
 * Production apply requires all standard safeguards and performs live account
 * validation:
 *   pnpm migrations:operations-registry-ringcentral -- --apply --production-apply --confirm-production-db=vantagemovers
 */
import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db.js";
import { isTestMode } from "../../src/config/domain.js";
import { getLeadSourceCompanyModel } from "../../src/models/LeadSourceCompany.js";
import { getLeadSourceGranularityModel } from "../../src/models/LeadSourceGranularity.js";
import { getRingCentralInboundRouteModel } from "../../src/models/RingCentralInboundRoute.js";
import { getRingCentralInboundRouteAssignmentModel } from "../../src/models/RingCentralInboundRouteAssignment.js";
import { getCallLeadModel } from "../../src/models/CallLead.js";
import {
  activateRingCentralRoute,
  createOrUpdateRingCentralRoute,
  deactivateRingCentralRoute,
  getRingCentralInboundRoute,
  validateRingCentralRoute,
  type RegistryActorContext,
} from "../../src/services/operationsRegistry/index.js";
import {
  createRingCentralAccountRouteValidator,
  type RingCentralRouteValidationResult,
} from "../../src/services/operationsRegistry/ringCentralValidation.js";
import { RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE } from "../../src/services/ringcentral/call-lead-sources.js";
import {
  assertMigrationApplyAuthorized,
  isMigrationApplyRequested,
} from "../../src/services/employeeBookings/migrationApplySafety.js";
import {
  assertMigrationDatabaseAllowed,
  assertReviewedDryRunManifest,
} from "./operations-registry-migration.lib.js";
import {
  buildRingCentralBackfillPlan,
  RINGCENTRAL_BACKFILL_SCRIPT_VERSION,
  type RingCentralBackfillSnapshot,
} from "./operations-registry-ringcentral.lib.js";

const OUTPUT_DIR = path.join(
  process.cwd(),
  "scripts",
  "output",
  "operations-registry-ringcentral",
);

async function loadSnapshot(): Promise<RingCentralBackfillSnapshot> {
  const [companies, granularities, routes, assignments] = await Promise.all([
    getLeadSourceCompanyModel().find({}).lean().exec(),
    getLeadSourceGranularityModel().find({}).lean().exec(),
    getRingCentralInboundRouteModel().find({}).lean().exec(),
    getRingCentralInboundRouteAssignmentModel().find({}).lean().exec(),
  ]);
  return {
    static_mappings: Object.entries(RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE).map(
      ([phone_number, source]) => ({
        phone_number,
        source_company: source.sourceCompany,
        source_label: source.sourceLabel,
      }),
    ),
    companies: companies.map((company) => ({
      id: String(company._id),
      company_slug: company.company_slug,
      active: company.active,
      default_call_granularity: company.default_call_granularity
        ? String(company.default_call_granularity)
        : null,
      embedded_call_numbers: (company.granularities ?? [])
        .filter((granularity) => granularity.channel === "call")
        .map((granularity) => ({
          granularity_key: granularity.granularity_key,
          phone_numbers: [...(granularity.inbound_phone_numbers ?? [])],
        })),
    })),
    granularities: granularities.map((granularity) => ({
      id: String(granularity._id),
      source_company: String(granularity.source_company),
      granularity_key: granularity.granularity_key,
      channel: granularity.channel,
      crm_label: granularity.crm_label,
      active: granularity.active,
    })),
    routes: routes.map((route) => ({
      id: String(route._id),
      phone_number: route.phone_number,
      active: route.active,
      validation_status: route.validation_status,
    })),
    assignments: assignments.map((assignment) => ({
      id: String(assignment._id),
      route: String(assignment.route),
      source_granularity: String(assignment.source_granularity),
      effective_until: assignment.effective_until ?? null,
    })),
  };
}

async function applyPlan(
  plan: ReturnType<typeof buildRingCentralBackfillPlan>,
  runId: string,
) {
  let creates = 0;
  let updates = 0;
  let noOps = 0;
  let failures = 0;
  const applyErrors: string[] = [];
  const activatedRoutes: Array<{ id: string; phone_number: string }> = [];
  const validateAgainstAccount = createRingCentralAccountRouteValidator();
  const preflight = await Promise.all(
    plan.mappings.map(async (mapping) => ({
      phone_number: mapping.phone_number,
      result: await validateAgainstAccount(mapping.phone_number),
    })),
  );
  const validations: Array<{
    phone_number: string;
    status: string;
    code?: string;
  }> = preflight.map(({ phone_number, result }) => ({
    phone_number,
    status: result.status,
    code: result.code,
  }));
  const failedPreflight = preflight.filter(({ result }) => result.status !== "valid");
  if (failedPreflight.length > 0) {
    return {
      applied: {
        creates,
        updates,
        no_ops: noOps,
        failures: failedPreflight.length,
      },
      validations,
      apply_errors: applyErrors,
    };
  }
  const validationByPhone = new Map(
    preflight.map(({ phone_number, result }) => [phone_number, result]),
  );
  try {
    await ensureRingCentralRolloutIndexes();
    for (const item of plan.routes) {
      const mapping = plan.mappings.find(
        (candidate) => candidate.phone_number === item.phone_number,
      )!;
      let routeId = item.route_id;
      if (!routeId) {
        const created = await createOrUpdateRingCentralRoute(
          {
            phone_number: item.phone_number,
            display_label: mapping.source_label,
            created_from: "operations_registry_ringcentral_m5",
          },
          migrationActor(runId, item.phone_number, "create"),
        );
        routeId = created.id;
        creates += 1;
      } else if (item.action === "update") {
        await createOrUpdateRingCentralRoute(
          { id: routeId, display_label: mapping.source_label },
          migrationActor(runId, item.phone_number, "update"),
        );
        updates += 1;
      } else {
        noOps += 1;
      }

      const validated = await validateRingCentralRoute(
        { id: routeId },
        migrationActor(runId, item.phone_number, "validate"),
        async () =>
          validationByPhone.get(item.phone_number) as RingCentralRouteValidationResult,
      );
      if (validated.validation_status !== "valid") {
        throw new Error(
          `Staged route ${item.phone_number} no longer has valid provider validation.`,
        );
      }

      const current = await getRingCentralInboundRoute(routeId);
      if (
        current.active &&
        current.current_assignment?.source_granularity_id ===
          item.source_granularity_id
      ) {
        noOps += 1;
        continue;
      }
      await activateRingCentralRoute(
        {
          id: routeId,
          source_granularity_id: item.source_granularity_id,
          reason: "M5 initial RingCentral registry assignment",
        },
        migrationActor(runId, item.phone_number, "activate"),
      );
      activatedRoutes.push({ id: routeId, phone_number: item.phone_number });
      updates += 1;
    }
  } catch (error) {
    failures += 1;
    applyErrors.push(error instanceof Error ? error.message : String(error));
    for (const route of activatedRoutes.reverse()) {
      try {
        await deactivateRingCentralRoute(
          {
            id: route.id,
            reason: "M5 rollback after a later route failed",
          },
          migrationActor(runId, route.phone_number, "rollback"),
        );
      } catch (rollbackError) {
        failures += 1;
        applyErrors.push(
          `Rollback failed for ${route.phone_number}: ${
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError)
          }`,
        );
      }
    }
  }
  return {
    applied: { creates, updates, no_ops: noOps, failures },
    validations,
    apply_errors: applyErrors,
  };
}

async function ensureRingCentralRolloutIndexes(): Promise<void> {
  await getRingCentralInboundRouteModel().createIndexes();
  await getRingCentralInboundRouteAssignmentModel().createIndexes();
  const collection = getCallLeadModel().collection;
  await Promise.all([
    collection.createIndex({ "ringcentral.route_id": 1 }),
    collection.createIndex({ "ringcentral.route_assignment_id": 1 }),
    collection.createIndex({ "ringcentral.target_phone_number": 1 }),
  ]);
}

function migrationActor(
  runId: string,
  phone: string,
  action: string,
): RegistryActorContext {
  return {
    actorType: "system",
    actorId: "operations-registry-m5",
    actorLabel: "Operations Registry M5 migration",
    actorRole: "owner",
    requestId: `${runId}:${phone}:${action}`,
  };
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const apply = isMigrationApplyRequested(process.argv);
  await connectMongo();
  try {
    const databaseName = mongoose.connection.db?.databaseName;
    assertMigrationDatabaseAllowed(databaseName, process.argv);
    if (apply) {
      assertMigrationApplyAuthorized({
        args: process.argv,
        testMode: isTestMode(),
        selectedDatabase: databaseName,
      });
    }

    const snapshot = await loadSnapshot();
    const plan = buildRingCentralBackfillPlan(snapshot);
    const runId = `operations-registry-ringcentral-${Date.now()}`;
    if (apply) {
      await assertReviewedDryRunManifest({
        args: process.argv,
        databaseName,
        scriptVersion: RINGCENTRAL_BACKFILL_SCRIPT_VERSION,
        mappingChecksum: plan.mapping_checksum,
      });
    }
    const result = apply
      ? plan.conflicts.length > 0
        ? {
            applied: {
              creates: 0,
              updates: 0,
              no_ops: 0,
              failures: plan.conflicts.length,
            },
            validations: [],
            apply_errors: [
              "Refused RingCentral M5 apply while blocking mapping conflicts remain.",
            ],
          }
        : await applyPlan(plan, runId)
      : {
          applied: { creates: 0, updates: 0, no_ops: 0, failures: 0 },
          validations: [],
          apply_errors: [],
        };
    const validationFailures = result.validations.filter(
      (validation) => validation.status !== "valid",
    );
    const conflictsByCode = Object.fromEntries(
      [...new Set(plan.conflicts.map((conflict) => conflict.code))]
        .sort()
        .map((code) => [
          code,
          plan.conflicts.filter((conflict) => conflict.code === code).length,
        ]),
    );
    const manifest = {
      run_id: runId,
      script_version: RINGCENTRAL_BACKFILL_SCRIPT_VERSION,
      git_sha: gitSha(),
      database_name: databaseName,
      mode: apply ? "apply" : "dry_run",
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      operator: process.env.USERNAME ?? process.env.USER,
      source_counts: {
        static_mappings: snapshot.static_mappings.length,
        embedded_numbers: snapshot.companies.reduce(
          (sum, company) =>
            sum +
            company.embedded_call_numbers.reduce(
              (count, item) => count + item.phone_numbers.length,
              0,
            ),
          0,
        ),
      },
      planned: {
        creates: plan.routes.filter((item) => item.action === "create").length,
        updates: plan.routes.filter((item) => item.action === "update").length,
        no_ops: plan.routes.filter((item) => item.action === "noop").length,
        conflicts: plan.conflicts.length,
      },
      applied: result.applied,
      mapping_checksum: plan.mapping_checksum,
      conflict_summary: {
        blocking: plan.conflicts.filter((conflict) => conflict.blocking).length,
        reviewable: plan.conflicts.filter((conflict) => !conflict.blocking).length,
        total: plan.conflicts.length,
        by_category: conflictsByCode,
      },
      conflicts: plan.conflicts,
      mappings: plan.mappings,
      validations: result.validations,
      apply_errors: result.apply_errors,
      validation_summary: {
        dry_run_performed_no_writes: !apply,
        intended_routes: plan.mappings.length,
        validated_routes: result.validations.length,
        valid_routes: result.validations.length - validationFailures.length,
        failed_routes: validationFailures.length,
        gate_passed:
          apply &&
          plan.conflicts.length === 0 &&
          validationFailures.length === 0 &&
          result.applied.failures === 0,
      },
      resume_cursor: null,
    };
    await mkdir(OUTPUT_DIR, { recursive: true });
    const manifestPath = path.join(OUTPUT_DIR, `${runId}.json`);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    console.log(JSON.stringify({
      database_name: databaseName,
      mode: manifest.mode,
      manifest_path: manifestPath,
      planned: manifest.planned,
      applied: manifest.applied,
      mapping_checksum: manifest.mapping_checksum,
      conflict_summary: manifest.conflict_summary,
      validation_summary: manifest.validation_summary,
    }, null, 2));
    if (apply && !manifest.validation_summary.gate_passed) {
      throw new Error("RingCentral M5 validation gate failed.");
    }
  } finally {
    await mongoose.disconnect();
  }
}

function gitSha(): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

main().catch((error) => {
  console.error("RingCentral registry migration failed", error);
  process.exitCode = 1;
});
