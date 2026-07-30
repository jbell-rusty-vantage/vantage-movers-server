/**
 * S0 — read-only Operations Registry inventory (M0).
 *
 * Dry run only. No --apply flag. Never mutates MongoDB.
 *
 * Safe usage (test fixture DB):
 *   TEST_MODE=true pnpm migrations:operations-registry-inventory
 *
 * Production requires explicit confirmation and should be owner-reviewed:
 *   pnpm migrations:operations-registry-inventory -- --confirm-production-db=vantagemovers
 */
import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db.js";
import { Agent } from "../../src/models/Agent.js";
import { BookedLead } from "../../src/models/BookedLead.js";
import { CallLead } from "../../src/models/CallLead.js";
import { CplRate } from "../../src/models/CplRate.js";
import { FormLead } from "../../src/models/FormLead.js";
import { getLeadSourceCompanyModel } from "../../src/models/LeadSourceCompany.js";
import { Merchant } from "../../src/models/Merchant.js";
import {
  assertInventoryDatabaseAllowed,
  assertNoApplyFlag,
  buildOperationsRegistryInventoryManifest,
  redactInventoryManifestForOutput,
  type AgentInventoryRecord,
  type CplRateInventoryRecord,
  type GranularityInventoryRecord,
  type InventorySnapshot,
  type LeadCountBucket,
  type MerchantInventoryRecord,
  type SourceCompanyInventoryRecord,
} from "./operations-registry-inventory.lib.js";

const OUTPUT_DIR = path.join(process.cwd(), "scripts", "output", "operations-registry-inventory");

function resolveGitSha(): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

function createRunId(): string {
  return `operations-registry-inventory-${Date.now()}`;
}

async function loadInventorySnapshot(): Promise<InventorySnapshot> {
  const sourceCompanyModel = getLeadSourceCompanyModel();
  const [
    agents,
    merchants,
    sourceCompanies,
    cplRates,
    formLeadCounts,
    callLeadCounts,
    bookedLeadMerchants,
  ] = await Promise.all([
    Agent.find(
      {},
      "name normalized_name active granot_crm_username granot_identity name_aliases",
    )
      .lean()
      .exec(),
    Merchant.find({}, "name normalized_name active name_aliases").lean().exec(),
    sourceCompanyModel.find({}).lean().exec(),
    CplRate.find({}, "label source_company lead_type local cpl").lean().exec(),
    aggregateLeadCounts(FormLead),
    aggregateLeadCounts(CallLead),
    BookedLead.aggregate<{ _id: string; count: number }>([
      { $match: { merchant: { $type: "string", $ne: "" } } },
      {
        $group: {
          _id: {
            $trim: {
              input: { $toLower: "$merchant" },
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]).exec(),
  ]);

  return {
    agents: agents.map(toAgentRecord),
    merchants: merchants.map(toMerchantRecord),
    sourceCompanies: sourceCompanies.map(toSourceCompanyRecord),
    cplRates: cplRates.map(toCplRateRecord),
    formLeadCounts,
    callLeadCounts,
    bookedLeadMerchantSnapshots: bookedLeadMerchants.map((entry) => ({
      normalized: entry._id,
      count: entry.count,
    })),
  };
}

async function aggregateLeadCounts(
  model: typeof FormLead | typeof CallLead,
): Promise<LeadCountBucket[]> {
  const rows = await model
    .aggregate<{
      source_company: string;
      source_granularity_key: string;
      cpl: number;
      count: number;
    }>([
      {
        $group: {
          _id: {
            source_company: { $ifNull: ["$source_company", "not_provided"] },
            source_granularity_key: {
              $ifNull: ["$source_granularity_key", "unknown"],
            },
            cpl: { $ifNull: ["$cpl", 0] },
          },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          source_company: "$_id.source_company",
          source_granularity_key: "$_id.source_granularity_key",
          cpl: "$_id.cpl",
          count: 1,
        },
      },
      {
        $sort: {
          source_company: 1,
          source_granularity_key: 1,
          cpl: 1,
        },
      },
    ])
    .exec();

  return rows;
}

function toAgentRecord(doc: {
  _id: mongoose.Types.ObjectId;
  name: string;
  normalized_name: string;
  active: boolean;
  granot_crm_username?: string | null;
  granot_identity?: { username?: string | null } | null;
  name_aliases?: string[] | null;
}): AgentInventoryRecord {
  return {
    id: String(doc._id),
    name: doc.name,
    normalized_name: doc.normalized_name,
    active: doc.active,
    granot_crm_username: doc.granot_crm_username ?? undefined,
    granot_identity_username: doc.granot_identity?.username ?? undefined,
    name_aliases: [...(doc.name_aliases ?? [])].sort(),
  };
}

function toMerchantRecord(doc: {
  _id: mongoose.Types.ObjectId;
  name: string;
  normalized_name: string;
  active: boolean;
  name_aliases?: string[] | null;
}): MerchantInventoryRecord {
  return {
    id: String(doc._id),
    name: doc.name,
    normalized_name: doc.normalized_name,
    active: doc.active,
    name_aliases: [...(doc.name_aliases ?? [])].sort(),
  };
}

function toGranularityRecord(
  company: {
    _id: mongoose.Types.ObjectId;
    company_slug: string;
  },
  granularity: {
    _id: mongoose.Types.ObjectId;
    granularity_key: string;
    channel: "form" | "call";
    owner_label: string;
    crm_label: string;
    aliases?: string[] | null;
    active: boolean;
    cpl: number;
    local?: string | null;
    source_sites?: string[] | null;
    inbound_phone_numbers?: string[] | null;
    priority: number;
    sheet_tab_name?: string | null;
  },
): GranularityInventoryRecord {
  return {
    id: String(granularity._id),
    company_slug: company.company_slug,
    company_id: String(company._id),
    granularity_key: granularity.granularity_key,
    channel: granularity.channel,
    owner_label: granularity.owner_label,
    crm_label: granularity.crm_label,
    aliases: [...(granularity.aliases ?? [])].sort(),
    active: granularity.active,
    cpl: granularity.cpl,
    local: granularity.local ?? undefined,
    source_sites: [...(granularity.source_sites ?? [])].sort(),
    inbound_phone_numbers: [...(granularity.inbound_phone_numbers ?? [])].sort(),
    priority: granularity.priority,
    sheet_tab_name: granularity.sheet_tab_name ?? undefined,
  };
}

function toSourceCompanyRecord(doc: {
  _id: mongoose.Types.ObjectId;
  company_slug: string;
  name: string;
  owner_label: string;
  aliases?: string[] | null;
  active: boolean;
  default_form_granularity_key?: string | null;
  default_call_granularity_key?: string | null;
  sheet_config?: {
    spreadsheet_id?: string | null;
    has_bad_tabs?: boolean;
    projection_mode?: string;
  } | null;
  granularities?: Array<Parameters<typeof toGranularityRecord>[1]>;
}): SourceCompanyInventoryRecord {
  return {
    id: String(doc._id),
    company_slug: doc.company_slug,
    name: doc.name,
    owner_label: doc.owner_label,
    aliases: [...(doc.aliases ?? [])].sort(),
    active: doc.active,
    default_form_granularity_key: doc.default_form_granularity_key ?? undefined,
    default_call_granularity_key: doc.default_call_granularity_key ?? undefined,
    sheet_config: doc.sheet_config
      ? {
          spreadsheet_id: doc.sheet_config.spreadsheet_id ?? undefined,
          has_bad_tabs: doc.sheet_config.has_bad_tabs ?? false,
          projection_mode: doc.sheet_config.projection_mode,
        }
      : undefined,
    granularities: [...(doc.granularities ?? [])]
      .map((granularity) => toGranularityRecord(doc, granularity))
      .sort((left, right) => left.granularity_key.localeCompare(right.granularity_key)),
  };
}

function toCplRateRecord(doc: {
  _id: mongoose.Types.ObjectId;
  label: string;
  source_company: string;
  lead_type: "form" | "call";
  local?: string | null;
  cpl: number;
}): CplRateInventoryRecord {
  return {
    id: String(doc._id),
    label: doc.label,
    source_company: doc.source_company,
    lead_type: doc.lead_type,
    local: doc.local ?? undefined,
    cpl: doc.cpl,
  };
}

export async function runOperationsRegistryInventory(args: readonly string[]): Promise<{
  manifestPath: string;
  manifest: ReturnType<typeof buildOperationsRegistryInventoryManifest>;
}> {
  assertNoApplyFlag(args);
  const startedAt = new Date().toISOString();
  const runId = createRunId();

  await connectMongo();
  assertInventoryDatabaseAllowed(mongoose.connection.db?.databaseName, args);

  const snapshot = await loadInventorySnapshot();
  const completedAt = new Date().toISOString();
  const manifest = buildOperationsRegistryInventoryManifest({
    snapshot,
    databaseName: mongoose.connection.db!.databaseName,
    runId,
    startedAt,
    completedAt,
    gitSha: resolveGitSha(),
    operator: process.env.USER ?? process.env.USERNAME,
  });

  const redacted = redactInventoryManifestForOutput(manifest);
  await mkdir(OUTPUT_DIR, { recursive: true });
  const manifestPath = path.join(OUTPUT_DIR, `${runId}.json`);
  await writeFile(manifestPath, `${JSON.stringify(redacted, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  await mongoose.disconnect();
  return { manifestPath, manifest: redacted };
}

async function main(): Promise<void> {
  const { manifestPath, manifest } = await runOperationsRegistryInventory(process.argv);
  console.log(
    JSON.stringify(
      {
        manifest_path: manifestPath,
        database_name: manifest.database_name,
        mode: manifest.mode,
        mapping_checksum: manifest.mapping_checksum,
        conflict_summary: manifest.conflict_summary,
        source_counts: manifest.source_counts,
        validation_summary: manifest.validation_summary,
      },
      null,
      2,
    ),
  );
}

function isDirectExecution(): boolean {
  const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
  return entry.endsWith("operations-registry-inventory.ts");
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
