import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toFloridaTimestamp } from "../../../utils/easternTime";
import { fixture } from "../engine/testSupport";
import { refreshLeadForOutreach } from "./leadChangeJob";
import { toDeskLeadFacts } from "./leadFacts";
import { receivedFactsOf } from "./subjectBuilder";
import { intakeAdmissionOf, loadSubjectPageContext, syncSubject } from "./sync";
import { accepted, deskConfiguration, fakeSession, leadFacts, MemoryDeskSubjectStore, objectId } from "./testing";

const GATE = "2026-10-01T00:00:00.000Z";
const at = (iso: string) => new Date(iso);
const intakeOn = () => deskConfiguration({ transition: { intake_admission_enabled: true, intake_admission_at: GATE } });

describe("subject builder: received time, display, assignment, numbers", () => {
  test("received time comes through the restored leadInstant adapter (wall clock and Granot instant)", () => {
    const wall = receivedFactsOf({ timestamp: toFloridaTimestamp(at("2026-10-01T14:00:00Z")), created_at: at("2026-10-01T14:00:03Z"), ingestion_origin: "wordpress_form" }, at("2026-10-02T00:00:00Z"));
    assert.deepEqual({ ...wall, received_at: wall.received_at?.toISOString() }, {
      received_at: "2026-10-01T14:00:00.000Z",
      received_date: "2026-10-01",
      received_quality: "wall_clock",
      adapter_version: "lead-instant-v1",
    });
    const granot = receivedFactsOf({ timestamp: at("2026-10-01T03:30:00Z"), created_at: at("2026-10-01T03:30:01Z"), ingestion_origin: "granot_lead_created" }, at("2026-10-02T00:00:00Z"));
    assert.equal(granot.received_quality, "instant");
    assert.equal(granot.received_date, "2026-09-30", "23:30 EDT belongs to the previous New York date");
  });

  test("missing or not credible received time is review, never a guessed age (P10a missing_age_review)", () => {
    assert.equal(receivedFactsOf({ timestamp: null, created_at: null, ingestion_origin: null }, at("2026-10-02T00:00:00Z")).received_quality, "missing");
    const future = receivedFactsOf({ timestamp: at("2026-10-05T14:00:00Z"), created_at: null, ingestion_origin: "granot_lead_created" }, at("2026-10-02T00:00:00Z"));
    assert.equal(future.received_quality, "unreliable");
    assert.equal(future.received_date, null);
    assert.equal(receivedFactsOf({ timestamp: at("1999-01-01T00:00:00Z"), created_at: null, ingestion_origin: "granot_lead_created" }, at("2026-10-02T00:00:00Z")).received_quality, "unreliable");
  });

  test("Lead documents convert to facts (both models; Call Leads have no move date)", () => {
    const form = toDeskLeadFacts("FormLead", {
      _id: "f".repeat(24), timestamp: at("2026-10-01T10:00:00Z"), move_date: at("2026-10-20T00:00:00Z"), first_name: "Ada", last_name: "Lovelace",
      last_accepted_granot_observation: { observation_id: "a".repeat(24), captured_at: at("2026-10-01T14:00:00Z") }, granot_priority: "1", receiver_agent: "c".repeat(24),
    });
    assert.equal(form.move_date, "2026-10-20");
    assert.equal(form.name, "Ada Lovelace");
    assert.equal(form.accepted_observation?.observation_id, "a".repeat(24));
    assert.equal(form.receiver_agent_id, "c".repeat(24));
    const call = toDeskLeadFacts("CallLead", { _id: "e".repeat(24), move_date: at("2026-10-20T00:00:00Z"), created_on_unmatched: true });
    assert.equal(call.move_date, null);
    assert.equal(call.created_on_unmatched, true);
  });

  test("IMPL-01: assigned rep = receiver_agent only with a reviewed sales_rep link; otherwise Unassigned", async () => {
    const store = new MemoryDeskSubjectStore();
    const config = intakeOn();
    const rep = objectId();
    const other = objectId();
    store.reviewedReps.add(rep);
    const linked = store.addLead(leadFacts({ receiver_agent_id: rep }));
    const unlinked = store.addLead(leadFacts({ receiver_agent_id: other }));
    for (const lead of [linked, unlinked]) await refreshLeadForOutreach(lead.ref, config, at("2026-10-01T15:00:00Z"), store, fakeSession);
    assert.deepEqual(store.subjects.map((s) => [s.assigned_agent_id, s.assignment_revision]), [[rep, 1], [null, 0]]);
    // Reassignment in the Lead (any writer) moves the subject's assignment and its revision.
    store.addLead({ ...linked, receiver_agent_id: null, domain_revision: 2 });
    await refreshLeadForOutreach(linked.ref, config, at("2026-10-01T16:00:00Z"), store, fakeSession);
    assert.deepEqual([store.subjects[0]!.assigned_agent_id, store.subjects[0]!.assignment_revision], [null, 2]);
  });

  test("IMPL-07: the subject lists the Contact Numbers its Lead is attached to", async () => {
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(leadFacts());
    store.numbers.set(`FormLead:${lead.ref.id}`, ["n2", "n1", "n2"]);
    await refreshLeadForOutreach(lead.ref, intakeOn(), at("2026-10-01T15:00:00Z"), store, fakeSession);
    assert.deepEqual(store.subjects[0]!.contact_number_ids, ["n1", "n2"]);
  });
});

describe("P05g move-date review (fixture p05g-move-date-review.json, S1 parts)", () => {
  const fx = fixture<{ cases: Array<{ id: string; age_reset?: boolean; contact_history_erased?: boolean }>; closure_authority_changed: boolean }>("p05g-move-date-review.json");

  test("the canonical move date is shown as recorded; unknown is null (the engine labels both)", async () => {
    const store = new MemoryDeskSubjectStore();
    const config = intakeOn();
    const passed = store.addLead(leadFacts({ move_date: "2026-09-30", ...accepted("0", "2026-10-01T14:01:00Z") }));
    const unknown = store.addLead(leadFacts({ model: "CallLead" }));
    for (const lead of [passed, unknown]) await refreshLeadForOutreach(lead.ref, config, at("2026-10-01T15:00:00Z"), store, fakeSession);
    assert.deepEqual(store.subjects.map((s) => s.display.move_date), ["2026-09-30", null]);
    assert.deepEqual(store.subjects.map((s) => s.status), ["active", "active"], "a passed or unknown move date closes nothing");
    assert.equal(fx.closure_authority_changed, false);
  });

  test("corrected_date: correcting the move date neither resets age nor opens a period", async () => {
    const c = fx.cases.find((x) => x.id === "corrected_date")!;
    const store = new MemoryDeskSubjectStore();
    const config = intakeOn();
    const lead = store.addLead(leadFacts({ move_date: "2026-09-30" }));
    await refreshLeadForOutreach(lead.ref, config, at("2026-10-01T15:00:00Z"), store, fakeSession);
    const before = structuredClone(store.subjects[0]!);
    store.addLead({ ...lead, move_date: "2026-11-15", domain_revision: 2 });
    await refreshLeadForOutreach(lead.ref, config, at("2026-10-03T15:00:00Z"), store, fakeSession);
    const after = store.subjects[0]!;
    assert.equal(after.display.move_date, "2026-11-15");
    assert.equal(+after.received_at!, +before.received_at!, "age not reset");
    assert.equal(store.periods.length, 1, "no new period");
    assert.equal(c.age_reset, false);
    assert.equal(c.contact_history_erased, false);
  });
});

describe("subject sync: idempotence, CAS, evaluation nominations", () => {
  test("identical Lead facts write nothing (no revision bump to touch the row)", async () => {
    const store = new MemoryDeskSubjectStore();
    const config = intakeOn();
    const lead = store.addLead(leadFacts());
    await refreshLeadForOutreach(lead.ref, config, at("2026-10-01T15:00:00Z"), store, fakeSession);
    const writes = store.writes.length;
    const result = await refreshLeadForOutreach(lead.ref, config, at("2026-10-01T15:05:00Z"), store, fakeSession);
    assert.equal(result.outcome, "unchanged");
    assert.equal(store.writes.length, writes);
  });

  test("a Lead revision with no desk-relevant change records the revision without waking the evaluator", async () => {
    const store = new MemoryDeskSubjectStore();
    const config = intakeOn();
    const lead = store.addLead(leadFacts());
    await refreshLeadForOutreach(lead.ref, config, at("2026-10-01T15:00:00Z"), store, fakeSession);
    store.addLead({ ...lead, domain_revision: 7 });
    await refreshLeadForOutreach(lead.ref, config, at("2026-10-01T15:05:00Z"), store, fakeSession);
    assert.equal(store.subjects[0]!.lead_revision_seen, 7);
    assert.deepEqual(store.evaluations.map((e) => e.revision), [1]);
  });

  test("every new subject revision with a desk-relevant change nominates outreach_evaluate", async () => {
    const store = new MemoryDeskSubjectStore();
    const config = intakeOn();
    const lead = store.addLead(leadFacts());
    await refreshLeadForOutreach(lead.ref, config, at("2026-10-01T15:00:00Z"), store, fakeSession);
    store.addLead({ ...lead, ...accepted("1", "2026-10-02T14:00:00Z"), domain_revision: 2 });
    await refreshLeadForOutreach(lead.ref, config, at("2026-10-02T15:00:00Z"), store, fakeSession);
    assert.deepEqual(store.evaluations.map((e) => e.revision), [1, 2]);
  });

  test("a concurrent writer (stale subject revision) aborts the transaction with REVISION_CONFLICT", async () => {
    const store = new MemoryDeskSubjectStore();
    const config = intakeOn();
    const lead = store.addLead(leadFacts());
    await refreshLeadForOutreach(lead.ref, config, at("2026-10-01T15:00:00Z"), store, fakeSession);
    const [stale] = await store.findSubjects([lead.ref]);
    store.subjects[0] = { ...store.subjects[0]!, revision: 2 };
    store.addLead({ ...lead, ...accepted("1", "2026-10-02T14:00:00Z"), domain_revision: 2 });
    const [facts] = await store.loadLeads([lead.ref]);
    const context = await loadSubjectPageContext(store, [facts!], at("2026-10-02T15:00:00Z"), fakeSession);
    await assert.rejects(syncSubject({ facts: facts!, subject: stale!, configuration: config, context }, store, fakeSession), (e: unknown) => (e as { code?: string }).code === "REVISION_CONFLICT");
  });

  test("a new subject requires an enrollment boundary", async () => {
    const store = new MemoryDeskSubjectStore();
    const facts = leadFacts();
    const context = await loadSubjectPageContext(store, [facts], at("2026-10-01T15:00:00Z"), fakeSession);
    await assert.rejects(syncSubject({ facts, subject: null, configuration: intakeOn(), context }, store, fakeSession));
  });
});

describe("intake admission gate (outreach_intake; P05e, P10b automatic intake scope)", () => {
  const fx = fixture<{ automatic_intake_scope: string; historical_records_treated_as_fresh: boolean; unselected_existing_auto_enrolled: boolean }>("p10b-manual-start.json");
  const config = intakeOn();
  const asOf = at("2026-10-01T15:00:00Z");

  test("fresh eligible intake after the audited boundary is admitted once as kind intake", async () => {
    assert.equal(fx.automatic_intake_scope, "prospective_eligible_received_intake_after_audited_boundary");
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(leadFacts());
    const first = await refreshLeadForOutreach(lead.ref, config, asOf, store, fakeSession);
    const again = await refreshLeadForOutreach(lead.ref, config, asOf, store, fakeSession);
    assert.equal(first.outcome, "created");
    assert.equal(again.outcome, "unchanged");
    assert.equal(store.subjects.length, 1);
    const subject = store.subjects[0]!;
    assert.equal(subject.enrollment.kind, "intake");
    assert.equal(subject.enrollment.cohort_id, `intake:${GATE}`);
    assert.equal(+subject.enrollment.activation_at, +subject.received_at!, "fresh intake starts at arrival");
    assert.equal(store.periods[0]!.start_kind, "intake");
  });

  test("the gate off, a Lead created before the gate, or received before it is not intake", () => {
    const off = deskConfiguration();
    assert.deepEqual(intakeAdmissionOf(leadFacts(), off, asOf), { admit: false, reason: "intake_disabled" });
    assert.deepEqual(intakeAdmissionOf(leadFacts({ created_at: at("2026-09-30T23:00:00Z") }), config, asOf), { admit: false, reason: "created_before_intake" });
    // Late-created historical record: created after the gate, received long before it.
    const late = leadFacts({ timestamp: toFloridaTimestamp(at("2026-06-01T14:00:00Z")), created_at: at("2026-10-01T14:00:00Z"), ingestion_origin: "best_relocation_sheet" });
    assert.deepEqual(intakeAdmissionOf(late, config, asOf), { admit: false, reason: "received_before_intake" });
    assert.deepEqual(intakeAdmissionOf(leadFacts({ model: "CallLead", ingestion_origin: "legacy_import" }), config, asOf), { admit: false, reason: "historical_import" });
    assert.equal(fx.historical_records_treated_as_fresh, false);
  });

  test("ineligible, closed, unverifiable or ambiguous Leads are not admitted", async () => {
    assert.equal(intakeAdmissionOf(leadFacts({ duplicate: true }), config, asOf).admit, false);
    assert.equal(intakeAdmissionOf(leadFacts({ booked_id: "b" }), config, asOf).admit, false);
    assert.deepEqual(intakeAdmissionOf(leadFacts({ ...accepted("5", "2026-10-01T14:00:00Z") }), config, asOf), { admit: false, reason: "closed_priority" });
    assert.deepEqual(intakeAdmissionOf(leadFacts({ timestamp: null }), config, asOf), { admit: false, reason: "received_time_unreliable" });
    const store = new MemoryDeskSubjectStore();
    const a = store.addLead(leadFacts({ normalized_job_no: "J-1" }));
    store.addLead(leadFacts({ model: "CallLead", normalized_job_no: "J-1" }));
    assert.deepEqual(await refreshLeadForOutreach(a.ref, config, asOf, store, fakeSession), { outcome: "not_admitted", subject_id: null, reason: "ambiguous_identity" });
  });

  test("an existing Lead that is not a subject is never auto-enrolled by a later change", async () => {
    assert.equal(fx.unselected_existing_auto_enrolled, false);
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(leadFacts({ created_at: at("2026-09-01T14:00:00Z"), timestamp: toFloridaTimestamp(at("2026-09-01T14:00:00Z")) }));
    const result = await refreshLeadForOutreach(lead.ref, config, asOf, store, fakeSession);
    assert.equal(result.outcome, "not_admitted");
    assert.equal(store.subjects.length, 0);
  });
});
