import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evaluateSubject } from "../engine";
import { evaluate, fixture, ny, obligationsOn, outbound, period, policyWith, quotedPlan, scenario } from "../engine/testSupport";
import { refreshLeadForOutreach } from "./leadChangeJob";
import { resolveDeskPolicy } from "./policyMapping";
import { accepted, deskConfiguration, fakeSession, leadFacts, MemoryDeskSubjectStore } from "./testing";

const GATE = "2026-10-01T00:00:00.000Z";
const intakeOn = () => deskConfiguration({ transition: { intake_admission_enabled: true, intake_admission_at: GATE } });
const at = (iso: string) => new Date(iso);
const mapping = deskConfiguration().value.cadence;

/** Enroll a fresh Lead through intake, then apply each later Lead state as an `outreach_lead_change`. */
async function lifecycle(states: Array<Partial<ReturnType<typeof leadFacts>>>, start = leadFacts(), config = intakeOn()) {
  const store = new MemoryDeskSubjectStore();
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
});

describe("P05b/P05c S1 parts: unvouched codes and closed subjects (fixtures p05b, p05c)", () => {
  for (const file of ["p05b-priority-three.json", "p05c-unmapped-priority.json"] as const) {
    const code = file.startsWith("p05b") ? "3" : "42";
    const workflow = code === "3" ? "daily" : "none";
    test(`${file.slice(0, 4)}: an accepted ${code} opens a ${workflow} period and the lead stays open`, async () => {
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
      // accepted_three is one call a day. accepted_unmapped stays none, with no routine cadence.
      const code = c.id === "accepted_three" ? "3" : "42";
      const { store } = await lifecycle([], leadFacts({ ...accepted(code, "2026-10-01T14:01:00Z") }));
      assert.equal(store.periods[0]!.workflow, code === "3" ? "daily" : "none");
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
      if (code === "3") {
        assert.equal(r.state, "active");
        assert.ok(r.obligations.some((obligation) => obligation.kind === "ordinary" && obligation.channel === "call"));
        assert.ok(r.obligations.every((obligation) => obligation.kind !== "quoted"));
        return;
      }
      assert.equal(r.obligations.length, 0, c.label);
    });
  }

  test("granot_created: new (olr B3) → intake_default New at received; later accepted 0 is a no-op; 1 is a transition", async () => {
    const granotNew = deskConfiguration({
      transition: { intake_admission_enabled: true, intake_admission_at: GATE },
      cadence: { intake_default_rule: { ...mapping.intake_default_rule!, granot_created: "new" } },
    });
    const received = "2026-10-01T14:00:00Z";
    const facts = leadFacts({ ingestion_origin: "granot_lead_created", timestamp: at(received) });
    assert.deepEqual(resolveDeskPolicy(facts, granotNew.value.cadence), { kind: "intake_default", workflow: "new", source: "granot_created" });
    const { store, results } = await lifecycle(
      [{ ...accepted("0", "2026-10-02T15:00:00Z") }, { ...accepted("1", "2026-10-03T15:30:00Z") }],
      facts,
      granotNew,
    );
    const [first, quoted] = store.periods;
    // Identical to native intake: New at received with the initial-response clock, no review reason.
    assert.deepEqual(
      [first!.workflow, first!.start_kind, first!.time_basis, first!.priority, first!.transition_key],
      ["new", "intake", "activation_boundary", null, "intake_default:granot_created"],
    );
    assert.equal(+first!.started_at, +at(received));
    assert.equal(results[0]!.outcome, "created");
    // Granot's later Priority 0 means the same New: nothing restarts, only the priority basis changes.
    assert.equal(results[1]!.reason, "repeated_priority");
    // Priority 1 moves the subject to Quoted at the observation time.
    assert.equal(store.periods.length, 2);
    assert.deepEqual([quoted!.workflow, quoted!.start_kind, quoted!.priority], ["quoted", "transition", "1"]);
    assert.equal(+quoted!.started_at, +at("2026-10-03T15:30:00Z"));
    assert.equal(+first!.ended_at!, +at("2026-10-03T15:30:00Z"));
    assert.deepEqual([store.subjects[0]!.status, store.subjects[0]!.review_reasons], ["active", []]);
    assert.deepEqual([store.subjects[0]!.priority.raw, store.subjects[0]!.priority.basis], ["1", "accepted_observation"]);
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

test("accepted New → daily 2 ↔ 3 → unmapped → Quoted → closed preserves boundaries and never reopens", async () => {
  const { store } = await lifecycle([
    { ...accepted("2", "2026-10-02T14:00:00Z") },
    { ...accepted("3", "2026-10-03T14:00:00Z") },
    { ...accepted("2", "2026-10-04T14:00:00Z") },
    { ...accepted("4", "2026-10-05T14:00:00Z") },
    { ...accepted("1", "2026-10-06T14:00:00Z") },
    { ...accepted("8", "2026-10-07T14:00:00Z") },
    { ...accepted("0", "2026-10-08T14:00:00Z") },
  ], leadFacts({ ...accepted("0", "2026-10-01T14:01:00Z") }));
  assert.deepEqual(store.periods.map((p) => p.workflow), ["new", "daily", "none", "quoted", "closed"]);
  assert.equal(store.periods[1]!.started_at.toISOString(), "2026-10-02T14:00:00.000Z", "2↔3 does not restart the daily period");
  for (let i = 0; i < store.periods.length - 1; i++) assert.equal(+store.periods[i]!.ended_at!, +store.periods[i + 1]!.started_at);
  assert.equal(store.subjects[0]!.status, "closed");
});

test("cadence current-state boundary: both 0-5-0 interleavings retain irreversible closure", async () => {
  for (const consumeMiddle of [false, true]) {
    const store = new MemoryDeskSubjectStore(), config = intakeOn();
    let facts = store.addLead(leadFacts({ ...accepted('0', '2026-10-01T14:01:00Z') }));
    const refresh = () => refreshLeadForOutreach(facts.ref, config, at('2026-10-01T16:00:00Z'), store, fakeSession);
    await refresh(); const original = structuredClone(store.periods[0]!);
    facts = store.addLead({ ...facts, ...accepted('5', '2026-10-01T15:00:00Z'), domain_revision: 2 });
    if (consumeMiddle) await refresh();
    facts = store.addLead({ ...facts, ...accepted('0', '2026-10-01T15:01:00Z'), domain_revision: 3 });
    await refresh();
    assert.equal(store.subjects[0]!.status, consumeMiddle ? 'closed' : 'active');
    assert.equal(store.subjects[0]!.priority.raw, '0');
    if (!consumeMiddle) assert.deepEqual(store.periods, [original]);
    else assert.equal(store.periods.filter(p => p.workflow === 'new').length, 1);
  }
});

test("hourly same-value and 2-3 observations preserve periods and contact nominations", async () => {
  const store = new MemoryDeskSubjectStore(), config = intakeOn();
  let facts = store.addLead(leadFacts({ ...accepted('2', '2026-10-01T14:01:00Z') }));
  await refreshLeadForOutreach(facts.ref, config, at('2026-10-01T15:00:00Z'), store, fakeSession);
  const periods = structuredClone(store.periods), wakes = store.contactWakes.length;
  for (const [index, priority] of ['2', '3', '2', '2'].entries()) {
    facts = store.addLead({ ...facts, ...accepted(priority, `2026-10-01T${16 + index}:00:00Z`) });
    await refreshLeadForOutreach(facts.ref, config, at(`2026-10-01T${16 + index}:01:00Z`), store, fakeSession);
    assert.deepEqual(store.periods, periods);
    assert.equal(store.contactWakes.length, wakes);
  }
});
