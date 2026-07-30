/**
 * Read-only dump of the Operations Registry backfill seed surface:
 *   - agents
 *   - merchants
 *   - lead_source_companies (+ embedded granularities / inbound numbers)
 *   - static RingCentral queue numbers (RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE)
 *
 * Dry run only. Never mutates MongoDB.
 *
 * Test DB:
 *   TEST_MODE=true pnpm migrations:dump-operations-registry-seed-surface
 *
 * Production:
 *   pnpm migrations:dump-operations-registry-seed-surface -- --confirm-production-db=vantagemovers
 *
 * Writes a redacted JSON report under scripts/output/operations-registry-seed-surface/
 * and prints a compact summary to stdout. Pass --print-full to also print the
 * full redacted JSON. This command never rewrites tracked files.
 */
import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db.js";
import { SOURCE_COMPANIES } from "../../src/config/domain/sources.js";
import { Agent } from "../../src/models/Agent.js";
import { getLeadSourceCompanyModel } from "../../src/models/LeadSourceCompany.js";
import { Merchant } from "../../src/models/Merchant.js";
import { RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE } from "../../src/services/ringcentral/call-lead-sources.js";
import {
  assertInventoryDatabaseAllowed,
  assertNoApplyFlag,
} from "./operations-registry-inventory.lib.js";

const OUTPUT_DIR = path.join(
  process.cwd(),
  "scripts",
  "output",
  "operations-registry-seed-surface",
);

function resolveGitSha(): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return null;
}

function serializeId(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return String(value);
}

export async function dumpOperationsRegistrySeedSurface(
  args: readonly string[],
): Promise<{ reportPath: string; report: Record<string, unknown> }> {
  assertNoApplyFlag(args);
  const startedAt = new Date().toISOString();

  await connectMongo();
  assertInventoryDatabaseAllowed(mongoose.connection.db?.databaseName, args);

  const databaseName = mongoose.connection.db!.databaseName;
  const sourceCompanyModel = getLeadSourceCompanyModel();

  const [agents, merchants, leadSourceCompanies] = await Promise.all([
    Agent.find({}).sort({ normalized_name: 1 }).lean().exec(),
    Merchant.find({}).sort({ normalized_name: 1 }).lean().exec(),
    sourceCompanyModel.find({}).sort({ company_slug: 1 }).lean().exec(),
  ]);

  const serializedAgents = agents.map((agent) => ({
    _id: serializeId(agent._id),
    name: agent.name,
    normalized_name: agent.normalized_name,
    active: agent.active,
    role: agent.role,
    created_from: agent.created_from,
    granot_crm_username: agent.granot_crm_username ?? null,
    name_aliases: [...(agent.name_aliases ?? [])],
    granot_identity: agent.granot_identity
      ? {
          username: agent.granot_identity.username ?? null,
          verified: agent.granot_identity.verified,
          verified_at: toIso(agent.granot_identity.verified_at),
          last_observed_at: toIso(agent.granot_identity.last_observed_at),
        }
      : null,
    archived_at: toIso(agent.archived_at),
    deactivation_reason: agent.deactivation_reason ?? null,
    createdAt: toIso(agent.createdAt),
    updatedAt: toIso(agent.updatedAt),
  }));

  const serializedMerchants = merchants.map((merchant) => ({
    _id: serializeId(merchant._id),
    name: merchant.name,
    normalized_name: merchant.normalized_name,
    active: merchant.active,
    created_from: merchant.created_from,
    name_aliases: [...(merchant.name_aliases ?? [])],
    archived_at: toIso(merchant.archived_at),
    deactivation_reason: merchant.deactivation_reason ?? null,
    createdAt: toIso(merchant.createdAt),
    updatedAt: toIso(merchant.updatedAt),
  }));

  const serializedCompanies = leadSourceCompanies.map((company) => ({
    _id: serializeId(company._id),
    company_slug: company.company_slug,
    name: company.name,
    owner_label: company.owner_label,
    active: company.active,
    created_from: company.created_from,
    aliases: [...(company.aliases ?? [])],
    default_form_granularity_key: company.default_form_granularity_key ?? null,
    default_call_granularity_key: company.default_call_granularity_key ?? null,
    default_form_granularity: serializeId(company.default_form_granularity),
    default_call_granularity: serializeId(company.default_call_granularity),
    sheet_config: company.sheet_config
      ? {
          has_spreadsheet_id: Boolean(company.sheet_config.spreadsheet_id),
          has_bad_tabs: company.sheet_config.has_bad_tabs,
          projection_mode: company.sheet_config.projection_mode,
        }
      : null,
    granularities: [...(company.granularities ?? [])].map((granularity) => ({
      _id: serializeId(granularity._id),
      granularity_key: granularity.granularity_key,
      channel: granularity.channel,
      owner_label: granularity.owner_label,
      crm_label: granularity.crm_label,
      aliases: [...(granularity.aliases ?? [])],
      active: granularity.active,
      archived_at: toIso(granularity.archived_at),
      cpl: granularity.cpl,
      local: granularity.local ?? null,
      source_sites: [...(granularity.source_sites ?? [])],
      inbound_phone_numbers: [...(granularity.inbound_phone_numbers ?? [])],
      priority: granularity.priority,
      sheet_tab_name: granularity.sheet_tab_name ?? null,
    })),
    archived_at: toIso(company.archived_at),
    deactivation_reason: company.deactivation_reason ?? null,
    createdAt: toIso(company.createdAt),
    updatedAt: toIso(company.updatedAt),
  }));

  const staticMappings = Object.entries(RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE).map(
    ([phone_number, source]) => ({
      phone_number,
      source_label: source.sourceLabel,
      source_company: source.sourceCompany,
    }),
  );

  const embeddedInbound: Array<{
    phone_number: string;
    company_slug: string;
    granularity_key: string;
    crm_label: string;
  }> = [];
  const callGranularitiesWithoutNumbers: Array<{
    company_slug: string;
    granularity_key: string;
    crm_label: string;
  }> = [];

  for (const company of serializedCompanies) {
    for (const granularity of company.granularities) {
      if (granularity.channel !== "call") {
        continue;
      }
      const numbers = granularity.inbound_phone_numbers;
      if (numbers.length === 0) {
        callGranularitiesWithoutNumbers.push({
          company_slug: company.company_slug,
          granularity_key: granularity.granularity_key,
          crm_label: granularity.crm_label,
        });
        continue;
      }
      for (const phone_number of numbers) {
        embeddedInbound.push({
          phone_number,
          company_slug: company.company_slug,
          granularity_key: granularity.granularity_key,
          crm_label: granularity.crm_label,
        });
      }
    }
  }

  const staticPhones = new Set(staticMappings.map((entry) => entry.phone_number));
  const embeddedPhones = new Set(embeddedInbound.map((entry) => entry.phone_number));
  const dbSlugs = serializedCompanies.map((company) => company.company_slug).sort();
  const staticSlugs = [...SOURCE_COMPANIES].sort();

  const report = {
    meta: {
      title: "Operations Registry backfill seed surface",
      captured_at: startedAt,
      completed_at: new Date().toISOString(),
      database: databaseName,
      git_sha: resolveGitSha() ?? null,
      source: "mongoose live dump + RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE",
      purpose:
        "Complete value inventory for Operations Registry migrations before production apply",
    },
    counts: {
      agents_total: serializedAgents.length,
      agents_active: serializedAgents.filter((agent) => agent.active).length,
      agents_inactive: serializedAgents.filter((agent) => !agent.active).length,
      merchants_total: serializedMerchants.length,
      merchants_active: serializedMerchants.filter((merchant) => merchant.active)
        .length,
      lead_source_companies_total: serializedCompanies.length,
      lead_source_companies_active: serializedCompanies.filter(
        (company) => company.active,
      ).length,
      embedded_granularities_total: serializedCompanies.reduce(
        (sum, company) => sum + company.granularities.length,
        0,
      ),
      ringcentral_static_queue_numbers: staticMappings.length,
      embedded_inbound_phone_numbers: embeddedInbound.length,
    },
    agents: serializedAgents,
    merchants: serializedMerchants,
    lead_source_companies: serializedCompanies,
    ringcentral_queue_numbers: {
      description:
        "Inbound queue / company numbers used by Call Log vetting and M5 RingCentral route backfill.",
      static_mappings: staticMappings.map((mapping) => ({
        ...mapping,
        present_in_db_inbound_phone_numbers: embeddedPhones.has(
          mapping.phone_number,
        ),
      })),
      embedded_inbound_phone_numbers_from_db: embeddedInbound.sort((left, right) =>
        left.phone_number.localeCompare(right.phone_number),
      ),
      parity: {
        static_vs_embedded:
          [...staticPhones].every((phone) => embeddedPhones.has(phone)) &&
          [...embeddedPhones].every((phone) => staticPhones.has(phone))
            ? "exact_match"
            : "mismatch",
        missing_from_static: [...embeddedPhones]
          .filter((phone) => !staticPhones.has(phone))
          .sort(),
        missing_from_embedded: [...staticPhones]
          .filter((phone) => !embeddedPhones.has(phone))
          .sort(),
        call_granularities_without_numbers: callGranularitiesWithoutNumbers,
      },
    },
    static_source_company_slugs: staticSlugs,
    db_vs_static_source_slugs: {
      in_db: dbSlugs,
      in_static_only: staticSlugs.filter((slug) => !dbSlugs.includes(slug)),
      in_db_only: dbSlugs.filter(
        (slug) => !staticSlugs.includes(slug as (typeof SOURCE_COMPANIES)[number]),
      ),
    },
    unique_index_keys: {
      "agents.normalized_name": serializedAgents.map((agent) => agent.normalized_name),
      "agents.granot_crm_username": serializedAgents
        .map((agent) => agent.granot_crm_username)
        .filter((value): value is string => Boolean(value))
        .sort(),
      "merchants.normalized_name": serializedMerchants.map(
        (merchant) => merchant.normalized_name,
      ),
      "lead_source_companies.company_slug": dbSlugs,
    },
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  const reportPath = path.join(
    OUTPUT_DIR,
    `seed-surface-${databaseName}-${Date.now()}.json`,
  );
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  await mongoose.disconnect();
  return { reportPath, report };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { reportPath, report } = await dumpOperationsRegistrySeedSurface(args);
  const printFull = args.includes("--print-full");

  if (printFull) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      {
        report_path: reportPath,
        database: report.meta,
        counts: report.counts,
        ringcentral_queue_numbers: (
          report.ringcentral_queue_numbers as {
            static_mappings: unknown;
            parity: unknown;
          }
        ).static_mappings,
        ringcentral_parity: (
          report.ringcentral_queue_numbers as { parity: unknown }
        ).parity,
        db_vs_static_source_slugs: report.db_vs_static_source_slugs,
        unique_index_keys: report.unique_index_keys,
      },
      null,
      2,
    ),
  );
}

function isDirectExecution(): boolean {
  const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
  return entry.endsWith("dump-operations-registry-seed-surface.ts");
}

if (isDirectExecution()) {
  main().catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => undefined);
    }
    process.exitCode = 1;
  });
}
