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
