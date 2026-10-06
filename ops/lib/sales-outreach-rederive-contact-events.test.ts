import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SalesOutreachConfigurationInput } from "../../src/validation/v1/salesOutreach";
import { applyContactSources } from "../../src/services/salesOutreach/contacts/apply";
import type { SmsSourceRow } from "../../src/services/salesOutreach/contacts/derive";
import { emptyOtherOutboundBreakdown } from "../../src/services/salesOutreach/contacts/repDay";
import {
  ContextBuilder,
  MemoryContactEventStore,
  SESSION,
  memoryTransaction,
  newId,
  outboundCall,
  subjectFacts,
} from "../../src/services/salesOutreach/contacts/testing";
import { callMarks, MemoryRepDayStore } from "../../src/services/salesOutreach/contacts/testingPipeline";
import { activeInspection, fixedConfigurationLoader } from "../../src/services/salesOutreach/reads/testing";
import {
  dryRunContactEventStore,
  kindsOf,
  MAX_REDERIVE_DAYS,
  parseRederiveArgs,
  recountDirtyRepDays,
  rederivePages,
  resolveRederiveRange,
  summarizeRederive,
  type RederiveSourcePager,
} from "./sales-outreach-rederive-contact-events";

/** olr C8: `ops/sales-outreach/rederive-contact-events.ts` — arguments, range, dry run vs apply, idempotency, report. */

const NOW = new Date("2026-10-06T16:00:00Z"); // 12:00 New York
const TODAY = "2026-10-06";
const ALICE = newId();

describe("parseRederiveArgs / resolveRederiveRange", () => {
  test("target required; --from, --kind, --apply parsed; dry run of all kinds by default", () => {
    assert.deepEqual(parseRederiveArgs(["--target=testdb"]), { target: "testdb", from: null, kind: "all", apply: false });
    assert.deepEqual(parseRederiveArgs(["--target=vantagemovers", "--from=2026-10-05", "--kind=call", "--apply", "--allow-schema-drift"]), {
      target: "vantagemovers", from: "2026-10-05", kind: "call", apply: true,
    });
    assert.throws(() => parseRederiveArgs([]), /--target/);
    assert.throws(() => parseRederiveArgs(["--target=a.b"]), /plain database name/);
    assert.throws(() => parseRederiveArgs(["--target=x", "--from=2026-02-30"]), /--from/);
    assert.throws(() => parseRederiveArgs(["--target=x", "--kind=email"]), /--kind/);
    assert.throws(() => parseRederiveArgs(["--target=x", "--force"]), /Unknown argument/);
    assert.deepEqual(kindsOf("all"), ["call", "sms"]);
    assert.deepEqual(kindsOf("sms"), ["sms"]);
  });

  test("--from defaults to yesterday (New York); the instant is the New York start of the day; future and too-old refused", () => {
    assert.deepEqual(resolveRederiveRange({ from: null, today: TODAY }), { from: "2026-10-05", from_instant: new Date("2026-10-05T04:00:00Z") });
    assert.equal(resolveRederiveRange({ from: TODAY, today: TODAY }).from_instant.toISOString(), "2026-10-06T04:00:00.000Z");
    assert.throws(() => resolveRederiveRange({ from: "2026-10-07", today: TODAY }), /after today/);
    assert.throws(() => resolveRederiveRange({ from: "2026-01-01", today: TODAY }), new RegExp(String(MAX_REDERIVE_DAYS)));
  });
});

const desk = (): SalesOutreachConfigurationInput => ({
  controls: { desk_enabled: true, goal_metrics_enabled: true },
  transition: { backfill_lookback_days: 2 },
  goals: {
    roster_version: "roster-1",
    default_scheduled_goal: 100,
    zero_goal_rule: "no_goal_today_excluded_from_denominator",
    rep_work_schedules: [{ agent_id: ALICE, working_days: [1, 2, 3, 4, 5, 6, 7] }],
    effective_day_overrides: [],
  },
});

/** A pager over the memory store: calls by `(started_at, id)`, SMS by id, both at or after `from`. */
function memoryPager(store: MemoryContactEventStore): RederiveSourcePager {
  return {
    async page(kind, from, cursor, limit) {
      const rows =
        kind === "call"
          ? [...store.calls.values()].map((row) => ({ id: row.id, at: row.started_at }))
          : [...store.sms.values()].map((row) => ({ id: row.id, at: row.provider_created_at }));
      const key = (row: { id: string; at: Date }) => (kind === "call" ? `${row.at.toISOString()}|${row.id}` : row.id);
      return rows
        .filter((row) => row.at.getTime() >= from.getTime() && (!cursor || key(row) > key(cursor)))
        .sort((a, b) => key(a).localeCompare(key(b)))
        .slice(0, limit);
    },
  };
}

/**
 * Alice (ext 101) calls five numbers on 2026-10-05 — an eligible New Lead, a Lead not enrolled, a closed
 * subject, a subject activated later that day, a number with no Lead — plus one call on 2026-10-03
 * (before `--from`) and one SMS to the eligible Lead. Events are first derived, then made to look like
 * a pre-C8 build wrote them (no `association_reason`, another fingerprint).
 */
function world() {
  const ctx = new ContextBuilder().link(ALICE, "101");
  const numbers = { eligible: newId(), not_enrolled: newId(), closed: newId(), before: newId(), none: newId() };
  ctx.number("+15550100200", numbers.eligible);
  const eligible = ctx.lead(numbers.eligible, subjectFacts({ workflow: "new" })).subject!;
  ctx.lead(numbers.not_enrolled, null);
  ctx.lead(
    numbers.closed,
    subjectFacts({
      periods: [
        { workflow: "new", started_at: new Date("2026-09-01T12:00:00Z"), ended_at: new Date("2026-10-01T00:00:00Z") },
        { workflow: "closed", started_at: new Date("2026-10-01T00:00:00Z"), ended_at: null },
      ],
    }),
  );
  const before = ctx.lead(numbers.before, subjectFacts({ activation_at: new Date("2026-10-05T19:00:00Z") })).subject!;
  const store = new MemoryContactEventStore(ctx.build());
  const calls = [
    outboundCall("101", numbers.eligible, "2026-10-05T14:00:00Z"),
    outboundCall("101", numbers.not_enrolled, "2026-10-05T14:10:00Z"),
    outboundCall("101", numbers.closed, "2026-10-05T14:20:00Z"),
    outboundCall("101", numbers.before, "2026-10-05T14:30:00Z"),
    outboundCall("101", numbers.none, "2026-10-05T14:40:00Z"),
    outboundCall("101", numbers.not_enrolled, "2026-10-03T14:00:00Z"),
  ];
  for (const row of calls) store.calls.set(row.id, row);
  const sms: SmsSourceRow = {
    id: newId(),
    canonical_logical_id: `800000000001:${newId()}`,
    direction: "outbound",
    status: "sent",
    send_at: new Date("2026-10-05T15:00:00Z"),
    provider_created_at: new Date("2026-10-05T15:00:00Z"),
    counterpart_numbers: ["+15550100200"],
    is_group: false,
    reviewed_agent_id: ALICE,
    identity_state: "reviewed",
    source_revision: 1,
    duplicate_copy: false,
  };
  store.sms.set(sms.id, sms);
  const repDays = new MemoryRepDayStore(store);
  repDays.marks = callMarks(new Date("2026-10-06T15:00:00Z"), new Date("2026-10-06T15:00:00Z"), new Date("2026-10-01T04:00:00Z"));
  return { store, repDays, eligible, before };
}

async function derivePreC8(w: ReturnType<typeof world>) {
  const sources = [
    ...[...w.store.calls.keys()].map((source_id) => ({ source_kind: "call" as const, source_id })),
    ...[...w.store.sms.keys()].map((source_id) => ({ source_kind: "sms" as const, source_id })),
  ];
  await applyContactSources(sources, { now: NOW, queueRepDays: false }, w.store, SESSION);
  for (const [id, event] of w.store.events) {
    const older: Record<string, unknown> = { ...event, input_fingerprint: `pre-c8-${id}` };
    delete older.association_reason;
    w.store.events.set(id, older as typeof event);
  }
  w.store.jobs.clear();
}

const loader = () => fixedConfigurationLoader(activeInspection(desk(), "v-test", 3));
const FROM = resolveRederiveRange({ from: "2026-10-05", today: TODAY }).from_instant;
const EXPECTED_BREAKDOWN = { ...emptyOtherOutboundBreakdown(), no_lead: 1, lead_not_enrolled: 1, lead_closed: 1, before_activation: 1 };

describe("rederivePages + recountDirtyRepDays", () => {
  test("dry run writes nothing and reports would_change by reason, the evaluate nominations and the expected breakdown", async () => {
    const w = world();
    await derivePreC8(w);
    // Before the re-derive the rep-day breakdown is all `unknown` (events derived before C8).
    await recountDirtyRepDays({ keys: [{ agent_id: ALICE, business_day: "2026-10-05" }], loader: loader(), now: NOW, store: w.repDays, transaction: memoryTransaction });
    assert.deepEqual(w.repDays.row(ALICE, "2026-10-05")!.other_outbound, { ...emptyOtherOutboundBreakdown(), unknown: 4 });
    const writes = w.store.writes;

    const dry = await rederivePages({ kinds: kindsOf("all"), from: FROM, now: NOW, pager: memoryPager(w.store), store: dryRunContactEventStore(w.store), transaction: memoryTransaction, pageSize: 2 });
    assert.equal(w.store.writes, writes, "the dry run writes no event");
    assert.equal(w.store.jobs.size, 0, "and enqueues no job");
    assert.ok([...w.store.events.values()].every((event) => event.association_reason === undefined), "stored rows unchanged");
    assert.deepEqual(dry.sources, { call: 5, sms: 1 }, "the 2026-10-03 call is before --from");
    assert.deepEqual([dry.derived, dry.changed, dry.pages, dry.pages_failed], [6, 6, 4, 0]);
    assert.deepEqual(dry.changed_by_reason, { eligible: 2, not_new_quoted: 0, ambiguous: 0, no_lead: 1, lead_not_enrolled: 1, before_activation: 1, lead_closed: 1, excluded: 0 });
    // Subjects whose events move: the eligible Lead (call page and SMS page) and the same-date prior subject.
    assert.equal(dry.evaluations, 3);
    assert.deepEqual(dry.other_outbound_by_day, { "2026-10-05": EXPECTED_BREAKDOWN });
    assert.deepEqual(dry.dirty_rep_days, [{ agent_id: ALICE, business_day: "2026-10-05" }]);
    const summary = summarizeRederive(dry, "dry_run");
    assert.equal(summary.would_change, 6);
    assert.equal(summary.evaluations_would_enqueue, 3);
  });

  test("apply writes each changed event once, nominates evaluations, recounts the rep-day to the expected breakdown; a second run changes nothing", async () => {
    const w = world();
    await derivePreC8(w);
    const writes = w.store.writes;
    const applied = await rederivePages({ kinds: kindsOf("all"), from: FROM, now: NOW, pager: memoryPager(w.store), store: w.store, transaction: memoryTransaction });
    assert.deepEqual([applied.changed, w.store.writes - writes], [6, 6]);
    assert.equal(w.store.jobsOf("outreach_evaluate").length, 3, "one nomination per moved subject per page (calls: the eligible and the same-date prior subject; SMS: the eligible one)");
    const reasons = [...w.store.events.values()].filter((e) => e.business_date === "2026-10-05").map((e) => e.association_reason).sort();
    assert.deepEqual(reasons, ["before_activation", "eligible", "eligible", "lead_closed", "lead_not_enrolled", "no_lead"]);
    const older = [...w.store.events.values()].find((e) => e.business_date === "2026-10-03")!;
    assert.equal(older.association_reason, undefined, "outside the range: untouched");

    const recount = await recountDirtyRepDays({ keys: applied.dirty_rep_days, loader: loader(), now: NOW, store: w.repDays, transaction: memoryTransaction });
    assert.deepEqual(recount, { keys: 1, outcomes: { written: 1, unchanged: 0, no_activity: 0, failed: 0 } });
    const row = w.repDays.row(ALICE, "2026-10-05")!;
    assert.deepEqual(row.other_outbound, EXPECTED_BREAKDOWN, "the stored breakdown is what the dry run predicted");
    assert.equal(row.unattributed, 4);

    const again = await rederivePages({ kinds: kindsOf("all"), from: FROM, now: NOW, pager: memoryPager(w.store), store: w.store, transaction: memoryTransaction });
    assert.deepEqual([again.derived, again.changed, again.evaluations, again.dirty_rep_days.length], [6, 0, 0, 0]);
    assert.deepEqual(summarizeRederive(again, "apply").changed, 0);
  });

  test("--kind=call walks calls only; a failing page is retried once, then counted and skipped", async () => {
    const w = world();
    await derivePreC8(w);
    const calls = await rederivePages({ kinds: kindsOf("call"), from: FROM, now: NOW, pager: memoryPager(w.store), store: dryRunContactEventStore(w.store), transaction: memoryTransaction });
    assert.deepEqual(calls.sources, { call: 5, sms: 0 });

    let failures = 1;
    const flaky = dryRunContactEventStore(w.store);
    const once = { ...flaky, loadEvents: async (ids: readonly string[], session: typeof SESSION) => {
      if (failures-- > 0) throw Object.assign(new Error("moved"), { name: "ContactEventConflict" });
      return flaky.loadEvents(ids, session);
    } };
    const retried = await rederivePages({ kinds: kindsOf("call"), from: FROM, now: NOW, pager: memoryPager(w.store), store: once, transaction: memoryTransaction });
    assert.deepEqual([retried.pages_failed, retried.changed, retried.page_errors], [0, 5, ["ContactEventConflict"]], "the retry succeeds and is counted once");

    const broken = { ...flaky, loadEvents: async () => { throw Object.assign(new Error("down"), { name: "MongoNetworkError" }); } };
    const failed = await rederivePages({ kinds: kindsOf("call"), from: FROM, now: NOW, pager: memoryPager(w.store), store: broken, transaction: memoryTransaction, pageSize: 3 });
    assert.deepEqual([failed.pages, failed.pages_failed, failed.changed, failed.page_errors.length], [2, 2, 0, 4]);
  });
});
