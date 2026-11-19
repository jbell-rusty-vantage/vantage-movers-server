import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildAnalyticsReport } from "./analyticsReport";
import { buildInsightsCatalog, type InsightsCatalog } from "./catalog";
import type { BookingFact, LeadFact, PeriodFacts } from "./facts";
import { toLeadFact } from "./facts";
import { buildAllocationReport, buildLeadSpendDay, buildMoneySpend } from "./otherReports";
import { resolvePeriods } from "./period";

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

  test("month-to-date on the 31st clamps the comparison to the previous month", () => {
    const { comparison } = resolvePeriods({ preset: "this_month", compare: "previous" }, new Date("2026-03-31T16:00:00.000Z"));
    assert.deepEqual([comparison!.start, comparison!.end_exclusive], ["2026-02-01", "2026-03-01"]);
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
});

test("bad Calls have a distinct zero-cost disposition across Insights while official outcomes remain unchanged", () => {
  const catalog = catalogWith({ tbm: 205, top10: 190 });
  const at = new Date("2026-11-03T17:00:00.000Z");
  const { today, period } = resolvePeriods({ preset: "today", compare: "none" }, at);
  const rc = { call_log_id: "rc-call", duration_seconds: 120, ingestion_source: "call_log_sync", qualification_reason: "call_log_inbound_target_answered_over_120s", start_time: new Date("2026-11-03T06:30:00Z"), final_result: "Missed", final_result_answered: false, final_result_observed_at: at, final_result_call_log_id: "rc-call" };
  const call = (id: string, overrides: Record<string, unknown>) => {
    const fact = toLeadFact(catalog, "call", { _id: id, timestamp: new Date("2026-11-03T12:00:00Z"), createdAt: at, source_granularity_id: "f1", receiver_agent: "a1", ringcentral: rc, ...overrides });
    assert.ok(fact);
    return fact;
  };
  const regular = call("normal", { ringcentral: { ...rc, final_result: "Call connected", final_result_answered: true } });
  const bad = call("bad", { booked: "official-bad" });
  const overlap = call("overlap", { form_fill: true, booked: "official-duplicate" });
  assert.deepEqual([regular.price, bad.price, overlap.price], [{ status: "priced", amount: 205 }, { status: "nonbillable", amount: 0 }, { status: "duplicate", amount: 0 }]);
  const leads = [regular, bad, overlap];
  const bookings = [
    booking({ id: "official-bad", day: today, binder: 1000, deposit: 500, allocations: [["a1", "Austin", 1000]], cancelled: true }),
    booking({ id: "official-duplicate", day: today, binder: 2000, deposit: 1000, allocations: [["a1", "Austin", 2000]] }),
  ];
  const now = facts(catalog, period, { leads, bookings });
  now.cancellations = [{ id: "cancel-bad", day: today, refund: 100, reason: "Fixture", booking_day: today, company: "tbm_leads", feed: regular.feed, agents: ["Austin"] }];
  const report = buildAnalyticsReport({ catalog, today, period, comparison: null, sources: [], now, then: null, generatedAt: at });
  assert.equal(report.scorecards.leads.value, 1);
  assert.equal(report.scorecards.duplicates.value, 1);
  assert.equal(report.scorecards.bad_calls.value, 1);
  assert.equal(report.scorecards.lead_spend.value, 205);
  assert.equal(report.scorecards.cost_per_lead.value, 205);
  assert.deepEqual(report.series.current.map((point) => [point.leads, point.duplicates, point.bad_calls, point.spend, point.bookings, point.binder, point.deposits, point.cancellations]), [[1, 1, 1, 205, 2, 3000, 1500, 1]]);
  assert.equal(report.sources.companies[0]!.metrics.bad_calls!.value, 1);
  assert.equal(report.scorecards.bookings.value, 2);
  assert.equal(report.bookings.cancellations.count.value, 1);
  assert.equal(report.bookings.cancellations.refunds.value, 100);
  assert.equal(report.scorecards.binder.value, 3000);
  assert.equal(report.scorecards.deposits.value, 1500);

  const allocation = buildAllocationReport({ catalog, today, period, comparison: null, leads, comparisonLeads: null, cohort: now.cohortBookings, generatedAt: at });
  assert.deepEqual([allocation.totals.leads, allocation.totals.duplicates, allocation.totals.bad_calls, allocation.totals.spend], [1, 1, 1, 205]);
  const rep = allocation.reps.find((row) => row.agent_id === "a1")!;
  assert.deepEqual([rep.leads, rep.duplicates, rep.bad_calls, rep.spend, rep.booked], [1, 1, 1, 205, 0]);
  const day = buildLeadSpendDay({ catalog, today, nowHour: 12, leads, now: at });
  assert.deepEqual([day.leads.today, day.leads.duplicates_today, day.leads.bad_calls_today, day.spend.today], [1, 1, 1, 205]);
  assert.equal(day.hourly.today.reduce((sum, value) => sum + value, 0), 205);
  const money = buildMoneySpend({ catalog, today, range: "today", leads, cohort: now.cohortBookings, now: at });
  assert.deepEqual([money.totals.leads, money.totals.duplicates, money.totals.bad_calls, money.totals.lead_spend, money.totals.cost_per_lead], [1, 1, 1, 205, 205]);
  assert.deepEqual(money.by_source_company.map((row) => [row.leads, row.duplicates, row.bad_calls, row.spend]), [[1, 1, 1, 205]]);
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
});
