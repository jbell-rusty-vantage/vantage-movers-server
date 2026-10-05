import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toFloridaTimestamp } from "../../../utils/easternTime";
import { csiOperatorActor } from "../../salesIntelligence/auth";
import { applyEnrollment, reportEnrollment } from "../enrollment/service";
import { memoryEnrollmentDeps, MemoryEnrollmentStore } from "../enrollment/testing";
import { fixedConfigurationLoader } from "../reads/testing";
import { refreshLeadForOutreach } from "./leadChangeJob";
import { accepted, deskConfiguration, fakeSession, leadFacts, MemoryDeskSubjectStore, objectId } from "./testing";

/** END-TO-END-RUN.md §3 rows (S1 subject/eligibility parts) and §4 seeding/intake rows, as named tests. */
const at = (iso: string) => new Date(iso);
const config = () =>
  deskConfiguration({
    transition: { intake_admission_enabled: true, intake_admission_at: "2026-10-01T00:00:00.000Z", backfill_lookback_days: 90, backfill_include_upcoming_moves: true },
    migration: { paused: false },
  });
const refresh = (store: MemoryDeskSubjectStore, ref: { model: "FormLead" | "CallLead"; id: string }, iso: string) =>
  refreshLeadForOutreach(ref, config(), at(iso), store, fakeSession);

describe("END-TO-END-RUN §3 (S1 rows)", () => {
  test("Blank/malformed priority update and valid change: retain the verified policy with uncertainty; an accepted change supersedes routine work once", async () => {
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(leadFacts({ ...accepted("0", "2026-10-02T14:01:00Z"), ...{ timestamp: toFloridaTimestamp(at("2026-10-02T14:00:00Z")), created_at: at("2026-10-02T14:00:02Z") } }));
    await refresh(store, lead.ref, "2026-10-02T15:00:00Z");
    store.uncertain.add(`FormLead:${lead.ref.id}`); // a blank update was observed, not accepted
    store.addLead({ ...lead, domain_revision: 2 });
    await refresh(store, lead.ref, "2026-10-03T15:00:00Z");
    assert.deepEqual([store.periods.length, store.subjects[0]!.priority.uncertain], [1, true]);
    store.uncertain.clear();
    const valid = { ...lead, ...accepted("1", "2026-10-04T14:00:00Z"), domain_revision: 3 };
    store.addLead(valid);
    await refresh(store, lead.ref, "2026-10-04T15:00:00Z");
    store.addLead({ ...valid, domain_revision: 4 });
    await refresh(store, lead.ref, "2026-10-04T16:00:00Z");
    assert.deepEqual(store.periods.map((p) => [p.workflow, p.ended_at === null]), [["new", false], ["quoted", true]], "superseded once");
    assert.equal(store.subjects[0]!.priority.uncertain, false);
  });

  test("Passed/unknown move date; viable No-Sync: cadence continues with labels; no silent legacy reopening", async () => {
    const store = new MemoryDeskSubjectStore();
    const passed = store.addLead(leadFacts({ move_date: "2026-09-01", no_sync: true }));
    const unknown = store.addLead(leadFacts({ model: "CallLead", no_sync: true }));
    for (const lead of [passed, unknown]) await refresh(store, lead.ref, "2026-10-01T15:00:00Z");
    assert.deepEqual(store.subjects.map((s) => [s.status, s.display.move_date]), [["active", "2026-09-01"], ["active", null]]);
    assert.deepEqual(store.periods.map((p) => p.workflow), ["new", "new"]);
  });

  test("Duplicate/Form Fill/unmatched/shared phone: approved eligibility, no phone merge or guessed cadence", async () => {
    const store = new MemoryDeskSubjectStore();
    const leads = [
      store.addLead(leadFacts({ duplicate: true })),
      store.addLead(leadFacts({ model: "CallLead", form_fill: true, normalized_phone: "5550109999" })),
      store.addLead(leadFacts({ model: "CallLead", created_on_unmatched: true })),
      store.addLead(leadFacts({ normalized_phone: "5550109999" })),
    ];
    const outcomes = [];
    for (const lead of leads) outcomes.push((await refresh(store, lead.ref, "2026-10-01T15:00:00Z")).outcome);
    assert.deepEqual(outcomes, ["not_admitted", "created", "not_admitted", "created"]);
    assert.equal(store.subjects.length, 2, "the shared phone keeps two separate subjects");
  });

  test("Unassigned/late assignment/reassignment (subject part): assignment follows receiver_agent with a reviewed link; age and periods stay", async () => {
    const store = new MemoryDeskSubjectStore();
    const repA = objectId();
    const repB = objectId();
    store.reviewedReps.add(repA).add(repB);
    const lead = store.addLead(leadFacts());
    await refresh(store, lead.ref, "2026-10-01T15:00:00Z");
    const received = store.subjects[0]!.received_at;
    for (const [rev, agent] of [[2, repA], [3, repB]] as const) {
      store.addLead({ ...lead, receiver_agent_id: agent, domain_revision: rev });
      await refresh(store, lead.ref, "2026-10-02T15:00:00Z");
    }
    assert.deepEqual([store.subjects[0]!.assigned_agent_id, store.subjects[0]!.assignment_revision], [repB, 2]);
    assert.equal(+store.subjects[0]!.received_at!, +received!);
    assert.equal(store.periods.length, 1, "assignment never restarts or extends the timeline");
  });
});

describe("END-TO-END-RUN §4 (seeding and prospective intake)", () => {
  test("report/preview with zero writes; apply bounded reviewed scope; reapply the same manifest without duplication", async () => {
    const subjects = new MemoryDeskSubjectStore();
    const store = new MemoryEnrollmentStore(subjects);
    const { deps, setClock } = memoryEnrollmentDeps(subjects, store, { loader: fixedConfigurationLoader(config()) });
    setClock("2026-10-05T12:00:00.000Z");
    const pilot = Array.from({ length: 20 }, (_, i) =>
      subjects.addLead(leadFacts({ timestamp: toFloridaTimestamp(at("2026-09-28T14:00:00Z")), created_at: at("2026-09-28T14:00:02Z"), ...accepted(i % 3 ? "0" : "1", "2026-09-28T14:05:00Z") })),
    );
    const report = await reportEnrollment({ selection: { mode: "selected", lead_refs: pilot.map((l) => l.ref) }, kind: "pilot" }, deps);
    assert.deepEqual([report.lead_refs.length, subjects.writes.length, store.writes.length], [20, 0, 0]);
    const body = { actor: csiOperatorActor("e2e"), run_key: "pilot-1", kind: "pilot" as const, cohort_id: report.cohort_id, lead_refs: report.lead_refs, manifest_hash: report.manifest_hash };
    const first = await applyEnrollment(body, deps);
    const writes = subjects.writes.length;
    const again = await applyEnrollment(body, deps);
    assert.deepEqual([first.counts.enrolled, again.status, subjects.writes.length], [20, "completed", writes]);
    assert.equal(again.activation_at, first.activation_at);
  });

  test("prospective intake enrolls new eligible intake once; existing unselected and late-created historical records are not fresh", async () => {
    const store = new MemoryDeskSubjectStore();
    const fresh = store.addLead(leadFacts());
    const existing = store.addLead(leadFacts({ created_at: at("2026-09-20T14:00:00Z"), timestamp: toFloridaTimestamp(at("2026-09-20T14:00:00Z")) }));
    const lateHistorical = store.addLead(leadFacts({ created_at: at("2026-10-02T14:00:00Z"), timestamp: toFloridaTimestamp(at("2026-05-01T14:00:00Z")), ingestion_origin: "best_relocation_sheet" }));
    for (let i = 0; i < 2; i++) for (const lead of [fresh, existing, lateHistorical]) await refresh(store, lead.ref, "2026-10-02T15:00:00Z");
    assert.deepEqual(store.subjects.map((s) => s.lead.id), [fresh.ref.id]);
    assert.equal(store.subjects[0]!.enrollment.kind, "intake");
  });
});
