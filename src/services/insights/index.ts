/**
 * Insights entry points (doc 09). Read-only; every lead is priced with the live lead cost (`pricing.ts`).
 * Routes: `GET /api/v1/admin/insights/{analytics,reviews,allocation-cost}`,
 * `GET /api/v1/admin/daily-operations/lead-spend`, `GET /api/v1/admin/money/spend`.
 */
import { z } from "zod";
import { easternHour } from "../dailyOperations/dayDocument";
import { buildAnalyticsReport, comparisonCoverage } from "./analyticsReport";
import { insightsCollection, loadInsightsCatalog } from "./catalog";
import { filterFacts, loadLeadFacts, loadPeriodFacts, loadRecentLeadFacts } from "./facts";
import {
  buildAllocationReport,
  buildLeadSpendDay,
  buildMoneySpend,
  buildReviewsReport,
  moneyRangeDays,
  type MoneySpendResponse,
  type ReviewFact,
} from "./otherReports";
import { resolvePeriods } from "./period";
import {
  INSIGHTS_COMPARE_MODES,
  INSIGHTS_PERIOD_PRESETS,
  type InsightsAllocationReport,
  type InsightsAnalyticsReport,
  type InsightsComparison,
  type InsightsLeadSpendDay,
  type InsightsReviewsReport,
} from "./types";

export * from "./types";
export { InsightsPeriodError } from "./period";
export type { MoneySpendResponse } from "./otherReports";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const insightsQuerySchema = z
  .object({
    period: z.enum(INSIGHTS_PERIOD_PRESETS).default("last_30"),
    compare: z.enum(INSIGHTS_COMPARE_MODES).default("previous"),
    from: day.optional(),
    to: day.optional(),
    sources: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? "")
          .split(",")
          .map((slug) => slug.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 50),
      ),
  })
  .strip();
export type InsightsQueryInput = z.infer<typeof insightsQuerySchema>;

export const moneySpendQuerySchema = z.object({ range: z.enum(["today", "yesterday", "this_week", "this_month"]).default("today") }).strip();

async function periodsWithCoverage(query: InsightsQueryInput, now: Date) {
  const resolved = resolvePeriods({ preset: query.period, from: query.from, to: query.to, compare: query.compare }, now);
  const catalog = await loadInsightsCatalog();
  const comparison: InsightsComparison | null = resolved.comparison
    ? { ...resolved.comparison, coverage: comparisonCoverage(resolved.comparison, catalog.first_lead_day) }
    : null;
  return { ...resolved, comparison, catalog };
}

export async function getInsightsAnalytics(query: InsightsQueryInput, now: Date = new Date()): Promise<InsightsAnalyticsReport> {
  const { today, period, comparison, catalog } = await periodsWithCoverage(query, now);
  const [current, previous] = await Promise.all([
    loadPeriodFacts(catalog, period),
    comparison && comparison.coverage !== "none" ? loadPeriodFacts(catalog, comparison) : Promise.resolve(null),
  ]);
  return buildAnalyticsReport({
    catalog,
    today,
    period,
    comparison,
    sources: query.sources,
    now: filterFacts(current, query.sources),
    then: previous ? filterFacts(previous, query.sources) : null,
    generatedAt: now,
  });
}

export async function getInsightsReviews(query: InsightsQueryInput, now: Date = new Date()): Promise<InsightsReviewsReport> {
  const resolved = resolvePeriods({ preset: query.period, from: query.from, to: query.to, compare: query.compare }, now);
  const docs = await insightsCollection("testimonials")
    .find(
      { published: { $ne: false } },
      { projection: { review_date: 1, rating: 1, reviewer_name: 1, review_text: 1, business_response: 1, source: 1, createdAt: 1 } },
    )
    .toArray();
  const all: ReviewFact[] = docs
    .filter((doc) => doc.review_date instanceof Date && typeof doc.rating === "number")
    .map((doc) => ({
      id: String(doc._id),
      day: (doc.review_date as Date).toISOString().slice(0, 10),
      rating: doc.rating as number,
      reviewer_name: String(doc.reviewer_name ?? "Customer"),
      text: String(doc.review_text ?? ""),
      responded: Boolean(doc.business_response),
      source: String(doc.source ?? "BBB"),
      created_at: doc.createdAt instanceof Date ? doc.createdAt : null,
    }));
  const comparison: InsightsComparison | null = resolved.comparison
    ? { ...resolved.comparison, coverage: all.some((row) => row.day < resolved.comparison!.end_exclusive) ? "full" : "none" }
    : null;
  return buildReviewsReport({ all, period: resolved.period, comparison, now });
}

export async function getInsightsAllocation(query: InsightsQueryInput, now: Date = new Date()): Promise<InsightsAllocationReport> {
  const { today, period, comparison, catalog } = await periodsWithCoverage(query, now);
  const [current, previousLeads] = await Promise.all([
    loadPeriodFacts(catalog, period),
    comparison && comparison.coverage !== "none" ? loadLeadFacts(catalog, comparison) : Promise.resolve(null),
  ]);
  return buildAllocationReport({
    catalog,
    today,
    period,
    comparison,
    leads: current.leads,
    comparisonLeads: previousLeads,
    cohort: current.cohortBookings,
    generatedAt: now,
  });
}

export async function getDailyLeadSpend(now: Date = new Date()): Promise<InsightsLeadSpendDay> {
  const { today } = resolvePeriods({ preset: "today", compare: "none" }, now);
  const catalog = await loadInsightsCatalog();
  const leads = await loadRecentLeadFacts(catalog, today);
  return buildLeadSpendDay({ catalog, today, nowHour: easternHour(now), leads, now });
}

export async function getMoneySpend(range: z.infer<typeof moneySpendQuerySchema>["range"], now: Date = new Date()): Promise<MoneySpendResponse> {
  const { today } = resolvePeriods({ preset: "today", compare: "none" }, now);
  const catalog = await loadInsightsCatalog();
  const facts = await loadPeriodFacts(catalog, moneyRangeDays(range, today));
  return buildMoneySpend({ catalog, today, range, leads: facts.leads, cohort: facts.cohortBookings, now });
}
