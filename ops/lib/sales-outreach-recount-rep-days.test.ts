import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SalesOutreachGoalCredit } from "../../src/config/domain/salesOutreachContacts";
import type { OutreachGoalPublisher } from "../../src/services/salesOutreach/contacts/goalPublish";
import type { MemoryContactEventStore } from "../../src/services/salesOutreach/contacts/testing";
import { memoryTransaction } from "../../src/services/salesOutreach/contacts/testing";
import { callMarks, MemoryRepDayStore } from "../../src/services/salesOutreach/contacts/testingPipeline";
import { activeInspection, fixedConfigurationLoader } from "../../src/services/salesOutreach/reads/testing";
import {
  dryRunRepDayStore,
  MAX_RECOUNT_DAYS,
  parseRecountArgs,
  planRecountKeys,
  resolveRecountRange,
  runRecount,
  summarizeRecount,
  type RecountRowBefore,
} from "./sales-outreach-recount-rep-days";

/** olr C1b: `ops/sales-outreach/recount-rep-days.ts` — arguments, range, key plan, dry run vs apply, idempotency. */

const ALICE = "a".repeat(24);
const BOB = "b".repeat(24);
const CAROL = "c".repeat(24);
const NOW = new Date("2026-10-06T16:00:00Z"); // 12:00 New York
const TODAY = "2026-10-06";

describe("parseRecountArgs", () => {
  test("target required; flags parsed; dry run by default", () => {
    assert.deepEqual(parseRecountArgs(["--target=testdb"]), { target: "testdb", from: null, to: null, materialize_roster: false, apply: false });
    assert.deepEqual(parseRecountArgs(["--target=vantagemovers", "--from=2026-09-20", "--to=2026-10-05", "--materialize-roster", "--apply", "--allow-schema-drift"]), {
      target: "vantagemovers", from: "2026-09-20", to: "2026-10-05", materialize_roster: true, apply: true,
    });
    assert.throws(() => parseRecountArgs([]), /--target/);
    assert.throws(() => parseRecountArgs(["--target=a.b"]), /plain database name/);
    assert.throws(() => parseRecountArgs(["--target=x", "--from=2026-13-01"]), /--from/);
    assert.throws(() => parseRecountArgs(["--target=x", "--to=2026-02-30"]), /--to/);
    assert.throws(() => parseRecountArgs(["--target=x", "--force"]), /Unknown argument/);
  });
});

describe("resolveRecountRange", () => {
  test("defaults to the derivation's coverage day through today; refuses an inverted, future or too-long range", () => {
    assert.deepEqual(resolveRecountRange({ from: null, to: null, today: TODAY, coverage_from_day: "2026-07-07" }), { from: "2026-07-07", to: TODAY });
    assert.deepEqual(resolveRecountRange({ from: "2026-09-20", to: "2026-10-05", today: TODAY, coverage_from_day: null }), { from: "2026-09-20", to: "2026-10-05" });
    assert.throws(() => resolveRecountRange({ from: null, to: null, today: TODAY, coverage_from_day: null }), /--from/);
    assert.throws(() => resolveRecountRange({ from: "2026-10-01", to: "2026-10-07", today: TODAY, coverage_from_day: null }), /after today/);
    assert.throws(() => resolveRecountRange({ from: "2026-10-05", to: "2026-10-04", today: TODAY, coverage_from_day: null }), /after --to/);
    assert.throws(() => resolveRecountRange({ from: "2025-01-01", to: TODAY, today: TODAY, coverage_from_day: null }), new RegExp(String(MAX_RECOUNT_DAYS)));
  });
});

const row = (agent_id: string, business_day: string, extra: Partial<RecountRowBefore> = {}): RecountRowBefore => ({
  agent_id, business_day, count_scope: "all_outbound", actual_confirmed: 0, both_counts: false, ...extra,
});

describe("planRecountKeys", () => {
  test("every row in the range; with --materialize-roster a zero key per roster rep missing on a past day only", () => {
    const rows = [row(BOB, "2026-10-04"), row(ALICE, "2026-10-04"), row(ALICE, "2026-10-06")];
    assert.deepEqual(planRecountKeys({ rows, roster: [ALICE, BOB, CAROL], from: "2026-10-04", to: TODAY, today: TODAY, materialize_roster: false }), [
      { agent_id: ALICE, business_day: "2026-10-04" },
      { agent_id: BOB, business_day: "2026-10-04" },
      { agent_id: ALICE, business_day: TODAY },
    ]);
    assert.deepEqual(planRecountKeys({ rows, roster: [CAROL, ALICE, BOB, CAROL], from: "2026-10-04", to: TODAY, today: TODAY, materialize_roster: true }), [
      { agent_id: ALICE, business_day: "2026-10-04" },
      { agent_id: BOB, business_day: "2026-10-04" },
      { agent_id: CAROL, business_day: "2026-10-04", materialize: true },
      { agent_id: ALICE, business_day: "2026-10-05", materialize: true },
      { agent_id: BOB, business_day: "2026-10-05", materialize: true },
      { agent_id: CAROL, business_day: "2026-10-05", materialize: true },
      { agent_id: ALICE, business_day: TODAY }, // never a zero key today
    ]);
  });
});

/** Events as the contact-event store holds them (only the fields the rep-day recount reads). */
function eventSource(events: Array<{ agent: string; day: string; id: string; credit: SalesOutreachGoalCredit; eligible: boolean }>) {
  const map = new Map(events.map((e) => [e.id, { goal_agent_id: e.agent, business_date: e.day, source_id: e.id, goal_credit: e.credit, goal_scope_eligible: e.eligible }]));
  return { events: map } as unknown as MemoryContactEventStore;
}

describe("runRecount + summarizeRecount", () => {
  const configuration = activeInspection({
    controls: { desk_enabled: true, goal_metrics_enabled: true },
    goals: {
      roster_version: "r1",
      default_scheduled_goal: 100,
      zero_goal_rule: "no_goal_today_excluded_from_denominator",
      rep_work_schedules: [ALICE, BOB].map((agent_id) => ({ agent_id, working_days: [1, 2, 3, 4, 5, 6, 7] })),
      effective_day_overrides: [],
    },
  }, "v-now", 5);
  const loader = fixedConfigurationLoader(configuration);

  test("the dry run writes nothing; apply writes the two-scope counts, keeps the frozen snapshot, materializes; a second run is unchanged", async () => {
    const source = eventSource([
      { agent: ALICE, day: "2026-10-05", id: "c1", credit: "confirmed", eligible: true },
      { agent: ALICE, day: "2026-10-05", id: "c2", credit: "confirmed", eligible: false },
      { agent: ALICE, day: "2026-10-05", id: "c3", credit: "confirmed", eligible: false },
      { agent: ALICE, day: "2026-10-05", id: "w1", credit: "awaiting_confirmation", eligible: true },
    ]);
    const store = new MemoryRepDayStore(source);
    store.marks = callMarks(NOW, NOW, new Date("2026-09-01T04:00:00Z"));
    // Alice's 2026-10-05 row as a pre-C1b build froze it (goal 90 under an older version, no two-scope counts).
    await store.writeRow(
      {
        agent_id: ALICE, business_day: "2026-10-05", count_scope: "all_outbound",
        goal_snapshot: { roster_version: "r0", configuration_version: "v-old", goal: 90, scheduled: true, override: null },
        actual_confirmed: 3, actual_awaiting_confirmation: 1, unattributed: 2, remaining: 87, progress: 0.0333, goal_state: "goal",
        coverage: { state: "complete", known_complete_through: NOW.toISOString(), required_through: NOW.toISOString(), gaps: [] },
        input_fingerprint: "pre-c1b",
      } as never,
      null,
      NOW,
    );
    const rowsBefore = [row(ALICE, "2026-10-05", { actual_confirmed: 3 })];
    const keys = planRecountKeys({ rows: rowsBefore, roster: [ALICE, BOB], from: "2026-10-05", to: "2026-10-05", today: TODAY, materialize_roster: true });
    const run = (apply: boolean, publishGoal: OutreachGoalPublisher = async () => undefined) =>
      runRecount({ keys, loader, now: NOW, store: apply ? store : dryRunRepDayStore(store), transaction: memoryTransaction, publishGoal });

    const dry = summarizeRecount(rowsBefore, await run(false));
    assert.deepEqual([dry.keys, dry.materialize_keys, dry.outcomes, dry.both_counts_added, dry.rows_created, dry.scope_changes], [
      2, 1, { written: 2, unchanged: 0, no_activity: 0, failed: 0 }, 1, 1, 0,
    ]);
    assert.deepEqual(dry.by_day, [{
      business_day: "2026-10-05", rows_before: 1, rows_after: 2, writes: 2,
      before: { actual_confirmed: 3 },
      after: { actual_confirmed: 3, actual_confirmed_all: 3, actual_confirmed_eligible: 1, actual_awaiting_all: 1, actual_awaiting_eligible: 1 },
    }]);
    assert.equal(store.row(BOB, "2026-10-05"), null, "the dry run writes nothing");
    assert.equal((store.row(ALICE, "2026-10-05") as { actual_confirmed_all?: number }).actual_confirmed_all, undefined);
    assert.equal(store.row(ALICE, "2026-10-05")!.publication_revision, 1);

    const published: unknown[] = [];
    const applied = summarizeRecount(rowsBefore, await run(true, async (changes) => void published.push(...changes)));
    assert.deepEqual(applied.outcomes, { written: 2, unchanged: 0, no_activity: 0, failed: 0 });
    assert.equal(published.length, 2, "goal changes are published as the sweep publishes them");
    const alice = store.row(ALICE, "2026-10-05")!;
    assert.deepEqual([alice.actual_confirmed, alice.actual_confirmed_all, alice.actual_confirmed_eligible, alice.actual_awaiting_all, alice.actual_awaiting_eligible], [3, 3, 1, 1, 1]);
    assert.deepEqual([alice.goal_snapshot.configuration_version, alice.goal_snapshot.goal, alice.publication_revision], ["v-old", 90, 2], "the frozen snapshot stays");
    const bob = store.row(BOB, "2026-10-05")!;
    assert.deepEqual([bob.actual_confirmed_all, bob.goal_snapshot.configuration_version, bob.goal_snapshot.goal], [0, "v-now", 100], "a materialized frozen zero row");

    const rowsAfter = [row(ALICE, "2026-10-05", { actual_confirmed: 3, both_counts: true }), row(BOB, "2026-10-05", { both_counts: true })];
    const keysAgain = planRecountKeys({ rows: rowsAfter, roster: [ALICE, BOB], from: "2026-10-05", to: "2026-10-05", today: TODAY, materialize_roster: true });
    const again = summarizeRecount(rowsAfter, await runRecount({ keys: keysAgain, loader, now: NOW, store: dryRunRepDayStore(store), transaction: memoryTransaction, publishGoal: async () => undefined }));
    assert.deepEqual(again.outcomes, { written: 0, unchanged: 2, no_activity: 0, failed: 0 }, "idempotent");
  });

  test("a failed key is counted and keeps its stored count; a scope change is reported", () => {
    const fields = (scope: "all_outbound" | "eligible_new_quoted") => ({
      actual_confirmed: 4, actual_confirmed_all: 9, actual_confirmed_eligible: 4, actual_awaiting_all: 0, actual_awaiting_eligible: 0, count_scope: scope,
    });
    const summary = summarizeRecount(
      [row(ALICE, "2026-10-05", { actual_confirmed: 9, both_counts: true }), row(BOB, "2026-10-05", { actual_confirmed: 7 })],
      [
        { key: { agent_id: ALICE, business_day: "2026-10-05" }, result: { outcome: "written", publication_revision: 3, fields: fields("eligible_new_quoted") } as never },
        { key: { agent_id: BOB, business_day: "2026-10-05" }, result: null },
        { key: { agent_id: CAROL, business_day: "2026-10-05", materialize: true }, result: { outcome: "no_activity", publication_revision: null, fields: fields("all_outbound") } as never },
      ],
    );
    assert.deepEqual([summary.outcomes, summary.scope_changes, summary.both_counts_added, summary.rows_created], [{ written: 1, unchanged: 0, no_activity: 1, failed: 1 }, 1, 0, 0]);
    assert.deepEqual([summary.by_day[0]!.rows_after, summary.by_day[0]!.after.actual_confirmed], [2, 4 + 7]);
  });
});
