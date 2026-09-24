import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { defaultCsiPolicy } from "../policy";
import type { AttentionIndexEntry } from "../outreach/attentionIndex";
import { buildRepDayDocs, overviewRefreshDays, UNMAPPED_REP, type RepDayCall } from "./repDays";
import { aggregateCohort, spendBasis, type SpendLead } from "./spend";
import { bandFlow, callbacksKept, missedCallsReturned, percentile, speedToLead, timeInBand, type CallbackRow } from "./desk";
import { entryOverdue, entryResponsible, tallyNow } from "./now";
import { teamMedians } from "./read";

const ACCOUNT = "acct-1";
const A = "a".repeat(24), B = "b".repeat(24);
const at = (iso: string) => new Date(iso);
const link = (extension: string, agent: string, over: Record<string, unknown> = {}) => ({ _id: new mongoose.Types.ObjectId(), revision: 1, agent_id: agent, rc_account_id: ACCOUNT,
  rc_extension_id: extension, role_kind: "sales_rep", status: "reviewed", effective_from: at("2026-01-01T00:00:00Z"), effective_to: null, reviewed_at: at("2026-01-01T00:00:00Z"),
  reviewed_by: "owner", ...over });
let serial = 0;
const call = (over: Partial<RepDayCall> & { ext?: string; connected?: boolean }): RepDayCall => ({ _id: `call-${++serial}`, provider_account_id: ACCOUNT, started_at: at("2026-03-08T15:00:00Z"),
  direction: "Outbound", contact_type: "unknown", provider_connected: false, duration_seconds: 60,
  parties: [{ role: "external", connected: true }, { role: "user", extension_id: over.ext ?? "101", connected: over.connected ?? false, direction: over.direction === "Inbound" ? "Inbound" : "Outbound" }],
  legs: [], ...over });

test("S9 outreach_rep_days: reviewed reps, Unmapped, excluded roles, ET day by real start time, idempotent output", () => {
  const links = [link("101", A), link("102", B), link("103", A, { role_kind: "manager" }), link("104", B, { status: "proposed", reviewed_at: null, reviewed_by: null })];
  const calls = [
    call({ ext: "101" }), // outbound attempt, not connected
    call({ ext: "101", connected: true, contact_type: "human_conversation", provider_connected: true, duration_seconds: 300 }),
    call({ ext: "102", direction: "Inbound", connected: true, provider_connected: true, contact_type: "human_conversation", duration_seconds: 120,
      legs: [{ extension_id: "102", duration_seconds: 90 }], capture_recovery: { kind: "added" } }),
    call({ ext: "102", direction: "Inbound", connected: false }), // missed inbound: no rep leg
    call({ ext: "103", connected: true }), // reviewed as manager: not a rep
    call({ ext: "104", connected: true }), // proposed only → Unmapped
    call({ ext: "999", direction: "Inbound", connected: true, provider_connected: true }), // never reviewed → Unmapped
    // 2026-03-09 03:30Z is 23:30 EDT on 03-08: same ET day. 04:30Z is 00:30 on 03-09: another day.
    call({ ext: "101", started_at: at("2026-03-09T03:30:00Z") }),
    call({ ext: "101", started_at: at("2026-03-09T04:30:00Z") }),
  ];
  const docs = buildRepDayDocs("2026-03-08", calls, links as never);
  assert.deepEqual(docs.map(d => d.agent_key), [A, B, UNMAPPED_REP]);
  const [a, b, unmapped] = docs as [typeof docs[number], typeof docs[number], typeof docs[number]];
  assert.deepEqual({ ...a, agent_id: String(a.agent_id) }, { _id: `2026-03-08|${A}`, day: "2026-03-08", agent_key: A, agent_id: A, outbound_attempts: 3, outbound_conversations: 1,
    answered_inbound: 0, human_conversations: 1, talk_seconds: 300, calls: 3, recovered_calls: 0, extensions: [] });
  assert.deepEqual([b.answered_inbound, b.human_conversations, b.talk_seconds, b.calls, b.recovered_calls], [1, 1, 90, 1, 1], "leg duration wins; a recovered call counts on its real day");
  assert.deepEqual([unmapped.calls, unmapped.agent_id, unmapped.extensions, unmapped.answered_inbound], [2, null, ["104", "999"], 1]);
  assert.deepEqual(buildRepDayDocs("2026-03-08", [...calls].reverse(), links as never), docs, "order-independent (the rebuild is deterministic)");
  // A link retired before the call no longer resolves; the call is Unmapped.
  const retired = buildRepDayDocs("2026-03-08", [call({ ext: "101" })], [link("101", A, { effective_to: at("2026-02-01T00:00:00Z"), status: "retired", reviewed_at: null })] as never);
  assert.deepEqual(retired.map(d => d.agent_key), [UNMAPPED_REP]);
});

test("S9 refresh days: today, plus yesterday until 06:00 ET (DST-safe)", () => {
  // 2026-03-08 is the spring-forward day: 06:00 EDT is 10:00Z.
  assert.deepEqual(overviewRefreshDays(at("2026-03-08T09:59:00Z")), ["2026-03-07", "2026-03-08"]);
  assert.deepEqual(overviewRefreshDays(at("2026-03-08T10:00:00Z")), ["2026-03-08"]);
  // Winter: 06:00 EST is 11:00Z.
  assert.deepEqual(overviewRefreshDays(at("2026-01-15T10:59:00Z")), ["2026-01-14", "2026-01-15"]);
  assert.deepEqual(overviewRefreshDays(at("2026-01-15T11:00:00Z")), ["2026-01-15"]);
  assert.deepEqual(overviewRefreshDays(at("2026-01-15T04:59:00Z")), ["2026-01-14"], "23:59 EST is still the 14th (past its 06:00)");
});

test("S9 spend basis rules (E19/E20) and the cohort aggregation", () => {
  assert.deepEqual(spendBasis({ cpl: 40, cpl_rate_period: "p1", cpl_resolution_status: "resolved" }), { basis: "rate", amount: 40 });
  assert.deepEqual(spendBasis({ cpl: 35, cpl_rate_period: null, cpl_resolution_status: null }), { basis: "legacy", amount: 35 }, "pre-rate-period Lead");
  assert.deepEqual(spendBasis({ cpl: 0, cpl_rate_period: null, cpl_resolution_status: "missing_rate" }), { basis: "unpriced", amount: 0 });
  assert.deepEqual(spendBasis({ cpl: 0, cpl_rate_period: "p1", cpl_resolution_status: "duplicate_zero" }), { basis: "zero", amount: 0 });
  assert.deepEqual(spendBasis({ cpl: 0, cpl_rate_period: null, cpl_resolution_status: "not_applicable" }), { basis: "zero", amount: 0 });
  assert.deepEqual(spendBasis({ cpl: 0, cpl_rate_period: null, cpl_resolution_status: null }), { basis: "zero", amount: 0 });
  const lead = (over: Partial<SpendLead>): SpendLead => ({ _id: new mongoose.Types.ObjectId(), model: "FormLead", cpl: 40, cpl_rate_period: "p1", cpl_resolution_status: "resolved",
    source_granularity_label_snapshot: "TBM Form", receiver_agent: A, ...over });
  const booked = lead({});
  const leads = [booked, lead({}), lead({}), lead({}), lead({ granot_priority: "5", quoted: true }),
    lead({ cpl: 25.5, cpl_rate_period: null, cpl_resolution_status: null, source_granularity_label_snapshot: "Legacy Web" }),
    lead({ cpl: 0, cpl_rate_period: null, cpl_resolution_status: "missing_rate", receiver_agent: B }),
    lead({ receiver_agent: null, model: "CallLead", source_granularity_label_snapshot: null, source_company: "Top10" })];
  const out = aggregateCohort(leads, new Set([`FormLead:${String(booked._id)}`]));
  assert.deepEqual(out.total, { leads: 8, spend: 265.5, rate: 240, legacy: 25.5, unpriced_leads: 1, zero_leads: 0,
    outcomes: { leads: 8, quoted: 1, booked_in_granot: 1, booked_official: 1, bookings: 2, booking_rate: 0.25 } });
  const a = out.by_rep.get(A)!;
  assert.deepEqual(a.spend, { leads: 6, spend: 225.5, rate: 200, legacy: 25.5, unpriced_leads: 0, zero_leads: 0 });
  assert.deepEqual(a.by_source[0], { source: "TBM Form", leads: 5, spend: 200, rate: 200, legacy: 0, unpriced_leads: 0, zero_leads: 0, unit_cpl: 40 }, "TBM Form · 5 × $40 = $200");
  assert.equal(a.cost_per_booking, 112.75, "spend ÷ the cohort's bookings (official or Granot, once each)");
  assert.equal(out.by_rep.get(B)!.cost_per_booking, null, "— when there are no bookings");
  assert.deepEqual(out.by_rep.get(B)!.spend.unpriced_leads, 1);
  assert.deepEqual(out.unassigned!.spend, { leads: 1, spend: 40, rate: 40, legacy: 0, unpriced_leads: 0, zero_leads: 0 });
  assert.equal(out.unassigned!.by_source[0]!.source, "Top10");
  const sum = [...out.by_rep.values()].reduce((n, r) => n + r.spend.spend, 0) + out.unassigned!.spend.spend;
  assert.equal(sum, out.total.spend, "Owner total = the sum of the rows, Unassigned included");
});

test("S9 desk: speed to lead, callbacks kept (isPromisedCallback, connected_contact_unknown), missed calls returned", () => {
  const policy = defaultCsiPolicy();
  const staffing = { timezone: policy.timezone, staffed_hours: policy.staffed_hours };
  const asOf = at("2026-09-24T18:00:00Z"); // Thursday 14:00 EDT
  const speed = speedToLead([
    { trigger_at: at("2026-09-24T13:00:00Z"), first_attributable_outbound_at: at("2026-09-24T13:10:00Z"), state: "open" },
    { trigger_at: at("2026-09-24T13:00:00Z"), first_attributable_outbound_at: at("2026-09-24T14:00:00Z"), state: "open" },
    { trigger_at: at("2026-09-24T17:00:00Z"), first_attributable_outbound_at: null, state: "unworked" },
    { trigger_at: at("2026-09-24T17:50:00Z"), first_attributable_outbound_at: null, state: "unworked" },
    { trigger_at: at("2026-09-24T12:00:00Z"), first_attributable_outbound_at: null, state: "closed" },
  ], asOf, staffing, 30);
  assert.deepEqual(speed, { leads: 5, worked: 2, median_staffed_minutes: 35, p90_staffed_minutes: 60, still_waiting: 2, missed_target: 2, target_staffed_minutes: 30 });
  const cb = (over: Partial<CallbackRow>): CallbackRow => ({ _id: new mongoose.Types.ObjectId(), kind: "call", origin: "rep_promise", status: "completed",
    due_at: at("2026-09-24T15:00:00Z"), completed_at: at("2026-09-24T14:55:00Z"), completion_basis: "call_attempt", disposition: "spoke_with_customer",
    date_resolution: { precision: "exact" }, ...over });
  const lateRoot = cb({ completed_at: at("2026-09-24T16:00:00Z") });
  const chainRoot = cb({ disposition: "no_answer", completed_at: at("2026-09-24T16:00:00Z"), status: "completed" });
  const rows = [cb({}), cb({ disposition: "no_answer" }), cb({ disposition: "connected_contact_unknown", origin: "customer_request" }), lateRoot, chainRoot,
    cb({ status: "open", completed_at: null, completion_basis: null, due_at: at("2026-09-24T17:00:00Z") }),
    cb({ status: "open", completed_at: null, completion_basis: null, due_at: at("2026-09-24T20:00:00Z") }),
    cb({ date_resolution: { precision: "day" } }), // not exact: not a promised callback
    cb({ origin: "system_default", promise_chain: { root_id: chainRoot._id, root_origin: "rep_promise" } })]; // a successor counts as its root
  const kept = callbacksKept(rows, new Set([String(chainRoot._id)]), asOf);
  assert.deepEqual(kept, { due: 7, kept: 3, kept_share: 3 / 6, kept_unreached: 1, kept_contact_unknown: 1, not_kept: 1, overdue_now: 2, pending: 1 });
  const missed = missedCallsReturned([
    { status: "completed", first_missed_at: at("2026-09-24T14:00:00Z"), due_at: at("2026-09-24T14:15:00Z"), completed_at: at("2026-09-24T14:10:00Z") },
    { status: "completed", first_missed_at: at("2026-09-24T14:00:00Z"), due_at: at("2026-09-24T14:15:00Z"), completed_at: at("2026-09-24T14:30:00Z") },
    { status: "open", first_missed_at: at("2026-09-24T17:00:00Z"), due_at: at("2026-09-24T17:15:00Z"), completed_at: null },
  ], staffing);
  assert.deepEqual(missed, { episodes: 3, returned_on_time: 1, returned_late: 1, still_open: 1, closed_unreturned: 0, on_time_share: 1 / 3, median_staffed_minutes_to_return: 20 });
});

test("S9 flow: baseline and policy rows are no movement; capture_repair is counted apart; time in band never reads a baseline", () => {
  const t = (subject: string, to: number, kind: string, iso: string, from: number | null = null) => ({ subject_key: subject, from_band: from, to_band: to, at: at(iso), cause: { kind } });
  const rows = [t("s1", 2, "baseline", "2026-09-24T12:00:00Z"), t("s1", 1, "clock", "2026-09-24T13:00:00Z", 2), t("s2", 3, "capture_repair", "2026-09-24T13:30:00Z", 5),
    t("s3", 4, "policy", "2026-09-24T14:00:00Z", 5), t("s4", 5, "call", "2026-09-24T15:00:00Z", 1)];
  const flow = bandFlow(rows, null);
  assert.deepEqual([flow.moves, flow.capture_repair, flow.excluded_baseline_or_policy, flow.into_band["1"], flow.into_band["5"], flow.out_of_band["2"]], [2, 1, 2, 1, 1, 1]);
  assert.equal(bandFlow(rows, new Set(["s4"])).moves, 1, "a filtered flow keeps its subjects only");
  const newestFirst = [...rows].sort((a, b) => +b.at - +a.at);
  const time = timeInBand(new Map([["s1", 1], ["s3", 4], ["s4", 5], ["s9", 6]]), newestFirst, at("2026-09-24T18:00:00Z"));
  assert.deepEqual(time["1"], { median_ms: 5 * 3_600_000, known: 1, unknown: 0 });
  assert.deepEqual(time["4"], { median_ms: null, known: 0, unknown: 1 }, "only a policy row: unknown, not zero");
  assert.deepEqual(time["6"], { median_ms: null, known: 0, unknown: 1 });
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentile([], 0.5), null);
});

test("S9 now: the Needs Attention tally with Priority and agent filters; per-rep open/bands/overdue (stub fallback until S9-PUBLISH)", () => {
  const entry = (i: number, over: Partial<AttentionIndexEntry["filter_keys"]> & { in_attention?: boolean; partition?: "active" | "closed"; reasons?: string[]; responsible?: string | null; overdue?: boolean }): AttentionIndexEntry => {
    const { in_attention = true, partition = "active", reasons = [], ...keys } = over;
    return { subject_key: `lead:FormLead:${String(i).padStart(24, "0")}`, partition, in_attention, sort_keys: {}, reasons, chunk_index: null, position: i,
      filter_keys: { band: null, needs_review: false, state: "open", agents: [], attachment: "lead", priority: null, has_recording: false, has_assessment: false, newer_call: false,
        ti: null, ml: null, received_at: null, move_date: null, outcome: null, closed_at: null, live_call: false, ...keys } as AttentionIndexEntry["filter_keys"] };
  };
  const entries = [
    entry(1, { band: 1, agents: [A], priority: "0", reasons: ["promised_callback_overdue"] }),
    entry(2, { band: 2, agents: [], priority: null, live_call: true }),
    entry(3, { band: 4, agents: [A, B], priority: "1", responsible: B, overdue: false, needs_review: true }),
    entry(4, { band: null, agents: [B], priority: "0", in_attention: false }),
    entry(5, { band: null, agents: [A], priority: "7", partition: "closed", state: "closed", outcome: "crm_dead" }),
  ];
  const all = tallyNow(entries, {}, at("2026-09-24T18:00:00Z"));
  assert.deepEqual(all.bands, { "1": 1, "2": 1, "3": 0, "4": 1, "5": 0, "6": 0, "7": 0 });
  assert.deepEqual([all.needs_review, all.unassigned, all.live_calls, all.active], [1, 1, 1, 4]);
  assert.deepEqual(all.by_rep.get(A), { agent_id: A, open: 1, bands: { "1": 1, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0 }, overdue: 1 });
  assert.deepEqual([all.by_rep.get(B)!.open, all.by_rep.get(B)!.overdue], [2, 0], "S9-PUBLISH's responsible key wins over the single-agent fallback");
  const newPreset = tallyNow(entries, { priority: ["0", "not_set"] }, at("2026-09-24T18:00:00Z"));
  assert.deepEqual([newPreset.bands["1"], newPreset.bands["2"], newPreset.bands["4"]], [1, 1, 0]);
  const scoped = tallyNow(entries, { agent_id: [B] }, at("2026-09-24T18:00:00Z"));
  assert.deepEqual([scoped.bands["4"], scoped.bands["1"], scoped.active], [1, 0, 2]);
  assert.equal(entryResponsible(entry(9, { agents: [A, B] })), null, "ambiguous without the publish key");
  assert.equal(entryOverdue(entry(9, { reasons: ["followups_due"] })), true);
});

test("S9 team medians (E23): over reps with an open assignment or a call; null metrics left out", () => {
  const row = (id: string, open: number, calls: number, spend: number, cpb: number | null) => ({ agent: { id, name: id }, open_assignments: { open, bands: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0 }, overdue: 0 },
    interactions: { outbound_attempts: calls, answered_inbound: 0, human_conversations: 0, talk_minutes: 0, attempt_conversation_rate: calls ? 0.5 : null, calls, recovered_calls: 0 },
    outcomes: { leads: 1, quoted: 0, booked_in_granot: 0, booked_official: 0, bookings: 0, booking_rate: 0 }, spend: { leads: 1, spend, rate: spend, legacy: 0, unpriced_leads: 0, zero_leads: 0 },
    by_source: [], cost_per_booking: cpb });
  const medians = teamMedians([row("r1", 2, 10, 100, 50), row("r2", 0, 4, 300, null), row("r3", 0, 0, 900, 10), row("r4", 6, 0, 200, 30)]);
  assert.equal(medians.reps, 3, "r3 has neither an open assignment nor a call");
  assert.equal(medians.open, 2);
  assert.equal(medians.outbound_attempts, 4);
  assert.equal(medians.spend, 200);
  assert.equal(medians.cost_per_booking, 40, "median of 50 and 30; r2's null is left out");
  assert.equal(medians.attempt_conversation_rate, 0.5);
});
