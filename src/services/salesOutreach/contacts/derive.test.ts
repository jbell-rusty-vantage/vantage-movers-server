import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { goalCreditAgent, isCadenceQualifying, selectSpacedStarts } from "../engine/credit";
import { contactEventId, deriveCallContactEvent, outboundInitiator, toEngineContactEvent, type ContactEventDraft } from "./derive";
import { evaluate, obligationsOn, period, scenario } from "../engine/testSupport";
import { countRepDay, type RepDayCounts } from "./repDay";

/** The headline counts of the row's scope (olr C1b adds both scopes' counts; repDay.test.ts covers them). */
const headline = ({ actual_confirmed, actual_awaiting_confirmation, unattributed }: RepDayCounts) => ({ actual_confirmed, actual_awaiting_confirmation, unattributed });
import { ContextBuilder, inboundCall, leg, newId, outboundCall, party, subjectFacts } from "./testing";

/**
 * SRV-6 contact-event derivation: P07a–P07g fixtures and the lane cases (transfer legs, duplicate legs,
 * monitoring, merged/purged rows, internal calls, too-close retries, restricted contact, provisional →
 * confirmed, New York midnight). Goal credit is read through the stored `goal_credit` (M1 all-outbound)
 * and the S2 helpers; cadence qualification through S2's `isCadenceQualifying` (spacing is the
 * evaluator's, checked with `selectSpacedStarts`).
 */

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(path.join(process.cwd(), "docs/sales-outreach-desk/contracts/fixtures", name), "utf8")) as T;

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
    });
  }
  test("too_close_outbound: a retry 20 minutes later earns goal credit but no further cadence credit (spacing 60)", () => {
    const first = deriveCallContactEvent(outboundCall("101", NUMBER, T0), context);
    const retry = deriveCallContactEvent(outboundCall("101", NUMBER, "2026-10-05T14:20:00.000Z"), context);
    assert.equal(countRepDay([first, retry], "all_outbound").actual_confirmed, 2, "both actual attempts count toward the goal");
    assert.deepEqual(selectSpacedStarts([first.event_at.getTime(), retry.event_at.getTime()], 60), [0], "only the spaced start is cadence-credited");
    assert.equal(cadenceCredit(retry), 1, "the retry is still a qualifying event; the evaluator's spacing withholds the credit");
  });
  test("answered_inbound: reviewed handler, zero goal credit", () => {
    const draft = deriveCallContactEvent(rows.answered_inbound!, context);
    assert.equal(draft.kind, "inbound_answered");
    assert.equal(draft.actor_agent_id, ALICE);
    assert.equal(draft.goal_agent_id, null);
  });
});

describe("p07b outbound attribution (initiator rule)", () => {
  const fx = fixture<{ cases: Array<{ id: string; goal_credits: Record<string, number>; eligible_cadence_credit: number; pending_verification?: boolean }> }>("p07b-outbound-attribution.json");
  const byId = new Map(fx.cases.map((c) => [c.id, c]));
  const { ctx, subject } = deskWithLead();
  const context = ctx.build();
  const credits = (draft: ContactEventDraft) => (draft.goal_credit === "confirmed" && draft.goal_scope_eligible ? { [draft.goal_agent_id === ALICE ? "alice" : "bob"]: 1 } : {});
  const complete = (credit: Record<string, number>) => ({ alice: credit.alice ?? 0, bob: credit.bob ?? 0 });

  test("bob_helps_alice: the helper who dials earns the goal credit, the assigned rep none", () => {
    const draft = deriveCallContactEvent(outboundCall("102", NUMBER, T0), context);
    assert.deepEqual(complete(credits(draft)), byId.get("bob_helps_alice")!.goal_credits);
    assert.equal(cadenceCredit(draft), byId.get("bob_helps_alice")!.eligible_cadence_credit);
    assert.equal(draft.subject_id, subject.id);
  });
  test("alice_transfers_to_bob: the transfer leg earns nothing; the initiator keeps the one credit", () => {
    const row = outboundCall("101", NUMBER, T0, {
      parties: [party("101"), party("102", { direction: "Inbound", connected: true })],
      legs: [leg("101", T0), leg("102", "2026-10-05T14:03:00.000Z", { leg_type: "Transfer" })],
    });
    const draft = deriveCallContactEvent(row, context);
    assert.deepEqual(complete(credits(draft)), byId.get("alice_transfers_to_bob")!.goal_credits);
    assert.equal(cadenceCredit(draft), 1);
  });
  test("duplicate_transfer_legs: repeated legs of one call stay one credit", () => {
    const row = outboundCall("101", NUMBER, T0, {
      legs: [leg("101", T0), leg("101", T0, { leg_type: "PstnToSip" }), leg("102", "2026-10-05T14:03:00.000Z"), leg("102", "2026-10-05T14:03:00.000Z")],
    });
    const draft = deriveCallContactEvent(row, context);
    assert.deepEqual(complete(credits(draft)), byId.get("duplicate_transfer_legs")!.goal_credits);
    assert.equal(contactEventId("call", row.id), contactEventId("call", row.id), "one deterministic event per call");
  });
  test("ambiguous_identity: an unreviewed initiator is pending identity, no credit", () => {
    const draft = deriveCallContactEvent(outboundCall("199", NUMBER, T0), context);
    assert.equal(draft.verification, "pending_identity");
    assert.equal(draft.goal_credit, "none");
    assert.equal(cadenceCredit(draft), 0);
    assert.equal(byId.get("ambiguous_identity")!.pending_verification, true);
  });
  test("ambiguous identity also when two extensions start the call at the same instant", () => {
    const row = outboundCall("101", NUMBER, T0, { legs: [leg("101", T0), leg("102", T0)] });
    assert.deepEqual(outboundInitiator(row), { extension_id: null, ambiguous: true });
    assert.equal(deriveCallContactEvent(row, context).verification, "pending_identity");
  });
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
  test("bob_answers_alices_lead", () => {
    const draft = deriveCallContactEvent(inboundCall("102", NUMBER, T0), context);
    check("bob_answers_alices_lead", draft);
    assert.equal(draft.actor_agent_id, BOB);
  });
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
  test("duplicate_inbound_legs", () => {
    const row = inboundCall("101", NUMBER, T0, T0, { legs: [leg("101", T0, { direction: "Inbound" }), leg("101", T0, { direction: "Inbound" })] });
    check("duplicate_inbound_legs", deriveCallContactEvent(row, context));
  });
  test("missed_inbound: history only", () => {
    const draft = deriveCallContactEvent(inboundCall(null, NUMBER, T0), context);
    check("missed_inbound", draft);
    assert.equal(draft.kind, "inbound_missed");
    assert.equal(draft.outcome, "unanswered");
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
  test("P06b outcome on every call event: answered / unanswered / unknown", () => {
    assert.equal(deriveCallContactEvent(outboundCall("101", NUMBER, T0), context).outcome, "answered");
    assert.equal(deriveCallContactEvent(outboundCall("101", NUMBER, T0, { provider_connected: false, provider_result: "No Answer" }), context).outcome, "unanswered");
    assert.equal(deriveCallContactEvent(outboundCall("101", NUMBER, T0, { provider_result: "Voicemail", contact_type: "voicemail" }), context).outcome, "unanswered");
    assert.equal(deriveCallContactEvent(outboundCall("101", NUMBER, T0, { call_log_state: null, legs: [] }), context).outcome, "unknown");
    assert.equal(deriveCallContactEvent(outboundCall("101", NUMBER, T0, { merged_into_id: newId() }), context).outcome, "unknown");
    assert.equal(deriveCallContactEvent(inboundCall("101", NUMBER, T0), context).outcome, "answered");
  });
  test("ambiguous_rep", () => check("ambiguous_rep", deriveCallContactEvent(inboundCall("199", NUMBER, T0), context)));
  test("ambiguous_lead", () => {
    const two = new ContextBuilder().link(ALICE, "101");
    two.lead(NUMBER);
    two.lead(NUMBER);
    check("ambiguous_lead", deriveCallContactEvent(inboundCall("101", NUMBER, T0), two.build()));
  });
});

describe("p07g event-time windows", () => {
  const { ctx } = deskWithLead();
  const context = ctx.build();
  test("midnight_cross: a call crossing New York midnight belongs to its start date", () => {
    const fx = fixture<{ cases: Array<{ id: string; start_at?: string; goal_date?: string; goal_credit?: number }> }>("p07g-event-time-windows.json");
    const c = fx.cases.find((x) => x.id === "midnight_cross")!;
    const draft = deriveCallContactEvent(outboundCall("101", NUMBER, new Date(c.start_at!).toISOString(), { answered_at: new Date("2026-10-03T04:01:00Z") }), context);
    assert.equal(draft.business_date, c.goal_date);
    assert.equal(goalCredit(draft), c.goal_credit);
  });
  test("closing_cross: an outbound call is timed at its verified start, not its end", () => {
    const draft = deriveCallContactEvent(outboundCall("101", NUMBER, "2026-10-05T23:59:00.000Z"), context);
    assert.equal(draft.event_at.toISOString(), "2026-10-05T23:59:00.000Z");
  });
  test("answered inbound is timed when the reviewed rep answered", () => {
    const draft = deriveCallContactEvent(inboundCall("101", NUMBER, T0, "2026-10-05T14:00:40.000Z"), context);
    assert.equal(draft.event_at.toISOString(), "2026-10-05T14:00:40.000Z");
  });
  test("restricted_outbound: history retained, zero goal and cadence credit", () => {
    const restricted = new ContextBuilder().link(ALICE, "101");
    restricted.lead(NUMBER);
    restricted.restrict(NUMBER, ["call"], "2026-10-01T00:00:00Z");
    const draft = deriveCallContactEvent(outboundCall("101", NUMBER, T0), restricted.build());
    assert.equal(draft.restricted_at_contact, true);
    assert.equal(draft.kind, "outbound_attempt", "kept in history");
    assert.equal(draft.goal_credit, "none");
    assert.equal(cadenceCredit(draft), 0);
    // A text-only restriction does not touch calls; a lifted restriction no longer applies.
    const textOnly = new ContextBuilder().link(ALICE, "101");
    textOnly.lead(NUMBER);
    textOnly.restrict(NUMBER, ["text"], "2026-10-01T00:00:00Z").restrict(NUMBER, ["call"], "2026-10-01T00:00:00Z", "2026-10-04T00:00:00Z");
    assert.equal(deriveCallContactEvent(outboundCall("101", NUMBER, T0), textOnly.build()).goal_credit, "confirmed");
  });
});

describe("lane cases: exclusions and verification", () => {
  const { ctx, subject } = deskWithLead();
  const context = ctx.build();
  test("monitoring: the supervisor's monitoring leg is never the initiator; the call keeps its one credit", () => {
    const row = outboundCall("101", NUMBER, T0, {
      parties: [party("101"), party("102", { role: "monitoring" })],
      legs: [leg("102", "2026-10-05T13:59:59.000Z", { leg_type: "Monitoring" }), leg("101", T0)],
    });
    const draft = deriveCallContactEvent(row, context);
    assert.equal(draft.goal_agent_id, ALICE);
    assert.equal(draft.goal_credit, "confirmed");
  });
  test("merged and purged rows are excluded (the canonical row carries the call)", () => {
    assert.equal(deriveCallContactEvent(outboundCall("101", NUMBER, T0, { merged_into_id: newId() }), context).exclusion_reason, "merged_duplicate");
    assert.equal(deriveCallContactEvent(outboundCall("101", NUMBER, T0, { purged_at: new Date(T0) }), context).exclusion_reason, "purged");
  });
  test("internal: Internal direction, our own DID and non-external endpoints earn nothing", () => {
    for (const row of [
      outboundCall("101", null, T0, { direction: "Internal" }),
      outboundCall("101", NUMBER, T0, { external_endpoint_kind: "company_did" }),
      outboundCall("101", null, T0, { external_endpoint_kind: "service_code" }),
      outboundCall("101", null, T0, { external_endpoint_kind: "withheld" }),
    ]) {
      const draft = deriveCallContactEvent(row, context);
      assert.equal(draft.verification, "excluded");
      assert.equal(draft.goal_credit, "none");
    }
  });
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
  test("number_only (P05h): a number with no Lead is Other outbound, never eligible-scope credit", () => {
    const draft = deriveCallContactEvent(outboundCall("101", newId(), T0), context);
    assert.equal(draft.association, "none");
    assert.equal(draft.subject_id, null);
    assert.equal(draft.goal_credit, "confirmed");
    assert.equal(draft.goal_scope_eligible, false);
    assert.deepEqual(headline(countRepDay([draft], "eligible_new_quoted")), { actual_confirmed: 0, actual_awaiting_confirmation: 0, unattributed: 1 });
  });
  test("IMPL-07: a subject not yet activated, or closed, at contact time is not associated; discretion is not goal scope", () => {
    const early = new ContextBuilder().link(ALICE, "101");
    early.lead(NUMBER, subjectFacts({ activation_at: new Date("2026-10-05T15:00:00Z") }));
    assert.equal(deriveCallContactEvent(outboundCall("101", NUMBER, T0), early.build()).association, "none");
    const closed = new ContextBuilder().link(ALICE, "101");
    closed.lead(NUMBER, subjectFacts({ periods: [{ workflow: "new", started_at: new Date("2026-09-01T00:00:00Z"), ended_at: new Date("2026-10-01T00:00:00Z") }, { workflow: "closed", started_at: new Date("2026-10-01T00:00:00Z"), ended_at: null }] }));
    assert.equal(deriveCallContactEvent(outboundCall("101", NUMBER, T0), closed.build()).association, "none");
    const discretion = deskWithLead("discretion");
    const draft = deriveCallContactEvent(outboundCall("101", NUMBER, T0), discretion.ctx.build());
    assert.equal(draft.subject_id, discretion.subject.id);
    assert.equal(draft.subject_workflow, "discretion");
    assert.equal(draft.goal_scope_eligible, false);
  });
  test("an eligible New subject at contact time is goal scope; the event references the subject", () => {
    const draft = deriveCallContactEvent(outboundCall("101", NUMBER, T0), context);
    assert.equal(draft.subject_id, subject.id);
    assert.equal(draft.goal_scope_eligible, true);
    assert.equal(draft.outcome, "answered");
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

  test("an outbound call earlier on the activation date keeps `none` and its M1 credit, carries the subject, and is a confirmed attempt", () => {
    const { context, subject } = lateEnrolled();
    const draft = deriveCallContactEvent(outboundCall("101", NUMBER, "2026-10-05T14:00:00.000Z"), context);
    assert.deepEqual(
      [draft.association, draft.subject_id, draft.subject_workflow, draft.goal_scope_eligible, draft.goal_credit, draft.kind, draft.verification, draft.exclusion_reason],
      ["none", subject.id, null, false, "confirmed", "outbound_attempt", "confirmed", null],
    );
    assert.deepEqual(headline(countRepDay([draft], "eligible_new_quoted")), { actual_confirmed: 0, actual_awaiting_confirmation: 0, unattributed: 1 }, "still Other outbound");
    assert.deepEqual(headline(countRepDay([draft], "all_outbound")), { actual_confirmed: 1, actual_awaiting_confirmation: 0, unattributed: 1 }, "M1 unchanged");
  });

  test("an earlier New York date is not carried (00:30 ET the day after is not the same date either way)", () => {
    const { context } = lateEnrolled();
    // 23:59 ET on 2026-10-04 = 03:59Z on 2026-10-05 (the UTC date matches, the New York date does not).
    const draft = deriveCallContactEvent(outboundCall("101", NUMBER, "2026-10-05T03:59:00.000Z"), context);
    assert.deepEqual([draft.association, draft.subject_id, draft.verification, draft.exclusion_reason], ["none", null, "excluded", "no_associated_subject"]);
  });

  test("an answered inbound earlier on the activation date is carried for cadence only; never the originating inbound", () => {
    const ctx = new ContextBuilder().link(ALICE, "101");
    const session = "s-originating";
    const lead = ctx.lead(NUMBER, subjectFacts({ activation_at: new Date(ACTIVATION), originating_session_id: session }));
    const draft = deriveCallContactEvent(inboundCall("101", NUMBER, "2026-10-05T14:00:00.000Z", "2026-10-05T14:00:05.000Z", { telephony_session_id: session }), ctx.build());
    assert.deepEqual(
      [draft.association, draft.subject_id, draft.kind, draft.verification, draft.goal_credit, draft.originating_inbound],
      ["none", lead.subject!.id, "inbound_answered", "confirmed", "none", false],
    );
  });

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

describe("olr C8 association_reason: why a contact is or is not associated with an eligible subject", () => {
  const reasonOf = (context: ReturnType<ContextBuilder["build"]>, row = outboundCall("101", NUMBER, T0)) => deriveCallContactEvent(row, context).association_reason;
  const withLead = (subject: Parameters<ContextBuilder["lead"]>[1]) => {
    const ctx = new ContextBuilder().link(ALICE, "101");
    ctx.lead(NUMBER, subject);
    return ctx.build();
  };

  test("eligible: unique subject in a New or Quoted period (goal scope)", () => {
    for (const workflow of ["new", "quoted"] as const) {
      const draft = deriveCallContactEvent(outboundCall("101", NUMBER, T0), withLead(subjectFacts({ workflow })));
      assert.deepEqual([draft.association, draft.association_reason, draft.goal_scope_eligible], ["unique", "eligible", true]);
    }
  });

  test("not_new_quoted: unique subject in another workflow, or with no period at contact time", () => {
    assert.equal(reasonOf(withLead(subjectFacts({ workflow: "discretion" }))), "not_new_quoted");
    const gap = subjectFacts({
      activation_at: new Date("2026-09-01T12:00:00Z"),
      periods: [{ workflow: "new", started_at: new Date("2026-10-06T04:00:00Z"), ended_at: null }],
    });
    const draft = deriveCallContactEvent(outboundCall("101", NUMBER, T0), withLead(gap));
    assert.deepEqual([draft.association, draft.subject_workflow, draft.association_reason], ["unique", null, "not_new_quoted"]);
  });

  test("ambiguous: the number leads to two Leads", () => {
    const two = new ContextBuilder().link(ALICE, "101");
    two.lead(NUMBER);
    two.lead(NUMBER);
    assert.equal(reasonOf(two.build()), "ambiguous");
  });

  test("no_lead: a number without a Lead", () => {
    const draft = deriveCallContactEvent(outboundCall("101", newId(), T0), withLead(subjectFacts()));
    assert.deepEqual([draft.association, draft.association_reason, draft.goal_credit], ["none", "no_lead", "confirmed"]);
  });

  test("lead_not_enrolled: the number's Lead has no desk subject", () => {
    const draft = deriveCallContactEvent(outboundCall("101", NUMBER, T0), withLead(null));
    assert.deepEqual([draft.association, draft.subject_id, draft.association_reason], ["none", null, "lead_not_enrolled"]);
  });

  test("before_activation: before the activation boundary, on the same New York date (carried subject) or an earlier one", () => {
    const sameDate = deriveCallContactEvent(outboundCall("101", NUMBER, T0), withLead(subjectFacts({ activation_at: new Date("2026-10-05T19:00:00Z") })));
    assert.equal(sameDate.association_reason, "before_activation");
    assert.notEqual(sameDate.subject_id, null, "olr C4: the same-date prior subject is still carried");
    const earlierDate = deriveCallContactEvent(outboundCall("101", NUMBER, T0), withLead(subjectFacts({ activation_at: new Date("2026-10-07T14:00:00Z") })));
    assert.deepEqual([earlierDate.subject_id, earlierDate.association_reason], [null, "before_activation"]);
  });

  test("lead_closed: the subject's closed period had started", () => {
    const closed = subjectFacts({
      periods: [
        { workflow: "new", started_at: new Date("2026-09-01T12:00:00Z"), ended_at: new Date("2026-10-01T00:00:00Z") },
        { workflow: "closed", started_at: new Date("2026-10-01T00:00:00Z"), ended_at: null },
      ],
    });
    assert.equal(reasonOf(withLead(closed)), "lead_closed");
  });

  test("inbound calls carry the reason of their association too (cadence history, never goal credit)", () => {
    const draft = deriveCallContactEvent(inboundCall("101", NUMBER, T0), withLead(null));
    assert.deepEqual([draft.direction, draft.association_reason, draft.goal_credit], ["inbound", "lead_not_enrolled", "none"]);
  });

  test("null for rows excluded before association: merged, purged, internal, unknown direction, not external", () => {
    const context = withLead(subjectFacts());
    const rows = [
      outboundCall("101", NUMBER, T0, { merged_into_id: newId() }),
      outboundCall("101", NUMBER, T0, { purged_at: new Date(T0) }),
      outboundCall("101", null, T0, { direction: "Internal", external_endpoint_kind: "extension" }),
      outboundCall("101", NUMBER, T0, { direction: "Unknown" }),
      outboundCall("101", NUMBER, T0, { external_endpoint_kind: "withheld" }),
      outboundCall("101", null, T0),
    ];
    for (const row of rows) {
      const draft = deriveCallContactEvent(row, context);
      assert.equal(draft.verification, "excluded");
      assert.equal(draft.association_reason, null, draft.exclusion_reason ?? "excluded");
    }
  });

  test("the reason is part of the fingerprint: no Lead and a non-enrolled Lead were indistinguishable before C8", () => {
    const row = outboundCall("101", NUMBER, T0);
    const noLead = new ContextBuilder().link(ALICE, "101").build();
    const notEnrolled = deriveCallContactEvent(row, withLead(null));
    const none = deriveCallContactEvent(row, noLead);
    const { association_reason: a, input_fingerprint: fa, ...restA } = notEnrolled;
    const { association_reason: b, input_fingerprint: fb, ...restB } = none;
    assert.deepEqual(restA, restB, "every other derived field is identical");
    assert.deepEqual([a, b], ["lead_not_enrolled", "no_lead"]);
    assert.notEqual(fa, fb);
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

  test("the number's Lead not enrolled: the only active other_leads subject is credited", () => {
    const { context, shadows } = shadowed(null, [subjectFacts({ workflow: "new" })], RULE);
    const draft = deriveCallContactEvent(outboundCall("101", NUMBER, T0), context);
    assert.deepEqual(
      [draft.association, draft.subject_id, draft.association_reason, draft.subject_workflow, draft.goal_scope_eligible, draft.goal_credit],
      ["unique", shadows[0]!.id, "eligible", "new", true, "confirmed"],
    );
  });

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

  test("other_leads subjects that are not active at contact time (not enrolled, closed, not yet activated) do not count", () => {
    const later = subjectFacts({ activation_at: new Date("2026-10-07T14:00:00Z") });
    const { context, shadows } = shadowed(null, [null, subjectFacts({ periods: CLOSED_PERIODS }), later, subjectFacts()], RULE);
    const draft = deriveCallContactEvent(outboundCall("101", NUMBER, T0), context);
    assert.deepEqual([draft.association, draft.subject_id], ["unique", shadows[3]!.id], "only the one active subject counts");
    const none = shadowed(null, [null, subjectFacts({ periods: CLOSED_PERIODS }), later], RULE).context;
    const stays = deriveCallContactEvent(outboundCall("101", NUMBER, T0), none);
    assert.deepEqual([stays.association, stays.subject_id, stays.association_reason], ["none", null, "lead_not_enrolled"], "no active shadow: the number Lead's outcome stands");
  });

  test("an active number Lead keeps the credit rule: other_leads are never consulted", () => {
    const active = shadowed(subjectFacts({ workflow: "quoted" }), [subjectFacts()], RULE);
    const draft = deriveCallContactEvent(outboundCall("101", NUMBER, T0), active.context);
    assert.deepEqual([draft.association, draft.subject_workflow], ["unique", "quoted"]);
    assert.notEqual(draft.subject_id, active.shadows[0]!.id);
  });

  test("review fix: a number Lead enrolled after the call is not active at event_at, so the shadow keeps its credit on re-derive", () => {
    const shadow = subjectFacts({ workflow: "new" });
    const row = outboundCall("101", NUMBER, T0);
    // Oct 5: the call while the number Lead is not enrolled credits the shadow.
    const atCall = shadowed(null, [shadow], RULE);
    const first = deriveCallContactEvent(row, atCall.context);
    // Oct 7: the number Lead is enrolled (activation after the call); the same call is re-derived.
    const enrolledLater = shadowed(subjectFacts({ activation_at: new Date("2026-10-07T14:00:00Z") }), [shadow], RULE);
    const again = deriveCallContactEvent(row, enrolledLater.context);
    for (const draft of [first, again])
      assert.deepEqual(
        [draft.association, draft.subject_id, draft.association_reason, draft.goal_scope_eligible, draft.goal_credit],
        ["unique", shadow.id, "eligible", true, "confirmed"],
      );
    // No active shadow: the number Lead's `before_activation` outcome stands.
    const alone = shadowed(subjectFacts({ activation_at: new Date("2026-10-07T14:00:00Z") }), [], RULE);
    const before = deriveCallContactEvent(row, alone.context);
    assert.deepEqual([before.association, before.association_reason, before.subject_id], ["none", "before_activation", null]);
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

  test("rule absent or number_lead: results are unchanged (All Numbers CONTRACT §3 as built)", () => {
    const row = outboundCall("101", NUMBER, T0);
    for (const rule of [undefined, "number_lead"] as const) {
      const { context } = shadowed(null, [subjectFacts()], rule);
      const draft = deriveCallContactEvent(row, context);
      assert.deepEqual([draft.association, draft.subject_id, draft.association_reason], ["none", null, "lead_not_enrolled"], String(rule));
      const plain = deriveCallContactEvent(row, withNumberLeadOnly());
      assert.equal(draft.input_fingerprint, plain.input_fingerprint, "other_leads in the context change nothing without the rule");
    }
    function withNumberLeadOnly() {
      const ctx = new ContextBuilder().link(ALICE, "101");
      ctx.lead(NUMBER, null);
      return ctx.build();
    }
  });
});
