/**
 * Insights DTOs (dashboard-redesign-proposal/09-analytics-redesign.md). The admin mirrors these in
 * `lib/api/insights.ts`; change both together.
 *
 * Money is dollars. Rates are fractions (0.134 = 13.4 %). Every day key is a New York business date
 * `YYYY-MM-DD`; ranges are half-open `[start, end_exclusive)`.
 */

export const INSIGHTS_PERIOD_PRESETS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_30",
  "last_90",
  "quarter_to_date",
  "year_to_date",
  "custom",
] as const;
export type InsightsPeriodPreset = (typeof INSIGHTS_PERIOD_PRESETS)[number];

export const INSIGHTS_COMPARE_MODES = ["previous", "last_year", "none"] as const;
export type InsightsCompareMode = (typeof INSIGHTS_COMPARE_MODES)[number];

export type InsightsBucket = "day" | "week";

export type InsightsRange = {
  start: string;
  end_exclusive: string;
  /** Inclusive last day, for display. */
  end: string;
  days: number;
  /** Owner words: "Sep 5 – Oct 4, 2026". */
  label: string;
};

export type InsightsPeriod = InsightsRange & {
  preset: InsightsPeriodPreset;
  bucket: InsightsBucket;
  /** True when the range includes today, so its numbers are still moving. */
  includes_today: boolean;
};

export type InsightsComparison = InsightsRange & {
  mode: Exclude<InsightsCompareMode, "none">;
  /** `partial` when the comparison starts before the first recorded lead; `none` when it has no data at all. */
  coverage: "full" | "partial" | "none";
};

/** How a change reads for the business, independent of up or down. */
export type InsightsTone = "good" | "bad" | "neutral";

export type InsightsMetricKind = "count" | "money" | "rate" | "ratio" | "days";

export type InsightsMetric = {
  value: number | null;
  comparison_value: number | null;
  /** value − comparison_value (points for rates are this × 100). */
  delta: number | null;
  /** Relative change; null for rates, for a missing side, or below the minimum base (rule 3). */
  delta_pct: number | null;
  kind: InsightsMetricKind;
  /** Which direction is good for the business. */
  better: "up" | "down" | "none";
  tone: InsightsTone;
  /** True when either side is below `INSIGHTS_MIN_BASE`, so the UI shows "was X, now Y" instead of a percent. */
  small_base: boolean;
};

export const INSIGHTS_MIN_BASE = 20;

export type InsightsSeriesPoint = {
  /** First day of the bucket. */
  day: string;
  leads: number;
  bookings: number;
  spend: number;
  binder: number;
  deposits: number;
  cancellations: number;
};

export type InsightsDataQuality = {
  /** Billable leads whose feed has no CPL for their day (counted at $0, never hidden). */
  unpriced_leads: number;
  /** Leads with no feed at all (no cost applies). */
  unmapped_leads: number;
  /** Share of period leads with a receiver agent. */
  receiver_attribution: number | null;
  /** Bookings whose source could not be resolved. */
  unattributed_bookings: number;
};

export type InsightsScorecardKey =
  | "leads"
  | "bookings"
  | "booking_rate"
  | "binder"
  | "deposits"
  | "lead_spend"
  | "cost_per_booking"
  | "cancellation_rate"
  | "cost_per_lead"
  | "duplicates"
  | "return_on_spend"
  | "average_binder";

/** One ranked row (source company, feed, rep, state, lane, merchant). */
export type InsightsRow = {
  key: string;
  label: string;
  rank: number;
  /** Positive = moved up. null = new in this period (no comparison rank). */
  rank_change: number | null;
  is_new: boolean;
  metrics: Record<string, InsightsMetric>;
  /** Bucketed series over the period (week buckets above 31 days), for sparklines and head-to-head compare. */
  series?: Array<{ day: string; value: number; secondary?: number }>;
  children?: InsightsRow[];
  /** Free annotations the UI may show (e.g. CPL label "$205/lead"). */
  notes?: Record<string, string | number | boolean | null>;
};

export type InsightsMover = {
  direction: "gain" | "drop";
  dimension: "source_company" | "source_feed" | "sales_agent" | "receiver_agent";
  key: string;
  label: string;
  metric: string;
  sentence: string;
  tone: InsightsTone;
};

export type InsightsTimeToBook = {
  median_days: number | null;
  comparison_median_days: number | null;
  /** `same_day`, `d1_3`, `d4_7`, `d8_30`, `d30_plus`. */
  buckets: Array<{ key: string; label: string; count: number; comparison_count: number }>;
  measured: number;
};

export type InsightsNamedCount = {
  key: string;
  label: string;
  count: number;
  comparison_count: number;
  amount?: number;
  comparison_amount?: number;
};

export type InsightsAnalyticsReport = {
  generated_at: string;
  period: InsightsPeriod;
  comparison: InsightsComparison | null;
  sources_filter: string[];
  /** All source companies the filter can choose from. */
  source_options: Array<{ key: string; label: string; feeds: Array<{ key: string; label: string }> }>;
  scorecards: Record<InsightsScorecardKey, InsightsMetric>;
  series: { bucket: InsightsBucket; current: InsightsSeriesPoint[]; comparison: InsightsSeriesPoint[] };
  movers: InsightsMover[];
  data_quality: InsightsDataQuality;
  sources: {
    /** Company rows with feed children. Lead metrics are cohort (leads that arrived in the period). */
    companies: InsightsRow[];
    local_vs_long_distance: InsightsRow[];
    pickup_states: InsightsRow[];
    lanes: InsightsRow[];
    /** True while the period is younger than the median time to book, so cohort conversion is still maturing. */
    cohort_maturing: boolean;
  };
  team: {
    sales_agents: InsightsRow[];
    receiver_agents: InsightsRow[];
  };
  bookings: {
    merchants: InsightsRow[];
    mix: InsightsNamedCount[];
    time_to_book: InsightsTimeToBook;
    cancellations: {
      count: InsightsMetric;
      refunds: InsightsMetric;
      rate: InsightsMetric;
      reasons: InsightsNamedCount[];
      by_source: InsightsRow[];
      by_rep: InsightsRow[];
      /** Cancelled in the period: booked in the period vs booked before it. */
      timing: { booked_in_period: number; booked_earlier: number };
    };
  };
  definitions: Record<string, string>;
};

export type InsightsReviewCard = {
  id: string;
  reviewer_name: string;
  rating: number;
  review_date: string;
  excerpt: string;
  responded: boolean;
  source: string;
};

export type InsightsReviewsReport = {
  generated_at: string;
  period: InsightsPeriod;
  comparison: InsightsComparison | null;
  average_rating: InsightsMetric;
  new_reviews: InsightsMetric;
  response_rate: InsightsMetric;
  all_time: { count: number; average_rating: number | null; response_rate: number | null };
  stars: Array<{ stars: number; all_time: number; period: number; comparison: number }>;
  newest: InsightsReviewCard[];
  monthly: Array<{ month: string; count: number; average_rating: number | null }>;
  last_ingested_at: string | null;
  stale: boolean;
};

export type InsightsAllocationFeedCell = {
  source_company: string;
  source_company_label: string;
  feed_key: string;
  feed_label: string;
  leads: number;
  spend: number;
  cpl: number | null;
};

export type InsightsAllocationRep = {
  agent_id: string | null;
  agent_name: string;
  active: boolean | null;
  leads: number;
  duplicates: number;
  spend: number;
  share_of_spend: number | null;
  booked: number;
  cost_per_booked: number | null;
  average_cpl: number | null;
  comparison_spend: number | null;
  by_company: Array<{ source_company: string; source_company_label: string; leads: number; spend: number }>;
  by_feed: InsightsAllocationFeedCell[];
};

export type InsightsAllocationReport = {
  generated_at: string;
  period: InsightsPeriod;
  comparison: InsightsComparison | null;
  totals: { leads: number; spend: number; assigned_spend: number; unassigned_spend: number; unpriced_leads: number };
  companies: Array<{ key: string; label: string; spend: number }>;
  reps: InsightsAllocationRep[];
};

export type InsightsLeadSpendDay = {
  generated_at: string;
  today: string;
  /** New York hour now (0–23). */
  now_hour: number;
  spend: { today: number; yesterday: number; yesterday_by_now: number; day_before: number; day_before_by_now: number };
  leads: { today: number; yesterday_by_now: number; duplicates_today: number; unpriced_today: number };
  /** Cumulative-ready hourly spend for today and yesterday (24 entries each). */
  hourly: { today: number[]; yesterday: number[] };
  by_company: Array<{ key: string; label: string; leads: number; spend: number; cpl_label: string | null }>;
};

export type InsightsMoneyRange = "today" | "yesterday" | "this_week" | "this_month";
