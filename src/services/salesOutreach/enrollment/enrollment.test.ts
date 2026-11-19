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
import { applyEnrollment, reportEnrollment, verifyCohort, verifyEnrollment } from "./service";
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
});

/* ------------------------------------------------------------------ olr B7: scoped candidates, branch cursor */

describe("verify by cohort (olr B6: admission:<date> / intake:<gate>, read-only)", () => {

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
