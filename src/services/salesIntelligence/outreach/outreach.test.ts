import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { readFileSync } from "node:fs";
import { defaultCsiPolicy } from "../policy";
import { addStaffedMinutes, localInstant, resolveActionDate, resolveActionDateText, staffedMinutesBetween } from "./staffing";
import { derive } from "./derive";
import { provenanceState } from "./reads";
import type { RecordRow } from "./types";
import { callFacts, fulfilledByCall, stateWithActions, officialClosure } from "./transitions";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { planOutreachEffect, outreachEffectInputSchema } from "./effects";
import { defaultStageHandlers } from "../../numberActivity/jobDispatch";
const policy = defaultCsiPolicy(), at = new Date("2026-09-18T23:50:00Z"), id = () => new mongoose.Types.ObjectId();
function record() { return new (getOutreachRecordModel())({ subject: { kind: "lead", model: "FormLead", id: id() }, state: "unworked", trigger_kind: "lead_arrival", trigger_at: at, policy_version: policy.version }).toObject(); }
function action(kind = "call", due: Date | null = null) { return new (getOutreachFollowupModel())({ outreach_record_id: id(), commitment_key: String(id()), kind, description: "Synthetic action", origin: "rep_promise", due_at: due, date_resolution: { precision: due ? "exact" : "unresolved", timezone: policy.timezone, anchor: at, policy_version: policy.version } }).toObject(); }
test("30/15/1440 clocks, Friday close, Sunday, DST and independent weekly calendar", () => {
  assert.equal(addStaffedMinutes(at, 30, policy).toISOString(), "2026-09-19T12:20:00.000Z");
  assert.equal(addStaffedMinutes(at, 15, policy).toISOString(), "2026-09-19T12:05:00.000Z");
  const start = new Date("2026-03-07T13:00:00Z");
  assert.equal(addStaffedMinutes(start, 1440, policy).toISOString(), "2026-03-10T00:00:00.000Z");
  assert.equal(staffedMinutesBetween(start, new Date("2026-03-10T00:00:00Z"), policy), 1440);
  assert.equal(localInstant("2026-11-01", 90, "America/New_York"), null);
  assert.equal(localInstant("2026-03-08", 150, "America/New_York"), null);
  const shorter = { ...policy, staffed_hours: policy.staffed_hours.map(s => ({ ...s, end_minute: 960 })) };
  assert.equal(shorter.going_cold_staffed_minutes, 1440);
});
test("day-only waits end at close; Attention next opening; explicit Sunday honoured; ambiguity undated", () => {
  const anchor = new Date("2026-09-18T12:00:00Z");
  const wait = resolveActionDate({ day: "2026-09-19", wait: true }, policy, anchor);
  assert.equal(wait.due_at?.toISOString(), "2026-09-20T00:00:00.000Z");
  assert.equal(wait.base_attention_due_at?.toISOString(), "2026-09-21T12:00:00.000Z");
  assert.equal(resolveActionDate({ exact: "2026-09-20T06:00:00Z" }, policy, anchor).due_at?.toISOString(), "2026-09-20T06:00:00.000Z");
  assert.equal(resolveActionDate({}, policy, anchor).due_at, null);
  assert.equal(resolveActionDate({ day: "2026-09-20" }, policy, anchor).due_at, null);
  assert.equal(resolveActionDateText("Friday", policy, anchor).due_at?.toISOString(), "2026-09-19T00:00:00.000Z");
  assert.equal(resolveActionDateText("Sunday at 2 pm", policy, anchor).due_at?.toISOString(), "2026-09-20T18:00:00.000Z");
  assert.equal(resolveActionDateText("Friday at 2", policy, anchor).due_at, null);
});
test("all three actions including undated; snooze preserves contractual overdue and other reasons", () => {
  const r = record(); r.state = "open";
  const a = action("call", new Date("2026-09-18T12:00:00Z")), b = action("send_estimate", new Date("2026-09-18T13:00:00Z")), c = action("check_availability");
  a.snoozed_until = new Date("2026-09-21T12:00:00Z");
  const result = derive(r, { now: at, policy, staffing: policy, followups: [a,b,c], restrictions: [{ state: "active", channels: ["call"], until: null }], reviewItems: [], coverage: {} });
  assert.equal(result.attention_band, 4); assert.equal(result.no_next_action, false);
  assert.equal(result.missing_action_responsibility.length, 3); assert.ok(result.review_badges.includes("missing_date"));
  assert.equal(result.actions[0]?.contractual_overdue, true); assert.equal(result.actions[0]?.overdue, false);
  assert.deepEqual(result.call_blockers, ["restriction"]); assert.ok(!result.reasons.includes("going_cold"));
});
test("snoozing overdue work does not hide Going cold; agreed future work still does", () => {
  const r = record(); r.state = "open";
  const now = new Date("2026-09-24T16:00:00Z");
  const a = action("call", new Date("2026-09-19T16:00:00Z"));
  a.snoozed_until = new Date("2026-09-25T16:00:00Z");
  const context = { now, policy, staffing: policy, followups: [a], restrictions: [], reviewItems: [], coverage: {} };
  assert.ok(derive(r, context).reasons.includes("going_cold"));
  assert.ok(!derive(r, context).reasons.includes("followups_due"));
  a.due_at = new Date("2026-09-25T16:00:00Z");
  assert.ok(!derive(r, context).reasons.includes("going_cold"));
  a.kind = "wait"; a.due_at = new Date("2026-09-24T15:00:00Z");
  a.base_attention_due_at = new Date("2026-09-25T12:00:00Z");
  assert.ok(!derive(r, context).reasons.includes("going_cold"));
});
test("inbound human versus missed/provider connected; attempts fulfill callback only and retain outcome", () => {
  const r = record(); const call = new (getCallInteractionModel())({ provider_account_id: "synthetic", identity_basis: "call_log_id", call_log_ids: ["c"], started_at: new Date(+at + 60000), direction: "Inbound", terminal: true,
    first_observed_at: at, last_observed_at: at, contact_type: "human_conversation", parties: [{ role: "user", extension_id: "101", connected: true, direction: "Inbound" }] }).toObject();
  const attribution = { lead_ref: { model: "FormLead" as const, id: String(r.subject.id) }, lead_effects_allowed: true, certainty: "likely" as const, certainty_label: "Likely" as const, blocked_reason: null, applicable_leads: [] };
  assert.equal(callFacts(r, call, attribution, ["alex"]).human, true);
  call.contact_type = "unknown"; call.provider_connected = true;
  assert.equal(callFacts(r, call, attribution, ["alex"]).human, false);
  call.direction = "Outbound"; call.parties[0]!.direction = "Outbound"; call.provider_connected = false;
  const facts = callFacts(r, call, attribution, []);
  assert.equal(facts.outboundAttempt, true); assert.equal(facts.outcome, "no_answer");
  assert.equal(fulfilledByCall(action(), call, facts), true);
  assert.equal(fulfilledByCall(action("send_estimate"), call, facts), false);
  assert.equal(fulfilledByCall(action("call", new Date(+at + 3600000)), call, facts), false);
  call.contact_type = "voicemail"; assert.equal(callFacts(r, call, attribution, []).outcome, "left_voicemail");
});
test("wait coexistence, official closure precedence, planning denies stale and Owner effects", () => {
  const r = record(); r.state = "open";
  const wait = action("wait", new Date(+at + 3600000));
  assert.equal(stateWithActions(r, [wait], at), "waiting_on_customer");
  assert.equal(stateWithActions(r, [wait, action("send_estimate")], at), "open");
  assert.equal(officialClosure({ booked: "b", duplicate: true }), "booked");
  const input = outreachEffectInputSchema.parse({ run_id: String(id()), finding_id: String(id()), finding_key: "f", outreach_record_id: String(r._id), interaction_id: String(id()), expected_revision: r.revision, kind: "create_followup", clear: true, history_complete: true });
  assert.equal(planOutreachEffect(input, { record: r, identityAllowed: true, ownerProtected: true }).status, "blocked_owner");
  r.state = "closed"; assert.equal(planOutreachEffect(input, { record: r, identityAllowed: true, ownerProtected: false }).status, "blocked_closed");
});
test("worker, cron and recovery registrations exist without enabling production flags", () => {
  assert.equal(typeof defaultStageHandlers().outreach_ensure, "function");
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  assert.ok(config.crons.some((c: { path: string }) => c.path === "/api/cron/sales-intelligence-outreach-ensure"));
  assert.match(readFileSync("src/routes/sales-intelligence-cron.routes.ts", "utf8"), /name: "outreach_ensure", flag: "OUTREACH_ENSURE"/);
});
test("provenance state reads the stored attachment mirror; no attached edge is Needs a lead", () => {
  const mirror = (over: Partial<NonNullable<RecordRow["lead_attachment"]>> = {}) => ({ attachment_id: id(), lead_ref: { model: "FormLead" as const, id: id() },
    state: "attached" as const, certainty: "likely" as const, decided_by: "evidence" as const, decided_at: null, confidence: null, observed_at: at, ...over });
  assert.equal(provenanceState(null), "needs_a_lead");
  assert.equal(provenanceState(mirror({ state: "candidate" })), "needs_a_lead");
  assert.equal(provenanceState(mirror({ state: "rejected", certainty: "rejected" })), "needs_a_lead");
  assert.equal(provenanceState(mirror({ state: "ambiguous", certainty: "unsure" })), "ambiguous");
  assert.equal(provenanceState(mirror({ certainty: "owner_confirmed", decided_by: "owner", decided_at: at })), "attached_by_you");
  assert.equal(provenanceState(mirror({ decided_by: "automatic", confidence: 0.9, decided_at: at })), "attached_automatically");
  assert.equal(provenanceState(mirror({ certainty: "exact" })), "attached_from_evidence");
});
