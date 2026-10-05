import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fixture } from "../engine/testSupport";
import { evaluateDeskEligibility } from "./eligibility";
import { refreshLeadForOutreach } from "./leadChangeJob";
import { accepted, deskConfiguration, fakeSession, leadFacts, MemoryDeskSubjectStore } from "./testing";

type Case = { id: string } & Record<string, unknown>;
const fx = fixture<{ cases: Case[]; runtime_eligibility_proven: boolean }>("p05h-lead-eligibility.json");
const byId = (id: string) => fx.cases.find((c) => c.id === id)!;

describe("P05h new-desk eligibility seam (fixture p05h-lead-eligibility.json)", () => {
  test("every fixture case is covered by a test below", () => {
    assert.deepEqual(fx.cases.map((c) => c.id).sort(), [
      "bad_lead", "crm_owner_closed", "duplicate", "eligible_new", "form_fill", "legacy_closed_no_sync",
      "number_only", "official_booking_cancellation", "shared_phone", "unmatched_booking_anchor", "viable_no_sync",
    ]);
  });

  test("eligible_new: an ordinary Form/Call Lead is routine-eligible", () => {
    assert.equal(byId("eligible_new").routine_eligible, true);
    for (const model of ["FormLead", "CallLead"] as const) assert.deepEqual(evaluateDeskEligibility({ kind: "lead", facts: leadFacts({ model }) }), { outcome: "eligible" });
  });

  test("duplicate: no separate cadence (excluded, never a subject of its own)", () => {
    const c = byId("duplicate");
    assert.equal(c.separate_cadence, false);
    assert.equal(c.duplicate_credit, 0);
    assert.deepEqual(evaluateDeskEligibility({ kind: "lead", facts: leadFacts({ duplicate: true }) }), { outcome: "excluded", reason: "duplicate" });
  });

  test("bad_lead: authoritative closure", () => {
    assert.equal(byId("bad_lead").routine_eligible, false);
    assert.deepEqual(evaluateDeskEligibility({ kind: "lead", facts: leadFacts({ bad_lead: "spam" }) }), { outcome: "closed", reason: "bad_lead" });
  });

  test("official_booking_cancellation: official Booking and Cancellation close the Lead", () => {
    assert.equal(byId("official_booking_cancellation").routine_eligible, false);
    assert.deepEqual(evaluateDeskEligibility({ kind: "lead", facts: leadFacts({ booked_id: "b1" }) }), { outcome: "closed", reason: "official_booking" });
    assert.deepEqual(evaluateDeskEligibility({ kind: "lead", facts: leadFacts({ cancelled_id: "c1" }) }), { outcome: "closed", reason: "official_cancellation" });
  });

  test("crm_owner_closed: a CRM-disposition closure is never automatically reopened", async () => {
    const c = byId("crm_owner_closed");
    assert.equal(c.routine_eligible, false);
    assert.equal(c.auto_reopened, false);
    const store = new MemoryDeskSubjectStore();
    const config = deskConfiguration({ transition: { intake_admission_enabled: true, intake_admission_at: "2026-10-01T00:00:00.000Z" } });
    const lead = store.addLead(leadFacts({ ...accepted("0", "2026-10-01T14:01:00Z") }));
    await refreshLeadForOutreach(lead.ref, config, new Date("2026-10-01T15:00:00Z"), store, fakeSession);
    store.addLead({ ...lead, ...accepted("8", "2026-10-02T14:00:00Z"), domain_revision: 2 });
    await refreshLeadForOutreach(lead.ref, config, new Date("2026-10-02T15:00:00Z"), store, fakeSession);
    assert.equal(store.subjects[0]!.status, "closed");
    // A later nonterminal accepted priority does not reopen it.
    store.addLead({ ...lead, ...accepted("0", "2026-10-03T14:00:00Z"), domain_revision: 3 });
    await refreshLeadForOutreach(lead.ref, config, new Date("2026-10-03T15:00:00Z"), store, fakeSession);
    assert.equal(store.subjects[0]!.status, "closed");
    assert.deepEqual(store.periods.map((p) => p.workflow), ["new", "closed"]);
  });

  test("viable_no_sync: No-Sync is reporting scope, not a desk closure", () => {
    const c = byId("viable_no_sync");
    assert.equal(c.routine_eligible, true);
    assert.equal(c.reporting_changed, false);
    assert.deepEqual(evaluateDeskEligibility({ kind: "lead", facts: leadFacts({ no_sync: true }) }), { outcome: "eligible" });
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

  test("form_fill: the Form Fill flag alone neither excludes nor merges a Call Lead", () => {
    const c = byId("form_fill");
    assert.equal(c.flag_alone_excludes, false);
    assert.equal(c.flag_alone_merges, false);
    assert.deepEqual(evaluateDeskEligibility({ kind: "lead", facts: leadFacts({ model: "CallLead", form_fill: true }) }), { outcome: "eligible" });
  });

  test("unmatched_booking_anchor: an unmatched Call Lead created only to anchor a Booking has no automatic cadence", () => {
    assert.equal(byId("unmatched_booking_anchor").automatic_cadence, false);
    assert.deepEqual(evaluateDeskEligibility({ kind: "lead", facts: leadFacts({ model: "CallLead", created_on_unmatched: true }) }), {
      outcome: "excluded",
      reason: "unmatched_booking_anchor",
    });
  });

  test("number_only: a number without a verified eligible Lead stays history/review, no guessed cadence", () => {
    const c = byId("number_only");
    assert.equal(c.guessed_cadence, false);
    assert.equal(c.guessed_goal_credit, 0);
    assert.deepEqual(evaluateDeskEligibility({ kind: "number_only" }), { outcome: "review", reason: "number_only_unassociated" });
  });

  test("shared_phone: two Leads on one phone stay two subjects; nothing merges them", async () => {
    const c = byId("shared_phone");
    assert.equal(c.auto_merge, false);
    const store = new MemoryDeskSubjectStore();
    const config = deskConfiguration({ transition: { intake_admission_enabled: true, intake_admission_at: "2026-10-01T00:00:00.000Z" } });
    const a = store.addLead(leadFacts({ normalized_phone: "5550101111" }));
    const b = store.addLead(leadFacts({ model: "CallLead", normalized_phone: "5550101111" }));
    for (const lead of [a, b]) await refreshLeadForOutreach(lead.ref, config, new Date("2026-10-01T15:00:00Z"), store, fakeSession);
    assert.equal(store.subjects.length, 2, "no merge");
    // The shared number's association stays pending (IMPL-07, lane S3); each subject only lists its own attached numbers.
    assert.deepEqual(store.subjects.map((s) => s.contact_number_ids), [[], []]);
  });
});
