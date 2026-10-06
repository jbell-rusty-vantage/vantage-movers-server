import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutreachActor } from "../auth";
import { OutreachError } from "../errors";
import { QUEUE_KEY_EPOCH, QUEUE_KEY_FAR_FUTURE } from "../evaluation/projection";
import { completeConfigurationInput, subjectRow, TEST_AGENT_A, TEST_AGENT_B } from "../evaluation/testing";
import { objectId } from "../subjects/testing";
import { salesOutreachRepDaysSchema, salesOutreachTeamSchema } from "../../../validation/v1/salesOutreachReads";
import { MemoryDeskReadStore } from "./deskTesting";
import { readRepDays, readTeam } from "./service";
import { activeInspection, fixedConfigurationLoader, MemoryReadStore, repDayRow } from "./testing";

/**
 * S4 change 1 (SPECIFICATION §6.1): rep-scoped cadence counts on GET /rep-days rows — distinct overdue
 * Leads, remaining call attempts due today, remaining SMS sends due today — with the team cards' rule and
 * exposure (the team's Daily call goals rows carry the same values).
 */

// Monday 2026-10-05, 11:00 New York (EDT).
const NOW = new Date("2026-10-05T15:00:00.000Z");
const DAY = "2026-10-05";
const PAST = new Date("2026-10-05T14:30:00.000Z");
const LATER = new Date("2026-10-05T16:00:00.000Z");

const owner: OutreachActor = { role: "owner", actor: { kind: "owner", id: "owner-1", request_id: "r1", run_id: null }, agent_id: null };
const manager: OutreachActor = { role: "manager", actor: { kind: "manager", id: "manager-1", request_id: "r2", run_id: null }, agent_id: null };
const repA: OutreachActor = { role: "rep", actor: { kind: "rep", id: "rep-a", request_id: "r3", run_id: null, agent_id: TEST_AGENT_A } as never, agent_id: TEST_AGENT_A };

type Channel = { status: string; remaining: number | null };
type Spec = { agent: string | null; status?: "active" | "review" | "closed"; call: Channel; sms: Channel; overdueAt?: Date | null; dueAt?: Date };

/**
 * One subject + stored projection with consistent queue keys: an `overdue` channel's earliest deadline is
 * `overdueAt` (default PAST), a `due` channel's is `dueAt` (default LATER); `urgency_due` is the earlier.
 */
function seed(store: MemoryDeskReadStore, spec: Spec) {
  const id = objectId();
  const subject = subjectRow({ id, assigned_agent_id: spec.agent, status: spec.status ?? "active" });
  store.evaluation.subjects.set(id, subject);
  store.setLead(subject.lead, spec.agent);
  const keyOf = (c: Channel) => (c.status === "overdue" ? (spec.overdueAt ?? PAST) : c.status === "due" ? (spec.dueAt ?? LATER) : QUEUE_KEY_FAR_FUTURE);
  const channel = (c: Channel) => ({
    required: c.remaining,
    verified_completed: c.remaining === null ? null : 0,
    remaining: c.remaining,
    due_at: c.status === "due" || c.status === "overdue" ? (spec.dueAt ?? LATER) : null,
    oldest_actionable_due_at: c.status === "overdue" ? (spec.overdueAt ?? PAST) : null,
    status: c.status,
    completion_kind: null,
    coverage: null,
    blocked_reason: c.status === "blocked" ? "contact_restriction" : null,
  });
  store.evaluation.projections.set(id, {
    revision: 1,
    doc: {
      assigned_agent_id: spec.agent,
      subject_status: spec.status ?? "active",
      workflow: "new",
      priority_raw: "0",
      display: { job_no: "J-1", normalized_job_no: "J1", phone: "(555) 010-0000", normalized_phone: "5550100000", name: "Synthetic", name_folded: "synthetic", move_date: null },
      call: channel(spec.call),
      sms: channel(spec.sms),
      status_flags: { needs_contact: true, overdue: Boolean(spec.overdueAt), blocked: false, pending: false, move_date_passed: false, move_date_unknown: true, job_pending: false, advisory_cooldown: false },
      queue_keys: {
        urgency_due: new Date(Math.min(+keyOf(spec.call), +keyOf(spec.sms))),
        urgency_next: QUEUE_KEY_FAR_FUTURE,
        call_due: keyOf(spec.call),
        sms_due: keyOf(spec.sms),
        received_asc: PAST,
        received_desc: PAST,
        last_interaction: QUEUE_KEY_EPOCH,
      },
      exposure: "enforcement",
      computed_as_of: new Date("2026-10-05T14:59:00.000Z"),
      publication_revision: 2,
      result_fingerprint: `fp-${id}`,
      detail: { schedule_day: 1 },
    },
  });
}

const due = (remaining: number | null): Channel => ({ status: "due", remaining });
const overdue = (remaining: number): Channel => ({ status: "overdue", remaining });
const none: Channel = { status: "not_required", remaining: 0 };

/**
 * Alice (108/100): two overdue Leads, call attempts due 2 + 1 + 1, SMS sends due 1 + 1; ignored: a review
 * subject, a closed subject, a blocked channel and a scheduled one. Bob: one due Lead. One Unassigned
 * overdue Lead.
 */
function fixture() {
  const queueStore = new MemoryDeskReadStore();
  seed(queueStore, { agent: TEST_AGENT_A, call: overdue(2), sms: due(1), overdueAt: PAST });
  seed(queueStore, { agent: TEST_AGENT_A, call: due(1), sms: overdue(1), overdueAt: new Date("2026-10-05T13:00:00.000Z") });
  seed(queueStore, { agent: TEST_AGENT_A, call: due(1), sms: { status: "blocked", remaining: 1 } });
  seed(queueStore, { agent: TEST_AGENT_A, call: { status: "scheduled", remaining: 2 }, sms: none });
  seed(queueStore, { agent: TEST_AGENT_A, status: "review", call: overdue(3), sms: due(3), overdueAt: PAST });
  seed(queueStore, { agent: TEST_AGENT_A, status: "closed", call: due(4), sms: due(4) });
  seed(queueStore, { agent: TEST_AGENT_B, call: due(2), sms: none });
  seed(queueStore, { agent: null, call: overdue(1), sms: none, overdueAt: PAST });
  const store = new MemoryReadStore();
  store.rows = [repDayRow({ agent_id: TEST_AGENT_A, business_day: DAY, actual_confirmed: 108, publication_revision: 5 })];
  store.names = new Map([
    [TEST_AGENT_A, "Alice Rep"],
    [TEST_AGENT_B, "Bob Rep"],
  ]);
  store.calls = { scope: "call_log_all_directions", known_complete_through: new Date("2026-10-05T14:57:00Z"), last_finished_at: NOW, last_error_code: null };
  store.derivation = { known_complete_through: new Date("2026-10-05T14:58:00Z"), coverage_from: new Date("2026-10-01T04:00:00Z") };
  // SMS capture on, every reviewed mailbox known through 14:56 (SMS cadence coverage).
  store.mailboxes = [{ scope: "rep_sms:test", known_complete_through: new Date("2026-10-05T14:56:00Z"), last_finished_at: NOW, last_error_code: null }];
  return { queueStore, store };
}

const controls = (cadence: "off" | "shadow" | "enforcement") =>
  completeConfigurationInput({
    goal_metrics_enabled: true,
    rep_sms_capture_enabled: true,
    ...(cadence === "shadow" ? { cadence_shadow_enabled: true } : cadence === "enforcement" ? { cadence_enforcement_enabled: true } : {}),
  });

function deps(cadence: "off" | "shadow" | "enforcement", f = fixture()) {
  return { loader: fixedConfigurationLoader(activeInspection(controls(cadence), `v-${cadence}`)), store: f.store, queueStore: f.queueStore, now: NOW };
}

const metric = (value: number | null, unknown_reason: string | null = null) => ({ value, unknown_reason });
const cadenceOf = (row: { overdue_leads: unknown; calls_due_today: unknown; sms_due_today: unknown }) => ({
  overdue_leads: row.overdue_leads,
  calls_due_today: row.calls_due_today,
  sms_due_today: row.sms_due_today,
});

test("enforcement: a Rep reads its own counts; a 108/100 rep with overdue Leads is still counted; units are attempts/sends vs Leads", async () => {
  const body = salesOutreachRepDaysSchema.parse(await readRepDays(repA, {}, deps("enforcement")));
  assert.deepEqual(body.reps?.map((r) => r.agent_id), [TEST_AGENT_A]);
  const a = body.reps![0]!;
  assert.deepEqual([a.actual_confirmed, a.goal, a.remaining, a.goal_reached], [108, 100, 0, true], "the goal is met");
  assert.deepEqual(cadenceOf(a), { overdue_leads: metric(2), calls_due_today: metric(4), sms_due_today: metric(2) });
});

test("a Rep's foreign agent_id is still refused before any cadence read", async () => {
  const f = fixture();
  let reads = 0;
  const agentCadence = f.queueStore.agentCadence.bind(f.queueStore);
  f.queueStore.agentCadence = async (...args) => {
    reads++;
    return agentCadence(...args);
  };
  await assert.rejects(readRepDays(repA, { agent_id: TEST_AGENT_B }, deps("enforcement", f)), (error: unknown) => {
    assert.ok(error instanceof OutreachError);
    assert.deepEqual([error.code, error.issues?.[0]?.code], ["FORBIDDEN", "foreign_agent"]);
    return true;
  });
  assert.equal(reads, 0);
});

test("Owner/Manager rows and the team's Daily call goals rows carry the same counts; per-rep overdue + Unassigned overdue = the team card", async () => {
  const d = deps("enforcement");
  const repDays = salesOutreachRepDaysSchema.parse(await readRepDays(owner, {}, d));
  assert.deepEqual(
    repDays.reps?.map((r) => [r.agent_id, cadenceOf(r)]),
    [
      [TEST_AGENT_A, { overdue_leads: metric(2), calls_due_today: metric(4), sms_due_today: metric(2) }],
      [TEST_AGENT_B, { overdue_leads: metric(0), calls_due_today: metric(2), sms_due_today: metric(0) }],
    ],
  );
  const team = salesOutreachTeamSchema.parse(await readTeam(manager, {}, d));
  assert.deepEqual(team.daily_call_goals?.map(cadenceOf), repDays.reps?.map(cadenceOf));
  const perRep = team.daily_call_goals!.reduce((sum, r) => sum + (r.overdue_leads.value ?? 0), 0);
  assert.equal(perRep + (team.unassigned.overdue.value ?? 0), team.distinct_overdue_leads.value);
});

test("shadow: overdue Leads are unavailable (cadence_shadow); due attempts/sends are served, as shadow queue rows show them", async () => {
  const body = await readRepDays(repA, {}, deps("shadow"));
  assert.deepEqual(cadenceOf(body.reps![0]!), { overdue_leads: metric(null, "cadence_shadow"), calls_due_today: metric(4), sms_due_today: metric(2) });
  const team = await readTeam(owner, {}, deps("shadow"));
  assert.deepEqual(team.daily_call_goals?.[0]?.overdue_leads, metric(null, "cadence_shadow"));
  assert.deepEqual(team.distinct_overdue_leads, metric(null, "cadence_shadow"));
});

test("cadence disabled: every count is null with cadence_disabled, never 0", async () => {
  const body = await readRepDays(repA, {}, deps("off"));
  const off = metric(null, "cadence_disabled");
  assert.deepEqual(cadenceOf(body.reps![0]!), { overdue_leads: off, calls_due_today: off, sms_due_today: off });
});

test("a due requirement with an unknown remaining count makes that channel's sum unknown (coverage_incomplete), not a partial sum", async () => {
  const f = fixture();
  seed(f.queueStore, { agent: TEST_AGENT_A, call: due(1), sms: due(null) });
  const body = salesOutreachRepDaysSchema.parse(await readRepDays(repA, {}, deps("enforcement", f)));
  assert.deepEqual(cadenceOf(body.reps![0]!), { overdue_leads: metric(2), calls_due_today: metric(5), sms_due_today: metric(null, "coverage_incomplete") });
});

test("an Agent with no active Lead reads 0 once cadence data can be shown", async () => {
  const f = fixture();
  f.queueStore.evaluation.projections.clear();
  const body = await readRepDays(owner, { agent_id: TEST_AGENT_B }, deps("enforcement", f));
  assert.deepEqual(cadenceOf(body.reps![0]!), { overdue_leads: metric(0), calls_due_today: metric(0), sms_due_today: metric(0) });
});

test("coverage-aware overdue (olr A2): a passed deadline coverage cannot prove yet is counted nowhere until coverage reaches it — no dip, no jump", async () => {
  const f = fixture();
  // Alice's call deadline 14:58 has passed at 15:00; call coverage is 14:55 (capture 14:57 − 2 min).
  seed(f.queueStore, { agent: TEST_AGENT_A, call: due(1), sms: none, dueAt: new Date("2026-10-05T14:58:00Z") });
  const before = salesOutreachTeamSchema.parse(await readTeam(manager, {}, deps("enforcement", f)));
  assert.deepEqual(before.distinct_overdue_leads, metric(3), "the unverified deadline is not counted");
  assert.deepEqual(before.daily_call_goals?.find((r) => r.agent_id === TEST_AGENT_A)?.overdue_leads, metric(2));
  const attention = before.leads_needing_attention.rows!.find((r) => r.call.due_at === "2026-10-05T14:58:00.000Z")!;
  assert.deepEqual([attention.call.status, attention.call.verification?.state, attention.status_flags.overdue], ["due", "unverified", false]);

  // Capture through 15:10 ⇒ coverage 15:08, capped at as_of 15:00 ≥ 14:58: the row and every count agree.
  f.store.coverCalls(new Date("2026-10-05T15:10:00Z"));
  const after = salesOutreachTeamSchema.parse(await readTeam(manager, {}, deps("enforcement", f)));
  assert.deepEqual(after.distinct_overdue_leads, metric(4));
  const alice = after.daily_call_goals!.find((r) => r.agent_id === TEST_AGENT_A)!;
  assert.deepEqual(alice.overdue_leads, metric(3));
  const perRep = after.daily_call_goals!.reduce((sum, r) => sum + (r.overdue_leads.value ?? 0), 0);
  assert.equal(perRep + (after.unassigned.overdue.value ?? 0), after.distinct_overdue_leads.value);
  const verified = after.leads_needing_attention.rows!.find((r) => r.call.oldest_actionable_due_at === "2026-10-05T14:58:00.000Z")!;
  assert.deepEqual([verified.call.status, verified.call.verification?.state], ["overdue", "verified"]);
  const overdueRows = after.leads_needing_attention.rows!.filter((r) => r.status_flags.overdue).length;
  assert.equal(overdueRows, after.distinct_overdue_leads.value, "every overdue row is counted and every counted Lead reads overdue");
});

test("coverage-aware overdue (olr A2): with call coverage unknown the overdue figures are coverage_incomplete, never 0; due counts stay served", async () => {
  const f = fixture();
  f.store.derivation = null; // no contact-event derivation yet ⇒ no cadence call coverage
  const team = salesOutreachTeamSchema.parse(await readTeam(owner, {}, deps("enforcement", f)));
  const incomplete = metric(null, "coverage_incomplete");
  assert.deepEqual([team.distinct_overdue_leads, team.quoted_overdue_leads, team.unassigned.overdue], [incomplete, incomplete, incomplete]);
  assert.equal(team.unassigned.count, 1, "the Unassigned count is a count of subjects, still served");
  const repDays = salesOutreachRepDaysSchema.parse(await readRepDays(repA, {}, deps("enforcement", f)));
  assert.deepEqual(cadenceOf(repDays.reps![0]!), { overdue_leads: incomplete, calls_due_today: metric(4), sms_due_today: metric(2) });
  // Shadow still reads cadence_shadow (exposure first).
  assert.deepEqual((await readTeam(owner, {}, deps("shadow", f))).distinct_overdue_leads, metric(null, "cadence_shadow"));
});
