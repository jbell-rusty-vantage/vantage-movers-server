import type { PerformanceDay, PerformanceRow, SalesOutreachPerformanceDto } from "../../../validation/v1/salesOutreachPerformance";
import type { EngineObligation } from "../engine";
import { addDays, localInstant } from "../engine/calendar";
import { isoWeekdayOf, newYorkBusinessDay, newYorkDayBounds } from "../reads/businessDay";
import { OutreachError } from "../errors";

export type Coverage = "complete" | "partial" | "unknown";
export type PerformanceCallDay = {
  agent_id: string; business_date: string; actual: number | null; goal: number | null;
  coverage: Coverage; awaiting: number;
};
export type PerformanceVolume = { agent_id: string | null; business_date: string; confirmed: number; pending: number };
export type PerformanceRequirementDay = { business_date: string; obligations: readonly EngineObligation[]; coverage_through: string | null; input_complete?: boolean };
export type PerformanceInput = {
  now: Date; week_start: string; closing_minute: number;
  names: ReadonlyMap<string, string>; active_agent_ids: ReadonlySet<string>;
  calls: readonly PerformanceCallDay[];
  volumes: readonly PerformanceVolume[];
  requirements: readonly PerformanceRequirementDay[];
  earliest: SalesOutreachPerformanceDto["earliest_reliable_dates"];
  call_freshness: string | null; sms_freshness: string | null;
  sms_inventory_complete: boolean;
  today_tolerance_ms?: number;
};

export function performanceWeek(requested: string | undefined, now: Date) {
  const today = newYorkBusinessDay(now);
  const monday = addDays(today, 1 - isoWeekdayOf(today));
  const start = requested ?? monday;
  if (isoWeekdayOf(start) !== 1 || start > monday)
    throw new OutreachError("INVALID_INPUT", [{ path: "week_start", code: "expected_current_or_past_monday" }]);
  const end_exclusive = addDays(start, 7);
  return { start, end_exclusive, through: today < end_exclusive ? today : addDays(end_exclusive, -1), timezone: "America/New_York" as const };
}

const atLeast = (watermark: string | null, instant: number) => watermark !== null && Date.parse(watermark) >= instant;
const sumKnown = (values: readonly (number | null)[]) => values.some((v) => v === null) ? null : values.reduce<number>((n, v) => n + v!, 0);
const NO_REQUIREMENT = new Set(["waived_restriction", "suspended_callback", "superseded", "cancelled", "blocked_reschedule", "legacy_review"]);

/** Consume the existing engine verdict; never derive cadence or assign goal credit here. */
export function requirementDisposition(ob: EngineObligation): "on_time" | "missed" | "pending" | "exempt" {
  if (ob.channel !== "sms") return "exempt";
  if (ob.deadline_missed || ob.outcome === "missed" || ob.outcome === "fulfilled_late") return "missed";
  if (NO_REQUIREMENT.has(ob.outcome)) return "exempt";
  if (ob.outcome === "fulfilled" && ob.due_at !== null && ob.fulfilled_at !== null && Date.parse(ob.fulfilled_at) <= Date.parse(ob.due_at)) return "on_time";
  return "pending";
}

function rank(rows: PerformanceRow[], channel: "calls" | "texts") {
  const fraction = (r: PerformanceRow): [number, number] => channel === "calls"
    ? [r.calls.met_days, r.calls.eligible_days] : [r.texts.on_time_required, r.texts.resolved_due_required];
  const sorted = rows.filter((r) => fraction(r)[1] > 0).sort((a, b) => {
    const [an, ad] = fraction(a); const [bn, bd] = fraction(b);
    return bn * ad - an * bd || (b[channel].weekly_volume ?? -1) - (a[channel].weekly_volume ?? -1) || a.agent_id.localeCompare(b.agent_id);
  });
  let last: PerformanceRow | undefined;
  sorted.forEach((row, index) => {
    const [n, d] = fraction(row); const [pn, pd] = last ? fraction(last) : [0, 0];
    row[channel].rank = last && n * pd === pn * d && row[channel].weekly_volume === last[channel].weekly_volume ? last[channel].rank : index + 1;
    last = row;
  });
}

export function composeTeamPerformance(input: PerformanceInput): SalesOutreachPerformanceDto {
  const week = performanceWeek(input.week_start, input.now);
  const today = newYorkBusinessDay(input.now);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(week.start, i));
  const inWeek = (d: string) => d >= week.start && d < week.end_exclusive && d <= today;
  const ids = new Set(input.active_agent_ids);
  for (const row of input.calls) if (inWeek(row.business_date)) ids.add(row.agent_id);
  for (const row of input.volumes) if (inWeek(row.business_date) && row.agent_id) ids.add(row.agent_id);
  const requirements = input.requirements.filter((d) => inWeek(d.business_date));
  const gapDates = new Set(requirements.filter((d) => d.input_complete === false).map((d) => d.business_date));
  let unassigned = 0;
  for (const day of requirements) for (const ob of day.obligations) {
    if (requirementDisposition(ob) === "exempt") continue;
    if (ob.responsible_agent_id) ids.add(ob.responsible_agent_id); else unassigned++;
  }
  const calls = new Map(input.calls.map((r) => [`${r.agent_id}:${r.business_date}`, r]));
  const volumes = new Map(input.volumes.map((r) => [`${r.agent_id}:${r.business_date}`, r]));
  const obligationKeys = new Set<string>();
  const obs = new Map<string, Array<{ ob: EngineObligation; coverage: string | null; complete: boolean }>>();
  for (const day of requirements) for (const ob of day.obligations) {
    if (!ob.responsible_agent_id || requirementDisposition(ob) === "exempt") continue;
    // Obligation IDs include period and date; a catch-up never creates another slot here.
    if (obligationKeys.has(ob.obligation_id)) continue;
    obligationKeys.add(ob.obligation_id);
    const key = `${ob.responsible_agent_id}:${day.business_date}`;
    const list = obs.get(key) ?? []; list.push({ ob, coverage: day.coverage_through, complete: day.input_complete !== false }); obs.set(key, list);
  }
  const rows: PerformanceRow[] = [...ids].sort().map((agent_id) => {
    const days: PerformanceDay[] = dates.map((business_date) => {
      const future = business_date > today;
      const key = `${agent_id}:${business_date}`;
      const call = calls.get(key);
      const volume = volumes.get(key);
      const close = localInstant(business_date, input.closing_minute, "America/New_York");
      const closed = input.now.getTime() >= close;
      const callCoverage = call?.coverage ?? "unknown";
      const goal = call?.goal ?? null;
      const actual = call?.actual ?? null;
      const callPending = !call || actual === null || goal === null || callCoverage !== "complete" || call.awaiting > 0;
      const callState = future ? "upcoming" : goal === 0 ? "no_goal" : callPending && closed ? "pending_data"
        : goal !== null && actual !== null && actual >= goal ? "met" : !closed ? "in_progress" : "not_met";
      const list = obs.get(key) ?? [];
      const knownRange = input.sms_inventory_complete && input.earliest.text_requirements !== null && business_date >= input.earliest.text_requirements;
      const volumeRange = input.sms_inventory_complete && input.earliest.text_volume !== null && business_date >= input.earliest.text_volume;
      const bounds = newYorkDayBounds(business_date);
      const requiredThrough = business_date === today
        ? Math.max(bounds.start.getTime(), input.now.getTime() - (input.today_tolerance_ms ?? 0)) : bounds.end.getTime();
      const volumeCovered = volumeRange && atLeast(input.sms_freshness, requiredThrough);
      const requirementCovered = knownRange && !gapDates.has(business_date) && atLeast(input.sms_freshness, closed ? close : Math.min(close, input.now.getTime()));
      let completed = 0; let resolved = 0; let pending = 0;
      for (const { ob, coverage, complete } of list) {
        if (!complete) { pending++; continue; }
        const disposition = requirementDisposition(ob);
        if (disposition === "on_time") { completed++; resolved++; }
        else if (disposition === "missed" && ob.due_at && atLeast(coverage, Date.parse(ob.due_at))) resolved++;
        else pending++;
      }
      const textCoverage: Coverage = !knownRange ? "unknown" : requirementCovered && pending === 0 ? "complete" : "partial";
      const textState = future ? "upcoming" : !knownRange || gapDates.has(business_date) || (closed && (!requirementCovered || pending > 0)) ? "pending_data"
        : list.length === 0 ? "no_texts_due" : completed === list.length ? "met" : !closed ? "in_progress" : "not_met";
      return {
        business_date, future,
        calls: { actual: future ? null : actual, goal: future ? null : goal, state: callState, coverage: callCoverage },
        texts: {
          sent: future ? null : volume ? volume.confirmed : volumeCovered ? 0 : null,
          on_time_required: completed, resolved_due_required: resolved, applicable_required: list.length,
          pending, state: textState, coverage: textCoverage,
        },
      };
    });
    const closedDays = days.filter((d) => !d.future && input.now.getTime() >= localInstant(d.business_date, input.closing_minute, "America/New_York"));
    const eligible = closedDays.filter((d) => (d.calls.goal ?? 0) > 0 && d.calls.coverage === "complete" && d.calls.state !== "pending_data");
    const met = eligible.filter((d) => d.calls.state === "met").length;
    const pendingDays = closedDays.filter((d) => d.calls.state === "pending_data").length;
    const smsEligible = closedDays.filter((d) => d.texts.coverage !== "unknown");
    const onTime = smsEligible.reduce((n, d) => n + d.texts.on_time_required, 0);
    const due = smsEligible.reduce((n, d) => n + d.texts.resolved_due_required, 0);
    const pending = closedDays.reduce((n, d) => n + d.texts.pending, 0);
    const callsProvisional = pendingDays > 0 || days.some((d) => !d.future && d.calls.coverage !== "complete");
    const textsProvisional = closedDays.some((d) => d.texts.coverage !== "complete") || days.some((d) => !d.future && (d.texts.sent === null || !atLeast(input.sms_freshness, d.business_date === today ? Math.max(newYorkDayBounds(today).start.getTime(), input.now.getTime() - (input.today_tolerance_ms ?? 0)) : newYorkDayBounds(d.business_date).end.getTime()) || (volumes.get(`${agent_id}:${d.business_date}`)?.pending ?? 0) > 0));
    return {
      agent_id, name: input.names.get(agent_id) ?? null,
      historical_membership_state: input.active_agent_ids.has(agent_id) ? "active" : "historical",
      calls: { rank: null, weekly_volume: sumKnown(days.filter((d) => !d.future).map((d) => d.calls.actual)), met_days: met,
        eligible_days: eligible.length, pending_days: pendingDays, completion_rate: eligible.length ? met / eligible.length : null, provisional: callsProvisional },
      texts: { rank: null, weekly_volume: sumKnown(days.filter((d) => !d.future).map((d) => d.texts.sent)), on_time_required: onTime,
        resolved_due_required: due, pending_requirements: pending, completion_rate: due ? onTime / due : null, provisional: textsProvisional },
      days,
    };
  });
  rank(rows, "calls"); rank(rows, "texts");
  return {
    week, as_of: input.now.toISOString(), earliest_reliable_dates: input.earliest,
    channel_freshness: { calls: input.call_freshness, texts: input.sms_freshness },
    provisional: { calls: rows.some((r) => r.calls.provisional), texts: rows.some((r) => r.texts.provisional) },
    rows, unassigned: { required_text_counts: unassigned },
  };
}
