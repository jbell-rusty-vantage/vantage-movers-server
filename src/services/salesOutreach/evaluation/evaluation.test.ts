import assert from "node:assert/strict";
import { test } from "node:test";
import { CsiError } from "../../salesIntelligence/auth";
import type { ConfigurationInspection, ConfigurationLoader } from "../config/load";
import { deskTimingOf } from "../config/timing";
import { evaluateSubject, OUTREACH_ENGINE_VERSION, resolveEnginePolicy } from "../engine";
import { FINAL_01_CADENCE_VALUE } from "../engine/approvedStartingValues";
import { activeInspection, fixedConfigurationLoader } from "../reads/testing";
import { salesOutreachConfigurationValueSchema } from "../../../validation/v1/salesOutreach";
import {
  COVERAGE_REPAIR_BUCKET_MS,
  coverageRepairCause,
  drainOutreachEvaluateJobs,
  evaluateAndProject,
  evaluationAdmissionOf,
  runOutreachEvaluateJob,
  sweepOutreachEvaluations,
  type EvaluateJobDeps,
  type EvaluationPolicyContext,
} from "./evaluateJob";
import { NO_CALL_WATERMARKS } from "../evidence/coverage";
import { assignmentIntervals, buildEngineInput, engineCoverageOf, toEngineRestriction } from "./inputs";
import { cadenceExposureOf, deskEnginePolicy, deskPolicyFingerprint, policyFingerprint, toEngineCadence } from "./policyAdapter";
import { presentProjectionExposure } from "./projection";
import type { DeskRestrictionRow } from "./store";
import {
  capturedCoverage,
  completeConfigurationInput,
  fakeSession,
  MemoryEvaluationStore,
  periodRow,
  runInFakeTransaction,
  subjectRow,
  TEST_AGENT_A,
  TEST_FINAL01_CADENCE,
} from "./testing";

const at = (iso: string) => new Date(iso);
// Monday 2026-10-05, 10:00 New York (EDT) = 14:00Z.
const RECEIVED = "2026-10-05T14:00:00.000Z";

function configuration(controls: Parameters<typeof completeConfigurationInput>[0] = { cadence_shadow_enabled: true }, version = "v-eval", revision = 7) {
  return activeInspection(completeConfigurationInput(controls), version, revision);
}

function admitted(inspection: ConfigurationInspection = configuration()): EvaluationPolicyContext {
  const admission = evaluationAdmissionOf(inspection);
  if (!admission.ok) throw new Error(`not admitted: ${admission.status} ${admission.reasons?.join("; ")}`);
  return admission.context;
}

function restriction(overrides: Partial<DeskRestrictionRow> = {}): DeskRestrictionRow {
  return {
    id: "r".repeat(24),
    contact_number_id: "c".repeat(24),
    channels: ["call"],
    until: null,
    origin: "intelligence",
    state: "active",
    created_at: at("2026-10-05T12:00:00.000Z"),
    updated_at: null,
    reason: null,
    confirmed_at: null,
    confirmed_by: null,
    resolved_at: null,
    resolved_by: null,
    resolution_reason: null,
    revision: 1,
    ...overrides,
  };
}

function seeded(overrides: Parameters<typeof subjectRow>[0] = {}) {
  const store = new MemoryEvaluationStore();
  const subject = subjectRow(overrides);
  store.subjects.set(subject.id, subject);
  store.periods.push(periodRow(subject.id, { started_at: at(RECEIVED) }));
  store.coverage = capturedCoverage(at("2026-10-05T15:30:00.000Z"));
  return { store, subject };
}

/* ---------------------------------------------------------------- policy adapter */

test("adapter: the persisted FINAL-01 cadence resolves to exactly S2's FINAL-01 engine policy", () => {
  const value = salesOutreachConfigurationValueSchema.parse(completeConfigurationInput());
  const ours = deskEnginePolicy(value);
  const theirs = resolveEnginePolicy(FINAL_01_CADENCE_VALUE);
  assert.ok(ours.ok && theirs.ok);
  // Labels differ by design (each encoding carries its own approval reference); every rule is identical.
  assert.deepEqual({ ...ours.policy, policy_version: "", approval_ref: "" }, { ...theirs.policy, policy_version: "", approval_ref: "" });
  assert.equal(ours.policy.policy_version, TEST_FINAL01_CADENCE.policy_version);
});

test("adapter: fails closed with every reason — bootstrap nulls, uneven hours, Quoted opening, unsupported intake rule", () => {
  const bootstrap = salesOutreachConfigurationValueSchema.parse({});
  const empty = deskEnginePolicy(bootstrap);
  assert.equal(empty.ok, false);
  assert.ok(!empty.ok && empty.code === "CONFIGURATION_UNAVAILABLE" && empty.reasons.some((r) => r.includes("cadence.working_days")));

  const value = salesOutreachConfigurationValueSchema.parse(completeConfigurationInput());
  const uneven = structuredClone(value.cadence);
  uneven.working_days![6] = { iso_weekday: 7, open_minute: 540, close_minute: 1200 };
  uneven.quoted_open_minute = 500;
  uneven.intake_default_rule = { ...uneven.intake_default_rule!, manual: "review" };
  const mapped = toEngineCadence(uneven);
  assert.equal(mapped.ok, false);
  assert.ok(!mapped.ok);
  assert.equal(mapped.reasons.length, 3);
  assert.match(mapped.reasons.join("\n"), /per-day hours differ[\s\S]*quoted_open_minute[\s\S]*intake_default_rule/);
});

test("adapter: Days 1–3 carry the optional third call; the Day 1–5 band is split at Day 3", () => {
  const value = salesOutreachConfigurationValueSchema.parse(completeConfigurationInput());
  const mapped = toEngineCadence(value.cadence);
  assert.ok(mapped.ok);
  assert.deepEqual(
    mapped.value.new_call_slots.map((b) => [b.first_day, b.last_day, b.optional_extra_calls]),
    [
      [1, 3, 1],
      [4, 5, 0],
      [6, null, 0],
    ],
  );
});

test("exposure: enforcement wins, shadow alone is shadow, both off evaluates nothing", () => {
  const base = { desk_enabled: true, rep_sms_capture_enabled: false, goal_metrics_enabled: false };
  assert.equal(cadenceExposureOf({ ...base, cadence_shadow_enabled: true, cadence_enforcement_enabled: true }), "enforcement");
  assert.equal(cadenceExposureOf({ ...base, cadence_shadow_enabled: true, cadence_enforcement_enabled: false }), "shadow");
  assert.equal(cadenceExposureOf({ ...base, cadence_shadow_enabled: false, cadence_enforcement_enabled: false }), null);
  assert.deepEqual(evaluationAdmissionOf(activeInspection({ controls: { desk_enabled: true } })), { ok: false, status: "cadence_disabled" });
  assert.deepEqual(evaluationAdmissionOf({ state: "uninitialized" }), { ok: false, status: "configuration_unavailable" });
});

/* ---------------------------------------------------------------- evaluate + project */

test("evaluate: the first run writes the projection; identical input writes nothing; new evidence writes a new publication", async () => {
  const { store, subject } = seeded({ assigned_agent_id: TEST_AGENT_A });
  store.links.push({ agent_id: TEST_AGENT_A, effective_from: at("2026-01-01T00:00:00Z"), effective_to: null });
  const context = admitted();
  const asOf = at("2026-10-05T14:10:00.000Z");
  const first = await evaluateAndProject(subject.id, context, asOf, store, fakeSession);
  assert.equal(first.outcome, "created");
  assert.equal(first.publication_revision, 1);
  const row = store.projections.get(subject.id)!.doc;
  assert.equal(row.exposure, "shadow");
  assert.equal(row.configuration_version, "v-eval");
  assert.equal(row.workflow, "new");
  assert.equal((row.call as { status: string }).status, "due");
  assert.equal((row.status_flags as { needs_contact: boolean }).needs_contact, true);
  assert.equal((row.status_flags as { job_pending: boolean }).job_pending, false);
  assert.ok(row.next_evaluation_at instanceof Date && +row.next_evaluation_at > +asOf);

  const writes = store.writes.length;
  const again = await evaluateAndProject(subject.id, context, at("2026-10-05T14:11:00.000Z"), store, fakeSession);
  assert.equal(again.outcome, "unchanged");
  assert.equal(store.writes.length, writes, "identical input: zero writes");

  store.events.push({
    subject_id: subject.id,
    id: "e".repeat(24),
    source_kind: "call",
    source_id: "1".repeat(24),
    channel: "call",
    direction: "outbound",
    event_at: at("2026-10-05T14:12:00.000Z"),
    kind: "outbound_attempt",
    verification: "confirmed",
    exclusion_reason: null,
    actor_agent_id: TEST_AGENT_A,
    goal_agent_id: TEST_AGENT_A,
    restricted_at_contact: false,
  });
  const updated = await evaluateAndProject(subject.id, context, at("2026-10-05T14:15:00.000Z"), store, fakeSession);
  assert.equal(updated.outcome, "updated");
  assert.equal(updated.publication_revision, 2);
  assert.equal(store.projections.get(subject.id)!.revision, 2);
  assert.equal((store.projections.get(subject.id)!.doc.call as { verified_completed: number }).verified_completed, 1);
});

test("evaluate: a concurrent projection writer loses the CAS (REVISION_CONFLICT); a missing subject writes nothing", async () => {
  const { store, subject } = seeded();
  const context = admitted();
  await evaluateAndProject(subject.id, context, at("2026-10-05T14:10:00.000Z"), store, fakeSession);
  store.updateProjection = async () => false;
  store.subjects.set(subject.id, { ...subject, assigned_agent_id: TEST_AGENT_A });
  store.links.push({ agent_id: TEST_AGENT_A, effective_from: at("2026-01-01T00:00:00Z"), effective_to: null });
  await assert.rejects(evaluateAndProject(subject.id, context, at("2026-10-05T14:11:00.000Z"), store, fakeSession), (e) => e instanceof CsiError && e.code === "REVISION_CONFLICT");
  const missing = await evaluateAndProject("f".repeat(24), context, at("2026-10-05T14:11:00.000Z"), store, fakeSession);
  assert.equal(missing.outcome, "subject_missing");
});

test("P06c: an active AI-origin restriction on the subject's number blocks Calls (never cleared silently); SMS stays independent", async () => {
  const { store, subject } = seeded({ contact_number_ids: ["c".repeat(24)] });
  store.restrictions.push(restriction());
  await evaluateAndProject(subject.id, admitted(), at("2026-10-05T14:10:00.000Z"), store, fakeSession);
  const row = store.projections.get(subject.id)!.doc;
  assert.equal((row.call as { status: string }).status, "blocked");
  assert.notEqual((row.sms as { status: string }).status, "blocked");
  assert.equal((row.status_flags as { blocked: boolean }).blocked, true);

  // Lifted by the Owner at 10:20 ET: the interval ends at the lift, history keeps the waiver.
  const lifted = toEngineRestriction(restriction({ state: "resolved", resolved_at: at("2026-10-05T14:20:00.000Z") }));
  assert.deepEqual([lifted.effective_at, lifted.released_at, lifted.channels], ["2026-10-05T12:00:00.000Z", "2026-10-05T14:20:00.000Z", ["call"]]);
  assert.deepEqual(toEngineRestriction(restriction({ channels: ["text"], until: at("2026-10-06T00:00:00Z") })).channels, ["sms"]);
  assert.equal(toEngineRestriction(restriction({ until: at("2026-10-06T00:00:00Z") })).released_at, "2026-10-06T00:00:00.000Z");
});

test("P06d: assignment history from receiver_agent changes, reviewed links only; first assignment after the deadline leaves the miss Unassigned", () => {
  const changes = [{ applied_at: at("2026-10-05T15:00:00.000Z"), before: null, after: TEST_AGENT_A }];
  const links = [{ agent_id: TEST_AGENT_A, effective_from: at("2026-01-01T00:00:00Z"), effective_to: null }];
  const intervals = assignmentIntervals({ assigned_agent_id: TEST_AGENT_A }, changes, links);
  assert.deepEqual(intervals, [
    { agent_id: null, from: "1970-01-01T00:00:00.000Z", to: "2026-10-05T15:00:00.000Z" },
    { agent_id: TEST_AGENT_A, from: "2026-10-05T15:00:00.000Z", to: null },
  ]);
  // An Agent without a reviewed link at the time is Unassigned for that part.
  const late = assignmentIntervals({ assigned_agent_id: TEST_AGENT_A }, changes, [{ ...links[0]!, effective_from: at("2026-10-05T16:00:00Z") }]);
  assert.deepEqual(late.map((i) => i.agent_id), [null, TEST_AGENT_A]);
  assert.equal(late[0]!.to, "2026-10-05T16:00:00.000Z");

  const subject = subjectRow({ assigned_agent_id: TEST_AGENT_A });
  const input = buildEngineInput({
    subject,
    periods: [periodRow(subject.id, { started_at: at(RECEIVED) })],
    plans: [],
    restrictions: [],
    assignment_changes: changes,
    rep_links: links,
    contact_events: [],
    coverage: capturedCoverage(at("2026-10-05T15:30:00.000Z")),
  }, deskTimingOf(null));
  assert.equal(input.coverage.call.complete_through, "2026-10-05T15:28:00.000Z", "2-minute settlement allowance");
  const policy = admitted().policy;
  const result = evaluateSubject(input, policy, "2026-10-05T15:05:00.000Z");
  const initial = result.obligations.find((o) => o.kind === "initial_response")!;
  assert.equal(initial.responsible_agent_id, null, "the 10:30 deadline belongs to Unassigned");
  assert.equal(result.current_assignee_agent_id, TEST_AGENT_A);
  assert.equal(result.flags.inherited_overdue, true);
});

test("shadow rows present no overdue labels; enforcement rows are shown as computed", () => {
  const row = { exposure: "shadow" as const, call: { status: "overdue" }, sms: { status: "due" }, status_flags: { overdue: true, needs_contact: true } };
  const shadow = presentProjectionExposure(row);
  assert.deepEqual([shadow.call.status, shadow.sms.status, shadow.status_flags.overdue, shadow.status_flags.needs_contact, shadow.enforcement_labels], ["due", "due", false, true, false]);
  assert.equal(row.call.status, "overdue", "stored row untouched");
  const enforced = presentProjectionExposure({ ...row, exposure: "enforcement" as const });
  assert.deepEqual([enforced.call.status, enforced.status_flags.overdue, enforced.enforcement_labels], ["overdue", true, true]);
});

/* ---------------------------------------------------------------- job + drain */

function jobHarness(store: MemoryEvaluationStore, subjectId: string, loader: ConfigurationLoader = fixedConfigurationLoader(configuration())) {
  const calls: string[] = [];
  let queued = 1;
  const deps: EvaluateJobDeps = {
    loader,
    store,
    now: () => at("2026-10-05T14:10:00.000Z"),
    claim: (async (_owner: string, _id?: string, _ttl?: number, stage?: string) => {
      calls.push(`claim:${stage}`);
      if (queued-- <= 0) return null;
      return { _id: "j".repeat(24), lease_owner: "w", lease_epoch: 1, subject_key: `outreach-subject:${subjectId}`, input_refs: [subjectId] };
    }) as never,
    complete: (async (_lease: unknown, mutation: (s: typeof fakeSession) => Promise<unknown>) => {
      calls.push("complete");
      return mutation(fakeSession);
    }) as never,
    fail: (async (_lease: unknown, reason: string) => {
      calls.push(`fail:${reason}`);
      return { status: "retry", next_attempt_at: new Date() };
    }) as never,
  };
  return { calls, deps };
}

test("outreach_evaluate job: claims its own stage, evaluates in the job transaction; drain stops when nothing is claimable", async () => {
  const { store, subject } = seeded();
  const { calls, deps } = jobHarness(store, subject.id);
  const { outcomes } = await drainOutreachEvaluateJobs(500, 10_000, deps);
  assert.deepEqual(outcomes, { completed: 1, not_claimable: 1 });
  assert.deepEqual(calls.slice(0, 2), ["claim:outreach_evaluate", "complete"]);
  assert.ok(store.projections.has(subject.id));
});

test("outreach_evaluate job: nothing is claimed while the configuration is inactive, cadence controls are off or the policy cannot resolve", async () => {
  const { store, subject } = seeded();
  for (const [inspection, status] of [
    [{ state: "uninitialized" }, "configuration_unavailable"],
    [activeInspection({ controls: { desk_enabled: true } }), "cadence_disabled"],
    [
      activeInspection({ ...completeConfigurationInput({ cadence_shadow_enabled: true }), cadence: { ...TEST_FINAL01_CADENCE, quoted_open_minute: 500 } }),
      "policy_unavailable",
    ],
  ] as const) {
    const { calls, deps } = jobHarness(store, subject.id, fixedConfigurationLoader(inspection as ConfigurationInspection));
    assert.deepEqual(await runOutreachEvaluateJob(undefined, deps), { status });
    assert.deepEqual(calls, [], status);
  }
  assert.equal(store.projections.size, 0);
});

test("outreach_evaluate job: a configuration pointer that moved after admission writes nothing and retries", async () => {
  const { store, subject } = seeded();
  const first = configuration(undefined, "v1", 3);
  const second = configuration(undefined, "v2", 4);
  const loader: ConfigurationLoader = { inspect: async () => first, load: async () => first as never, requireActive: async () => second as never };
  const { calls, deps } = jobHarness(store, subject.id, loader);
  assert.deepEqual(await runOutreachEvaluateJob(undefined, deps), { status: "retry" });
  assert.deepEqual(calls, ["claim:outreach_evaluate", "complete", "fail:transient"]);
  assert.equal(store.projections.size, 0);
});

/* ---------------------------------------------------------------- sweep */

test("sweep: due projections are nominated once per due instant; the policy reconcile nominates missing and stale rows, then wraps", async () => {
  const { store, subject } = seeded();
  const other = subjectRow();
  store.subjects.set(other.id, other);
  const context = admitted();
  await evaluateAndProject(subject.id, context, at("2026-10-05T14:10:00.000Z"), store, fakeSession);
  const nextEval = store.projections.get(subject.id)!.doc.next_evaluation_at as Date;
  const loader = fixedConfigurationLoader(configuration());

  const result = await sweepOutreachEvaluations(new Date(+nextEval + 1000), { loader, store, transaction: runInFakeTransaction });
  assert.equal(result.skipped, false);
  assert.deepEqual(result.due, { pages: 1, nominated: 1 });
  assert.ok(store.jobs.has(`sod:evaluate:${subject.id}:due:${+nextEval}`));
  // The other subject has no projection yet: the reconcile nominates it; the evaluated one is current.
  assert.deepEqual(result.reconcile, { pages: 1, checked: 2, nominated: 1, wrapped: true });
  assert.ok([...store.jobs.keys()].some((k) => k.startsWith(`sod:evaluate:${other.id}:policy:`)));
  assert.equal(store.cursor, null, "a short page wraps the cursor");

  // Enforcement turned on: a new policy fingerprint makes every row stale.
  const enforced = await sweepOutreachEvaluations(new Date(+nextEval + 1000), {
    loader: fixedConfigurationLoader(configuration({ cadence_enforcement_enabled: true })),
    store,
    transaction: runInFakeTransaction,
  });
  assert.equal(enforced.reconcile.nominated, 2);
});

test("sweep: skipped while evaluation is not admitted (no reads, no nominations)", async () => {
  const store = new MemoryEvaluationStore();
  const result = await sweepOutreachEvaluations(new Date(), { loader: fixedConfigurationLoader(activeInspection({ controls: { desk_enabled: true } })), store });
  assert.deepEqual([result.skipped, result.reason], [true, "cadence_disabled"]);
  assert.equal(store.jobs.size, 0);
});

test("live (SRV-8): a written projection publishes outreach_desk for its subject and Agents after commit; an unchanged run publishes nothing", async () => {
  const { store, subject } = seeded({ assigned_agent_id: TEST_AGENT_A });
  const live: unknown[] = [];
  const first = jobHarness(store, subject.id);
  const result = await runOutreachEvaluateJob(undefined, { ...first.deps, publishLive: async (p) => void live.push(p) });
  assert.equal(result.status, "completed");
  assert.deepEqual([...live], [{ topic: "outreach_desk", subject_ids: [subject.id], agent_ids: [TEST_AGENT_A, null], revision: 1, cause: "evaluation" }]);
  const again = jobHarness(store, subject.id);
  await runOutreachEvaluateJob(undefined, { ...again.deps, publishLive: async (p) => void live.push(p) });
  assert.equal(live.length, 1, "identical input writes nothing and publishes nothing");
});

test("P07g (SRV-8 follow-up): the subject's contact event marked originating_inbound becomes the engine's originating event", () => {
  const { store, subject } = seeded();
  const base = { source_kind: "call" as const, channel: "call" as const, direction: "inbound" as const, kind: "inbound_answered", verification: "confirmed", exclusion_reason: null, actor_agent_id: TEST_AGENT_A, goal_agent_id: null, restricted_at_contact: false };
  const events = [
    { ...base, id: "1".repeat(24), source_id: "2".repeat(24), event_at: at("2026-10-05T14:05:00.000Z"), originating_inbound: false },
    { ...base, id: "3".repeat(24), source_id: "4".repeat(24), event_at: at("2026-10-05T14:00:00.000Z"), originating_inbound: true },
  ];
  const input = buildEngineInput({ subject, periods: store.periods, plans: [], restrictions: [], assignment_changes: [], rep_links: [], contact_events: events, coverage: store.coverage }, deskTimingOf(null));
  assert.equal(input.subject.originating_contact_event_id, `call:${"4".repeat(24)}`);
  const none = buildEngineInput({ subject, periods: store.periods, plans: [], restrictions: [], assignment_changes: [], rep_links: [], contact_events: events.slice(0, 1), coverage: store.coverage }, deskTimingOf(null));
  assert.equal(none.subject.originating_contact_event_id, null);
});

/* ---------------------------------------------------------------- olr A1: coverage */

const marks = (capture: string | null, derived: string | null) => ({
  calls: { ...NO_CALL_WATERMARKS, capture_known: capture ? at(capture) : null, derived_known: derived ? at(derived) : null },
  sms_known_complete_through: null,
});

function configurationWithAllowance(minutes: number) {
  const input = completeConfigurationInput({ cadence_shadow_enabled: true });
  return activeInspection({ ...input, evidence: { ...input.evidence, call_settlement_allowance_minutes: minutes } }, "v-allow", 8);
}

test("A1.3 (F2): engine coverage = min(capture − allowance, derivation watermark)", () => {
  const timing = deskTimingOf(null);
  assert.equal(engineCoverageOf(marks("2026-10-05T16:10:00.000Z", "2026-10-05T16:05:00.000Z"), timing).call?.toISOString(), "2026-10-05T16:05:00.000Z", "derivation behind");
  assert.equal(engineCoverageOf(marks("2026-10-05T16:10:00.000Z", "2026-10-05T16:20:00.000Z"), timing).call?.toISOString(), "2026-10-05T16:08:00.000Z", "capture − 2 min");
  assert.equal(engineCoverageOf(marks("2026-10-05T16:10:00.000Z", null), timing).call, null, "no derivation row: no coverage");
  const subject = subjectRow();
  const rows = { subject, periods: [periodRow(subject.id)], plans: [], restrictions: [], assignment_changes: [], rep_links: [], contact_events: [] };
  const input = buildEngineInput({ ...rows, coverage: marks("2026-10-05T16:10:00.000Z", "2026-10-05T16:05:00.000Z") }, timing);
  assert.equal(input.coverage.call.complete_through, "2026-10-05T16:05:00.000Z");
});

test("A1.3 (F8): the settlement allowance comes from configuration", () => {
  const timing = deskTimingOf(admitted(configurationWithAllowance(5)).configuration.value);
  assert.equal(timing.call_settlement_allowance_ms, 5 * 60_000);
  assert.equal(engineCoverageOf(marks("2026-10-05T16:10:00.000Z", "2026-10-05T16:20:00.000Z"), timing).call?.toISOString(), "2026-10-05T16:05:00.000Z");
});

test("A1.4: the policy fingerprint changes with the engine version and the settlement allowance", () => {
  const base = admitted();
  const extras = { engine_version: OUTREACH_ENGINE_VERSION, call_settlement_allowance_ms: 120_000 };
  const fp = policyFingerprint(base.policy, base.exposure, extras);
  assert.equal(base.policy_fingerprint, fp, "the evaluator stamps engine version + configured allowance");
  assert.notEqual(policyFingerprint(base.policy, base.exposure, { ...extras, engine_version: "sod-engine-v1" }), fp);
  assert.notEqual(policyFingerprint(base.policy, base.exposure, { ...extras, call_settlement_allowance_ms: 300_000 }), fp);
  const allowance5 = admitted(configurationWithAllowance(5));
  assert.notEqual(allowance5.policy_fingerprint, fp);
  assert.equal(allowance5.policy_fingerprint, deskPolicyFingerprint(allowance5.configuration.value, allowance5.policy, allowance5.exposure));
});

/** Intake 10:00 ET (14:00Z), initial response due 10:30 ET; evaluated at 10:40 ET while capture is at 10:20. */
async function waitingOnCoverage() {
  const { store, subject } = seeded();
  store.coverage = capturedCoverage(at("2026-10-05T14:20:00.000Z"));
  await evaluateAndProject(subject.id, admitted(), at("2026-10-05T14:40:00.000Z"), store, fakeSession);
  return { store, subject };
}

test("A1.5: a row whose verdict waits on coverage stores coverage_wait and reads due, not pending", async () => {
  const { store, subject } = await waitingOnCoverage();
  const row = store.projections.get(subject.id)!.doc;
  assert.deepEqual(row.coverage_wait, { call: at("2026-10-05T14:30:00.000Z"), sms: null });
  assert.equal((row.call as { status: string }).status, "due");
  assert.equal((row.status_flags as { pending: boolean }).pending, false);
  assert.equal((row.status_flags as { needs_contact: boolean }).needs_contact, true);
  assert.equal(row.engine_version, "sod-engine-v2");
});

test("A1.6: coverage repair nominates rows whose coverage_wait <= current coverage, once per bucket", async () => {
  const { store, subject } = await waitingOnCoverage();
  const deps = { loader: fixedConfigurationLoader(configuration()), store, transaction: runInFakeTransaction };
  const wait = at("2026-10-05T14:30:00.000Z");
  store.coverage = capturedCoverage(at("2026-10-05T14:35:00.000Z")); // cadence coverage 14:33 >= 14:30
  const first = await sweepOutreachEvaluations(at("2026-10-05T14:41:00.000Z"), deps);
  assert.deepEqual(first.coverage, { pages: 1, nominated: 1, call_through: "2026-10-05T14:33:00.000Z", sms_through: null });
  const key = `sod:evaluate:${subject.id}:${coverageRepairCause("call", wait, at("2026-10-05T14:33:00.000Z"))}`;
  assert.equal(key, `sod:evaluate:${subject.id}:coverage:call:${+wait}:${Math.floor(+at("2026-10-05T14:33:00.000Z") / COVERAGE_REPAIR_BUCKET_MS)}`);
  assert.ok(store.jobs.has(key));
  assert.equal(store.jobs.get(key)!.stage, "outreach_evaluate");
  const coverageJobs = () => [...store.jobs.keys()].filter((k) => k.includes(":coverage:"));
  await sweepOutreachEvaluations(at("2026-10-05T14:42:00.000Z"), deps);
  assert.equal(coverageJobs().length, 1, "same coverage bucket: the same job identity");
  store.coverage = capturedCoverage(at("2026-10-05T14:40:00.000Z")); // 14:38: the next 5-minute bucket
  await sweepOutreachEvaluations(at("2026-10-05T14:43:00.000Z"), deps);
  assert.equal(coverageJobs().length, 2, "a later coverage step re-nominates a row that is still waiting");

  // The nominated evaluation sees the coverage and clears the wait: the verdict lands (overdue initial response).
  await evaluateAndProject(subject.id, admitted(), at("2026-10-05T14:43:00.000Z"), store, fakeSession);
  const row = store.projections.get(subject.id)!.doc;
  assert.deepEqual(row.coverage_wait, { call: null, sms: null });
  assert.equal((row.call as { status: string }).status, "overdue");
  const quiet = await sweepOutreachEvaluations(at("2026-10-05T14:44:00.000Z"), deps);
  assert.equal(quiet.coverage.nominated, 0);
});

test("A1.6: coverage repair ignores rows whose wait is beyond coverage and does nothing when the derivation row is missing", async () => {
  const { store } = await waitingOnCoverage();
  const deps = { loader: fixedConfigurationLoader(configuration()), store, transaction: runInFakeTransaction };
  store.coverage = capturedCoverage(at("2026-10-05T14:31:00.000Z")); // cadence 14:29 < 14:30
  const behind = await sweepOutreachEvaluations(at("2026-10-05T14:41:00.000Z"), deps);
  assert.deepEqual([behind.coverage.pages, behind.coverage.nominated, behind.coverage.call_through], [0, 0, "2026-10-05T14:29:00.000Z"]);
  store.coverage = marks("2026-10-05T15:00:00.000Z", null);
  const noDerivation = await sweepOutreachEvaluations(at("2026-10-05T15:05:00.000Z"), deps);
  assert.deepEqual(noDerivation.coverage, { pages: 0, nominated: 0, call_through: null, sms_through: null });
  assert.equal([...store.jobs.keys()].filter((k) => k.includes(":coverage:")).length, 0);
});
