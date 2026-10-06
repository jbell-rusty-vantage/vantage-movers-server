import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evaluateSubject } from "../engine";
import { evaluate, fixture, ny, obligationsOn, outbound, period, policyWith, quotedPlan, scenario } from "../engine/testSupport";
import { refreshLeadForOutreach } from "./leadChangeJob";
import { planPeriodTransition, type FirstPeriodStart } from "./periodPlanner";
import { intakeSourceOf, resolveDeskPolicy } from "./policyMapping";
import { desiredPeriodOf } from "./subjectBuilder";
import { evaluateDeskEligibility } from "./eligibility";
import { accepted, deskConfiguration, fakeSession, leadFacts, MemoryDeskSubjectStore, objectId } from "./testing";

const GATE = "2026-10-01T00:00:00.000Z";
const intakeOn = () => deskConfiguration({ transition: { intake_admission_enabled: true, intake_admission_at: GATE } });
const at = (iso: string) => new Date(iso);
const mapping = deskConfiguration().value.cadence;

/** Enroll a fresh Lead through intake, then apply each later Lead state as an `outreach_lead_change`. */
async function lifecycle(states: Array<Partial<ReturnType<typeof leadFacts>>>, start = leadFacts()) {
  const store = new MemoryDeskSubjectStore();
  const config = intakeOn();
  let lead = store.addLead(start);
  const results = [await refreshLeadForOutreach(lead.ref, config, at("2026-10-01T15:00:00Z"), store, fakeSession)];
  let day = 2;
  for (const state of states) {
    lead = store.addLead({ ...lead, ...state, domain_revision: lead.domain_revision + 1 });
    results.push(await refreshLeadForOutreach(lead.ref, config, at(`2026-10-0${day++}T16:00:00Z`), store, fakeSession));
  }
  return { store, results, lead };
}

describe("P05d priority map from persisted configuration (fixture p05d-priority-map-manager-read.json)", () => {
  const fx = fixture<{
    known_priority_map: Record<string, string>;
    accepted_sources: string[];
    raw_payload_is_transition_authority: boolean;
    priority_five: { routine_cadence_stopped: boolean; official_booking_created: boolean; official_booked_flag_inferred: boolean };
    seven_eight: { official_duplicate_flag_inferred: boolean; booked_elsewhere_reason_inferred: boolean };
    transition: { historical_misses_preserved: boolean; implicit_reopen: boolean };
  }>("p05d-priority-map-manager-read.json");
  const expected: Record<string, string> = { new: "new", quoted: "quoted", rep_discretion_no_routine_cadence: "discretion" };

  test("each known code maps to its workflow through cadence.priority_map (no hard-coded map)", () => {
    for (const [code, meaning] of Object.entries(fx.known_priority_map)) {
      const decision = resolveDeskPolicy(leadFacts({ ...accepted(code, "2026-10-01T14:00:00Z") }), mapping);
      assert.equal(decision.kind, "accepted", code);
      if (decision.kind !== "accepted") continue;
      assert.equal(decision.workflow, expected[meaning] ?? "closed", code);
      assert.equal(decision.priority_raw, code);
    }
    // Without an installed map the decision fails closed (no default map exists).
    assert.deepEqual(resolveDeskPolicy(leadFacts({ ...accepted("0", "2026-10-01T14:00:00Z") }), { priority_map: null, intake_default_rule: null }), {
      kind: "unavailable",
      missing: ["cadence.priority_map", "cadence.intake_default_rule"],
    });
    // An edited map is honoured on the next decision (configuration is the authority).
    const edited = { ...mapping, priority_map: { ...mapping.priority_map!, codes: [{ code: "0", workflow: "quoted" as const, closure_reason: null }] } };
    assert.equal((resolveDeskPolicy(leadFacts({ ...accepted("0", "2026-10-01T14:00:00Z") }), edited) as { workflow: string }).workflow, "quoted");
  });

  test("source parity: the accepted code means the same whatever source accepted it", () => {
    assert.deepEqual(fx.accepted_sources, ["granot_webhook", "browser_extension", "granot_http_automation"]);
    // The Lead stores only the accepted code + observation provenance; the accepting channel is not an input.
    const decisions = fx.accepted_sources.map(() => resolveDeskPolicy(leadFacts({ ...accepted("1", "2026-10-01T14:00:00Z", "a".repeat(24)) }), mapping));
    assert.ok(decisions.every((d) => JSON.stringify(d) === JSON.stringify(decisions[0])));
  });

  test("raw payload is not transition authority: only the Lead's accepted priority is read", () => {
    assert.equal(fx.raw_payload_is_transition_authority, false);
    // A non-canonical stored value is never mapped.
    assert.deepEqual(resolveDeskPolicy(leadFacts({ granot_priority: "Hot" }), mapping), { kind: "review", reason: "malformed_priority" });
  });

  test("Priority 5: routine cadence stops (closed period) without inferring an official Booking", async () => {
    assert.equal(fx.priority_five.routine_cadence_stopped, true);
    const { store, lead } = await lifecycle([{ ...accepted("5", "2026-10-02T14:00:00Z") }], leadFacts({ ...accepted("0", "2026-10-01T14:01:00Z") }));
    assert.equal(store.subjects[0]!.status, "closed");
    assert.equal(store.periods.at(-1)!.workflow, "closed");
    assert.equal(store.leads.get(`FormLead:${lead.ref.id}`)!.booked_id, null, "no official booking created or inferred");
    assert.equal(fx.priority_five.official_booking_created, false);
    assert.equal(fx.priority_five.official_booked_flag_inferred, false);
  });

  test("Priorities 7/8: closed with no duplicate flag or booked-elsewhere reason inferred", async () => {
    for (const code of ["7", "8"]) {
      const { store } = await lifecycle([{ ...accepted(code, "2026-10-02T14:00:00Z") }], leadFacts({ ...accepted("1", "2026-10-01T14:01:00Z") }));
      assert.equal(store.subjects[0]!.status, "closed", code);
      assert.deepEqual(store.subjects[0]!.review_reasons, [], code);
      assert.equal(store.leads.values().next().value!.duplicate, false, code);
    }
    assert.equal(fx.seven_eight.official_duplicate_flag_inferred, false);
  });

  test("official Booking closes the subject (P05d) and the closure is final", async () => {
    const { store } = await lifecycle([{ booked_id: objectId() }, { booked_id: null }], leadFacts({ ...accepted("0", "2026-10-01T14:01:00Z") }));
    assert.equal(store.subjects[0]!.status, "closed");
    assert.deepEqual(store.periods.map((p) => [p.workflow, p.ended_at === null]), [["new", false], ["closed", true]]);
    assert.equal(fx.transition.implicit_reopen, false);
  });

  test("transition: close + open with one semantic key; a repeated accepted priority is a no-op", async () => {
    const obs = "b".repeat(24);
    const { store, results } = await lifecycle(
      [
        { ...accepted("1", "2026-10-02T14:00:00Z", obs) },
        { ...accepted("1", "2026-10-02T14:00:00Z", obs) }, // replay of the same observation
        { ...accepted("1", "2026-10-03T14:00:00Z") }, // a new observation repeating the same code
      ],
      leadFacts({ ...accepted("0", "2026-10-01T14:01:00Z") }),
    );
    assert.deepEqual(store.periods.map((p) => [p.workflow, p.start_kind]), [["new", "intake"], ["quoted", "transition"]]);
    const quoted = store.periods[1]!;
    assert.equal(quoted.transition_key, `priority:observation:${obs}:quoted:1`);
    assert.equal(+store.periods[0]!.ended_at!, +quoted.started_at, "the old period ends when the new starts");
    assert.equal(+quoted.started_at, +at("2026-10-02T14:00:00Z"), "time basis = accepted observation captured_at");
    assert.equal(quoted.time_basis, "accepted_observation_captured_at");
    assert.equal(store.periods.filter((p) => p.ended_at === null).length, 1);
    assert.deepEqual(results.slice(2).map((r) => r.reason), ["transition_already_recorded", "repeated_priority"]);
  });
});

describe("P05b/P05c S1 parts: unvouched codes and closed subjects (fixtures p05b, p05c)", () => {
  for (const file of ["p05b-priority-three.json", "p05c-unmapped-priority.json"] as const) {
    const code = file.startsWith("p05b") ? "3" : "42";
    const workflow = code === "3" ? "discretion" : "none";
    test(`${file.slice(0, 4)}: an accepted ${code} ends routine cadence with a new ${workflow} period (lead stays open, visible)`, async () => {
      const { store } = await lifecycle([{ ...accepted(code, "2026-10-02T14:00:00Z") }], leadFacts({ ...accepted("0", "2026-10-01T14:01:00Z") }));
      assert.deepEqual(store.periods.map((p) => p.workflow), ["new", workflow]);
      assert.equal(store.subjects[0]!.status, "active");
      assert.equal(store.subjects[0]!.priority.raw, code, "raw code displayed");
    });
    test(`${file.slice(0, 4)}: an unvouched ${code} (not accepted on the Lead) authorizes no transition`, async () => {
      // An unvouched update never reaches the Lead (leadDesiredState skips it): the Lead still carries its
      // accepted 0, so the refresh it triggers finds the same transition and supersedes nothing.
      const { store, results } = await lifecycle([{}], leadFacts({ ...accepted("0", "2026-10-01T14:01:00Z") }));
      assert.equal(results.at(-1)!.reason, "transition_already_recorded");
      assert.deepEqual(store.periods.map((p) => [p.workflow, p.ended_at]), [["new", null]]);
    });
    test(`${file.slice(0, 4)}: closed_to_${code === "3" ? "three" : "unmapped"} — no implicit reopen`, async () => {
      const { store } = await lifecycle(
        [{ ...accepted("8", "2026-10-02T14:00:00Z") }, { ...accepted(code, "2026-10-03T14:00:00Z") }],
        leadFacts({ ...accepted("0", "2026-10-01T14:01:00Z") }),
      );
      assert.equal(store.subjects[0]!.status, "closed");
      assert.deepEqual(store.periods.map((p) => p.workflow), ["new", "closed"]);
    });
  }
});

describe("P05e intake defaults and uncertain priority (fixture p05e-intake-priority-uncertainty.json)", () => {
  const fx = fixture<{ cases: Array<{ id: string; cadence: string | null; policy_origin?: string; label?: string; last_verified?: string; timeline_reset?: boolean; uncertainty_visible?: boolean }>; granot_priority_fabricated: boolean; historical_import_treated_as_fresh: boolean }>(
    "p05e-intake-priority-uncertainty.json",
  );
  const origins: Record<string, { model: "FormLead" | "CallLead"; origin: string }> = {
    website: { model: "FormLead", origin: "wordpress_form" },
    best_relocation: { model: "CallLead", origin: "best_relocation_sheet" },
    ringcentral: { model: "CallLead", origin: "ringcentral" },
    manual: { model: "FormLead", origin: "vantage_admin" },
  };

  for (const c of fx.cases) {
    test(c.id, async () => {
      if (origins[c.id]) {
        const { model, origin } = origins[c.id]!;
        const facts = leadFacts({ model, ingestion_origin: origin });
        assert.equal(resolveDeskPolicy(facts, mapping).kind, "intake_default");
        const { store } = await lifecycle([], facts);
        assert.equal(store.periods[0]!.workflow, c.cadence);
        assert.equal(store.periods[0]!.priority, null, "Granot Priority 0 is never fabricated");
        assert.equal(store.subjects[0]!.priority.basis, "intake_default");
        assert.equal(store.leads.get(`${model}:${facts.ref.id}`)!.granot_priority, null);
        return;
      }
      if (c.id === "granot_missing") {
        const facts = leadFacts({ ingestion_origin: "granot_lead_created", timestamp: at("2026-10-01T14:00:00Z") });
        const { store } = await lifecycle([], facts);
        assert.equal(store.periods.length, 0, "no guessed cadence");
        assert.equal(store.subjects[0]!.status, "review");
        assert.deepEqual(store.subjects[0]!.review_reasons, ["priority_needs_review"]);
        assert.equal(c.label, "Priority needs review");
        return;
      }
      if (c.id === "blank_refresh" || c.id === "malformed_refresh") {
        const code = c.last_verified === "quoted" ? "1" : "0";
        const store = new MemoryDeskSubjectStore();
        const config = intakeOn();
        const lead = store.addLead(leadFacts({ ...accepted(code, "2026-10-01T14:01:00Z") }));
        await refreshLeadForOutreach(lead.ref, config, at("2026-10-01T15:00:00Z"), store, fakeSession);
        // A blank/malformed Granot update is not accepted (the Lead keeps its code) but is observed.
        store.uncertain.add(`FormLead:${lead.ref.id}`);
        store.addLead({ ...lead, domain_revision: 2 });
        await refreshLeadForOutreach(lead.ref, config, at("2026-10-02T15:00:00Z"), store, fakeSession);
        assert.equal(store.periods.length, 1, "timeline not reset");
        assert.equal(store.periods[0]!.workflow, c.cadence);
        assert.equal(store.subjects[0]!.priority.uncertain, true, "uncertainty visible");
        // A legacy non-canonical stored value is the same: retained, flagged.
        store.addLead({ ...lead, granot_priority: "?", domain_revision: 3 });
        await refreshLeadForOutreach(lead.ref, config, at("2026-10-03T15:00:00Z"), store, fakeSession);
        assert.equal(store.periods.length, 1);
        assert.equal(store.subjects[0]!.priority.uncertain, true);
        return;
      }
      // accepted_three / accepted_unmapped at intake: visible subject, no routine cadence period.
      const code = c.id === "accepted_three" ? "3" : "42";
      const { store } = await lifecycle([], leadFacts({ ...accepted(code, "2026-10-01T14:01:00Z") }));
      assert.equal(store.periods[0]!.workflow, code === "3" ? "discretion" : "none");
      const r = evaluateSubject(
        {
          subject: { subject_id: "s", status: "active", closed_at: null, received_at: "2026-10-01T14:00:00.000Z", move_date: null, priority_uncertain: false, activation_at: "2026-10-01T14:00:00.000Z", originating_contact_event_id: null },
          periods: [{ period_id: "p", workflow: store.periods[0]!.workflow, priority_raw: code, start_kind: "intake", started_at: "2026-10-01T14:00:00.000Z", ended_at: null }],
          human_plans: [], restrictions: [], assignments: [], contact_events: [],
          coverage: { call: { complete_through: "2026-10-02T00:00:00.000Z" }, sms: { complete_through: null } },
        },
        policyWith({}),
        "2026-10-01T18:00:00.000Z",
      );
      assert.equal(r.obligations.length, 0, c.label);
    });
  }

  test("intake source classification: legacy imports and unknown origins have no intake default", () => {
    assert.equal(intakeSourceOf({ ref: { model: "CallLead", id: "x" }, ingestion_origin: "legacy_import" }), null);
    assert.equal(intakeSourceOf({ ref: { model: "FormLead", id: "x" }, ingestion_origin: null }), null);
    assert.equal(intakeSourceOf({ ref: { model: "FormLead", id: "x" }, ingestion_origin: "ringcentral" }), null);
    assert.equal(resolveDeskPolicy(leadFacts({ ingestion_origin: "legacy_unknown" }), mapping).kind, "review");
    assert.equal(fx.historical_import_treated_as_fresh, false);
  });

  test("source-specific defaults come from configuration: a source set to review gets no cadence", () => {
    const facts = leadFacts();
    const reviewed = { ...mapping, intake_default_rule: { ...mapping.intake_default_rule!, website_form: "review" as const } };
    assert.deepEqual(resolveDeskPolicy(facts, reviewed), { kind: "review", reason: "priority_needs_review" });
    assert.equal(desiredPeriodOf(facts, evaluateDeskEligibility({ kind: "lead", facts }), resolveDeskPolicy(facts, reviewed), at("2026-10-01T15:00:00Z")), null);
  });

  test("granot_missing then Priority 0 two days later: one New period started at acceptance; no period at received (olr B1)", async () => {
    const received = "2026-10-01T14:00:00Z";
    const { store, results } = await lifecycle(
      [{}, { ...accepted("0", "2026-10-03T14:00:00Z") }],
      leadFacts({ ingestion_origin: "granot_lead_created", timestamp: at(received) }),
    );
    assert.deepEqual(results.map((r) => [r.outcome, r.reason]), [["created", null], ["updated", "no_policy"], ["updated", null]], "no period until the decision");
    assert.equal(store.periods.length, 1);
    const first = store.periods[0]!;
    assert.equal(first.workflow, "new");
    assert.equal(first.start_kind, "activation", "a late first period is a partial start, never an intake arrival");
    assert.equal(+first.started_at, +at("2026-10-03T14:00:00Z"), "starts at the accepted observation, not at received");
    assert.equal(first.time_basis, "accepted_observation_captured_at");
    assert.equal(+store.subjects[0]!.enrollment.activation_at, +at(received), "the boundary itself is unchanged");
    assert.equal(store.subjects[0]!.status, "active");
  });

  test("after an admission hold clears, the late first period starts at the sync instant (desk_decision_at)", async () => {
    const received = "2026-10-01T14:00:00Z";
    const { store, results } = await lifecycle(
      [
        { timestamp: at("2026-12-01T14:00:00Z") }, // received time no longer credible: held for review
        { timestamp: at(received), ...accepted("1", "2026-10-02T10:00:00Z") }, // fixed and decided
      ],
      leadFacts({ ingestion_origin: "granot_lead_created", timestamp: at(received) }),
    );
    assert.deepEqual(results.map((r) => [r.outcome, r.reason]), [["created", null], ["updated", "no_policy"], ["updated", null]], "no period until the decision");
    assert.ok(store.subjects[0]!.review_reasons.length === 0);
    const first = store.periods[0]!;
    assert.equal(first.workflow, "quoted");
    assert.equal(first.start_kind, "activation");
    assert.equal(+first.started_at, +at("2026-10-03T16:00:00Z"), "the decision instant, not the earlier observation");
    assert.equal(first.time_basis, "desk_decision_at");
  });

  test("intake first period at admission still opens at received with the initial-response clock", async () => {
    const { store } = await lifecycle([], leadFacts({ ...accepted("0", "2026-10-01T14:01:00Z") }));
    const first = store.periods[0]!;
    assert.deepEqual([first.start_kind, first.time_basis], ["intake", "activation_boundary"]);
    assert.equal(+first.started_at, +store.subjects[0]!.enrollment.activation_at);
    assert.equal(+first.started_at, +at("2026-10-01T14:00:00Z"), "received instant");
    const r = evaluate(
      scenario({ received_at: first.started_at.toISOString(), periods: [period("p", "new", first.started_at.toISOString(), first.start_kind)] }),
      "2026-10-01T14:10:00.000Z",
    );
    assert.equal(r.initial_response?.outcome, "open", "the 30-working-minute clock runs from received");
  });

  test("an accepted priority after an intake default New with the same workflow restarts nothing", async () => {
    const { store, results } = await lifecycle([{ ...accepted("0", "2026-10-01T14:05:00Z") }]);
    assert.equal(store.periods.length, 1);
    assert.equal(results.at(-1)!.reason, "repeated_priority");
    assert.equal(store.subjects[0]!.priority.raw, "0");
    assert.equal(store.subjects[0]!.priority.basis, "accepted_observation");
  });
});

describe("period planner rules", () => {
  const desired = (workflow: "new" | "quoted" | "closed", key = `k:${workflow}`, effective = "2026-10-02T10:00:00Z") => ({
    workflow,
    priority: null,
    transition_key: key,
    priority_source_ref: null,
    priority_source_revision: 1,
    effective_at: at(effective),
    time_basis: "entity_change_applied_at" as const,
    end_reason_for_previous: workflow === "closed" ? ("closure" as const) : ("priority_change" as const),
  });
  const first: FirstPeriodStart = { kind: "activation", boundary: at("2026-10-05T12:00:00Z"), at_enrollment: true, as_of: at("2026-10-05T12:00:00Z"), held_before: false };
  /** A later sync of a subject that has no period yet (review at enrollment). */
  const late = (overrides: Partial<FirstPeriodStart> = {}): FirstPeriodStart => ({ ...first, at_enrollment: false, as_of: at("2026-10-08T16:00:00Z"), ...overrides });
  const observed = (effective: string) => ({ ...desired("new", "k:obs", effective), time_basis: "accepted_observation_captured_at" as const });

  test("first period opens at the enrollment boundary with the boundary as time basis", () => {
    const plan = planPeriodTransition({ active: null, desired: desired("new"), recorded_keys: new Set(), first_start: first });
    assert.equal(plan.action, "open");
    if (plan.action !== "open") return;
    assert.equal(+plan.period.started_at, +first.boundary);
    assert.equal(plan.period.start_kind, "activation");
    assert.equal(plan.period.time_basis, "activation_boundary");
    const intake = planPeriodTransition({ active: null, desired: desired("new"), recorded_keys: new Set(), first_start: { ...first, kind: "intake" } });
    assert.ok(intake.action === "open" && intake.period.start_kind === "intake" && +intake.period.started_at === +first.boundary);
  });

  test("review → accepted later: the first period starts at the accepted observation time, as an activation, observation time basis", () => {
    // Boundary Mon 10:00 New York, priority accepted Wed 14:00.
    const boundary = at(ny("2026-10-05", "10:00"));
    const plan = planPeriodTransition({ active: null, desired: observed(ny("2026-10-07", "14:00")), recorded_keys: new Set(), first_start: late({ kind: "intake", boundary }) });
    assert.equal(plan.action, "open");
    if (plan.action !== "open") return;
    assert.equal(plan.period.started_at.toISOString(), ny("2026-10-07", "14:00"));
    assert.equal(plan.period.start_kind, "activation", "never intake: no arrival clock, no retroactive days");
    assert.equal(plan.period.time_basis, "accepted_observation_captured_at");
  });

  test("a late first period never starts before the boundary", () => {
    const plan = planPeriodTransition({ active: null, desired: observed("2026-10-01T09:00:00Z"), recorded_keys: new Set(), first_start: late() });
    assert.ok(plan.action === "open");
    if (plan.action !== "open") return;
    assert.equal(+plan.period.started_at, +first.boundary);
    assert.equal(plan.period.start_kind, "activation");
    assert.equal(plan.period.time_basis, "activation_boundary", "the boundary is the recorded basis when it wins");
  });

  test("after an admission hold the late first period starts at the sync instant (desk_decision_at)", () => {
    const plan = planPeriodTransition({ active: null, desired: observed("2026-10-06T09:00:00Z"), recorded_keys: new Set(), first_start: late({ held_before: true }) });
    assert.ok(plan.action === "open");
    if (plan.action !== "open") return;
    assert.equal(+plan.period.started_at, +at("2026-10-08T16:00:00Z"));
    assert.equal(plan.period.start_kind, "activation");
    assert.equal(plan.period.time_basis, "desk_decision_at");
  });

  test("a transition never starts before the active period", () => {
    const plan = planPeriodTransition({
      active: { id: "p1", workflow: "new", priority: "0", started_at: at("2026-10-05T12:00:00Z") },
      desired: desired("quoted", "k", "2026-10-01T09:00:00Z"),
      recorded_keys: new Set(),
      first_start: first,
    });
    assert.equal(plan.action, "close_and_open");
    if (plan.action !== "close_and_open") return;
    assert.equal(+plan.period.started_at, +at("2026-10-05T12:00:00Z"));
    assert.equal(plan.period.start_kind, "transition");
  });

  test("no desired period retains the last verified one; a recorded key is a replay", () => {
    const active = { id: "p1", workflow: "quoted" as const, priority: "1", started_at: at("2026-10-05T12:00:00Z") };
    assert.deepEqual(planPeriodTransition({ active, desired: null, recorded_keys: new Set(), first_start: first }), { action: "none", reason: "retain_last_verified" });
    assert.deepEqual(planPeriodTransition({ active, desired: desired("new", "seen"), recorded_keys: new Set(["seen"]), first_start: first }), {
      action: "none",
      reason: "transition_already_recorded",
    });
  });
});

describe("olr B1 late first period — engine view (start_kind activation, no engine change)", () => {
  // Received Mon 10:00 New York (Day 1); the subject was enrolled at received (intake boundary) but its
  // priority was accepted only on Wed 14:00, so its first period is a late `activation` start.
  const MON = "2026-10-05";
  const TUE = "2026-10-06";
  const WED = "2026-10-07";
  const THU = "2026-10-08";
  const late = (workflow: "new" | "quoted", events: ReturnType<typeof outbound>[] = []) =>
    scenario({
      received_at: ny(MON, "10:00"),
      activation_at: ny(MON, "10:00"),
      periods: [period("p1", workflow, ny(WED, "14:00"), "activation")],
      events,
    });

  test("late first period, Day N partial start: nothing owed before the start, P05f partial day, then the full schedule", () => {
    const r = evaluate(late("new", [outbound(ny(WED, "11:00"))]), ny(THU, "21:00"));
    assert.equal(r.obligations.filter((o) => o.business_date === MON || o.business_date === TUE).length, 0, "no Mon/Tue obligations");
    assert.equal(r.obligations.filter((o) => Date.parse(o.due_at ?? o.opens_at) < Date.parse(ny(WED, "14:00"))).length, 0, "no miss dated before the start");
    assert.equal(r.obligations.filter((o) => o.kind === "initial_response").length, 0);
    assert.equal(r.initial_response, null, "no initial-response clock");
    // Wed = Day 3: band of 2 minus the 11:00 call before the start = 1 call (cap 2 before 18:00), due 20:00.
    const wedCalls = obligationsOn(r, WED, "call");
    assert.equal(wedCalls.length, 1);
    assert.equal(wedCalls[0]!.opens_at, ny(WED, "14:00"));
    assert.equal(wedCalls[0]!.due_at, ny(WED, "20:00"));
    // Day 3 is a fixed SMS day and the start is before 19:30: one SMS due 20:00.
    const wedSms = obligationsOn(r, WED, "sms");
    assert.equal(wedSms.length, 1);
    assert.equal(wedSms[0]!.due_at, ny(WED, "20:00"));
    // Thu = Day 4: the full schedule, two calls by 12:00 / 20:00, no SMS.
    assert.deepEqual(obligationsOn(r, THU, "call").map((o) => o.due_at), [ny(THU, "12:00"), ny(THU, "20:00")]);
    assert.equal(obligationsOn(r, THU, "sms").length, 0);
    assert.equal(r.schedule_day, 4, "original received-date age");
  });

  test("the same period as an intake start (the old behaviour) would owe Mon–Wed retroactively", () => {
    // Guards the reason for B1: an intake start reaches back to received with an initial response.
    const wrong = scenario({ received_at: ny(MON, "10:00"), activation_at: ny(MON, "10:00"), periods: [period("p1", "new", ny(MON, "10:00"), "intake")] });
    const r = evaluate(wrong, ny(WED, "15:00"));
    assert.ok(obligationsOn(r, MON, "call").length > 0);
    assert.ok(r.initial_response !== null);
  });

  test("late first Quoted period: first required date is the next working date after acceptance, no miss before it", () => {
    const r = evaluate(late("quoted"), ny(THU, "21:00"));
    const calls = r.obligations.filter((o) => o.channel === "call");
    assert.ok(calls.length > 0);
    assert.equal(calls.filter((o) => o.business_date <= WED).length, 0, "nothing on or before the acceptance date");
    assert.equal(obligationsOn(r, THU, "call").length, 1, "Thu (next working date) carries the Quoted call");
    assert.equal(r.initial_response, null);
    // A plan selected before acceptance does not reach back either.
    const withPlan = evaluate({ ...late("quoted"), human_plans: [quotedPlan("plan", "p1", THU, ny(WED, "15:00"))] }, ny(THU, "21:00"));
    assert.equal(withPlan.obligations.filter((o) => o.channel === "call" && o.business_date <= WED).length, 0);
  });
});
