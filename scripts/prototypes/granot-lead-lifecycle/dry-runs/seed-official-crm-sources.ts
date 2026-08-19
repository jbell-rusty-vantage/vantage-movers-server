/**
 * Create the official webhook Granot CRM sources and map each to the live
 * Source Company / Source Granularity. Idempotent. Uses the Unit 05 audited
 * command. Does not enable Lead creation (`link_only` except Referral).
 *
 *   pnpm granot:lifecycle:seed-official-sources -- --confirm-production-db=vantagemovers
 */
import "./lib/force-production-env.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { GRANOT_CRM_DEFAULT_ORIGIN } from "../../../../src/config/domain/granotCsv.js";
import { getMongoDatabaseName } from "../../../../src/config/domain/runtime.js";
import { connectMongo } from "../../../../src/db.js";
import { GranotAutomationSource } from "../../../../src/models/GranotAutomationSource.js";
import { getGranotCrmSourceModel } from "../../../../src/models/GranotCrmSource.js";
import { getLeadSourceCompanyModel } from "../../../../src/models/LeadSourceCompany.js";
import { getLeadSourceGranularityModel } from "../../../../src/models/LeadSourceGranularity.js";
import { normalizeGranotSourceLabel } from "../../../../src/services/granotLifecycle/sourceLabel.js";
import type {
  GranotLeadCreatedPolicy,
  GranotLifecycleDisposition,
  LeadModel,
} from "../../../../src/services/granotLifecycle/types.js";
import {
  createOrUpdateGranotCrmSource,
} from "../../../../src/services/operationsRegistry/granotCrmSources.js";
import { setGranotAutomationSourceReference } from "../../../../src/services/operationsRegistry/granotAutomationSources.js";
import type { RegistryActorContext } from "../../../../src/services/operationsRegistry/types.js";
import {
  PRODUCTION_CONFIRMATION,
  PRODUCTION_DATABASE,
  assertProductionDryRunArgs,
} from "./lib/connect-production-readonly.js";

const POLICY_VERSION = "granot-lifecycle-source-policy-v1";
const REASON =
  "Create official Granot webhook CRM sources and map them to Source Company / Source Granularity.";

type OfficialRoute = {
  route_key: string;
  lead_model: LeadModel;
  move_type: "local" | "long_distance" | "any";
  granularity_key: string;
};

type OfficialSource = {
  granot_label: string;
  disposition: GranotLifecycleDisposition;
  lead_created_policy: GranotLeadCreatedPolicy;
  company_slug?: string;
  default_channel: "form" | "call" | "unknown";
  routes: OfficialRoute[];
};

const OFFICIAL_SOURCES: OfficialSource[] = [
  {
    granot_label: "10best Inbounds",
    disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    company_slug: "tbm_leads",
    default_channel: "call",
    routes: [
      {
        route_key: "call_any",
        lead_model: "CallLead",
        move_type: "any",
        granularity_key: "tbm_leads_call",
      },
    ],
  },
  {
    granot_label: "Best Relocation Forms",
    disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    company_slug: "best_relocation_leads",
    default_channel: "form",
    routes: [
      {
        route_key: "form_local",
        lead_model: "FormLead",
        move_type: "local",
        granularity_key: "best_relocation_leads_form_local",
      },
      {
        route_key: "form_long_distance",
        lead_model: "FormLead",
        move_type: "long_distance",
        granularity_key: "best_relocation_leads_form_long_distance",
      },
    ],
  },
  {
    granot_label: "BestRelocation Inbounds",
    disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    company_slug: "best_relocation_leads",
    default_channel: "call",
    routes: [
      {
        route_key: "call_any",
        lead_model: "CallLead",
        move_type: "any",
        granularity_key: "best_relocation_leads_call",
      },
    ],
  },
  {
    granot_label: "Main Site Forms",
    disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    company_slug: "main_site",
    default_channel: "form",
    routes: [
      {
        route_key: "form_any",
        lead_model: "FormLead",
        move_type: "any",
        granularity_key: "main_site_form",
      },
    ],
  },
  {
    granot_label: "Main Site Inbounds",
    disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    company_slug: "main_site",
    default_channel: "call",
    routes: [
      {
        route_key: "call_any",
        lead_model: "CallLead",
        move_type: "any",
        granularity_key: "main_site_call",
      },
    ],
  },
  {
    granot_label: "Referral",
    disposition: "referral_booking",
    lead_created_policy: "observation_only",
    default_channel: "unknown",
    routes: [],
  },
  {
    granot_label: "TBM Forms",
    disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    company_slug: "tbm_leads",
    default_channel: "form",
    routes: [
      {
        route_key: "form_any",
        lead_model: "FormLead",
        move_type: "any",
        granularity_key: "tbm_leads_form",
      },
    ],
  },
  {
    granot_label: "TBM Forms Prime",
    disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    company_slug: "tbm_prime_leads",
    default_channel: "form",
    routes: [
      {
        route_key: "form_any",
        lead_model: "FormLead",
        move_type: "any",
        granularity_key: "tbm_prime_leads_form",
      },
    ],
  },
  {
    granot_label: "TBM Prime Inbounds",
    disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    company_slug: "tbm_prime_leads",
    default_channel: "call",
    routes: [
      {
        route_key: "call_any",
        lead_model: "CallLead",
        move_type: "any",
        granularity_key: "tbm_prime_leads_call",
      },
    ],
  },
  {
    granot_label: "Top10 Forms",
    disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    company_slug: "top10_leads",
    default_channel: "form",
    routes: [
      {
        route_key: "form_any",
        lead_model: "FormLead",
        move_type: "any",
        granularity_key: "top10_leads_form",
      },
    ],
  },
  {
    granot_label: "Top10 Inbounds",
    disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    company_slug: "top10_leads",
    default_channel: "call",
    routes: [
      {
        route_key: "call_any",
        lead_model: "CallLead",
        move_type: "any",
        granularity_key: "top10_leads_call",
      },
    ],
  },
];

function actor(suffix: string): RegistryActorContext {
  return {
    actorType: "system",
    actorId: "official-granot-crm-sources",
    actorLabel: "Official Granot CRM source seed",
    actorRole: "owner",
    requestId: `official-granot-crm-sources:${suffix}`,
  };
}

function workspaceSlug(label: string): string {
  return `official/${label.trim().toLowerCase().replace(/\s+/g, "-")}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  assertProductionDryRunArgs(args);

  await connectMongo();
  const dbName = mongoose.connection.db?.databaseName ?? getMongoDatabaseName();
  if (dbName !== PRODUCTION_DATABASE) {
    throw new Error(
      `Refusing official source seed: connected database is ${dbName}, expected ${PRODUCTION_DATABASE}.`,
    );
  }

  const [companies, granularities] = await Promise.all([
    getLeadSourceCompanyModel().find({}).lean().exec(),
    getLeadSourceGranularityModel().find({}).lean().exec(),
  ]);
  const companyBySlug = new Map(companies.map((row) => [row.company_slug, row]));
  const granularityByKey = new Map(
    granularities.map((row) => [row.granularity_key, row]),
  );

  const results: Array<Record<string, unknown>> = [];
  for (const spec of OFFICIAL_SOURCES) {
    const normalized = normalizeGranotSourceLabel(spec.granot_label);
    if (!normalized) {
      throw new Error(`Label does not normalize: ${spec.granot_label}`);
    }
    const company = spec.company_slug
      ? companyBySlug.get(spec.company_slug)
      : undefined;
    if (spec.company_slug && (!company || company.active !== true)) {
      throw new Error(`Missing or inactive Source Company ${spec.company_slug}`);
    }
    const routes = spec.routes.map((route) => {
      const granularity = granularityByKey.get(route.granularity_key);
      if (!granularity || granularity.active !== true) {
        throw new Error(`Missing or inactive granularity ${route.granularity_key}`);
      }
      if (company && String(granularity.source_company) !== String(company._id)) {
        throw new Error(
          `Granularity ${route.granularity_key} does not belong to ${spec.company_slug}`,
        );
      }
      const expectedChannel = route.lead_model === "FormLead" ? "form" : "call";
      if (granularity.channel !== expectedChannel) {
        throw new Error(
          `Granularity ${route.granularity_key} channel ${granularity.channel} != ${expectedChannel}`,
        );
      }
      return {
        route_key: route.route_key,
        lead_model: route.lead_model,
        move_type: route.move_type,
        source_granularity_id: String(granularity._id),
      };
    });

    const Source = getGranotCrmSourceModel();
    const existing = await Source.findOne({
      $or: [
        { normalized_granot_label: normalized },
        { granot_label: spec.granot_label },
      ],
    })
      .lean()
      .exec();

    const record = await createOrUpdateGranotCrmSource(
      {
        ...(existing ? { id: String(existing._id) } : {}),
        crm_origin: GRANOT_CRM_DEFAULT_ORIGIN,
        workspace_slug: existing?.workspace_slug || workspaceSlug(spec.granot_label),
        granot_label: spec.granot_label,
        default_channel: spec.default_channel,
        source_company: spec.company_slug ?? "not_provided",
        enabled: true,
        notes: "Official Granot webhook source mapped to Source Company.",
        lifecycle_enabled: true,
        lifecycle_disposition: spec.disposition,
        lead_created_policy: spec.lead_created_policy,
        lead_source_company: company ? String(company._id) : null,
        lifecycle_routes: routes,
        lifecycle_policy_version: POLICY_VERSION,
        reason: REASON,
      },
      actor(normalized),
    );

    const automation = await GranotAutomationSource.findOne({
      label: spec.granot_label,
    })
      .lean()
      .exec();
    let automation_link: string | undefined;
    if (automation) {
      await setGranotAutomationSourceReference(
        {
          id: String(automation._id),
          granot_crm_source: record.id,
          reason: REASON,
        },
        actor(`automation:${normalized}`),
      );
      automation_link = String(automation._id);
    }

    const row = {
      action: existing ? "updated" : "created",
      id: record.id,
      granot_label: record.granot_label,
      normalized_granot_label: record.normalized_granot_label,
      company_slug: spec.company_slug ?? null,
      lead_source_company: record.lead_source_company ?? null,
      disposition: record.lifecycle_disposition,
      lead_created_policy: record.lead_created_policy,
      lifecycle_enabled: record.lifecycle_enabled,
      routes: record.lifecycle_routes.map((route) => ({
        route_key: route.route_key,
        lead_model: route.lead_model,
        move_type: route.move_type,
        source_granularity_id: route.source_granularity_id,
      })),
      automation_link: automation_link ?? null,
    };
    results.push(row);
    console.log(
      `${row.action} ${row.granot_label} → ${row.company_slug ?? "referral"} (${row.lead_created_policy})`,
    );
  }

  const outDir = path.join(
    "scripts",
    "output",
    "granot-lifecycle-dry-runs",
    `official-sources-${Date.now()}`,
  );
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "official-crm-sources.json"),
    `${JSON.stringify({ database: dbName, confirmation: PRODUCTION_CONFIRMATION, results }, null, 2)}\n`,
  );
  await writeFile(
    path.join(outDir, "official-crm-sources.md"),
    renderReport(results),
  );
  console.log(`Wrote ${outDir}`);
  await mongoose.disconnect();
}

function renderReport(results: Array<Record<string, unknown>>): string {
  return [
    "# Official Granot CRM sources",
    "",
    `Database: \`${PRODUCTION_DATABASE}\`. Policy version: \`${POLICY_VERSION}\`.`,
    "",
    "Creation policy is `link_only` so WordPress form leads and RingCentral call leads stay the creators. Referral is `observation_only` / `referral_booking`.",
    "",
    "| Label | Company | Policy | Disposition | Action | Routes | Automation |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...results.map((row) => {
      const routes = Array.isArray(row.routes)
        ? (row.routes as Array<{ lead_model: string; move_type: string }>)
            .map((route) => `${route.lead_model}:${route.move_type}`)
            .join(", ")
        : "—";
      return `| ${row.granot_label} | ${row.company_slug ?? "—"} | ${row.lead_created_policy} | ${row.disposition} | ${row.action} | ${routes || "—"} | ${row.automation_link ? "linked" : "—"} |`;
    }),
    "",
  ].join("\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
