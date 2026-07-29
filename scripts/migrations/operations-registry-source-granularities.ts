/**
 * M3 — First-class Source Granularities seed/backfill.
 *
 * Dry run by default. Apply requires --apply plus production authorization guards.
 * Does not remove or rewrite embedded granularity arrays.
 *
 * Safe usage (test fixture DB):
 *   TEST_MODE=true pnpm migrations:operations-registry-source-granularities
 *
 * Production requires explicit confirmation:
 *   pnpm migrations:operations-registry-source-granularities -- --apply --production-apply --confirm-production-db=vantagemovers
 */
import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db.js";
import { isTestMode } from "../../src/config/domain.js";
import { getLeadSourceCompanyModel } from "../../src/models/LeadSourceCompany.js";
import { getLeadSourceGranularityModel } from "../../src/models/LeadSourceGranularity.js";
import {
  assertMigrationApplyAuthorized,
  isMigrationApplyRequested,
} from "../../src/services/employeeBookings/migrationApplySafety.js";
import {
  assertMigrationDatabaseAllowed,
  hasBlockingMigrationCollisions,
} from "./operations-registry-migration.lib.js";
import {
  advanceSourceGranularitiesResumeCursor,
  buildSourceGranularitiesManifest,
  buildSourceGranularitiesPlan,
  companyMigrationUpdateFilter,
  granularityMigrationInsertDocument,
  redactSourceGranularitiesManifestForOutput,
  type ExistingGranularityRecord,
  type SourceGranularitiesSnapshot,
} from "./operations-registry-source-granularities.lib.js";

const OUTPUT_DIR = path.join(
  process.cwd(),
  "scripts",
  "output",
  "operations-registry-source-granularities",
);

function resolveGitSha(): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

function createRunId(): string {
  return `operations-registry-source-granularities-${Date.now()}`;
}

async function readResumeCursorFlag(args: readonly string[]) {
  const resumeFlag = args.find((arg) => arg.startsWith("--resume-from="));
  if (!resumeFlag) {
    return {
      completed_granularity_keys: [],
      completed_company_ids: [],
    };
  }
  const resumePath = resumeFlag.slice("--resume-from=".length);
  const raw = await readFile(resumePath, "utf8");
  const parsed = JSON.parse(raw) as {
    resume_cursor?: {
      completed_granularity_keys?: string[];
      completed_company_ids?: string[];
    };
  };
  return {
    completed_granularity_keys: [
      ...(parsed.resume_cursor?.completed_granularity_keys ?? []),
    ].sort(),
    completed_company_ids: [...(parsed.resume_cursor?.completed_company_ids ?? [])].sort(),
  };
}

async function loadSnapshot(): Promise<SourceGranularitiesSnapshot> {
  const sourceCompanyModel = getLeadSourceCompanyModel();
  const granularityModel = getLeadSourceGranularityModel();
  const [companies, existingGranularities] = await Promise.all([
    sourceCompanyModel.find({}).lean().exec(),
    granularityModel.find({}).lean().exec(),
  ]);

  return {
    companies: companies.map((company) => ({
      id: String(company._id),
      company_slug: String(company.company_slug),
      default_form_granularity_key: company.default_form_granularity_key ?? null,
      default_call_granularity_key: company.default_call_granularity_key ?? null,
      default_form_granularity: company.default_form_granularity
        ? String(company.default_form_granularity)
        : null,
      default_call_granularity: company.default_call_granularity
        ? String(company.default_call_granularity)
        : null,
      sheet_config: company.sheet_config
        ? {
            spreadsheet_id: company.sheet_config.spreadsheet_id ?? undefined,
            has_bad_tabs: company.sheet_config.has_bad_tabs,
            projection_mode: company.sheet_config.projection_mode,
          }
        : null,
      granularities: (company.granularities ?? []).map((granularity) => ({
        id: String(granularity._id),
        granularity_key: String(granularity.granularity_key),
        channel: granularity.channel as "form" | "call",
        owner_label: String(granularity.owner_label),
        crm_label: String(granularity.crm_label),
        aliases: [...(granularity.aliases ?? [])],
        active: Boolean(granularity.active),
        local: granularity.local ?? undefined,
        source_sites: [...(granularity.source_sites ?? [])],
        inbound_phone_numbers: [...(granularity.inbound_phone_numbers ?? [])],
        priority: Number(granularity.priority ?? 0),
        sheet_tab_name: granularity.sheet_tab_name ?? undefined,
        cpl: Number(granularity.cpl ?? 0),
      })),
    })),
    existingGranularities: existingGranularities.map(
      (granularity): ExistingGranularityRecord => ({
        id: String(granularity._id),
        source_company: String(granularity.source_company),
        granularity_key: String(granularity.granularity_key),
        channel: granularity.channel as "form" | "call",
        owner_label: String(granularity.owner_label),
        crm_label: String(granularity.crm_label),
        aliases: [...(granularity.aliases ?? [])],
        active: Boolean(granularity.active),
        local: granularity.local ?? undefined,
        source_sites: [...(granularity.source_sites ?? [])],
        priority: Number(granularity.priority ?? 0),
        sheet_tab_name: granularity.sheet_tab_name ?? undefined,
      }),
    ),
  };
}

async function applyPlan(
  plan: ReturnType<typeof buildSourceGranularitiesPlan>,
): Promise<{
  applied: { creates: number; updates: number; no_ops: number; failures: number };
  resume_cursor: ReturnType<typeof advanceSourceGranularitiesResumeCursor>;
}> {
  const granularityModel = getLeadSourceGranularityModel();
  const sourceCompanyModel = getLeadSourceCompanyModel();
  let creates = 0;
  let updates = 0;
  let no_ops = 0;
  let failures = 0;
  const appliedGranularityKeys: string[] = [];
  const appliedCompanyIds: string[] = [];

  for (const granularityPlan of plan.granularities) {
    if (granularityPlan.action === "noop_granularity") {
      no_ops += 1;
      appliedGranularityKeys.push(granularityPlan.granularity_key);
      continue;
    }
    if (granularityPlan.action === "conflict") {
      failures += 1;
      continue;
    }
    const document = granularityMigrationInsertDocument(granularityPlan);
    if (!document) {
      no_ops += 1;
      continue;
    }
    try {
      await granularityModel.create(document);
      creates += 1;
      appliedGranularityKeys.push(granularityPlan.granularity_key);
    } catch {
      failures += 1;
    }
  }

  for (const companyPlan of plan.companies) {
    const update = companyMigrationUpdateFilter(companyPlan);
    if (!update) {
      no_ops += 1;
      appliedCompanyIds.push(companyPlan.company_id);
      continue;
    }
    try {
      await sourceCompanyModel.updateOne({ _id: companyPlan.company_id }, update).exec();
      updates += 1;
      appliedCompanyIds.push(companyPlan.company_id);
    } catch {
      failures += 1;
    }
  }

  return {
    applied: { creates, updates, no_ops, failures },
    resume_cursor: advanceSourceGranularitiesResumeCursor(
      plan.resume_cursor,
      appliedGranularityKeys,
      appliedCompanyIds,
    ),
  };
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const apply = isMigrationApplyRequested(process.argv);
  const resumeCursor = await readResumeCursorFlag(process.argv);

  await connectMongo();
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
  const plan = buildSourceGranularitiesPlan(snapshot, resumeCursor);
  const runId = createRunId();
  const completedAt = new Date().toISOString();

  let manifest = buildSourceGranularitiesManifest({
    snapshot,
    plan,
    databaseName,
    mode: apply ? "apply" : "dry_run",
    runId,
    startedAt,
    completedAt,
    gitSha: resolveGitSha(),
  });

  if (apply) {
    if (hasBlockingMigrationCollisions(plan.collisions)) {
      throw new Error(
        "Refusing --apply while blocking Source Granularity migration collisions remain.",
      );
    }
    const result = await applyPlan(plan);
    manifest = buildSourceGranularitiesManifest({
      snapshot,
      plan: { ...plan, resume_cursor: result.resume_cursor },
      databaseName,
      mode: "apply",
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      gitSha: resolveGitSha(),
      applied: result.applied,
    });
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const manifestPath = path.join(OUTPUT_DIR, `${runId}.json`);
  const redactedManifest = redactSourceGranularitiesManifestForOutput(manifest);
  await writeFile(
    manifestPath,
    `${JSON.stringify(redactedManifest, null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );

  console.log(
    JSON.stringify(
      {
        database_name: databaseName,
        mode: manifest.mode,
        manifest_path: manifestPath,
        planned: manifest.planned,
        applied: manifest.applied,
        mapping_checksum: manifest.mapping_checksum,
        conflict_summary: manifest.conflict_summary,
        validation_summary: manifest.validation_summary,
        mappings_count: manifest.mappings.length,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

if (process.argv[1]?.endsWith("operations-registry-source-granularities.ts")) {
  main().catch((error) => {
    console.error("Source Granularities migration failed", error);
    process.exitCode = 1;
  });
}
