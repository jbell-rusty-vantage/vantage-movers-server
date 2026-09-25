import mongoose from "mongoose";
import { z } from "zod";
import { csiDataset, csiFlag } from "../../../config/domain/salesIntelligence";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { getOutreachRepDayModel } from "../../../models/salesIntelligence/overview";
import { CsiError } from "../auth";
import { resolvePolicy } from "../policy";
import { readCaptureHealthStatus } from "../ownerCoverage";
import { OVERVIEW_PERIODS, periodDto, resolveOverviewPeriod, type OverviewPeriod } from "./periods";
import { readOverviewIndex, tallyNow, filteredSubjects, type BandCounts, type NowRep } from "./now";
import { readDeskHealth, percentile } from "./desk";
import { aggregateCohort, loadSpendCohort, type RepCohort } from "./spend";
import { UNMAPPED_REP } from "./repDays";
import { overviewDtoSchema, type OverviewDto } from "./dto";

/**
 * S9-READS (assignment addendum §6–§7, E15–E23; reconciliation §4.3–§4.4): `GET /overview`.
 *
 * - `now`: the published Attention index at its `as_of`, with the desk's Priority and agent filters (C8);
 *   plus `capture_health.status` (headline only).
 * - `desk`: speed to lead, callbacks kept, missed calls returned, flow in/out, over the period.
 * - `reps`: per rep, open assignments (now), interactions (`outreach_rep_days`), outcomes, spend and cost
 *   per booking (Leads that arrived in the period, current `receiver_agent`), with Unmapped rep (calls only)
 *   and Unassigned (records and spend).
 * - `spend`: total, by rep and by source.
 * - `team_medians`: only for a one-rep scope (E23), over reps with an open assignment or a call in the period.
 *   V-T3 M9: over the chosen period only; the `priority` filter is ignored (Priority slices would let a rep
 *   difference medians of small cohorts).
 *
 * Activity numbers default to Today and spend/outcomes to Last 7 days (E18) unless the caller picks a period.
 * Behind `SALES_INTELLIGENCE_OVERVIEW`: off, the read is FEATURE_DISABLED (404).
 */
function repeated<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (value == null || value === "") return undefined;
    const parts = (Array.isArray(value) ? value : [value]).flatMap(item => String(item).split(",")).map(item => item.trim()).filter(Boolean);
    return parts.length ? [...new Set(parts)].sort() : undefined;
  }, z.array(schema).min(1).optional());
}
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const overviewQuerySchema = z.object({
  scope: z.literal("production").optional(),
  period: z.enum(OVERVIEW_PERIODS).optional(),
  from: day.optional(),
  to: day.optional(),
  priority: repeated(z.string().regex(/^(not_set|no_lead|[A-Za-z0-9]{1,8})$/)),
  agent_id: z.string().regex(/^[a-f\d]{24}$/i).optional(),
}).strict().superRefine((query, ctx) => {
  const custom = query.period === "custom";
  if (custom && (!query.from || !query.to)) ctx.addIssue({ code: "custom", path: ["from"], message: "custom needs from and to" });
  if (!custom && (query.from || query.to)) ctx.addIssue({ code: "custom", path: ["period"], message: "from/to only with period=custom" });
});
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;
/** S8-REP hook: the actor's forced rep scope. Null for the Owner, whose `agent_id` param selects a scope instead. */
export type OverviewScope = { agent_id: string } | null;

export const OVERVIEW_CACHE_TTL_MS = 60_000;
const CACHE = new Map<string, { at: number; value: OverviewDto }>();
const CACHE_LIMIT = 64;
/** Tests only. */
export function clearOverviewCache() { CACHE.clear(); }

type RepDayTotals = { outbound_attempts: number; outbound_conversations: number; answered_inbound: number; human_conversations: number; talk_seconds: number; calls: number;
  recovered_calls: number; extensions: string[] };
const zeroDays = (): RepDayTotals => ({ outbound_attempts: 0, outbound_conversations: 0, answered_inbound: 0, human_conversations: 0, talk_seconds: 0, calls: 0, recovered_calls: 0, extensions: [] });
export async function readRepDayTotals(period: Pick<OverviewPeriod, "days">): Promise<Map<string, RepDayTotals>> {
  const rows = await getOutreachRepDayModel().collection.find({ day: { $in: period.days } }).toArray() as unknown as Array<RepDayTotals & { agent_key: string }>;
  const out = new Map<string, RepDayTotals>();
  for (const row of rows) {
    const total = out.get(row.agent_key) ?? zeroDays();
    for (const field of ["outbound_attempts", "outbound_conversations", "answered_inbound", "human_conversations", "talk_seconds", "calls", "recovered_calls"] as const) total[field] += row[field] ?? 0;
    total.extensions = [...new Set([...total.extensions, ...(row.extensions ?? [])])].sort();
    out.set(row.agent_key, total);
  }
  return out;
}
export function interactionsDto(totals: RepDayTotals | undefined) {
  const t = totals ?? zeroDays();
  return { outbound_attempts: t.outbound_attempts, answered_inbound: t.answered_inbound, human_conversations: t.human_conversations, talk_minutes: Math.round(t.talk_seconds / 6) / 10,
    attempt_conversation_rate: t.outbound_attempts ? t.outbound_conversations / t.outbound_attempts : null, calls: t.calls, recovered_calls: t.recovered_calls };
}

type RepRow = OverviewDto["reps"][number];
/** Per-rep metrics the team medians cover (E23). */
export const MEDIAN_FIELDS = ["open", "overdue", "outbound_attempts", "answered_inbound", "human_conversations", "talk_minutes", "attempt_conversation_rate", "leads",
  "quoted", "booked_in_granot", "booked_official", "booking_rate", "spend", "cost_per_booking"] as const;
export function repMetricValues(row: RepRow): Record<(typeof MEDIAN_FIELDS)[number], number | null> {
  return { open: row.open_assignments.open, overdue: row.open_assignments.overdue, outbound_attempts: row.interactions.outbound_attempts,
    answered_inbound: row.interactions.answered_inbound, human_conversations: row.interactions.human_conversations, talk_minutes: row.interactions.talk_minutes,
    attempt_conversation_rate: row.interactions.attempt_conversation_rate, leads: row.outcomes.leads, quoted: row.outcomes.quoted, booked_in_granot: row.outcomes.booked_in_granot,
    booked_official: row.outcomes.booked_official, booking_rate: row.outcomes.booking_rate, spend: row.spend.spend, cost_per_booking: row.cost_per_booking };
}
/**
 * C11 / E23: a median over a small cohort lets a rep work out another rep's exact value (two reps:
 * other = 2 × median − own; three: the median is one other rep's value whenever the caller is the lowest
 * or the highest). V-T3 M9: at least 4 known values (3 other reps). Below this cohort the metric's median is null.
 */
export const MEDIAN_MIN_COHORT = 4;
/** E23: the median of each per-rep metric over reps with at least one open assignment or call in the period; a null metric is left out (unknown is never zero). */
export function teamMedians(rows: readonly RepRow[]) {
  const members = rows.filter(row => row.open_assignments.open > 0 || row.interactions.calls > 0);
  const values = members.map(repMetricValues);
  const median = (field: (typeof MEDIAN_FIELDS)[number]) => {
    const known = values.map(v => v[field]).filter((v): v is number => v != null);
    return known.length >= MEDIAN_MIN_COHORT ? percentile(known, 0.5) : null;
  };
  return { reps: members.length, ...Object.fromEntries(MEDIAN_FIELDS.map(field => [field, median(field)])) } as
    { reps: number } & Record<(typeof MEDIAN_FIELDS)[number], number | null>;
}

const emptyCohort = (): RepCohort => ({ spend: { leads: 0, spend: 0, rate: 0, legacy: 0, unpriced_leads: 0, zero_leads: 0 }, by_source: [],
  outcomes: { leads: 0, quoted: 0, booked_in_granot: 0, booked_official: 0, bookings: 0, booking_rate: null }, cost_per_booking: null });

async function agentNames(ids: readonly string[]) {
  if (!ids.length) return new Map<string, string>();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
  const rows = await db.collection("agents").find({ _id: { $in: ids.map(id => new mongoose.Types.ObjectId(id)) } }, { projection: { name: 1 } }).toArray();
  return new Map(rows.map(row => [String(row._id), typeof row.name === "string" && row.name ? row.name : "Unknown Agent"]));
}

export async function readOverview(raw: z.input<typeof overviewQuerySchema>, options: { scope?: OverviewScope; now?: Date; cache?: boolean } = {}): Promise<OverviewDto> {
  if (!csiFlag("OVERVIEW")) throw new CsiError("FEATURE_DISABLED");
  const query = overviewQuerySchema.parse(raw);
  // S8-REP: a forced scope replaces the client's `agent_id`.
  const scopeAgent = options.scope?.agent_id ?? query.agent_id ?? null;
  const now = options.now ?? new Date();
  const { deployment, database } = csiDataset();
  const cacheKey = JSON.stringify([deployment, database, query.period ?? null, query.from ?? null, query.to ?? null, query.priority ?? null, scopeAgent]);
  const cached = options.cache === false ? undefined : CACHE.get(cacheKey);
  if (cached && +now - cached.at < OVERVIEW_CACHE_TTL_MS) return cached.value;
  let activity: OverviewPeriod, spendPeriod: OverviewPeriod;
  try {
    activity = resolveOverviewPeriod(query.period ?? "today", now, { from: query.from, to: query.to });
    spendPeriod = query.period ? activity : resolveOverviewPeriod("last_7_days", now);
  } catch { throw new CsiError("INVALID_INPUT"); }
  const priority = query.priority ?? null;
  const policy = await resolvePolicy();
  const [index, captureHealth] = await Promise.all([readOverviewIndex(now),
    readCaptureHealthStatus(now, { timezone: policy.timezone, staffed_hours: policy.staffed_hours })]);
  const asOf = index?.as_of ?? now;
  const entries = index?.entries ?? [];
  const scopedNow = tallyNow(entries, { priority, agent_id: scopeAgent ? [scopeAgent] : null }, asOf);
  // Team rows (and the medians) come from the unscoped tally; a scoped response keeps only its rep.
  const teamNow = scopeAgent ? tallyNow(entries, { priority }, asOf) : scopedNow;
  const attentionFilters = { priority, agent_id: scopeAgent ? [scopeAgent] : null };
  const currentBands = new Map<string, number>();
  for (const entry of entries) if (entry.partition !== "closed" && entry.in_attention !== false && entry.filter_keys.band != null) currentBands.set(entry.subject_key, entry.filter_keys.band);
  const flowSubjects = priority || scopeAgent ? filteredSubjects(entries, attentionFilters, asOf) : null;
  if (flowSubjects) for (const key of [...currentBands.keys()]) if (!flowSubjects.has(key)) currentBands.delete(key);
  const [desk, days, cohort] = await Promise.all([
    readDeskHealth(activity, asOf, policy, { priority, agent_id: scopeAgent }, { flowSubjects, currentBands }),
    readRepDayTotals(activity),
    loadSpendCohort(spendPeriod, { priority }),
  ]);
  const spend = aggregateCohort(cohort.leads, cohort.officialBooked);
  const repIds = [...new Set([...teamNow.by_rep.keys(), ...[...days.keys()].filter(key => key !== UNMAPPED_REP), ...spend.by_rep.keys()])].sort();
  const names = await agentNames(repIds);
  const rowFor = (tally: typeof teamNow, money_by_rep: typeof spend.by_rep) => (id: string): RepRow => {
    const now = tally.by_rep.get(id) ?? ({ agent_id: id, open: 0, bands: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0 }, overdue: 0 } as NowRep);
    const money = money_by_rep.get(id) ?? emptyCohort();
    return { agent: { id, name: names.get(id) ?? "Unknown Agent" }, open_assignments: { open: now.open, bands: now.bands, overdue: now.overdue },
      interactions: interactionsDto(days.get(id)), outcomes: money.outcomes, spend: money.spend, by_source: money.by_source, cost_per_booking: money.cost_per_booking };
  };
  const repRow = rowFor(teamNow, spend.by_rep);
  const teamRows = repIds.map(repRow);
  // V-T3 M9: a scoped read's medians ignore the Priority filter (same period, whole team). Unfiltered, the team rows already are that.
  const medianRows = !scopeAgent ? null : !priority ? teamRows : await (async () => {
    const allNow = tallyNow(entries, {}, asOf);
    const allCohort = await loadSpendCohort(spendPeriod, {});
    const allSpend = aggregateCohort(allCohort.leads, allCohort.officialBooked);
    const ids = [...new Set([...allNow.by_rep.keys(), ...[...days.keys()].filter(key => key !== UNMAPPED_REP), ...allSpend.by_rep.keys()])].sort();
    return ids.map(rowFor(allNow, allSpend.by_rep));
  })();
  const reps = scopeAgent ? [repRow(scopeAgent)] : teamRows;
  const unmapped = scopeAgent ? null : { interactions: interactionsDto(days.get(UNMAPPED_REP)), extensions: days.get(UNMAPPED_REP)?.extensions ?? [] };
  const unassignedCohort = spend.unassigned ?? emptyCohort();
  const unassigned = scopeAgent ? null : { records_now: scopedNow.unassigned, outcomes: unassignedCohort.outcomes, spend: unassignedCohort.spend,
    by_source: unassignedCohort.by_source, cost_per_booking: unassignedCohort.cost_per_booking };
  const scopedSpend = scopeAgent ? spend.by_rep.get(scopeAgent) ?? emptyCohort() : null;
  const value = overviewDtoSchema.parse({
    as_of: asOf.toISOString(),
    snapshot_id: index?.snapshot_id ?? null,
    status: index ? "ready" : "pending_projection",
    scope: scopeAgent ? { agent_id: scopeAgent } : null,
    filters: { priority },
    periods: { activity: periodDto(activity), spend: periodDto(spendPeriod) },
    now: { bands: scopedNow.bands, needs_review: scopedNow.needs_review, unassigned: scopedNow.unassigned, live_calls: scopedNow.live_calls, active: scopedNow.active,
      capture_health: { status: captureHealth } },
    desk,
    reps,
    unmapped,
    unassigned,
    spend: scopedSpend
      ? { total: { ...scopedSpend.spend, outcomes: scopedSpend.outcomes }, by_rep: [{ agent_id: scopeAgent!, ...scopedSpend.spend }], by_source: scopedSpend.by_source }
      : { total: spend.total, by_rep: [...teamRows.map(row => ({ agent_id: row.agent.id, ...row.spend })), ...(spend.unassigned ? [{ agent_id: null, ...spend.unassigned.spend }] : [])],
        by_source: spend.by_source },
    ...(medianRows ? { team_medians: teamMedians(medianRows) } : {}),
  });
  CACHE.set(cacheKey, { at: +now, value });
  while (CACHE.size > CACHE_LIMIT) CACHE.delete(CACHE.keys().next().value!);
  return value;
}
export type { BandCounts };
