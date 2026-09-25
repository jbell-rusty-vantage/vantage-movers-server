import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { defaultCsiPolicy } from "../policy";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { outreachFactsDtoSchema, type AttentionRowDto } from "../dto";
import { moveViewsForLead } from "../assessment/views";
import { conflictTargetsFor, projectionFor } from "../assessment/runtime";
import { derive } from "./derive";
import { easternDay, nextActionState, outreachFacts, type FactsInput } from "./facts";
import { attentionQuerySchema, attentionSortKeys, rowMatchesAttentionQuery } from "./attention";
import type { FollowupRow, RecordRow } from "./types";

process.env.TEST_MODE = "true";

const policy = defaultCsiPolicy();
const NOW = new Date("2026-09-23T15:00:00Z"); // 11:00 ET
const id = () => new mongoose.Types.ObjectId();
const minutes = (n: number) => new Date(+NOW + n * 60_000);

function record(over: Partial<RecordRow> & Record<string, unknown> = {}): RecordRow {
  const base = new (getOutreachRecordModel())({ subject: { kind: "lead", model: "FormLead", id: id() }, state: "open", trigger_kind: "lead_arrival",
    trigger_at: new Date("2026-09-20T12:00:00Z"), policy_version: policy.version, responsible_agent_id: id() }).toObject() as RecordRow;
  return { ...base, ...over } as RecordRow;
}
function followup(due: Date | null, over: Partial<FollowupRow> = {}): FollowupRow {
  const row = new (getOutreachFollowupModel())({ outreach_record_id: id(), commitment_key: String(id()), kind: "call", description: "Synthetic callback",
    origin: "rep_promise", due_at: due, responsible_agent_id: id(),
    date_resolution: { precision: due ? "exact" : "unresolved", timezone: policy.timezone, anchor: NOW, policy_version: policy.version } }).toObject() as FollowupRow;
  return { ...row, ...over } as FollowupRow;
}
const number = (rollups: Record<string, unknown> = {}) => ({ rollups: { interactions_total: 6, inbound_total: 4, outbound_total: 2, human_conversations_total: 2,
  recordings_total: 3, conversations_analyzed_total: 2, last_inbound_at: new Date("2026-09-22T14:00:00Z"), last_outbound_at: new Date("2026-09-23T13:00:00Z"), ...rollups } });
const formLead = { pickup_city: " Boston ", pickup_state: "MA", pickup_zip: "02110", delivery_city: "Austin", delivery_state: "TX", destination_zip: "73301",
  move_date: new Date("2026-10-15T00:00:00Z"), move_size: "2 Bedroom" };
function facts(over: Partial<FactsInput> = {}) {
  const input: FactsInput = { record: record(), followups: [], number: number(), lead: formLead, bookings: [], cancellations: [], now: NOW, ...over };
  const result = outreachFacts(input);
  outreachFactsDtoSchema.parse(result.facts);
  return result;
}
const assessment = (over: Record<string, unknown> = {}) => ({ artifact_id: id(), status: "ready", transaction_intent: 75, move_likelihood: 100,
  latest_conversation_at: new Date("2026-09-22T14:00:00Z"), stale: false, stale_reason: null, published_at: new Date("2026-09-22T15:00:00Z"), conflict_targets: [], ...over });

test("route comes from moveViewsForLead canonical_current, so the card and Move details agree", () => {
  const { facts: f } = facts();
  const view = moveViewsForLead(formLead, "FormLead").canonical_current;
  assert.deepEqual(f.route, { pickup_city: view.pickup.city, pickup_state: view.pickup.state, delivery_city: view.delivery.city,
    delivery_state: view.delivery.state, move_date: view.move_date, source: "lead" });
  assert.equal(f.route?.pickup_city, "Boston");
  assert.equal(f.route?.move_date, "2026-10-15");
  // Call Leads have no move date on file (Form only) and use `delivery_zip`.
  const call = facts({ record: record({ subject: { kind: "lead", model: "CallLead", id: id() } as RecordRow["subject"] }),
    lead: { pickup_city: "Denver", pickup_state: "CO", delivery_city: null, delivery_state: null, delivery_zip: "10001", move_date: new Date("2026-10-01T00:00:00Z") } });
  assert.deepEqual(call.facts.route, { pickup_city: "Denver", pickup_state: "CO", delivery_city: null, delivery_state: null, move_date: null, source: "lead" });
  assert.equal(call.facts.move_date_passed, false);
  // Lead not loaded (purged, or a Lead subject whose row is missing): no route, never a guess.
  assert.equal(facts({ lead: null }).facts.route, null);
});

test("counts and last call come from the primary Number rollups; unknown is null, never zero", () => {
  const { facts: f, sort_keys } = facts();
  assert.equal(f.last_call_at, "2026-09-23T13:00:00.000Z", "max(last_inbound_at, last_outbound_at)");
  assert.deepEqual([f.calls_total, f.conversations_total, f.recordings_available, f.recordings_analyzed], [6, 2, 3, 2]);
  assert.deepEqual(sort_keys, { last_call: f.last_call_at, interactions: 6 });
  assert.equal(facts({ number: number({ last_outbound_at: null }) }).facts.last_call_at, "2026-09-22T14:00:00.000Z");
  assert.equal(facts({ number: number({ last_inbound_at: null, last_outbound_at: null }) }).facts.last_call_at, null);
  // A Number written before the S1 rollups existed reads the schema default 0 until the rebuild sweep.
  const legacy = facts({ number: { rollups: { interactions_total: 2, last_inbound_at: null, last_outbound_at: null } } }).facts;
  assert.deepEqual([legacy.calls_total, legacy.recordings_available, legacy.recordings_analyzed], [2, 0, 0]);
});

test("null paths: a record with no Number and a Number-only subject", () => {
  const noNumber = facts({ number: null, record: record({ primary_contact_number_id: null, move_assessment: assessment() } as never) });
  assert.deepEqual({ ...noNumber.facts, route: null }, { route: null, move_date_passed: false, last_call_at: null, calls_total: null, conversations_total: null,
    recordings_available: null, recordings_analyzed: null, newer_call_since_assessment: false, details_disagree: false, next_action_state: "none", rep_thread: null });
  assert.deepEqual(noNumber.sort_keys, { last_call: null, interactions: null });
  assert.ok(noNumber.facts.route, "the Lead's route does not depend on a Number");
  const numberOnly = facts({ lead: null, record: record({ subject: { kind: "number_review", contact_number_id: id() } as RecordRow["subject"] }) });
  assert.equal(numberOnly.facts.route, null);
  assert.equal(numberOnly.facts.move_date_passed, false);
  assert.equal(numberOnly.facts.calls_total, 6);
  // A Number-only subject never borrows a Lead row even when one is passed by mistake.
  assert.equal(facts({ record: record({ subject: { kind: "number_review", contact_number_id: id() } as RecordRow["subject"] }) }).facts.route, null);
});

test("B4: details_disagree only when the conflicts touch a location or the move date", () => {
  const cases: Array<[string[], boolean]> = [
    [[], false],
    [["pickup_location"], true],
    [["delivery_location"], true],
    [["move_date"], true],
    [["move_size"], false], [["service"], false], [["access"], false], [["money"], false], [["inventory"], false],
    [["move_likelihood", "transaction_intent"], false],
    [["money", "move_date"], true],
  ];
  for (const [targets, expected] of cases) {
    assert.equal(facts({ record: record({ move_assessment: assessment({ conflict_targets: targets }) } as never) }).facts.details_disagree, expected, targets.join(","));
  }
  // End to end from the artifact: the publish writes `conflicts[].affects` deduped onto the projection.
  const conflict = (affects: string) => ({ affects, explanation: "Customer said two things", evidence_ids: ["E1", "E2"] });
  assert.deepEqual(conflictTargetsFor([conflict("move_date"), conflict("money"), conflict("move_date")]), ["move_date", "money"]);
  assert.deepEqual(conflictTargetsFor(null), []);
  assert.deepEqual(conflictTargetsFor([{ explanation: "no target" }, "junk"]), []);
  const artifact = { _id: id(), status: "ready", input_fingerprint: "fp", schema_version: "move-assessment-v1", subject_key: "lead:FormLead:x", shadow: false,
    context_as_of: NOW, latest_conversation_at: null, scores: null };
  assert.deepEqual(projectionFor({ ...artifact, conflicts: [conflict("pickup_location"), conflict("money")] }, 1, NOW).conflict_targets, ["pickup_location", "money"]);
  assert.deepEqual(projectionFor({ ...artifact, conflicts: [conflict("money")] }, 1, NOW).conflict_targets, ["money"]);
  assert.deepEqual(projectionFor(artifact, 1, NOW).conflict_targets, []);
  const published = projectionFor({ ...artifact, conflicts: [conflict("delivery_location")] }, 1, NOW);
  assert.equal(facts({ record: record({ move_assessment: published } as never) }).facts.details_disagree, true);
  // A purged projection has no content to disagree with; older projections without the field read false.
  assert.equal(facts({ record: record({ move_assessment: assessment({ status: "purged", conflict_targets: ["move_date"] }) } as never) }).facts.details_disagree, false);
  assert.equal(facts({ record: record({ move_assessment: assessment({ conflict_targets: undefined }) } as never) }).facts.details_disagree, false);
});

test("newer_call_since_assessment: a call after the covered conversations, active assessments only", () => {
  const withAssessment = (over: Record<string, unknown>, extra: Partial<FactsInput> = {}) =>
    facts({ record: record({ move_assessment: assessment(over) } as never), ...extra }).facts.newer_call_since_assessment;
  assert.equal(withAssessment({}), true, "last call 09-23 13:00 > covered 09-22 14:00");
  assert.equal(withAssessment({ latest_conversation_at: new Date("2026-09-23T13:00:00Z") }), false, "equal is not newer");
  assert.equal(withAssessment({ latest_conversation_at: "2026-09-23T12:59:59.000Z" }), true, "stored ISO strings compare as instants");
  assert.equal(withAssessment({ latest_conversation_at: null }), false);
  assert.equal(withAssessment({}, { number: null }), false, "no Number, no call");
  assert.equal(facts({ record: record() }).facts.newer_call_since_assessment, false, "not assessed");
  // Same applicability gate as moveAssessmentProjectionDto: closed or terminal CRM work is not a card state.
  assert.equal(facts({ record: record({ state: "closed", move_assessment: assessment() } as never) }).facts.newer_call_since_assessment, false);
  const terminal = { granot_priority: "9", disposition: "crm_dead", provenance: "accepted", override: null };
  assert.equal(facts({ record: record({ lead_progress: terminal, move_assessment: assessment() } as never) }).facts.newer_call_since_assessment, false);
  assert.equal(facts({ record: record({ lead_progress: { ...terminal, provenance: "uncertain" }, move_assessment: assessment() } as never) }).facts.newer_call_since_assessment, true);
});

test("B16: move_date_passed flips at midnight America/New_York, not UTC", () => {
  const passed = (moveDate: string, now: string) =>
    facts({ lead: { ...formLead, move_date: new Date(`${moveDate}T00:00:00Z`) }, now: new Date(now) }).facts.move_date_passed;
  // EDT (UTC-4): Sep 23 ends at 04:00Z on Sep 24.
  assert.equal(passed("2026-09-23", "2026-09-23T15:00:00Z"), false, "the move day itself is not passed");
  assert.equal(passed("2026-09-23", "2026-09-24T03:59:59.999Z"), false, "23:59:59 ET on the move day");
  assert.equal(passed("2026-09-23", "2026-09-24T04:00:00Z"), true, "00:00 ET the next day");
  // UTC and ET disagree: 02:00Z on Sep 24 is still Sep 23 in New York.
  assert.equal(easternDay(new Date("2026-09-24T02:00:00Z")), "2026-09-23");
  assert.equal(passed("2026-09-23", "2026-09-24T02:00:00Z"), false, "a UTC day comparison would already say passed");
  assert.equal(passed("2026-09-22", "2026-09-23T02:00:00Z"), false, "UTC says Sep 23; ET is still Sep 22");
  // DST ends 2026-11-01 02:00 EDT → 01:00 EST: Nov 1 ends at 05:00Z (EST, UTC-5), not 04:00Z.
  assert.equal(passed("2026-11-01", "2026-11-02T04:30:00Z"), false, "23:30 EST on Nov 1");
  assert.equal(passed("2026-11-01", "2026-11-02T05:00:00Z"), true);
  assert.equal(passed("2026-10-31", "2026-11-01T03:59:59Z"), false, "23:59:59 EDT on Oct 31");
  assert.equal(passed("2026-10-31", "2026-11-01T04:00:00Z"), true);
  // DST starts 2026-03-08 02:00 EST → 03:00 EDT: Mar 7 ends at 05:00Z, Mar 8 ends at 04:00Z.
  assert.equal(passed("2026-03-07", "2026-03-08T04:59:59Z"), false);
  assert.equal(passed("2026-03-07", "2026-03-08T05:00:00Z"), true);
  assert.equal(passed("2026-03-08", "2026-03-09T03:59:59Z"), false);
  assert.equal(passed("2026-03-08", "2026-03-09T04:00:00Z"), true);
  assert.equal(facts({ lead: { ...formLead, move_date: null } }).facts.move_date_passed, false, "no move date on file");
});

test("B16: next_action_state agrees with derive() for every action case", () => {
  const check = (name: string, over: { state?: RecordRow["state"]; actions: FollowupRow[]; next?: FollowupRow | null; now?: Date }, expected: string) => {
    const now = over.now ?? NOW;
    const next = over.next === undefined ? over.actions[0] ?? null : over.next;
    const rec = record({ state: over.state ?? "open", next_action: next ? { followup_id: next._id, kind: next.kind, due_at: next.due_at, description: next.description } : null } as never);
    const derived = derive(rec, { now, policy, staffing: policy, followups: over.actions, restrictions: [], reviewItems: [], coverage: {} });
    const state = outreachFacts({ record: rec, followups: over.actions, number: number(), lead: formLead, bookings: [], cancellations: [], now }).facts.next_action_state;
    assert.equal(state, expected, name);
    assert.equal(state === "overdue", derived.overdue, `${name}: overdue agrees with derived.overdue`);
    const actionFact = next ? derived.actions.find(a => a.id === String(next._id)) : undefined;
    // Action facts are not gated by actionability; derive() gates the record-level flag (closed, identity review).
    const actionable = !["closed", "identity_review"].includes(rec.state);
    if (actionFact && actionable) assert.equal(state === "overdue", actionFact.overdue, `${name}: agrees with the action fact`);
    if (actionFact) assert.equal(state === "no_due_date", actionFact.attention_due_at === null, `${name}: no date agrees with attention_due_at`);
  };
  check("none: no follow-up", { actions: [] }, "none");
  check("no_due_date", { actions: [followup(null)] }, "no_due_date");
  check("due: in 2h", { actions: [followup(minutes(120))] }, "due");
  check("overdue: 40m ago", { actions: [followup(minutes(-40))] }, "overdue");
  check("boundary: attention_due_at == now is overdue in both", { actions: [followup(NOW)] }, "overdue");
  check("boundary: one ms before due", { actions: [followup(new Date(+NOW + 1))] }, "due");
  check("snoozed: contractual due passed, reminder postponed", { actions: [followup(minutes(-40), { snoozed_until: minutes(30) })] }, "due");
  check("snooze expired", { actions: [followup(minutes(-40), { snoozed_until: minutes(-10) })] }, "overdue");
  check("contractual: due_at passed, base_attention_due_at later (next opening)", { actions: [followup(minutes(-60), { base_attention_due_at: minutes(60) })] }, "due");
  check("contractual base passed", { actions: [followup(minutes(-60), { base_attention_due_at: minutes(-5) })] }, "overdue");
  check("next action points at a completed follow-up", { actions: [followup(minutes(-40), { status: "completed" })] }, "none");
  check("closed work is not actionable", { state: "closed", actions: [followup(minutes(-40))] }, "none");
  check("identity review is not actionable", { state: "identity_review", actions: [followup(minutes(-40))] }, "none");
  check("waiting on customer, wait due later", { state: "waiting_on_customer", actions: [followup(minutes(90), { kind: "wait", origin: "system_default" })] }, "due");
  // The same record reads due before the time and overdue after it: the state is decided at the passed `now`.
  const action = followup(minutes(10));
  check("before", { actions: [action], now: NOW }, "due");
  check("after", { actions: [action], now: minutes(11) }, "overdue");
  assert.equal(nextActionState({ state: "open", next_action: null }, [action], NOW), "none");
});

test("§3.8 rule 4: every state is computed from the passed now, never the process clock", async t => {
  const action = followup(minutes(30));
  const rec = record({ next_action: { followup_id: action._id, kind: "call", due_at: action.due_at, description: "x" }, move_assessment: assessment({ conflict_targets: ["move_date"] }) } as never);
  const lead = { ...formLead, move_date: new Date("2026-09-23T00:00:00Z") };
  const input = { record: rec, followups: [action], number: number(), lead, bookings: [], cancellations: [] };
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2030-01-01T00:00:00Z") });
  try {
    const early = outreachFacts({ ...input, now: NOW }).facts;
    const late = outreachFacts({ ...input, now: new Date("2026-09-24T04:00:00Z") }).facts;
    assert.equal(early.move_date_passed, false);
    assert.equal(early.next_action_state, "due");
    assert.equal(late.move_date_passed, true);
    assert.equal(late.next_action_state, "overdue");
    // Clock-free states are identical at both instants.
    assert.equal(early.newer_call_since_assessment, late.newer_call_since_assessment);
    assert.equal(early.details_disagree, true);
    assert.equal(late.details_disagree, true);
    t.mock.timers.setTime(+new Date("2001-01-01T00:00:00Z"));
    assert.deepEqual(outreachFacts({ ...input, now: NOW }).facts, early, "moving the process clock changes nothing");
  } finally {
    t.mock.timers.reset();
  }
});

test("attention sort keys read the row's frozen facts; the agent filter also matches promised_by (D7)", () => {
  const { facts: f } = facts();
  const agent = (n: string) => ({ id: n.repeat(24), name: `Agent ${n}` });
  const followupDto = (assigned: string | null, promised: string | null) => ({ status: "open", attention_due_at: null, assignment: { agent: assigned ? agent(assigned) : null }, promised_by: promised ? agent(promised) : null });
  const row = (outreach: Record<string, unknown>) => ({ subject_key: "lead:FormLead:x", in_attention: true, derived: { attention_band: 4, review_badges: [], reasons: [] },
    outreach: { state: "open", subject: { kind: "lead", model: "FormLead", id: "x" }, trigger_at: null, first_action_due_at: null, last_meaningful_contact_at: null,
      lead_progress: null, move_assessment: null, assignment: { agent: agent("a") }, followups: [], ...outreach } }) as unknown as AttentionRowDto;
  const keys = attentionSortKeys(row({ facts: f }));
  assert.equal(keys.last_call, f.last_call_at);
  assert.equal(keys.interactions, 6);
  const none = attentionSortKeys(row({}));
  assert.equal(none.last_call, null, "rows published before S1 carry no facts");
  assert.equal(none.interactions, null);
  const matches = (r: AttentionRowDto, agentId: string) => rowMatchesAttentionQuery(r, attentionQuerySchema.parse({ agent_id: agentId }));
  const promised = row({ followups: [followupDto("b", "c")] });
  assert.equal(matches(promised, "a".repeat(24)), true, "record assignee");
  assert.equal(matches(promised, "b".repeat(24)), true, "follow-up assignee");
  assert.equal(matches(promised, "c".repeat(24)), true, "follow-up promised by");
  assert.equal(matches(promised, "d".repeat(24)), false);
  assert.equal(matches(row({ followups: [followupDto(null, null)] }), "c".repeat(24)), false);
});

// ---------------------------------------------------------------- S2: filter_keys and the closed outcome (data spec §3.3, §3.5)

test("S2 filter_keys: agents = assigned ∪ follow-up responsible ∪ promised (V10), deduped and sorted", () => {
  const owner = id(), rep = id(), promiser = id();
  const rec = record({ responsible_agent_id: owner } as never);
  const keys = facts({ record: rec, followups: [followup(minutes(30), { responsible_agent_id: rep, promised_by_agent_id: promiser }), followup(null, { responsible_agent_id: owner, promised_by_agent_id: null })] }).filter_keys;
  assert.deepEqual(keys.agents, [String(owner), String(rep), String(promiser)].sort());
  assert.deepEqual(facts({ record: record({ responsible_agent_id: null } as never) }).filter_keys.agents, [], "unassigned");
});

test("S2 filter_keys: attachment, priority, recordings, assessment, scores, received_at and move date", () => {
  const lead = facts().filter_keys;
  assert.equal(lead.attachment, "lead");
  assert.equal(lead.priority, null, "no Lead progress: Not set");
  assert.equal(lead.has_recording, true, "recordings_total 3");
  assert.equal(lead.has_assessment, false);
  assert.equal(lead.ti, null);
  assert.equal(lead.received_at, "2026-09-20T12:00:00.000Z", "Lead subject: trigger_at, same as sort_keys.lead_received");
  assert.equal(lead.move_date, "2026-10-15");
  assert.equal(lead.outcome, null);
  assert.equal(lead.closed_at, null);
  const numberOnly = facts({ record: record({ subject: { kind: "number_review", contact_number_id: id() } as RecordRow["subject"] }), number: null, lead: null }).filter_keys;
  assert.equal(numberOnly.attachment, "none");
  assert.equal(numberOnly.received_at, null, "not a Lead");
  assert.equal(numberOnly.has_recording, false, "no Number: null count reads false");
  assert.equal(numberOnly.move_date, null);
  assert.equal(facts({ record: record({ lead_progress: { granot_priority: "3", disposition: "rep_discretion", provenance: "accepted" } } as never) }).filter_keys.priority, "3");
  const scored = facts({ record: record({ move_assessment: assessment() } as never) }).filter_keys;
  assert.equal(scored.has_assessment, true);
  assert.equal(scored.ti, 75);
  assert.equal(scored.ml, 100);
  assert.equal(facts({ record: record({ move_assessment: assessment({ status: "insufficient_evidence", transaction_intent: null, move_likelihood: null }) } as never) }).filter_keys.has_assessment, true);
  assert.equal(facts({ record: record({ move_assessment: assessment({ status: "failed" }) } as never) }).filter_keys.has_assessment, false);
  // Terminal CRM disposition: not applicable, so no assessment and no score keys (same as the projection).
  const terminal = facts({ record: record({ move_assessment: assessment(), lead_progress: { granot_priority: "8", disposition: "crm_dead", provenance: "accepted", override: null } } as never) }).filter_keys;
  assert.equal(terminal.has_assessment, false);
  assert.equal(terminal.ti, null);
  // newer_call mirrors facts.newer_call_since_assessment.
  const newer = facts({ record: record({ move_assessment: assessment({ latest_conversation_at: new Date("2026-09-22T00:00:00Z") }) } as never) });
  assert.equal(newer.facts.newer_call_since_assessment, true);
  assert.equal(newer.filter_keys.newer_call, true);
});

const TRIGGER = new Date("2026-09-10T14:00:00Z");
function closed(reason: string, origin: string | null, over: Record<string, unknown> = {}) {
  return record({ state: "closed", closed_reason: reason, closure_origin: origin, closed_at: new Date("2026-09-19T16:00:00Z"), trigger_at: TRIGGER, ...over } as never);
}

test("B6 (unit): booked uses book_date - trigger_at; cancelled uses cancel_date - trigger_at; others closed_at - trigger_at", () => {
  // book_date / cancel_date are ET calendar days at UTC midnight; time_to_close counts from the trigger's ET wall clock (14:00Z = 10:00 EDT → 10:00Z).
  const TRIGGER_WALL = new Date("2026-09-10T10:00:00Z");
  const agent = id(), booking = { _id: id(), book_date: new Date("2026-09-18T00:00:00Z"), total_binder_amount: 1850, job_no: "J-1", agent };
  const booked = facts({ record: closed("booked", "official"), bookings: [booking], agentNames: new Map([[String(agent), "Dana"]]) });
  assert.equal(booked.outcome?.reason, "booked");
  assert.equal(booked.outcome?.time_to_close_ms, +booking.book_date - +TRIGGER_WALL, "7 d 14 h");
  assert.equal(booked.outcome?.calls_total, 6);
  assert.deepEqual(booked.outcome?.booking, { id: String(booking._id), book_date: booking.book_date.toISOString(), total_binder_amount: 1850, job_no: "J-1", agent_name: "Dana" });
  assert.equal(booked.outcome?.cancellation, null);
  assert.equal(booked.filter_keys.outcome, "booked");
  assert.equal(booked.filter_keys.closed_at, "2026-09-19T16:00:00.000Z");
  const cancel = { _id: id(), booked_lead: booking._id, cancel_date: new Date("2026-09-21T00:00:00Z"), reason: "Found another mover" };
  const cancelled = facts({ record: closed("cancelled", "official"), bookings: [booking], cancellations: [cancel] });
  assert.equal(cancelled.outcome?.reason, "cancelled");
  assert.equal(cancelled.outcome?.time_to_close_ms, +cancel.cancel_date - +TRIGGER_WALL, "10 d 14 h");
  assert.equal(cancelled.outcome?.booking?.id, String(booking._id));
  assert.deepEqual(cancelled.outcome?.cancellation, { id: String(cancel._id), cancel_date: cancel.cancel_date.toISOString(), reason: "Found another mover" });
  for (const reason of ["bad_lead", "duplicate", "no_sync"]) {
    const other = facts({ record: closed(reason, "official"), bookings: [booking] });
    assert.equal(other.outcome?.reason, reason);
    assert.equal(other.outcome?.time_to_close_ms, +new Date("2026-09-19T16:00:00Z") - +TRIGGER, reason);
    assert.equal(other.outcome?.booking, null, "only booked/cancelled name a Booking");
  }
  // A booked record whose Booking row is missing has no book_date: unknown, never zero.
  assert.equal(facts({ record: closed("booked", "official") }).outcome?.time_to_close_ms, null);
  // A date-only book_date before the Lead's arrival on the same day clamps at 0.
  assert.equal(facts({ record: closed("booked", "official"), bookings: [{ ...booking, book_date: new Date("2026-09-10T00:00:00Z") }] }).outcome?.time_to_close_ms, 0);
});

test("§3.5 outcome mapping: CRM dispositions, Owner closures, and the Number-review closures that are not outcomes", () => {
  const crm = facts({ record: closed("granot_dead_opportunity", "crm_disposition", { lead_progress: { granot_priority: "8", disposition: "crm_dead", provenance: "accepted", override: null } }) });
  assert.equal(crm.outcome?.reason, "crm_dead");
  assert.equal(crm.outcome?.priority?.code, "8");
  assert.ok(crm.outcome?.priority?.label && crm.outcome.priority.label !== "Unknown", crm.outcome?.priority?.label);
  assert.equal(facts({ record: closed("granot_bad_unusable", "crm_disposition", { lead_progress: { granot_priority: "7", disposition: "crm_bad_unusable", provenance: "accepted" } }) }).outcome?.reason, "crm_bad_unusable");
  const owner = facts({ record: closed("Customer asked us to stop", "owner") });
  assert.equal(owner.outcome?.reason, "owner");
  assert.equal(owner.outcome?.note, "Customer asked us to stop");
  assert.equal(owner.outcome?.priority, null);
  for (const [reason, origin] of [["lead_context_available", "official"], ["lead_unavailable", "official"], ["granot_other", "crm_disposition"], ["booked", null]] as const) {
    const result = facts({ record: closed(reason, origin) });
    assert.equal(result.outcome, null, `${reason}/${origin} is not a Closed-view outcome`);
    assert.equal(result.filter_keys.outcome, null);
  }
  assert.equal(facts({ record: closed("booked", "official", { closed_at: null }) }).outcome, null, "no closed_at, no outcome");
  assert.equal(facts().outcome, null, "open work has no outcome");
});
