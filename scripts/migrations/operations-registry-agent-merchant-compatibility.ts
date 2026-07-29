/**
 * M2 — Agent and Merchant compatibility backfill.
 *
 * Dry run by default. Apply requires --apply plus production authorization guards.
 *
 * Safe usage (test fixture DB):
 *   TEST_MODE=true pnpm migrations:operations-registry-agent-merchant
 *
 * Production requires explicit confirmation:
 *   pnpm migrations:operations-registry-agent-merchant -- --apply --production-apply --confirm-production-db=vantagemovers
 */
import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db.js";
import { isTestMode } from "../../src/config/domain.js";
import { Agent } from "../../src/models/Agent.js";
import { Merchant } from "../../src/models/Merchant.js";
import {
  assertMigrationApplyAuthorized,
  isMigrationApplyRequested,
} from "../../src/services/employeeBookings/migrationApplySafety.js";
import {
  advanceAgentMerchantResumeCursor,
  agentMigrationUpdateFilter,
  buildAgentMerchantCompatibilityManifest,
  buildAgentMerchantCompatibilityPlan,
  merchantMigrationUpdateFilter,
  type AgentMerchantCompatibilitySnapshot,
} from "./operations-registry-agent-merchant-compatibility.lib.js";
import {
  assertMigrationDatabaseAllowed,
  hasBlockingMigrationCollisions,
} from "./operations-registry-migration.lib.js";

const OUTPUT_DIR = path.join(
  process.cwd(),
  "scripts",
  "output",
  "operations-registry-agent-merchant",
);

function resolveGitSha(): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

function createRunId(): string {
  return `operations-registry-agent-merchant-${Date.now()}`;
}

async function readResumeCursorFlag(args: readonly string[]) {
  const resumeFlag = args.find((arg) => arg.startsWith("--resume-from="));
  if (!resumeFlag) {
    return {
      completed_agent_ids: [],
      completed_merchant_ids: [],
    };
  }
  const resumePath = resumeFlag.slice("--resume-from=".length);
  const raw = await readFile(resumePath, "utf8");
  const parsed = JSON.parse(raw) as {
    resume_cursor?: {
      completed_agent_ids?: string[];
      completed_merchant_ids?: string[];
    };
  };
  return {
    completed_agent_ids: [...(parsed.resume_cursor?.completed_agent_ids ?? [])].sort(),
    completed_merchant_ids: [...(parsed.resume_cursor?.completed_merchant_ids ?? [])].sort(),
  };
}

async function loadSnapshot(): Promise<AgentMerchantCompatibilitySnapshot> {
  const [agents, merchants] = await Promise.all([
    Agent.find(
      {},
      "name active granot_crm_username granot_identity name_aliases",
    )
      .lean()
      .exec(),
    Merchant.find({}, "name name_aliases").lean().exec(),
  ]);

  return {
    agents: agents.map((agent) => ({
      id: String(agent._id),
      name: String(agent.name),
      active: Boolean(agent.active),
      granot_crm_username: agent.granot_crm_username ?? null,
      granot_identity: agent.granot_identity ?? null,
      name_aliases: agent.name_aliases ?? null,
    })),
    merchants: merchants.map((merchant) => ({
      id: String(merchant._id),
      name: String(merchant.name),
      name_aliases: merchant.name_aliases ?? null,
    })),
  };
}

async function applyPlan(
  plan: ReturnType<typeof buildAgentMerchantCompatibilityPlan>,
): Promise<{
  applied: { creates: number; updates: number; no_ops: number; failures: number };
  resume_cursor: ReturnType<typeof advanceAgentMerchantResumeCursor>;
}> {
  let updates = 0;
  let no_ops = 0;
  let failures = 0;
  const appliedAgentIds: string[] = [];
  const appliedMerchantIds: string[] = [];

  for (const agentPlan of plan.agents) {
    const update = agentMigrationUpdateFilter(agentPlan);
    if (!update) {
      no_ops += 1;
      appliedAgentIds.push(agentPlan.agent_id);
      continue;
    }
    try {
      await Agent.updateOne({ _id: agentPlan.agent_id }, update).exec();
      updates += 1;
      appliedAgentIds.push(agentPlan.agent_id);
    } catch {
      failures += 1;
    }
  }

  for (const merchantPlan of plan.merchants) {
    const update = merchantMigrationUpdateFilter(merchantPlan);
    if (!update) {
      no_ops += 1;
      appliedMerchantIds.push(merchantPlan.merchant_id);
      continue;
    }
    try {
      await Merchant.updateOne({ _id: merchantPlan.merchant_id }, update).exec();
      updates += 1;
      appliedMerchantIds.push(merchantPlan.merchant_id);
    } catch {
      failures += 1;
    }
  }

  return {
    applied: { creates: 0, updates, no_ops, failures },
    resume_cursor: advanceAgentMerchantResumeCursor(
      plan.resume_cursor,
      appliedAgentIds,
      appliedMerchantIds,
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
  const plan = buildAgentMerchantCompatibilityPlan(snapshot, resumeCursor);
  const runId = createRunId();
  const completedAt = new Date().toISOString();

  let manifest = buildAgentMerchantCompatibilityManifest({
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
        "Refusing --apply while blocking Agent/Merchant migration collisions remain.",
      );
    }
    const result = await applyPlan(plan);
    manifest = buildAgentMerchantCompatibilityManifest({
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
        manifest_path: manifestPath,
        planned: manifest.planned,
        applied: manifest.applied,
        mapping_checksum: manifest.mapping_checksum,
        conflict_summary: manifest.conflict_summary,
        validation_summary: manifest.validation_summary,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

if (process.argv[1]?.endsWith("operations-registry-agent-merchant-compatibility.ts")) {
  main().catch((error) => {
    console.error("Agent/Merchant compatibility migration failed", error);
    process.exitCode = 1;
  });
}
