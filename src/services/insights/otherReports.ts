/**
 * The smaller Insights reads: Reviews (doc 09 tab 5), the Outreach Desk's lead allocation cost per rep, the live
 * Daily Operations lead spend, and Today's Money tab (`GET /admin/money/spend`, SERVER-WORK T1). All price leads
 * with the live lead cost (`pricing.ts`).
 */
import { companyLabel, currentFeedRate, type InsightsCatalog } from "./catalog";
import type { BookingFact, LeadFact } from "./facts";
import { metric, ratio, round2 } from "./metrics";
import { addDays, inRange } from "./period";
import { rateLabel } from "./pricing";
import type {
  InsightsAllocationRep,
  InsightsAllocationReport,
  InsightsComparison,
  InsightsLeadSpendDay,
  InsightsMoneyRange,
  InsightsPeriod,
  InsightsReviewCard,
  InsightsReviewsReport,
} from "./types";

// ---------------------------------------------------------------- Reviews

export type ReviewFact = {
  id: string;
  day: string;
  rating: number;
  reviewer_name: string;
  text: string;
  responded: boolean;
  source: string;
  created_at: Date | null;
};

const REVIEW_STALE_DAYS = 14;

function reviewStats(rows: readonly ReviewFact[]) {
  const count = rows.length;
  const average = count ? rows.reduce((sum, row) => sum + row.rating, 0) / count : null;
  const responded = count ? rows.filter((row) => row.responded).length / count : null;
  return { count, average, responded };
}

export function buildReviewsReport(input: {
  all: readonly ReviewFact[];
  period: InsightsPeriod;
  comparison: InsightsComparison | null;
  now?: Date;
}): InsightsReviewsReport {
  const now = input.now ?? new Date();
  const inPeriod = input.all.filter((row) => inRange(row.day, input.period));
  const inComparison = input.comparison ? input.all.filter((row) => inRange(row.day, input.comparison!)) : [];
  const a = reviewStats(inPeriod);
  const b = input.comparison ? reviewStats(inComparison) : null;
  const all = reviewStats(input.all);
  const newest: InsightsReviewCard[] = [...input.all]
    .sort((x, y) => y.day.localeCompare(x.day))
    .slice(0, 3)
    .map((row) => ({
      id: row.id,
      reviewer_name: row.reviewer_name,
      rating: row.rating,
      review_date: row.day,
      excerpt: row.text.length > 220 ? `${row.text.slice(0, 217).trimEnd()}…` : row.text,
      responded: row.responded,
      source: row.source,
    }));
  const months = new Map<string, ReviewFact[]>();
  for (const row of input.all) {
    const month = row.day.slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), row]);
  }
  const monthly = [...months.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .slice(-12)
    .map(([month, rows]) => ({ month, count: rows.length, average_rating: reviewStats(rows).average }));
  const lastIngested = input.all.reduce<Date | null>((latest, row) => (row.created_at && (!latest || row.created_at > latest) ? row.created_at : latest), null);
  return {
    generated_at: now.toISOString(),
    period: input.period,
    comparison: input.comparison,
    average_rating: metric(a.average, b ? b.average : null, "ratio", "up", { base: a.count, comparisonBase: b?.count }),
    new_reviews: metric(a.count, b ? b.count : null, "count", "up"),
    response_rate: metric(a.responded, b ? b.responded : null, "rate", "up", { base: a.count, comparisonBase: b?.count }),
    all_time: { count: all.count, average_rating: all.average, response_rate: all.responded },
    stars: [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      all_time: input.all.filter((row) => row.rating === stars).length,
      period: inPeriod.filter((row) => row.rating === stars).length,
      comparison: inComparison.filter((row) => row.rating === stars).length,
    })),
    newest,
    monthly,
    last_ingested_at: lastIngested ? lastIngested.toISOString() : null,
    stale: !lastIngested || now.getTime() - lastIngested.getTime() > REVIEW_STALE_DAYS * 86_400_000,
  };
}

// ---------------------------------------------------------------- Allocation cost per rep (Outreach Desk)

type RepBucket = {
  leads: number;
  duplicates: number;
  spend: number;
  booked: number;
  companies: Map<string, { leads: number; spend: number }>;
  feeds: Map<string, { company: string; label: string; leads: number; spend: number; feedId: string }>;
};

function repBuckets(leads: readonly LeadFact[], booked: (lead: LeadFact) => boolean): Map<string, RepBucket> {
  const map = new Map<string, RepBucket>();
  for (const lead of leads) {
    const key = lead.receiver_id ?? "unassigned";
    const bucket = map.get(key) ?? { leads: 0, duplicates: 0, spend: 0, booked: 0, companies: new Map(), feeds: new Map() };
    if (lead.duplicate) {
      bucket.duplicates += 1;
      map.set(key, bucket);
      continue;
    }
    bucket.leads += 1;
    bucket.spend = round2(bucket.spend + lead.price.amount);
    if (booked(lead)) bucket.booked += 1;
    const company = bucket.companies.get(lead.company) ?? { leads: 0, spend: 0 };
    company.leads += 1;
    company.spend = round2(company.spend + lead.price.amount);
    bucket.companies.set(lead.company, company);
    const feedKey = lead.feed?.key ?? `none:${lead.company}`;
    const feed = bucket.feeds.get(feedKey) ?? { company: lead.company, label: lead.feed?.label ?? "No feed", leads: 0, spend: 0, feedId: lead.feed?.id ?? "" };
    feed.leads += 1;
    feed.spend = round2(feed.spend + lead.price.amount);
    bucket.feeds.set(feedKey, feed);
    map.set(key, bucket);
  }
  return map;
}

export function buildAllocationReport(input: {
  catalog: InsightsCatalog;
  today: string;
  period: InsightsPeriod;
  comparison: InsightsComparison | null;
  leads: readonly LeadFact[];
  comparisonLeads: readonly LeadFact[] | null;
  cohort: ReadonlyMap<string, BookingFact>;
  generatedAt?: Date;
}): InsightsAllocationReport {
  const { catalog } = input;
  const now = repBuckets(input.leads, (lead) => Boolean(lead.booked_id && input.cohort.has(lead.booked_id)));
  const then = input.comparisonLeads ? repBuckets(input.comparisonLeads, () => false) : null;
  // Every active rep shows, even with no leads yet, so "$0 allocated" is visible rather than missing.
  for (const agent of catalog.agents.values()) {
    if (agent.active && !now.has(agent.id)) now.set(agent.id, { leads: 0, duplicates: 0, spend: 0, booked: 0, companies: new Map(), feeds: new Map() });
  }
  const totalSpend = round2([...now.values()].reduce((sum, bucket) => sum + bucket.spend, 0));
  const reps: InsightsAllocationRep[] = [...now.entries()].map(([key, bucket]) => {
    const agent = key === "unassigned" ? null : catalog.agents.get(key);
    return {
      agent_id: key === "unassigned" ? null : key,
      agent_name: key === "unassigned" ? "Unassigned" : (agent?.name ?? (input.leads.find((lead) => lead.receiver_id === key)?.receiver_name || "Unknown agent")),
      active: agent ? agent.active : null,
      leads: bucket.leads,
      duplicates: bucket.duplicates,
      spend: bucket.spend,
      share_of_spend: ratio(bucket.spend, totalSpend),
      booked: bucket.booked,
      cost_per_booked: ratio(bucket.spend, bucket.booked),
      average_cpl: ratio(bucket.spend, bucket.leads),
      comparison_spend: then ? (then.get(key)?.spend ?? 0) : null,
      by_company: [...bucket.companies.entries()]
        .map(([slug, value]) => ({ source_company: slug, source_company_label: companyLabel(catalog, slug), ...value }))
        .sort((x, y) => y.spend - x.spend),
      by_feed: [...bucket.feeds.entries()]
        .map(([feedKey, value]) => ({
          source_company: value.company,
          source_company_label: companyLabel(catalog, value.company),
          feed_key: feedKey,
          feed_label: value.label,
          leads: value.leads,
          spend: value.spend,
          cpl: value.feedId ? currentFeedRate(catalog, value.feedId, input.today) : null,
        }))
        .sort((x, y) => y.spend - x.spend),
    };
  });
  reps.sort((x, y) => (x.agent_id === null ? 1 : y.agent_id === null ? -1 : y.spend - x.spend || x.agent_name.localeCompare(y.agent_name)));
  const companySpend = new Map<string, number>();
  for (const lead of input.leads) if (!lead.duplicate) companySpend.set(lead.company, round2((companySpend.get(lead.company) ?? 0) + lead.price.amount));
  const unassigned = now.get("unassigned")?.spend ?? 0;
  return {
    generated_at: (input.generatedAt ?? new Date()).toISOString(),
    period: input.period,
    comparison: input.comparison,
    totals: {
      leads: input.leads.filter((lead) => !lead.duplicate).length,
      spend: totalSpend,
      assigned_spend: round2(totalSpend - unassigned),
      unassigned_spend: unassigned,
      unpriced_leads: input.leads.filter((lead) => !lead.duplicate && lead.price.status === "unpriced").length,
    },
    companies: [...companySpend.entries()].map(([key, spend]) => ({ key, label: companyLabel(catalog, key), spend })).sort((x, y) => y.spend - x.spend),
    reps,
  };
}

// ---------------------------------------------------------------- Live lead spend (Today › Operations)

export function buildLeadSpendDay(input: { catalog: InsightsCatalog; today: string; nowHour: number; leads: readonly LeadFact[]; now?: Date }): InsightsLeadSpendDay {
  const yesterday = addDays(input.today, -1);
  const dayBefore = addDays(input.today, -2);
  const billable = input.leads.filter((lead) => !lead.duplicate);
  const sum = (rows: readonly LeadFact[]) => round2(rows.reduce((total, lead) => total + lead.price.amount, 0));
  const on = (day: string, byNow = false) => billable.filter((lead) => lead.day === day && (!byNow || lead.hour <= input.nowHour));
  const hourly = (day: string) => {
    const hours = Array.from({ length: 24 }, () => 0);
    for (const lead of on(day)) hours[lead.hour] = round2(hours[lead.hour]! + lead.price.amount);
    return hours;
  };
  const todays = on(input.today);
  const byCompany = new Map<string, { leads: number; spend: number; rates: Set<number> }>();
  for (const lead of todays) {
    const row = byCompany.get(lead.company) ?? { leads: 0, spend: 0, rates: new Set<number>() };
    row.leads += 1;
    row.spend = round2(row.spend + lead.price.amount);
    if (lead.price.status === "priced") row.rates.add(lead.price.amount);
    byCompany.set(lead.company, row);
  }
  return {
    generated_at: (input.now ?? new Date()).toISOString(),
    today: input.today,
    now_hour: input.nowHour,
    spend: {
      today: sum(todays),
      yesterday: sum(on(yesterday)),
      yesterday_by_now: sum(on(yesterday, true)),
      day_before: sum(on(dayBefore)),
      day_before_by_now: sum(on(dayBefore, true)),
    },
    leads: {
      today: todays.length,
      yesterday_by_now: on(yesterday, true).length,
      duplicates_today: input.leads.filter((lead) => lead.duplicate && lead.day === input.today).length,
      unpriced_today: todays.filter((lead) => lead.price.status === "unpriced").length,
    },
    hourly: { today: hourly(input.today), yesterday: hourly(yesterday) },
    by_company: [...byCompany.entries()]
      .map(([key, row]) => ({ key, label: companyLabel(input.catalog, key), leads: row.leads, spend: row.spend, cpl_label: rateLabel(row.rates) }))
      .sort((x, y) => y.spend - x.spend),
  };
}

// ---------------------------------------------------------------- Today › Money (SERVER-WORK T1)

export type MoneySpendResponse = {
  range: InsightsMoneyRange;
  generated_at: string;
  totals: { lead_spend: number; cost_per_lead: number | null; cost_per_booked_lead: number | null; rep_cost_per_lead: number | null; unpriced: number };
  by_source_company: Array<{
    source_company: string;
    source_company_label: string;
    leads: number;
    duplicates: number;
    rate_label: string | null;
    spend: number;
    booked: number;
    cost_per_booked: number | null;
    unpriced: number;
  }>;
  by_rep: Array<{
    agent_id: string;
    agent_name: string;
    leads_received: number;
    calls: number | null;
    booked: number;
    rep_cost: number | null;
    cost_per_lead: number | null;
    cost_per_booked: number | null;
    compensation_missing: boolean;
  }>;
};

export function buildMoneySpend(input: {
  catalog: InsightsCatalog;
  today: string;
  range: InsightsMoneyRange;
  leads: readonly LeadFact[];
  cohort: ReadonlyMap<string, BookingFact>;
  now?: Date;
}): MoneySpendResponse {
  const isBooked = (lead: LeadFact) => Boolean(lead.booked_id && input.cohort.has(lead.booked_id));
  const companies = new Map<string, { leads: number; duplicates: number; spend: number; booked: number; unpriced: number; rates: Set<number> }>();
  for (const lead of input.leads) {
    const row = companies.get(lead.company) ?? { leads: 0, duplicates: 0, spend: 0, booked: 0, unpriced: 0, rates: new Set<number>() };
    if (lead.duplicate) row.duplicates += 1;
    else {
      row.leads += 1;
      row.spend = round2(row.spend + lead.price.amount);
      if (isBooked(lead)) row.booked += 1;
      if (lead.price.status === "unpriced") row.unpriced += 1;
      if (lead.price.status === "priced") row.rates.add(lead.price.amount);
    }
    companies.set(lead.company, row);
  }
  const reps = new Map<string, { name: string; leads: number; booked: number }>();
  for (const lead of input.leads) {
    if (lead.duplicate || !lead.receiver_id) continue;
    const row = reps.get(lead.receiver_id) ?? { name: input.catalog.agents.get(lead.receiver_id)?.name ?? lead.receiver_name ?? "Unknown agent", leads: 0, booked: 0 };
    row.leads += 1;
    if (isBooked(lead)) row.booked += 1;
    reps.set(lead.receiver_id, row);
  }
  const billable = input.leads.filter((lead) => !lead.duplicate);
  const spend = round2(billable.reduce((sum, lead) => sum + lead.price.amount, 0));
  const booked = billable.filter(isBooked).length;
  return {
    range: input.range,
    generated_at: (input.now ?? new Date()).toISOString(),
    totals: {
      lead_spend: spend,
      cost_per_lead: ratio(spend, billable.length),
      cost_per_booked_lead: ratio(spend, booked),
      rep_cost_per_lead: null,
      unpriced: billable.filter((lead) => lead.price.status === "unpriced").length,
    },
    by_source_company: [...companies.entries()]
      .map(([key, row]) => ({
        source_company: key,
        source_company_label: companyLabel(input.catalog, key),
        leads: row.leads,
        duplicates: row.duplicates,
        rate_label: rateLabel(row.rates),
        spend: row.spend,
        booked: row.booked,
        cost_per_booked: ratio(row.spend, row.booked),
        unpriced: row.unpriced,
      }))
      .sort((x, y) => y.spend - x.spend),
    by_rep: [...reps.entries()]
      .map(([agentId, row]) => ({
        agent_id: agentId,
        agent_name: row.name,
        leads_received: row.leads,
        calls: null,
        booked: row.booked,
        // Rep compensation (SERVER-WORK T3) is not recorded yet: "no rate", never $0.
        rep_cost: null,
        cost_per_lead: null,
        cost_per_booked: null,
        compensation_missing: true,
      }))
      .sort((x, y) => y.leads_received - x.leads_received),
  };
}

export function moneyRangeDays(range: InsightsMoneyRange, today: string): { start: string; end_exclusive: string } {
  switch (range) {
    case "today":
      return { start: today, end_exclusive: addDays(today, 1) };
    case "yesterday":
      return { start: addDays(today, -1), end_exclusive: today };
    case "this_week": {
      const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
      return { start: addDays(today, -((weekday + 6) % 7)), end_exclusive: addDays(today, 1) };
    }
    case "this_month":
      return { start: `${today.slice(0, 7)}-01`, end_exclusive: addDays(today, 1) };
  }
}
