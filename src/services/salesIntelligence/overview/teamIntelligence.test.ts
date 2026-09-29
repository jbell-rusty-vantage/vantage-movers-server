import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { attentionQuerySchema } from "../outreach/attention";
import { entryMatchesAttentionQuery, type AttentionIndexEntry } from "../outreach/attentionIndex";
import { rosterQuerySchema, selectRoster, type RosterAgent } from "../roster";
import { buildTeamWorkload, teamQuerySchema } from "./team";
import { buildActivity, activityDayCoverage, activityQuerySchema } from "./activity";
import { readPeriod } from "./queryPeriod";
import { cohortOutcomes } from "./outcomes";
import type { RepDayCall } from "./repDays";
import type { TemporalRepLink } from "../repIdentity/resolve";

const NOW = new Date("2026-09-29T18:00:00Z");
const A = "a".repeat(24), S = "b".repeat(24), T = "c".repeat(24), R = "d".repeat(24), X = "e".repeat(24);
const agents: RosterAgent[] = [[A, "Alex", true], [S, "Sam", true], [T, "Taylor", true], [R, "Riley", false], [X, "Inactive without work", false]]
  .map(([id, name, active]) => ({ _id: new mongoose.Types.ObjectId(String(id)), name: String(name), active: active === true }));
function entry(key: string, responsible: string | null, followups: Array<{ agent_id: string; actions: number; overdue: number; due_today: number }> = [], closed = false): AttentionIndexEntry {
  return { subject_key: key, partition: "active", in_attention: true, reasons: [], sort_keys: {}, chunk_index: 0, position: 0,
    filter_keys: { band: 4, needs_review: closed, state: closed ? "closed" : "open", agents: [...new Set([responsible, ...followups.map(f => f.agent_id)].filter((x): x is string => Boolean(x)))],
      responsible, followup_agents: followups.map(f => f.agent_id), followup_counts: followups,
      attachment: "lead", priority: "1", has_recording: false, has_assessment: false, newer_call: false, ti: null, ml: null,
      received_at: null, move_date: null, outcome: null, closed_at: closed ? NOW.toISOString() : null,
      work: { overdue_followup: followups.some(f => f.overdue > 0), due_today: followups.some(f => f.due_today > 0), no_next_step: !followups.length, blocked: false },
      loc: { pickup: null, delivery: null } } };
}
const entries = [entry("A", A, [{ agent_id: S, actions: 2, overdue: 2, due_today: 2 }]), entry("B", S),
  entry("U", null, [{ agent_id: S, actions: 1, overdue: 0, due_today: 0 }]), entry("C", R), entry("K", A, [], true)];
const index = { snapshot_id: "outreach:oi-c-fixture", as_of: NOW, entries };

test("OI-C roster is the active catalog plus inactive open work; promises and closed work do not grant membership", () => {
  const roster = selectRoster(agents, entries, {});
  assert.deepEqual(roster.map(a => a.name), ["Alex", "Riley", "Sam", "Taylor"]);
  assert.deepEqual(roster.find(a => a.id === R), { id: R, name: "Riley", active: false, has_open_work: true });
  assert.equal(roster.find(a => a.id === T)?.has_open_work, false);
  assert.equal(selectRoster(agents, [entry("closed", X, [], true)], {}).some(a => a.id === X), false);
  assert.equal(selectRoster(agents, entries, { include_inactive: "true" }).length, 5);
  assert.equal(selectRoster(agents, entries, rosterQuerySchema.parse({ q: " RIL " })).length, 1);
  assert.deepEqual(selectRoster(agents, entries, { include_inactive: "true" }, { agent_id: S }).map(a => a.id), [S]);
});

test("OI-C exact fixture, action multiplicity and all count drills share the frozen S2 predicate", () => {
  const result = buildTeamWorkload(index, agents, teamQuerySchema.parse({}));
  const alex = result.rows.find(row => row.agent.id === A)!, sam = result.rows.find(row => row.agent.id === S)!;
  assert.deepEqual([alex.assigned.count, alex.records_with_overdue.count, sam.assigned.count, sam.followups.actions.count, sam.followups.records.count,
    sam.followups_overdue.actions.count, sam.followups_overdue.records.count], [1, 1, 1, 3, 2, 2, 1]);
  assert.equal(result.unassigned?.assigned.count, 1); assert.equal(result.attention.needs_review.count, 1);
  assert.equal(result.rows.find(row => row.agent.id === T)?.assigned.count, 0);
  const verify = (value: unknown, path = "") => {
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    if ("count" in obj && "drill" in obj) {
      const params = (obj.drill as { params: Record<string, unknown> }).params;
      assert.equal(params.snapshot_id, index.snapshot_id);
      const query = attentionQuerySchema.parse(params);
      const matches = entries.filter(row => entryMatchesAttentionQuery(row, query, { as_of: NOW }));
      const expected = path.endsWith("actions") ? matches.reduce((sum, row) => sum + (row.filter_keys.followup_counts?.find(f => f.agent_id === (query.followup_agent_id ?? [])[0])?.[path.includes("followups_overdue") ? "overdue" : "actions"] ?? 0), 0) : matches.length;
      assert.equal(obj.count, expected, path);
    } else for (const [key, child] of Object.entries(obj)) verify(child, `${path}.${key}`);
  };
  verify(result);
  const rep = buildTeamWorkload(index, agents, teamQuerySchema.parse({}), { agent_id: S });
  assert.deepEqual(rep.rows.map(row => row.agent.id), [S]); assert.equal(rep.unassigned, null);
  assert.equal(rep.rows[0]!.followups.actions.count, 3);
});

test("OI-C 50 Agents / 10,000 records workload warm pure read p95 budget", () => {
  const roster = Array.from({ length: 50 }, (_, i) => ({ _id: new mongoose.Types.ObjectId((i + 1).toString(16).padStart(24, "0")), name: `Agent ${i}`, active: true }));
  const rows = Array.from({ length: 10_000 }, (_, i) => entry(String(i), String(roster[i % 50]!._id), [{ agent_id: String(roster[(i + 1) % 50]!._id), actions: 1, overdue: i % 3 === 0 ? 1 : 0, due_today: 0 }]));
  const snapshot = { ...index, entries: rows };
  const elapsed: number[] = [];
  for (let i = 0; i < 12; i++) { const start = performance.now(); const result = buildTeamWorkload(snapshot, roster, {}); if (i > 1) elapsed.push(performance.now() - start); assert.equal(result.rows.length, 50); }
  elapsed.sort((a, b) => a - b);
  const p95 = elapsed[Math.ceil(elapsed.length * .95) - 1]!;
  console.log(JSON.stringify({ fixture: "50 Agents/10000 records", warm_samples: elapsed.length, pure_read_p95_ms: Math.round(p95) }));
  assert.ok(p95 < 1000, `pure workload read p95 ${p95}ms`);
});

test("OI-C transferred call once for team, once per rep; missing capture day is null and rep cannot see others", () => {
  const period = readPeriod("today", NOW);
  const links: TemporalRepLink[] = [A, S].map((agent_id, i) => ({ _id: String(i), revision: 1, agent_id, rc_account_id: "acct", rc_extension_id: String(i),
    role_kind: "sales_rep", status: "reviewed", effective_from: new Date("2026-01-01"), reviewed_by: "owner", reviewed_at: new Date("2026-01-01") }));
  const call: RepDayCall = { _id: "transferred", provider_account_id: "acct", started_at: new Date("2026-09-29T15:00:00Z"), direction: "Outbound", contact_type: "human_conversation",
    parties: [0, 1].map(i => ({ role: "user", extension_id: String(i), connected: true, direction: "Outbound" })) };
  const complete = [{ from: period.start, through: period.end, complete: true }];
  const result = buildActivity(period, [call], links, complete);
  assert.deepEqual(result.totals, { human_conversations: 1, outbound_attempts: 1 });
  assert.deepEqual(result.by_rep.map(r => r.human_conversations), [1, 1]);
  assert.deepEqual(result.by_rep.map(r => r.last_conversation_at), [call.started_at.toISOString(), call.started_at.toISOString()]);
  const latest = { ...call, _id: "latest", started_at: new Date("2026-09-29T16:00:00Z"), parties: [call.parties![0]!] };
  const attempt = { ...latest, _id: "attempt", started_at: new Date("2026-09-29T17:00:00Z"), contact_type: "voicemail" as const };
  const ordered = buildActivity(period, [attempt, latest, call], links, complete);
  assert.equal(ordered.by_rep.find(r => r.agent_id === A)?.last_conversation_at, latest.started_at.toISOString());
  assert.equal(ordered.by_rep.find(r => r.agent_id === S)?.last_conversation_at, call.started_at.toISOString());
  assert.equal(buildActivity(period, [attempt], links, complete).by_rep[0]?.last_conversation_at, null);
  assert.equal(buildActivity(period, [call], links, complete, { agent_id: S }).by_rep.length, 1);
  const week = buildActivity(readPeriod("last_7_days", NOW), [call], links, complete);
  assert.equal(week.coverage[0]?.human_conversations, null); assert.equal(week.totals.human_conversations, null);
  assert.ok(week.by_rep.every(r => r.last_conversation_at === null));
  assert.equal(activityDayCoverage(period.start, period.end, [], false), "missing");
  assert.equal(activityDayCoverage(period.start, period.end, [], true), "partial");
  const middle = new Date((+period.start + +period.end) / 2);
  assert.equal(activityDayCoverage(period.start, period.end, [{ from: period.start, through: middle, complete: true }, { from: middle, through: period.end, complete: true }], false), "complete");
  assert.equal(activityDayCoverage(period.start, period.end, [{ from: period.start, through: middle, complete: true }, { from: new Date(+middle + 1), through: period.end, complete: true }], false), "partial");
  for (const invalid of [{ period: "custom" }, { period: "today", from: "2026-09-29" }, { period: "custom", from: "2026-02-30", through: "2026-03-01" }]) assert.equal(activityQuerySchema.safeParse(invalid).success, false);
  assert.throws(() => readPeriod("today", NOW, "2026-09-28"));
  assert.throws(() => readPeriod("custom", NOW, "2026-09-29", "2026-09-28"));
});

test("OI-C outcomes count Leads with official Booking and Granot independently, without summing Booking rows", () => {
  assert.deepEqual(cohortOutcomes([{ _id: A, model: "FormLead", quoted: true, granot_priority: "5", booked: S }, { _id: S, model: "CallLead" }],
    new Set([`FormLead:${A}`, `CallLead:${S}`])), { leads_received: 2, quoted: 1, booked_official: 2, booked_in_granot: 1 });
});

test("OI Activity requires a qualifying connected rep leg; unresolved qualifying identity stays Unmapped", () => {
  const period = readPeriod("today", NOW), intervals = [{ from: period.start, through: period.end, complete: true }];
  const base: RepDayCall = { _id: "missing-parties", provider_account_id: "acct", started_at: new Date("2026-09-29T15:00:00Z"), direction: "Inbound", contact_type: "human_conversation", parties: [] };
  const unqualified = [base, { ...base, _id: "external-only", parties: [{ role: "external", connected: true }] },
    { ...base, _id: "disconnected-user", parties: [{ role: "user", extension_id: "unknown", connected: false }] }];
  const result = buildActivity(period, unqualified, [], intervals);
  assert.deepEqual(result.totals, { human_conversations: 0, outbound_attempts: 0 });
  assert.deepEqual(result.unmapped, { human_conversations: 0, outbound_attempts: 0 });
  const connected = buildActivity(period, [...unqualified, { ...base, _id: "connected-unresolved", parties: [{ role: "user", extension_id: "unknown", connected: true }] }], [], intervals);
  assert.equal(connected.totals.human_conversations, 1); assert.equal(connected.unmapped?.human_conversations, 1);
  assert.deepEqual(connected.by_rep, []);
});
