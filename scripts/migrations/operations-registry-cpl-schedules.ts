/**
 * M4 — Temporal CPL cutover schedule seed.
 *
 * Dry run by default. Apply requires --apply plus production authorization guards.
 * Seeds one open-ended America/New_York cutover period per active first-class
 * Source Granularity. Does not infer historical periods or touch Lead fields.
 *
 * Safe usage (test fixture DB):
 *   TEST_MODE=true pnpm migrations:operations-registry-cpl-schedules -- --cutover-date=2026-07-29
 *
 * Production requires explicit confirmation:
 *   pnpm migrations:operations-registry-cpl-schedules -- --apply --production-apply --confirm-production-db=vantagemovers --cutover-date=2026-07-29
 */
import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db.js";
import { isTestMode } from "../../src/config/domain.js";
import { CplRate } from "../../src/models/CplRate.js";
import { getCplRatePeriodModel } from "../../src/models/CplRatePeriod.js";
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
  advanceCplSchedulesResumeCursor,
  buildCplSchedulesManifest,
  buildCplSchedulesPlan,
  cplScheduleMigrationInsertDocument,
  granularityRevisionCompareFilter,
  resolveCutoverBusinessDate,
  SCRIPT_VERSION,
  type CplSchedulesSnapshot,
} from "./operations-registry-cpl-schedules.lib.js";

const OUTPUT_DIR = path.join(
  process.cwd(),
  "scripts",
  "output",
  "operations-registry-cpl-schedules",
);

function resolveGitSha(): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

function createRunId(): string {
  return `operations-registry-cpl-schedules-${Date.now()}`;
}

async function readResumeCursorFlag(args: readonly string[]) {
  const resumeFlag = args.find((arg) => arg.startsWith("--resume-from="));
  if (!resumeFlag) {
    return {
      cursor: { completed_granularity_ids: [] },
      manifest: null,
    };
  }
  const resumePath = resumeFlag.slice("--resume-from=".length);
  const raw = await readFile(resumePath, "utf8");
  const parsed = JSON.parse(raw) as {
    script_version?: string;
    database_name?: string;
    cutover_date?: string;
    mapping_checksum?: string;
    plan?: {
      schedules?: Array<{
        source_granularity_id?: string;
        amount_cents?: number;
        cutover_date?: string;
      }>;
    };
    resume_cursor?: {
      completed_granularity_ids?: string[];
    };
  };
  return {
    cursor: {
      completed_granularity_ids: [
        ...(parsed.resume_cursor?.completed_granularity_ids ?? []),
      ].sort(),
    },
    manifest: parsed,
  };
}

async function loadSnapshot(cutoverDate: string): Promise<CplSchedulesSnapshot> {
  const sourceCompanyModel = getLeadSourceCompanyModel();
  const granularityModel = getLeadSourceGranularityModel();
  const periodModel = getCplRatePeriodModel();

  const [companies, granularities, cplRates, existingPeriods] = await Promise.all([
    sourceCompanyModel.find({}).lean().exec(),
    granularityModel.find({ active: true, archived_at: null }).lean().exec(),
    CplRate.find({}).lean().exec(),
    periodModel
      .find({ archived_at: null }, {
        source_granularity: 1,
        amount_cents: 1,
        effective_from_date: 1,
        archived_at: 1,
      })
      .lean()
      .exec(),
  ]);

  const companyById = new Map(
    companies.map((company) => [String(company._id), company]),
  );

  const embeddedCpls = companies.flatMap((company) =>
    (company.granularities ?? []).map((granularity) => ({
      company_slug: String(company.company_slug),
      granularity_key: String(granularity.granularity_key),
      channel: granularity.channel as "form" | "call",
      local: granularity.local ?? undefined,
      crm_label: String(granularity.crm_label),
      cpl: Number(granularity.cpl ?? 0),
    })),
  );

  const activeGranularities = granularities.flatMap((granularity) => {
    const company = companyById.get(String(granularity.source_company));
    if (!company) {
      return [];
    }
    return [
      {
        id: String(granularity._id),
        source_company_id: String(granularity.source_company),
        company_slug: String(company.company_slug),
        granularity_key: String(granularity.granularity_key),
        channel: granularity.channel as "form" | "call",
        owner_label: String(granularity.owner_label),
        crm_label: String(granularity.crm_label),
        local: granularity.local ?? undefined,
        active: granularity.active === true,
        schedule_revision: Number(granularity.schedule_revision ?? 0),
      },
    ];
  });

  return {
    cutover_date: cutoverDate,
    activeGranularities,
    embeddedCpls,
    cplRates: cplRates.map((rate) => ({
      id: String(rate._id),
      label: String(rate.label),
      source_company: String(rate.source_company),
      lead_type: rate.lead_type as "form" | "call",
      local: rate.local ?? undefined,
      cpl: Number(rate.cpl ?? 0),
    })),
    existingPeriods: existingPeriods.map((period) => ({
      id: String(period._id),
      source_granularity_id: String(period.source_granularity),
      amount_cents: Number(period.amount_cents),
      effective_from_date: String(period.effective_from_date),
      archived_at: period.archived_at ?? null,
    })),
  };
}

async function applyPlan(
  plan: ReturnType<typeof buildCplSchedulesPlan>,
): Promise<{
  applied: { creates: number; updates: number; no_ops: number; failures: number };
  resume_cursor: ReturnType<typeof advanceCplSchedulesResumeCursor>;
}> {
  const granularityModel = getLeadSourceGranularityModel();
  const periodModel = getCplRatePeriodModel();
  let creates = 0;
  let no_ops = 0;
  let failures = 0;
  const appliedGranularityIds: string[] = [];

  for (const schedulePlan of plan.schedules) {
    if (schedulePlan.action === "noop_existing_schedule") {
      no_ops += 1;
      appliedGranularityIds.push(schedulePlan.source_granularity_id);
      continue;
    }
    if (schedulePlan.action === "conflict") {
      failures += 1;
      continue;
    }

    const document = cplScheduleMigrationInsertDocument(schedulePlan);
    const revisionFilter = granularityRevisionCompareFilter(schedulePlan);
    if (!document || !revisionFilter) {
      no_ops += 1;
      continue;
    }

    try {
      const outcome = await withTransaction(async (session) => {
        const existingCount = await periodModel
          .countDocuments({
            source_granularity: schedulePlan.source_granularity_id,
            archived_at: null,
          })
          .session(session)
          .exec();
        if (existingCount > 0) {
          return "noop" as const;
        }

        const revisionResult = await granularityModel
          .updateOne(
            {
              _id: revisionFilter._id,
              schedule_revision: revisionFilter.schedule_revision,
            },
            { $inc: { schedule_revision: 1 } },
            { session },
          )
          .exec();
        if (revisionResult.modifiedCount !== 1) {
          throw new Error(
            `Compare-and-increment failed for granularity ${schedulePlan.source_granularity_id} at revision ${revisionFilter.schedule_revision}.`,
          );
        }

        await periodModel.create([document], { session });
        return "created" as const;
      });

      if (outcome === "created") {
        creates += 1;
      } else {
        no_ops += 1;
      }
      appliedGranularityIds.push(schedulePlan.source_granularity_id);
    } catch {
      failures += 1;
    }
  }

  return {
    applied: { creates, updates: 0, no_ops, failures },
    resume_cursor: advanceCplSchedulesResumeCursor(
      plan.resume_cursor,
      appliedGranularityIds,
    ),
  };
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const apply = isMigrationApplyRequested(process.argv);
  const cutoverDate = resolveCutoverBusinessDate(process.argv);
  const resume = await readResumeCursorFlag(process.argv);

  await connectMongo();
  const databaseName = mongoose.connection.db?.databaseName;
  assertMigrationDatabaseAllowed(databaseName, process.argv);
  if (resume.manifest) {
    if (
      resume.manifest.script_version !== SCRIPT_VERSION ||
      resume.manifest.database_name !== databaseName ||
      resume.manifest.cutover_date !== cutoverDate ||
      !resume.manifest.mapping_checksum
    ) {
      throw new Error(
        "Resume manifest does not match this script, database, or cutover date.",
      );
    }
  }

  if (apply) {
    assertMigrationApplyAuthorized({
      args: process.argv,
      testMode: isTestMode(),
      selectedDatabase: databaseName,
    });
  }

  const snapshot = await loadSnapshot(cutoverDate);
  if (resume.manifest) {
    const priorSchedules = resume.manifest.plan?.schedules ?? [];
    for (const completedId of resume.cursor.completed_granularity_ids) {
      const prior = priorSchedules.find(
        (item) => item.source_granularity_id === completedId,
      );
      const existing = snapshot.existingPeriods.find(
        (period) => period.source_granularity_id === completedId,
      );
      if (
        !prior ||
        !existing ||
        prior.cutover_date !== cutoverDate ||
        (prior.amount_cents !== undefined &&
          prior.amount_cents !== existing.amount_cents)
      ) {
        throw new Error(
          `Resume cursor contains an unverified granularity: ${completedId}.`,
        );
      }
    }
  }
  const plan = buildCplSchedulesPlan(snapshot, resume.cursor);
  const runId = createRunId();
  const completedAt = new Date().toISOString();

  let manifest = buildCplSchedulesManifest({
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
        "Refusing --apply while blocking CPL schedule migration collisions remain.",
      );
    }
    const result = await applyPlan(plan);
    manifest = buildCplSchedulesManifest({
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
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  console.log(
    JSON.stringify(
      {
        database_name: databaseName,
        mode: manifest.mode,
        cutover_date: manifest.cutover_date,
        business_timezone: manifest.business_timezone,
        manifest_path: manifestPath,
        planned: manifest.planned,
        applied: manifest.applied,
        mapping_checksum: manifest.mapping_checksum,
        conflict_summary: manifest.conflict_summary,
        validation_summary: manifest.validation_summary,
        proposed_schedules_count: manifest.proposed_schedules.length,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

if (process.argv[1]?.endsWith("operations-registry-cpl-schedules.ts")) {
  main().catch((error) => {
    console.error("CPL schedule migration failed", error);
    process.exitCode = 1;
  });
}
