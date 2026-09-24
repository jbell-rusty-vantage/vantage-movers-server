/**
 * Team 4 AC3–AC5 unit proofs (Attention evolution and Case File spec §5–§7), fixed clock.
 * America/New_York, staffed Mon–Sat 08:00–20:00 (the default policy). Wed 2026-09-23 is EDT (UTC−4).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { defaultCsiPolicy } from "../policy";
import { csiPolicySchema, csiPolicyEvolution, CSI_POLICY_EVOLUTION_DEFAULTS } from "../../../validation/v1/salesIntelligence";
import { addStaffedMinutes, staffedDayOpening, staffedMinutesAtLeast, staffedMinutesBetween, subtractStaffedMinutes } from "./staffing";
import { derive, isPromisedCallback, isPromiseOriginCall, promisedBy, promiseUnreachedSince, PROMISE_ORIGINS } from "./derive";
import { callbackWindowOpens, customerCalledBack, fulfilledByCall, pickCallbackTarget, type CallFacts } from "./transitions";
import { assignmentRank, ASSIGNMENT_RANKS, mayReplaceAssignment, type FollowupRow, type InteractionRow, type RecordRow } from "./types";
import { band2DueRank } from "./attention";
import { completionPolicy, contactFactsMissing, lastActivityAt, latestOf } from "./ensure";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";

const policy = defaultCsiPolicy();
const oid = () => new mongoose.Types.ObjectId();
const ET = (local: string) => {
  // Local wall time in America/New_York for the fixed test dates (EDT −4 before Nov 1, EST −5 after).
  const offset = local >= "2026-11-01T02:00" ? "-05:00" : "-04:00";
  return new Date(`${local}:00${offset}`);
};
const WED_10 = ET("2026-09-23T10:00"), WED_15 = ET("2026-09-23T15:00");

function record(over: Partial<RecordRow> = {}): RecordRow {
  const row = new (getOutreachRecordModel())({ subject: { kind: "lead", model: "FormLead", id: oid() }, state: "open", trigger_kind: "lead_arrival",
    trigger_at: ET("2026-09-22T09:00"), policy_version: policy.version, responsible_agent_id: oid() }).toObject() as RecordRow;
  return Object.assign(row, over);
}
function followup(over: Record<string, unknown> = {}): FollowupRow {
  const precision = (over.precision as string | undefined) ?? "exact";
  delete over.precision;
  const row = new (getOutreachFollowupModel())({ outreach_record_id: oid(), commitment_key: String(oid()), kind: "call", description: "Synthetic", origin: "rep_promise",
    due_at: WED_15, base_attention_due_at: WED_15, responsible_agent_id: oid(),
    date_resolution: { precision, timezone: policy.timezone, anchor: WED_10, policy_version: policy.version }, ...over }).toObject() as FollowupRow;
  return row;
}
const context = (now: Date, followups: FollowupRow[], evolution = true) => ({ now, policy, staffing: policy, followups, restrictions: [], reviewItems: [], coverage: {}, evolution });
const call = (over: Partial<InteractionRow> = {}) => ({ _id: oid(), started_at: WED_15, direction: "Outbound", terminal: true, contact_type: "unknown", provider_connected: false, parties: [], ...over }) as unknown as InteractionRow;
const attempt: CallFacts = { identityAllowed: true, attributable: true, outboundAttempt: true, human: false, missed: false, outcome: "no_answer" };
const inboundHuman: CallFacts = { identityAllowed: true, attributable: true, outboundAttempt: false, human: true, missed: false, outcome: "spoke_with_customer" };
const evolved = completionPolicy(policy);

// ── Policy (§5.3) ────────────────────────────────────────────────────────────────────────────────
test("§5.3 a stored policy without the new fields still parses and resolves to the defaults; overrides win", () => {
  const stored = { ...defaultCsiPolicy() };
  const parsed = csiPolicySchema.parse(stored);
  assert.equal("inbound_followup_staffed_minutes" in parsed, false, "flag-off settings read stays byte-identical (no new keys)");
  assert.deepEqual(csiPolicyEvolution(parsed), { inbound_followup_staffed_minutes: 240, callback_early_window_staffed_minutes: 60, callback_retry_staffed_minutes: 120,
    callback_max_retries: 2, quote_followup_staffed_minutes: 1440, unreached_multiplier: 2, first_attempts_threshold: 2 });
  assert.deepEqual(csiPolicyEvolution(parsed), { ...CSI_POLICY_EVOLUTION_DEFAULTS });
  const custom = csiPolicySchema.parse({ ...stored, callback_max_retries: 3, inbound_followup_staffed_minutes: 120 });
  assert.equal(csiPolicyEvolution(custom).callback_max_retries, 3);
  assert.equal(csiPolicyEvolution(custom).inbound_followup_staffed_minutes, 120);
  assert.throws(() => csiPolicySchema.parse({ ...stored, inbound_followup_staffed_minutes: 0 }));
  assert.deepEqual(Object.keys(defaultCsiPolicy()).sort(), ["cooldown_attempts_24h", "enabled_capabilities", "first_action_due_staffed_minutes", "going_cold_staffed_minutes",
    "missed_callback_due_staffed_minutes", "monthly_ceiling_cents", "per_recording_ceiling_cents", "retention", "staffed_hours", "timezone", "version"]);
});

// ── Staffed clock (§6 rule 1) ────────────────────────────────────────────────────────────────────
test("subtractStaffedMinutes mirrors addStaffedMinutes, including Sat 20:00 → Mon 08:00 and DST", () => {
  assert.equal(+subtractStaffedMinutes(WED_15, 60, policy), +ET("2026-09-23T14:00"));
  assert.equal(+subtractStaffedMinutes(ET("2026-09-28T08:30"), 60, policy), +ET("2026-09-26T19:30"), "Mon 08:30 − 60 → Sat 19:30");
  assert.equal(+subtractStaffedMinutes(ET("2026-09-28T08:00"), 60, policy), +ET("2026-09-26T19:00"));
  assert.equal(+subtractStaffedMinutes(ET("2026-09-27T12:00"), 30, policy), +ET("2026-09-26T19:30"), "from Sunday: back from Saturday's close");
  assert.equal(+subtractStaffedMinutes(ET("2026-09-23T08:30"), 30, policy), +ET("2026-09-23T08:00"), "an exact fit lands on the opening");
  assert.equal(+subtractStaffedMinutes(WED_15, 0, policy), +WED_15);
  // DST fall back (Sun Nov 1 2026): Mon 08:30 EST − 60 → Sat Oct 31 19:30 EDT.
  assert.equal(+subtractStaffedMinutes(ET("2026-11-02T08:30"), 60, policy), +ET("2026-10-31T19:30"));
  for (const start of [ET("2026-09-23T09:17"), ET("2026-09-26T19:59"), ET("2026-09-28T08:00"), ET("2026-10-31T18:00")]) {
    for (const minutes of [1, 59, 60, 61, 240, 721, 1440]) {
      const back = subtractStaffedMinutes(start, minutes, policy);
      assert.equal(staffedMinutesBetween(back, start, policy), minutes, `${start.toISOString()} − ${minutes}`);
    }
  }
  assert.equal(+staffedDayOpening(ET("2026-09-23T20:00"), policy), +ET("2026-09-23T08:00"));
  assert.equal(+staffedDayOpening(ET("2026-09-27T13:00"), policy), +ET("2026-09-27T00:00"), "unstaffed Sunday: local midnight");
  assert.throws(() => subtractStaffedMinutes(WED_15, -1, policy));
});

// ── K13 band 1 (§5.1) ────────────────────────────────────────────────────────────────────────────
test("K13 band 1: exact customer and Owner callbacks with promised_by; day-precision and non-call rep steps are band 4; missed is band 3", () => {
  const now = ET("2026-09-23T15:30");
  const customer = derive(record(), context(now, [followup({ origin: "customer_request" })]));
  assert.equal(customer.attention_band, 1);
  assert.deepEqual(customer.reasons.slice(0, 2), ["promised_callback_overdue", "promised_by:customer"]);
  const owner = derive(record(), context(now, [followup({ origin: "owner" })]));
  assert.equal(owner.attention_band, 1);
  assert.ok(owner.reasons.includes("promised_by:owner"));
  const rep = derive(record(), context(now, [followup()]));
  assert.equal(rep.attention_band, 1); assert.ok(rep.reasons.includes("promised_by:rep"));
  const repDay = derive(record(), context(now, [followup({ precision: "day", due_at: ET("2026-09-23T08:00"), base_attention_due_at: ET("2026-09-23T08:00") })]));
  assert.equal(repDay.attention_band, 4); assert.deepEqual(repDay.reasons, ["followups_due"]);
  const estimate = derive(record(), context(now, [followup({ kind: "send_estimate", precision: "day", due_at: ET("2026-09-23T08:00"), base_attention_due_at: ET("2026-09-23T08:00") })]));
  assert.equal(estimate.attention_band, 4);
  const missed = derive(record(), context(now, [followup({ origin: "system_default", missed_episode_key: "n", first_missed_at: WED_10 })]));
  assert.equal(missed.attention_band, 3); assert.ok(!missed.reasons.some(r => r.startsWith("promised_by")));
  // The earliest-due matching action names who promised.
  const both = derive(record(), context(now, [followup({ origin: "owner", due_at: ET("2026-09-23T14:00"), base_attention_due_at: ET("2026-09-23T14:00") }), followup({ origin: "customer_request" })]));
  assert.ok(both.reasons.includes("promised_by:owner"));
  // Flag off: exactly today's rule (rep_promise call only, any precision; customer_request is band 4; no promised_by).
  assert.equal(derive(record(), context(now, [followup({ origin: "customer_request" })], false)).attention_band, 4);
  assert.equal(derive(record(), context(now, [followup({ precision: "day" })], false)).attention_band, 1);
  assert.deepEqual(derive(record(), context(now, [followup()], false)).reasons.filter(r => r.startsWith("promised_by")), []);
});
test("isPromisedCallback: one predicate for rows and DTO rows (E16 import); retries inherit the root origin", () => {
  assert.deepEqual([...PROMISE_ORIGINS], ["rep_promise", "customer_request", "owner"]);
  const dto = { kind: "call", origin: "system_default", promise_chain: { root_origin: "customer_request" }, date_resolution: { precision: "exact" } };
  assert.equal(isPromisedCallback(dto), true); assert.equal(promisedBy(dto), "customer");
  assert.equal(isPromisedCallback({ ...dto, promise_chain: null }), false, "a default or missed episode is never a promise");
  assert.equal(isPromisedCallback({ ...dto, missed_episode_key: "n" }), false);
  assert.equal(isPromisedCallback({ kind: "call", origin: "customer_wait", date_resolution: { precision: "exact" } }), false);
  assert.equal(isPromisedCallback({ kind: "call", origin: "rep_promise", date_resolution: { precision: "day" } }), false);
  assert.equal(isPromiseOriginCall({ kind: "call", origin: "rep_promise", date_resolution: { precision: "day" } }), true);
  assert.equal(isPromisedCallback({ kind: "send_estimate", origin: "rep_promise", date_resolution: { precision: "exact" } }), false);
});

// ── K14 band 2 (§5.2) ────────────────────────────────────────────────────────────────────────────
test("K14 band 2: 40 s old → new_not_yet_due (rank 1), 3 h old → no_call_yet (rank 0); flips at first_action_due_at across Sat 20:00 → Mon 08:00", () => {
  const now = WED_15;
  const lead = (trigger: Date) => record({ state: "unworked", responsible_agent_id: null, trigger_at: trigger, first_action_due_at: addStaffedMinutes(trigger, policy.first_action_due_staffed_minutes, policy) });
  const fresh = derive(lead(new Date(+now - 40_000)), context(now, []));
  const old = derive(lead(new Date(+now - 3 * 3_600_000)), context(now, []));
  assert.equal(fresh.attention_band, 2); assert.equal(fresh.reasons[0], "new_not_yet_due"); assert.equal(fresh.overdue, false);
  assert.equal(old.attention_band, 2); assert.equal(old.reasons[0], "no_call_yet"); assert.equal(old.overdue, true);
  assert.equal(band2DueRank(fresh), 1); assert.equal(band2DueRank(old), 0);
  assert.ok(band2DueRank(old)! < band2DueRank(fresh)!, "no_call_yet sorts before new_not_yet_due");
  assert.equal(band2DueRank({ attention_band: 4, reasons: ["followups_due"] }), null);
  // Friday-night/weekend form: Sat 19:50 → due Mon 08:20 (10 staffed min Sat + 20 Mon).
  const weekend = lead(ET("2026-09-26T19:50"));
  assert.equal(+weekend.first_action_due_at!, +ET("2026-09-28T08:20"));
  assert.equal(derive(weekend, context(ET("2026-09-27T12:00"), [])).reasons[0], "new_not_yet_due");
  assert.equal(derive(weekend, context(new Date(+ET("2026-09-28T08:20") - 1000), [])).reasons[0], "new_not_yet_due");
  assert.equal(derive(weekend, context(ET("2026-09-28T08:20"), [])).reasons[0], "no_call_yet");
  // Flag off: always no_call_yet.
  assert.equal(derive(lead(new Date(+now - 40_000)), context(now, [], false)).reasons[0], "no_call_yet");
});

// ── K15 no_callback_after_inbound (§5.2) ─────────────────────────────────────────────────────────
test("K15 no_callback_after_inbound: 239 staffed min no, 240 band 4; an outbound attempt clears it; any Lead subject", () => {
  const r = (over: Partial<RecordRow> = {}) => record({ last_inbound_human_at: WED_10, last_meaningful_contact_at: WED_10, last_attributable_outbound_at: null, ...over });
  const at239 = derive(r(), context(ET("2026-09-23T13:59"), []));
  assert.ok(!at239.reasons.includes("no_callback_after_inbound")); assert.equal(at239.attention_band, 5);
  const at240 = derive(r(), context(ET("2026-09-23T14:00"), []));
  assert.equal(at240.attention_band, 4); assert.ok(at240.reasons.includes("no_callback_after_inbound"));
  assert.ok(!derive(r({ last_attributable_outbound_at: ET("2026-09-23T11:00") }), context(ET("2026-09-23T14:00"), [])).reasons.includes("no_callback_after_inbound"));
  assert.ok(!derive(r({ last_meaningful_contact_at: ET("2026-09-23T11:00") }), context(ET("2026-09-23T15:00"), [])).reasons.includes("no_callback_after_inbound"), "a newer (outbound) conversation");
  assert.ok(!derive(r(), context(ET("2026-09-23T14:00"), [followup({ due_at: ET("2026-09-24T15:00"), base_attention_due_at: ET("2026-09-24T15:00") })])).reasons.includes("no_callback_after_inbound"), "an open action exists");
  assert.ok(derive(r({ subject: { kind: "lead", model: "CallLead", id: oid(), contact_number_id: null } }), context(ET("2026-09-23T14:00"), [])).reasons.includes("no_callback_after_inbound"));
  // Across the weekend: Sat 18:00 inbound → 120 Sat + 120 Mon → Mon 10:00.
  const sat = r({ last_inbound_human_at: ET("2026-09-26T18:00"), last_meaningful_contact_at: ET("2026-09-26T18:00") });
  assert.ok(!derive(sat, context(ET("2026-09-28T09:59"), [])).reasons.includes("no_callback_after_inbound"));
  assert.ok(derive(sat, context(ET("2026-09-28T10:00"), [])).reasons.includes("no_callback_after_inbound"));
  assert.ok(!derive(r(), context(ET("2026-09-23T14:00"), [], false)).reasons.includes("no_callback_after_inbound"), "flag off");
  // Null path: a record never computed (fields absent) never fires.
  assert.ok(!derive(record(), context(ET("2026-09-23T14:00"), [])).reasons.includes("no_callback_after_inbound"));
});

test("K16 (derive side) called_before_form is a secondary reason from prior_contact_at; band unchanged", () => {
  const unworked = record({ state: "unworked", responsible_agent_id: null, trigger_at: WED_10, first_action_due_at: ET("2026-09-23T10:30"), prior_contact_at: ET("2026-09-18T10:00") });
  const d = derive(unworked, context(WED_15, []));
  assert.equal(d.attention_band, 2); assert.ok(d.reasons.includes("called_before_form"));
  assert.ok(!derive({ ...unworked, prior_contact_at: null }, context(WED_15, [])).reasons.includes("called_before_form"));
  assert.ok(!derive(unworked, context(WED_15, [], false)).reasons.includes("called_before_form"));
});

// ── K19–K21 completion (§6) ──────────────────────────────────────────────────────────────────────
test("K19 exact callback: an attempt 50 staffed min early completes it, 70 min early does not; flag off keeps at-or-after due", () => {
  const cb = followup({ origin: "customer_request" });
  assert.equal(+callbackWindowOpens(cb, evolved)!, +ET("2026-09-23T14:00"));
  assert.equal(fulfilledByCall(cb, call({ started_at: ET("2026-09-23T14:10") }), attempt, evolved), true);
  assert.equal(fulfilledByCall(cb, call({ started_at: ET("2026-09-23T13:50") }), attempt, evolved), false);
  assert.equal(fulfilledByCall(cb, call({ started_at: ET("2026-09-23T14:10") }), attempt), false, "flag off");
  assert.equal(fulfilledByCall(cb, call({ started_at: ET("2026-09-23T15:10") }), attempt), true);
  // Monday 08:30 due: the window reaches back into Saturday evening.
  const monday = followup({ due_at: ET("2026-09-28T08:30"), date_resolution: { precision: "exact", timezone: policy.timezone, anchor: ET("2026-09-26T10:00"), policy_version: policy.version } });
  assert.equal(fulfilledByCall(monday, call({ started_at: ET("2026-09-26T19:40") }), attempt, evolved), true);
  assert.equal(fulfilledByCall(monday, call({ started_at: ET("2026-09-26T19:20") }), attempt, evolved), false);
  // A call before the promise was made never counts.
  assert.equal(fulfilledByCall(cb, call({ started_at: ET("2026-09-23T09:59") }), attempt, evolved), false);
});
test("K20 day-precision callback: a 9:00 AM attempt that day completes it; the day before does not", () => {
  const day = followup({ precision: "day", due_at: ET("2026-09-23T20:00"), date_resolution: { precision: "day", timezone: policy.timezone, anchor: ET("2026-09-22T10:00"), policy_version: policy.version } });
  assert.equal(fulfilledByCall(day, call({ started_at: ET("2026-09-23T09:00") }), attempt, evolved), true);
  assert.equal(fulfilledByCall(day, call({ started_at: ET("2026-09-23T07:30") }), attempt, evolved), false, "before the staffed day opens");
  assert.equal(fulfilledByCall(day, call({ started_at: ET("2026-09-22T19:00") }), attempt, evolved), false);
  assert.equal(fulfilledByCall(day, call({ started_at: ET("2026-09-23T09:00") }), attempt), false, "flag off: at or after due only");
});
test("K21 an inbound human conversation after the promise completes it as customer_called; not a default or before the promise", () => {
  const cb = followup({ origin: "rep_promise", precision: "day" });
  const inbound = call({ direction: "Inbound", started_at: ET("2026-09-23T11:00"), contact_type: "human_conversation" });
  assert.equal(fulfilledByCall(cb, inbound, inboundHuman, evolved), true);
  assert.equal(customerCalledBack(cb, inbound, inboundHuman), true);
  assert.equal(fulfilledByCall(cb, inbound, inboundHuman), false, "flag off");
  const quoteDefault = followup({ origin: "system_default", default_kind: "quote_followup", precision: "day" });
  assert.equal(fulfilledByCall(quoteDefault, inbound, inboundHuman, evolved), false);
  assert.equal(fulfilledByCall(cb, call({ direction: "Inbound", started_at: ET("2026-09-23T09:00") }), inboundHuman, evolved), false, "before the promise");
});
test("§6 rule 3: several matching callbacks complete only the one due within the early window; otherwise review", () => {
  const near = followup({ due_at: ET("2026-09-23T15:00") }), far = followup({ due_at: ET("2026-09-23T18:00") });
  assert.equal(pickCallbackTarget([near, far], { started_at: ET("2026-09-23T14:30") }, evolved), near);
  assert.equal(pickCallbackTarget([near, followup({ due_at: ET("2026-09-23T15:30") })], { started_at: ET("2026-09-23T14:50") }, evolved), null);
  assert.equal(pickCallbackTarget([near], { started_at: ET("2026-09-23T19:00") }, evolved), near);
});

// ── K22 promise_unreached (§6 rule 4, derive side) ───────────────────────────────────────────────
test("K22 (derive) retries stay band 1; after the last retry is unreached → promise_unreached band 4; a newer conversation or open action clears it", () => {
  const root = followup({ status: "completed", disposition: "no_answer", completed_at: ET("2026-09-23T15:05") });
  const chain = (attempt: number, over: Record<string, unknown> = {}) => followup({ origin: "system_default", promise_chain: { root_id: root._id, root_origin: "rep_promise", attempt },
    due_at: ET("2026-09-23T17:05"), base_attention_due_at: ET("2026-09-23T17:05"), ...over });
  const openRetry = derive(record(), context(ET("2026-09-23T17:30"), [root, chain(1)]));
  assert.equal(openRetry.attention_band, 1); assert.ok(openRetry.reasons.includes("promised_by:rep"));
  const done1 = chain(1, { status: "completed", disposition: "left_voicemail", completed_at: ET("2026-09-23T17:10") });
  const done2 = chain(2, { status: "completed", disposition: "no_answer", completed_at: ET("2026-09-24T10:00") });
  const unreached = derive(record(), context(ET("2026-09-24T12:00"), [root, done1, done2]));
  assert.equal(unreached.attention_band, 4); assert.ok(unreached.reasons.includes("promise_unreached"));
  assert.equal(+promiseUnreachedSince(record(), [root, done1, done2], 2)!, +ET("2026-09-24T10:00"));
  assert.equal(promiseUnreachedSince(record(), [root, done1], 2), null, "retry 1 is not the last allowed");
  assert.equal(promiseUnreachedSince(record({ last_meaningful_contact_at: ET("2026-09-24T11:00") }), [root, done1, done2], 2), null);
  const newer = { ...followup({ due_at: ET("2026-09-25T15:00"), base_attention_due_at: ET("2026-09-25T15:00") }), createdAt: ET("2026-09-24T11:00") };
  assert.equal(promiseUnreachedSince(record(), [root, done1, done2, newer], 2), null);
  const spoke = chain(2, { status: "completed", disposition: "spoke_with_customer", completed_at: ET("2026-09-24T10:00") });
  assert.equal(promiseUnreachedSince(record(), [root, done1, spoke], 2), null, "spoke_with_customer ends the chain");
  assert.ok(!derive(record(), context(ET("2026-09-24T12:00"), [root, done1, done2], false)).reasons.includes("promise_unreached"), "flag off");
});

// ── K27 precedence (§7.2) ────────────────────────────────────────────────────────────────────────
test("K27 (rank) owner > rep_promise = first_conversation > inherited_outreach > first_attempts; only strictly lower is replaced", () => {
  assert.deepEqual(ASSIGNMENT_RANKS, { owner: 100, rep_promise: 40, first_conversation: 40, inherited_outreach: 30, first_attempts: 10 });
  assert.ok(assignmentRank("owner") > assignmentRank("first_conversation"));
  assert.ok(assignmentRank("first_conversation") > assignmentRank("first_attempts"));
  assert.equal(assignmentRank(null), 0);
  const agent = oid();
  assert.equal(mayReplaceAssignment({ responsible_agent_id: agent, assignment: { origin: "first_attempts" } }, "first_conversation"), true);
  assert.equal(mayReplaceAssignment({ responsible_agent_id: agent, assignment: { origin: "first_conversation" } }, "rep_promise"), false, "equal rank");
  assert.equal(mayReplaceAssignment({ responsible_agent_id: agent, assignment: { origin: "owner" } }, "first_conversation"), false);
  assert.equal(mayReplaceAssignment({ responsible_agent_id: null, assignment: { origin: "owner" } }, "first_conversation"), false, "an Owner unassignment holds");
  assert.equal(mayReplaceAssignment({ responsible_agent_id: null, assignment: null }, "first_attempts"), true);
  assert.equal(mayReplaceAssignment({ responsible_agent_id: agent, assignment: null }, "first_conversation"), false, "legacy agent without origin");
});

// ── K28 last activity and going cold (§7.3) ──────────────────────────────────────────────────────
test("K28 going cold measures from last_activity_at; unreached at 2× the threshold with continuing attempts", () => {
  const base = { last_meaningful_contact_at: ET("2026-09-21T10:00"), trigger_at: ET("2026-09-21T09:00") };
  const now = ET("2026-09-25T18:00");  // 56 staffed hours after the last conversation (≥ 2 × 1440 min)
  assert.ok(derive(record(base), context(now, [])).reasons.includes("going_cold"), "no activity field: from the conversation");
  const attempted = record({ ...base, last_attributable_outbound_at: ET("2026-09-25T09:00"), last_activity_at: ET("2026-09-25T09:00") });
  const d = derive(attempted, context(now, []));
  assert.ok(!d.reasons.includes("going_cold"), "an attempt resets going cold");
  assert.ok(d.reasons.includes("unreached"), "2 × 1440 staffed min since the last conversation with attempts after it");
  assert.ok(!derive(record({ ...base, last_attributable_outbound_at: ET("2026-09-24T09:00"), last_activity_at: ET("2026-09-24T09:00") }), context(ET("2026-09-22T12:00"), [])).reasons.includes("unreached"));
  const progressed = record({ ...base, last_activity_at: ET("2026-09-25T08:30"), lead_progress: null });
  assert.ok(!derive(progressed, context(now, [])).reasons.includes("going_cold"), "accepted progress resets going cold");
  assert.ok(derive(attempted, context(now, [], false)).reasons.includes("going_cold"), "flag off: unchanged");
  assert.ok(!derive(attempted, context(now, [], false)).reasons.includes("unreached"));
  // The pure activity rule and its null path.
  assert.equal(lastActivityAt({ last_meaningful_contact_at: null, last_attributable_outbound_at: null, lead_progress: null }), null);
  const accepted = { provenance: "accepted", last_progress_at: ET("2026-09-24T11:00") } as RecordRow["lead_progress"];
  assert.equal(+lastActivityAt({ last_meaningful_contact_at: ET("2026-09-21T10:00"), last_attributable_outbound_at: null, lead_progress: accepted })!, +ET("2026-09-24T11:00"));
  assert.equal(+lastActivityAt({ last_meaningful_contact_at: ET("2026-09-21T10:00"), last_attributable_outbound_at: null, lead_progress: { ...accepted!, provenance: "uncertain" } })!, +ET("2026-09-21T10:00"));
  assert.equal(+lastActivityAt({ last_meaningful_contact_at: null, last_attributable_outbound_at: null, lead_progress: null }, ET("2026-09-23T09:00"))!, +ET("2026-09-23T09:00"), "Owner command");
  assert.equal(latestOf(null, undefined), null);
  assert.equal(contactFactsMissing(record()), true);
  assert.equal(contactFactsMissing(record({ last_inbound_human_at: null, last_attributable_outbound_at: null, prior_contact_at: null, last_activity_at: null })), false);
});
test("rep_discretion is a secondary reason on band 5 only", () => {
  const progress = { granot_priority: "3", disposition: "rep_discretion", work_observed: true, provenance: "accepted" } as RecordRow["lead_progress"];
  const d = derive(record({ lead_progress: progress, last_meaningful_contact_at: ET("2026-09-23T09:00") }), context(WED_15, []));
  assert.equal(d.attention_band, 5); assert.ok(d.reasons.includes("rep_discretion"));
  assert.ok(!derive(record({ lead_progress: progress, last_meaningful_contact_at: ET("2026-09-23T09:00") }), context(WED_15, [followup()])).reasons.includes("rep_discretion"), "band 1 row");
  assert.ok(!derive(record({ lead_progress: progress, last_meaningful_contact_at: ET("2026-09-23T09:00") }), context(WED_15, [], false)).reasons.includes("rep_discretion"));
});
test("K25 (derive) the quote default: no band until due, then band 4 followups_due; never band 1", () => {
  const due = addStaffedMinutes(ET("2026-09-23T11:00"), 1440, policy);
  assert.equal(+due, +ET("2026-09-25T11:00"));
  const quoteDefault = followup({ origin: "system_default", default_kind: "quote_followup", precision: "day", due_at: due, base_attention_due_at: due,
    date_resolution: { precision: "day", timezone: policy.timezone, anchor: ET("2026-09-23T11:00"), policy_version: policy.version } });
  const r = record({ last_meaningful_contact_at: null, last_activity_at: ET("2026-09-23T11:00") });
  assert.equal(derive(r, context(ET("2026-09-24T12:00"), [quoteDefault])).attention_band, null);
  const at = derive(r, context(ET("2026-09-25T11:00"), [quoteDefault]));
  assert.equal(at.attention_band, 4); assert.ok(at.reasons.includes("followups_due")); assert.ok(!at.reasons.includes("promised_callback_overdue"));
});

test("staffedMinutesAtLeast equals staffedMinutesBetween >= n (capped walk), across weekends and DST", () => {
  const points = [ET("2026-06-01T09:00"), ET("2026-09-19T19:30"), ET("2026-09-23T10:00"), ET("2026-10-31T19:00"), ET("2026-11-02T08:30")];
  for (const from of points) for (const to of points) for (const n of [0, 1, 239, 240, 1440, 2880, 50_000])
    assert.equal(staffedMinutesAtLeast(from, to, n, policy), staffedMinutesBetween(from, to, policy) >= n, `${from.toISOString()} → ${to.toISOString()} ≥ ${n}`);
});
