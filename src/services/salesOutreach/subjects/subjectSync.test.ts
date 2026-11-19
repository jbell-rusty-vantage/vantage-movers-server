import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toFloridaTimestamp } from "../../../utils/easternTime";
import { fixture } from "../engine/testSupport";
import type { ActiveConfiguration } from "../config/load";
import { refreshLeadForOutreach } from "./leadChangeJob";
import {
  expansionAdmissionOf,
  intakeAdmissionOf,
  loadSubjectPageContext,
  syncSubject,
} from "./sync";
import { accepted, APPROVED_MAPPING, deskConfiguration, fakeSession, leadFacts, MemoryDeskSubjectStore, objectId } from "./testing";

const GATE = "2026-10-01T00:00:00.000Z";
const at = (iso: string) => new Date(iso);
const intakeOn = () => deskConfiguration({ transition: { intake_admission_enabled: true, intake_admission_at: GATE } });

describe("subject builder: received time, display, assignment, numbers", () => {

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
});

describe("P05g move-date review (fixture p05g-move-date-review.json, S1 parts)", () => {
  const fx = fixture<{ cases: Array<{ id: string; age_reset?: boolean; contact_history_erased?: boolean }>; closure_authority_changed: boolean }>("p05g-move-date-review.json");

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
});

describe("intake admission gate (outreach_intake; P05e, P10b automatic intake scope)", () => {
  const fx = fixture<{ automatic_intake_scope: string; historical_records_treated_as_fresh: boolean; unselected_existing_auto_enrolled: boolean }>("p10b-manual-start.json");
  const config = intakeOn();
  const asOf = at("2026-10-01T15:00:00Z");

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
});

describe("olr B6: event-driven expansion admission (transition.expansion_admission_enabled)", () => {
  const asOf = at("2026-10-06T15:00:00Z");
  const scope = { backfill_lookback_days: 90, backfill_include_upcoming_moves: true };
  const admissionOn = (extra: Record<string, unknown> = {}) =>
    deskConfiguration({ transition: { intake_admission_enabled: true, intake_admission_at: GATE, ...scope, expansion_admission_enabled: true, ...extra }, migration: { paused: false } });
  /** A pre-gate Lead received 2026-09-01 (inside the 90-day window), its accepted priority now New. */
  const preGate = (overrides: Parameters<typeof leadFacts>[0] = {}) =>
    leadFacts({ created_at: at("2026-09-01T14:00:05Z"), timestamp: toFloridaTimestamp(at("2026-09-01T14:00:00Z")), ...accepted("0", "2026-10-06T14:58:00Z"), ...overrides });

  test("a pre-gate in-scope Lead that becomes New is admitted as expansion at now (activation, partial day, cohort admission:<date>)", async () => {
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(preGate());
    const result = await refreshLeadForOutreach(lead.ref, admissionOn(), asOf, store, fakeSession, "admission");
    assert.deepEqual(result, { outcome: "created", subject_id: store.subjects[0]!.id, reason: null, status: "active", admission: "expansion", evaluation_requested: true });
    const subject = store.subjects[0]!;
    assert.deepEqual(subject.enrollment, { cohort_id: "admission:2026-10-06", kind: "expansion", enrolled_at: asOf, activation_at: asOf, manifest_hash: null });
    assert.equal(store.periods.length, 1);
    const period = store.periods[0]!;
    assert.deepEqual([period.start_kind, +period.started_at, period.time_basis, period.workflow], ["activation", +asOf, "activation_boundary", "new"], "starts now, never at the received time");
    assert.notEqual(+period.started_at, +subject.received_at!);
    // A replay (same Lead, now a subject) refreshes it and creates nothing.
    const again = await refreshLeadForOutreach(lead.ref, admissionOn(), asOf, store, fakeSession, "admission");
    assert.equal(again.outcome, "unchanged");
    assert.equal(store.subjects.length, 1);
  });

  test("a paused migration refuses (re-checked in the job transaction)", async () => {
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(preGate());
    const paused = deskConfiguration({
      transition: { intake_admission_enabled: true, intake_admission_at: GATE, ...scope, expansion_admission_enabled: true },
      migration: { paused: true },
    });
    const result = await refreshLeadForOutreach(lead.ref, paused, asOf, store, fakeSession, "admission");
    assert.equal(result.reason, "expansion:migration_paused");
    assert.equal(store.subjects.length, 0);
  });

  test("a post-gate Lead whose creation job is not settled defers to intake; once settled, a later eligible change admits as expansion (never intake at received)", async () => {
    const store = new MemoryDeskSubjectStore();
    // Created after the gate, refused at creation (closed priority 7), later accepted New.
    const lead = store.addLead(leadFacts({ created_at: at("2026-10-05T14:00:05Z"), timestamp: toFloridaTimestamp(at("2026-10-05T14:00:00Z")), ...accepted("0", "2026-10-06T14:58:00Z") }));
    store.creationJobs.set(`${lead.ref.model}:${lead.ref.id}`, "pending");
    const deferred = await refreshLeadForOutreach(lead.ref, admissionOn(), asOf, store, fakeSession, "admission");
    assert.deepEqual(deferred, { outcome: "deferred", subject_id: null, reason: "deferred_to_intake", status: null, admission: null, evaluation_requested: false });
    assert.deepEqual(store.writes, []);
    store.creationJobs.set(`${lead.ref.model}:${lead.ref.id}`, "completed");
    const admitted = await refreshLeadForOutreach(lead.ref, admissionOn(), asOf, store, fakeSession, "admission");
    assert.equal(admitted.admission, "expansion");
    const subject = store.subjects[0]!;
    assert.equal(subject.enrollment.kind, "expansion");
    assert.equal(+subject.enrollment.activation_at, +asOf, "the boundary is the admission instant, not the received time");
    assert.equal(store.periods[0]!.start_kind, "activation");
  });
});

describe("olr B8: intake admission hold (ambiguous identity, missing/unreliable received time)", () => {
  const config = intakeOn();
  const asOf = at("2026-10-01T15:00:00Z");

  test("an ambiguous fresh Lead is admitted as a review subject with no period; when the other Lead is marked duplicate the first period opens at the clearing sync (activation, desk_decision_at)", async () => {
    const store = new MemoryDeskSubjectStore();
    const a = store.addLead(leadFacts({ normalized_job_no: "J-1" }));
    const b = store.addLead(leadFacts({ model: "CallLead", normalized_job_no: "J-1" }));
    const admitted = await refreshLeadForOutreach(a.ref, config, asOf, store, fakeSession);
    assert.deepEqual(admitted, { outcome: "created", subject_id: store.subjects[0]!.id, reason: null, status: "review", admission: "intake", evaluation_requested: true }, "admitted held, never refused");
    const held = store.subjects[0]!;
    assert.deepEqual([held.status, held.review_reasons], ["review", ["ambiguous_identity"]]);
    assert.equal(held.enrollment.kind, "intake");
    assert.equal(+held.enrollment.activation_at, +held.received_at!, "a reliable received time keeps the arrival boundary");
    assert.equal(store.periods.length, 0, "no period while held: nothing is owed");
    // Still ambiguous: the re-check writes nothing.
    const writes = store.writes.length;
    assert.equal((await refreshLeadForOutreach(a.ref, config, at("2026-10-01T15:15:00Z"), store, fakeSession)).outcome, "unchanged");
    assert.equal(store.writes.length, writes);
    // The Owner marks the other Lead a Duplicate in Granot: the 15-min hold re-check clears the hold.
    store.addLead({ ...b, duplicate: true, domain_revision: 2 });
    const cleared = at("2026-10-01T16:30:00Z");
    const result = await refreshLeadForOutreach(a.ref, config, cleared, store, fakeSession);
    assert.deepEqual([result.outcome, result.status], ["updated", "active"]);
    assert.deepEqual([store.subjects[0]!.status, store.subjects[0]!.review_reasons], ["active", []]);
    assert.deepEqual(
      store.periods.map((p) => [p.workflow, p.start_kind, p.started_at.toISOString(), p.time_basis]),
      [["new", "activation", cleared.toISOString(), "desk_decision_at"]],
      "late first period at the clearing sync: no retroactive day, no initial-response clock",
    );
  });

  test("a held subject that is booked closes (the closure is not held)", async () => {
    const store = new MemoryDeskSubjectStore();
    const a = store.addLead(leadFacts({ normalized_job_no: "J-3" }));
    store.addLead(leadFacts({ model: "CallLead", normalized_job_no: "J-3" }));
    await refreshLeadForOutreach(a.ref, config, asOf, store, fakeSession);
    assert.equal(store.subjects[0]!.status, "review");
    store.addLead({ ...a, booked_id: "b-1", domain_revision: 2, last_changed_at: at("2026-10-01T17:00:00Z") });
    await refreshLeadForOutreach(a.ref, config, at("2026-10-01T17:05:00Z"), store, fakeSession);
    assert.equal(store.subjects[0]!.status, "closed");
    assert.deepEqual(store.periods.map((p) => [p.workflow, p.start_kind]), [["closed", "activation"]]);
  });
});

describe("olr C4: re-derive wakes when a subject or its period changes after the contact", () => {
  const deskOn = (controls: { desk_enabled?: boolean; goal_metrics_enabled?: boolean } = { desk_enabled: true }) =>
    deskConfiguration({ controls, transition: { intake_admission_enabled: true, intake_admission_at: GATE } });
  // leadFacts(): received 2026-10-01 10:00 ET = 14:00Z; intake activates at arrival. The wake covers the
  // activation's New York date, from midnight ET (04:00Z under EDT): earlier same-date contact carries the
  // subject for the P05f/P10a subtraction.

  function seeded() {
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(leadFacts());
    const other = leadFacts();
    // n1 credits the Lead; n-shared only lists it in `other_leads` (a subject number, never credit);
    // n-other credits another Lead.
    store.creditedNumbers.set(`FormLead:${lead.ref.id}`, [{ id: "n1", e164: "+15550100001" }]);
    store.creditedNumbers.set(`FormLead:${other.ref.id}`, [{ id: "n-other", e164: "+15550100009" }]);
    store.numbers.set(`FormLead:${lead.ref.id}`, ["n-shared", "n1"]);
    const call = (id: string, number: string, iso: string, merged: string | null = null) =>
      store.calls.push({ id, contact_number_id: number, started_at: at(iso), merged_into_id: merged });
    call("c-prev-day", "n1", "2026-09-30T23:00:00Z"); // 19:00 ET the day before: not the activation date
    call("c-prev-late", "n1", "2026-10-01T03:59:00Z"); // 23:59 ET the day before (UTC already 10-01)
    call("c-before", "n1", "2026-10-01T13:59:00Z"); // before the Lead was received, same New York date
    call("c-arrival", "n1", "2026-10-01T14:00:00Z");
    call("c-gap", "n1", "2026-10-01T14:30:00Z"); // derived `none` before the admission committed
    call("c-merged", "n1", "2026-10-01T14:40:00Z", "c-gap");
    call("c-shared", "n-shared", "2026-10-01T14:35:00Z");
    call("c-other", "n-other", "2026-10-01T14:36:00Z");
    store.sms.push({ id: "m-gap", counterpart_numbers: ["+15550100001"], provider_created_at: at("2026-10-01T14:10:00Z") });
    store.sms.push({ id: "m-before", counterpart_numbers: ["+15550100001"], provider_created_at: at("2026-10-01T13:00:00Z") });
    store.sms.push({ id: "m-prev-day", counterpart_numbers: ["+15550100001"], provider_created_at: at("2026-09-30T20:00:00Z") });
    // Scheduled the day before, sent on the activation date: its event time is `send_at`.
    store.sms.push({ id: "m-scheduled", counterpart_numbers: ["+15550100001"], provider_created_at: at("2026-09-30T20:00:00Z"), send_at: at("2026-10-01T14:05:00Z") });
    store.sms.push({ id: "m-other", counterpart_numbers: ["+15550100009"], provider_created_at: at("2026-10-01T14:20:00Z") });
    return { store, lead };
  }
  const nominated = (store: MemoryDeskSubjectStore) => [...store.contactJobs.keys()].sort();

  test("a replay nominates nothing new (unchanged sync, and the same dedupe keys)", async () => {
    const { store, lead } = seeded();
    await refreshLeadForOutreach(lead.ref, deskOn(), at("2026-10-01T15:00:00Z"), store, fakeSession);
    const first = nominated(store);
    const replay = await refreshLeadForOutreach(lead.ref, deskOn(), at("2026-10-01T15:05:00Z"), store, fakeSession);
    assert.equal(replay.outcome, "unchanged");
    assert.equal(store.contactWakes.length, 1, "an unchanged subject asks for no wake");
    // A repeated request for the same change maps to the same job identities.
    await store.nominateContactSources(store.contactWakes[0]!);
    assert.deepEqual(nominated(store), first);
  });
});

// ---- olr B2: decision fingerprint and configuration-driven re-decisions ----------------------

describe("olr B2: decision fingerprint (priority map + intake defaults) and prospective re-decisions", () => {
  const MAP = APPROVED_MAPPING!.priority_map!;
  /** The approved map with code 9 mapped (the B4 shape); `none` = the FINAL-01 map (9 unmapped → none). */
  const mapWith9 = (workflow: "quoted" | "none") =>
    workflow === "none" ? MAP : { ...MAP, codes: [...MAP.codes, { code: "9", workflow, closure_reason: null }] };
  /** An active configuration at `revision` whose pointer moved at `updatedAt`. */
  const configAt = (revision: number, updatedAt: string, cadence: NonNullable<Parameters<typeof deskConfiguration>[0]>["cadence"] = {}): ActiveConfiguration => ({
    ...deskConfiguration({ transition: { intake_admission_enabled: true, intake_admission_at: GATE }, cadence }, `v${revision}`, revision),
    updated_at: at(updatedAt),
  });

  test("a configuration-driven transition starts at the configuration time, never at the older observation time; an A→B→A flip re-decides each time", async () => {
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(leadFacts(accepted("9", "2026-10-01T14:01:00Z", "9".repeat(24))));
    // FINAL-01: 9 is unmapped → `none` ("No policy configured").
    await refreshLeadForOutreach(lead.ref, configAt(3, "2026-10-01T00:00:00Z"), at("2026-10-01T15:00:00Z"), store, fakeSession);
    assert.deepEqual(store.periods.map((p) => p.workflow), ["none"]);
    // The Owner maps 9 → quoted at 2026-10-02T15:00Z (revision 4); the reconcile's job runs 3 minutes later.
    await refreshLeadForOutreach(lead.ref, configAt(4, "2026-10-02T15:00:00Z", { priority_map: mapWith9("quoted") }), at("2026-10-02T15:03:00Z"), store, fakeSession);
    const quoted = store.periods.at(-1)!;
    assert.deepEqual(
      [quoted.workflow, quoted.start_kind, quoted.started_at.toISOString(), quoted.time_basis, quoted.transition_key],
      ["quoted", "transition", "2026-10-02T15:00:00.000Z", "configuration_activated_at", `priority:observation:${"9".repeat(24)}:quoted:9:c4`],
    );
    assert.equal(store.periods[0]!.ended_at!.toISOString(), "2026-10-02T15:00:00.000Z", "the none period ends at the configuration time");
    assert.equal(store.evaluations.length, 2, "a real re-decision wakes the evaluator");
    // Rollback PATCH (revision 5): 9 unmapped again → none from that PATCH, not a replay of the first period's key.
    await refreshLeadForOutreach(lead.ref, configAt(5, "2026-10-03T16:00:00Z"), at("2026-10-03T16:02:00Z"), store, fakeSession);
    // And mapped again (revision 6).
    await refreshLeadForOutreach(lead.ref, configAt(6, "2026-10-04T17:00:00Z", { priority_map: mapWith9("quoted") }), at("2026-10-04T17:01:00Z"), store, fakeSession);
    assert.deepEqual(
      store.periods.map((p) => [p.workflow, p.started_at.toISOString(), p.ended_at?.toISOString() ?? null]),
      [
        ["none", "2026-10-01T14:00:00.000Z", "2026-10-02T15:00:00.000Z"],
        ["quoted", "2026-10-02T15:00:00.000Z", "2026-10-03T16:00:00.000Z"],
        ["none", "2026-10-03T16:00:00.000Z", "2026-10-04T17:00:00.000Z"],
        ["quoted", "2026-10-04T17:00:00.000Z", null],
      ],
    );
    assert.deepEqual(store.periods.slice(1).map((p) => p.transition_key.split(":").at(-1)), ["c4", "c5", "c6"]);
    // A replay under the same revision (the job ran twice) writes nothing.
    const writes = store.writes.length;
    const replay = await refreshLeadForOutreach(lead.ref, configAt(6, "2026-10-04T17:00:00Z", { priority_map: mapWith9("quoted") }), at("2026-10-04T17:05:00Z"), store, fakeSession);
    assert.equal(replay.outcome, "unchanged");
    assert.equal(store.writes.length, writes);
  });
});

describe("olr C2c: cadence.no_contact_number_rule (D-C2c; off unless the Owner sets it)", () => {
  const ruleOn = () => deskConfiguration({ transition: { intake_admission_enabled: true, intake_admission_at: GATE }, cadence: { no_contact_number_rule: "review_no_cadence" } });
  const noPhone = { phone: null, normalized_phone: null };

  test("rule on, no linked number and no phone: review no_contact_number, the period still opens (no cadence while in review)", async () => {
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(leadFacts(noPhone));
    await refreshLeadForOutreach(lead.ref, ruleOn(), at("2026-10-01T15:00:00Z"), store, fakeSession);
    const subject = store.subjects[0]!;
    assert.deepEqual([subject.status, subject.review_reasons, subject.contact_number_ids], ["review", ["no_contact_number"], []]);
    assert.equal(store.periods.length, 1, "the New period is recorded, so age survives the review");
    assert.equal(store.evaluations.length, 1, "the evaluator sees the review status (engine: no routine obligations)");
  });

  test("a link arriving clears the reason: back to active, same period (age and deadlines unchanged)", async () => {
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(leadFacts(noPhone));
    await refreshLeadForOutreach(lead.ref, ruleOn(), at("2026-10-01T15:00:00Z"), store, fakeSession);
    const period = { ...store.periods[0]! };
    assert.equal(store.subjects[0]!.status, "review");
    // leadLinkWake nominates this Lead's outreach_lead_change when the Lead enters a number's link.
    store.numbers.set(`FormLead:${lead.ref.id}`, ["n1"]);
    await refreshLeadForOutreach(lead.ref, ruleOn(), at("2026-10-02T15:00:00Z"), store, fakeSession);
    const subject = store.subjects[0]!;
    assert.deepEqual([subject.status, subject.review_reasons, subject.contact_number_ids], ["active", [], ["n1"]]);
    assert.equal(store.periods.length, 1, "no new period");
    assert.deepEqual([store.periods[0]!.id, store.periods[0]!.started_at.toISOString(), store.periods[0]!.ended_at], [period.id, period.started_at.toISOString(), null]);
    assert.equal(store.evaluations.length, 2, "the status change re-evaluates the subject");
  });
});

test("final-import Forms await later Granot evidence before automatic intake or expansion", () => {
  const facts = leadFacts({ outreach_automation_suppressed: true });
  const configuration = intakeOn();
  const now = at("2026-10-02T14:00:00Z");
  assert.deepEqual(intakeAdmissionOf(facts, configuration, now), { admit: false, reason: "historical_reconciliation" });
  assert.deepEqual(expansionAdmissionOf(facts, configuration, now, { ambiguous_identity: false, creation_settled: true }),
    { admit: false, deferred: false, reason: "expansion:historical_reconciliation" });
});

test("later accepted Granot evidence restores normal admission without bypassing official closures", () => {
 const configuration = deskConfiguration({ transition: { intake_admission_enabled: true, intake_admission_at: GATE,
   expansion_admission_enabled: true, backfill_lookback_days: 90, backfill_include_upcoming_moves: true }, migration: { paused: false } });
 const now = at("2026-10-02T14:00:00Z");
 const imported = leadFacts({ ingestion_origin: "best_relocation_sheet", outreach_automation_suppressed: true });
 for (const capturedAt of ["2026-09-30T14:00:00Z", imported.created_at!.toISOString()]) {
  const old = { ...imported, ...accepted("0", capturedAt) };
  assert.deepEqual(intakeAdmissionOf(old, configuration, now), { admit: false, reason: "historical_reconciliation" });
  assert.deepEqual(expansionAdmissionOf(old, configuration, now, { ambiguous_identity: false, creation_settled: true }),
   { admit: false, deferred: false, reason: "expansion:historical_reconciliation" });
 }
 const later = { ...imported, ...accepted("0", "2026-10-01T15:00:00Z") };
 assert.equal(intakeAdmissionOf(later, configuration, now).admit, true);
 assert.equal(expansionAdmissionOf(later, configuration, now, { ambiguous_identity: false, creation_settled: true }).admit, true);
 for (const closure of [{ booked_id: "official-booking" }, { cancelled_id: "official-cancellation" }, { bad_lead: "bad_phone_email_name" }, { duplicate: true }]) {
  assert.equal(intakeAdmissionOf({ ...later, ...closure }, configuration, now).admit, false);
  assert.equal(expansionAdmissionOf({ ...later, ...closure }, configuration, now, { ambiguous_identity: false, creation_settled: true }).admit, false);
 }
 assert.equal(expansionAdmissionOf(later, configuration, now, { ambiguous_identity: true, creation_settled: true }).admit, false);
});
