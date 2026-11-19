import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fixture } from "../engine/testSupport";
import { evaluateDeskEligibility } from "./eligibility";
import { refreshLeadForOutreach } from "./leadChangeJob";
import { deskConfiguration, fakeSession, leadFacts, MemoryDeskSubjectStore } from "./testing";

type Case = { id: string } & Record<string, unknown>;
const fx = fixture<{ cases: Case[]; runtime_eligibility_proven: boolean }>("p05h-lead-eligibility.json");
const byId = (id: string) => fx.cases.find((c) => c.id === id)!;

describe("P05h new-desk eligibility seam (fixture p05h-lead-eligibility.json)", () => {

  test("official_booking_cancellation: official Booking and Cancellation close the Lead", () => {
    assert.equal(byId("official_booking_cancellation").routine_eligible, false);
    assert.deepEqual(evaluateDeskEligibility({ kind: "lead", facts: leadFacts({ booked_id: "b1" }) }), { outcome: "closed", reason: "official_booking" });
    assert.deepEqual(evaluateDeskEligibility({ kind: "lead", facts: leadFacts({ cancelled_id: "c1" }) }), { outcome: "closed", reason: "official_cancellation" });
  });

  test("legacy_closed_no_sync: a legacy-closed record needs review and an authorized reopening, never silent", () => {
    const c = byId("legacy_closed_no_sync");
    assert.equal(c.review_required, true);
    assert.equal(c.auto_reopened, false);
    assert.deepEqual(evaluateDeskEligibility({ kind: "lead", facts: leadFacts({ no_sync: true }), legacy_closed: true }), {
      outcome: "review",
      reason: "legacy_closed_reopening_required",
    });
  });

  test("unmatched_booking_anchor: an unmatched Call Lead created only to anchor a Booking has no automatic cadence", () => {
    assert.equal(byId("unmatched_booking_anchor").automatic_cadence, false);
    assert.deepEqual(evaluateDeskEligibility({ kind: "lead", facts: leadFacts({ model: "CallLead", created_on_unmatched: true }) }), {
      outcome: "excluded",
      reason: "unmatched_booking_anchor",
    });
  });
});

describe("Owner 2026-10-28: a Call Lead needs a Job Number for a cadence; a Form Lead does not", () => {
  const config = deskConfiguration({
    transition: { intake_admission_enabled: true, intake_admission_at: "2026-10-01T00:00:00.000Z", backfill_lookback_days: 90, backfill_include_upcoming_moves: true, expansion_admission_enabled: true },
    migration: { paused: false },
  });
  const noJob = { job_no: null, normalized_job_no: null };

  test("intake refuses a new Call Lead without a job; the B6 admission enrolls it once Granot writes the job, starting then", async () => {
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(leadFacts({ model: "CallLead", ...noJob }));
    const refused = await refreshLeadForOutreach(lead.ref, config, new Date("2026-10-01T15:00:00Z"), store, fakeSession);
    assert.equal(refused.outcome, "not_admitted");
    assert.equal(refused.reason, "excluded:job_number_pending");
    assert.equal(store.subjects.length, 0);

    store.addLead({ ...lead, job_no: "P5560001", normalized_job_no: "P5560001", domain_revision: 2, last_changed_at: new Date("2026-10-02T16:00:00Z") });
    const asOf = new Date("2026-10-02T16:00:30Z");
    const admitted = await refreshLeadForOutreach(lead.ref, config, asOf, store, fakeSession, "admission");
    assert.equal(admitted.admission, "expansion", JSON.stringify(admitted));
    assert.equal(store.subjects[0]!.status, "active");
    assert.equal(+store.periods[0]!.started_at, +asOf, "nothing owed before the job arrived");
  });

  test("an existing Call Lead subject without a job moves to review (owes nothing) and returns to active when the job arrives", async () => {
    const store = new MemoryDeskSubjectStore();
    const lead = store.addLead(leadFacts({ model: "CallLead" }));
    await refreshLeadForOutreach(lead.ref, config, new Date("2026-10-01T15:00:00Z"), store, fakeSession);
    assert.equal(store.subjects[0]!.status, "active");

    store.addLead({ ...lead, ...noJob, domain_revision: 2 });
    await refreshLeadForOutreach(lead.ref, config, new Date("2026-10-02T15:00:00Z"), store, fakeSession);
    assert.equal(store.subjects[0]!.status, "review");
    assert.deepEqual(store.subjects[0]!.review_reasons, ["job_number_pending"]);

    store.addLead({ ...lead, job_no: "P5560002", normalized_job_no: "P5560002", domain_revision: 3 });
    await refreshLeadForOutreach(lead.ref, config, new Date("2026-10-03T15:00:00Z"), store, fakeSession);
    assert.equal(store.subjects[0]!.status, "active");
    assert.deepEqual(store.subjects[0]!.review_reasons, []);
  });
});

describe("Owner 2026-10-28: a Call Lead mirroring its Form Lead's job is the same customer", () => {
  test("it is excluded (form_lead_holds_job); closures still come first", () => {
    const facts = leadFacts({ model: "CallLead", form_sibling_lead_id: "650000000000000000000010" });
    assert.deepEqual(evaluateDeskEligibility({ kind: "lead", facts }), { outcome: "excluded", reason: "form_lead_holds_job" });
    assert.deepEqual(evaluateDeskEligibility({ kind: "lead", facts: { ...facts, booked_id: "b1" } }), { outcome: "closed", reason: "official_booking" });
  });

  test("the Form Lead is not held as ambiguous because its Call sibling carries the same job", async () => {
    const store = new MemoryDeskSubjectStore();
    const config = deskConfiguration({ transition: { intake_admission_enabled: true, intake_admission_at: "2026-10-01T00:00:00.000Z" } });
    const job = { job_no: "P5562894", normalized_job_no: "P5562894" };
    const form = store.addLead(leadFacts({ ...job }));
    const call = store.addLead(leadFacts({ model: "CallLead", ...job, form_sibling_lead_id: form.ref.id }));
    await refreshLeadForOutreach(form.ref, config, new Date("2026-10-01T15:00:00Z"), store, fakeSession);
    const refused = await refreshLeadForOutreach(call.ref, config, new Date("2026-10-01T15:00:00Z"), store, fakeSession);
    assert.equal(refused.reason, "excluded:form_lead_holds_job");
    assert.equal(store.subjects.length, 1);
    assert.equal(store.subjects[0]!.status, "active");
    assert.deepEqual(store.subjects[0]!.review_reasons, []);
  });
});
