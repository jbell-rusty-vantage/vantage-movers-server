import assert from "node:assert/strict";
import { test } from "node:test";
import { salesOutreachConfigurationValueSchema } from "../../../validation/v1/salesOutreach";
import { completeConfigurationInput } from "../evaluation/testing";
import { localInstant } from "../engine/calendar";
import { poolDutyWindow, poolWinner, type PoolEvent } from "./policy";
import type { DeskRestrictionRow } from "../evaluation/store";
import { nominateLeadChanges } from "../subjects/feed";
import { normalizeQueueQuery } from "../reads/queue";
import { outreachLiveHint } from "../live/stream";
import { poolBookingBlocks } from "./admission";
import { Types } from "mongoose";

const date = "2026-10-14", tz = "America/New_York";
const at = (minute: number, day = date) => new Date(localInstant(day, minute, tz));
const value = () => salesOutreachConfigurationValueSchema.parse({ ...completeConfigurationInput({ desk_enabled: true, cadence_enforcement_enabled: true }),
  pool: { enabled: true, admission_enabled: false, policy_version: "pool-v1", approval_ref: "Owner20261014" } });
const event = (id: string, minute: number, extra: Partial<PoolEvent> = {}): PoolEvent => ({ id, event_at: at(minute), channel: "call", kind: "outbound_attempt",
  verification: "confirmed", actor_agent_id: "a".repeat(24), restricted_at_contact: false, association: "unique", ...extra });

test("Raw Booking anchors hold Pool despite legacy pointer type/model or absent/conflicting normalized Job", () => {
  const ref = { model: "FormLead" as const, id: "a".repeat(24) };
  for (const booking of [{ lead_ref: ref.id }, { lead_ref: new Types.ObjectId(ref.id) }, { lead_ref: ref.id.toUpperCase() },
    { job_no: "p123456" }, { job_no: "１２３４５６" }, { normalized_job_no: "OTHER", job_no: "  123456  " }, { normalized_job_no: "Q123456" }])
    assert.equal(poolBookingBlocks(booking, ref, "P123456"), true);
  assert.equal(poolBookingBlocks({ lead_ref: "b".repeat(24), normalized_job_no: "Q999999", job_no: "unrelated" }, ref, "P123456"), false);
});

test("Pool has one prospective daily window independent of episodes/receiver/Rep goals, cutoff inclusive and no prepayment", () => {
  const v = value();
  assert.equal(poolDutyWindow([{ started_at: at(1170), ended_at: null }], date, v).required, true);
  assert.equal(poolDutyWindow([{ started_at: at(1171), ended_at: null }], date, v).required, false);
  assert.equal(poolDutyWindow([{ started_at: at(1171), ended_at: null }], "2026-10-15", v).required, true);
  const episodes = [{ started_at: at(600), ended_at: at(660) }, { started_at: at(900), ended_at: null }];
  assert.equal(poolDutyWindow(episodes, date, v).due, +at(1200));
  assert.equal(poolDutyWindow(episodes, "2026-10-13", v).required, false);
  assert.equal(poolWinner([event("y", 600)], "2026-10-15", v), null);
});

test("Provider-confirmed outbound/inbound only; stable earliest event then ID, corrections and ordinary same-date transfer", () => {
  const v = value();
  const a = event("b", 650), b = event("a", 650);
  assert.equal(poolWinner([a, b], date, v)?.id, "a");
  assert.equal(poolWinner([a, { ...b, event_at: at(651) }], date, v)?.id, "b");
  for (const extra of [{ channel: "sms" }, { kind: "inbound_missed" }, { verification: "awaiting_confirmation" }, { association: "ambiguous" }, { actor_agent_id: null }, { restricted_at_contact: true }])
    assert.equal(poolWinner([event("excluded", 600, extra)], date, v), null, JSON.stringify(extra));
  assert.equal(poolWinner([event("in", 600, { kind: "inbound_answered" })], date, v)?.id, "in");
  assert.equal(poolWinner([event("prior", 600, { association: "none", association_reason: "before_activation" })], date, v)?.id, "prior");
  assert.equal(poolWinner([event("outside", 1200)], date, v), null);
});

test("Restrictions waive open daily work through release date and never manufacture a catch-up quota", () => {
  const v = value(), episodes = [{ started_at: at(600, "2026-10-13"), ended_at: null }];
  const restriction = { channels: ["call"], created_at: at(650), until: at(700), resolved_at: null, state: "expired", updated_at: at(700) } as DeskRestrictionRow;
  assert.equal(poolDutyWindow(episodes, date, v, [restriction]).waived, true);
  assert.equal(poolDutyWindow(episodes, "2026-10-15", v, [restriction]).required, true);
});

test("Dedicated Pool scope shares rows without receiver filtering; ordinary scope and foreign filter guards remain private", () => {
  const rep = { role: "rep", agent_id: "a".repeat(24), actor: {} } as Parameters<typeof normalizeQueueQuery>[0];
  assert.deepEqual(normalizeQueueQuery(rep, { queue_scope: "pool" }).match.assignment, { kind: "all" });
  assert.deepEqual(normalizeQueueQuery(rep, {}).match.assignment, { kind: "agent", agent_id: rep.agent_id });
  assert.throws(() => normalizeQueueQuery(rep, { queue_scope: "pool", agent_id: "b".repeat(24) }), /FORBIDDEN/);
  assert.equal(normalizeQueueQuery(rep, { workflow: "other" }).match.workflow, "other");
});

test("Accepted Pool changes nominate no-subject work even while ordinary expansion is off; safe hint broadcasts no foreign IDs", () => {
  const lead = { model: "FormLead" as const, id: "c".repeat(24) };
  const change = { id: "d".repeat(24), lead, command_name: "updateLeadFromGranot", revision_before: 2, revision_after: 3, applied_at: at(650), changed_paths: ["granot_priority"] };
  assert.equal(nominateLeadChanges([change], new Set(), false, false, true).length, 1);
  assert.equal(nominateLeadChanges([change], new Set(), false, false, false).length, 0);
  const hint = outreachLiveHint({ fullDocument: { topic: "outreach_pool", agent_ids: [], subject_ids: [], business_day: date, revision: null } }, { role: "rep", agent_id: "a".repeat(24) });
  assert.deepEqual(hint, { topic: "outreach_pool", agent_ids: [], subject_ids: [], business_day: date, revision: null });
});
