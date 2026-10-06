import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toFloridaTimestamp } from "../../../utils/easternTime";
import { fixture } from "../engine/testSupport";
import type { ActiveConfiguration } from "../config/load";
import { refreshLeadForOutreach } from "./leadChangeJob";
import { toDeskLeadFacts } from "./leadFacts";
import { deskDecisionFingerprint } from "./policyMapping";
import { receivedFactsOf, subjectStatusOf } from "./subjectBuilder";
import {
  configurationDrivenDesired,
  contactWakeOf,
  ENROLLMENT_WAKE_SOURCES_PER_KIND,
  intakeAdmissionOf,
  loadSubjectPageContext,
  SUBJECT_WAKE_LOOKBACK_MS,
  SUBJECT_WAKE_SOURCES_PER_KIND,
  syncSubject,
} from "./sync";
import { accepted, APPROVED_MAPPING, deskConfiguration, fakeSession, leadFacts, MemoryDeskSubjectStore, objectId } from "./testing";

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

describe("olr C4: re-derive wakes when a subject or its period changes after the contact", () => {
  const deskOn = (controls: { desk_enabled?: boolean; goal_metrics_enabled?: boolean } = { desk_enabled: true }) =>
    deskConfiguration({ controls, transition: { intake_admission_enabled: true, intake_admission_at: GATE } });
  // leadFacts(): received 2026-10-01 10:00 ET = 14:00Z; intake activates at arrival. The wake covers the
  // activation's New York date, from midnight ET (04:00Z under EDT): earlier same-date contact carries the
  // subject for the P05f/P10a subtraction.
  const activationDate = "2026-10-01T04:00:00.000Z";

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

  test("creating a subject nominates its credited numbers' calls and SMS of the activation date, and none before it", async () => {
    const { store, lead } = seeded();
    const result = await refreshLeadForOutreach(lead.ref, deskOn(), at("2026-10-01T15:00:00Z"), store, fakeSession);
    assert.equal(result.outcome, "created");
    const subjectId = store.subjects[0]!.id;
    assert.deepEqual(
      nominated(store),
      [
        `sod:contact_change:call:c-arrival:admit:${subjectId}`,
        `sod:contact_change:call:c-before:admit:${subjectId}`,
        `sod:contact_change:call:c-gap:admit:${subjectId}`,
        `sod:contact_change:sms:m-before:admit:${subjectId}`,
        `sod:contact_change:sms:m-gap:admit:${subjectId}`,
        `sod:contact_change:sms:m-scheduled:admit:${subjectId}`,
      ],
      "merged rows, earlier New York dates, `other_leads`-only numbers and other Leads' numbers are not woken; a scheduled send is",
    );
    assert.deepEqual(
      store.contactWakes.map((w) => [w.since.toISOString(), w.limit_per_kind, w.now.toISOString()]),
      [[activationDate, SUBJECT_WAKE_SOURCES_PER_KIND, "2026-10-01T15:00:00.000Z"]],
    );
  });

  test("the newest sources per kind within the bound", async () => {
    const { store, lead } = seeded();
    for (let i = 0; i < SUBJECT_WAKE_SOURCES_PER_KIND + 5; i++)
      store.calls.push({ id: `c-burst-${String(i).padStart(2, "0")}`, contact_number_id: "n1", started_at: at(`2026-10-01T14:${String(i).padStart(2, "0")}:30Z`) });
    await refreshLeadForOutreach(lead.ref, deskOn(), at("2026-10-01T15:00:00Z"), store, fakeSession);
    const calls = nominated(store).filter((key) => key.includes(":call:"));
    assert.equal(calls.length, SUBJECT_WAKE_SOURCES_PER_KIND);
    assert.ok(calls.some((key) => key.includes(":c-burst-54:")) && !calls.some((key) => key.includes(":c-burst-00:")), "newest first");
    assert.equal(nominated(store).filter((key) => key.includes(":sms:")).length, 3, "SMS have their own bound");
  });

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

  test("a past-effective transition and a closure nominate from the new period's start", async () => {
    const { store, lead } = seeded();
    await refreshLeadForOutreach(lead.ref, deskOn(), at("2026-10-01T15:00:00Z"), store, fakeSession);
    const subjectId = store.subjects[0]!.id;
    store.calls.push({ id: "c-new-day", contact_number_id: "n1", started_at: at("2026-10-02T13:00:00Z") });
    store.calls.push({ id: "c-after-quote", contact_number_id: "n1", started_at: at("2026-10-02T15:00:00Z") });
    // Quoted accepted at 14:00Z (observation captured_at), applied at 16:00Z: the 15:00Z call was derived under New.
    store.addLead({ ...lead, ...accepted("1", "2026-10-02T14:00:00Z"), domain_revision: 2 });
    const quoted = await refreshLeadForOutreach(lead.ref, deskOn(), at("2026-10-02T16:00:00Z"), store, fakeSession);
    assert.equal(quoted.outcome, "updated");
    assert.equal(store.periods.at(-1)!.started_at.toISOString(), "2026-10-02T14:00:00.000Z");
    const periodKeys = nominated(store).filter((key) => key.includes(":period:"));
    assert.equal(periodKeys.length, 1);
    assert.match(periodKeys[0]!, new RegExp(`^sod:contact_change:call:c-after-quote:period:${subjectId}:[0-9a-f]{16}$`));
    assert.equal(store.contactWakes[1]!.since.toISOString(), "2026-10-02T14:00:00.000Z");
    // Booked (5) captured 10-03 14:00Z, applied 18:00Z: the closure re-derives the 15:00Z call to `none`.
    store.calls.push({ id: "c-after-booked", contact_number_id: "n1", started_at: at("2026-10-03T15:00:00Z") });
    store.addLead({ ...lead, ...accepted("5", "2026-10-03T14:00:00Z"), domain_revision: 3 });
    await refreshLeadForOutreach(lead.ref, deskOn(), at("2026-10-03T18:00:00Z"), store, fakeSession);
    assert.equal(store.periods.at(-1)!.workflow, "closed");
    const closureKeys = nominated(store).filter((key) => key.includes(":period:") && !periodKeys.includes(key));
    assert.equal(closureKeys.length, 1);
    assert.ok(closureKeys[0]!.startsWith("sod:contact_change:call:c-after-booked:period:"), "the closure has its own transition identity");
  });

  test("no wake when the desk wants no contact evidence; an assignment-only change needs none", async () => {
    const off = seeded();
    const created = await refreshLeadForOutreach(off.lead.ref, deskOn({}), at("2026-10-01T15:00:00Z"), off.store, fakeSession);
    assert.equal(created.outcome, "created");
    assert.equal(off.store.contactJobs.size, 0);
    const on = seeded();
    await refreshLeadForOutreach(on.lead.ref, deskOn(), at("2026-10-01T15:00:00Z"), on.store, fakeSession);
    const rep = objectId();
    on.store.reviewedReps.add(rep);
    on.store.addLead({ ...on.lead, receiver_agent_id: rep, domain_revision: 2 });
    const assigned = await refreshLeadForOutreach(on.lead.ref, deskOn(), at("2026-10-01T16:00:00Z"), on.store, fakeSession);
    assert.equal(assigned.outcome, "updated");
    assert.equal(on.store.contactWakes.length, 1, "assignment is prospective: no re-derive wake");
  });

  test("contactWakeOf: enrollment bound and window (the activation date, not the Lead's age), the 14-day floor, a future boundary", () => {
    const enrollment = {
      cohort_id: "expansion-1",
      kind: "expansion" as const,
      enrolled_at: at("2026-10-06T15:00:00Z"),
      activation_at: at("2026-10-06T15:00:00Z"),
      manifest_hash: null,
    };
    const none = { action: "none" as const, reason: "no_policy" as const };
    const asOf = at("2026-10-06T15:01:00Z");
    // 15:00Z = 11:00 ET; an older Lead received weeks ago still wakes only the activation date (from 00:00 ET).
    const enrolled = contactWakeOf({ outcome: "created", subject_id: "s1", enrollment, plan: none, as_of: asOf });
    assert.deepEqual(enrolled, { since: at("2026-10-06T04:00:00Z"), source_revision: "admit:s1", limit_per_kind: ENROLLMENT_WAKE_SOURCES_PER_KIND });
    assert.equal(ENROLLMENT_WAKE_SOURCES_PER_KIND, 10);
    // An evening activation (22:30 ET = 02:30Z the next UTC day) keeps its New York date.
    const evening = contactWakeOf({ outcome: "created", subject_id: "s1", enrollment: { ...enrollment, activation_at: at("2026-10-07T02:30:00Z") }, plan: none, as_of: at("2026-10-07T02:31:00Z") });
    assert.equal(evening!.since.toISOString(), "2026-10-06T04:00:00.000Z");
    const replayedLate = at("2026-10-25T15:00:00Z");
    const old = contactWakeOf({ outcome: "created", subject_id: "s1", enrollment, plan: none, as_of: replayedLate });
    assert.equal(+old!.since, +replayedLate - SUBJECT_WAKE_LOOKBACK_MS, "never older than 14 days");
    const period = {
      transition_key: "priority:granot:quoted:1",
      workflow: "quoted" as const,
      start_kind: "transition" as const,
      priority: "1",
      priority_source_ref: null,
      priority_source_revision: null,
      time_basis: "accepted_observation_captured_at" as const,
    };
    const later = at("2026-10-06T15:30:00Z");
    const future = { action: "open" as const, period: { ...period, started_at: at("2026-10-06T16:00:00Z") } };
    assert.equal(contactWakeOf({ outcome: "updated", subject_id: "s1", enrollment, plan: future, as_of: later }), null, "nothing derived after now");
    assert.equal(contactWakeOf({ outcome: "updated", subject_id: "s1", enrollment, plan: none, as_of: later }), null);
    const pastPlan = { ...future, period: { ...period, started_at: at("2026-10-06T14:00:00Z") } };
    const past = contactWakeOf({ outcome: "updated", subject_id: "s1", enrollment, plan: pastPlan, as_of: later });
    assert.equal(past!.limit_per_kind, SUBJECT_WAKE_SOURCES_PER_KIND);
    assert.equal(+past!.since, +at("2026-10-06T14:00:00Z"));
    assert.match(past!.source_revision, /^period:s1:[0-9a-f]{16}$/);
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

  test("the decision fingerprint is stamped on create and on sync; a fingerprint-only change is bookkeeping (no outreach_evaluate)", async () => {
    const store = new MemoryDeskSubjectStore();
    const a = configAt(3, "2026-10-01T00:00:00Z");
    const lead = store.addLead(leadFacts());
    await refreshLeadForOutreach(lead.ref, a, at("2026-10-01T15:00:00Z"), store, fakeSession);
    assert.equal(store.subjects[0]!.decision_fingerprint, deskDecisionFingerprint(a.value.cadence));
    assert.match(store.subjects[0]!.decision_fingerprint!, /^[0-9a-f]{64}$/);
    // A map change that does not concern this subject (code 9 mapped; the subject is an intake-default New).
    const b = configAt(4, "2026-10-02T15:00:00Z", { priority_map: mapWith9("quoted") });
    assert.notEqual(deskDecisionFingerprint(b.value.cadence), deskDecisionFingerprint(a.value.cadence));
    const result = await refreshLeadForOutreach(lead.ref, b, at("2026-10-02T15:03:00Z"), store, fakeSession);
    assert.equal(result.outcome, "updated");
    assert.equal(store.subjects[0]!.decision_fingerprint, deskDecisionFingerprint(b.value.cadence));
    assert.equal(store.subjects[0]!.revision, 2, "the stamp is written");
    assert.deepEqual(store.evaluations.map((e) => e.revision), [1], "bookkeeping only: no outreach_evaluate");
    assert.equal(store.periods.length, 1, "no period change");
    // Controls, goals and the other cadence values never re-decide.
    const controls: ActiveConfiguration = {
      ...b,
      value: { ...b.value, controls: { ...b.value.controls, desk_enabled: !b.value.controls.desk_enabled }, cadence: { ...b.value.cadence, policy_version: "another-policy" } },
    };
    assert.equal(deskDecisionFingerprint(controls.value.cadence), deskDecisionFingerprint(b.value.cadence));
    // Reordering the map's codes is not a decision change.
    const reordered = { ...b.value.cadence.priority_map!, codes: [...b.value.cadence.priority_map!.codes].reverse() };
    assert.equal(deskDecisionFingerprint({ ...b.value.cadence, priority_map: reordered }), deskDecisionFingerprint(b.value.cadence));
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

  test("a null stored fingerprint is not treated as a configuration change", async () => {
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(leadFacts(accepted("9", "2026-10-01T14:01:00Z", "9".repeat(24))));
    await refreshLeadForOutreach(lead.ref, configAt(3, "2026-10-01T00:00:00Z"), at("2026-10-01T15:00:00Z"), store, fakeSession);
    store.subjects[0] = { ...store.subjects[0]!, decision_fingerprint: null }; // a subject written before B2
    const b = configAt(4, "2026-10-02T15:00:00Z", { priority_map: mapWith9("quoted") });
    await refreshLeadForOutreach(lead.ref, b, at("2026-10-02T15:03:00Z"), store, fakeSession);
    const quoted = store.periods.at(-1)!;
    // Without a stored fingerprint nothing tells the sync the change is the configuration's: the fact time stands.
    assert.deepEqual(
      [quoted.workflow, quoted.started_at.toISOString(), quoted.time_basis, quoted.transition_key],
      ["quoted", "2026-10-01T14:01:00.000Z", "accepted_observation_captured_at", `priority:observation:${"9".repeat(24)}:quoted:9`],
    );
    assert.equal(store.subjects[0]!.decision_fingerprint, deskDecisionFingerprint(b.value.cadence), "stamped");
  });

  test("a review subject decided by an intake-default PATCH opens a late first period at the configuration time (B1 + B2)", async () => {
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(leadFacts({ ingestion_origin: "granot_lead_created" }));
    await refreshLeadForOutreach(lead.ref, configAt(3, "2026-10-01T00:00:00Z"), at("2026-10-01T15:00:00Z"), store, fakeSession);
    assert.deepEqual([store.subjects[0]!.status, store.subjects[0]!.review_reasons, store.periods.length], ["review", ["priority_needs_review"], 0]);
    const intake = { ...APPROVED_MAPPING!.intake_default_rule!, granot_created: "new" as const };
    await refreshLeadForOutreach(lead.ref, configAt(4, "2026-10-03T13:00:00Z", { intake_default_rule: intake }), at("2026-10-03T13:04:00Z"), store, fakeSession);
    const first = store.periods[0]!;
    assert.deepEqual(
      [first.workflow, first.start_kind, first.started_at.toISOString(), first.time_basis, first.transition_key],
      ["new", "activation", "2026-10-03T13:00:00.000Z", "configuration_activated_at", "intake_default:granot_created:c4"],
    );
    assert.equal(store.subjects[0]!.status, "active");
  });

  test("configurationDrivenDesired: a same or null fingerprint, a closure fact, or a fact newer than the configuration keep the desired period", () => {
    const desired = {
      workflow: "quoted" as const,
      priority: "1",
      transition_key: "priority:observation:o:quoted:1",
      priority_source_ref: "o",
      priority_source_revision: 2,
      effective_at: at("2026-10-02T10:00:00Z"),
      time_basis: "accepted_observation_captured_at" as const,
      end_reason_for_previous: "priority_change" as const,
    };
    type Input = Parameters<typeof configurationDrivenDesired>[1];
    const input: Input = {
      stored_fingerprint: "a",
      fingerprint: "b",
      eligibility: { outcome: "eligible" } as Input["eligibility"],
      configuration: { revision: 7, updated_at: at("2026-10-02T12:00:00Z") },
      as_of: at("2026-10-02T12:05:00Z"),
    };
    assert.deepEqual(configurationDrivenDesired(desired, input), {
      ...desired,
      effective_at: at("2026-10-02T12:00:00Z"),
      time_basis: "configuration_activated_at",
      transition_key: `${desired.transition_key}:c7`,
    });
    assert.equal(configurationDrivenDesired(desired, { ...input, stored_fingerprint: "b" }), desired);
    assert.equal(configurationDrivenDesired(desired, { ...input, stored_fingerprint: null }), desired);
    assert.equal(configurationDrivenDesired(desired, { ...input, eligibility: { outcome: "closed", reason: "official_booking" } as Input["eligibility"] }), desired);
    assert.equal(configurationDrivenDesired(desired, { ...input, configuration: { revision: 7, updated_at: at("2026-10-02T09:00:00Z") } }), desired, "fact newer than the PATCH");
    assert.equal(configurationDrivenDesired(null, input), null);
    // A pointer time after the sync instant (clock skew) never puts the start in the future.
    assert.equal(
      configurationDrivenDesired(desired, { ...input, configuration: { revision: 7, updated_at: at("2026-10-02T12:09:00Z") } })!.effective_at.toISOString(),
      "2026-10-02T12:05:00.000Z",
    );
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

  test("rule absent (today's behaviour): the same subject stays active", async () => {
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(leadFacts(noPhone));
    await refreshLeadForOutreach(lead.ref, intakeOn(), at("2026-10-01T15:00:00Z"), store, fakeSession);
    assert.deepEqual([store.subjects[0]!.status, store.subjects[0]!.review_reasons], ["active", []]);
  });

  test("rule on, a phone without a Contact Number yet is a linking delay: stays active", async () => {
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(leadFacts());
    await refreshLeadForOutreach(lead.ref, ruleOn(), at("2026-10-01T15:00:00Z"), store, fakeSession);
    assert.deepEqual([store.subjects[0]!.status, store.subjects[0]!.review_reasons, store.subjects[0]!.contact_number_ids], ["active", [], []]);
  });

  test("rule on, a phone that never forms an E.164 counts as no phone", async () => {
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(leadFacts({ phone: "12", normalized_phone: "12" }));
    await refreshLeadForOutreach(lead.ref, ruleOn(), at("2026-10-01T15:00:00Z"), store, fakeSession);
    assert.deepEqual([store.subjects[0]!.status, store.subjects[0]!.review_reasons], ["review", ["no_contact_number"]]);
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

  test("a phone added to the Lead clears the reason on its Lead change", async () => {
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(leadFacts(noPhone));
    await refreshLeadForOutreach(lead.ref, ruleOn(), at("2026-10-01T15:00:00Z"), store, fakeSession);
    store.addLead({ ...lead, phone: "(555) 010-0001", normalized_phone: "5550100001", domain_revision: 2 });
    await refreshLeadForOutreach(lead.ref, ruleOn(), at("2026-10-01T16:00:00Z"), store, fakeSession);
    assert.deepEqual([store.subjects[0]!.status, store.subjects[0]!.review_reasons], ["active", []]);
  });

  test("subjectStatusOf: the reason joins the other reasons; closed stays closed", () => {
    const base = {
      eligibility: { outcome: "eligible" } as never,
      decision: { kind: "intake_default", source: "website_form" } as never,
      received: { received_at: null, received_date: null, received_quality: "missing", adapter_version: "lead-instant-v1" } as const,
      active_workflow: "new" as const,
      current_status: "active" as const,
    };
    const contact = { number_ids: [], phone_e164: null, rule: "review_no_cadence" as const };
    assert.deepEqual(subjectStatusOf({ ...base, contact }).review_reasons, ["received_time_missing", "no_contact_number"]);
    assert.deepEqual(subjectStatusOf({ ...base, contact: { ...contact, rule: undefined } }).review_reasons, ["received_time_missing"]);
    assert.deepEqual(subjectStatusOf(base).review_reasons, ["received_time_missing"], "no contact input = pre-C2c");
    assert.deepEqual(subjectStatusOf({ ...base, contact: { ...contact, number_ids: ["n1"] } }).review_reasons, ["received_time_missing"]);
    assert.deepEqual(subjectStatusOf({ ...base, contact: { ...contact, phone_e164: "+15550100000" } }).review_reasons, ["received_time_missing"]);
    assert.deepEqual(subjectStatusOf({ ...base, active_workflow: "closed", contact }), { status: "closed", review_reasons: [] });
  });
});
