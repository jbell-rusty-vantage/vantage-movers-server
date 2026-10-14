/** Add/disable only the approved optional Pool namespace. Prospective admission requires an explicit flag. */
import mongoose from "mongoose";

async function main() {
  const args = process.argv.slice(2), apply = args.includes("--apply");
  if (args.some(a => a !== "--apply" && !/^--(target|enabled|admission-enabled|expected-revision|approval-ref)=/.test(a))) throw new Error("Unknown configuration option; schema drift overrides are not allowed");
  const option = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const target = option("target"), enabled = option("enabled"), admission = option("admission-enabled") ?? "false", expectedRevision = Number(option("expected-revision")), approvalRef = option("approval-ref");
  if (!target || !["true", "false"].includes(enabled ?? "") || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !approvalRef) throw new Error("Require --target, --enabled=true|false, --expected-revision and --approval-ref");
  if (!["true", "false"].includes(admission) || enabled === "false" && admission === "true") throw new Error("Require admission-enabled=false when Pool is disabled");
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime.js");
  const { connectMongo } = await import("../../src/db.js");
  const { createConfigurationLoader } = await import("../../src/services/salesOutreach/config/load.js");
  const { patchSalesOutreachConfiguration } = await import("../../src/services/salesOutreach/config/commands.js");
  const { csiOperatorActor } = await import("../../src/services/salesIntelligence/auth.js");
  const { assertProductionWriterMatchesDeployment } = await import("../lib/production-writer-guard.js");
  if (getMongoDatabaseName() !== target) throw new Error("Named target differs from resolved database");
  await connectMongo();
  const configuration = await createConfigurationLoader().requireActive();
  if (configuration.revision !== expectedRevision) throw new Error("Configuration revision changed; inspect before retrying");
  const pool = { enabled: enabled === "true", admission_enabled: admission === "true", policy_version: "pool-approved-2026-10-14", approval_ref: approvalRef! };
  const value = { ...configuration.value, pool };
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry_run", database: target, expected_revision: expectedRevision, prior_pool: configuration.value.pool ?? null, pool,
    changed_namespace: "pool", automatic_admission_enabled: pool.admission_enabled, prospective_admission_explicit: admission === "true", existing_policy_preserved: true }, null, 2));
  if (!apply) return;
  await assertProductionWriterMatchesDeployment({ argv: [] });
  const result = await patchSalesOutreachConfiguration({ actor: csiOperatorActor("pool-production-configuration"),
    idempotency_key: `pool-policy:${expectedRevision}:${enabled}:${admission}:${approvalRef}`, expected_revision: expectedRevision, value });
  console.log(JSON.stringify({ ...result.response, replayed: result.replayed }, null, 2));
}
main().catch(error => { console.error(error instanceof Error && /^(Require|Unknown|Named|Configuration)/.test(error.message) ? error.message : "Pool configuration refused or failed; private details suppressed"); process.exitCode = 1; }).finally(() => mongoose.disconnect());
