/**
 * Install the approved FINAL-01 Sales Outreach policy (FAST-TRACK.md step 5, IMPLEMENTATION-PLAN SRV-2),
 * or flip controls on the installed policy without touching it (olr B5).
 *
 *   pnpm outreach:install-policy --target=<database>                       # dry run: prints the plan, writes nothing
 *   pnpm outreach:install-policy --target=<database> --apply               # policy install through the PATCH service path
 *   pnpm outreach:install-policy --target=<database> --apply --enable=desk_enabled,goal_metrics_enabled   # first install only
 *   pnpm outreach:install-policy --target=<database> --apply --force-policy                 # overwrite an Owner policy edit
 *   pnpm outreach:install-policy --target=<database> --apply --set-controls --enable=cadence_shadow_enabled
 *   pnpm outreach:install-policy --target=<database> --apply --set-controls --disable=cadence_enforcement_enabled
 *   pnpm outreach:install-policy --target=<database> --apply --set-controls --migration-paused=false   # alias --migration=running
 *   pnpm outreach:install-policy --target=<database> --apply --set-controls --intake-admission-at=now
 *   pnpm outreach:install-policy --target=<database> --apply --set-controls --refresh-roster [--drop-unreviewed]
 *
 * - The target is named and must equal the database this process resolves; unnamed runs are refused.
 * - Policy install: FINAL-01 cadence/evidence (approval_ref owner-session-2026-10-03-FINAL-01), the
 *   FAST-01 backfill scope, and the M1 roster = every reviewed `sales_rep` identity link effective
 *   now, goal 100 on all seven days. Controls, migration pacing, intake fields and keys FINAL-01 does
 *   not name are carried over. Once a policy is installed, the run first compares the stored policy
 *   with FINAL-01 (`policyDrift`): any difference (an Owner PATCH, for example a priority-map or intake
 *   rule change) is refused with `{ refused: "policy_drift", drift }` and exit code 3, dry run or not,
 *   unless `--force-policy`. On an installed policy, `--enable`/`--migration-paused`/`--intake-admission-at`
 *   require `--set-controls`.
 * - `--set-controls`: changes only the listed controls (`--enable`, `--disable`), `migration.paused` and
 *   intake admission; cadence, evidence, goals and the backfill scope stay byte-identical.
 *   `--refresh-roster` also adds newly reviewed reps (existing rows and goals kept) and lists reps no
 *   longer reviewed (removed only with `--drop-unreviewed`). Day-to-day control flips belong in Admin
 *   Settings (the same PATCH); this mode is the operator's scripted equivalent.
 * - Idempotent: if the active version already has this content hash nothing is written; the
 *   Idempotency-Key is derived from (mode, expected revision, content hash) so a retry replays.
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
import { floridaCalendarDateInputValue } from "../../src/utils/easternTime";
import { salesOutreachConfigurationValueSchema } from "../../src/validation/v1/salesOutreach";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { parseInstallArgs, planInstall } from "../lib/sales-outreach-final01";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";

/** Exit code of a run refused by the drift guard (nothing written). */
const POLICY_DRIFT_EXIT_CODE = 3;

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
  const planned = planInstall({ args, current, expectedRevision: expected_revision, reviewedAgentIds: rosterAgentIds, installedOn: floridaCalendarDateInputValue(now) });
  const base = { mode: args.apply ? "apply" : "dry-run", database: args.target, current_state: inspected.state, current_revision: expected_revision };
  if (planned.kind === "refused") {
    console.log(JSON.stringify({ ...base, install_mode: "policy_install", refused: planned.refused, drift: planned.drift, hint: planned.hint }, null, 2));
    process.exitCode = POLICY_DRIFT_EXIT_CODE;
    return;
  }
  const { value, content_hash } = planned;
  const plan = {
    ...base,
    install_mode: planned.mode,
    content_hash,
    already_installed: inspected.state === "active" && inspected.content_hash === content_hash,
    forced_policy: planned.forced,
    drift: planned.drift,
    roster_version: value.goals.roster_version,
    roster_agents: (value.goals.rep_work_schedules ?? []).map((row) => row.agent_id),
    reviewed_agents: rosterAgentIds,
    roster_refresh: planned.roster,
    controls: value.controls,
    migration_paused: value.migration.paused,
    intake_admission: { enabled: value.transition.intake_admission_enabled, at: value.transition.intake_admission_at },
    transition: { backfill_lookback_days: value.transition.backfill_lookback_days, backfill_include_upcoming_moves: value.transition.backfill_include_upcoming_moves },
  };
  console.log(JSON.stringify(plan, null, 2));
  if (!rosterAgentIds.length) console.warn("Warning: no reviewed sales_rep identity links; a policy install leaves the goal roster empty.");
  if (plan.already_installed || !args.apply) return;

  await assertProductionWriterMatchesDeployment();
  const { response, replayed } = await patchSalesOutreachConfiguration({
    actor: csiOperatorActor(planned.request_id),
    idempotency_key: planned.idempotency_key,
    expected_revision,
    value,
  });
  const verified = await loader.requireActive();
  if (verified.content_hash !== content_hash || verified.revision !== response.revision)
    throw new Error(`Verification failed: active revision ${verified.revision} hash ${verified.content_hash}`);
  console.log(JSON.stringify({ installed: true, install_mode: planned.mode, replayed, revision: response.revision, version: response.version, content_hash }));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Sales Outreach policy install failed");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
