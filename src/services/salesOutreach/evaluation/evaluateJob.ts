import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongoose";
import type { SalesOutreachCadenceExposure } from "../../../config/domain/salesOutreach";
import { withTransaction } from "../../../db";
import { logger } from "../../../logger";
import { CsiError } from "../../salesIntelligence/auth";
import { claimCsiJob, completeCsiJob, failCsiJob, type JobInput, type JobLease } from "../../salesIntelligence/jobs";
import { salesOutreachConfigurationLoader, type ActiveConfiguration, type ConfigurationLoader } from "../config/load";
import { deskTimingOf, type DeskTiming } from "../config/timing";
import { evaluateSubject, type EnginePolicy } from "../engine";
import { OutreachError } from "../errors";
import { publishOutreachLive } from "../live/publish";
import type { ReadSession } from "../subjects/store";
import { buildEngineInput, engineCoverageOf } from "./inputs";
import { cadenceExposureOf, deskEnginePolicy, deskPolicyFingerprint } from "./policyAdapter";
import { toProjectionWrite } from "./projection";
import { mongoEvaluationStore, type EvaluationStore } from "./store";

/**
 * The `outreach_evaluate` stage (IMPLEMENTATION-PLAN §6.1/§6.2): load one subject's inputs, run the
 * pure engine, and upsert its `sales_outreach_projections` row only when the result changed.
 *
 * - Admission reads the configuration pointer; nothing is claimed while it is not active, while both
 *   `cadence_shadow_enabled` and `cadence_enforcement_enabled` are off, or while the stored cadence
 *   cannot be resolved into an engine policy (fail closed; pending rows wait, spending no attempt).
 * - Inside the job transaction the pointer is read again; a moved pointer aborts and retries.
 * - Identical inputs ⇒ identical result fingerprint ⇒ zero writes. A changed result is written with a
 *   CAS on the projection `revision` and a new `publication_revision`.
 */

export type EvaluationPolicyContext = Readonly<{
  configuration: ActiveConfiguration;
  policy: EnginePolicy;
  exposure: SalesOutreachCadenceExposure;
  policy_fingerprint: string;
}>;

export type EvaluationAdmission =
  | Readonly<{ ok: true; context: EvaluationPolicyContext }>
  | Readonly<{ ok: false; status: "configuration_unavailable" | "cadence_disabled" | "policy_unavailable"; reasons?: string[] }>;

/** Whether the persisted configuration admits evaluation now, and with which policy/exposure. */
export function evaluationAdmissionOf(inspection: Awaited<ReturnType<ConfigurationLoader["inspect"]>>): EvaluationAdmission {
  if (inspection.state !== "active") return { ok: false, status: "configuration_unavailable" };
  const exposure = cadenceExposureOf(inspection.value.controls);
  if (!exposure) return { ok: false, status: "cadence_disabled" };
  const resolved = deskEnginePolicy(inspection.value);
  if (!resolved.ok) return { ok: false, status: "policy_unavailable", reasons: resolved.reasons };
  return {
    ok: true,
    context: {
      configuration: inspection,
      policy: resolved.policy,
      exposure,
      policy_fingerprint: deskPolicyFingerprint(inspection.value, resolved.policy, exposure),
    },
  };
}

export type EvaluationOutcome = Readonly<{
  outcome: "created" | "updated" | "unchanged" | "subject_missing";
  subject_id: string;
  publication_revision: number | null;
  next_evaluation_at: string | null;
  /** Agents whose scoped views a written row touches: the new assignee and the previous one. */
  agent_ids?: Array<string | null>;
}>;

/** Evaluates one subject at `asOf` and persists the projection when its result changed. */
export async function evaluateAndProject(
  subjectId: string,
  context: EvaluationPolicyContext,
  asOf: Date,
  store: EvaluationStore,
  session: ClientSession,
): Promise<EvaluationOutcome> {
  const subject = await store.loadSubject(subjectId, session);
  if (!subject) return { outcome: "subject_missing", subject_id: subjectId, publication_revision: null, next_evaluation_at: null };
  const read: ReadSession = session;
  // Sequential reads: the session is inside the job transaction and runs one operation at a time.
  const periods = await store.loadPeriods(subject.id, read);
  const plans = await store.loadPlans(subject.id, read);
  const restrictions = await store.loadRestrictions(subject.contact_number_ids, read);
  const changes = await store.loadAssignmentChanges(subject.lead, read);
  const events = await store.loadContactEvents(subject.id, read);
  const coverage = await store.loadCoverage(context.configuration.value.controls.rep_sms_capture_enabled, read, asOf);
  const agents = [...new Set([subject.assigned_agent_id, ...changes.flatMap((c) => [c.before, c.after])].filter((a): a is string => a !== null))];
  const links = await store.loadRepLinks(agents, read);
  const timing = deskTimingOf(context.configuration.value);
  const input = buildEngineInput(
    {
      subject,
      periods,
      plans,
      restrictions,
      assignment_changes: changes,
      rep_links: links,
      contact_events: events,
      coverage,
    },
    timing,
  );
  const result = evaluateSubject(input, context.policy, asOf.toISOString());
  const doc = toProjectionWrite(subject, result, {
    exposure: context.exposure,
    configuration_version: context.configuration.version,
    policy_fingerprint: context.policy_fingerprint,
    coverage,
    timing,
  });
  const head = await store.readProjection(subject.id, session);
  if (head && head.result_fingerprint === doc.result_fingerprint)
    return { outcome: "unchanged", subject_id: subject.id, publication_revision: head.publication_revision, next_evaluation_at: result.next_evaluation_at };
  const publication_revision = (head?.publication_revision ?? 0) + 1;
  const write = { ...doc, publication_revision };
  if (head) {
    if (!(await store.updateProjection(subject.id, head.revision, write, session))) throw new CsiError("REVISION_CONFLICT");
  } else {
    await store.insertProjection(subject.id, write, session);
  }
  return {
    outcome: head ? "updated" : "created",
    subject_id: subject.id,
    publication_revision,
    next_evaluation_at: result.next_evaluation_at,
    agent_ids: [subject.assigned_agent_id, head?.assigned_agent_id ?? null],
  };
}

/** One evaluation job identity per subject and cause (the handler always evaluates current state). */
/** `inputRevision` is the revision of the change that caused the evaluation; the job schema requires >= 1. */
export function evaluationJob(subjectId: string, cause: string, inputRevision = 1): JobInput {
  return {
    stage: "outreach_evaluate",
    subject_key: `outreach-subject:${subjectId}`,
    dedupe_key: `sod:evaluate:${subjectId}:${cause}`,
    input_revision: inputRevision,
    input_refs: [subjectId],
  };
}

export type EvaluateJobDeps = {
  loader?: ConfigurationLoader;
  store?: EvaluationStore;
  now?: () => Date;
  claim?: typeof claimCsiJob;
  complete?: typeof completeCsiJob;
  fail?: typeof failCsiJob;
  /** After-commit live publish (tests inject a recorder). */
  publishLive?: typeof publishOutreachLive;
};

export type EvaluateJobStatus = "configuration_unavailable" | "cadence_disabled" | "policy_unavailable" | "not_claimable" | "completed" | "lease_lost" | "retry";

export async function runOutreachEvaluateJob(jobId?: string, deps: EvaluateJobDeps = {}): Promise<{ status: EvaluateJobStatus; result?: EvaluationOutcome }> {
  const loader = deps.loader ?? salesOutreachConfigurationLoader;
  const admission = evaluationAdmissionOf(await loader.inspect());
  if (!admission.ok) {
    if (admission.status === "policy_unavailable") logger.warn({ msg: "sales_outreach.evaluate.policy_unavailable", reasons: admission.reasons?.slice(0, 20) });
    return { status: admission.status };
  }
  const admitted = admission.context;
  const row = await (deps.claim ?? claimCsiJob)(`sod-evaluate:${randomUUID()}`, jobId, 120_000, "outreach_evaluate");
  if (!row) return { status: "not_claimable" };
  const lease: JobLease = { job_id: String(row._id), owner: row.lease_owner!, epoch: row.lease_epoch };
  const subjectId = row.input_refs.map(String)[0];
  try {
    if (!subjectId) throw new CsiError("INVALID_INPUT");
    const result = await (deps.complete ?? completeCsiJob)(
      lease,
      async (session) => {
        const current = await loader.requireActive(session);
        if (current.revision !== admitted.configuration.revision || current.version !== admitted.configuration.version)
          throw new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "configuration", code: "revision_changed" }]);
        return evaluateAndProject(subjectId, admitted, (deps.now ?? (() => new Date()))(), deps.store ?? mongoEvaluationStore, session);
      },
      { resultFrom: (value) => value },
    );
    // After commit: a written row invalidates the desk views of its subject and Agents (never throws).
    if (result.outcome === "created" || result.outcome === "updated")
      await (deps.publishLive ?? publishOutreachLive)({
        topic: "outreach_desk",
        subject_ids: [result.subject_id],
        agent_ids: result.agent_ids ?? [],
        revision: result.publication_revision,
        cause: "evaluation",
      });
    return { status: "completed", result };
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost" };
    await (deps.fail ?? failCsiJob)(lease, error instanceof CsiError && error.code === "INVALID_INPUT" ? "schema_invalid" : "transient");
    return { status: "retry" };
  }
}

/** One evaluate drain's budget (olr A5): job attempts, wall-clock budget and claim loops run at once. */
export type EvaluateDrainOptions = Readonly<{ max: number; deadlineMs: number; concurrency: number }>;

/** Engineering bounds of one drain; the configuration schema (`operations.evaluate_drain_*`) enforces the same ranges. */
export const EVALUATE_DRAIN_BOUNDS = Object.freeze({ max: 1000, deadlineMs: 55_000, concurrency: 4 });

/** The drain options a configuration value resolves to (`deskTimingOf`; absent keys = 100 jobs / 40 s / 1). */
export function evaluateDrainOptionsOf(timing: DeskTiming): EvaluateDrainOptions {
  return { max: timing.evaluate_drain_max_jobs, deadlineMs: timing.evaluate_drain_budget_ms, concurrency: timing.evaluate_drain_concurrency };
}

export type EvaluateDrainDeps = EvaluateJobDeps & {
  /** Milliseconds clock for the budget and the per-job timing (tests inject a fake one). */
  clock?: () => number;
};

export type EvaluateDrainResult = Readonly<{
  outcomes: Record<string, number>;
  /** Jobs claimed and run (completed, retry or lease lost). */
  jobs: number;
  ms_total: number;
  /** Nearest-rank p95 of the claimed jobs' durations; null when none ran. */
  ms_p95: number | null;
  options: EvaluateDrainOptions;
}>;

const clampInt = (value: number | undefined, fallback: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(1, Math.floor(value!))) : fallback;

/**
 * Drains runnable `outreach_evaluate` jobs (olr A5): `concurrency` claim loops share one attempt counter
 * (never more than `max` attempts) and one wall-clock budget (no job starts once `deadlineMs` has
 * passed). Each claim is the atomic `claimCsiJob` and each job its own transaction; two jobs of the same
 * subject resolve through the projection CAS (the loser retries). A status other than completed/retry
 * stops every loop from starting another job, like the serial drain did. Absent options take the code
 * defaults (100 jobs / 40 s / 1 loop: the serial drain). Logs `sales_outreach.evaluate.drain`.
 */
export async function drainOutreachEvaluateJobs(options: Partial<EvaluateDrainOptions> = {}, deps: EvaluateDrainDeps = {}): Promise<EvaluateDrainResult> {
  const defaults = evaluateDrainOptionsOf(deskTimingOf(null));
  const resolved: EvaluateDrainOptions = {
    max: clampInt(options.max, defaults.max, EVALUATE_DRAIN_BOUNDS.max),
    deadlineMs: clampInt(options.deadlineMs, defaults.deadlineMs, EVALUATE_DRAIN_BOUNDS.deadlineMs),
    concurrency: clampInt(options.concurrency, defaults.concurrency, EVALUATE_DRAIN_BOUNDS.concurrency),
  };
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const deadline = started + resolved.deadlineMs;
  const outcomes: Record<string, number> = {};
  const durations: number[] = [];
  let attempts = 0;
  let stopped = false;
  const loop = async () => {
    try {
      while (!stopped && attempts < resolved.max && clock() < deadline) {
        attempts++;
        const t0 = clock();
        const { status } = await runOutreachEvaluateJob(undefined, deps);
        outcomes[status] = (outcomes[status] ?? 0) + 1;
        if (status === "completed" || status === "retry" || status === "lease_lost") durations.push(clock() - t0);
        if (status !== "completed" && status !== "retry") stopped = true;
      }
    } catch (error) {
      stopped = true;
      throw error;
    }
  };
  // allSettled: a failing loop stops the others from starting new jobs, and the drain waits for the
  // in-flight ones before it reports the first failure.
  const settled = await Promise.allSettled(Array.from({ length: resolved.concurrency }, loop));
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  if (failed) throw failed.reason;
  const sorted = [...durations].sort((a, b) => a - b);
  const result: EvaluateDrainResult = {
    outcomes,
    jobs: durations.length,
    ms_total: clock() - started,
    ms_p95: sorted.length ? sorted[Math.ceil(0.95 * sorted.length) - 1]! : null,
    options: resolved,
  };
  logger.info({ msg: "sales_outreach.evaluate.drain", ...result });
  return result;
}

export const EVALUATION_SWEEP_PAGE = 100;
export const EVALUATION_SWEEP_MAX_PAGES = 5;

export type EvaluationSweepDeps = {
  loader?: ConfigurationLoader;
  store?: EvaluationStore;
  transaction?: <T>(work: (session: ClientSession) => Promise<T>) => Promise<T>;
};

export type EvaluationSweepResult = Readonly<{
  skipped: boolean;
  reason: string | null;
  due: { pages: number; nominated: number };
  /** olr A1 coverage repair: the current cadence coverage per channel and the rows it nominated. */
  coverage: { pages: number; nominated: number; call_through: string | null; sms_through: string | null };
  reconcile: { pages: number; checked: number; nominated: number; wrapped: boolean };
  /** olr A5: the drain budget the active configuration resolves to (`operations.evaluate_drain_*`); null when skipped. */
  drain_options: EvaluateDrainOptions | null;
}>;

const skippedSweep = (reason: string): EvaluationSweepResult => ({
  skipped: true,
  reason,
  due: { pages: 0, nominated: 0 },
  coverage: { pages: 0, nominated: 0, call_through: null, sms_through: null },
  reconcile: { pages: 0, checked: 0, nominated: 0, wrapped: false },
  drain_options: null,
});

/**
 * olr A5: enqueues only the nominations whose job identity does not exist yet. One indexed read per page
 * (`csi_job_dedupe_unique`) replaces the per-row upsert that only found the existing job again (the
 * unique `dedupe_key` makes that upsert a no-op whatever the job's status). Returns the jobs enqueued.
 */
async function enqueueMissing(store: EvaluationStore, jobs: readonly JobInput[], session: ClientSession): Promise<number> {
  if (!jobs.length) return 0;
  const existing = await store.existingJobKeys(jobs.map((job) => job.dedupe_key), session);
  let count = 0;
  for (const job of jobs) if (!existing.has(job.dedupe_key) && (await store.enqueue(job, session)) === "enqueued") count++;
  return count;
}

/** The coverage repair nominates a waiting row at most once per this step of channel coverage. */
export const COVERAGE_REPAIR_BUCKET_MS = 5 * 60_000;

/**
 * Coverage-repair job cause: the channel, the waited deadline and the 5-minute coverage bucket. A backlog
 * upserts onto the same pending job; a dead-lettered evaluation is re-nominated at the next coverage step
 * (self-healing without timed retries).
 */
export function coverageRepairCause(channel: "call" | "sms", wait: Date, through: Date): string {
  return `coverage:${channel}:${+wait}:${Math.floor(+through / COVERAGE_REPAIR_BUCKET_MS)}`;
}

/**
 * The minute evaluation sweep (cron `/api/cron/sales-outreach-evaluate`):
 * 1. clock repair — projections with `next_evaluation_at <= now`, oldest first, in pages of 100 (≤ 5
 *    pages), each nominated once per due instant (`sod:evaluate:<subject>:due:<ms>`);
 * 2. coverage repair (olr A1) — per channel, projections whose `coverage_wait` <= the channel's current
 *    cadence coverage (the same `engineCoverageOf` the evaluation uses), oldest wait first, in pages of
 *    100 (≤ 5 pages per channel), nominated as `sod:evaluate:<subject>:coverage:<channel>:<wait ms>:<bucket>`.
 *    A pull on the watermark: verdicts land once coverage can prove them (≈ 17–22 min after a deadline),
 *    nothing is re-evaluated while capture is behind, and capture stays unaware of the desk;
 * 3. policy reconcile — subjects by `_id` in pages of 100 (≤ 5 pages, durable cursor in
 *    `sales_intelligence_sync_state` scope `outreach_evaluation_reconcile`, wraps on a short page)
 *    whose projection is missing or was computed under another policy fingerprint (resolved policy,
 *    exposure, engine version, settlement allowance).
 * All only nominate jobs; the drain evaluates them. A nomination whose job already exists (any status) is
 * skipped with one read per page (olr A5), so `nominated` counts new jobs only: a backlog no longer
 * re-upserts every undrained row each minute. The result also carries the configured drain budget
 * (`drain_options`). Nothing runs while evaluation is not admitted.
 */
export async function sweepOutreachEvaluations(now = new Date(), deps: EvaluationSweepDeps = {}): Promise<EvaluationSweepResult> {
  const loader = deps.loader ?? salesOutreachConfigurationLoader;
  const store = deps.store ?? mongoEvaluationStore;
  const transaction = deps.transaction ?? withTransaction;
  const admission = evaluationAdmissionOf(await loader.inspect());
  if (!admission.ok) return skippedSweep(admission.status === "configuration_unavailable" ? "configuration_unavailable" : admission.status);
  const fingerprint = admission.context.policy_fingerprint;

  const due = { pages: 0, nominated: 0 };
  let after: { at: Date; subject_id: string } | null = null;
  while (due.pages < EVALUATION_SWEEP_MAX_PAGES) {
    const page = await store.dueProjections(now, after, EVALUATION_SWEEP_PAGE);
    if (!page.length) break;
    due.pages++;
    due.nominated += await transaction((session) =>
      enqueueMissing(store, page.map((row) => evaluationJob(row.subject_id, `due:${+row.next_evaluation_at}`)), session),
    );
    const last = page.at(-1)!;
    after = { at: last.next_evaluation_at, subject_id: last.subject_id };
    if (page.length < EVALUATION_SWEEP_PAGE) break;
  }

  const value = admission.context.configuration.value;
  const current = engineCoverageOf(await store.loadCoverage(value.controls.rep_sms_capture_enabled, null, now), deskTimingOf(value));
  const coverage = { pages: 0, nominated: 0, call_through: current.call?.toISOString() ?? null, sms_through: current.sms?.toISOString() ?? null };
  for (const channel of ["call", "sms"] as const) {
    const through = current[channel];
    if (!through) continue; // no coverage: staying pending is correct, nothing to nominate
    let waitAfter: { at: Date; subject_id: string } | null = null;
    for (let pages = 0; pages < EVALUATION_SWEEP_MAX_PAGES; pages++) {
      const page = await store.coverageWaiting(channel, through, waitAfter, EVALUATION_SWEEP_PAGE);
      if (!page.length) break;
      coverage.pages++;
      coverage.nominated += await transaction((session) =>
        enqueueMissing(store, page.map((row) => evaluationJob(row.subject_id, coverageRepairCause(channel, row.wait, through))), session),
      );
      const last = page.at(-1)!;
      waitAfter = { at: last.wait, subject_id: last.subject_id };
      if (page.length < EVALUATION_SWEEP_PAGE) break;
    }
  }

  const reconcile = { pages: 0, checked: 0, nominated: 0, wrapped: false };
  while (reconcile.pages < EVALUATION_SWEEP_MAX_PAGES && !reconcile.wrapped) {
    const page = await transaction(async (session) => {
      const cursor = await store.readReconcileCursor(session);
      const ids = await store.subjectIdsAfter(cursor, EVALUATION_SWEEP_PAGE, session);
      const stored = await store.projectionPolicies(ids, session);
      const stale = ids.filter((id) => stored.get(id) !== fingerprint).map((id) => evaluationJob(id, `policy:${fingerprint.slice(0, 16)}`));
      const count = await enqueueMissing(store, stale, session);
      const short = ids.length < EVALUATION_SWEEP_PAGE;
      await store.writeReconcileCursor(short ? null : ids.at(-1)!, session);
      return { size: ids.length, count, short };
    });
    reconcile.pages++;
    reconcile.checked += page.size;
    reconcile.nominated += page.count;
    reconcile.wrapped = page.short;
  }
  return { skipped: false, reason: null, due, coverage, reconcile, drain_options: evaluateDrainOptionsOf(deskTimingOf(value)) };
}
