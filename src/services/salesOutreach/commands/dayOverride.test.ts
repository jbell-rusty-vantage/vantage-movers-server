import assert from "node:assert/strict";
import { test } from "node:test";
import { csiOperatorActor } from "../../salesIntelligence/auth";
import { patchSalesOutreachConfiguration } from "../config/commands";
import { createConfigurationLoader } from "../config/load";
import { MemoryConfigurationDb } from "../config/testing";
import { OutreachError } from "../errors";
import { completeConfigurationInput, TEST_AGENT_A, TEST_AGENT_B } from "../evaluation/testing";
import { resolveConfiguredGoal } from "../reads/goals";
import { setGoalDayOverride, type DayOverrideDeps } from "./dayOverride";
import { deskActor } from "./testing";

/**
 * P08a effective-dated day overrides and the P09b Manager boundary (prospective absence /
 * partial-day only; historical edits Owner-only), through the persisted configuration CAS path.
 */
const owner = deskActor("owner", "owner-1");
const manager = deskActor("manager", "manager-1");
const rep = deskActor("rep", "rep-user-a", TEST_AGENT_A);
// Monday 2026-10-05 12:00 New York.
const NOW = new Date("2026-10-05T16:00:00.000Z");

async function installed() {
  const db = new MemoryConfigurationDb();
  await patchSalesOutreachConfiguration(
    { actor: csiOperatorActor("install"), idempotency_key: "install", expected_revision: 0, value: completeConfigurationInput() },
    db.deps(),
  );
  const loader = createConfigurationLoader(db.store);
  const run: DayOverrideDeps["run"] = (async (input: Parameters<NonNullable<DayOverrideDeps["run"]>>[0]) =>
    db.run({ ...input, operation: (context) => input.operation({ ...context, now: NOW }) })) as DayOverrideDeps["run"];
  const deps: DayOverrideDeps = { loader, run, audit: db.audit, configStore: db.store, writer: db.writer };
  return { db, loader, deps };
}

test("P08a-1 desk_reps: the roster test is 'is a desk rep now', so an Agent without a schedule entry can take an override and a configured non-rep cannot", async () => {
  const db = new MemoryConfigurationDb();
  const base = completeConfigurationInput();
  await patchSalesOutreachConfiguration(
    { actor: csiOperatorActor("install"), idempotency_key: "install", expected_revision: 0, value: { ...base, goals: { ...base.goals, roster_rule: "desk_reps" } } },
    db.deps(),
  );
  const loader = createConfigurationLoader(db.store);
  const run: DayOverrideDeps["run"] = (async (input: Parameters<NonNullable<DayOverrideDeps["run"]>>[0]) =>
    db.run({ ...input, operation: (context) => input.operation({ ...context, now: NOW }) })) as DayOverrideDeps["run"];
  const asked: string[] = [];
  const deps = (deskReps: readonly string[]): DayOverrideDeps => ({
    loader,
    run,
    audit: db.audit,
    configStore: db.store,
    writer: db.writer,
    isDeskRep: async (agentId) => {
      asked.push(agentId);
      return deskReps.includes(agentId);
    },
  });
  const stranger = "c".repeat(24);
  // TEST_AGENT_B is configured but no longer a desk rep: refused.
  await rejectsWith(override(deps([TEST_AGENT_A, stranger]), owner, { agent_id: TEST_AGENT_B }), "INVALID_INPUT", "agent_not_on_roster");
  // The stranger is a desk rep without a schedule entry: the override is accepted and stored.
  const accepted = await override(deps([TEST_AGENT_A, stranger]), owner, { agent_id: stranger, idempotency_key: "stranger-1" });
  assert.deepEqual([accepted.changed, accepted.revision, accepted.agent_id], [true, 2, stranger]);
  const active = await loader.requireActive();
  assert.deepEqual(active.value.goals.effective_day_overrides!.map((o) => o.agent_id), [stranger]);
  assert.deepEqual(asked, [TEST_AGENT_B, stranger]);
});

const override = (deps: DayOverrideDeps, actor = manager, body: Partial<Parameters<typeof setGoalDayOverride>[0]> = {}) =>
  setGoalDayOverride({ actor, agent_id: TEST_AGENT_B, idempotency_key: `o-${Math.random()}`, expected_revision: 1, business_date: "2026-10-05", goal: 0, reason: "absence", ...body }, deps);

async function rejectsWith(promise: Promise<unknown>, code: string, issue?: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof OutreachError || (error as { code?: string }).code === code, String(error));
    assert.equal((error as { code: string }).code, code);
    if (issue) assert.equal((error as OutreachError).issues?.[0]?.code, issue);
    return true;
  });
}

test("P08a/P09b: a Manager records today's absence (goal 0) through a new configuration version; the goal read shows No goal today", async () => {
  const { db, loader, deps } = await installed();
  const result = await override(deps);
  assert.deepEqual([result.changed, result.revision, result.previous, result.override], [true, 2, null, { goal: 0, reason: "absence" }]);
  assert.deepEqual(db.audits.at(-1), { event_kind: "sales_outreach_goal_day_override_set", revision: 2 });
  const active = await loader.requireActive();
  assert.equal(active.revision, 2);
  const goal = resolveConfiguredGoal(active.value.goals, active.version, TEST_AGENT_B, "2026-10-05");
  assert.deepEqual([goal.goal, goal.goal_state, goal.provenance.basis], [0, "no_goal_today", "override"]);
  // Base roster, schedules and default goal are untouched.
  assert.deepEqual(active.value.goals.rep_work_schedules, (await installedValue()).goals.rep_work_schedules);
  assert.equal(active.value.goals.default_scheduled_goal, 100);
});

async function installedValue() {
  const { loader } = await installed();
  return (await loader.requireActive()).value;
}

test("P09b: a Manager sets a future partial day; a past date is a historical edit, Owner-only; Reps are refused", async () => {
  const { deps } = await installed();
  const partial = await override(deps, manager, { business_date: "2026-10-07", goal: 50, reason: "partial_day" });
  assert.deepEqual([partial.override, partial.revision], [{ goal: 50, reason: "partial_day" }, 2]);
  await rejectsWith(override(deps, manager, { expected_revision: 2, business_date: "2026-10-04" }), "FORBIDDEN", "historical_edit_owner_only");
  const history = await override(deps, owner, { expected_revision: 2, business_date: "2026-10-04", goal: 60, reason: "partial_day" });
  assert.deepEqual([history.changed, history.revision], [true, 3]);
  await rejectsWith(override(deps, rep, { expected_revision: 3 }), "FORBIDDEN");
});

test("day override fences: stale revision, off-roster agent, absence with a goal, identical override writes nothing, replacement keeps the prior in the response", async () => {
  const { db, deps } = await installed();
  await rejectsWith(override(deps, manager, { expected_revision: 7 }), "REVISION_CONFLICT");
  await rejectsWith(override(deps, manager, { agent_id: "c".repeat(24) }), "INVALID_INPUT", "agent_not_on_roster");
  await rejectsWith(override(deps, manager, { goal: 40, reason: "absence" }), "INVALID_INPUT");
  const first = await override(deps, manager, { business_date: "2026-10-06", goal: 40, reason: "partial_day" });
  const versions = db.versions.size;
  const same = await override(deps, manager, { expected_revision: first.revision, business_date: "2026-10-06", goal: 40, reason: "partial_day" });
  assert.deepEqual([same.changed, same.revision, db.versions.size], [false, first.revision, versions]);
  const replaced = await override(deps, owner, { expected_revision: first.revision, business_date: "2026-10-06", goal: 0, reason: "absence" });
  assert.deepEqual([replaced.previous, replaced.override], [{ goal: 40, reason: "partial_day" }, { goal: 0, reason: "absence" }]);
});

test("day override needs installed goals (503) and an active configuration", async () => {
  const db = new MemoryConfigurationDb();
  await patchSalesOutreachConfiguration({ actor: csiOperatorActor("install"), idempotency_key: "bare", expected_revision: 0, value: { controls: { desk_enabled: true } } }, db.deps());
  const deps: DayOverrideDeps = { loader: createConfigurationLoader(db.store), run: db.run, audit: db.audit, configStore: db.store, writer: db.writer };
  await rejectsWith(override(deps), "CONFIGURATION_UNAVAILABLE", "goals_not_installed");
  const empty = new MemoryConfigurationDb();
  await rejectsWith(override({ loader: createConfigurationLoader(empty.store), run: empty.run, audit: empty.audit, configStore: empty.store, writer: empty.writer }), "CONFIGURATION_UNAVAILABLE");
});

test("live (SRV-8): a committed day override publishes outreach_goal for the rep and day plus outreach_configuration; a no-op publishes nothing", async () => {
  const { deps } = await installed();
  const live: unknown[] = [];
  const withLive: DayOverrideDeps = { ...deps, publishLive: async (p) => void live.push(p) };
  await override(withLive, manager, { idempotency_key: "live-o" });
  assert.deepEqual(live.pop(), [
    { topic: "outreach_goal", agent_ids: [TEST_AGENT_B], business_day: "2026-10-05", revision: null, cause: "command" },
    { topic: "outreach_configuration", revision: 2, cause: "configuration" },
  ]);
  await override(withLive, manager, { idempotency_key: "live-o2", expected_revision: 2 });
  assert.equal(live.length, 0, "an identical override changes nothing and publishes nothing");
  // The Owner configuration PATCH publishes the configuration invalidation after commit.
  const { db } = await installed();
  const published: unknown[] = [];
  await patchSalesOutreachConfiguration(
    { actor: csiOperatorActor("owner"), idempotency_key: "edit", expected_revision: 1, value: completeConfigurationInput({ goal_metrics_enabled: true }) },
    { ...db.deps(), publishLive: async (p) => void published.push(p) },
  );
  assert.deepEqual(published, [{ topic: "outreach_configuration", revision: 2, cause: "configuration" }]);
});
