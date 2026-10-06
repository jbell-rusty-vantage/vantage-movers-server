import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toFloridaTimestamp } from "../../../utils/easternTime";
import { csiOperatorActor } from "../../salesIntelligence/auth";
import type { ConfigurationLoader } from "../config/load";
import { evaluateSubject } from "../engine";
import { fixture, policyWith } from "../engine/testSupport";
import { fixedConfigurationLoader } from "../reads/testing";
import { deskLeadKey, type DeskLeadFacts } from "../subjects/leadFacts";
import { refreshLeadForOutreach } from "../subjects/leadChangeJob";
import { accepted, deskConfiguration, fakeSession, leadFacts, MemoryDeskSubjectStore, objectId } from "../subjects/testing";
import { enrollmentManifestHash } from "./classify";
import { applyEnrollment, candidateLegs, listEnrollmentCandidates, objectIdFloorAt, reportEnrollment, verifyCohort, verifyEnrollment } from "./service";
import { memoryEnrollmentDeps, MemoryEnrollmentStore } from "./testing";

const AS_OF = "2026-10-05T12:00:00.000Z"; // 08:00 New York, the preferred P10b activation minute
const owner = () => csiOperatorActor("sod-enrollment-test");
/** A Lead received at a real instant (stored as the live ET wall clock). */
const receivedAt = (iso: string) => ({ timestamp: toFloridaTimestamp(new Date(iso)), created_at: new Date(Date.parse(iso) + 2_000) });
const id = (n: number) => n.toString(16).padStart(24, "0");
/** An ObjectId created at `iso` (the Lead's insert time), counter `n`: the candidates' `_id` bounds read this time. */
const idAt = (iso: string, n: number) => objectIdFloorAt(new Date(iso)).slice(0, 8) + n.toString(16).padStart(16, "0");

function configured(overrides: { paused?: boolean; lookback?: number | null; include?: boolean | null; batch?: number } = {}) {
  return deskConfiguration({
    transition: { backfill_lookback_days: overrides.lookback === undefined ? 90 : overrides.lookback, backfill_include_upcoming_moves: overrides.include === undefined ? true : overrides.include },
    migration: { paused: overrides.paused ?? false, batch_size: overrides.batch ?? 25 },
  });
}

function world(loader: ConfigurationLoader = fixedConfigurationLoader(configured())) {
  const subjects = new MemoryDeskSubjectStore();
  const store = new MemoryEnrollmentStore(subjects);
  const harness = memoryEnrollmentDeps(subjects, store, { loader });
  harness.setClock(AS_OF);
  return { subjects, store, ...harness };
}

/** The partition fixture: one Lead per outcome (ids ascending so scans are deterministic). */
function seedPartitions(subjects: MemoryDeskSubjectStore) {
  const add = (n: number, overrides: Parameters<typeof leadFacts>[0]) => subjects.addLead(leadFacts({ id: id(n), ...receivedAt("2026-09-25T14:00:00Z"), ...overrides }));
  return {
    newRecent: add(1, { ...accepted("0", "2026-09-25T14:05:00Z") }),
    quotedUpcoming: add(2, { ...accepted("1", "2026-03-01T14:05:00Z"), ...receivedAt("2026-03-01T14:00:00Z"), move_date: "2026-11-01" }),
    olderDefault: add(3, { ...receivedAt("2026-03-01T14:00:00Z"), move_date: "2026-04-01" }),
    discretion: add(4, { ...accepted("3", "2026-09-25T14:05:00Z") }),
    booked5: add(5, { ...accepted("5", "2026-09-25T14:05:00Z") }),
    officialBooking: add(6, { booked_id: objectId() }),
    duplicate: add(7, { duplicate: true }),
    granotMissing: add(8, { ingestion_origin: "granot_lead_created", timestamp: new Date("2026-09-25T14:00:00Z") }),
    unmapped: add(9, { ...accepted("42", "2026-09-25T14:05:00Z") }),
    legacy: add(10, { ingestion_origin: "legacy_unknown" }),
    ambiguousA: add(11, { normalized_job_no: "J-9" }),
    ambiguousB: add(12, { model: "CallLead", normalized_job_no: "J-9" }),
    cutoffIn: add(13, receivedAt("2026-07-07T04:30:00Z")), // 00:30 New York on the cutoff date (today − 90)
    cutoffOut: add(14, receivedAt("2026-07-07T03:30:00Z")), // 23:30 New York the day before
    callNew: add(15, { model: "CallLead" }),
  };
}

describe("enrollment report (zero writes, FAST-01 backfill scope)", () => {
  test("partitions every Lead per FAST-01 and freezes the in-scope selection; it writes nothing", async () => {
    const { subjects, store, deps, ledger, audits } = world();
    const leads = seedPartitions(subjects);
    const report = await reportEnrollment({ selection: { mode: "backfill_scope" } }, deps);
    assert.deepEqual(report.scope, { mode: "backfill_scope", today: "2026-10-05", cutoff_date: "2026-07-07", lookback_days: 90, include_upcoming_moves: true });
    const keys = report.lead_refs.map(deskLeadKey);
    for (const lead of [leads.newRecent, leads.quotedUpcoming, leads.cutoffIn, leads.callNew]) assert.ok(keys.includes(deskLeadKey(lead.ref)), deskLeadKey(lead.ref));
    assert.equal(keys.length, 4);
    assert.equal(report.counts.closed, 2);
    assert.equal(report.counts.excluded, 1);
    assert.equal(report.counts.not_new_or_quoted, 1);
    assert.equal(report.counts.review, 5, "granot missing, unmapped, legacy source, two ambiguous");
    assert.equal(report.reasons["review:ambiguous_identity"], 2);
    assert.equal(report.reasons["review:priority_needs_review"], 1);
    assert.equal(report.reasons["review:unmapped_priority"], 1);
    assert.equal(report.reasons["review:unsupported_intake_source"], 1);
    assert.equal(report.reasons["in_scope:upcoming_move"], 1);
    // The stored-timestamp prefilter drops anything far outside the window; the precise cutoff is a New York date.
    assert.ok(!keys.includes(deskLeadKey(leads.cutoffOut.ref)));
    assert.ok(!keys.includes(deskLeadKey(leads.olderDefault.ref)));
    assert.equal(report.manifest_hash, enrollmentManifestHash({ kind: "expansion", cohort_id: "expansion:2026-10-05", configuration_version: "v-test", lead_refs: report.lead_refs }));
    // p10b: report_writes 0.
    assert.equal(fixture<{ report_writes: number }>("p10b-manual-start.json").report_writes, 0);
    assert.equal(report.writes, 0);
    assert.deepEqual([subjects.writes, store.writes, subjects.evaluations, audits], [[], [], [], []]);
    assert.equal(ledger.size, 0);
  });

  test("selected mode classifies explicit ids (pilot); missing or unreliable received time is review, never guessed", async () => {
    const { subjects, deps } = world();
    const good = subjects.addLead(leadFacts({ ...receivedAt("2026-01-01T14:00:00Z") }));
    const missing = subjects.addLead(leadFacts({ timestamp: null }));
    const ghost = { model: "FormLead" as const, id: objectId() };
    const report = await reportEnrollment({ selection: { mode: "selected", lead_refs: [good.ref, missing.ref, ghost, good.ref] }, kind: "pilot" }, deps);
    assert.deepEqual(report.lead_refs.map(deskLeadKey), [deskLeadKey(good.ref)], "selected ids skip the backfill window; duplicates collapse");
    assert.equal(report.reasons["review:received_time_missing"], 1);
    assert.equal(report.reasons["review:lead_not_found"], 1);
    assert.equal(report.cohort_id, "pilot:2026-10-05");
    assert.equal(fixture<{ missing_age_review: boolean }>("p10a-prospective-cutover.json").missing_age_review, true);
  });

  test("the backfill scope comes only from persisted configuration (fails closed when not installed)", async () => {
    const { subjects, deps } = world(fixedConfigurationLoader(configured({ lookback: null })));
    subjects.addLead(leadFacts());
    await assert.rejects(reportEnrollment({ selection: { mode: "backfill_scope" } }, deps), (e: unknown) => (e as { code?: string }).code === "CONFIGURATION_UNAVAILABLE");
    const off = world(fixedConfigurationLoader({ state: "uninitialized" }));
    await assert.rejects(reportEnrollment({ selection: { mode: "backfill_scope" } }, off.deps), (e: unknown) => (e as { code?: string }).code === "CONFIGURATION_UNAVAILABLE");
    const noUpcoming = world(fixedConfigurationLoader(configured({ include: false })));
    noUpcoming.subjects.addLead(leadFacts({ ...accepted("1", "2026-03-01T14:05:00Z"), ...receivedAt("2026-03-01T14:00:00Z"), move_date: "2026-11-01" }));
    assert.equal((await reportEnrollment({ selection: { mode: "backfill_scope" } }, noUpcoming.deps)).lead_refs.length, 0);
  });
});

function seedNew(subjects: MemoryDeskSubjectStore, count: number) {
  const leads: DeskLeadFacts[] = [];
  for (let i = 1; i <= count; i++) leads.push(subjects.addLead(leadFacts({ id: id(1000 + i), ...receivedAt("2026-09-27T14:00:00Z"), ...(i % 2 ? accepted("0", "2026-09-27T14:05:00Z") : accepted("1", "2026-09-28T14:05:00Z")) })));
  return leads;
}

async function reportAndApply(w: ReturnType<typeof world>, runKey: string, extra: { deadline_ms?: number } = {}) {
  const report = await reportEnrollment({ selection: { mode: "backfill_scope" } }, w.deps);
  const result = await applyEnrollment(
    { actor: owner(), run_key: runKey, kind: report.kind, cohort_id: report.cohort_id, lead_refs: report.lead_refs, manifest_hash: report.manifest_hash, ...extra },
    w.deps,
  );
  return { report, result };
}

describe("enrollment apply (P10a prospective cutover, bounded single-writer batches)", () => {
  test("bounded batches of 25 enroll the frozen selection at a fixed activation boundary (the moment of apply)", async () => {
    const w = world();
    const leads = seedNew(w.subjects, 60);
    const { result } = await reportAndApply(w, "backfill-2026-10-05");
    assert.equal(result.status, "completed");
    assert.equal(result.batches_this_call, 3, "25 + 25 + 10");
    assert.equal(result.counts.enrolled, 60);
    assert.equal(result.activation_at, AS_OF);
    assert.equal(w.subjects.subjects.length, 60);
    const fx = fixture<{ fixed_cohort_boundary: boolean; original_age_retained: boolean; new_pre_activation_misses: number; old_lead_initial_clock_restarted: boolean }>("p10a-prospective-cutover.json");
    for (const subject of w.subjects.subjects) {
      assert.equal(subject.enrollment.kind, "expansion");
      assert.equal(subject.enrollment.activation_at.toISOString(), AS_OF, "fixed cohort boundary");
      assert.equal(subject.received_at!.toISOString(), "2026-09-27T14:00:00.000Z", "original age retained");
    }
    assert.ok(fx.fixed_cohort_boundary && fx.original_age_retained);
    assert.ok(w.subjects.periods.every((p) => p.start_kind === "activation" && p.started_at.toISOString() === AS_OF && p.time_basis === "activation_boundary"));
    assert.deepEqual([...new Set(w.subjects.periods.map((p) => p.workflow))].sort(), ["new", "quoted"]);
    assert.equal(w.subjects.evaluations.length, 60, "every new subject nominates outreach_evaluate");
    assert.deepEqual(w.audits.map((a) => a.event_kind), ["sales_outreach_enrollment_started"]);
    // The canonical Leads are reused, never replaced or rewritten.
    assert.equal(w.subjects.leads.size, leads.length);

    // Engine view of one enrolled New Lead: no pre-activation debt and no fresh 30-minute clock (P10a).
    const subject = w.subjects.subjects.find((s) => w.subjects.periods.some((p) => p.subject_id === s.id && p.workflow === "new"))!;
    const period = w.subjects.periods.find((p) => p.subject_id === subject.id)!;
    const evaluated = evaluateSubject(
      {
        subject: { subject_id: subject.id, status: "active", closed_at: null, received_at: subject.received_at!.toISOString(), move_date: null, priority_uncertain: false, activation_at: AS_OF, originating_contact_event_id: null },
        periods: [{ period_id: period.id, workflow: "new", priority_raw: period.priority, start_kind: period.start_kind, started_at: period.started_at.toISOString(), ended_at: null }],
        human_plans: [], restrictions: [], assignments: [], contact_events: [],
        coverage: { call: { complete_through: "2026-10-05T20:00:00.000Z" }, sms: { complete_through: "2026-10-05T20:00:00.000Z" } },
      },
      policyWith({}),
      "2026-10-05T19:00:00.000Z",
    );
    assert.ok(evaluated.obligations.length > 0, "the activation date carries work");
    assert.equal(evaluated.obligations.filter((o) => o.due_at !== null && Date.parse(o.due_at) <= Date.parse(AS_OF)).length, fx.new_pre_activation_misses);
    assert.equal(evaluated.initial_response, null, "no fresh initial-response clock for an existing Lead");
    assert.equal(fx.old_lead_initial_clock_restarted, false);
  });

  test("re-running the same key is idempotent: the boundary is never repriced and the scope never grows", async () => {
    const w = world();
    seedNew(w.subjects, 30);
    const first = await reportAndApply(w, "run-a");
    const writes = [...w.subjects.writes];
    w.setClock("2026-10-05T15:00:00.000Z");
    seedNew(w.subjects, 0);
    w.subjects.addLead(leadFacts({ ...receivedAt("2026-10-05T13:00:00Z") })); // a new eligible Lead after the report
    const again = await applyEnrollment(
      { actor: owner(), run_key: "run-a", kind: first.report.kind, cohort_id: first.report.cohort_id, lead_refs: first.report.lead_refs, manifest_hash: first.report.manifest_hash },
      w.deps,
    );
    assert.equal(again.replayed, true);
    assert.equal(again.status, "completed");
    assert.equal(again.activation_at, AS_OF, "retry_reprices_boundary: false");
    assert.equal(again.selected, 30, "retry_expands_scope: false");
    assert.deepEqual(w.subjects.writes, writes);
    const fx = fixture<{ retry_expands_scope: boolean; selected_id_scope_frozen: boolean }>("p10b-manual-start.json");
    assert.ok(fx.selected_id_scope_frozen && !fx.retry_expands_scope);
    // The same key with a different manifest is refused.
    await assert.rejects(
      applyEnrollment({ actor: owner(), run_key: "run-a", kind: "expansion", cohort_id: "x", lead_refs: first.report.lead_refs, manifest_hash: "f".repeat(64) }, w.deps),
      (e: unknown) => (e as { code?: string }).code === "IDEMPOTENCY_CONFLICT",
    );
  });

  test("a manifest that does not match the selection and current configuration is refused before any write", async () => {
    const w = world();
    seedNew(w.subjects, 3);
    const report = await reportEnrollment({ selection: { mode: "backfill_scope" } }, w.deps);
    await assert.rejects(
      applyEnrollment({ actor: owner(), run_key: "run-b", kind: "expansion", cohort_id: report.cohort_id, lead_refs: report.lead_refs.slice(1), manifest_hash: report.manifest_hash }, w.deps),
      (e: unknown) => (e as { code?: string }).code === "REVISION_CONFLICT",
    );
    assert.deepEqual([w.store.writes, w.subjects.writes], [[], []]);
  });

  test("crash-resume: a lost worker's lease expires, the next apply continues from the checkpoint with no duplicates", async () => {
    const w = world();
    seedNew(w.subjects, 60);
    const { report, result } = await reportAndApply(w, "run-c", { deadline_ms: 0 });
    assert.equal(result.status, "running");
    assert.equal(result.next_index, 25, "one checkpointed batch");
    // A second worker takes the lease and dies without releasing it.
    assert.ok(await w.store.acquireRunLease("run-c", "dead-worker", new Date(AS_OF), 300_000));
    const body = { actor: owner(), run_key: "run-c", kind: report.kind, cohort_id: report.cohort_id, lead_refs: report.lead_refs, manifest_hash: report.manifest_hash };
    assert.equal((await applyEnrollment(body, w.deps)).status, "lease_held", "single writer");
    w.setClock("2026-10-05T12:06:00.000Z");
    const resumed = await applyEnrollment(body, w.deps);
    assert.equal(resumed.status, "completed");
    assert.equal(resumed.counts.enrolled, 60);
    assert.equal(w.subjects.subjects.length, 60);
    assert.equal(new Set(w.subjects.subjects.map((s) => deskLeadKey(s.lead))).size, 60);
    assert.ok(w.subjects.subjects.every((s) => s.enrollment.activation_at.toISOString() === AS_OF), "the recorded boundary survives the retry");
  });

  test("a batch whose checkpoint loses the lease rolls back its subjects (all-or-nothing batch)", async () => {
    const w = world();
    seedNew(w.subjects, 10);
    const report = await reportEnrollment({ selection: { mode: "backfill_scope" } }, w.deps);
    const checkpoint = w.store.checkpointRun.bind(w.store);
    w.store.checkpointRun = async () => false;
    const result = await applyEnrollment({ actor: owner(), run_key: "run-d", kind: report.kind, cohort_id: report.cohort_id, lead_refs: report.lead_refs, manifest_hash: report.manifest_hash }, w.deps);
    assert.equal(result.status, "lease_held");
    assert.equal(w.subjects.subjects.length, 0);
    w.store.checkpointRun = checkpoint;
  });

  test("the migration pause blocks admission and stops between batches; unpausing resumes", async () => {
    let paused = false;
    const loader: ConfigurationLoader = {
      inspect: async () => configured({ paused }),
      load: async () => configured({ paused }),
      requireActive: async () => configured({ paused }),
    };
    const w = world(loader);
    seedNew(w.subjects, 60);
    paused = true;
    await assert.rejects(reportAndApply(w, "run-e"), (e: unknown) => (e as { code?: string; issues?: Array<{ code: string }> }).issues?.[0]?.code === "migration_paused");
    paused = false;
    const report = await reportEnrollment({ selection: { mode: "backfill_scope" } }, w.deps);
    const body = { actor: owner(), run_key: "run-e", kind: report.kind, cohort_id: report.cohort_id, lead_refs: report.lead_refs, manifest_hash: report.manifest_hash };
    w.deps.sleep = async () => {
      paused = true; // the Owner pauses while the first batch sleeps
    };
    const stopped = await applyEnrollment(body, w.deps);
    assert.deepEqual([stopped.status, stopped.pause_reason, stopped.counts.enrolled], ["paused", "migration_paused", 25]);
    paused = false;
    w.deps.sleep = async () => undefined;
    const resumed = await applyEnrollment(body, w.deps);
    assert.deepEqual([resumed.status, resumed.counts.enrolled], ["completed", 60]);
  });

  test("each Lead is re-validated at write time: a change after the report is skipped, not enrolled", async () => {
    const w = world();
    const [first, second] = seedNew(w.subjects, 2);
    const report = await reportEnrollment({ selection: { mode: "backfill_scope" } }, w.deps);
    w.subjects.addLead({ ...first!, booked_id: objectId() });
    const result = await applyEnrollment({ actor: owner(), run_key: "run-f", kind: report.kind, cohort_id: report.cohort_id, lead_refs: report.lead_refs, manifest_hash: report.manifest_hash }, w.deps);
    assert.deepEqual(result.counts, { skipped_closed: 1, enrolled: 1 });
    assert.deepEqual(w.subjects.subjects.map((s) => deskLeadKey(s.lead)), [deskLeadKey(second!.ref)]);
    assert.deepEqual(w.store.runs[0]!.results.skipped, [{ lead: first!.ref, partition: "closed", reason: "official_booking" }]);
  });
});

describe("enrollment verify and candidates", () => {
  test("verify reconciles the run, is re-runnable, and writes only its own verify document", async () => {
    const w = world();
    seedNew(w.subjects, 30);
    await reportAndApply(w, "run-v");
    const subjectWrites = [...w.subjects.writes];
    const ok = await verifyEnrollment({ actor: owner(), run_key: "run-v" }, w.deps);
    assert.deepEqual([ok.complete, ok.consistent, ok.counts.enrolled_by_run, ok.mismatches.length], [true, true, 30, 0]);
    // Break one subject's period: verify reports it.
    Object.assign(w.subjects.periods[0]!, { ended_at: new Date(AS_OF) });
    const broken = await verifyEnrollment({ actor: owner(), run_key: "run-v" }, w.deps);
    assert.equal(broken.consistent, false);
    assert.deepEqual(broken.mismatches.map((m) => m.problem), ["no_active_period"]);
    assert.deepEqual(w.subjects.writes, subjectWrites);
    assert.deepEqual(w.store.runs.map((r) => r.run_key).sort(), ["run-v", "verify:run-v"]);
    await assert.rejects(verifyEnrollment({ actor: owner(), run_key: "nope" }, w.deps), (e: unknown) => (e as { code?: string }).code === "NOT_FOUND");
  });

  test("olr B1: run-enrolled first periods stay at the boundary; later syncs keep verify's first_period_not_at_boundary clean", async () => {
    const w = world();
    const leads = seedNew(w.subjects, 6);
    const { result } = await reportAndApply(w, "run-b1");
    assert.equal(result.counts.enrolled, 6);
    // A later Lead change on an enrolled subject (a transition) and a no-op refresh: the first period is untouched.
    w.subjects.addLead({ ...leads[0]!, ...accepted("1", "2026-10-05T13:00:00Z"), domain_revision: 2 });
    w.subjects.addLead({ ...leads[1]!, domain_revision: 2 });
    for (const lead of leads.slice(0, 2)) await refreshLeadForOutreach(lead.ref, configured(), new Date("2026-10-05T14:00:00Z"), w.subjects, fakeSession);
    for (const subject of w.subjects.subjects) {
      const [first] = await w.subjects.findPeriods(subject.id);
      assert.deepEqual([first!.start_kind, first!.started_at.toISOString(), first!.time_basis], ["activation", AS_OF, "activation_boundary"]);
    }
    assert.ok(w.subjects.periods.some((p) => p.start_kind === "transition"), "the transition happened");
    const verified = await verifyEnrollment({ actor: owner(), run_key: "run-b1" }, w.deps);
    assert.deepEqual([verified.consistent, verified.counts.enrolled_by_run, verified.mismatches.map((m) => m.problem)], [true, 6, []]);
  });

  test("candidates: 'Not enrolled — older' and the review list page newest first across both models", async () => {
    const w = world();
    for (let i = 1; i <= 30; i++) w.subjects.addLead(leadFacts({ id: id(i), model: i % 2 ? "FormLead" : "CallLead", ...receivedAt("2026-03-01T14:00:00Z") }));
    w.subjects.addLead(leadFacts({ id: idAt("2026-10-01T14:00:02Z", 99), ...receivedAt("2026-10-01T14:00:00Z") })); // in scope, not older
    w.subjects.addLead(leadFacts({ id: idAt("2026-10-01T14:00:05Z", 98), ...accepted("42", "2026-10-01T14:05:00Z") })); // review
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 10; pages++) {
      const page = await listEnrollmentCandidates({ partition: "older", cursor, limit: 7 }, w.deps);
      assert.ok(page.items.every((item) => item.partition === "older" && item.reason === "outside_backfill_scope"));
      seen.push(...page.items.map((item) => deskLeadKey(item.lead)));
      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }
    assert.equal(seen.length, 30);
    assert.equal(new Set(seen).size, 30);
    assert.equal(seen[0], `FormLead:${id(29)}`, "Form Leads first, newest first");
    const review = await listEnrollmentCandidates({ partition: "review" }, w.deps);
    assert.deepEqual(review.items.map((item) => item.reason), ["unmapped_priority"]);
    await assert.rejects(listEnrollmentCandidates({ partition: "older", cursor: "garbage" }, w.deps), (e: unknown) => (e as { code?: string }).code === "CURSOR_EXPIRED");
  });
});

/* ------------------------------------------------------------------ olr B7: scoped candidates, branch cursor */

const cursorOf = (raw: string | null) => (raw ? (JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { m: number; b?: string; a: string | null }) : null);
const rawCursor = (cursor: Record<string, unknown>) => Buffer.from(JSON.stringify(cursor)).toString("base64url");

async function allPages(w: ReturnType<typeof world>, partition: Parameters<typeof listEnrollmentCandidates>[0]["partition"], limit = 100, cursor?: string) {
  const keys: string[] = [];
  const pages: Array<Awaited<ReturnType<typeof listEnrollmentCandidates>>> = [];
  for (let n = 0; n < 50; n++) {
    const page = await listEnrollmentCandidates({ partition, cursor, limit }, w.deps);
    pages.push(page);
    keys.push(...page.items.map((item) => deskLeadKey(item.lead)));
    if (!page.next_cursor) return { keys, pages };
    cursor = page.next_cursor;
  }
  throw new Error("candidate paging did not finish");
}

/** The B7 fixture: in-window Leads (created when received), older Leads (created months ago), some with upcoming moves. */
function seedScope(subjects: MemoryDeskSubjectStore) {
  const add = (iso: string, n: number, overrides: Parameters<typeof leadFacts>[0]) =>
    subjects.addLead(leadFacts({ id: idAt(new Date(Date.parse(iso) + 2_000).toISOString(), n), ...receivedAt(iso), ...overrides }));
  const old = "2026-03-01T14:00:00Z";
  const leads = {
    recentReview: add("2026-10-01T14:00:00Z", 1, accepted("42", "2026-10-01T14:05:00Z")),
    recentCallReview: add("2026-10-02T14:00:00Z", 2, { model: "CallLead", ...accepted("42", "2026-10-02T14:05:00Z") }),
    inScopeNew: add("2026-10-03T14:00:00Z", 3, {}),
    oldUpcomingReview: add(old, 4, { ...accepted("42", "2026-03-01T14:05:00Z"), move_date: "2026-11-01" }),
    oldUpcomingQuoted: add(old, 5, { ...accepted("1", "2026-03-01T14:05:00Z"), move_date: "2026-11-02" }),
    oldReviewNoMove: add(old, 6, accepted("42", "2026-03-01T14:05:00Z")),
    oldCallUpcoming: add(old, 7, { model: "CallLead", ...accepted("42", "2026-03-01T14:05:00Z"), move_date: "2026-11-01" }),
  };
  const older: DeskLeadFacts[] = [];
  for (let i = 0; i < 40; i++) older.push(add("2026-02-01T14:00:00Z", 100 + i, i % 2 ? { model: "CallLead" } : {}));
  return { ...leads, older };
}

describe("enrollment candidates are scoped like the report (olr B7)", () => {
  test("candidates: every partition except older is limited to the backfill scope (received window or upcoming move)", async () => {
    const w = world();
    const s = seedScope(w.subjects);
    const review = await allPages(w, "review");
    assert.deepEqual(
      review.keys.sort(),
      [s.recentReview, s.recentCallReview, s.oldUpcomingReview].map((l) => deskLeadKey(l.ref)).sort(),
      "years-old review Leads outside the scope (no upcoming Form move) are not listed",
    );
    const scope = review.pages[0]!.scope as { cutoff_date: string; today: string };
    for (const item of review.pages.flatMap((p) => p.items))
      assert.ok((item.received_date !== null && item.received_date >= scope.cutoff_date) || (item.move_date !== null && item.move_date >= scope.today), deskLeadKey(item.lead));

    // The review list matches the report's review count, and in_scope is the report's frozen selection ("Ready to enroll").
    const report = await reportEnrollment({ selection: { mode: "backfill_scope" } }, w.deps);
    assert.equal(review.keys.length, report.counts.review);
    const ready = await allPages(w, "in_scope");
    assert.deepEqual(ready.keys.sort(), report.lead_refs.map(deskLeadKey).sort());
    assert.deepEqual(ready.keys.sort(), [s.inScopeNew, s.oldUpcomingQuoted].map((l) => deskLeadKey(l.ref)).sort());

    // Cost: only the window (created since the window start) and the older Form Leads with upcoming moves are examined.
    w.store.scans.length = 0;
    const page = await listEnrollmentCandidates({ partition: "review", limit: 100 }, w.deps);
    assert.equal(page.scanned, 5, "3 in-window Leads + 2 older Form Leads with an upcoming move, never the 40 older Leads");
    assert.equal(page.next_cursor, null);
    assert.deepEqual(
      w.store.scans.map((scan) => [scan.model, Boolean(scan.filter?.id_from), Boolean(scan.filter?.id_before), scan.returned]),
      [["FormLead", true, false, 2], ["FormLead", false, true, 2], ["CallLead", true, false, 1]],
    );
    for (const partition of ["already_enrolled", "closed", "excluded", "not_new_or_quoted", "in_scope"] as const)
      assert.ok(candidateLegs(partition, report.scope as Parameters<typeof candidateLegs>[1]).every((leg) => leg.filter.id_from || leg.filter.id_before), partition);
    assert.equal(candidateLegs("review", report.scope as Parameters<typeof candidateLegs>[1])[0]!.filter.id_from, objectIdFloorAt(new Date("2026-07-05T04:00:00.000Z")), "window start (NY 2026-07-06 00:00) minus one day");
  });

  test("older stays the out-of-scope list", async () => {
    const w = world();
    const s = seedScope(w.subjects);
    const older = await allPages(w, "older", 15);
    assert.deepEqual(older.keys.sort(), s.older.map((l) => deskLeadKey(l.ref)).sort());
    assert.ok(older.pages.flatMap((p) => p.items).every((item) => item.partition === "older" && item.reason === "outside_backfill_scope"));
    assert.ok(w.store.scans.every((scan) => scan.filter?.timestamp_before && !scan.filter.id_from && !scan.filter.id_before), "older keeps its prefilter and no _id bounds");
    // A Lead in the window is never "older"; an in-scope list never shows an older Lead.
    const ready = await allPages(w, "in_scope");
    assert.ok(!ready.keys.some((key) => older.keys.includes(key)));
  });

  test("a cursor continues across branches and models", async () => {
    const w = world();
    const formRecent = [1, 2, 3].map((n) => w.subjects.addLead(leadFacts({ id: idAt(`2026-10-0${n}T14:00:02Z`, n), ...receivedAt(`2026-10-0${n}T14:00:00Z`) })));
    const formUpcoming = [4, 5, 6].map((n) => w.subjects.addLead(leadFacts({ id: idAt(`2026-03-0${n}T14:00:02Z`, n), ...receivedAt(`2026-03-0${n}T14:00:00Z`), move_date: "2026-11-01" })));
    const callRecent = [7, 8, 9].map((n) => w.subjects.addLead(leadFacts({ model: "CallLead", id: idAt(`2026-09-2${n - 6}T14:00:02Z`, n), ...receivedAt(`2026-09-2${n - 6}T14:00:00Z`) })));
    const desc = (leads: readonly DeskLeadFacts[]) => [...leads].reverse();
    const expected = [...desc(formRecent), ...desc(formUpcoming), ...desc(callRecent)].map((l) => deskLeadKey(l.ref));
    const { keys, pages } = await allPages(w, "in_scope", 2);
    assert.deepEqual(keys, expected, "Form window newest first, then older Form Leads with upcoming moves, then Call Leads; no repeats, none skipped");
    const cursors = pages.map((p) => cursorOf(p.next_cursor)).filter((c) => c !== null);
    assert.deepEqual([...new Set(cursors.map((c) => `${c!.m}${c!.b}`))], ["0w", "0u", "1w"], "the cursor carries the branch");

    // A pre-B7 cursor `{m, a}` still decodes, as the window branch.
    const legacy = await listEnrollmentCandidates({ partition: "in_scope", limit: 2, cursor: rawCursor({ m: 0, a: formRecent[1]!.ref.id }) }, w.deps);
    assert.deepEqual(legacy.items.map((item) => deskLeadKey(item.lead)), [deskLeadKey(formRecent[0]!.ref), deskLeadKey(formUpcoming[2]!.ref)]);
    // Malformed cursors are CURSOR_EXPIRED; a cursor past the last leg is an empty last page.
    for (const bad of [rawCursor({ m: 0, b: "x", a: null }), rawCursor({ m: 2, b: "w", a: null }), rawCursor({ m: 0, b: "w", a: "not-an-id" })])
      await assert.rejects(listEnrollmentCandidates({ partition: "in_scope", cursor: bad }, w.deps), (e: unknown) => (e as { code?: string }).code === "CURSOR_EXPIRED");
    const past = await listEnrollmentCandidates({ partition: "in_scope", cursor: rawCursor({ m: 1, b: "u", a: null }) }, w.deps);
    assert.deepEqual([past.items.length, past.next_cursor, past.scanned], [0, null, 0]);

    // The upcoming-move branch follows the configuration: without it, a `u` cursor resumes at the Call Leads.
    const noMoves = world(fixedConfigurationLoader(configured({ include: false })));
    for (const lead of [...formRecent, ...formUpcoming, ...callRecent]) noMoves.subjects.addLead(lead);
    const resumed = await listEnrollmentCandidates({ partition: "in_scope", limit: 100, cursor: rawCursor({ m: 0, b: "u", a: formUpcoming[2]!.ref.id }) }, noMoves.deps);
    assert.deepEqual(resumed.items.map((item) => deskLeadKey(item.lead)), desc(callRecent).map((l) => deskLeadKey(l.ref)));
    const all = await allPages(noMoves, "in_scope", 100);
    assert.deepEqual(all.keys, [...desc(formRecent), ...desc(callRecent)].map((l) => deskLeadKey(l.ref)), "older Leads with upcoming moves are out of scope without the switch");
  });
});

describe("verify by cohort (olr B6: admission:<date> / intake:<gate>, read-only)", () => {
  const admissionOn = () =>
    deskConfiguration({
      transition: { backfill_lookback_days: 90, backfill_include_upcoming_moves: true, expansion_admission_enabled: true },
      migration: { paused: false },
    });

  test("verify by cohort reports mismatches without writing", async () => {
    const w = world();
    const at = new Date("2026-10-05T15:00:00.000Z");
    const leads = Array.from({ length: 105 }, (_, n) =>
      w.subjects.addLead(leadFacts({ id: id(n + 1), ...receivedAt("2026-09-25T14:00:00Z"), ...accepted(n % 2 ? "1" : "0", "2026-10-05T14:55:00Z") })),
    );
    for (const lead of leads) {
      const result = await refreshLeadForOutreach(lead.ref, admissionOn(), at, w.subjects, fakeSession, "admission");
      assert.equal(result.admission, "expansion");
    }
    const subjectWrites = [...w.subjects.writes];
    const runs = structuredClone(w.store.runs);
    const ok = await verifyCohort({ cohort_id: "admission:2026-10-05" }, w.deps);
    assert.deepEqual(
      [ok.mode, ok.cohort_id, ok.run_key, ok.run_status, ok.complete, ok.consistent, ok.counts.subjects, ok.counts.status_active, ok.mismatches],
      ["verify", "admission:2026-10-05", null, null, true, true, 105, 105, []],
      "two pages of the cohort, every first period an activation at the admission instant",
    );

    // Break three subjects: an ended period, a boundary moved off the admission instant, a late first period.
    const [a, b, c] = w.subjects.subjects;
    Object.assign(w.subjects.periods.find((p) => p.subject_id === a!.id)!, { ended_at: at });
    Object.assign(b!, { enrollment: { ...b!.enrollment, activation_at: new Date("2026-10-05T14:00:00.000Z") } });
    Object.assign(w.subjects.periods.find((p) => p.subject_id === c!.id)!, { started_at: new Date("2026-10-05T16:00:00.000Z") });
    const broken = await verifyCohort({ cohort_id: "admission:2026-10-05" }, w.deps);
    assert.equal(broken.consistent, false);
    assert.deepEqual(broken.mismatches.map((m) => [deskLeadKey(m.lead), m.problem]).sort(), [
      [deskLeadKey(a!.lead), "no_active_period"],
      [deskLeadKey(b!.lead), "boundary_mismatch"],
      [deskLeadKey(b!.lead), "first_period_not_at_boundary"],
      [deskLeadKey(c!.lead), "first_period_not_at_boundary"],
    ].sort());
    assert.deepEqual(w.subjects.writes, subjectWrites, "no subject write");
    assert.deepEqual(w.store.runs, runs, "no verify document, no run_status");

    // Closed and review subjects owe no active period.
    Object.assign(a!, { status: "closed" });
    assert.equal((await verifyCohort({ cohort_id: "admission:2026-10-05" }, w.deps)).counts.mismatch_no_active_period, undefined);
    // An unknown cohort is empty and consistent; a malformed id is refused.
    assert.deepEqual([(await verifyCohort({ cohort_id: "admission:2026-10-04" }, w.deps)).counts.subjects], [0]);
    await assert.rejects(verifyCohort({ cohort_id: "pilot:2026-10-05" }, w.deps), (e: unknown) => (e as { code?: string }).code === "INVALID_INPUT");
  });

  test("an intake cohort accepts an intake start at its boundary or a later late first period (olr B1/B8)", async () => {
    const w = world();
    const intake = deskConfiguration({ transition: { intake_admission_enabled: true, intake_admission_at: "2026-10-01T00:00:00.000Z" } });
    const fresh = w.subjects.addLead(leadFacts({ ...receivedAt("2026-10-05T14:00:00Z") }));
    const review = w.subjects.addLead(leadFacts({ ...receivedAt("2026-10-05T14:10:00Z"), ingestion_origin: "granot_lead_created", timestamp: new Date("2026-10-05T14:10:00Z") }));
    for (const lead of [fresh, review]) await refreshLeadForOutreach(lead.ref, intake, new Date("2026-10-05T14:30:00Z"), w.subjects, fakeSession);
    const cohort = "intake:2026-10-01T00:00:00.000Z";
    const first = await verifyCohort({ cohort_id: cohort }, w.deps);
    assert.deepEqual([first.consistent, first.counts.subjects, first.counts.status_active, first.counts.status_review], [true, 2, 1, 1], "a review subject with no period is not a mismatch");
    // The review subject is later decided New: a late `activation` first period after its boundary.
    w.subjects.addLead({ ...review, ...accepted("0", "2026-10-05T15:00:00Z"), domain_revision: 2 });
    await refreshLeadForOutreach(review.ref, intake, new Date("2026-10-05T15:01:00Z"), w.subjects, fakeSession);
    const later = await verifyCohort({ cohort_id: cohort }, w.deps);
    assert.deepEqual([later.consistent, later.counts.status_active], [true, 2]);
  });
});
