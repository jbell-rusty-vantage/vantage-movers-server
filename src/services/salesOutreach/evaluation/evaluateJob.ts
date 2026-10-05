import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongoose";
import type { SalesOutreachCadenceExposure } from "../../../config/domain/salesOutreach";
import { withTransaction } from "../../../db";
import { logger } from "../../../logger";
import { CsiError } from "../../salesIntelligence/auth";
import { claimCsiJob, completeCsiJob, failCsiJob, type JobInput, type JobLease } from "../../salesIntelligence/jobs";
import { salesOutreachConfigurationLoader, type ActiveConfiguration, type ConfigurationLoader } from "../config/load";
import { evaluateSubject, type EnginePolicy } from "../engine";
import { OutreachError } from "../errors";
import { publishOutreachLive } from "../live/publish";
import type { ReadSession } from "../subjects/store";
import { buildEngineInput } from "./inputs";
import { cadenceExposureOf, deskEnginePolicy, policyFingerprint } from "./policyAdapter";
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
    context: { configuration: inspection, policy: resolved.policy, exposure, policy_fingerprint: policyFingerprint(resolved.policy, exposure) },
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
  const [periods, plans, restrictions, changes, events, coverage] = await Promise.all([
    store.loadPeriods(subject.id, read),
    store.loadPlans(subject.id, read),
    store.loadRestrictions(subject.contact_number_ids, read),
    store.loadAssignmentChanges(subject.lead, read),
    store.loadContactEvents(subject.id, read),
    store.loadCoverage(context.configuration.value.controls.rep_sms_capture_enabled, read),
  ]);
  const agents = [...new Set([subject.assigned_agent_id, ...changes.flatMap((c) => [c.before, c.after])].filter((a): a is string => a !== null))];
  const links = await store.loadRepLinks(agents, read);
  const input = buildEngineInput({
    subject,
    periods,
    plans,
    restrictions,
    assignment_changes: changes,
    rep_links: links,
    contact_events: events,
    coverage,
  });
  const result = evaluateSubject(input, context.policy, asOf.toISOString());
  const doc = toProjectionWrite(subject, result, {
    exposure: context.exposure,
    configuration_version: context.configuration.version,
    policy_fingerprint: context.policy_fingerprint,
    coverage,
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
export function evaluationJob(subjectId: string, cause: string, inputRevision = 0): JobInput {
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

/** Drains up to `max` (≤ 100) runnable `outreach_evaluate` jobs within `deadlineMs`. */
export async function drainOutreachEvaluateJobs(max = 100, deadlineMs = 40_000, deps: EvaluateJobDeps = {}) {
  const outcomes: Record<string, number> = {};
  const deadline = Date.now() + deadlineMs;
  for (let i = 0; i < Math.min(100, max) && Date.now() < deadline; i++) {
    const { status } = await runOutreachEvaluateJob(undefined, deps);
    outcomes[status] = (outcomes[status] ?? 0) + 1;
    if (status !== "completed" && status !== "retry") break;
  }
  return { outcomes };
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
  reconcile: { pages: number; checked: number; nominated: number; wrapped: boolean };
}>;

const skippedSweep = (reason: string): EvaluationSweepResult => ({
  skipped: true,
  reason,
  due: { pages: 0, nominated: 0 },
  reconcile: { pages: 0, checked: 0, nominated: 0, wrapped: false },
});

/**
 * The minute evaluation sweep (cron `/api/cron/sales-outreach-evaluate`):
 * 1. clock repair — projections with `next_evaluation_at <= now`, oldest first, in pages of 100 (≤ 5
 *    pages), each nominated once per due instant (`sod:evaluate:<subject>:due:<ms>`);
 * 2. policy reconcile — subjects by `_id` in pages of 100 (≤ 5 pages, durable cursor in
 *    `sales_intelligence_sync_state` scope `outreach_evaluation_reconcile`, wraps on a short page)
 *    whose projection is missing or was computed under another resolved policy/exposure.
 * Both only nominate jobs; the drain evaluates them. Nothing runs while evaluation is not admitted.
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
    due.nominated += await transaction(async (session) => {
      let count = 0;
      for (const row of page)
        if ((await store.enqueue(evaluationJob(row.subject_id, `due:${+row.next_evaluation_at}`), session)) === "enqueued") count++;
      return count;
    });
    const last = page.at(-1)!;
    after = { at: last.next_evaluation_at, subject_id: last.subject_id };
    if (page.length < EVALUATION_SWEEP_PAGE) break;
  }

  const reconcile = { pages: 0, checked: 0, nominated: 0, wrapped: false };
  while (reconcile.pages < EVALUATION_SWEEP_MAX_PAGES && !reconcile.wrapped) {
    const page = await transaction(async (session) => {
      const cursor = await store.readReconcileCursor(session);
      const ids = await store.subjectIdsAfter(cursor, EVALUATION_SWEEP_PAGE, session);
      const stored = await store.projectionPolicies(ids, session);
      let count = 0;
      for (const id of ids) {
        if (stored.get(id) === fingerprint) continue;
        if ((await store.enqueue(evaluationJob(id, `policy:${fingerprint.slice(0, 16)}`), session)) === "enqueued") count++;
      }
      const short = ids.length < EVALUATION_SWEEP_PAGE;
      await store.writeReconcileCursor(short ? null : ids.at(-1)!, session);
      return { size: ids.length, count, short };
    });
    reconcile.pages++;
    reconcile.checked += page.size;
    reconcile.nominated += page.count;
    reconcile.wrapped = page.short;
  }
  return { skipped: false, reason: null, due, reconcile };
}
