/**
 * Insights › Analytics (doc 09): one report per (period, comparison, sources), computed in memory from the period
 * facts. The five admin tabs and the Owner report read this one payload, so every number on the page agrees.
 *
 * Bases (shown under ⓘ on each card):
 * - Activity: bookings whose book date falls in the period ÷ leads that arrived in it (Overview, Team, Bookings).
 * - Cohort: of the leads that arrived in the period, the share booked as of now (Sources, receivers, the Desk).
 */
import { companyLabel, currentFeedRate, PSEUDO_COMPANIES, type InsightsCatalog } from "./catalog";
import type { BookingFact, LeadFact, PeriodFacts } from "./facts";
import { describeChange, groupBy, median, metric, rankedRows, ratio, round2 } from "./metrics";
import { bucketKey, bucketKeys, daysBetween, inRange } from "./period";
import { rateLabel } from "./pricing";
import type {
  InsightsAnalyticsReport,
  InsightsBucket,
  InsightsComparison,
  InsightsMetric,
  InsightsMover,
  InsightsNamedCount,
  InsightsPeriod,
  InsightsRow,
  InsightsScorecardKey,
  InsightsSeriesPoint,
  InsightsTimeToBook,
} from "./types";

export const INSIGHTS_DEFINITIONS: Record<string, string> = {
  lead: "A Form Lead or Call Lead that arrived in the period, New York time. Duplicates are counted separately and cost $0. Unmatched calls are not leads.",
  booking: "A booking whose book date falls in the period.",
  booking_rate: "Bookings in the period ÷ leads in the period (activity basis).",
  conversion: "Of the leads that arrived in the period, the share that is booked as of now (cohort basis). Recent periods are still maturing.",
  lead_spend: "Each lead priced at its feed's lead cost (Setup › Lead sources) for the day it arrived. Read live: a lead cost changed in Setup changes every report at once. Duplicates cost $0; a feed with no cost for that day is counted as unpriced.",
  cost_per_lead: "Lead spend ÷ leads.",
  cost_per_booking: "Lead spend ÷ bookings (on Sources: ÷ the period's leads that booked).",
  return_on_spend: "Binder of the bookings that came from the period's leads ÷ the spend on those leads.",
  split_credit: "A booking split between agents credits each agent its own binder and the same share of the deposit; the booking counts once for each agent.",
  cancellation_rate: "Bookings in the period that are now cancelled ÷ bookings in the period.",
  time_to_book: "Days from the lead arriving to its book date.",
};

type LeadAgg = {
  leads: number;
  duplicates: number;
  spend: number;
  unpriced: number;
  booked: number;
  booked_binder: number;
  booked_cancelled: number;
  rates: Set<number>;
};

type BookingAgg = { bookings: number; binder: number; deposits: number; cancelled: number };

function emptyLeadAgg(): LeadAgg {
  return { leads: 0, duplicates: 0, spend: 0, unpriced: 0, booked: 0, booked_binder: 0, booked_cancelled: 0, rates: new Set() };
}

export function aggregateLeads(leads: readonly LeadFact[], cohort: ReadonlyMap<string, BookingFact>): LeadAgg {
  const agg = emptyLeadAgg();
  for (const lead of leads) {
    if (lead.duplicate) {
      agg.duplicates += 1;
      continue;
    }
    agg.leads += 1;
    agg.spend += lead.price.amount;
    if (lead.price.status === "unpriced") agg.unpriced += 1;
    if (lead.price.status === "priced") agg.rates.add(lead.price.amount);
    const booking = lead.booked_id ? cohort.get(lead.booked_id) : undefined;
    if (booking) {
      agg.booked += 1;
      agg.booked_binder += booking.binder;
      if (booking.cancelled) agg.booked_cancelled += 1;
    }
  }
  agg.spend = round2(agg.spend);
  return agg;
}

export function aggregateBookings(bookings: readonly BookingFact[]): BookingAgg {
  const agg: BookingAgg = { bookings: 0, binder: 0, deposits: 0, cancelled: 0 };
  for (const booking of bookings) {
    agg.bookings += 1;
    agg.binder += booking.binder;
    agg.deposits += booking.deposit;
    if (booking.cancelled) agg.cancelled += 1;
  }
  agg.binder = round2(agg.binder);
  agg.deposits = round2(agg.deposits);
  return agg;
}

/** Cohort lead metrics for a source / state / receiver row. */
function leadRowMetrics(now: LeadAgg | undefined, then: LeadAgg | undefined, hasComparison: boolean): Record<string, InsightsMetric> {
  const a = now ?? emptyLeadAgg();
  const b = hasComparison ? (then ?? emptyLeadAgg()) : undefined;
  const c = <T>(value: T | undefined) => (b === undefined ? null : (value as unknown as number | null));
  return {
    leads: metric(a.leads, c(b?.leads), "count", "up"),
    duplicates: metric(a.duplicates, c(b?.duplicates), "count", "down"),
    spend: metric(a.spend, c(b?.spend), "money", "none"),
    cpl: metric(ratio(a.spend, a.leads), b ? ratio(b.spend, b.leads) : null, "money", "down", { base: a.leads, comparisonBase: b?.leads }),
    booked: metric(a.booked, c(b?.booked), "count", "up"),
    booking_rate: metric(ratio(a.booked, a.leads), b ? ratio(b.booked, b.leads) : null, "rate", "up", { base: a.leads, comparisonBase: b?.leads }),
    cost_per_booking: metric(ratio(a.spend, a.booked), b ? ratio(b.spend, b.booked) : null, "money", "down", { base: a.booked, comparisonBase: b?.booked }),
    binder: metric(a.booked_binder, c(b?.booked_binder), "money", "up"),
    return_on_spend: metric(ratio(a.booked_binder, a.spend), b ? ratio(b.booked_binder, b.spend) : null, "ratio", "up", { base: a.booked, comparisonBase: b?.booked }),
    cancel_rate: metric(ratio(a.booked_cancelled, a.booked), b ? ratio(b.booked_cancelled, b.booked) : null, "rate", "down", { base: a.booked, comparisonBase: b?.booked }),
    unpriced: metric(a.unpriced, c(b?.unpriced), "count", "none"),
  };
}

function seriesFor<T>(
  rows: readonly T[],
  period: Pick<InsightsPeriod, "start" | "end_exclusive">,
  bucket: InsightsBucket,
  day: (row: T) => string | null,
  value: (row: T) => number,
  secondary?: (row: T) => number,
): NonNullable<InsightsRow["series"]> {
  const keys = bucketKeys(period, bucket);
  const map = new Map(keys.map((key) => [key, { day: key, value: 0, ...(secondary ? { secondary: 0 } : {}) }]));
  for (const row of rows) {
    const d = day(row);
    if (!d || !inRange(d, period)) continue;
    const point = map.get(bucketKey(d, period.start, bucket));
    if (!point) continue;
    point.value = round2(point.value + value(row));
    if (secondary) point.secondary = round2((point.secondary ?? 0) + secondary(row));
  }
  return [...map.values()];
}

function overallSeries(facts: PeriodFacts, bucket: InsightsBucket): InsightsSeriesPoint[] {
  const keys = bucketKeys(facts.range, bucket);
  const map = new Map<string, InsightsSeriesPoint>(keys.map((key) => [key, { day: key, leads: 0, bookings: 0, spend: 0, binder: 0, deposits: 0, cancellations: 0 }]));
  const at = (day: string) => map.get(bucketKey(day, facts.range.start, bucket));
  for (const lead of facts.leads) {
    if (lead.duplicate) continue;
    const point = at(lead.day);
    if (!point) continue;
    point.leads += 1;
    point.spend = round2(point.spend + lead.price.amount);
  }
  for (const booking of facts.bookings) {
    const point = at(booking.day);
    if (!point) continue;
    point.bookings += 1;
    point.binder = round2(point.binder + booking.binder);
    point.deposits = round2(point.deposits + booking.deposit);
  }
  for (const cancellation of facts.cancellations) {
    const point = at(cancellation.day);
    if (point) point.cancellations += 1;
  }
  return [...map.values()];
}

type Scores = Record<InsightsScorecardKey, number | null> & { _leads: number; _bookings: number; _cohort_booked: number };

function scoreValues(facts: PeriodFacts): Scores {
  const leads = aggregateLeads(facts.leads, facts.cohortBookings);
  const bookings = aggregateBookings(facts.bookings);
  return {
    leads: leads.leads,
    bookings: bookings.bookings,
    booking_rate: ratio(bookings.bookings, leads.leads),
    binder: bookings.binder,
    deposits: bookings.deposits,
    lead_spend: leads.spend,
    cost_per_booking: ratio(leads.spend, bookings.bookings),
    cancellation_rate: ratio(bookings.cancelled, bookings.bookings),
    cost_per_lead: ratio(leads.spend, leads.leads),
    duplicates: leads.duplicates,
    return_on_spend: ratio(leads.booked_binder, leads.spend),
    average_binder: ratio(bookings.binder, bookings.bookings),
    _leads: leads.leads,
    _bookings: bookings.bookings,
    _cohort_booked: leads.booked,
  };
}

function scorecards(now: Scores, then: Scores | null): Record<InsightsScorecardKey, InsightsMetric> {
  const v = (key: InsightsScorecardKey) => (then ? then[key] : null);
  const leadsBase = { base: now._leads, comparisonBase: then?._leads };
  const bookingBase = { base: now._bookings, comparisonBase: then?._bookings };
  return {
    leads: metric(now.leads, v("leads"), "count", "up"),
    bookings: metric(now.bookings, v("bookings"), "count", "up"),
    booking_rate: metric(now.booking_rate, v("booking_rate"), "rate", "up", leadsBase),
    binder: metric(now.binder, v("binder"), "money", "up"),
    deposits: metric(now.deposits, v("deposits"), "money", "up"),
    lead_spend: metric(now.lead_spend, v("lead_spend"), "money", "down"),
    cost_per_booking: metric(now.cost_per_booking, v("cost_per_booking"), "money", "down", bookingBase),
    cancellation_rate: metric(now.cancellation_rate, v("cancellation_rate"), "rate", "down", bookingBase),
    cost_per_lead: metric(now.cost_per_lead, v("cost_per_lead"), "money", "down", leadsBase),
    duplicates: metric(now.duplicates, v("duplicates"), "count", "down"),
    return_on_spend: metric(now.return_on_spend, v("return_on_spend"), "ratio", "up", { base: now._cohort_booked, comparisonBase: then?._cohort_booked }),
    average_binder: metric(now.average_binder, v("average_binder"), "money", "up", bookingBase),
  };
}

/** Lead-side rows keyed by `key(lead)`, cohort bookings attached. */
function leadGroups(facts: PeriodFacts, key: (lead: LeadFact) => string | null): Map<string, LeadAgg> {
  const groups = groupBy(facts.leads, key);
  return new Map([...groups].map(([k, leads]) => [k, aggregateLeads(leads, facts.cohortBookings)]));
}

function withActivity(row: InsightsRow, now: BookingAgg | undefined, then: BookingAgg | undefined, hasComparison: boolean): InsightsRow {
  const a = now ?? { bookings: 0, binder: 0, deposits: 0, cancelled: 0 };
  const b = hasComparison ? (then ?? { bookings: 0, binder: 0, deposits: 0, cancelled: 0 }) : null;
  row.metrics.activity_bookings = metric(a.bookings, b?.bookings ?? null, "count", "up");
  row.metrics.activity_binder = metric(a.binder, b?.binder ?? null, "money", "up");
  return row;
}

function sourceRows(
  catalog: InsightsCatalog,
  now: PeriodFacts,
  then: PeriodFacts | null,
  period: InsightsPeriod,
  rowBucket: InsightsBucket,
  today: string,
): InsightsRow[] {
  const companyNow = leadGroups(now, (lead) => lead.company);
  const companyThen = then ? leadGroups(then, (lead) => lead.company) : null;
  const bookNow = new Map([...groupBy(now.bookings, (b) => b.company)].map(([k, rows]) => [k, aggregateBookings(rows)]));
  const bookThen = then ? new Map([...groupBy(then.bookings, (b) => b.company)].map(([k, rows]) => [k, aggregateBookings(rows)])) : null;
  // Booking-only companies (referrals, direct bookings) appear so the table reconciles with the Bookings card.
  for (const key of bookNow.keys()) if (!companyNow.has(key)) companyNow.set(key, emptyLeadAgg());

  const feedNow = leadGroups(now, (lead) => (lead.feed ? lead.feed.key : null));
  const feedThen = then ? leadGroups(then, (lead) => (lead.feed ? lead.feed.key : null)) : null;
  const feedBookNow = new Map([...groupBy(now.bookings, (b) => b.feed?.key)].map(([k, rows]) => [k, aggregateBookings(rows)]));
  const feedBookThen = then ? new Map([...groupBy(then.bookings, (b) => b.feed?.key)].map(([k, rows]) => [k, aggregateBookings(rows)])) : null;

  const leadsByCompany = groupBy(now.leads, (lead) => lead.company);
  const rows = rankedRows({
    current: companyNow,
    comparison: companyThen,
    label: (key) => companyLabel(catalog, key),
    toMetrics: (a, b) => leadRowMetrics(a, b, Boolean(then)),
    rankValue: (agg) => agg.leads * 1_000 + agg.booked,
    series: (key) =>
      seriesFor(
        (leadsByCompany.get(key) ?? []).filter((lead) => !lead.duplicate),
        period,
        rowBucket,
        (lead) => lead.day,
        () => 1,
        (lead) => (lead.booked_id && now.cohortBookings.has(lead.booked_id) ? 1 : 0),
      ),
    notes: (key, agg) => {
      const feeds = [...catalog.feeds.values()].filter((feed) => feed.company_slug === key);
      const rates = feeds.map((feed) => currentFeedRate(catalog, feed.id, today)).filter((rate): rate is number => rate !== null);
      return { rate_label: rateLabel(rates.length ? rates : agg.rates), pseudo: key in PSEUDO_COMPANIES, unpriced: agg.unpriced };
    },
  });
  for (const row of rows) {
    withActivity(row, bookNow.get(row.key), bookThen?.get(row.key), Boolean(then));
    const feedKeys = [...new Set([...feedNow.keys(), ...feedBookNow.keys()])].filter((feedKey) => catalog.feedByKey.get(feedKey)?.company_slug === row.key);
    if (!feedKeys.length) continue;
    const children = rankedRows({
      current: new Map(feedKeys.map((feedKey) => [feedKey, feedNow.get(feedKey) ?? emptyLeadAgg()])),
      comparison: feedThen,
      label: (feedKey) => catalog.feedByKey.get(feedKey)?.label ?? feedKey,
      toMetrics: (a, b) => leadRowMetrics(a, b, Boolean(then)),
      rankValue: (agg) => agg.leads * 1_000 + agg.booked,
      notes: (feedKey, agg) => {
        const feed = catalog.feedByKey.get(feedKey);
        const rate = feed ? currentFeedRate(catalog, feed.id, today) : null;
        return { rate_label: rate !== null ? rateLabel([rate]) : rateLabel(agg.rates), channel: feed?.channel ?? null, unpriced: agg.unpriced };
      },
    });
    row.children = children.map((child) => withActivity(child, feedBookNow.get(child.key), feedBookThen?.get(child.key), Boolean(then)));
  }
  return rows;
}

const LOCAL_LABELS: Record<string, string> = { local: "Local", long_distance: "Long distance", unknown: "Not recorded" };
const UNKNOWN_STATES = new Set(["", "UNKNOWN", "N/A", "NA", "NOT PROVIDED", "XX"]);
const knownState = (value: string | null): string | null => (value && !UNKNOWN_STATES.has(value) && value.length <= 3 ? value : null);

function simpleLeadRows(
  now: PeriodFacts,
  then: PeriodFacts | null,
  key: (lead: LeadFact) => string | null,
  label: (key: string) => string,
  limit?: number,
): InsightsRow[] {
  return rankedRows({
    current: leadGroups(now, key),
    comparison: then ? leadGroups(then, key) : null,
    label,
    toMetrics: (a, b) => leadRowMetrics(a, b, Boolean(then)),
    rankValue: (agg) => agg.leads * 1_000 + agg.booked,
    limit,
  });
}

type RepAgg = BookingAgg & { split: number; over_2k: number; over_4k: number; name: string; rows: Array<{ day: string; binder: number }> };

function repGroups(bookings: readonly BookingFact[]): Map<string, RepAgg> {
  const groups = new Map<string, RepAgg>();
  for (const booking of bookings) {
    const count = booking.allocations.length || 1;
    for (const allocation of booking.allocations) {
      const key = allocation.agent_id ?? `name:${allocation.agent_name.toLowerCase()}`;
      const agg = groups.get(key) ?? { bookings: 0, binder: 0, deposits: 0, cancelled: 0, split: 0, over_2k: 0, over_4k: 0, name: allocation.agent_name, rows: [] };
      const share = booking.binder > 0 ? allocation.binder / booking.binder : 1 / count;
      agg.bookings += 1;
      agg.binder = round2(agg.binder + allocation.binder);
      agg.deposits = round2(agg.deposits + booking.deposit * share);
      if (booking.cancelled) agg.cancelled += 1;
      if (count > 1) agg.split += 1;
      if (booking.binder >= 2000) agg.over_2k += 1;
      if (booking.binder >= 4000) agg.over_4k += 1;
      agg.rows.push({ day: booking.day, binder: allocation.binder });
      groups.set(key, agg);
    }
  }
  return groups;
}

function salesAgentRows(now: PeriodFacts, then: PeriodFacts | null, period: InsightsPeriod, rowBucket: InsightsBucket): InsightsRow[] {
  const current = repGroups(now.bookings);
  const comparison = then ? repGroups(then.bookings) : null;
  return rankedRows({
    current,
    comparison,
    label: (_key, agg) => agg.name,
    rankValue: (agg) => agg.binder,
    toMetrics: (a, b) => {
      const x = a!;
      const y = comparison ? (b ?? { bookings: 0, binder: 0, deposits: 0, cancelled: 0, split: 0, over_2k: 0, over_4k: 0 }) : null;
      return {
        bookings: metric(x.bookings, y?.bookings ?? null, "count", "up"),
        split_bookings: metric(x.split, y?.split ?? null, "count", "none"),
        // A rep's money moves in whole bookings, so the percent is withheld below the minimum booking base.
        binder: metric(x.binder, y?.binder ?? null, "money", "up", { base: x.bookings, comparisonBase: y?.bookings }),
        deposits: metric(x.deposits, y?.deposits ?? null, "money", "up", { base: x.bookings, comparisonBase: y?.bookings }),
        average_binder: metric(ratio(x.binder, x.bookings), y ? ratio(y.binder, y.bookings) : null, "money", "up", { base: x.bookings, comparisonBase: y?.bookings }),
        over_2k: metric(x.over_2k, y?.over_2k ?? null, "count", "up"),
        over_4k: metric(x.over_4k, y?.over_4k ?? null, "count", "up"),
        cancel_rate: metric(ratio(x.cancelled, x.bookings), y ? ratio(y.cancelled, y.bookings) : null, "rate", "down", { base: x.bookings, comparisonBase: y?.bookings }),
      };
    },
    series: (key) => seriesFor(current.get(key)!.rows, period, rowBucket, (row) => row.day, (row) => row.binder, () => 1),
  });
}

function receiverRows(catalog: InsightsCatalog, now: PeriodFacts, then: PeriodFacts | null, period: InsightsPeriod, rowBucket: InsightsBucket): InsightsRow[] {
  const key = (lead: LeadFact) => lead.receiver_id ?? "unassigned";
  const byKey = groupBy(now.leads, key);
  return rankedRows({
    current: leadGroups(now, key),
    comparison: then ? leadGroups(then, key) : null,
    label: (k) => (k === "unassigned" ? "Unassigned" : (catalog.agents.get(k)?.name ?? byKey.get(k)?.[0]?.receiver_name ?? "Unknown agent")),
    toMetrics: (a, b) => leadRowMetrics(a, b, Boolean(then)),
    rankValue: (agg) => agg.leads * 1_000 + agg.booked,
    series: (k) =>
      seriesFor(
        (byKey.get(k) ?? []).filter((lead) => !lead.duplicate),
        period,
        rowBucket,
        (lead) => lead.day,
        () => 1,
        (lead) => (lead.booked_id && now.cohortBookings.has(lead.booked_id) ? 1 : 0),
      ),
    notes: (k) => ({ active: k === "unassigned" ? null : (catalog.agents.get(k)?.active ?? null), unassigned: k === "unassigned" }),
  });
}

function merchantRows(now: PeriodFacts, then: PeriodFacts | null): InsightsRow[] {
  const group = (facts: PeriodFacts) => new Map([...groupBy(facts.bookings, (b) => b.merchant)].map(([k, rows]) => [k, aggregateBookings(rows)]));
  const comparison = then ? group(then) : null;
  return rankedRows({
    current: group(now),
    comparison,
    label: (key) => key,
    rankValue: (agg) => agg.binder,
    toMetrics: (a, b) => {
      const y = comparison ? (b ?? { bookings: 0, binder: 0, deposits: 0, cancelled: 0 }) : null;
      return {
        bookings: metric(a!.bookings, y?.bookings ?? null, "count", "up"),
        binder: metric(a!.binder, y?.binder ?? null, "money", "up"),
        deposits: metric(a!.deposits, y?.deposits ?? null, "money", "up"),
      };
    },
  });
}

function mix(now: PeriodFacts, then: PeriodFacts | null): InsightsNamedCount[] {
  const parts: Array<{ key: string; label: string; test: (b: BookingFact) => boolean }> = [
    { key: "with_lead", label: "From a paid lead", test: (b) => !b.referral && !b.leadless && Boolean(b.lead_id) },
    { key: "referral", label: "Referral", test: (b) => b.referral },
    { key: "no_lead", label: "No lead (booked directly)", test: (b) => !b.referral && (b.leadless || !b.lead_id) },
    { key: "local", label: "Local", test: (b) => b.local === "local" },
    { key: "long_distance", label: "Long distance", test: (b) => b.local === "long_distance" },
  ];
  return parts.map((part) => {
    const a = now.bookings.filter(part.test);
    const b = then ? then.bookings.filter(part.test) : [];
    return {
      key: part.key,
      label: part.label,
      count: a.length,
      comparison_count: b.length,
      amount: round2(a.reduce((sum, row) => sum + row.binder, 0)),
      comparison_amount: round2(b.reduce((sum, row) => sum + row.binder, 0)),
    };
  });
}

const TTB_BUCKETS = [
  { key: "same_day", label: "Same day", test: (d: number) => d === 0 },
  { key: "d1_3", label: "1–3 days", test: (d: number) => d >= 1 && d <= 3 },
  { key: "d4_7", label: "4–7 days", test: (d: number) => d >= 4 && d <= 7 },
  { key: "d8_30", label: "8–30 days", test: (d: number) => d >= 8 && d <= 30 },
  { key: "d30_plus", label: "Over 30 days", test: (d: number) => d > 30 },
];

function daysToBook(bookings: readonly BookingFact[]): number[] {
  return bookings.filter((b) => b.lead_day).map((b) => Math.max(0, daysBetween(b.lead_day!, b.day)));
}

export function timeToBook(now: PeriodFacts, then: PeriodFacts | null): InsightsTimeToBook {
  const a = daysToBook(now.bookings);
  const b = then ? daysToBook(then.bookings) : [];
  return {
    median_days: median(a),
    comparison_median_days: then ? median(b) : null,
    buckets: TTB_BUCKETS.map((bucket) => ({ key: bucket.key, label: bucket.label, count: a.filter(bucket.test).length, comparison_count: b.filter(bucket.test).length })),
    measured: a.length,
  };
}

function cancellationBlock(catalog: InsightsCatalog, now: PeriodFacts, then: PeriodFacts | null, score: InsightsMetric) {
  const sum = (facts: PeriodFacts) => round2(facts.cancellations.reduce((total, row) => total + row.refund, 0));
  const reasonsNow = groupBy(now.cancellations, (c) => c.reason);
  const reasonsThen = then ? groupBy(then.cancellations, (c) => c.reason) : new Map();
  const reasons = [...new Set([...reasonsNow.keys(), ...reasonsThen.keys()])]
    .map((reason) => ({ key: reason, label: reason, count: reasonsNow.get(reason)?.length ?? 0, comparison_count: reasonsThen.get(reason)?.length ?? 0 }))
    .filter((row) => row.count > 0)
    .sort((x, y) => y.count - x.count);
  const countRows = <K>(rows: Map<string, K[]>) => new Map([...rows].map(([k, list]) => [k, list.length]));
  const bySource = (facts: PeriodFacts) => countRows(groupBy(facts.cancellations, (c) => c.company));
  const byRep = (facts: PeriodFacts) => {
    const map = new Map<string, number>();
    for (const c of facts.cancellations) for (const agent of c.agents) map.set(agent, (map.get(agent) ?? 0) + 1);
    return map;
  };
  const countToRows = (current: Map<string, number>, comparison: Map<string, number> | null, label: (k: string) => string) =>
    rankedRows({
      current,
      comparison,
      label,
      rankValue: (value) => value,
      toMetrics: (a, b) => ({ cancellations: metric(a ?? 0, comparison ? (b ?? 0) : null, "count", "down") }),
    });
  return {
    count: metric(now.cancellations.length, then ? then.cancellations.length : null, "count", "down"),
    refunds: metric(sum(now), then ? sum(then) : null, "money", "down"),
    rate: score,
    reasons,
    by_source: countToRows(bySource(now), then ? bySource(then) : null, (k) => companyLabel(catalog, k)),
    by_rep: countToRows(byRep(now), then ? byRep(then) : null, (k) => k),
    timing: {
      booked_in_period: now.cancellations.filter((c) => inRange(c.booking_day, now.range)).length,
      booked_earlier: now.cancellations.filter((c) => !inRange(c.booking_day, now.range)).length,
    },
  };
}

/** Plain-sentence gains and drops across sources and reps (doc 09 "What moved"; shared with the report). */
export function movers(
  companies: InsightsRow[],
  salesAgents: InsightsRow[],
  receivers: InsightsRow[],
  totals: { leads: number; binder: number; spend: number },
): InsightsMover[] {
  type Candidate = InsightsMover & { score: number };
  const candidates: Candidate[] = [];
  const push = (row: InsightsRow, dimension: InsightsMover["dimension"], key: string, sentence: string, weight: number) => {
    const m = row.metrics[key];
    if (!m || m.tone === "neutral" || m.delta === null) return;
    if (m.kind !== "rate" && m.small_base && Math.abs(m.delta) < 10) return;
    candidates.push({
      direction: m.tone === "good" ? "gain" : "drop",
      dimension,
      key: row.key,
      label: row.label,
      metric: key,
      sentence,
      tone: m.tone,
      score: weight,
    });
  };
  for (const row of companies) {
    if (row.notes?.pseudo) continue;
    const leads = row.metrics.leads!;
    push(row, "source_company", "leads", describeChange(row.label, "leads", leads), Math.abs(leads.delta ?? 0) / Math.max(totals.leads, 1));
    const rate = row.metrics.booking_rate!;
    const base = leads.value ?? 0;
    if (base >= 20) push(row, "source_company", "booking_rate", describeChange(row.label, "booking rate", rate), (Math.abs(rate.delta ?? 0) * 10 * base) / Math.max(totals.leads, 1));
    const cpb = row.metrics.cost_per_booking!;
    if (cpb.delta !== null && !cpb.small_base) {
      const sentence = `${row.label} cost per booking ${cpb.delta < 0 ? "fell" : "rose"} $${Math.round(Math.abs(cpb.delta)).toLocaleString("en-US")}${cpb.delta_pct !== null ? ` (${cpb.delta < 0 ? "−" : "+"}${Math.round(Math.abs(cpb.delta_pct) * 100)}%)` : ""}`;
      push(row, "source_company", "cost_per_booking", sentence, (Math.abs(cpb.delta_pct ?? 0) * (row.metrics.spend?.value ?? 0)) / Math.max(totals.spend, 1));
    }
  }
  for (const row of salesAgents) {
    const binder = row.metrics.binder!;
    const change =
      binder.delta_pct !== null
        ? ` (${(binder.delta ?? 0) >= 0 ? "+" : "−"}${Math.round(Math.abs(binder.delta_pct) * 100)}%)`
        : ` (was $${Math.round(binder.comparison_value ?? 0).toLocaleString("en-US")})`;
    const sentence = `${row.label} booked $${Math.round(Math.abs(binder.delta ?? 0)).toLocaleString("en-US")} ${(binder.delta ?? 0) >= 0 ? "more" : "less"} binder${change}`;
    push(row, "sales_agent", "binder", sentence, Math.abs(binder.delta ?? 0) / Math.max(totals.binder, 1));
  }
  for (const row of receivers) {
    if (row.key === "unassigned") continue;
    const rate = row.metrics.booking_rate!;
    if ((row.metrics.leads?.value ?? 0) >= 20) {
      push(row, "receiver_agent", "booking_rate", describeChange(row.label, "booking rate on received leads", rate), (Math.abs(rate.delta ?? 0) * 10 * (row.metrics.leads?.value ?? 0)) / Math.max(totals.leads, 1));
    }
  }
  const pick = (direction: "gain" | "drop") =>
    candidates
      .filter((c) => c.direction === direction)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ score: _score, ...mover }) => mover);
  return [...pick("gain"), ...pick("drop")];
}

export function comparisonCoverage(comparison: Omit<InsightsComparison, "coverage">, firstDay: string | null): InsightsComparison["coverage"] {
  if (!firstDay) return "none";
  if (comparison.end_exclusive <= firstDay) return "none";
  return comparison.start < firstDay ? "partial" : "full";
}

export function buildAnalyticsReport(input: {
  catalog: InsightsCatalog;
  today: string;
  period: InsightsPeriod;
  comparison: InsightsComparison | null;
  sources: string[];
  now: PeriodFacts;
  then: PeriodFacts | null;
  generatedAt?: Date;
}): InsightsAnalyticsReport {
  const { catalog, period, comparison, now, then, today } = input;
  const rowBucket: InsightsBucket = period.days > 31 ? "week" : "day";
  const scoresNow = scoreValues(now);
  const scoresThen = then ? scoreValues(then) : null;
  const cards = scorecards(scoresNow, scoresThen);
  const companies = sourceRows(catalog, now, then, period, rowBucket, today);
  const salesAgents = salesAgentRows(now, then, period, rowBucket);
  const receivers = receiverRows(catalog, now, then, period, rowBucket);
  const ttb = timeToBook(now, then);
  const nonDuplicate = now.leads.filter((lead) => !lead.duplicate);
  const sourceOptions = [...catalog.companies.values()]
    .map((company) => ({
      key: company.slug,
      label: company.label,
      active: company.active,
      feeds: [...catalog.feeds.values()].filter((feed) => feed.company_slug === company.slug).map((feed) => ({ key: feed.key, label: feed.label })),
    }))
    .filter((company) => company.active || company.feeds.length)
    .map(({ active: _active, ...company }) => company)
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    generated_at: (input.generatedAt ?? new Date()).toISOString(),
    period,
    comparison,
    sources_filter: input.sources,
    source_options: sourceOptions,
    scorecards: cards,
    series: { bucket: period.bucket, current: overallSeries(now, period.bucket), comparison: then ? overallSeries(then, period.bucket) : [] },
    movers: then ? movers(companies, salesAgents, receivers, { leads: scoresNow._leads, binder: scoresNow.binder ?? 0, spend: scoresNow.lead_spend ?? 0 }) : [],
    data_quality: {
      unpriced_leads: nonDuplicate.filter((lead) => lead.price.status === "unpriced").length,
      unmapped_leads: nonDuplicate.filter((lead) => lead.price.status === "no_feed").length,
      receiver_attribution: ratio(nonDuplicate.filter((lead) => lead.receiver_id).length, nonDuplicate.length),
      unattributed_bookings: now.bookings.filter((booking) => booking.company === "unknown").length,
    },
    sources: {
      companies,
      local_vs_long_distance: simpleLeadRows(now, then, (lead) => lead.local ?? "unknown", (key) => LOCAL_LABELS[key] ?? key),
      pickup_states: simpleLeadRows(now, then, (lead) => knownState(lead.pickup_state), (key) => key, 25),
      lanes: simpleLeadRows(
        now,
        then,
        (lead) => {
          const from = knownState(lead.pickup_state);
          const to = knownState(lead.delivery_state);
          return from && to ? `${from}→${to}` : null;
        },
        (key) => key.replace("→", " → "),
        25,
      ),
      cohort_maturing: period.includes_today || daysBetween(period.end, today) < Math.max(1, Math.ceil(ttb.median_days ?? 7)),
    },
    team: { sales_agents: salesAgents, receiver_agents: receivers },
    bookings: {
      merchants: merchantRows(now, then),
      mix: mix(now, then),
      time_to_book: ttb,
      cancellations: cancellationBlock(catalog, now, then, cards.cancellation_rate),
    },
    definitions: INSIGHTS_DEFINITIONS,
  };
}
