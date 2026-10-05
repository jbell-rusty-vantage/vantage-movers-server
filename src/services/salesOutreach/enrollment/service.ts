import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongoose";
import { withTransaction } from "../../../db";
import { CsiError, type CsiActor } from "../../salesIntelligence/auth";
import { appendCsiAudit, executeCsiCommand } from "../../salesIntelligence/transactions";
import { salesOutreachConfigurationLoader, type ActiveConfiguration, type ConfigurationLoader } from "../config/load";
import { addDays } from "../engine/calendar";
import { OutreachError } from "../errors";
import { newYorkBusinessDay, newYorkDayBounds } from "../reads/businessDay";
import { deskLeadKey, type DeskLeadFacts, type DeskLeadRef } from "../subjects/leadFacts";
import { mongoDeskSubjectStore, type DeskSubjectStore } from "../subjects/store";
import { hasAmbiguousIdentity, loadSubjectPageContext, syncSubject } from "../subjects/sync";
import {
  backfillScopeOf,
  canonicalLeadRefs,
  classifyEnrollmentCandidate,
  ENROLLMENT_ALGORITHM_VERSION,
  ENROLLMENT_MAX_SELECTION,
  ENROLLMENT_PARTITIONS,
  enrollmentManifestHash,
  type BackfillScope,
  type CandidateClassification,
  type EnrollmentPartition,
  type EnrollmentScope,
} from "./classify";
import { mongoEnrollmentStore, type EnrollmentLease, type EnrollmentRunRow, type EnrollmentSkip, type EnrollmentStore } from "./store";

/** Registered command kind of the enrollment apply start (CSI command ledger; never a legacy name). */
export const SALES_OUTREACH_ENROLLMENT_APPLY_COMMAND = "sales_outreach_enrollment_apply" as const;
const REPORT_PAGE = 500;
const CANDIDATE_SCAN_BUDGET = 1_000;
const CANDIDATE_PAGE = 200;
const REVIEW_SAMPLE = 200;
const RUN_LEASE_MS = 300_000;
/** FAST-01: batches of 25 (`migration.batch_size`), never above 100 per transaction. */
const MAX_BATCH = 100;
const DEFAULT_APPLY_DEADLINE_MS = 600_000;

export type EnrollmentKind = "pilot" | "expansion";
export type EnrollmentSelection = Readonly<{ mode: "backfill_scope" }> | Readonly<{ mode: "selected"; lead_refs: readonly DeskLeadRef[] }>;

export type EnrollmentDeps = {
  loader?: ConfigurationLoader;
  subjects?: DeskSubjectStore;
  store?: EnrollmentStore;
  run?: typeof executeCsiCommand;
  audit?: typeof appendCsiAudit;
  transaction?: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

const resolved = (deps: EnrollmentDeps) => ({
  loader: deps.loader ?? salesOutreachConfigurationLoader,
  subjects: deps.subjects ?? mongoDeskSubjectStore,
  store: deps.store ?? mongoEnrollmentStore,
  run: deps.run ?? executeCsiCommand,
  audit: deps.audit ?? appendCsiAudit,
  transaction: deps.transaction ?? withTransaction,
  now: deps.now ?? (() => new Date()),
  sleep: deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
});

const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

/** Classifies one page of Lead facts with one batched read of subjects and Job Number counts. Read-only. */
async function classifyPage(
  facts: readonly DeskLeadFacts[],
  input: { as_of: Date; scope: EnrollmentScope; configuration: ActiveConfiguration },
  subjects: DeskSubjectStore,
): Promise<CandidateClassification[]> {
  if (!facts.length) return [];
  const [enrolled, job_number_counts] = await Promise.all([
    subjects.findSubjects(facts.map((f) => f.ref), null),
    subjects.jobNumberLeadCounts(facts.flatMap((f) => (f.normalized_job_no && !f.duplicate ? [f.normalized_job_no] : [])), null),
  ]);
  const context = { job_number_counts };
  const enrolledKeys = new Set(enrolled.map((s) => deskLeadKey(s.lead)));
  return facts.map((f) =>
    classifyEnrollmentCandidate(f, {
      as_of: input.as_of,
      cadence: input.configuration.value.cadence,
      scope: input.scope,
      enrolled: enrolledKeys.has(deskLeadKey(f.ref)),
      ambiguous_identity: hasAmbiguousIdentity(f, context),
    }),
  );
}

/** Stored-`timestamp` prefilter that is a superset of the backfill received window (wall clock ≤ instant). */
function backfillPrefilter(scope: BackfillScope) {
  return {
    timestamp_from: newYorkDayBounds(addDays(scope.cutoff_date, -1)).start,
    ...(scope.include_upcoming_moves ? { move_date_from: new Date(`${scope.today}T00:00:00.000Z`) } : {}),
  };
}

export type EnrollmentReport = Readonly<{
  contract_version: "sod-v1";
  mode: "report";
  as_of: string;
  kind: EnrollmentKind;
  cohort_id: string;
  configuration_version: string;
  configuration_revision: number;
  algorithm_version: typeof ENROLLMENT_ALGORITHM_VERSION;
  scope: EnrollmentScope;
  counts: Record<EnrollmentPartition, number>;
  reasons: Record<string, number>;
  /** The frozen selection (`in_scope`), canonical order; apply must send exactly these with `manifest_hash`. */
  lead_refs: DeskLeadRef[];
  manifest_hash: string;
  review: CandidateClassification[];
  review_truncated: boolean;
  writes: 0;
}>;

/**
 * `report` (MANUAL-START step 3, FAST-01 step 6): classifies the selection — the FAST-01 backfill scope
 * from the persisted `transition` fields, or explicit Lead ids — into partitions and returns the frozen
 * in-scope selection with its manifest hash. It makes zero writes and nominates no jobs.
 */
export async function reportEnrollment(
  input: Readonly<{ selection: EnrollmentSelection; kind?: EnrollmentKind; cohort_id?: string }>,
  deps: EnrollmentDeps = {},
): Promise<EnrollmentReport> {
  const { loader, subjects, store, now } = resolved(deps);
  const asOf = now();
  const configuration = await loader.requireActive();
  const kind = input.kind ?? "expansion";
  const scope: EnrollmentScope =
    input.selection.mode === "backfill_scope" ? backfillScopeOf(configuration.value.transition, asOf) : { mode: "selected", today: newYorkBusinessDay(asOf) };
  const cohort_id = input.cohort_id ?? `${kind}:${scope.today}`;
  const counts = Object.fromEntries(ENROLLMENT_PARTITIONS.map((p) => [p, 0])) as Record<EnrollmentPartition, number>;
  const reasons: Record<string, number> = {};
  const selected: DeskLeadRef[] = [];
  const review: CandidateClassification[] = [];
  let reviewTotal = 0;
  const record = (rows: readonly CandidateClassification[]) => {
    for (const row of rows) {
      counts[row.partition]++;
      reasons[`${row.partition}:${row.reason}`] = (reasons[`${row.partition}:${row.reason}`] ?? 0) + 1;
      if (row.partition === "in_scope") selected.push(row.lead);
      if (row.partition === "review" && ++reviewTotal <= REVIEW_SAMPLE) review.push(row);
    }
  };
  const options = { as_of: asOf, scope, configuration };
  if (input.selection.mode === "selected") {
    const refs = canonicalLeadRefs(input.selection.lead_refs);
    if (refs.length > ENROLLMENT_MAX_SELECTION) throw new OutreachError("INVALID_INPUT", [{ path: "selection.lead_refs", code: "too_many" }]);
    for (const chunk of chunks(refs, REPORT_PAGE)) {
      const facts = await subjects.loadLeads(chunk, null);
      const found = new Set(facts.map((f) => deskLeadKey(f.ref)));
      record(await classifyPage(facts, options, subjects));
      for (const ref of chunk.filter((r) => !found.has(deskLeadKey(r)))) {
        counts.review++;
        reasons["review:lead_not_found"] = (reasons["review:lead_not_found"] ?? 0) + 1;
        if (++reviewTotal <= REVIEW_SAMPLE)
          review.push({ lead: ref, partition: "review", reason: "lead_not_found", workflow: null, priority_raw: null, received_date: null, move_date: null, job_no: null, name: null });
      }
    }
  } else {
    const filter = backfillPrefilter(backfillScopeOf(configuration.value.transition, asOf));
    for (const model of ["FormLead", "CallLead"] as const) {
      for (let after: string | null = null; ; ) {
        const facts = await store.scanLeads(model, { after_id: after, limit: REPORT_PAGE, direction: 1, filter });
        record(await classifyPage(facts, options, subjects));
        if (facts.length < REPORT_PAGE) break;
        after = facts.at(-1)!.ref.id;
      }
    }
  }
  if (selected.length > ENROLLMENT_MAX_SELECTION)
    throw new OutreachError("INVALID_INPUT", [{ path: "selection", code: "scope_too_large", message: `${selected.length} Leads; enroll in smaller cohorts` }]);
  const lead_refs = canonicalLeadRefs(selected);
  return {
    contract_version: "sod-v1",
    mode: "report",
    as_of: asOf.toISOString(),
    kind,
    cohort_id,
    configuration_version: configuration.version,
    configuration_revision: configuration.revision,
    algorithm_version: ENROLLMENT_ALGORITHM_VERSION,
    scope,
    counts,
    reasons,
    lead_refs,
    manifest_hash: enrollmentManifestHash({ kind, cohort_id, configuration_version: configuration.version, lead_refs }),
    review,
    review_truncated: reviewTotal > REVIEW_SAMPLE,
    writes: 0,
  };
}

export type CandidatesPage = Readonly<{
  contract_version: "sod-v1";
  as_of: string;
  partition: EnrollmentPartition;
  scope: EnrollmentScope;
  items: CandidateClassification[];
  next_cursor: string | null;
  scanned: number;
}>;

type CandidateCursor = { m: 0 | 1; a: string | null };
const MODELS = ["FormLead", "CallLead"] as const;
const encodeCursor = (cursor: CandidateCursor) => Buffer.from(JSON.stringify(cursor)).toString("base64url");
function decodeCursor(raw: string | undefined): CandidateCursor {
  if (!raw) return { m: 0, a: null };
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as CandidateCursor;
    if ((parsed.m === 0 || parsed.m === 1) && (parsed.a === null || /^[a-f\d]{24}$/.test(parsed.a))) return parsed;
  } catch {
    /* falls through */
  }
  throw new OutreachError("CURSOR_EXPIRED", [{ path: "cursor", code: "invalid_cursor" }]);
}

/**
 * `GET /enrollment/candidates`: one page of Leads in a partition, newest first — the Owner Settings
 * "Not enrolled — older" list (one-click Enroll goes through report/apply with `selected`) and the
 * review list. Bounded: at most 1,000 Leads are examined per request; `next_cursor` continues.
 */
export async function listEnrollmentCandidates(
  input: Readonly<{ partition: EnrollmentPartition; cursor?: string; limit?: number }>,
  deps: EnrollmentDeps = {},
): Promise<CandidatesPage> {
  const { loader, subjects, store, now } = resolved(deps);
  const asOf = now();
  const configuration = await loader.requireActive();
  const scope = backfillScopeOf(configuration.value.transition, asOf);
  const limit = Math.max(1, Math.min(100, input.limit ?? 25));
  const cursor = decodeCursor(input.cursor);
  const filter = input.partition === "older" ? { timestamp_before: newYorkDayBounds(scope.cutoff_date).end } : null;
  const items: CandidateClassification[] = [];
  let scanned = 0;
  let position: CandidateCursor | null = cursor;
  while (position && items.length < limit && scanned < CANDIDATE_SCAN_BUDGET) {
    const pageLimit = Math.min(CANDIDATE_PAGE, CANDIDATE_SCAN_BUDGET - scanned);
    const facts = await store.scanLeads(MODELS[position.m], { after_id: position.a, limit: pageLimit, direction: -1, filter });
    const rows = await classifyPage(facts, { as_of: asOf, scope, configuration }, subjects);
    let consumed = 0;
    for (const row of rows) {
      consumed++;
      if (row.partition === input.partition) items.push(row);
      if (items.length >= limit) break;
    }
    scanned += consumed;
    const modelExhausted = facts.length < pageLimit && consumed === facts.length;
    if (modelExhausted) position = position.m === 0 ? { m: 1, a: null } : null;
    else position = { m: position.m, a: facts[consumed - 1]!.ref.id };
  }
  return {
    contract_version: "sod-v1",
    as_of: asOf.toISOString(),
    partition: input.partition,
    scope,
    items,
    next_cursor: position ? encodeCursor(position) : null,
    scanned,
  };
}

export type EnrollmentApplyResult = Readonly<{
  contract_version: "sod-v1";
  mode: "apply";
  run_key: string;
  status: "running" | "completed" | "paused" | "lease_held" | "failed";
  activation_at: string;
  manifest_hash: string;
  selected: number;
  next_index: number;
  batches_this_call: number;
  counts: Record<string, number>;
  pause_reason: string | null;
  replayed: boolean;
}>;

const RUN_KEY = /^[A-Za-z0-9:._-]{1,120}$/;

/**
 * `apply` (P10a/P10b, FAST-01 step 6): freezes the reported selection in a run (`run_key` = the
 * Idempotency-Key), fixing the activation boundary at the moment of apply, then enrolls in bounded
 * batches (`migration.batch_size`, 25) under a single-writer lease, each batch's subjects, activation
 * periods and checkpoint in one transaction. Re-running the same key resumes from the checkpoint and
 * never re-prices the boundary or grows the scope; already-enrolled Leads are skipped. The migration
 * pause stops new batches (committed work stays). Each Lead is re-validated at write time.
 */
export async function applyEnrollment(
  input: Readonly<{
    actor: CsiActor;
    run_key: string;
    kind: EnrollmentKind;
    cohort_id: string;
    lead_refs: readonly DeskLeadRef[];
    manifest_hash: string;
    deadline_ms?: number;
  }>,
  deps: EnrollmentDeps = {},
): Promise<EnrollmentApplyResult> {
  const d = resolved(deps);
  if (!RUN_KEY.test(input.run_key)) throw new OutreachError("INVALID_INPUT", [{ path: "run_key", code: "invalid" }]);
  const refs = canonicalLeadRefs(input.lead_refs);
  if (!refs.length || refs.length > ENROLLMENT_MAX_SELECTION) throw new OutreachError("INVALID_INPUT", [{ path: "lead_refs", code: "size" }]);
  const existing = await d.store.findRun(input.run_key);
  let replayed = Boolean(existing);
  if (existing) {
    if (existing.mode !== "apply" || existing.manifest_hash !== input.manifest_hash) throw new OutreachError("IDEMPOTENCY_CONFLICT", [{ path: "run_key", code: "different_manifest" }]);
  } else {
    const configuration = await d.loader.requireActive();
    if (configuration.value.migration.paused) throw new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "migration.paused", code: "migration_paused" }]);
    const expected = enrollmentManifestHash({ kind: input.kind, cohort_id: input.cohort_id, configuration_version: configuration.version, lead_refs: refs });
    if (expected !== input.manifest_hash) throw new OutreachError("REVISION_CONFLICT", [{ path: "manifest_hash", code: "manifest_mismatch" }]);
    const started = await d.run<{ run_key: string; activation_at: string }>({
      actor: input.actor,
      command: SALES_OUTREACH_ENROLLMENT_APPLY_COMMAND,
      idempotency_key: input.run_key,
      payload: { manifest_hash: input.manifest_hash, kind: input.kind, cohort_id: input.cohort_id, selected: refs.length },
      operation: async (context) => {
        const raced = await d.store.findRun(input.run_key, context.session);
        if (raced) {
          if (raced.manifest_hash !== input.manifest_hash) throw new CsiError("IDEMPOTENCY_CONFLICT");
          return { run_key: raced.run_key, activation_at: raced.activation_at.toISOString() };
        }
        await d.store.insertRun(
          {
            run_key: input.run_key,
            mode: "apply",
            kind: input.kind,
            cohort_id: input.cohort_id,
            manifest_hash: input.manifest_hash,
            activation_at: context.now,
            configuration_version: configuration.version,
            algorithm_version: ENROLLMENT_ALGORITHM_VERSION,
            selected_leads: refs,
            status: "running",
            next_index: 0,
            last_committed_batch: 0,
            counts: {},
            results: { skipped: [], pause_reason: null },
            started_at: context.now,
            actor: context.actor,
          },
          context.session,
        );
        await d.audit(context, {
          subject_key: `sales_outreach_enrollment:${input.run_key}`,
          event_kind: "sales_outreach_enrollment_started",
          prior: {},
          current: {
            run_key: input.run_key,
            manifest_hash: input.manifest_hash,
            kind: input.kind,
            cohort_id: input.cohort_id,
            selected: refs.length,
            activation_at: context.now.toISOString(),
            configuration_version: configuration.version,
          },
          target_id: input.run_key,
          revision: 1,
          kind: "job",
        });
        return { run_key: input.run_key, activation_at: context.now.toISOString() };
      },
    });
    replayed = started.replayed;
  }
  return continueEnrollment(input.run_key, { ...deps, deadline_ms: input.deadline_ms, replayed });
}

const CONFIGURATION_MOVED = "configuration_moved";

async function continueEnrollment(runKey: string, deps: EnrollmentDeps & { deadline_ms?: number; replayed: boolean }): Promise<EnrollmentApplyResult> {
  const d = resolved(deps);
  const owner = `sod-enrollment:${randomUUID()}`;
  const run = await d.store.acquireRunLease(runKey, owner, d.now(), RUN_LEASE_MS);
  if (!run) {
    const current = await d.store.findRun(runKey);
    if (!current) throw new OutreachError("NOT_FOUND");
    return applyResult(current, current.status === "running" ? "lease_held" : current.status, 0, deps.replayed);
  }
  const lease: EnrollmentLease = { run_key: runKey, owner, epoch: run.lease_epoch };
  const deadline = Date.now() + (deps.deadline_ms ?? DEFAULT_APPLY_DEADLINE_MS);
  const counts = { ...run.counts };
  let index = run.next_index;
  let batches = 0;
  let moved = 0;
  const finish = async (status: "running" | "completed" | "paused", reason: string | null = null) => {
    await d.store.releaseRun(lease, status, d.now(), reason);
    return applyResult({ ...run, next_index: index, counts, status, results: { ...run.results, pause_reason: reason } }, status, batches, deps.replayed);
  };
  for (;;) {
    const admitted = await d.loader.inspect();
    if (admitted.state !== "active") return finish("paused", "configuration_unavailable");
    if (admitted.value.migration.paused) return finish("paused", "migration_paused");
    const batch = run.selected_leads.slice(index, index + Math.max(1, Math.min(MAX_BATCH, admitted.value.migration.batch_size)));
    if (!batch.length) return finish("completed");
    let batchCounts: Record<string, number>;
    try {
      batchCounts = await d.transaction((session) => enrollBatch(batch, run, lease, admitted, d, session));
    } catch (error) {
      if (error instanceof OutreachError && error.issues?.[0]?.code === CONFIGURATION_MOVED && ++moved <= 3) continue;
      if (error instanceof CsiError && error.code === "LEASE_LOST")
        return applyResult({ ...run, next_index: index, counts }, "lease_held", batches, deps.replayed);
      await d.store.releaseRun(lease, "running", d.now(), null);
      throw error;
    }
    moved = 0;
    index += batch.length;
    batches++;
    for (const [key, value] of Object.entries(batchCounts)) counts[key] = (counts[key] ?? 0) + value;
    if (index >= run.selected_leads.length) return finish("completed");
    if (Date.now() >= deadline) return finish("running");
    await d.sleep(admitted.value.migration.interval_seconds * 1000);
  }
}

/** One bounded batch: re-validates each Lead and enrolls it at the run's fixed boundary; checkpoints under the lease. */
async function enrollBatch(
  batch: readonly DeskLeadRef[],
  run: EnrollmentRunRow,
  lease: EnrollmentLease,
  admitted: ActiveConfiguration,
  d: ReturnType<typeof resolved>,
  session: ClientSession,
): Promise<Record<string, number>> {
  const configuration = await d.loader.requireActive(session);
  if (configuration.revision !== admitted.revision || configuration.version !== admitted.version)
    throw new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "configuration", code: CONFIGURATION_MOVED }]);
  const now = d.now();
  const facts = await d.subjects.loadLeads(batch, session);
  const byKey = new Map(facts.map((f) => [deskLeadKey(f.ref), f]));
  const existing = new Set((await d.subjects.findSubjects(batch, session)).map((s) => deskLeadKey(s.lead)));
  const context = await loadSubjectPageContext(d.subjects, facts, now, session);
  const counts: Record<string, number> = {};
  const skipped: EnrollmentSkip[] = [];
  const count = (key: string) => (counts[key] = (counts[key] ?? 0) + 1);
  for (const ref of batch) {
    const f = byKey.get(deskLeadKey(ref));
    if (!f) {
      count("skipped_review");
      skipped.push({ lead: ref, partition: "review", reason: "lead_not_found" });
      continue;
    }
    const classified = classifyEnrollmentCandidate(f, {
      as_of: now,
      cadence: configuration.value.cadence,
      scope: { mode: "selected", today: newYorkBusinessDay(now) },
      enrolled: existing.has(deskLeadKey(ref)),
      ambiguous_identity: hasAmbiguousIdentity(f, context),
    });
    if (classified.partition === "already_enrolled") {
      count("already_enrolled");
      continue;
    }
    if (classified.partition !== "in_scope") {
      count(`skipped_${classified.partition}`);
      skipped.push({ lead: ref, partition: classified.partition, reason: classified.reason });
      continue;
    }
    await syncSubject(
      {
        facts: f,
        subject: null,
        enrollment: { cohort_id: run.cohort_id, kind: run.kind, enrolled_at: now, activation_at: run.activation_at, manifest_hash: run.manifest_hash },
        configuration,
        context,
      },
      d.subjects,
      session,
    );
    count("enrolled");
  }
  if (!(await d.store.checkpointRun(lease, { advance: batch.length, counts, skipped, now, ttl_ms: RUN_LEASE_MS }, session))) throw new CsiError("LEASE_LOST");
  return counts;
}

function applyResult(run: EnrollmentRunRow, status: EnrollmentApplyResult["status"], batches: number, replayed: boolean): EnrollmentApplyResult {
  return {
    contract_version: "sod-v1",
    mode: "apply",
    run_key: run.run_key,
    status,
    activation_at: run.activation_at.toISOString(),
    manifest_hash: run.manifest_hash,
    selected: run.selected_leads.length,
    next_index: run.next_index,
    batches_this_call: batches,
    counts: run.counts,
    pause_reason: run.results.pause_reason,
    replayed,
  };
}

export type EnrollmentVerifyResult = Readonly<{
  contract_version: "sod-v1";
  mode: "verify";
  run_key: string;
  run_status: EnrollmentRunRow["status"];
  complete: boolean;
  consistent: boolean;
  counts: Record<string, number>;
  mismatches: Array<{ lead: DeskLeadRef; problem: string }>;
}>;

const VERIFY_PAGE = 100;
const MAX_MISMATCHES = 200;

/**
 * `verify` (MANUAL-START step 6): reconciles an apply run against the desk — every Lead the run
 * enrolled has a subject carrying the run's manifest and fixed boundary and exactly one active period
 * that started as an `activation` at that boundary; the enrolled count matches the checkpointed one.
 * Re-runnable; it writes only its own `verify:<run_key>` document.
 */
export async function verifyEnrollment(input: Readonly<{ actor: CsiActor; run_key: string }>, deps: EnrollmentDeps = {}): Promise<EnrollmentVerifyResult> {
  const d = resolved(deps);
  const run = await d.store.findRun(input.run_key);
  if (!run || run.mode !== "apply") throw new OutreachError("NOT_FOUND");
  const counts: Record<string, number> = { selected: run.selected_leads.length, processed: run.next_index, enrolled_by_run: 0, enrolled_elsewhere: 0, not_enrolled: 0 };
  const mismatches: Array<{ lead: DeskLeadRef; problem: string }> = [];
  const mismatch = (lead: DeskLeadRef, problem: string) => {
    counts[`mismatch_${problem}`] = (counts[`mismatch_${problem}`] ?? 0) + 1;
    if (mismatches.length < MAX_MISMATCHES) mismatches.push({ lead, problem });
  };
  for (const chunk of chunks(run.selected_leads, VERIFY_PAGE)) {
    const bySubject = new Map((await d.subjects.findSubjects(chunk, null)).map((s) => [deskLeadKey(s.lead), s]));
    for (const ref of chunk) {
      const subject = bySubject.get(deskLeadKey(ref));
      if (!subject) {
        counts.not_enrolled++;
        continue;
      }
      if (subject.enrollment.manifest_hash !== run.manifest_hash) {
        counts.enrolled_elsewhere++;
        continue;
      }
      counts.enrolled_by_run++;
      if (+subject.enrollment.activation_at !== +run.activation_at) mismatch(ref, "boundary_mismatch");
      if (!subject.received_at) mismatch(ref, "received_missing");
      const periods = await d.subjects.findPeriods(subject.id, null);
      const active = periods.filter((p) => p.ended_at === null);
      if (active.length !== 1) mismatch(ref, active.length ? "multiple_active_periods" : "no_active_period");
      const first = periods[0];
      if (first && (first.start_kind !== "activation" || +first.started_at !== +run.activation_at)) mismatch(ref, "first_period_not_at_boundary");
    }
  }
  const complete = run.status === "completed";
  const consistent = counts.enrolled_by_run === (run.counts.enrolled ?? 0) && mismatches.length === 0 && !Object.keys(counts).some((k) => k.startsWith("mismatch_"));
  const result: EnrollmentVerifyResult = { contract_version: "sod-v1", mode: "verify", run_key: run.run_key, run_status: run.status, complete, consistent, counts, mismatches };
  await d.store.saveVerifyRun(run, { counts, verify: { complete, consistent, mismatches } }, input.actor, d.now());
  return result;
}
