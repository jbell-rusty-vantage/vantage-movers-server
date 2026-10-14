import { SALES_OUTREACH_TIMEZONE } from "../../../config/domain/salesOutreach";
import type { SalesOutreachConfigurationValue } from "../../../validation/v1/salesOutreach";
import { addDays, businessDateOf, localInstant, minuteOfDay } from "../engine/calendar";
import type { DeskRestrictionRow } from "../evaluation/store";

export type PoolEpisode = { started_at: Date; ended_at?: Date | null; observation_id?: unknown };
export type PoolEvent = {
  id: string; event_at: Date; channel: string; kind: string; verification: string;
  actor_agent_id: string | null; restricted_at_contact: boolean; association?: string;
  association_reason?: string | null;
};
export const poolEnabled = (value: SalesOutreachConfigurationValue) => value.pool?.enabled === true;

/** Shared NY calendar, independent of individual Rep goals, absences and zero-goal days. */
export function poolDay(date: string, value: SalesOutreachConfigurationValue) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  const day = value.cadence.working_days?.find((d) => d.iso_weekday === weekday);
  const closed = !day || value.cadence.holidays?.includes(date) === true;
  return { closed, open: day?.open_minute ?? 480, close: day?.close_minute ?? 1200 };
}

/** A started duty keeps its calendar gates even when tomorrow's configuration changes. */
export function poolValueForDay(value: SalesOutreachConfigurationValue, date: string, snapshot?: { open_minute: number; close_minute: number; closed_date: boolean } | null): SalesOutreachConfigurationValue {
  if (!snapshot) return value;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  return { ...value, cadence: { ...value.cadence,
    working_days: [...(value.cadence.working_days ?? []).filter((d) => d.iso_weekday !== weekday), { iso_weekday: weekday, open_minute: snapshot.open_minute, close_minute: snapshot.close_minute }],
    holidays: [...(value.cadence.holidays ?? []).filter((d) => d !== date), ...(snapshot.closed_date ? [date] : [])],
  } };
}

/** A date is owed only if an actual episode overlaps that date before its 30-minute entry cutoff. */
export function poolDutyWindow(episodes: readonly PoolEpisode[], date: string, value: SalesOutreachConfigurationValue,
  restrictions: readonly DeskRestrictionRow[] = []) {
  const day = poolDay(date, value);
  const start = localInstant(date, day.open, SALES_OUTREACH_TIMEZONE);
  const due = localInstant(date, day.close, SALES_OUTREACH_TIMEZONE);
  const cutoff = localInstant(date, day.close - 30, SALES_OUTREACH_TIMEZONE);
  const admitted = episodes.some((e) => +e.started_at <= cutoff && (e.ended_at == null || +e.ended_at > start));
  const waivers = restrictions.filter((r) => {
    if (!r.channels.includes("call") || +r.created_at > due) return false;
    const release = [r.until, r.resolved_at, r.state === "expired" ? r.updated_at : null].filter((d): d is Date => d != null);
    // A release after this date's opening resumes ordinary quota on the next date.
    return !release.length || Math.min(...release.map(Number)) > start;
  });
  const restricted = waivers.length > 0;
  return { required: admitted && !day.closed && !restricted, waived: admitted && (day.closed || restricted),
    start, due, cutoff, restricted, restriction_start: restricted ? Math.min(...waivers.map((r) => +r.created_at)) : null };

}

/** Existing confirmed same-date ordinary contact may cover entry; it receives no second event/goal credit. */
export function poolWinner(events: readonly PoolEvent[], date: string, value: SalesOutreachConfigurationValue): PoolEvent | null {
  const day = poolDay(date, value);
  if (day.closed) return null;
  const ordered = events.filter((e) => e.channel === "call" && e.verification === "confirmed" && e.actor_agent_id !== null
    && !e.restricted_at_contact && (e.association === undefined || e.association === "unique" || (e.association === "none" && e.association_reason === "before_activation"))
    && (e.kind === "outbound_attempt" || e.kind === "inbound_answered")
    && businessDateOf(+e.event_at, SALES_OUTREACH_TIMEZONE) === date
    && minuteOfDay(+e.event_at, SALES_OUTREACH_TIMEZONE) >= day.open
    && minuteOfDay(+e.event_at, SALES_OUTREACH_TIMEZONE) < day.close)
    .sort((a, b) => +a.event_at - +b.event_at || a.id.localeCompare(b.id));
  // One shared slot has no second call whose spacing could create another requirement.
  return ordered[0] ?? null;
}

export const poolNextDateAt = (date: string) => new Date(localInstant(addDays(date, 1), 0, SALES_OUTREACH_TIMEZONE));
