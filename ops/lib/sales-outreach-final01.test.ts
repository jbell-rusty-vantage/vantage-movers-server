import assert from "node:assert/strict";
import { test } from "node:test";
import { csiOperatorActor } from "../../src/services/salesIntelligence/auth";
import { patchSalesOutreachConfiguration } from "../../src/services/salesOutreach/config/commands";
import { createConfigurationLoader } from "../../src/services/salesOutreach/config/load";
import { configurationContentHash } from "../../src/services/salesOutreach/config/store";
import { MemoryConfigurationDb } from "../../src/services/salesOutreach/config/testing";
import { canonicalJson } from "../../src/services/durableWork/checksum";
import { salesOutreachConfigurationValueSchema, type SalesOutreachConfigurationValue } from "../../src/validation/v1/salesOutreach";
import {
  buildFinal01Configuration,
  FINAL01_APPROVAL_REF,
  installIdempotencyKey,
  parseInstallArgs,
  planInstall,
} from "./sales-outreach-final01";
const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const bootstrap = () => salesOutreachConfigurationValueSchema.parse({});

/**
 * The installer script's decision and write path over an in-memory configuration store: inspect,
 * `planInstall`, then the same PATCH service call with the plan's Idempotency-Key. Returns the plan
 * and the write (null when refused, a dry run, or the content is already active).
 */
function installerOver(db: MemoryConfigurationDb) {
  const loader = createConfigurationLoader(db.store);
  return {
    loader,
    async run(argv: string[], options: { reviewed?: string[]; installedOn?: string } = {}) {
      const args = parseInstallArgs(["--target=testvantagemovers", ...argv]);
      const inspected = await loader.inspect();
      assert.notEqual(inspected.state, "unavailable");
      const current = inspected.state === "active" ? inspected.value : bootstrap();
      const expectedRevision = inspected.state === "active" ? inspected.revision : 0;
      const plan = planInstall({ args, current, expectedRevision, reviewedAgentIds: options.reviewed ?? [A], installedOn: options.installedOn ?? "2026-10-05" });
      if (plan.kind === "refused" || !args.apply) return { plan, write: null };
      if (inspected.state === "active" && inspected.content_hash === plan.content_hash) return { plan, write: null };
      const write = await patchSalesOutreachConfiguration(
        { actor: csiOperatorActor(plan.request_id), idempotency_key: plan.idempotency_key, expected_revision: expectedRevision, value: plan.value },
        db.deps(),
      );
      return { plan, write };
    },
    /** An Owner PATCH from Settings: GET, edit, PATCH with the read revision. */
    async ownerPatch(edit: (value: SalesOutreachConfigurationValue) => SalesOutreachConfigurationValue, key: string) {
      const active = await loader.requireActive();
      return patchSalesOutreachConfiguration(
        { actor: csiOperatorActor(`owner-${key}`), idempotency_key: key, expected_revision: active.revision, value: edit(structuredClone(active.value)) },
        db.deps(),
      );
    },
  };
}

test("unpausing through --set-controls: one new revision from the installed one, only migration.paused changes, idempotent", async () => {
  const db = new MemoryConfigurationDb();
  const installer = installerOver(db);
  assert.equal((await installer.run(["--apply"])).write?.response.revision, 1);
  const installed = await installer.loader.requireActive();
  assert.equal(installed.value.migration.paused, true, "the bootstrap default stays paused");
  assert.equal((await installer.run(["--apply", "--set-controls", "--migration=running"])).write?.response.revision, 2);
  const running = await installer.loader.requireActive();
  assert.deepEqual(running.value.migration, { ...installed.value.migration, paused: false });
  assert.equal((await installer.run(["--apply", "--set-controls", "--migration-paused=false"])).write, null, "re-running writes nothing");
  assert.equal((await installer.run(["--apply"])).write, null, "a policy install without flags keeps the installed state");
  assert.equal((await installer.run(["--apply", "--set-controls", "--migration=paused"])).write?.response.revision, 3);
});

/** Lane A (A0) adds the optional root `operations` namespace; on a branch without it the strict root schema refuses the key. */
const SCHEMA_HAS_OPERATIONS = "operations" in (salesOutreachConfigurationValueSchema.shape as Record<string, unknown>);
const withOperations = (value: SalesOutreachConfigurationValue) =>
  ({ ...value, operations: { evaluate_drain_concurrency: 2 } }) as unknown as SalesOutreachConfigurationValue;

test(
  "B5 review: an Owner-PATCHed operations namespace survives a plain and a forced policy install",
  { skip: SCHEMA_HAS_OPERATIONS ? false : "needs lane A's optional root `operations` namespace (A0)" },
  async () => {
    const db = new MemoryConfigurationDb();
    const installer = installerOver(db);
    await installer.run(["--apply", "--enable=desk_enabled"]);
    await installer.ownerPatch((value) => withOperations(value), "owner-ops4");
    // A plain install after a roster change (not drift) writes and keeps operations.
    const plain = await installer.run(["--apply"], { reviewed: [A, B], installedOn: "2026-10-09" });
    assert.equal(plain.write?.response.revision, 3);
    assert.deepEqual(((await installer.loader.requireActive()).value as unknown as Record<string, unknown>).operations, { evaluate_drain_concurrency: 2 });
    // A forced install over an Owner cadence edit keeps operations too.
    await installer.ownerPatch((value) => {
      value.cadence.intake_default_rule!.granot_created = "new";
      return value;
    }, "owner-d3");
    const forced = await installer.run(["--apply", "--force-policy"], { reviewed: [A, B], installedOn: "2026-10-09" });
    assert.equal(forced.write?.response.revision, 5);
    const after = (await installer.loader.requireActive()).value;
    assert.equal(after.cadence.intake_default_rule?.granot_created, "review");
    assert.deepEqual((after as unknown as Record<string, unknown>).operations, { evaluate_drain_concurrency: 2 });
  },
);

test("B5: --refresh-roster adds new reviewed agents and keeps existing goals", async () => {
  const C = "cccccccccccccccccccccccc";
  const db = new MemoryConfigurationDb();
  const installer = installerOver(db);
  await installer.run(["--apply", "--enable=desk_enabled,goal_metrics_enabled"], { reviewed: [A, B] });
  await installer.ownerPatch((value) => {
    value.goals.rep_work_schedules![0]!.scheduled_goal = 40;
    value.goals.rep_work_schedules![1]!.working_days = [1, 2, 3, 4, 5];
    value.goals.effective_day_overrides = [{ agent_id: B, business_date: "2026-10-08", goal: 0, reason: "absence" }];
    return value;
  }, "owner-goals");
  const before = await installer.loader.requireActive();
  // B is no longer reviewed, C is newly reviewed (upper-case id from the link is normalised).
  const kept = await installer.run(["--apply", "--set-controls", "--refresh-roster"], { reviewed: [A, C.toUpperCase()], installedOn: "2026-10-09" });
  assert.equal(kept.plan.kind, "write");
  if (kept.plan.kind !== "write") return;
  assert.deepEqual(kept.plan.roster, { added: [C], unreviewed: [B], dropped: [] });
  const grown = await installer.loader.requireActive();
  assert.deepEqual(grown.value.goals.rep_work_schedules, [
    { agent_id: A, working_days: [1, 2, 3, 4, 5, 6, 7], scheduled_goal: 40 },
    { agent_id: B, working_days: [1, 2, 3, 4, 5], scheduled_goal: null },
    { agent_id: C, working_days: [1, 2, 3, 4, 5, 6, 7], scheduled_goal: null },
  ]);
  assert.equal(grown.value.goals.effective_day_overrides?.length, 1);
  assert.notEqual(grown.value.goals.roster_version, before.value.goals.roster_version);
  assert.equal(grown.value.evidence.roster_version, grown.value.goals.roster_version);
  assert.equal(canonicalJson(grown.value.cadence), canonicalJson(before.value.cadence));
  assert.deepEqual(grown.value.controls, before.value.controls);
  // Re-running with the same reviewed set changes nothing.
  assert.equal((await installer.run(["--apply", "--set-controls", "--refresh-roster"], { reviewed: [A, C], installedOn: "2026-10-10" })).write, null);
  // --drop-unreviewed removes B and B's day override.
  const dropped = await installer.run(["--apply", "--set-controls", "--refresh-roster", "--drop-unreviewed"], { reviewed: [A, C], installedOn: "2026-10-10" });
  assert.equal(dropped.plan.kind === "write" && dropped.plan.roster?.dropped.join(), B);
  const slim = await installer.loader.requireActive();
  assert.deepEqual(slim.value.goals.rep_work_schedules?.map((r) => r.agent_id), [A, C]);
  assert.deepEqual(slim.value.goals.effective_day_overrides, []);
  assert.equal(slim.value.goals.rep_work_schedules?.[0]?.scheduled_goal, 40);
});

test("installing through the PATCH path is idempotent: same content writes nothing new, a lost response replays", async () => {
  const db = new MemoryConfigurationDb();
  const loader = createConfigurationLoader(db.store);
  const install = async (rosterAgentIds: string[]) => {
    const inspected = await loader.inspect();
    const current = inspected.state === "active" ? inspected.value : bootstrap();
    const expected_revision = inspected.state === "active" ? inspected.revision : 0;
    const value = buildFinal01Configuration({ current, rosterAgentIds, installedOn: "2026-10-04", enableControls: ["desk_enabled", "goal_metrics_enabled"] });
    const hash = configurationContentHash(value);
    if (inspected.state === "active" && inspected.content_hash === hash) return { skipped: true as const };
    const key = installIdempotencyKey(hash, expected_revision);
    const first = await patchSalesOutreachConfiguration({ actor: csiOperatorActor("install"), idempotency_key: key, expected_revision, value }, db.deps());
    return { skipped: false as const, first, key, value, expected_revision };
  };
  const installed = await install([A]);
  assert.equal(installed.skipped, false);
  if (installed.skipped) return;
  assert.equal(installed.first.response.revision, 1);
  const active = await loader.requireActive();
  assert.equal(active.approval_ref, FINAL01_APPROVAL_REF);
  assert.equal(active.value.controls.goal_metrics_enabled, true);
  // Re-run: nothing to do.
  assert.deepEqual(await install([A]), { skipped: true });
  // A lost-response retry of the same command replays the committed result.
  const replay = await patchSalesOutreachConfiguration(
    { actor: csiOperatorActor("install"), idempotency_key: installed.key, expected_revision: installed.expected_revision, value: installed.value },
    db.deps(),
  );
  assert.equal(replay.replayed, true);
  assert.equal(db.versions.size, 1);
  // A newly reviewed rep changes the roster → a new revision.
  const grown = await install([A, B]);
  assert.equal(grown.skipped || grown.first.response.revision, 2);
});
