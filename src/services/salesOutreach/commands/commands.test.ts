import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { receiverReplaceableByGranot } from "../../granotLifecycle/leadDesiredState";
import { CsiError } from "../../salesIntelligence/auth";
import type { ConfigurationInspection, ConfigurationLoader } from "../config/load";
import { evaluateSubject, localInstant } from "../engine";
import { OutreachError } from "../errors";
import { evaluationAdmissionOf } from "../evaluation/evaluateJob";
import { buildEngineInput, toEngineRestriction } from "../evaluation/inputs";
import { completeConfigurationInput, periodRow, subjectRow, TEST_AGENT_A, TEST_AGENT_B } from "../evaluation/testing";
import { activeInspection } from "../reads/testing";
import { deskLeadKey } from "../subjects/leadFacts";
import { assignSubject } from "./assignment";
import type { DeskCommandDeps } from "./common";
import { commandCallback, setQuotedFollowup } from "./plans";
import { addRestriction, confirmRestriction, liftRestriction, listRestrictions } from "./restrictions";
import { deskActor, MemoryCommandLedger, MemoryDeskCommandStore } from "./testing";

const fixture = (name: string) =>
  JSON.parse(readFileSync(path.resolve(__dirname, "../../../../docs/sales-outreach-desk/contracts/fixtures", name), "utf8")) as {
    cases: Array<Record<string, unknown>>;
  } & Record<string, unknown>;

const TZ = "America/New_York";
const AGENT_C = "c".repeat(24);
const NUMBER = "9".repeat(24);
const at = (iso: string) => new Date(iso);
/** Command instant: a New York local minute on a date. */
const nyAt = (date: string, minute: number) => new Date(localInstant(date, minute, TZ));
const owner = deskActor("owner", "owner-1");
const manager = deskActor("manager", "manager-1");
const repA = deskActor("rep", "rep-user-a", TEST_AGENT_A);
const repB = deskActor("rep", "rep-user-b", TEST_AGENT_B);

type Harness = ReturnType<typeof harness>;

function harness(workflow: "quoted" | "new" = "quoted", configuration = completeConfigurationInput()) {
  const store = new MemoryDeskCommandStore();
  const ledger = new MemoryCommandLedger([store]);
  // Monday 2026-10-05 12:00 New York.
  ledger.now = nyAt("2026-10-05", 720);
  const subject = subjectRow({ assigned_agent_id: TEST_AGENT_A, assignment_revision: 1, contact_number_ids: [NUMBER], lead_revision_seen: 4 });
  store.subjects.set(subject.id, subject);
  const period = periodRow(subject.id, { workflow, start_kind: "transition", priority: workflow === "quoted" ? "1" : "0", started_at: at("2026-10-02T14:00:00Z") });
  store.periods.push(period);
  store.leads.set(deskLeadKey(subject.lead), { receiver_agent_id: TEST_AGENT_A, receiver_agent_source: "granot_username_match", domain_revision: 4, name: "Alice Rep", source_value: null, set_at: null });
  store.repNames = new Map([
    [TEST_AGENT_A, "Alice Rep"],
    [TEST_AGENT_B, "Bob Rep"],
  ]);
  store.numbers.add(NUMBER);
  let inspection: ConfigurationInspection = activeInspection(configuration, "v-cmd", 5);
  const loader: ConfigurationLoader = {
    inspect: async () => inspection,
    load: async () => (inspection.state === "unavailable" ? Promise.reject(new OutreachError("CONFIGURATION_UNAVAILABLE")) : inspection),
    requireActive: async () => {
      if (inspection.state !== "active") throw new OutreachError("CONFIGURATION_UNAVAILABLE");
      return inspection;
    },
  };
  const published: string[][] = [];
  const deps: DeskCommandDeps = { loader, store, run: ledger.run, audit: ledger.audit, publish: async (ids) => void published.push([...ids]) };
  return {
    store,
    ledger,
    subject,
    period,
    published,
    deps,
    setConfiguration: (next: ConfigurationInspection) => {
      inspection = next;
    },
  };
}

const quoted = (h: Harness, actor = repA, overrides: Partial<Parameters<typeof setQuotedFollowup>[0]> = {}) =>
  setQuotedFollowup(
    { actor, subject_id: h.subject.id, idempotency_key: `q-${Math.random()}`, expected_revision: 0, period_id: h.period.id, selected_date: "2026-10-07", replace_active_plan: false, ...overrides },
    h.deps,
  );

async function rejectsWith(promise: Promise<unknown>, code: string, issue?: string) {
  await assert.rejects(promise, (error: unknown) => {
    const actual = error instanceof OutreachError || error instanceof CsiError ? error.code : String(error);
    assert.equal(actual, code);
    if (issue) assert.equal((error as OutreachError).issues?.[0]?.code, issue);
    return true;
  });
}

/* ------------------------------------------------------------------ Quoted follow-up (P04b–P04d) */

test("P04b: current assigned Rep and Owner may set the Quoted date; former, unassigned and page-stale Reps get 404", async () => {
  const p04b = fixture("p04b-quoted-permissions.json");
  for (const c of p04b.cases) {
    const h = harness();
    const lead = h.store.leads.get(deskLeadKey(h.subject.lead))!;
    const current = c.current_assigned_rep === undefined ? "rep-a" : (c.current_assigned_rep as string | null);
    lead.receiver_agent_id = current === "rep-a" ? TEST_AGENT_A : current === "rep-b" ? TEST_AGENT_B : null;
    if (c.id === "generic_admin") continue; // a route guard refusal (403), proven in the route matrix
    if (c.id === "concurrent_revision") {
      await quoted(h, repB, { selected_date: "2026-10-06" });
      await quoted(h, repB, { expected_revision: 1, selected_date: "2026-10-07" });
      await rejectsWith(quoted(h, repB, { expected_revision: c.submitted_revision as number }), "REVISION_CONFLICT");
      continue;
    }
    if (c.id === "post_miss_reschedule") {
      // A Quoted date selected for last Friday was missed; Rep B (now assigned) reschedules without Owner approval.
      h.ledger.now = nyAt("2026-10-02", 600);
      await quoted(h, owner, { selected_date: "2026-10-02" });
      h.ledger.now = nyAt("2026-10-05", 720);
      const result = await quoted(h, repB, { expected_revision: 1, selected_date: "2026-10-06" });
      assert.equal(result.changed, true);
      const history = h.store.plans.filter((p) => p.subject_id === h.subject.id);
      assert.deepEqual(history.map((p) => [p.selected_date, p.status]), [["2026-10-02", "replaced"], ["2026-10-06", "active"]], "the missed plan stays in history");
      assert.equal(h.ledger.audits.at(-1)!.event_kind, "sales_outreach_quoted_followup_set", "post-miss deferral is visible to the Owner");
      continue;
    }
    const actor = c.actor === "owner" ? owner : repA;
    if (c.permitted) {
      const result = await quoted(h, actor);
      assert.equal(result.plan?.selected_date, "2026-10-07", String(c.id));
    } else await rejectsWith(quoted(h, actor), "NOT_FOUND");
  }
});

test("P04a/P04b: the audit carries actor, prior and new selected date, period and effective time; reassignment keeps the schedule; no contact credit", async () => {
  const h = harness();
  await quoted(h, repA, { selected_date: "2026-10-06" });
  const result = await quoted(h, repA, { expected_revision: 1, selected_date: "2026-10-08" });
  assert.deepEqual([result.plan_revision, result.ended_plan?.status], [2, "replaced"]);
  // P04a: the selected date 2026-10-08 is due at 20:00 New York.
  const p04a = fixture("p04a-quoted-deferral.json");
  assert.equal(p04a.selected_date, result.plan?.selected_date);
  assert.equal(result.plan?.due_at, new Date(p04a.due_at as string).toISOString());
  const audit = h.ledger.audits.at(-1)!;
  assert.equal(audit.kind, "followup");
  const current = audit.current as Record<string, unknown>;
  for (const field of fixture("p04b-quoted-permissions.json").required_audit_fields as string[]) {
    if (field === "actor") assert.equal(audit.actor.id, "rep-user-a");
    else if (field === "new_selected_date") assert.equal(current.selected_date, "2026-10-08");
    else assert.ok(current[field] !== undefined && current[field] !== null, field);
  }
  assert.equal(current.prior_selected_date, "2026-10-06");
  // Reassignment to B: the plan is untouched (P04b `reassignment_preserves_schedule`).
  await assignSubject({ actor: owner, subject_id: h.subject.id, idempotency_key: "assign-b", expected_revision: 1, agent_id: TEST_AGENT_B }, h.deps);
  assert.equal(h.store.plans.filter((p) => p.status === "active")[0]!.selected_date, "2026-10-08");
  assert.equal(h.store.jobs.size > 0, true);
  assert.ok([...h.store.jobs.keys()].every((key) => !key.includes("contact")), "a command never supplies contact credit");
});

test("P04c: allowed Quoted dates — today through 19:30 inclusive, future working dates; past and closed dates refused, never shifted", async () => {
  const p04c = fixture("p04c-quoted-allowed-dates.json");
  for (const c of p04c.cases) {
    if (!("allowed" in c)) continue; // engine cases (selected date later closed, early call) are S2's quoted.test.ts
    const config = completeConfigurationInput();
    (config.cadence as { holidays: string[] }).holidays = ["2026-10-09"];
    const h = harness("quoted", config);
    h.ledger.now = c.command_minute === undefined ? nyAt("2026-10-05", 720) : nyAt("2026-10-05", c.command_minute as number);
    const date = c.selected_date_relation === "today" ? "2026-10-05" : c.selected_date_relation === "past" ? "2026-10-04" : c.working_date ? "2026-10-08" : "2026-10-09";
    if (c.allowed) {
      const result = await quoted(h, owner, { selected_date: date });
      assert.equal(result.plan?.selected_date, date, String(c.id));
      assert.equal(result.plan?.due_at, nyAt(date, c.due_minute as number).toISOString(), String(c.id));
    } else {
      const reason = c.selected_date_relation === "past" ? "past_date" : c.working_date === false ? "closed_date" : "after_same_day_cutoff";
      await rejectsWith(quoted(h, owner, { selected_date: date }), "INVALID_INPUT", reason);
      assert.equal(h.store.plans.length, 0, `${String(c.id)}: nothing written`);
    }
  }
});

test("P04d: an explicit selected date governs the engine (the next-working-date default never overrides it)", async () => {
  const h = harness();
  await quoted(h, repA, { selected_date: "2026-10-08" });
  const input = buildEngineInput({
    subject: h.subject,
    periods: h.store.periods,
    plans: h.store.plans,
    restrictions: [],
    assignment_changes: [],
    rep_links: [{ agent_id: TEST_AGENT_A, effective_from: at("2026-01-01T00:00:00Z"), effective_to: null }],
    contact_events: [],
    coverage: { calls_known_complete_through: h.ledger.now, sms_known_complete_through: null },
  });
  const admission = evaluationAdmissionOf(activeInspection(completeConfigurationInput({ cadence_shadow_enabled: true })));
  assert.ok(admission.ok);
  const result = evaluateSubject(input, admission.context.policy, h.ledger.now.toISOString());
  assert.deepEqual([result.quoted?.basis, result.quoted?.selected_date], ["human_selected", "2026-10-08"]);
  assert.equal(fixture("p04d-quoted-no-date.json").explicit_date && (fixture("p04d-quoted-no-date.json").explicit_date as { default_overrides_selected_date: boolean }).default_overrides_selected_date, false);
});

test("Quoted command guards: outside Quoted, stale period, callback replacement intent, closed subject, desk off, unresolvable policy", async () => {
  await rejectsWith(quoted(harness("new"), owner), "INVALID_INPUT", "not_quoted");
  const h = harness();
  await rejectsWith(quoted(h, owner, { period_id: "f".repeat(24) }), "REVISION_CONFLICT", "period_changed");
  await commandCallback({ actor: owner, subject_id: h.subject.id, idempotency_key: "cb", expected_revision: 0, operation: "set", appointment_at: "2026-10-06T19:00:00.000Z", replace_active_plan: false }, h.deps);
  await rejectsWith(quoted(h, owner, { expected_revision: 1 }), "INVALID_INPUT", "replacement_intent_required");
  const replaced = await quoted(h, owner, { expected_revision: 1, replace_active_plan: true });
  assert.deepEqual([replaced.ended_plan?.kind, replaced.ended_plan?.status, replaced.plan?.kind], ["callback", "replaced", "quoted_date"]);
  assert.equal(h.store.plans.filter((p) => p.status === "active").length, 1, "P06f: one active human plan");

  const closed = harness();
  closed.store.subjects.set(closed.subject.id, { ...closed.subject, status: "closed" });
  await rejectsWith(quoted(closed, owner), "INVALID_INPUT", "subject_not_open");
  const off = harness();
  off.setConfiguration(activeInspection({ ...completeConfigurationInput(), controls: { desk_enabled: false } }, "v-off", 6));
  await rejectsWith(quoted(off, owner), "CONFIGURATION_UNAVAILABLE", "desk_disabled");
  const broken = harness();
  broken.setConfiguration(activeInspection({ controls: { desk_enabled: true } }, "v-bootstrap", 2));
  await rejectsWith(quoted(broken, owner), "CONFIGURATION_UNAVAILABLE", "policy_unavailable");
  const missing = harness();
  await rejectsWith(setQuotedFollowup({ actor: owner, subject_id: "not-an-id", idempotency_key: "x", expected_revision: 0, period_id: missing.period.id, selected_date: "2026-10-07", replace_active_plan: false }, missing.deps), "NOT_FOUND");
  await rejectsWith(setQuotedFollowup({ actor: owner, subject_id: "e".repeat(24), idempotency_key: "y", expected_revision: 0, period_id: missing.period.id, selected_date: "2026-10-07", replace_active_plan: false }, missing.deps), "NOT_FOUND");
});

test("idempotency: a replay returns the original committed result and writes nothing; the same key with another payload conflicts", async () => {
  const h = harness();
  const input = { actor: repA, subject_id: h.subject.id, idempotency_key: "same-key", expected_revision: 0, period_id: h.period.id, selected_date: "2026-10-07", replace_active_plan: false };
  const first = await setQuotedFollowup(input, h.deps);
  const writes = { plans: h.store.plans.length, audits: h.ledger.audits.length, jobs: h.store.jobs.size, wakes: h.published.length };
  const replay = await setQuotedFollowup(input, h.deps);
  assert.equal(replay.replayed, true);
  assert.deepEqual({ ...replay, replayed: false }, first);
  assert.deepEqual({ plans: h.store.plans.length, audits: h.ledger.audits.length, jobs: h.store.jobs.size, wakes: h.published.length }, writes);
  await rejectsWith(setQuotedFollowup({ ...input, selected_date: "2026-10-08" }, h.deps), "IDEMPOTENCY_CONFLICT");
  assert.deepEqual(h.published, [[`job:sod:evaluate:${h.subject.id}:plan:r1`]], "after-commit wake of the evaluation job, once");
});

/* ------------------------------------------------------------------ Explicit callback (P06e/P06f) */

const callback = (h: Harness, body: Record<string, unknown>, actor = repA) =>
  commandCallback({ actor, subject_id: h.subject.id, idempotency_key: `cb-${Math.random()}`, expected_revision: 0, ...body } as Parameters<typeof commandCallback>[0], h.deps);

test("P06e: set a Thursday 15:00 New York callback; window 15 elapsed minutes; reschedule and cancel keep the history", async () => {
  const h = harness("new");
  const set = await callback(h, { operation: "set", appointment_at: nyAt("2026-10-08", 900).toISOString(), replace_active_plan: false });
  assert.deepEqual(set.plan?.appointment_local, { business_date: "2026-10-08", minute: 900 });
  assert.equal(set.plan?.window_minutes, fixture("p06e-explicit-callback.json").callback_window_elapsed_minutes);
  assert.equal(set.plan?.due_at, nyAt("2026-10-08", 915).toISOString());
  const moved = await callback(h, { operation: "reschedule", expected_revision: 1, appointment_at: nyAt("2026-10-08", 960).toISOString() });
  assert.deepEqual([moved.plan_revision, moved.ended_plan?.status, h.ledger.audits.at(-1)!.event_kind], [2, "replaced", "sales_outreach_callback_rescheduled"]);
  const cancelled = await callback(h, { operation: "cancel", expected_revision: 2 });
  assert.deepEqual([cancelled.plan, cancelled.ended_plan?.status, cancelled.plan_revision], [null, "cancelled", 3]);
  assert.deepEqual(h.store.plans.map((p) => p.status), ["replaced", "cancelled"]);
  await rejectsWith(callback(h, { operation: "cancel", expected_revision: 3 }), "INVALID_INPUT", "no_active_callback");
  await rejectsWith(callback(h, { operation: "reschedule", expected_revision: 3, appointment_at: nyAt("2026-10-08", 960).toISOString() }), "INVALID_INPUT", "no_active_callback");
  // A later set after the cancel continues the shared revision.
  const again = await callback(h, { operation: "set", expected_revision: 3, appointment_at: nyAt("2026-10-09", 600).toISOString(), replace_active_plan: false });
  assert.equal(again.plan_revision, 4);
});

test("P06e: an after-hours appointment is a permitted explicit human appointment; the engine suspends routine calls until it", async () => {
  const h = harness("new");
  const late = await callback(h, { operation: "set", appointment_at: nyAt("2026-10-06", 1320).toISOString(), replace_active_plan: false });
  assert.equal(late.plan?.appointment_local?.minute, 1320);
  const input = buildEngineInput({
    subject: h.subject,
    periods: h.store.periods,
    plans: h.store.plans,
    restrictions: [],
    assignment_changes: [],
    rep_links: [{ agent_id: TEST_AGENT_A, effective_from: at("2026-01-01T00:00:00Z"), effective_to: null }],
    contact_events: [],
    coverage: { calls_known_complete_through: h.ledger.now, sms_known_complete_through: null },
  });
  const admission = evaluationAdmissionOf(activeInspection(completeConfigurationInput({ cadence_shadow_enabled: true })));
  assert.ok(admission.ok);
  const result = evaluateSubject(input, admission.context.policy, h.ledger.now.toISOString());
  assert.equal(result.callback?.appointment_at, nyAt("2026-10-06", 1320).toISOString());
});

test("P06f: one active human plan; replacing another plan needs explicit intent; restriction precedence blocks a restricted appointment", async () => {
  const p06f = fixture("p06f-precedence-collisions.json");
  assert.equal(p06f.maximum_active_human_plans_per_lead, 1);
  const h = harness();
  await quoted(h, repA);
  await rejectsWith(callback(h, { operation: "set", expected_revision: 1, appointment_at: nyAt("2026-10-06", 900).toISOString(), replace_active_plan: false }), "INVALID_INPUT", "replacement_intent_required");
  const replaced = await callback(h, { operation: "set", expected_revision: 1, appointment_at: nyAt("2026-10-06", 900).toISOString(), replace_active_plan: true });
  assert.equal(replaced.ended_plan?.kind, "quoted_date");
  assert.equal(h.store.plans.filter((p) => p.status === "active").length, p06f.maximum_active_human_plans_per_lead);

  const r = harness("new");
  r.store.restrictions.push({
    id: "7".repeat(24),
    contact_number_id: NUMBER,
    channels: ["call"],
    until: null,
    origin: "intelligence",
    state: "active",
    created_at: at("2026-10-01T00:00:00Z"),
    updated_at: null,
    reason: null,
    confirmed_at: null,
    confirmed_by: null,
    resolved_at: null,
    resolved_by: null,
    resolution_reason: null,
    revision: 1,
    actor: null,
  });
  await rejectsWith(callback(r, { operation: "set", appointment_at: nyAt("2026-10-06", 900).toISOString(), replace_active_plan: false }), "INVALID_INPUT", "restricted_at_appointment");
  r.store.restrictions[0]!.channels = ["text"];
  const smsOnly = await callback(r, { operation: "set", appointment_at: nyAt("2026-10-06", 900).toISOString(), replace_active_plan: false });
  assert.equal(smsOnly.changed, true, "an SMS-only restriction does not block a call appointment");

  await rejectsWith(callback(harness("new"), { operation: "set", appointment_at: nyAt("2026-10-05", 600).toISOString(), replace_active_plan: false }), "INVALID_INPUT", "appointment_in_past");
  const closed = harness("new");
  closed.store.periods[0]!.workflow = "closed";
  await rejectsWith(callback(closed, { operation: "set", appointment_at: nyAt("2026-10-06", 900).toISOString(), replace_active_plan: false }), "INVALID_INPUT", "subject_not_open");
});

test("P06e reassignment: a pending callback carries to the new assigned rep; the former rep loses access (404)", async () => {
  const h = harness("new");
  await callback(h, { operation: "set", appointment_at: nyAt("2026-10-06", 900).toISOString(), replace_active_plan: false });
  await assignSubject({ actor: manager, subject_id: h.subject.id, idempotency_key: "to-b", expected_revision: 1, agent_id: TEST_AGENT_B }, h.deps);
  assert.equal(h.store.plans.filter((p) => p.status === "active" && p.kind === "callback").length, 1);
  await rejectsWith(callback(h, { operation: "cancel", expected_revision: 1 }, repA), "NOT_FOUND");
  const byB = await callback(h, { operation: "reschedule", expected_revision: 1, appointment_at: nyAt("2026-10-06", 960).toISOString() }, repB);
  assert.equal(byB.changed, true);
});

/* ------------------------------------------------------------------ Assignment (IMPL-01) */

test("IMPL-01: Owner/Manager reassignment writes receiver_agent with source manual + EntityChange, updates the subject and wakes lead-change + evaluation", async () => {
  const h = harness("new");
  const result = await assignSubject({ actor: manager, subject_id: h.subject.id, idempotency_key: "a1", expected_revision: 1, agent_id: TEST_AGENT_B }, h.deps);
  assert.deepEqual(
    [result.assigned_agent_id, result.previous_agent_id, result.assignment_revision, result.lead_revision, result.receiver_agent_source, result.changed],
    [TEST_AGENT_B, TEST_AGENT_A, 2, 5, "manual", true],
  );
  const lead = h.store.leads.get(deskLeadKey(h.subject.lead))!;
  assert.deepEqual([lead.receiver_agent_id, lead.receiver_agent_source, lead.source_value, lead.name], [TEST_AGENT_B, "manual", "sales_outreach_desk:manager", "Bob Rep"]);
  assert.deepEqual(h.store.entityChanges, [{ lead: deskLeadKey(h.subject.lead), before: TEST_AGENT_A, after: TEST_AGENT_B, revision_after: 5, command_name: "sales_outreach_assignment", actor_type: "admin" }]);
  const subject = h.store.subjects.get(h.subject.id)!;
  assert.deepEqual([subject.assigned_agent_id, subject.assignment_revision, subject.lead_revision_seen, subject.revision], [TEST_AGENT_B, 2, 5, 2]);
  assert.ok(h.store.jobs.has(`sod:lead-change:${h.subject.lead.model}:${h.subject.lead.id}:r5`));
  assert.ok(h.store.jobs.has(`sod:evaluate:${h.subject.id}:assignment:l5`));
  assert.equal(h.published[0]!.length, 2);
  const audit = h.ledger.audits.at(-1)!;
  assert.deepEqual([audit.kind, audit.event_kind, audit.actor.kind], ["outreach", "sales_outreach_assignment_changed", "manager"]);
  // Granot latest-wins never replaces the manual receiver.
  assert.equal(receiverReplaceableByGranot({ receiver_agent: TEST_AGENT_B, receiver_agent_source: "manual", receiver_agent_set_at: h.ledger.now }, AGENT_C, at("2026-10-06T00:00:00Z")), false);
});

test("IMPL-01: unassign, no-op, unreviewed target, stale revision, stale desk copy, Rep refused", async () => {
  const h = harness("new");
  const unassigned = await assignSubject({ actor: owner, subject_id: h.subject.id, idempotency_key: "u", expected_revision: 1, agent_id: null }, h.deps);
  assert.deepEqual([unassigned.assigned_agent_id, h.store.leads.get(deskLeadKey(h.subject.lead))!.receiver_agent_id, h.store.entityChanges[0]!.actor_type], [null, null, "owner"]);
  const noop = await assignSubject({ actor: owner, subject_id: h.subject.id, idempotency_key: "u2", expected_revision: 2, agent_id: null }, h.deps);
  assert.deepEqual([noop.changed, h.store.entityChanges.length], [false, 1]);
  await rejectsWith(assignSubject({ actor: owner, subject_id: h.subject.id, idempotency_key: "u3", expected_revision: 1, agent_id: TEST_AGENT_B }, h.deps), "REVISION_CONFLICT");
  await rejectsWith(assignSubject({ actor: owner, subject_id: h.subject.id, idempotency_key: "u4", expected_revision: 2, agent_id: AGENT_C }, h.deps), "INVALID_INPUT", "agent_not_reviewed_sales_rep");

  const stale = harness("new");
  stale.store.leads.get(deskLeadKey(stale.subject.lead))!.receiver_agent_id = TEST_AGENT_B; // Granot moved it; the desk has not refreshed yet
  await rejectsWith(assignSubject({ actor: owner, subject_id: stale.subject.id, idempotency_key: "s", expected_revision: 1, agent_id: AGENT_C }, stale.deps), "REVISION_CONFLICT", "assignment_changed");
  await rejectsWith(assignSubject({ actor: repA, subject_id: stale.subject.id, idempotency_key: "r", expected_revision: 1, agent_id: TEST_AGENT_A }, stale.deps), "FORBIDDEN");
  await rejectsWith(assignSubject({ actor: owner, subject_id: "e".repeat(24), idempotency_key: "m", expected_revision: 1, agent_id: null }, stale.deps), "NOT_FOUND");
  assert.equal(stale.store.entityChanges.length, 0, "nothing written by a refused command");
});

/* ------------------------------------------------------------------ Restrictions (P06c) */

function seedAiRestrictions(h: Harness, count: number) {
  for (let i = 0; i < count; i++)
    h.store.restrictions.push({
      id: (i + 1).toString(16).padStart(24, "a"),
      contact_number_id: i === 0 ? NUMBER : (i + 1).toString(16).padStart(24, "8"),
      channels: ["call", "text"],
      until: null,
      origin: "intelligence",
      state: "active",
      created_at: at("2026-09-20T12:00:00Z"),
      updated_at: null,
      reason: null,
      confirmed_at: null,
      confirmed_by: null,
      resolved_at: null,
      resolved_by: null,
      resolution_reason: null,
      revision: 1,
      actor: null,
    });
}

test("P06c: the 15 inert AI-origin restrictions are listed as active and needing review; they stay blocking until confirmed or lifted", async () => {
  const h = harness("new");
  seedAiRestrictions(h, 15);
  h.store.restrictions.push({ ...h.store.restrictions[1]!, id: "0".repeat(23) + "1", state: "resolved", resolved_at: at("2026-09-25T00:00:00Z") });
  const active = await listRestrictions(owner, { state: "active", limit: 10 }, { ...h.deps, now: h.ledger.now });
  assert.equal(active.restrictions.length, 10);
  assert.ok(active.restrictions.every((r) => r.needs_review && r.state === "active" && r.channels.join() === "call,sms"));
  const rest = await listRestrictions(owner, { state: "active", cursor: active.next_cursor!, limit: 10 }, h.deps);
  assert.deepEqual([rest.restrictions.length, rest.next_cursor], [5, null]);
  assert.equal((await listRestrictions(owner, { state: "all", limit: 100 }, h.deps)).restrictions.length, 16);
  await rejectsWith(listRestrictions(manager, { state: "active", limit: 10 }, h.deps), "FORBIDDEN");

  const target = h.store.restrictions[0]!;
  const confirmed = await confirmRestriction({ actor: owner, idempotency_key: "c1", restriction_id: target.id, expected_revision: 1 }, h.deps);
  assert.deepEqual([confirmed.restriction.state, confirmed.restriction.needs_review, confirmed.restriction.revision, confirmed.restriction.confirmed_by], ["active", false, 2, "owner-1"]);
  assert.equal(h.store.jobs.size, 0, "confirming changes no blocking interval");
  assert.equal(toEngineRestriction({ ...target, confirmed_at: h.ledger.now }).released_at, null, "still blocking");
  const again = await confirmRestriction({ actor: owner, idempotency_key: "c2", restriction_id: target.id, expected_revision: 2 }, h.deps);
  assert.equal(again.changed, false);

  const lifted = await liftRestriction({ actor: owner, idempotency_key: "l1", restriction_id: target.id, expected_revision: 2, reason: "Customer asked to be called again" }, h.deps);
  assert.deepEqual([lifted.restriction.state, lifted.restriction.resolution_reason, lifted.restriction.resolved_by, lifted.restriction.revision], ["resolved", "Customer asked to be called again", "owner-1", 3]);
  const interval = toEngineRestriction(h.store.restrictions.find((r) => r.id === target.id)!);
  assert.deepEqual([interval.effective_at, interval.released_at], ["2026-09-20T12:00:00.000Z", h.ledger.now.toISOString()], "the waiver interval stays in history");
  assert.ok(h.store.jobs.has(`sod:evaluate:${h.subject.id}:restriction:${target.id}:r3`), "subjects on the number are re-evaluated");
  assert.deepEqual(h.ledger.audits.map((a) => [a.kind, a.event_kind]), [
    ["restriction", "sales_outreach_restriction_confirmed"],
    ["restriction", "sales_outreach_restriction_lifted"],
  ]);
  await rejectsWith(liftRestriction({ actor: owner, idempotency_key: "l2", restriction_id: target.id, expected_revision: 3, reason: "again" }, h.deps), "INVALID_INPUT", "restriction_not_active");
  await rejectsWith(liftRestriction({ actor: owner, idempotency_key: "l3", restriction_id: h.store.restrictions[2]!.id, expected_revision: 4, reason: "x" }, h.deps), "REVISION_CONFLICT");
  await rejectsWith(liftRestriction({ actor: owner, idempotency_key: "l4", restriction_id: "e".repeat(24), expected_revision: 1, reason: "x" }, h.deps), "NOT_FOUND");
  await rejectsWith(liftRestriction({ actor: manager, idempotency_key: "l5", restriction_id: h.store.restrictions[2]!.id, expected_revision: 1, reason: "x" }, h.deps), "FORBIDDEN");
});

test("P06c: the Owner adds a restriction to a Contact Number (SMS stored as text), and every subject on it is re-evaluated", async () => {
  const h = harness("new");
  const added = await addRestriction({ actor: owner, idempotency_key: "add-1", contact_number_id: NUMBER, channels: ["sms"], until: "2026-10-10T12:00:00.000Z", reason: "Customer asked for no texts" }, h.deps);
  assert.deepEqual([added.restriction.origin, added.restriction.channels, added.restriction.needs_review, added.restriction.until], ["owner", ["sms"], false, "2026-10-10T12:00:00.000Z"]);
  assert.deepEqual(h.store.restrictions[0]!.channels, ["text"]);
  assert.ok([...h.store.jobs.keys()].some((k) => k.startsWith(`sod:evaluate:${h.subject.id}:restriction:`)));
  await rejectsWith(addRestriction({ actor: owner, idempotency_key: "add-2", contact_number_id: "e".repeat(24), channels: ["call"], until: null, reason: "x" }, h.deps), "INVALID_INPUT", "contact_number_not_found");
  await rejectsWith(addRestriction({ actor: owner, idempotency_key: "add-3", contact_number_id: NUMBER, channels: ["call"], until: "2026-10-01T00:00:00.000Z", reason: "x" }, h.deps), "INVALID_INPUT", "until_not_future");
  await rejectsWith(addRestriction({ actor: repA, idempotency_key: "add-4", contact_number_id: NUMBER, channels: ["call"], until: null, reason: "x" }, h.deps), "FORBIDDEN");
});

test("live (SRV-8): committed commands publish scoped outreach_desk hints after commit; replays and no-ops publish nothing", async () => {
  const h = harness();
  const live: unknown[] = [];
  const deps: DeskCommandDeps = { ...h.deps, publishLive: async (p) => void live.push(p) };
  const first = await setQuotedFollowup(
    { actor: repA, subject_id: h.subject.id, idempotency_key: "live-q", expected_revision: 0, period_id: h.period.id, selected_date: "2026-10-07", replace_active_plan: false },
    deps,
  );
  assert.deepEqual(live.pop(), [{ topic: "outreach_desk", subject_ids: [h.subject.id], agent_ids: [TEST_AGENT_A], revision: first.plan_revision, cause: "command" }]);
  await setQuotedFollowup(
    { actor: repA, subject_id: h.subject.id, idempotency_key: "live-q", expected_revision: 0, period_id: h.period.id, selected_date: "2026-10-07", replace_active_plan: false },
    deps,
  );
  assert.equal(live.length, 0, "a replay publishes nothing");
  const moved = await assignSubject({ actor: manager, subject_id: h.subject.id, idempotency_key: "live-a", expected_revision: 1, agent_id: TEST_AGENT_B }, deps);
  assert.deepEqual(live.pop(), [
    { topic: "outreach_desk", subject_ids: [h.subject.id], agent_ids: [TEST_AGENT_A, TEST_AGENT_B], revision: moved.assignment_revision, cause: "command" },
  ]);
});
