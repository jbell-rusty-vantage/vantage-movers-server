/**
 * S9-PUBLISH unit proofs (assignment addendum §6.3, reconciliation §4.3 / C12, C23), fixed clock.
 * America/New_York, staffed Mon–Sat 08:00–20:00 (the default policy). Sep 2026 is EDT (UTC−4); Nov 1 2026 falls back to EST.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { defaultCsiPolicy } from "../policy";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import type { FollowupRow, RecordRow } from "./types";
import { auditCause, bandSinceFromRow, estimateBandEntry, planBandRow, primaryReason, publishMeta, REASON_BAND, resolveBandCause, samePublishMeta,
  type CauseAudit } from "./bandTransitions";

const policy = defaultCsiPolicy();
const oid = () => new mongoose.Types.ObjectId();
const ET = (local: string) => new Date(`${local}:00${local >= "2026-11-01T02:00" ? "-05:00" : "-04:00"}`);
const AS_OF = ET("2026-09-24T15:00"); // Thursday
const TRIGGER = ET("2026-09-21T09:00"); // Monday

function record(over: Partial<RecordRow> = {}): RecordRow {
  const row = new (getOutreachRecordModel())({ subject: { kind: "lead", model: "FormLead", id: oid() }, state: "open", trigger_kind: "lead_arrival",
    trigger_at: TRIGGER, first_action_due_at: ET("2026-09-21T09:30"), policy_version: policy.version, responsible_agent_id: oid() }).toObject() as RecordRow;
  return Object.assign(row, over);
}
function followup(over: Record<string, unknown> = {}): FollowupRow {
  const due = (over.due_at as Date | undefined) ?? ET("2026-09-24T09:00");
  return new (getOutreachFollowupModel())({ outreach_record_id: oid(), commitment_key: String(oid()), kind: "call", description: "Synthetic", origin: "rep_promise",
    due_at: due, base_attention_due_at: due, responsible_agent_id: oid(),
    date_resolution: { precision: "exact", timezone: policy.timezone, anchor: TRIGGER, policy_version: policy.version }, ...over }).toObject() as FollowupRow;
}
const estimate = (band: number | null, reason: string | null, rec: RecordRow, actions: FollowupRow[] = [], asOf = AS_OF) =>
  estimateBandEntry({ record: rec, actions, band, reason, policy, asOf }).toISOString();

test("primary reason: the first reason that belongs to the band, secondary reasons skipped", () => {
  assert.equal(primaryReason(7, ["no_call_observed", "going_cold"]), "going_cold");
  assert.equal(primaryReason(1, ["promised_callback_overdue", "promised_by:rep", "followups_due", "going_cold"]), "promised_callback_overdue");
  assert.equal(primaryReason(2, ["new_not_yet_due", "missing_responsibility"]), "new_not_yet_due");
  assert.equal(primaryReason(4, ["promise_unreached", "no_next_step"]), "promise_unreached");
  assert.equal(primaryReason(null, ["going_cold"]), null);
  assert.equal(primaryReason(5, ["unreached"]), null, "no band reason recorded");
  assert.deepEqual([...new Set(Object.values(REASON_BAND))].sort(), [1, 2, 3, 4, 5, 6, 7]);
});

test("baseline estimate, band 1: the earliest due promised callback", () => {
  const a = followup({ due_at: ET("2026-09-24T11:00") }), b = followup({ due_at: ET("2026-09-24T09:00") });
  const system = followup({ due_at: ET("2026-09-23T09:00"), origin: "system_default" });
  const future = followup({ due_at: ET("2026-09-25T09:00") });
  assert.equal(estimate(1, "promised_callback_overdue", record(), [a, b, system, future]), ET("2026-09-24T09:00").toISOString());
  const snoozed = followup({ due_at: ET("2026-09-24T08:00"), snoozed_until: ET("2026-09-24T10:30") });
  assert.equal(estimate(1, "promised_callback_overdue", record(), [a, snoozed]), ET("2026-09-24T10:30").toISOString(), "a snooze moves the Attention due time");
});

test("baseline estimate, band 2: trigger_at, or first_action_due_at for no_call_yet", () => {
  const rec = record({ state: "unworked" });
  assert.equal(estimate(2, "no_call_yet", rec), ET("2026-09-21T09:30").toISOString());
  assert.equal(estimate(2, "new_not_yet_due", rec), TRIGGER.toISOString());
  assert.equal(estimate(2, "no_call_yet", record({ state: "unworked", first_action_due_at: null })), TRIGGER.toISOString());
});

test("baseline estimate, band 3: the open missed-call episode's first_missed_at", () => {
  const episode = followup({ origin: "system_default", missed_episode_key: "n1", first_missed_at: ET("2026-09-23T17:40"), due_at: ET("2026-09-23T17:55") });
  const done = followup({ origin: "system_default", missed_episode_key: "n0", first_missed_at: ET("2026-09-22T10:00"), status: "completed" });
  assert.equal(estimate(3, "missed_call_no_callback", record(), [episode, done]), ET("2026-09-23T17:40").toISOString());
});

test("baseline estimate, band 4: earliest due; inbound + staffed window", () => {
  const due = followup({ due_at: ET("2026-09-23T16:00"), origin: "customer_request" });
  assert.equal(estimate(4, "followups_due", record(), [due, followup({ due_at: ET("2026-09-24T12:00") })]), ET("2026-09-23T16:00").toISOString());
  // Mon 18:00 + 240 staffed minutes: 2 h to Mon 20:00, 2 h from Tue 08:00 → Tue 10:00.
  const inbound = record({ last_inbound_human_at: ET("2026-09-21T18:00") } as Partial<RecordRow>);
  assert.equal(estimate(4, "no_callback_after_inbound", inbound), ET("2026-09-22T10:00").toISOString());
});

test("baseline estimate, band 5: newest completion, else first work observed, else first attempt", () => {
  const done1 = followup({ status: "completed", completed_at: ET("2026-09-22T11:00") }), done2 = followup({ status: "completed", completed_at: ET("2026-09-23T12:30") });
  assert.equal(estimate(5, "no_next_step", record(), [done1, done2]), ET("2026-09-23T12:30").toISOString());
  const progress = record({ lead_progress: { first_work_observed_at: ET("2026-09-22T14:00") } } as unknown as Partial<RecordRow>);
  assert.equal(estimate(5, "no_next_step", progress), ET("2026-09-22T14:00").toISOString());
  const attempt = record({ first_attributable_outbound_at: ET("2026-09-21T10:15"), first_human_conversation_at: ET("2026-09-21T13:00") });
  assert.equal(estimate(5, "no_next_step", attempt), ET("2026-09-21T10:15").toISOString());
  assert.equal(estimate(5, "no_next_step", record()), TRIGGER.toISOString(), "nothing observed: the trigger");
});

test("baseline estimate, band 6: trigger_at", () => {
  assert.equal(estimate(6, "missing_responsibility", record({ responsible_agent_id: null })), TRIGGER.toISOString());
});

test("baseline estimate, band 7: last activity plus the staffed going-cold threshold, across a Sunday and DST", () => {
  // Sat 18:00 + 1440 staffed min: 2 h Sat, 12 h Mon, 10 h Tue → Tue 18:00.
  const rec = record({ last_activity_at: ET("2026-09-19T18:00"), last_meaningful_contact_at: ET("2026-09-18T10:00") } as Partial<RecordRow>);
  assert.equal(estimate(7, "going_cold", rec), ET("2026-09-22T18:00").toISOString());
  const noActivity = record({ last_meaningful_contact_at: ET("2026-09-19T18:00") });
  assert.equal(estimate(7, "going_cold", noActivity), ET("2026-09-22T18:00").toISOString(), "falls back to the last human contact");
  // DST: Sat Oct 31 18:00 EDT → Tue Nov 3 18:00 EST.
  const dst = record({ trigger_at: ET("2026-10-30T09:00"), last_activity_at: ET("2026-10-31T18:00") } as Partial<RecordRow>);
  assert.equal(estimate(7, "going_cold", dst, [], ET("2026-11-05T12:00")), ET("2026-11-03T18:00").toISOString());
  assert.equal(ET("2026-11-03T18:00").toISOString(), "2026-11-03T23:00:00.000Z");
});

test("baseline estimate never lands after as_of", () => {
  const rec = record({ last_activity_at: ET("2026-09-24T14:00") } as Partial<RecordRow>);
  assert.equal(estimate(7, "going_cold", rec), AS_OF.toISOString());
});

const change = (over: Partial<Parameters<typeof planBandRow>[0]> = {}) => planBandRow({ mode: "compare", previous: undefined, record_id: String(oid()), subject_key: "lead:FormLead:x",
  band: 4, reason: "followups_due", revision: 3, asOf: AS_OF, estimate: () => ET("2026-09-23T10:00"), ...over });

test("C12 / band_since: unchanged writes nothing and carries band_since forward", () => {
  const since = { at: ET("2026-09-22T12:00").toISOString(), estimated: false };
  const plan = change({ previous: { band: 4, reason: "followups_due", band_since: since, revision: 3 } });
  assert.equal(plan.change, null);
  assert.deepEqual(plan.band_since, since);
});

test("C12: a band change writes exactly one row with band_since = as_of", () => {
  const plan = change({ previous: { band: 2, reason: "no_call_yet", band_since: { at: TRIGGER.toISOString(), estimated: true }, revision: 2 } });
  assert.ok(plan.change);
  assert.deepEqual({ from: plan.change.from_band, to: plan.change.to_band, fr: plan.change.from_reason, tr: plan.change.to_reason, same: plan.change.same_revision },
    { from: 2, to: 4, fr: "no_call_yet", tr: "followups_due", same: false });
  assert.equal(plan.change.at.toISOString(), AS_OF.toISOString());
  assert.deepEqual(plan.band_since, { at: AS_OF.toISOString(), estimated: false });
});

test("a reason-only change writes a row and keeps band_since", () => {
  const since = { at: ET("2026-09-22T12:00").toISOString(), estimated: true };
  const plan = change({ band: 2, reason: "no_call_yet", previous: { band: 2, reason: "new_not_yet_due", band_since: since, revision: 3 } });
  assert.equal(plan.change?.to_reason, "no_call_yet");
  assert.equal(plan.change?.same_revision, true);
  assert.deepEqual(plan.band_since, since);
  assert.deepEqual(plan.change?.band_since, since);
});

test("carry-forward from a snapshot without band_since estimates; a new row enters from null; no band is null", () => {
  assert.deepEqual(change({ previous: { band: 4, reason: "followups_due" } }).band_since, { at: ET("2026-09-23T10:00").toISOString(), estimated: true });
  const joined = change({ previous: undefined });
  assert.equal(joined.change?.from_band, null);
  assert.equal(joined.change?.same_revision, null);
  const none = change({ band: null, reason: null, previous: { band: 5, reason: "no_next_step", revision: 3 } });
  assert.equal(none.band_since, null);
  assert.equal(none.change?.to_band, null);
  assert.equal(change({ band: null, reason: null, previous: undefined }).change, null, "null to null is no change");
});

test("C23: the baseline plans one estimated row per active row; estimate_only writes none", () => {
  const plan = change({ mode: "baseline", previous: { band: 4, reason: "followups_due", revision: 3 } });
  assert.deepEqual(plan.change?.cause, { kind: "baseline" });
  assert.equal(plan.change?.estimated, true);
  assert.equal(plan.change?.at.toISOString(), ET("2026-09-23T10:00").toISOString());
  assert.deepEqual(plan.band_since, { at: ET("2026-09-23T10:00").toISOString(), estimated: true });
  const unbanded = change({ mode: "baseline", band: null, reason: null });
  assert.equal(unbanded.change?.to_band, null);
  assert.equal(unbanded.band_since, null);
  const only = change({ mode: "estimate_only" });
  assert.equal(only.change, null);
  assert.equal(only.band_since?.estimated, true);
});

const audit = (event_kind: string, over: Partial<CauseAudit> = {}): CauseAudit => ({ _id: oid(), subject_key: "lead:FormLead:x", event_kind,
  recorded_at: ET("2026-09-24T14:59"), actor: { kind: "worker" }, invalidation: { kind: "outreach", target_id: String(oid()) }, current: {}, ...over });

test("cause mapping from event_kind and actor", () => {
  const call = String(oid());
  const table: Array<[CauseAudit, string | null]> = [
    [audit("outreach_call_applied", { invalidation: { kind: "interaction", target_id: call }, current: { interaction_id: call } }), "call"],
    [audit("outreach_interaction"), "call"],
    [audit("call_fulfilled_action", { invalidation: { kind: "followup", target_id: "f" }, current: { evidence_interaction_id: call } }), "call"],
    [audit("missed_call_episode", { invalidation: { kind: "followup", target_id: "f" } }), "call"],
    [audit("lead_progress_updated"), "lead_progress"],
    [audit("progress_default_created", { invalidation: { kind: "followup", target_id: "f" } }), "lead_progress"],
    [audit("intelligence_followup_created", { invalidation: { kind: "followup", target_id: "f" } }), "followup"],
    [audit("wait_expired", { invalidation: { kind: "followup", target_id: "f" } }), "followup"],
    [audit("assign", { actor: { kind: "owner" } }), "owner"],
    [audit("snooze_followup", { actor: { kind: "owner" }, invalidation: { kind: "followup", target_id: "f" } }), "owner"],
    [audit("outreach_closed", { current: { closure_origin: "official" } }), "booking"],
    [audit("outreach_closed", { current: { closure_origin: "crm_disposition" } }), "lead_progress"],
    [audit("outreach_created"), "lead_progress"],
    [audit("outreach_created", { subject_key: "number:abc" }), "call"],
    [audit("clock_boundary"), null],
    [audit("media_played", { actor: { kind: "owner" } }), null],
    [audit("review_opened", { invalidation: { kind: "review", target_id: "r" } }), null],
  ];
  for (const [event, kind] of table) assert.equal(auditCause(event)?.kind ?? null, kind, event.event_kind);
  assert.equal(auditCause(table[0]![0])?.interaction_id, call);
  assert.equal(auditCause(table[2]![0])?.interaction_id, call);
});

test("cause resolution: newest mappable event wins; unmapped skipped; clock when nothing", () => {
  const older = audit("lead_progress_updated", { recorded_at: ET("2026-09-24T14:58") });
  const newer = audit("assign", { actor: { kind: "owner" }, recorded_at: ET("2026-09-24T14:59") });
  const noise = audit("review_opened", { recorded_at: ET("2026-09-24T15:00"), invalidation: { kind: "review", target_id: "r" } });
  const resolved = resolveBandCause({ same_revision: false }, [older, noise, newer], false, new Set());
  assert.equal(resolved.kind, "owner");
  assert.equal(resolved.audit_id, String(newer._id));
  assert.equal(resolveBandCause({ same_revision: false }, [noise], false, new Set()).kind, "clock");
  assert.equal(resolveBandCause({ same_revision: true }, [], false, new Set()).kind, "clock");
});

test("C23: policy when publish_meta changed and the record revision did not move", () => {
  const event = audit("lead_progress_updated");
  assert.equal(resolveBandCause({ same_revision: true }, [event], true, new Set()).kind, "policy", "revision unchanged: policy even beside an audit row");
  assert.equal(resolveBandCause({ same_revision: false }, [event], true, new Set()).kind, "lead_progress", "the record moved: its event");
  assert.equal(resolveBandCause({ same_revision: null }, [], true, new Set()).kind, "policy", "unknown revision, nothing audited: policy");
  assert.equal(resolveBandCause({ same_revision: null }, [], false, new Set()).kind, "clock");
});

test("C23: capture_repair when the latest cause call was recovered", () => {
  const recovered = String(oid()), plain = String(oid());
  const applied = (id: string) => audit("outreach_call_applied", { invalidation: { kind: "interaction", target_id: id }, current: { interaction_id: id } });
  const r = resolveBandCause({ same_revision: false }, [applied(recovered)], false, new Set([recovered]));
  assert.deepEqual([r.kind, r.target_id], ["capture_repair", recovered]);
  assert.equal(resolveBandCause({ same_revision: false }, [applied(plain)], false, new Set([recovered])).kind, "call");
  // `outreach_interaction` (no call id) is the newest row of the call transaction: the call id comes from the call's own row.
  const interaction = audit("outreach_interaction", { recorded_at: ET("2026-09-24T15:00") });
  assert.equal(resolveBandCause({ same_revision: false }, [applied(recovered), interaction], false, new Set([recovered])).kind, "capture_repair");
});

test("publish_meta: policy version and the eight flags", () => {
  const on = new Set(["ATTENTION_V2", "ATTENTION_EVOLUTION"]);
  const a = publishMeta("v1", name => on.has(name));
  assert.deepEqual(Object.keys(a.flags), ["ATTENTION_V2", "ATTENTION_EVOLUTION", "CASE_FILE", "PROGRESS_PLAN", "PRIORITY5_CLOSURE", "RECEIVER_ASSIGNMENT", "RECEIVER_LATEST_WINS", "OVERVIEW"]);
  assert.equal(samePublishMeta(a, publishMeta("v1", name => on.has(name))), true);
  assert.equal(samePublishMeta(a, publishMeta("v2", name => on.has(name))), false, "policy version");
  assert.equal(samePublishMeta(a, publishMeta("v1", name => on.has(name) || name === "CASE_FILE")), false, "a flag flip");
  assert.equal(samePublishMeta(a, null), false);
});

test("detail band_since from the newest transition row", () => {
  const since = { at: ET("2026-09-22T12:00"), estimated: true };
  assert.deepEqual(bandSinceFromRow({ to_band: 4, at: AS_OF, estimated: false, band_since: since }, 4), { at: since.at.toISOString(), estimated: true });
  assert.deepEqual(bandSinceFromRow({ to_band: 4, at: AS_OF, estimated: false, band_since: null }, 4), { at: AS_OF.toISOString(), estimated: false });
  assert.equal(bandSinceFromRow({ to_band: 3, at: AS_OF, estimated: false, band_since: since }, 4), null, "band moved after the last publish");
  assert.equal(bandSinceFromRow(null, 4), null);
  assert.equal(bandSinceFromRow({ to_band: 4, at: AS_OF, estimated: false, band_since: since }, null), null);
});
