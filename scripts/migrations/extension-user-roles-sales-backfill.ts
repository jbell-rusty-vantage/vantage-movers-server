/**
 * Remap three leftover Employee Extension Users to Sales.
 *
 *   pnpm migration:extension-user-roles-sales-backfill
 *   pnpm migration:extension-user-roles-sales-backfill -- --report
 *   pnpm migration:extension-user-roles-sales-backfill -- --apply --confirm-production=vantagemovers
 *
 * Default is report. Apply is refused without an explicit confirm flag.
 * Never prints passwords or hashes.
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import { ExtensionUser } from "../../src/models/ExtensionUser.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
} from "./granot-lifecycle-migration.lib.js";
import {
  classifyExtensionUserRoleBackfill,
  EXTENSION_USER_ROLES_SALES_BACKFILL_VERSION,
  summarizeExtensionUserRoleBackfill,
  type ExtensionUserRoleBackfillPlan,
} from "./extension-user-roles-sales-backfill.lib.js";

function parseMode(args: readonly string[]): "report" | "apply" {
  const report = args.includes("--report");
  const apply = args.includes("--apply");
  if (report && apply) {
    throw new Error("Refusing combined --report and --apply flags.");
  }
  if (apply) return "apply";
  return "report";
}

async function loadPlans(): Promise<ExtensionUserRoleBackfillPlan[]> {
  const rows = await ExtensionUser.find({})
    .select({ email: 1, role: 1, token_version: 1 })
    .lean()
    .exec();

  return rows.map((row) =>
    classifyExtensionUserRoleBackfill({
      email: typeof row.email === "string" ? row.email : "",
      role: typeof row.role === "string" ? row.role : "",
      token_version: typeof row.token_version === "number" ? row.token_version : 0,
    }),
  );
}

async function applySalesBackfill(
  plans: ExtensionUserRoleBackfillPlan[],
): Promise<number> {
  let updated = 0;
  for (const plan of plans) {
    if (!plan.will_apply) continue;
    const result = await ExtensionUser.updateOne(
      { email: plan.email, role: "employee" },
      { $set: { role: "sales" }, $inc: { token_version: 1 } },
    );
    updated += result.modifiedCount;
  }
  return updated;
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv);
  const configuredDatabase = getMongoDatabaseName();
  assertGranotLifecycleDatabaseAllowed(configuredDatabase);
  await connectMongo();

  const plans = await loadPlans();
  const summary = summarizeExtensionUserRoleBackfill(plans);
  const report = {
    ok: true,
    mode,
    script_version: EXTENSION_USER_ROLES_SALES_BACKFILL_VERSION,
    database: configuredDatabase,
    summary,
    users: plans.map((plan) => ({
      email: plan.email,
      current_role: plan.current_role,
      planned_role: plan.planned_role,
      token_version: plan.token_version,
      planned_token_version: plan.planned_token_version,
      action: plan.action,
      will_apply: plan.will_apply,
    })),
  };

  if (mode === "apply") {
    assertGranotLifecycleApplyAuthorized({
      args: process.argv,
      databaseName: configuredDatabase,
    });
    const updated = await applySalesBackfill(plans);
    console.log(JSON.stringify({ ...report, updated }, null, 2));
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
