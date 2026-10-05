/**
 * Install the approved FINAL-01 Sales Outreach policy (FAST-TRACK.md step 5, IMPLEMENTATION-PLAN SRV-2).
 *
 *   pnpm outreach:install-policy --target=<database>                       # dry run: prints the plan, writes nothing
 *   pnpm outreach:install-policy --target=<database> --apply               # installs through the PATCH service path
 *   pnpm outreach:install-policy --target=<database> --apply --enable=desk_enabled,goal_metrics_enabled
 *
 * - The target is named and must equal the database this process resolves; unnamed runs are refused.
 * - The value is FINAL-01 cadence/evidence (approval_ref owner-session-2026-10-03-FINAL-01), the
 *   FAST-01 backfill scope, and the M1 roster = every reviewed `sales_rep` identity link effective
 *   now, goal 100 on all seven days. Controls, migration pacing and intake fields are carried over.
 * - Idempotent: if the active version already has this content hash nothing is written; the
 *   Idempotency-Key is derived from (approval, expected revision, content hash) so a retry replays.
 * - It writes through `patchSalesOutreachConfiguration` (version + pointer CAS + audit + command
 *   ledger in one transaction), then re-reads the pointer to verify. Production passes the writer guard.
 */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { getRepIdentityLinkModel } from "../../src/models/RepIdentityLink";
import { csiOperatorActor } from "../../src/services/salesIntelligence/auth";
import { patchSalesOutreachConfiguration } from "../../src/services/salesOutreach/config/commands";
import { createConfigurationLoader } from "../../src/services/salesOutreach/config/load";
import { configurationContentHash } from "../../src/services/salesOutreach/config/store";
import { floridaCalendarDateInputValue } from "../../src/utils/easternTime";
import { salesOutreachConfigurationValueSchema } from "../../src/validation/v1/salesOutreach";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { buildFinal01Configuration, installIdempotencyKey, parseInstallArgs } from "../lib/sales-outreach-final01";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";

async function reviewedSalesRepAgents(at: Date): Promise<string[]> {
  const ids = await getRepIdentityLinkModel().distinct("agent_id", {
    status: "reviewed",
    role_kind: "sales_rep",
    effective_from: { $lte: at },
    $or: [{ effective_to: null }, { effective_to: { $gt: at } }],
  });
  return ids.map((id) => String(id).toLowerCase()).sort();
}

async function main() {
  const args = parseInstallArgs(process.argv.slice(2));
  assertTargetMatchesDatabase(args.target, getMongoDatabaseName());
  await connectMongo();
  const now = new Date();
  const loader = createConfigurationLoader();
  const inspected = await loader.inspect();
  if (inspected.state === "unavailable")
    throw new Error(`Active configuration is unavailable (${inspected.reason}, revision ${inspected.revision}); inspect it in Settings before installing.`);
  const current = inspected.state === "active" ? inspected.value : salesOutreachConfigurationValueSchema.parse({});
  const expected_revision = inspected.state === "active" ? inspected.revision : 0;
  const rosterAgentIds = await reviewedSalesRepAgents(now);
  const value = buildFinal01Configuration({
    current,
    rosterAgentIds,
    installedOn: floridaCalendarDateInputValue(now),
    enableControls: args.enableControls,
  });
  const content_hash = configurationContentHash(value);
  const plan = {
    mode: args.apply ? "apply" : "dry-run",
    database: args.target,
    current_state: inspected.state,
    current_revision: expected_revision,
    content_hash,
    already_installed: inspected.state === "active" && inspected.content_hash === content_hash,
    roster_version: value.goals.roster_version,
    roster_agents: rosterAgentIds,
    controls: value.controls,
    transition: { backfill_lookback_days: value.transition.backfill_lookback_days, backfill_include_upcoming_moves: value.transition.backfill_include_upcoming_moves },
  };
  console.log(JSON.stringify(plan, null, 2));
  if (!rosterAgentIds.length) console.warn("Warning: no reviewed sales_rep identity links; the goal roster is empty.");
  if (plan.already_installed || !args.apply) return;

  await assertProductionWriterMatchesDeployment();
  const { response, replayed } = await patchSalesOutreachConfiguration({
    actor: csiOperatorActor(`sod-install-final01-${content_hash.slice(0, 16)}`),
    idempotency_key: installIdempotencyKey(content_hash, expected_revision),
    expected_revision,
    value,
  });
  const verified = await loader.requireActive();
  if (verified.content_hash !== content_hash || verified.revision !== response.revision)
    throw new Error(`Verification failed: active revision ${verified.revision} hash ${verified.content_hash}`);
  console.log(JSON.stringify({ installed: true, replayed, revision: response.revision, version: response.version, content_hash }));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Sales Outreach policy install failed");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
