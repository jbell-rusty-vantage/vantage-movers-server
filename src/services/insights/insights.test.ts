import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildAnalyticsReport, comparisonCoverage, timeToBook } from "./analyticsReport";
import { buildInsightsCatalog, type InsightsCatalog } from "./catalog";
import type { BookingFact, LeadFact, PeriodFacts } from "./facts";
import { filterFacts, toLeadFact } from "./facts";
import { metric } from "./metrics";
import { buildAllocationReport, buildLeadSpendDay, buildMoneySpend, buildReviewsReport } from "./otherReports";
import { bucketKeys, resolvePeriods } from "./period";
import { priceForDay, priceLead, rateLabel } from "./pricing";

// 2026-10-06 18:00 New York (EDT, UTC−4).
const NOW = new Date("2026-10-06T22:00:00.000Z");

describe("period engine", () => {
  const resolve = (preset: Parameters<typeof resolvePeriods>[0]["preset"], extra: Partial<Parameters<typeof resolvePeriods>[0]> = {}) =>
    resolvePeriods({ preset, compare: "previous", ...extra }, NOW);

  test("today is the New York day, half-open, compared with yesterday", () => {
    const { today, period, comparison } = resolve("today");
    assert.equal(today, "2026-10-06");
    assert.deepEqual([period.start, period.end_exclusive, period.end, period.days], ["2026-10-06", "2026-10-07", "2026-10-06", 1]);
    assert.equal(period.includes_today, true);
    assert.deepEqual([comparison!.start, comparison!.end_exclusive], ["2026-10-05", "2026-10-06"]);
  });

  test("a late-evening UTC instant is still the New York day (no cut-off last day)", () => {
    const { today } = resolvePeriods({ preset: "today", compare: "none" }, new Date("2026-10-07T03:30:00.000Z"));
    assert.equal(today, "2026-10-06");
  });

  test("last 30 days includes today; previous is the 30 days before", () => {
    const { period, comparison } = resolve("last_30");
    assert.deepEqual([period.start, period.end_exclusive, period.days], ["2026-09-07", "2026-10-07", 30]);
    assert.deepEqual([comparison!.start, comparison!.end_exclusive, comparison!.days], ["2026-08-08", "2026-09-07", 30]);
    assert.equal(period.label, "Sep 7 – Oct 6, 2026");
  });

  test("to-date presets compare with the same elapsed span of the previous unit", () => {
    const week = resolve("this_week"); // Tuesday
    assert.deepEqual([week.period.start, week.period.end_exclusive], ["2026-10-05", "2026-10-07"]);
    assert.deepEqual([week.comparison!.start, week.comparison!.end_exclusive], ["2026-09-28", "2026-09-30"]);
    const month = resolve("this_month");
    assert.deepEqual([month.comparison!.start, month.comparison!.end_exclusive], ["2026-09-01", "2026-09-07"]);
    const lastMonth = resolve("last_month");
    assert.deepEqual([lastMonth.period.start, lastMonth.period.end_exclusive], ["2026-09-01", "2026-10-01"]);
    assert.deepEqual([lastMonth.comparison!.start, lastMonth.comparison!.end_exclusive], ["2026-08-01", "2026-09-01"]);
  });

  test("month-to-date on the 31st clamps the comparison to the previous month", () => {
    const { comparison } = resolvePeriods({ preset: "this_month", compare: "previous" }, new Date("2026-03-31T16:00:00.000Z"));
    assert.deepEqual([comparison!.start, comparison!.end_exclusive], ["2026-02-01", "2026-03-01"]);
  });

  test("same period last year and custom ranges", () => {
    const lastYear = resolve("last_30", { compare: "last_year" });
    assert.deepEqual([lastYear.comparison!.start, lastYear.comparison!.end_exclusive], ["2025-09-07", "2025-10-07"]);
    const custom = resolve("custom", { from: "2026-09-01", to: "2026-09-10" });
    assert.deepEqual([custom.period.start, custom.period.end_exclusive, custom.period.days], ["2026-09-01", "2026-09-11", 10]);
    assert.deepEqual([custom.comparison!.start, custom.comparison!.end_exclusive], ["2026-08-22", "2026-09-01"]);
    assert.throws(() => resolve("custom", { from: "2026-09-10", to: "2026-09-01" }), /on or after/);
    assert.throws(() => resolve("custom", { from: "2026-02-30", to: "2026-03-01" }), /YYYY-MM-DD/);
  });

  test("buckets are days up to a month and Monday weeks above it", () => {
    assert.equal(resolve("last_30").period.bucket, "day");
    const ninety = resolve("last_90");
    assert.equal(ninety.period.bucket, "week");
    const keys = bucketKeys(ninety.period, "week");
    assert.equal(keys[0], ninety.period.start);
    assert.equal(new Date(`${keys[1]}T00:00:00Z`).getUTCDay(), 1);
  });

  test("comparison coverage before the first recorded lead", () => {
    const { comparison } = resolve("last_30", { compare: "last_year" });
    assert.equal(comparisonCoverage(comparison!, "2026-04-30"), "none");
    const ytd = resolve("custom", { from: "2026-05-01", to: "2026-05-30" });
    assert.equal(comparisonCoverage(ytd.comparison!, "2026-04-30"), "partial");
    assert.equal(comparisonCoverage(resolve("last_30").comparison!, "2026-04-30"), "full");
  });
});

describe("live lead pricing", () => {
  const periods = [
    { amount: 205, from: "2024-01-01", until: "2026-10-01" },
    { amount: 190, from: "2026-10-01" },
  ];
  test("the period covering the lead's day prices it", () => {
    assert.equal(priceForDay(periods, "2026-09-30"), 205);
    assert.equal(priceForDay(periods, "2026-10-01"), 190);
    assert.equal(priceForDay([], "2026-10-01"), null);
    assert.equal(priceForDay([{ amount: 1, from: "2026-11-01" }], "2026-10-01"), null);
  });
  test("duplicates are free, no feed has no cost, a gap is unpriced", () => {
    const catalog = { periodsByFeed: new Map([["f1", periods]]) };
    const feed = { id: "f1", key: "tbm_leads_form", label: "TBM Forms", channel: "form" as const, company_slug: "tbm_leads", active: true };
    assert.deepEqual(priceLead(catalog, { feed, day: "2026-10-02", duplicate: false }), { status: "priced", amount: 190 });
    assert.deepEqual(priceLead(catalog, { feed, day: "2026-10-02", duplicate: true }), { status: "duplicate", amount: 0 });
    assert.deepEqual(priceLead(catalog, { feed: null, day: "2026-10-02", duplicate: false }), { status: "no_feed", amount: 0 });
    assert.deepEqual(priceLead({ periodsByFeed: new Map() }, { feed, day: "2026-10-02", duplicate: false }), { status: "unpriced", amount: 0 });
  });
  test("rate labels", () => {
    assert.equal(rateLabel([205, 205]), "$205");
    assert.equal(rateLabel([195, 40]), "$40–$195");
    assert.equal(rateLabel([]), null);
  });
});

describe("comparison rules", () => {
  test("rates move in points, counts in percent, tone follows the business", () => {
    const rate = metric(0.134, 0.122, "rate", "up", { base: 400, comparisonBase: 380 });
    assert.equal(rate.delta_pct, null);
    assert.ok(Math.abs(rate.delta! - 0.012) < 1e-9);
    assert.equal(rate.tone, "good");
    const cost = metric(412, 453, "money", "down");
    assert.equal(cost.tone, "good");
    assert.ok(Math.abs(cost.delta_pct! + 41 / 453) < 1e-9);
    assert.equal(metric(500, 450, "money", "down").tone, "bad");
  });
  test("below the minimum base the percent is withheld", () => {
    const small = metric(4, 1, "count", "up");
    assert.equal(small.small_base, true);
    assert.equal(small.delta_pct, null);
    assert.equal(small.delta, 3);
    assert.equal(metric(40, 20, "count", "up").delta_pct, 1);
  });
  test("no comparison side leaves the delta empty and neutral", () => {
    const solo = metric(10, null, "count", "up");
    assert.equal(solo.delta, null);
    assert.equal(solo.tone, "neutral");
  });
});

// ---------------------------------------------------------------- report fixtures

function catalogWith(amounts: { tbm: number; top10: number }): InsightsCatalog {
  return buildInsightsCatalog({
    companyDocs: [
      { _id: "c1", company_slug: "tbm_leads", owner_label: "TBM", active: true },
      { _id: "c2", company_slug: "top10_leads", owner_label: "Top 10", active: true },
    ],
    feedDocs: [
      { _id: "f1", source_company: "c1", granularity_key: "tbm_leads_form", owner_label: "TBM Forms", channel: "form", active: true },
      { _id: "f2", source_company: "c2", granularity_key: "top10_leads_form", owner_label: "Top 10 Forms", channel: "form", active: true },
    ],
    periodDocs: [
      { source_granularity: "f1", amount_cents: amounts.tbm * 100, effective_from_date: "2024-01-01" },
      { source_granularity: "f2", amount_cents: amounts.top10 * 100, effective_from_date: "2024-01-01" },
    ],
    agentDocs: [
      { _id: "a1", name: "Austin", active: true },
      { _id: "a2", name: "Nick", active: true },
      { _id: "a3", name: "Dylan", active: true },
    ],
    firstDay: "2026-04-30",
  });
}

let seq = 0;
function lead(catalog: InsightsCatalog, input: { feed: "f1" | "f2"; day: string; duplicate?: boolean; receiver?: string; booked?: string }): LeadFact {
  seq += 1;
  const fact = toLeadFact(catalog, "form", {
    _id: `l${seq}`,
    timestamp: new Date(`${input.day}T12:00:00.000Z`),
    createdAt: new Date(`${input.day}T16:00:01.000Z`),
    source_granularity_id: input.feed,
    duplicate: input.duplicate ?? false,
    receiver_agent: input.receiver,
    booked: input.booked,
  });
  assert.ok(fact);
  return fact;
}

function booking(input: { id: string; day: string; binder: number; deposit: number; company?: string; leadDay?: string; allocations: Array<[string, string, number]>; cancelled?: boolean }): BookingFact {
  return {
    id: input.id,
    day: input.day,
    binder: input.binder,
    deposit: input.deposit,
    merchant: "Elavon",
    local: "long_distance",
    referral: false,
    leadless: false,
    cancelled: input.cancelled ?? false,
    allocations: input.allocations.map(([agent_id, agent_name, binder]) => ({ agent_id, agent_name, binder })),
    lead_id: input.leadDay ? "lead" : null,
    lead_day: input.leadDay ?? null,
    feed: null,
    company: input.company ?? "tbm_leads",
  };
}

function facts(catalog: InsightsCatalog, range: { start: string; end_exclusive: string }, rows: { leads: LeadFact[]; bookings: BookingFact[] }): PeriodFacts {
  const cohort = new Map(rows.bookings.map((b) => [b.id, b]));
  return { range, leads: rows.leads, bookings: rows.bookings, cancellations: [], cohortBookings: cohort };
}

function scenario(amounts: { tbm: number; top10: number }) {
  const catalog = catalogWith(amounts);
  const { today, period, comparison } = resolvePeriods({ preset: "last_30", compare: "previous" }, NOW);
  const nowLeads = [
    ...Array.from({ length: 30 }, (_, i) => lead(catalog, { feed: "f1", day: "2026-09-20", receiver: i % 2 ? "a1" : "a2", booked: i < 3 ? `b${i}` : undefined })),
    ...Array.from({ length: 10 }, () => lead(catalog, { feed: "f2", day: "2026-10-01", receiver: "a2" })),
    lead(catalog, { feed: "f1", day: "2026-09-21", duplicate: true, receiver: "a1" }),
  ];
  const nowBookings = [
    booking({ id: "b0", day: "2026-09-22", binder: 2000, deposit: 2200, leadDay: "2026-09-20", allocations: [["a1", "Austin", 1000], ["a2", "Nick", 1000]] }),
    booking({ id: "b1", day: "2026-09-20", binder: 1000, deposit: 1100, leadDay: "2026-09-20", allocations: [["a1", "Austin", 1000]] }),
    booking({ id: "b2", day: "2026-09-30", binder: 4500, deposit: 4500, leadDay: "2026-09-20", allocations: [["a2", "Nick", 4500]], cancelled: true }),
  ];
  const thenLeads = Array.from({ length: 20 }, () => lead(catalog, { feed: "f2", day: "2026-08-20", receiver: "a2" }));
  const thenBookings = [booking({ id: "p1", day: "2026-08-25", binder: 1000, deposit: 1000, company: "top10_leads", allocations: [["a2", "Nick", 1000]] })];
  return {
    catalog,
    report: buildAnalyticsReport({
      catalog,
      today,
      period,
      comparison: { ...comparison!, coverage: "full" },
      sources: [],
      now: facts(catalog, period, { leads: nowLeads, bookings: nowBookings }),
      then: facts(catalog, comparison!, { leads: thenLeads, bookings: thenBookings }),
      generatedAt: NOW,
    }),
    nowLeads,
    nowBookings,
    period,
    comparison,
  };
}

describe("analytics report", () => {
  test("lead spend is the live lead cost: change a feed's cost and the report changes", () => {
    const before = scenario({ tbm: 205, top10: 190 }).report;
    assert.equal(before.scorecards.lead_spend.value, 30 * 205 + 10 * 190);
    const after = scenario({ tbm: 150, top10: 190 }).report;
    assert.equal(after.scorecards.lead_spend.value, 30 * 150 + 10 * 190);
    assert.equal(after.scorecards.lead_spend.comparison_value, 20 * 190);
    assert.equal(after.scorecards.duplicates.value, 1);
    assert.equal(after.scorecards.leads.value, 40);
  });

  test("scorecards: activity booking rate, cost per booking, cancellation rate", () => {
    const { report } = scenario({ tbm: 205, top10: 190 });
    assert.equal(report.scorecards.bookings.value, 3);
    assert.equal(report.scorecards.booking_rate.value, 3 / 40);
    assert.equal(report.scorecards.cost_per_booking.value, (30 * 205 + 10 * 190) / 3);
    assert.equal(report.scorecards.cancellation_rate.value, 1 / 3);
    assert.equal(report.scorecards.binder.value, 7500);
    assert.equal(report.series.current.length, 30);
    assert.equal(report.series.comparison.length, 30);
  });

  test("source rows: cohort conversion, rank change, rate label", () => {
    const { report } = scenario({ tbm: 205, top10: 190 });
    const [tbm, top10] = report.sources.companies;
    assert.equal(tbm!.key, "tbm_leads");
    assert.equal(tbm!.metrics.leads!.value, 30);
    assert.equal(tbm!.metrics.booked!.value, 3);
    assert.equal(tbm!.metrics.binder!.value, 7500);
    assert.equal(tbm!.is_new, true);
    assert.equal(tbm!.notes?.rate_label, "$205");
    assert.equal(tbm!.children?.[0]?.label, "TBM Forms");
    assert.equal(top10!.rank, 2);
    assert.equal(top10!.rank_change, -1);
    assert.equal(top10!.metrics.leads!.comparison_value, 20);
  });

  test("split credit: each agent gets its own binder and the same share of the deposit", () => {
    const { report } = scenario({ tbm: 205, top10: 190 });
    const austin = report.team.sales_agents.find((row) => row.label === "Austin")!;
    const nick = report.team.sales_agents.find((row) => row.label === "Nick")!;
    assert.equal(austin.metrics.bookings!.value, 2);
    assert.equal(austin.metrics.split_bookings!.value, 1);
    assert.equal(austin.metrics.binder!.value, 2000);
    assert.equal(austin.metrics.deposits!.value, 1100 + 1100);
    assert.equal(nick.metrics.binder!.value, 5500);
    assert.equal(nick.metrics.deposits!.value, 1100 + 4500);
    assert.equal(nick.metrics.over_4k!.value, 1);
    // Deposits never sum to more than were taken.
    const total = report.team.sales_agents.reduce((sum, row) => sum + (row.metrics.deposits!.value ?? 0), 0);
    assert.equal(total, report.scorecards.deposits.value);
  });

  test("receivers carry allocated spend and an Unassigned row only when needed", () => {
    const { report } = scenario({ tbm: 205, top10: 190 });
    const nick = report.team.receiver_agents.find((row) => row.label === "Nick")!;
    assert.equal(nick.metrics.leads!.value, 15 + 10);
    assert.equal(nick.metrics.spend!.value, 15 * 205 + 10 * 190);
    assert.equal(report.team.receiver_agents.some((row) => row.key === "unassigned"), false);
    assert.equal(report.data_quality.receiver_attribution, 1);
  });

  test("the sources filter narrows leads and bookings together", () => {
    const { catalog, nowLeads, nowBookings, period } = scenario({ tbm: 205, top10: 190 });
    const filtered = filterFacts(facts(catalog, period, { leads: nowLeads, bookings: nowBookings }), ["top10_leads"]);
    assert.equal(filtered.leads.length, 10);
    assert.equal(filtered.bookings.length, 0);
  });

  test("time to book: median and buckets", () => {
    const { catalog, nowLeads, nowBookings, period } = scenario({ tbm: 205, top10: 190 });
    const ttb = timeToBook(facts(catalog, period, { leads: nowLeads, bookings: nowBookings }), null);
    assert.equal(ttb.median_days, 2);
    assert.deepEqual(ttb.buckets.map((bucket) => bucket.count), [1, 1, 0, 1, 0]);
  });

  test("movers name the biggest gains and drops in words", () => {
    const { report } = scenario({ tbm: 205, top10: 190 });
    assert.ok(report.movers.length > 0);
    for (const mover of report.movers) assert.ok(mover.sentence.length > 10);
    assert.ok(report.movers.some((mover) => mover.label === "TBM" && mover.metric === "leads" && mover.direction === "gain"));
  });
});

describe("other reports", () => {
  test("allocation cost per rep reconciles with total spend, every active rep shows", () => {
    const { catalog, nowLeads, nowBookings, period } = scenario({ tbm: 205, top10: 190 });
    const report = buildAllocationReport({
      catalog,
      today: "2026-10-06",
      period: { ...period, preset: "last_30", bucket: "day", includes_today: true },
      comparison: null,
      leads: nowLeads,
      comparisonLeads: null,
      cohort: new Map(nowBookings.map((b) => [b.id, b])),
    });
    assert.equal(report.totals.spend, 30 * 205 + 10 * 190);
    assert.equal(report.reps.reduce((sum, rep) => sum + rep.spend, 0), report.totals.spend);
    const dylan = report.reps.find((rep) => rep.agent_name === "Dylan")!;
    assert.equal(dylan.spend, 0);
    const nick = report.reps.find((rep) => rep.agent_name === "Nick")!;
    assert.deepEqual(nick.by_company.map((row) => row.source_company), ["tbm_leads", "top10_leads"]);
    assert.equal(nick.by_feed.find((row) => row.feed_key === "top10_leads_form")!.cpl, 190);
    assert.equal(report.totals.unassigned_spend, 0);
  });

  test("live daily spend paces against yesterday by the same hour", () => {
    const catalog = catalogWith({ tbm: 205, top10: 190 });
    const leads = [
      { ...lead(catalog, { feed: "f1", day: "2026-10-06" }), hour: 9 },
      { ...lead(catalog, { feed: "f2", day: "2026-10-06" }), hour: 17 },
      { ...lead(catalog, { feed: "f1", day: "2026-10-05" }), hour: 10 },
      { ...lead(catalog, { feed: "f1", day: "2026-10-05" }), hour: 21 },
      { ...lead(catalog, { feed: "f1", day: "2026-10-06", duplicate: true }), hour: 11 },
    ];
    const day = buildLeadSpendDay({ catalog, today: "2026-10-06", nowHour: 18, leads, now: NOW });
    assert.deepEqual(day.spend, { today: 395, yesterday: 410, yesterday_by_now: 205, day_before: 0, day_before_by_now: 0 });
    assert.equal(day.leads.duplicates_today, 1);
    assert.equal(day.hourly.today[17], 190);
    assert.deepEqual(day.by_company.map((row) => [row.key, row.cpl_label]), [["tbm_leads", "$205"], ["top10_leads", "$190"]]);
  });

  test("money spend: rep cost is missing, never $0", () => {
    const { catalog, nowLeads, nowBookings } = scenario({ tbm: 205, top10: 190 });
    const money = buildMoneySpend({ catalog, today: "2026-10-06", range: "this_month", leads: nowLeads, cohort: new Map(nowBookings.map((b) => [b.id, b])) });
    assert.equal(money.totals.lead_spend, 30 * 205 + 10 * 190);
    assert.equal(money.totals.cost_per_booked_lead, (30 * 205 + 10 * 190) / 3);
    assert.ok(money.by_rep.every((rep) => rep.rep_cost === null && rep.compensation_missing));
    assert.equal(money.by_source_company.find((row) => row.source_company === "tbm_leads")!.duplicates, 1);
  });

  test("reviews: stars, response rate and staleness", () => {
    const { period, comparison } = resolvePeriods({ preset: "last_90", compare: "previous" }, NOW);
    const review = (day: string, rating: number, responded = false) => ({
      id: day + rating,
      day,
      rating,
      reviewer_name: "A",
      text: "x".repeat(300),
      responded,
      source: "BBB",
      created_at: new Date("2026-07-09T21:13:09.995Z"),
    });
    const report = buildReviewsReport({
      all: [review("2026-07-20", 1), review("2026-09-01", 5, true), review("2026-05-01", 5)],
      period: { ...period },
      comparison: { ...comparison!, coverage: "full" },
      now: NOW,
    });
    assert.equal(report.new_reviews.value, 2);
    assert.equal(report.average_rating.value, 3);
    assert.equal(report.response_rate.value, 0.5);
    assert.equal(report.stars.find((row) => row.stars === 5)!.all_time, 2);
    assert.equal(report.newest[0]!.review_date, "2026-09-01");
    assert.ok(report.newest[0]!.excerpt.endsWith("…"));
    assert.equal(report.stale, true);
  });
});
