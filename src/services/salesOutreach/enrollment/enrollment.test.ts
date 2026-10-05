import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toFloridaTimestamp } from "../../../utils/easternTime";
import { csiOperatorActor } from "../../salesIntelligence/auth";
import type { ConfigurationLoader } from "../config/load";
import { evaluateSubject } from "../engine";
import { fixture, policyWith } from "../engine/testSupport";
import { fixedConfigurationLoader } from "../reads/testing";
import { deskLeadKey, type DeskLeadFacts } from "../subjects/leadFacts";
import { accepted, deskConfiguration, leadFacts, MemoryDeskSubjectStore, objectId } from "../subjects/testing";
import { enrollmentManifestHash } from "./classify";
import { applyEnrollment, listEnrollmentCandidates, reportEnrollment, verifyEnrollment } from "./service";
import { memoryEnrollmentDeps, MemoryEnrollmentStore } from "./testing";

const AS_OF = "2026-10-05T12:00:00.000Z"; // 08:00 New York, the preferred P10b activation minute
const owner = () => csiOperatorActor("sod-enrollment-test");
/** A Lead received at a real instant (stored as the live ET wall clock). */
const receivedAt = (iso: string) => ({ timestamp: toFloridaTimestamp(new Date(iso)), created_at: new Date(Date.parse(iso) + 2_000) });
const id = (n: number) => n.toString(16).padStart(24, "0");

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

  test("candidates: 'Not enrolled — older' and the review list page newest first across both models", async () => {
    const w = world();
    for (let i = 1; i <= 30; i++) w.subjects.addLead(leadFacts({ id: id(i), model: i % 2 ? "FormLead" : "CallLead", ...receivedAt("2026-03-01T14:00:00Z") }));
    w.subjects.addLead(leadFacts({ id: id(99), ...receivedAt("2026-10-01T14:00:00Z") })); // in scope, not older
    w.subjects.addLead(leadFacts({ id: id(98), ...accepted("42", "2026-10-01T14:05:00Z") })); // review
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
