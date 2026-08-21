/**
 * Create the Paid Overflow Source Company, Source Granularity, and Granot
 * CRM Source with create_if_missing plus confirmation SMS.
 *
 *   pnpm migration:paid-overflow-source -- --report
 *   pnpm migration:paid-overflow-source -- --apply --confirm-production=<db>
 *   pnpm migration:paid-overflow-source -- --verify
 */
import mongoose from "mongoose";
import { GRANOT_CRM_DEFAULT_ORIGIN } from "../../src/config/domain/granotCsv.js";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import { getCplRatePeriodModel } from "../../src/models/CplRatePeriod.js";
import { getGranotCrmSourceModel } from "../../src/models/GranotCrmSource.js";
import { getLeadSourceCompanyModel } from "../../src/models/LeadSourceCompany.js";
import { getLeadSourceGranularityModel } from "../../src/models/LeadSourceGranularity.js";
import { normalizeGranotSourceLabel } from "../../src/services/granotLifecycle/sourceLabel.js";
import { DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE } from "../../src/services/leadMessaging/granotCreatedLead.js";
import { applySimpleCplSchedule } from "../../src/services/operationsRegistry/cplSchedule.js";
import {
  setGranotCrmSourceOutboundSms,
  toSmsView,
} from "../../src/services/operationsRegistry/crmSourceOutboundSms.js";
import { createOrUpdateGranotCrmSource } from "../../src/services/operationsRegistry/granotCrmSources.js";
import {
  createOrUpdateSourceCompany,
  createOrUpdateSourceGranularity,
  setSourceCompanyActivation,
  setSourceGranularityActivation,
} from "../../src/services/operationsRegistry/sourceRegistry.js";
import type { RegistryActorContext } from "../../src/services/operationsRegistry/types.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
  parseGranotLifecycleMigrationMode,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";
import {
  PAID_OVERFLOW_APPLY_REASON,
  PAID_OVERFLOW_MIGRATION_ACTOR_ID,
  PAID_OVERFLOW_MIGRATION_SCRIPT_VERSION,
  PAID_OVERFLOW_SMS_REASON,
  PAID_OVERFLOW_SOURCE,
} from "./paid-overflow-source-registry.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("paid-overflow-source-registry");
const NORMALIZED_LABEL = normalizeGranotSourceLabel(PAID_OVERFLOW_SOURCE.granot_label);

type Inventory = {
  company?: {
    id: string;
    company_slug: string;
    name: string;
    active: boolean;
  };
  granularity?: {
    id: string;
    granularity_key: string;
    owner_label: string;
    crm_label: string;
    channel: string;
    local?: string;
    active: boolean;
    schedule_revision: number;
    source_company_id: string;
  };
  crm_source?: {
    id: string;
    granot_label: string;
    normalized_granot_label?: string;
    workspace_slug: string;
    enabled: boolean;
    lifecycle_enabled: boolean;
    lifecycle_disposition: string;
    lead_created_policy: string;
    lead_source_company?: string;
    default_channel: string;
    route_count: number;
    sms_enabled: boolean;
    consent_basis: string;
  };
  cpl_period_count: number;
};

function migrationActor(suffix: string): RegistryActorContext {
  return {
    actorType: "system",
    actorId: PAID_OVERFLOW_MIGRATION_ACTOR_ID,
    actorLabel: "Paid Overflow source registry create",
    actorRole: "owner",
    requestId: `${PAID_OVERFLOW_MIGRATION_ACTOR_ID}:${suffix}`,
  };
}

async function loadInventory(): Promise<Inventory> {
  const [company, granularity, crmSource] = await Promise.all([
    getLeadSourceCompanyModel()
      .findOne({ company_slug: PAID_OVERFLOW_SOURCE.company_slug })
      .lean()
      .exec(),
    getLeadSourceGranularityModel()
      .findOne({ granularity_key: PAID_OVERFLOW_SOURCE.granularity_key })
      .lean()
      .exec(),
    getGranotCrmSourceModel()
      .findOne({
        $or: [
          { normalized_granot_label: NORMALIZED_LABEL },
          { granot_label: PAID_OVERFLOW_SOURCE.granot_label },
        ],
      })
      .lean()
      .exec(),
  ]);

  const cpl_period_count = granularity
    ? await getCplRatePeriodModel().countDocuments({
        source_granularity: granularity._id,
        archived_at: { $exists: false },
      })
    : 0;

  const sms = crmSource
    ? toSmsView(String(crmSource._id), crmSource.outbound_sms)
    : undefined;

  return {
    ...(company
      ? {
          company: {
            id: String(company._id),
            company_slug: String(company.company_slug),
            name: String(company.name ?? company.owner_label ?? ""),
            active: company.active === true,
          },
        }
      : {}),
    ...(granularity
      ? {
          granularity: {
            id: String(granularity._id),
            granularity_key: String(granularity.granularity_key),
            owner_label: String(granularity.owner_label ?? ""),
            crm_label: String(granularity.crm_label ?? ""),
            channel: String(granularity.channel),
            ...(granularity.local ? { local: String(granularity.local) } : {}),
            active: granularity.active === true,
            schedule_revision:
              typeof granularity.schedule_revision === "number"
                ? granularity.schedule_revision
                : 0,
            source_company_id: String(granularity.source_company ?? ""),
          },
        }
      : {}),
    ...(crmSource
      ? {
          crm_source: {
            id: String(crmSource._id),
            granot_label: String(crmSource.granot_label ?? ""),
            normalized_granot_label:
              typeof crmSource.normalized_granot_label === "string"
                ? crmSource.normalized_granot_label
                : undefined,
            workspace_slug: String(crmSource.workspace_slug ?? ""),
            enabled: crmSource.enabled !== false,
            lifecycle_enabled: crmSource.lifecycle_enabled === true,
            lifecycle_disposition: String(
              crmSource.lifecycle_disposition ?? "deferred",
            ),
            lead_created_policy: String(
              crmSource.lead_created_policy ?? "observation_only",
            ),
            lead_source_company: crmSource.lead_source_company
              ? String(crmSource.lead_source_company)
              : undefined,
            default_channel: String(crmSource.default_channel ?? "unknown"),
            route_count: Array.isArray(crmSource.lifecycle_routes)
              ? crmSource.lifecycle_routes.length
              : 0,
            sms_enabled: sms?.enabled === true,
            consent_basis: sms?.consent_basis ?? "not_attested",
          },
        }
      : {}),
    cpl_period_count,
  };
}

function intendedMatches(inventory: Inventory): boolean {
  return (
    inventory.company?.active === true &&
    inventory.company.company_slug === PAID_OVERFLOW_SOURCE.company_slug &&
    inventory.granularity?.active === true &&
    inventory.granularity.granularity_key === PAID_OVERFLOW_SOURCE.granularity_key &&
    inventory.granularity.channel === PAID_OVERFLOW_SOURCE.channel &&
    inventory.granularity.local === undefined &&
    inventory.cpl_period_count > 0 &&
    inventory.crm_source?.enabled === true &&
    inventory.crm_source.lifecycle_enabled === true &&
    inventory.crm_source.lifecycle_disposition ===
      PAID_OVERFLOW_SOURCE.lifecycle_disposition &&
    inventory.crm_source.lead_created_policy ===
      PAID_OVERFLOW_SOURCE.lead_created_policy &&
    inventory.crm_source.route_count === 1 &&
    inventory.crm_source.sms_enabled === true &&
    inventory.crm_source.consent_basis === PAID_OVERFLOW_SOURCE.sms_consent_basis
  );
}

async function applyPaidOverflow(inventory: Inventory): Promise<Inventory> {
  let companyId = inventory.company?.id;
  if (!companyId) {
    const created = await createOrUpdateSourceCompany(
      {
        company_slug: PAID_OVERFLOW_SOURCE.company_slug,
        name: PAID_OVERFLOW_SOURCE.name,
        owner_label: PAID_OVERFLOW_SOURCE.owner_label,
        aliases: [...PAID_OVERFLOW_SOURCE.aliases],
        has_bad_tabs: false,
        projection_mode: "derived_import",
        created_from: "migration",
        reason: PAID_OVERFLOW_APPLY_REASON,
      },
      migrationActor("create-company"),
    );
    companyId = created.id;
  } else if (
    inventory.company &&
    (inventory.company.name !== PAID_OVERFLOW_SOURCE.name ||
      inventory.company.company_slug !== PAID_OVERFLOW_SOURCE.company_slug)
  ) {
    await createOrUpdateSourceCompany(
      {
        id: companyId,
        company_slug: PAID_OVERFLOW_SOURCE.company_slug,
        name: PAID_OVERFLOW_SOURCE.name,
        owner_label: PAID_OVERFLOW_SOURCE.owner_label,
        aliases: [...PAID_OVERFLOW_SOURCE.aliases],
        has_bad_tabs: false,
        created_from: "migration",
        reason: PAID_OVERFLOW_APPLY_REASON,
      },
      migrationActor("update-company"),
    );
  }

  const companyAfterCreate = await getLeadSourceCompanyModel()
    .findById(companyId)
    .lean()
    .exec();
  if (!companyAfterCreate) {
    throw new Error("Paid Overflow Source Company was not persisted.");
  }
  if (companyAfterCreate.active !== true) {
    await setSourceCompanyActivation(
      {
        id: companyId,
        active: true,
        reason: PAID_OVERFLOW_APPLY_REASON,
      },
      migrationActor("activate-company"),
    );
  }

  let granularityId = inventory.granularity?.id;
  if (!granularityId) {
    const created = await createOrUpdateSourceGranularity(
      {
        source_company: companyId,
        granularity_key: PAID_OVERFLOW_SOURCE.granularity_key,
        channel: PAID_OVERFLOW_SOURCE.channel,
        owner_label: PAID_OVERFLOW_SOURCE.granularity_owner_label,
        crm_label: PAID_OVERFLOW_SOURCE.granularity_crm_label,
        aliases: [...PAID_OVERFLOW_SOURCE.granularity_aliases],
        local: null,
        created_from: "migration",
        reason: PAID_OVERFLOW_APPLY_REASON,
      },
      migrationActor("create-granularity"),
    );
    granularityId = created.id;
  }

  const granularity = await getLeadSourceGranularityModel()
    .findById(granularityId)
    .lean()
    .exec();
  if (!granularity) {
    throw new Error("Paid Overflow Source Granularity was not persisted.");
  }

  const cplCount = await getCplRatePeriodModel().countDocuments({
    source_granularity: granularity._id,
    archived_at: { $exists: false },
  });
  if (cplCount === 0) {
    await applySimpleCplSchedule(
      {
        effective_date: PAID_OVERFLOW_SOURCE.cpl_start_date,
        expected_revisions: {
          [granularityId]:
            typeof granularity.schedule_revision === "number"
              ? granularity.schedule_revision
              : 0,
        },
        changes: [
          {
            source_granularity_id: granularityId,
            amount: PAID_OVERFLOW_SOURCE.cpl_amount,
          },
        ],
        reason: PAID_OVERFLOW_APPLY_REASON,
      },
      migrationActor("cpl"),
    );
  }

  if (granularity.active !== true) {
    await setSourceGranularityActivation(
      {
        id: granularityId,
        active: true,
        replacement_default_id: granularityId,
        reason: PAID_OVERFLOW_APPLY_REASON,
      },
      migrationActor("activate-granularity"),
    );
  }

  const existingCrm = await getGranotCrmSourceModel()
    .findOne({
      $or: [
        { normalized_granot_label: NORMALIZED_LABEL },
        { granot_label: PAID_OVERFLOW_SOURCE.granot_label },
      ],
    })
    .lean()
    .exec();

  const crm = await createOrUpdateGranotCrmSource(
    {
      ...(existingCrm ? { id: String(existingCrm._id) } : {}),
      crm_origin:
        (typeof existingCrm?.crm_origin === "string" && existingCrm.crm_origin.trim()) ||
        GRANOT_CRM_DEFAULT_ORIGIN,
      workspace_slug:
        (typeof existingCrm?.workspace_slug === "string" &&
          existingCrm.workspace_slug.trim()) ||
        PAID_OVERFLOW_SOURCE.workspace_slug,
      granot_label: PAID_OVERFLOW_SOURCE.granot_label,
      default_channel: PAID_OVERFLOW_SOURCE.default_channel,
      source_company: PAID_OVERFLOW_SOURCE.source_company_label,
      enabled: true,
      notes: PAID_OVERFLOW_SOURCE.notes,
      lifecycle_enabled: PAID_OVERFLOW_SOURCE.lifecycle_enabled,
      lifecycle_disposition: PAID_OVERFLOW_SOURCE.lifecycle_disposition,
      lead_created_policy: PAID_OVERFLOW_SOURCE.lead_created_policy,
      lead_source_company: companyId,
      lifecycle_routes: [
        {
          route_key: PAID_OVERFLOW_SOURCE.route_key,
          lead_model: PAID_OVERFLOW_SOURCE.lead_model,
          move_type: PAID_OVERFLOW_SOURCE.move_type,
          source_granularity_id: granularityId,
        },
      ],
      lifecycle_policy_version: PAID_OVERFLOW_SOURCE.lifecycle_policy_version,
      reason: PAID_OVERFLOW_APPLY_REASON,
    },
    migrationActor("crm-source"),
  );

  const current = await getGranotCrmSourceModel().findById(crm.id).lean().exec();
  const currentSms = toSmsView(crm.id, current?.outbound_sms);
  if (!currentSms.enabled || currentSms.consent_basis !== PAID_OVERFLOW_SOURCE.sms_consent_basis) {
    await setGranotCrmSourceOutboundSms(
      {
        granot_crm_source_id: crm.id,
        enabled: true,
        body_template:
          currentSms.body_template.trim() || DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE,
        consent_basis: PAID_OVERFLOW_SOURCE.sms_consent_basis,
        reason: PAID_OVERFLOW_SMS_REASON,
      },
      migrationActor("sms"),
    );
  }

  return loadInventory();
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

  const before = await loadInventory();
  let after = before;

  if (mode === "apply") {
    assertGranotLifecycleApplyAuthorized({
      args: process.argv,
      databaseName,
    });
    after = await applyPaidOverflow(before);
    if (!intendedMatches(after)) {
      throw new Error("Paid Overflow apply finished but the documents are not exact.");
    }
  }

  if (mode === "verify") {
    if (!intendedMatches(before)) {
      throw new Error("Paid Overflow verify failed: documents are missing or incomplete.");
    }
  }

  await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId: `paid-overflow-source-${mode}-${Date.now()}`,
    manifest: {
      script_version: PAID_OVERFLOW_MIGRATION_SCRIPT_VERSION,
      mode,
      database: configuredDatabase,
      intended: PAID_OVERFLOW_SOURCE,
      before,
      after: mode === "apply" ? after : before,
      exact: intendedMatches(mode === "apply" ? after : before),
    },
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode,
        database: configuredDatabase,
        exact: intendedMatches(mode === "apply" ? after : before),
        company_id: (mode === "apply" ? after : before).company?.id,
        granularity_id: (mode === "apply" ? after : before).granularity?.id,
        crm_source_id: (mode === "apply" ? after : before).crm_source?.id,
      },
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
    await mongoose.disconnect().catch(() => undefined);
  });
