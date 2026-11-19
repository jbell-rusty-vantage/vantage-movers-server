import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { receiverReplaceableByGranot } from "../../granotLifecycle/leadDesiredState";
import { CsiError } from "../../salesIntelligence/auth";
import type { ConfigurationInspection, ConfigurationLoader } from "../config/load";
import { localInstant } from "../engine";
import { OutreachError } from "../errors";
import { completeConfigurationInput, periodRow, subjectRow, TEST_AGENT_A, TEST_AGENT_B } from "../evaluation/testing";
import { activeInspection } from "../reads/testing";
import { deskLeadKey, type DeskLeadRef } from "../subjects/leadFacts";
import { assignSubject, type AssignmentDeps, type StaleRefreshOutcome } from "./assignment";
import { commandCallback, setQuotedFollowup } from "./plans";
import { addRestriction } from "./restrictions";
import { deskActor, MemoryCommandLedger, MemoryDeskCommandStore } from "./testing";

const fixture = (name: string) =>
  JSON.parse(readFileSync(path.resolve(__dirname, "../testSupport/contracts/fixtures", name), "utf8")) as {
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
  const refreshes: string[] = [];
  let refreshOverride: StaleRefreshOutcome | null = null;
  /**
   * The B9 stale-copy refresh over the in-memory command store: the subject takes its Lead's effective
   * receiver (a reviewed sales_rep, else Unassigned) and `assignment_revision` bumps, as the Lead-change
   * sync does. The real `refreshStaleAssignment` is proven below and in the replica.
   */
  const refreshStale = async (lead: DeskLeadRef): Promise<StaleRefreshOutcome> => {
    refreshes.push(deskLeadKey(lead));
    if (refreshOverride) return refreshOverride;
    const row = [...store.subjects.values()].find((s) => deskLeadKey(s.lead) === deskLeadKey(lead));
    const facts = store.leads.get(deskLeadKey(lead));
    const effective = facts?.receiver_agent_id && store.repNames.has(facts.receiver_agent_id) ? facts.receiver_agent_id : null;
    if (!row || !facts || row.assigned_agent_id === effective) return "unchanged";
    store.subjects.set(row.id, { ...row, assigned_agent_id: effective, assignment_revision: row.assignment_revision + 1, lead_revision_seen: facts.domain_revision, revision: row.revision + 1 });
    return "refreshed";
  };
  const live: unknown[] = [];
  const deps: AssignmentDeps = {
    loader,
    store,
    run: ledger.run,
    audit: ledger.audit,
    publish: async (ids) => void published.push([...ids]),
    publishLive: async (p) => void live.push(p),
    refreshStale,
  };
  return {
    store,
    ledger,
    subject,
    period,
    published,
    refreshes,
    live,
    deps,
    overrideRefresh: (outcome: StaleRefreshOutcome | null) => {
      refreshOverride = outcome;
    },
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

test("Pool rejects own-assigned and coordinator callback/Quoted edits; ordinary commands resume after exit", async () => {
  for (const actor of [repA, owner, manager]) {
    const h = harness();
    h.store.leads.get(deskLeadKey(h.subject.lead))!.granot_priority = "9";
    await rejectsWith(quoted(h, actor), "INVALID_INPUT", "pool_shared_schedule");
    await rejectsWith(commandCallback({ actor, subject_id: h.subject.id, idempotency_key: "pool-callback", expected_revision: 0,
      operation: "set", appointment_at: "2026-10-06T19:00:00.000Z", replace_active_plan: false }, h.deps), "INVALID_INPUT", "pool_shared_schedule");
    assert.equal(h.store.plans.length, 0);
    h.store.leads.get(deskLeadKey(h.subject.lead))!.granot_priority = "1";
    assert.equal((await quoted(h, actor)).plan?.kind, "quoted_date");
  }
});

async function rejectsWith(promise: Promise<unknown>, code: string, issue?: string) {
  await assert.rejects(promise, (error: unknown) => {
    const actual = error instanceof OutreachError || error instanceof CsiError ? error.code : String(error);
    assert.equal(actual, code);
    if (issue) assert.equal((error as OutreachError).issues?.[0]?.code, issue);
    return true;
  });
}

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

/* ------------------------------------------------------------------ Assignment (IMPL-01) */

test("IMPL-01: Owner/Manager reassignment writes receiver_agent with source manual + EntityChange, updates the subject and wakes lead-change + evaluation", async () => {
  const h = harness("new");
  const input = { actor: manager, subject_id: h.subject.id, idempotency_key: "a1", expected_revision: 1, agent_id: TEST_AGENT_B };
  const result = await assignSubject(input, h.deps);
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
  const replay = await assignSubject(input, h.deps);
  assert.deepEqual(replay, { ...result, replayed: true });
  assert.deepEqual(
    [h.store.entityChanges.length, h.ledger.audits.length, h.ledger.ledger.size, h.store.jobs.size, h.published.length, h.live.length],
    [1, 1, 1, 2, 1, 1],
  );
  // Granot latest-wins never replaces the manual receiver.
  assert.equal(receiverReplaceableByGranot({ receiver_agent: TEST_AGENT_B, receiver_agent_source: "manual", receiver_agent_set_at: h.ledger.now }, AGENT_C, at("2026-10-06T00:00:00Z")), false);
});

/* ------------------------------------------------------------------ Stale desk copy: refresh, then 409 (olr B9) */

/** The Lead row as stored now (a refused command restores a cloned map, so never hold the row across commands). */
const leadOf = (h: Harness) => h.store.leads.get(deskLeadKey(h.subject.lead))!;

/** The detail read's `assignment.in_sync` rule (reads/detail.ts) over the in-memory stores. */
function inSync(h: Harness) {
  const subject = h.store.subjects.get(h.subject.id)!;
  const receiver = h.store.leads.get(deskLeadKey(subject.lead))!.receiver_agent_id;
  return subject.assigned_agent_id === (receiver && h.store.repNames.has(receiver) ? receiver : null);
}

async function refusedRefreshed(promise: Promise<unknown>) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof OutreachError);
    assert.equal(error.code, "REVISION_CONFLICT");
    assert.deepEqual(error.issues, [{ path: "assignment", code: "assignment_changed", message: "refreshed" }]);
    return true;
  });
}

test("B9: a stale desk copy answers 409 assignment_changed after refreshing the subject; the re-read shows the Lead's receiver and the retry with the new revision succeeds", async () => {
  const h = harness("new");
  Object.assign(leadOf(h), { receiver_agent_id: TEST_AGENT_B, domain_revision: 5 }); // Granot moved it; the Lead-change job has not drained
  assert.equal(inSync(h), false);

  await refusedRefreshed(assignSubject({ actor: owner, subject_id: h.subject.id, idempotency_key: "b9-1", expected_revision: 1, agent_id: TEST_AGENT_A }, h.deps));
  assert.deepEqual(h.refreshes, [deskLeadKey(h.subject.lead)], "the stale subject is refreshed once");
  assert.deepEqual(
    [leadOf(h).receiver_agent_id, leadOf(h).receiver_agent_source, h.store.entityChanges.length, h.ledger.audits.length, h.ledger.ledger.size],
    [TEST_AGENT_B, "granot_username_match", 0, 0, 0],
    "the refused command writes nothing: the Lead's new receiver is never overwritten silently",
  );
  const refreshed = h.store.subjects.get(h.subject.id)!;
  assert.deepEqual([refreshed.assigned_agent_id, refreshed.assignment_revision], [TEST_AGENT_B, 2]);
  assert.equal(inSync(h), true, "the re-read is in sync");
  assert.deepEqual(h.live, [[{ topic: "outreach_desk", subject_ids: [h.subject.id], agent_ids: [TEST_AGENT_A, TEST_AGENT_B], cause: "command" }]], "published live after the refresh");
  assert.equal(h.published.length, 0, "a refusal wakes no command jobs");

  // The Owner confirms against the refreshed revision: the retry succeeds and moves the Lead to A (manual).
  const retried = await assignSubject({ actor: owner, subject_id: h.subject.id, idempotency_key: "b9-2", expected_revision: 2, agent_id: TEST_AGENT_A }, h.deps);
  assert.deepEqual([retried.changed, retried.previous_agent_id, retried.assigned_agent_id, retried.assignment_revision], [true, TEST_AGENT_B, TEST_AGENT_A, 3]);
  assert.deepEqual([leadOf(h).receiver_agent_id, leadOf(h).receiver_agent_source], [TEST_AGENT_A, "manual"]);
  assert.equal(h.refreshes.length, 1, "a current copy needs no refresh");
});

test("B9: a concurrent real change still answers 409; a stale expected_revision is a plain 409 without a refresh; a failed refresh keeps the plain refusal", async () => {
  const h = harness("new");
  h.store.repNames.set(AGENT_C, "Cara Rep");
  leadOf(h).receiver_agent_id = TEST_AGENT_B;
  await refusedRefreshed(assignSubject({ actor: owner, subject_id: h.subject.id, idempotency_key: "c-1", expected_revision: 1, agent_id: TEST_AGENT_A }, h.deps));
  // A real change lands between the re-read and the retry: the retry is refused again, after another refresh.
  leadOf(h).receiver_agent_id = AGENT_C;
  await refusedRefreshed(assignSubject({ actor: owner, subject_id: h.subject.id, idempotency_key: "c-2", expected_revision: 2, agent_id: TEST_AGENT_A }, h.deps));
  assert.deepEqual([leadOf(h).receiver_agent_id, h.store.entityChanges.length], [AGENT_C, 0], "the concurrent receiver stands");
  const subject = h.store.subjects.get(h.subject.id)!;
  assert.deepEqual([subject.assigned_agent_id, subject.assignment_revision, h.refreshes.length], [AGENT_C, 3, 2]);

  // A stale expected_revision on a current copy is the ordinary revision 409: no refresh.
  await assert.rejects(assignSubject({ actor: owner, subject_id: h.subject.id, idempotency_key: "c-3", expected_revision: 2, agent_id: TEST_AGENT_A }, h.deps), (error: unknown) => {
    assert.ok(error instanceof CsiError);
    assert.deepEqual([error.code, error.issues], ["REVISION_CONFLICT", undefined]);
    return true;
  });
  assert.equal(h.refreshes.length, 2);

  // The refresh failed (for example no active configuration): the original refusal, without "refreshed", and nothing published.
  leadOf(h).receiver_agent_id = TEST_AGENT_B;
  h.overrideRefresh("failed");
  const published = h.live.length;
  await assert.rejects(assignSubject({ actor: owner, subject_id: h.subject.id, idempotency_key: "c-4", expected_revision: 3, agent_id: TEST_AGENT_A }, h.deps), (error: unknown) => {
    assert.ok(error instanceof OutreachError);
    assert.deepEqual([error.code, error.issues], ["REVISION_CONFLICT", [{ path: "assignment", code: "assignment_changed" }]]);
    return true;
  });
  assert.equal(h.live.length, published);

  // A refresh that lost its CAS can still notify the Desk after the concurrent writer moved the subject.
  h.overrideRefresh("conflict");
  await assert.rejects(assignSubject({ actor: owner, subject_id: h.subject.id, idempotency_key: "c-5", expected_revision: 3, agent_id: TEST_AGENT_A }, h.deps), (error: unknown) => {
    assert.ok(error instanceof OutreachError);
    assert.deepEqual([error.code, error.issues], ["REVISION_CONFLICT", [{ path: "assignment", code: "assignment_changed" }]]);
    return true;
  });
  assert.deepEqual(h.live.slice(published), [[{ topic: "outreach_desk", subject_ids: [h.subject.id], agent_ids: [AGENT_C, TEST_AGENT_B], cause: "command" }]]);
  assert.deepEqual([leadOf(h).receiver_agent_id, h.store.entityChanges.length, h.ledger.ledger.size, h.store.jobs.size], [TEST_AGENT_B, 0, 0, 0]);
});

/* ------------------------------------------------------------------ Restrictions (P06c) */

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
