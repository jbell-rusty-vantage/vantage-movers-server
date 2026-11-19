import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { goalCreditAgent, isCadenceQualifying } from "../engine/credit";
import { deriveCallContactEvent, toEngineContactEvent, type ContactEventDraft } from "./derive";
import { evaluate, obligationsOn, period, scenario } from "../engine/testSupport";
import { countRepDay, type RepDayCounts } from "./repDay";
import { ContextBuilder, inboundCall, leg, newId, outboundCall, party, subjectFacts } from "./testing";

/** The headline counts of the row's scope (olr C1b adds both scopes' counts; repDay.test.ts covers them). */
const headline = ({ actual_confirmed, actual_awaiting_confirmation, unattributed }: RepDayCounts) => ({ actual_confirmed, actual_awaiting_confirmation, unattributed });

/**
 * SRV-6 contact-event derivation: P07a–P07g fixtures and the lane cases (transfer legs, duplicate legs,
 * monitoring, merged/purged rows, internal calls, too-close retries, restricted contact, provisional →
 * confirmed, New York midnight). Goal credit is read through the stored `goal_credit` (M1 all-outbound)
 * and the S2 helpers; cadence qualification through S2's `isCadenceQualifying` (spacing is the
 * evaluator's, checked with `selectSpacedStarts`).
 */

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(path.join(process.cwd(), "src/services/salesOutreach/testSupport/contracts/fixtures", name), "utf8")) as T;

const ALICE = newId();
const BOB = newId();
const NUMBER = newId();
const T0 = "2026-10-05T14:00:00.000Z";

function deskWithLead(workflow: "new" | "quoted" | "discretion" = "new") {
  const ctx = new ContextBuilder().link(ALICE, "101").link(BOB, "102");
  const lead = ctx.lead(NUMBER, subjectFacts({ workflow }));
  return { ctx, subject: lead.subject! };
}

const engine = (draft: ContactEventDraft) => toEngineContactEvent(draft);
const goalCredit = (draft: ContactEventDraft) => (draft.goal_credit === "confirmed" ? 1 : 0);
const cadenceCredit = (draft: ContactEventDraft) => (isCadenceQualifying(engine(draft)) ? 1 : 0);

describe("p07a call credit", () => {
  const cases = fixture<{ cases: Array<{ id: string; goal_credit: number; cadence_credit: number; spacing_eligible?: boolean }> }>("p07a-call-credit.json").cases;
  const { ctx } = deskWithLead();
  const context = ctx.build();
  const rows: Record<string, ReturnType<typeof outboundCall>> = {
    outbound_answered: outboundCall("101", NUMBER, T0),
    outbound_no_answer: outboundCall("101", NUMBER, T0, { provider_connected: false, provider_result: "No Answer", legs: [leg("101", T0, { result: "No Answer" })] }),
    outbound_busy: outboundCall("101", NUMBER, T0, { provider_connected: false, provider_result: "Busy", legs: [leg("101", T0, { result: "Busy" })] }),
    outbound_voicemail: outboundCall("101", NUMBER, T0, { provider_result: "Voicemail", contact_type: "voicemail" }),
    verified_failed_connection: outboundCall("101", NUMBER, T0, { provider_connected: false, provider_result: "Call Failure", legs: [leg("101", T0, { result: "Call Failure" })] }),
    answered_inbound: inboundCall("101", NUMBER, T0),
    missed_inbound: inboundCall(null, NUMBER, T0),
    api_error_without_attempt: outboundCall("101", NUMBER, T0, { provider_connected: false, provider_result: "Internal Error", legs: [leg("101", T0, { result: "Internal Error" })] }),
    // A button press with no dialed call never reaches the Call Log: webhook only, never credit.
    button_press_only: outboundCall("101", NUMBER, T0, { call_log_state: null, legs: [], provider_connected: false, provider_result: null }),
    duplicate_receipt: outboundCall("101", NUMBER, T0, { merged_into_id: newId() }),
    internal_call: outboundCall("101", null, T0, { direction: "Internal", external_endpoint_kind: "extension" }),
    in_progress: outboundCall("101", NUMBER, T0, { terminal: false, call_log_state: "provisional" }),
  };
  for (const c of cases) {
    if (c.id === "too_close_outbound") continue;
    test(c.id, () => {
      const draft = deriveCallContactEvent(rows[c.id]!, context);
      assert.equal(goalCredit(draft), c.goal_credit, "goal credit");
      assert.equal(cadenceCredit(draft), c.cadence_credit, "cadence-qualifying");
      // S2's helper agrees for an associated subject event.
      if (draft.subject_id) assert.equal(goalCreditAgent(engine(draft)) ? 1 : 0, c.goal_credit);
      if (c.id === "answered_inbound") {
        assert.deepEqual([draft.kind, draft.actor_agent_id, draft.goal_agent_id], ["inbound_answered", ALICE, null]);
      }
    });
  }
});

describe("p07b outbound attribution (initiator rule)", () => {
  const fx = fixture<{ cases: Array<{ id: string; goal_credits: Record<string, number>; eligible_cadence_credit: number; pending_verification?: boolean }> }>("p07b-outbound-attribution.json");
  const byId = new Map(fx.cases.map((c) => [c.id, c]));
  deskWithLead();
  const credits = (draft: ContactEventDraft) => (draft.goal_credit === "confirmed" && draft.goal_scope_eligible ? { [draft.goal_agent_id === ALICE ? "alice" : "bob"]: 1 } : {});
  test("ambiguous_lead: two attached Leads are pending association; no eligible-scope credit (M2), still all-outbound (M1)", () => {
    const two = new ContextBuilder().link(ALICE, "101");
    two.lead(NUMBER);
    two.lead(NUMBER);
    const draft = deriveCallContactEvent(outboundCall("101", NUMBER, T0), two.build());
    assert.equal(draft.verification, "pending_association");
    assert.equal(draft.subject_id, null);
    assert.equal(cadenceCredit(draft), byId.get("ambiguous_lead")!.eligible_cadence_credit);
    assert.deepEqual(credits(draft), byId.get("ambiguous_lead")!.goal_credits, "P07b: no eligible-scope goal credit");
    assert.deepEqual(headline(countRepDay([draft], "eligible_new_quoted")), { actual_confirmed: 0, actual_awaiting_confirmation: 0, unattributed: 1 });
    assert.equal(countRepDay([draft], "all_outbound").actual_confirmed, 1, "FAST-TRACK M1 counts every verified outbound attempt");
    const both = countRepDay([draft], "eligible_new_quoted");
    assert.deepEqual([both.actual_confirmed_all, both.actual_confirmed_eligible], [1, 0], "olr C1b: the all-outbound count is kept on an eligible-scope row");
  });
});

describe("p07c inbound handling", () => {
  const fx = fixture<{ cases: Array<{ id: string; applicable_cadence_credit: number; goal_credits: Record<string, number> }> }>("p07c-inbound-helping.json");
  const byId = new Map(fx.cases.map((c) => [c.id, c]));
  const { ctx } = deskWithLead();
  const context = ctx.build();
  const check = (id: string, draft: ContactEventDraft) => {
    assert.equal(cadenceCredit(draft), byId.get(id)!.applicable_cadence_credit, `${id} cadence`);
    assert.equal(draft.goal_credit, "none", `${id}: inbound never earns outbound-goal credit`);
  };
  test("bob_transfers_to_alice: the first reviewed handler holds the one event", () => {
    const row = inboundCall("102", NUMBER, T0, T0, {
      parties: [
        party("102", { direction: "Inbound", connected: true, answered_at: new Date(T0) }),
        party("101", { direction: "Inbound", connected: true, answered_at: new Date("2026-10-05T14:04:00.000Z") }),
      ],
    });
    const draft = deriveCallContactEvent(row, context);
    check("bob_transfers_to_alice", draft);
    assert.equal(draft.actor_agent_id, BOB);
  });
  test("p07g originating_answered_inbound: the answered inbound that created the Call Lead is marked (zero goal credit)", () => {
    const row = inboundCall("101", NUMBER, T0);
    const own = new ContextBuilder().link(ALICE, "101");
    own.lead(NUMBER, subjectFacts({ originating_session_id: row.telephony_session_id }));
    const draft = deriveCallContactEvent(row, own.build());
    assert.equal(draft.originating_inbound, true);
    assert.equal(draft.goal_credit, "none");
    assert.equal(deriveCallContactEvent(inboundCall("101", NUMBER, T0), own.build()).originating_inbound, false, "another session is not the originating call");
    assert.equal(deriveCallContactEvent({ ...row, call_log_state: null }, own.build()).originating_inbound, false, "awaiting confirmation is not yet the originating inbound");
    assert.equal(deriveCallContactEvent(inboundCall(null, NUMBER, T0, null, { telephony_session_id: row.telephony_session_id }), own.build()).originating_inbound, false, "a missed call is not");
  });
  test("ambiguous_rep", () => check("ambiguous_rep", deriveCallContactEvent(inboundCall("199", NUMBER, T0), context)));
  test("ambiguous_lead", () => {
    const two = new ContextBuilder().link(ALICE, "101");
    two.lead(NUMBER);
    two.lead(NUMBER);
    check("ambiguous_lead", deriveCallContactEvent(inboundCall("101", NUMBER, T0), two.build()));
  });
});

describe("lane cases: exclusions and verification", () => {
  const { ctx } = deskWithLead();
  const context = ctx.build();
  test("IMPL-06 provisional → confirmed: webhook-only is awaiting confirmation (never credit, never a miss), Call Log settles it", () => {
    const webhookOnly = outboundCall("101", NUMBER, T0, { call_log_state: null, terminal: true, legs: [] });
    const awaiting = deriveCallContactEvent(webhookOnly, context);
    assert.equal(awaiting.verification, "awaiting_confirmation");
    assert.equal(awaiting.goal_credit, "awaiting_confirmation");
    assert.equal(awaiting.goal_agent_id, ALICE, "the webhook party still names the rep for the awaiting count");
    assert.deepEqual(headline(countRepDay([awaiting], "all_outbound")), { actual_confirmed: 0, actual_awaiting_confirmation: 1, unattributed: 0 });
    const confirmed = deriveCallContactEvent({ ...webhookOnly, call_log_state: "settled", legs: [leg("101", T0)], projection_revision: 5 }, context);
    assert.equal(confirmed.verification, "confirmed");
    assert.notEqual(confirmed.input_fingerprint, awaiting.input_fingerprint);
    assert.deepEqual(headline(countRepDay([confirmed], "all_outbound")), { actual_confirmed: 1, actual_awaiting_confirmation: 0, unattributed: 0 });
  });
  test("identity is effective-dated: a link reviewed after the call does not credit it", () => {
    const later = new ContextBuilder().link(ALICE, "101", { effective_from: new Date("2026-10-06T00:00:00Z") });
    later.lead(NUMBER);
    assert.equal(deriveCallContactEvent(outboundCall("101", NUMBER, T0), later.build()).verification, "pending_identity");
  });
  test("a re-derivation of the same inputs gives the same fingerprint", () => {
    const row = outboundCall("101", NUMBER, T0);
    assert.equal(deriveCallContactEvent(row, context).input_fingerprint, deriveCallContactEvent(row, context).input_fingerprint);
  });
});

describe("P05f/P10a same-date prior contact (olr C4): carried for the activation date's subtraction, never credited", () => {
  // Activation at 15:00 ET (19:00Z) on 2026-10-05; the Lead was received 2026-10-01 (an older cohort Lead).
  const ACTIVATION = "2026-10-05T19:00:00.000Z";
  const lateEnrolled = () => {
    const ctx = new ContextBuilder().link(ALICE, "101");
    const lead = ctx.lead(NUMBER, subjectFacts({ activation_at: new Date(ACTIVATION) }));
    return { context: ctx.build(), subject: lead.subject! };
  };

  test("end to end: the evaluator subtracts the carried calls from the activation date's quota", () => {
    const { context } = lateEnrolled();
    const prior = ["2026-10-05T14:00:00.000Z", "2026-10-05T15:00:00.000Z"].map((at) => engine(deriveCallContactEvent(outboundCall("101", NUMBER, at), context)));
    const input = (events: ReturnType<typeof engine>[]) =>
      scenario({ received_at: "2026-10-01T14:00:00.000Z", activation_at: ACTIVATION, periods: [period("n1", "new", ACTIVATION, "activation")], events });
    const asOf = "2026-10-05T19:01:00.000Z";
    const without = obligationsOn(evaluate(input([]), asOf), "2026-10-05", "call").length;
    const withPrior = obligationsOn(evaluate(input(prior), asOf), "2026-10-05", "call").length;
    assert.equal(without, 2, "the 15:00 partial start date owes two calls without earlier contact");
    assert.equal(withPrior, 0, "two spaced earlier same-date calls lower the quota by two");
    assert.equal(obligationsOn(evaluate(input(prior.slice(0, 1)), asOf), "2026-10-05", "call").length, 1, "one earlier call lowers it by one");
  });
});

describe("olr C2d evidence.call_association_rule: single_active_subject_on_link (D-C2d; off by default)", () => {
  const CLOSED_PERIODS = [
    { workflow: "new" as const, started_at: new Date("2026-09-01T12:00:00Z"), ended_at: new Date("2026-10-01T00:00:00Z") },
    { workflow: "closed" as const, started_at: new Date("2026-10-01T00:00:00Z"), ended_at: null },
  ];
  /** The number's `lead` (null subject = not enrolled), plus one `other_leads` entry per given subject. */
  const shadowed = (numberLead: ReturnType<typeof subjectFacts> | null, others: Array<ReturnType<typeof subjectFacts> | null>, rule?: "number_lead" | "single_active_subject_on_link") => {
    const ctx = new ContextBuilder().link(ALICE, "101").associationRule(rule);
    ctx.lead(NUMBER, numberLead);
    const shadows = others.map((subject) => ctx.other(NUMBER, subject).subject);
    return { context: ctx.build(), shadows };
  };
  const RULE = "single_active_subject_on_link" as const;

  test("the number's Lead closed: the only active other_leads subject is credited (inbound too, cadence only)", () => {
    const { context, shadows } = shadowed(subjectFacts({ periods: CLOSED_PERIODS }), [subjectFacts({ workflow: "quoted" })], RULE);
    const outbound = deriveCallContactEvent(outboundCall("101", NUMBER, T0), context);
    assert.deepEqual([outbound.association, outbound.subject_id, outbound.subject_workflow], ["unique", shadows[0]!.id, "quoted"]);
    const inbound = deriveCallContactEvent(inboundCall("101", NUMBER, T0), context);
    assert.deepEqual([inbound.association, inbound.subject_id, inbound.goal_credit], ["unique", shadows[0]!.id, "none"]);
  });

  test("two active other_leads subjects are ambiguous: no credit is guessed (P05h)", () => {
    const { context } = shadowed(null, [subjectFacts(), subjectFacts({ workflow: "quoted" })], RULE);
    const draft = deriveCallContactEvent(outboundCall("101", NUMBER, T0), context);
    assert.deepEqual([draft.association, draft.subject_id, draft.association_reason, draft.goal_scope_eligible], ["ambiguous", null, "ambiguous", false]);
  });

  test("review fix: same New York date, number Lead activated after the call: the active shadow is credited over the P05f same-date marker", () => {
    const numberLead = subjectFacts({ activation_at: new Date("2026-10-05T18:00:00Z") });
    const shadow = subjectFacts({ workflow: "quoted" });
    const row = outboundCall("101", NUMBER, T0);
    const credited = deriveCallContactEvent(row, shadowed(numberLead, [shadow], RULE).context);
    assert.deepEqual([credited.association, credited.subject_id, credited.association_reason], ["unique", shadow.id, "eligible"]);
    // Without an active shadow (or with the rule off) the P05f same-date prior marker is kept as before.
    for (const context of [shadowed(numberLead, [], RULE).context, shadowed(numberLead, [shadow]).context]) {
      const marker = deriveCallContactEvent(row, context);
      assert.deepEqual([marker.association, marker.association_reason, marker.subject_id], ["none", "before_activation", numberLead.id]);
    }
  });
});
