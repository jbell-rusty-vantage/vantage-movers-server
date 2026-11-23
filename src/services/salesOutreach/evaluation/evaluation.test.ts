import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConfigurationInspection, ConfigurationLoader } from "../config/load";
import { deskTimingOf } from "../config/timing";
import { evaluateSubject } from "../engine";
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
  type EvaluateDrainDeps,
  type EvaluateJobDeps,
  type EvaluationPolicyContext,
} from "./evaluateJob";
import { NO_CALL_WATERMARKS } from "../evidence/coverage";
import { assignmentIntervals, buildEngineInput, engineCoverageOf } from "./inputs";
import { deskEnginePolicy, toEngineCadence } from "./policyAdapter";
import { presentProjectionExposure } from "./projection";
import {
  capturedCoverage,
  completeConfigurationInput,
  fakeSession,
  MemoryEvaluationStore,
  periodRow,
  runInFakeTransaction,
  subjectRow,
  TEST_AGENT_A,
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

function seeded(overrides: Parameters<typeof subjectRow>[0] = {}) {
  const store = new MemoryEvaluationStore();
  const subject = subjectRow(overrides);
  store.subjects.set(subject.id, subject);
  store.periods.push(periodRow(subject.id, { started_at: at(RECEIVED) }));
  store.coverage = capturedCoverage(at("2026-10-05T15:30:00.000Z"));
  return { store, subject };
}

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

/* ---------------------------------------------------------------- olr A1: coverage */

const marks = (capture: string | null, derived: string | null) => ({
  calls: { ...NO_CALL_WATERMARKS, capture_known: capture ? at(capture) : null, derived_known: derived ? at(derived) : null },
  sms_known_complete_through: null,
});

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

/** Intake 10:00 ET (14:00Z), initial response due 10:30 ET; evaluated at 10:40 ET while capture is at 10:20. */
async function waitingOnCoverage() {
  const { store, subject } = seeded();
  store.coverage = capturedCoverage(at("2026-10-05T14:20:00.000Z"));
  await evaluateAndProject(subject.id, admitted(), at("2026-10-05T14:40:00.000Z"), store, fakeSession);
  return { store, subject };
}

test("A1.6: coverage repair nominates rows whose coverage_wait <= current coverage, once per bucket and pending job", async () => {
  const { store, subject } = await waitingOnCoverage();
  const deps = { loader: fixedConfigurationLoader(configuration()), store, transaction: runInFakeTransaction };
  const wait = at("2026-10-05T14:30:00.000Z");
  store.coverage = capturedCoverage(at("2026-10-05T14:35:00.000Z")); // cadence coverage 14:33 >= 14:30
  const first = await sweepOutreachEvaluations(at("2026-10-05T14:41:00.000Z"), deps);
  assert.deepEqual(first.coverage, { pages: 1, nominated: 1, coalesced: 0, call_through: "2026-10-05T14:33:00.000Z", sms_through: null });
  const key = `sod:evaluate:${subject.id}:${coverageRepairCause("call", wait, at("2026-10-05T14:33:00.000Z"))}`;
  assert.equal(key, `sod:evaluate:${subject.id}:coverage:call:${+wait}:${Math.floor(+at("2026-10-05T14:33:00.000Z") / COVERAGE_REPAIR_BUCKET_MS)}`);
  assert.ok(store.jobs.has(key));
  assert.equal(store.jobs.get(key)!.stage, "outreach_evaluate");
  const coverageJobs = () => [...store.jobs.keys()].filter((k) => k.includes(":coverage:"));
  await sweepOutreachEvaluations(at("2026-10-05T14:42:00.000Z"), deps);
  assert.equal(coverageJobs().length, 1, "same coverage bucket: the same job identity");
  store.coverage = capturedCoverage(at("2026-10-05T14:40:00.000Z")); // 14:38: the next 5-minute bucket
  const lagging = await sweepOutreachEvaluations(at("2026-10-05T14:43:00.000Z"), deps);
  assert.deepEqual([coverageJobs().length, lagging.coverage.coalesced], [1, 1], "the unclaimed first job covers the next bucket");
  store.pending.delete(key); // the first job ran; the row still waits
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

/* ---------------------------------------------------------------- olr A4 */

test("A4: clock sweep never nominates a closed projection; the closed row is not rewritten at midnight", async () => {
  // Closed by an accepted Priority 8 at 14:00 ET (18:00Z) on its received date; an active subject beside it.
  const { store, subject } = seeded({ status: "closed" });
  store.periods[0] = { ...store.periods[0]!, ended_at: at("2026-10-05T18:00:00.000Z"), end_reason: "transition" } as (typeof store.periods)[number];
  store.periods.push(periodRow(subject.id, { workflow: "closed", priority: "8", start_kind: "transition", transition_key: "granot:8", started_at: at("2026-10-05T18:00:00.000Z") }));
  const active = subjectRow();
  store.subjects.set(active.id, active);
  store.periods.push(periodRow(active.id, { started_at: at(RECEIVED) }));
  const context = admitted();
  await evaluateAndProject(subject.id, context, at("2026-10-05T18:05:00.000Z"), store, fakeSession);
  await evaluateAndProject(active.id, context, at("2026-10-05T18:05:00.000Z"), store, fakeSession);
  const closed = store.projections.get(subject.id)!;
  assert.equal(closed.doc.next_evaluation_at, null);
  assert.equal((closed.doc.detail as { state: string }).state, "closed");
  assert.equal((closed.doc.window_history as Array<{ business_date: string }>).at(-1)!.business_date, "2026-10-05");

  const deps = { loader: fixedConfigurationLoader(configuration()), store, transaction: runInFakeTransaction };
  const dueJobs = (id: string) => [...store.jobs.keys()].filter((k) => k.startsWith(`sod:evaluate:${id}:due:`));
  for (const now of ["2026-10-06T04:00:30.000Z", "2026-10-07T04:00:30.000Z", "2026-11-05T05:00:30.000Z"]) {
    await sweepOutreachEvaluations(at(now), deps);
  }
  assert.equal(dueJobs(subject.id).length, 0, "the clock sweep never nominates the closed row");
  assert.ok(dueJobs(active.id).length > 0, "the active row still wakes at midnight");
  assert.equal([...store.jobs.keys()].filter((k) => k.includes(subject.id)).length, 0, "no reconcile nomination either: its policy fingerprint is current");

  // Any later evaluation (a subject revision, a policy change) finds nothing new to write.
  const writes = store.writes.length;
  const later = await evaluateAndProject(subject.id, context, at("2026-11-05T05:01:00.000Z"), store, fakeSession);
  assert.equal(later.outcome, "unchanged");
  assert.equal(later.publication_revision, closed.doc.publication_revision);
  assert.equal(store.writes.length, writes);
});

/* ---------------------------------------------------------------- olr A5: drain budget */

/** A fake claim queue of `outreach_evaluate` jobs (one per subject id) with a controllable clock. */
function drainHarness(store: MemoryEvaluationStore, subjectIds: string[], options: { tickMs?: number; now?: string } = {}) {
  const queue = subjectIds.map((subject, i) => ({ id: String(i + 1).padStart(24, "0"), subject }));
  let clockMs = 0;
  let inflight = 0;
  const stats = { claims: 0, peak: 0, starts: [] as number[], fails: [] as string[] };
  const deps: EvaluateDrainDeps = {
    loader: fixedConfigurationLoader(configuration()),
    store,
    now: () => at(options.now ?? "2026-10-05T14:10:00.000Z"),
    clock: () => clockMs,
    claim: (async () => {
      const job = queue.shift();
      if (!job) return null;
      stats.claims++;
      stats.starts.push(clockMs);
      return { _id: job.id, lease_owner: "w", lease_epoch: 1, subject_key: `outreach-subject:${job.subject}`, input_refs: [job.subject] };
    }) as never,
    complete: (async (_lease: unknown, mutation: (s: typeof fakeSession) => Promise<unknown>) => {
      stats.peak = Math.max(stats.peak, ++inflight);
      try {
        await new Promise((resolve) => setImmediate(resolve));
        return await mutation(fakeSession);
      } finally {
        inflight--;
        clockMs += options.tickMs ?? 0;
      }
    }) as never,
    fail: (async (_lease: unknown, reason: string) => {
      stats.fails.push(reason);
      return { status: "retry", next_attempt_at: new Date() };
    }) as never,
    publishLive: async () => undefined,
  };
  return { deps, stats, queue };
}

function seededMany(count: number) {
  const store = new MemoryEvaluationStore();
  store.coverage = capturedCoverage(at("2026-10-05T15:30:00.000Z"));
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const subject = subjectRow();
    store.subjects.set(subject.id, subject);
    store.periods.push(periodRow(subject.id, { started_at: at(RECEIVED) }));
    ids.push(subject.id);
  }
  return { store, ids };
}

test("A5: same-subject concurrent jobs: one writes, the other retries", async () => {
  class BarrierStore extends MemoryEvaluationStore {
    armed = false;
    private waiting: Array<() => void> = [];
    override async readProjection(subjectId: string) {
      if (this.armed)
        await new Promise<void>((resolve) => {
          this.waiting.push(resolve);
          if (this.waiting.length === 2) {
            this.armed = false;
            for (const release of this.waiting.splice(0)) release();
          }
        });
      return super.readProjection(subjectId);
    }
  }
  const store = new BarrierStore();
  const subject = subjectRow();
  store.subjects.set(subject.id, subject);
  store.periods.push(periodRow(subject.id, { started_at: at(RECEIVED) }));
  store.coverage = capturedCoverage(at("2026-10-05T15:30:00.000Z"));
  await evaluateAndProject(subject.id, admitted(), at("2026-10-05T14:10:00.000Z"), store, fakeSession);
  const before = store.projections.get(subject.id)!;
  store.writes.length = 0;
  store.armed = true; // both jobs read the same head before either writes
  // 15:00: the initial response (due 14:30) is now overdue, so the result changed and both try to write.
  const run = drainHarness(store, [subject.id, subject.id], { now: "2026-10-05T15:00:00.000Z" });
  const drained = await drainOutreachEvaluateJobs({ concurrency: 2 }, run.deps);
  assert.equal(drained.outcomes.completed, 1);
  assert.equal(drained.outcomes.retry, 1);
  assert.deepEqual(run.stats.fails, ["transient"], "the CAS loser retries (REVISION_CONFLICT)");
  assert.deepEqual(store.writes, [`updateProjection:${subject.id}`], "exactly one write");
  assert.equal(store.projections.get(subject.id)!.revision, before.revision + 1);
});

test("W2: sustained refresh backlog shares max and timing while legacy progresses first", async () => {
  for (const max of [1, 4]) {
    const seeded = seededMany(8);
    const run = drainHarness(seeded.store, seeded.ids, { tickMs: 10 });
    let time = 0;
    run.deps.clock = () => time + run.stats.claims * 10;
    run.deps.refreshDrain = async (remaining, budget) => {
      assert.ok(run.stats.claims >= 1, "legacy claims before refresh work");
      assert.equal(remaining, max - 1);
      assert.ok(budget <= 2495);
      time += budget;
      return { skipped: null, outcomes: { completed: remaining }, durations_ms: Array(remaining).fill(budget / remaining) };
    };
    const result = await drainOutreachEvaluateJobs({ max, deadlineMs: 5000 }, run.deps);
    assert.equal(run.stats.claims, 1);
    assert.equal(result.jobs, max);
    assert.equal(result.outcomes.completed, max);
    assert.ok(result.ms_total <= 5000);
    assert.equal(result.ms_p95, max === 1 ? 10 : 2495 / 3);
  }
});

test("W2: refresh database failure retains partial accounting in the shared legacy cap", async () => {
  const { drainSubjectRefreshes } = await import("./refreshWorker.js");
  const seeded = seededMany(8);
  const run = drainHarness(seeded.store, seeded.ids);
  let refreshAttempts = 0;
  run.deps.refreshDrain = (max, budget) => drainSubjectRefreshes(max, budget, {
    preflight: async () => null,
    next: async () => {
      refreshAttempts++;
      if (refreshAttempts === 2) throw new Error("retry write response lost");
      return { status: "completed" };
    },
  });
  const result = await drainOutreachEvaluateJobs({ max: 4 }, run.deps);
  assert.equal(refreshAttempts, 2);
  assert.equal(run.stats.claims, 2, "only two legacy claims fit beside completed and uncertain refresh slots");
  assert.equal(result.jobs, 4);
  assert.equal(result.outcomes.completed, 3);
  assert.equal(result.outcomes.failed, 1);
  assert.equal(result.refresh_requests?.skipped, "failed");
});
