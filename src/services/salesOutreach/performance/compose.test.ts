import assert from "node:assert/strict";
import { test } from "node:test";
import { salesOutreachPerformanceSchema } from "../../../validation/v1/salesOutreachPerformance";
import type { EngineObligation } from "../engine";
import { addDays } from "../engine/calendar";
import { composeTeamPerformance, type PerformanceInput, type PerformanceCallDay } from "./compose";

const A = "a".repeat(24), B = "b".repeat(24);
const date = "2026-10-12";
function input(changes: Partial<PerformanceInput> = {}): PerformanceInput {
  return { now: new Date("2026-10-15T16:00:00Z"), week_start: date, closing_minute: 1200,
    names: new Map([[A, "Alice"], [B, "Bob"]]), active_agent_ids: new Set([A]), calls: [], volumes: [], requirements: [],
    earliest: { calls: date, text_volume: date, text_requirements: date }, call_freshness: "2026-10-15T15:59:00Z",
    sms_freshness: "2026-10-15T16:00:00Z", sms_inventory_complete: true, ...changes };
}
const call = (business_date: string, actual: number, goal = 100, agent_id = A): PerformanceCallDay => ({ business_date, actual, goal, agent_id, awaiting: 0, coverage: "complete" });
function sms(id: string, business_date = date, changes: Partial<EngineObligation> = {}): EngineObligation {
  return { obligation_id: id, period_id: "p1", channel: "sms", kind: "ordinary", business_date, slot_index: 0,
    opens_at: `${business_date}T12:00:00Z`, due_at: `${addDays(business_date, 1)}T00:00:00Z`, closes_at: `${addDays(business_date, 1)}T00:00:00Z`,
    outcome: "fulfilled", fulfilled_by_event_id: "event1", fulfilled_at: `${business_date}T23:00:00Z`, deadline_missed: false,
    responsible_agent_id: A, inherited: false, plan_id: null, ...changes } as EngineObligation;
}

test("call ranking measures days met, never a pooled weekly target, and excludes unfinished today", () => {
  const result = composeTeamPerformance(input({ calls: [call(date, 100), call(addDays(date, 1), 130), call(addDays(date, 2), 70), call(addDays(date, 3), 200)] }));
  assert.equal(result.rows[0]!.calls.weekly_volume, 500);
  assert.equal(result.rows[0]!.calls.met_days, 2);
  assert.equal(result.rows[0]!.calls.eligible_days, 3);
  assert.equal(result.rows[0]!.calls.completion_rate, 2 / 3);
  assert.equal(result.rows[0]!.days[3]!.calls.state, "met");
  assert.equal(result.rows[0]!.days[4]!.calls.state, "upcoming");
  assert.ok(salesOutreachPerformanceSchema.safeParse(result).success);
});

test("texts weight obligations; helper volume remains independent of responsibility", () => {
  const requirements = [
    { business_date: date, obligations: [sms("1")], coverage_through: "2026-10-15T16:00:00Z" },
    { business_date: addDays(date, 1), obligations: Array.from({ length: 9 }, (_, i) => sms(`2-${i}`, addDays(date, 1), i ? { outcome: "missed", fulfilled_at: null, deadline_missed: true } : {})), coverage_through: "2026-10-15T16:00:00Z" },
  ];
  const result = composeTeamPerformance(input({ requirements, volumes: [{ agent_id: B, business_date: date, confirmed: 80, pending: 0 }] }));
  const a = result.rows.find((r) => r.agent_id === A)!, b = result.rows.find((r) => r.agent_id === B)!;
  assert.equal(a.texts.completion_rate, 0.2); assert.equal(a.texts.on_time_required, 2); assert.equal(a.texts.resolved_due_required, 10);
  assert.equal(a.texts.weekly_volume, 0); assert.equal(b.texts.weekly_volume, 80); assert.equal(b.texts.rank, null);
  assert.equal(b.historical_membership_state, "historical");
});

test("a zero denominator is unranked; unknown history never manufactures a zero", () => {
  const r = composeTeamPerformance(input({ sms_inventory_complete: false, earliest: { calls: null, text_volume: null, text_requirements: null } })).rows[0]!;
  assert.equal(r.calls.completion_rate, null); assert.equal(r.texts.completion_rate, null);
  assert.equal(r.calls.rank, null); assert.equal(r.texts.rank, null); assert.equal(r.texts.weekly_volume, null);
  assert.equal(r.days[0]!.texts.state, "pending_data");
});

test("a capped subject input creates Pending data, never a false no-texts-due day", () => {
  const r = composeTeamPerformance(input({ requirements: [{ business_date: date, obligations: [], coverage_through: "2026-10-15T16:00:00Z", input_complete: false }] })).rows[0]!;
  assert.equal(r.days[0]!.texts.state, "pending_data");
  assert.equal(r.days[0]!.texts.coverage, "partial");
  assert.equal(r.texts.provisional, true);
  assert.equal(r.texts.completion_rate, null);
});
