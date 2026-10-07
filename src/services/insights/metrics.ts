/**
 * Comparison maths shared by every Insights card, table and the report (doc 09 "How a comparison is shown"):
 * 1. counts and money carry a percent and an absolute difference; rates carry points, never "% of a %";
 * 2. the tone follows what is good for the business (cost up is bad, leads up is good);
 * 3. below `INSIGHTS_MIN_BASE` on either side the percent is withheld (`small_base`), so 1 → 4 never reads "+300 %";
 * 4. every ranking carries its rank change against the comparison period.
 */
import { INSIGHTS_MIN_BASE, type InsightsMetric, type InsightsMetricKind, type InsightsRow } from "./types";

export type Better = InsightsMetric["better"];

/** Relative changes smaller than this read as flat. */
const FLAT_PCT = 0.01;
/** Rate changes smaller than this (0.2 points) read as flat. */
const FLAT_POINTS = 0.002;

export function metric(
  value: number | null,
  comparisonValue: number | null | undefined,
  kind: InsightsMetricKind,
  better: Better,
  options: { base?: number; comparisonBase?: number } = {},
): InsightsMetric {
  const comparison = comparisonValue === undefined ? null : comparisonValue;
  const delta = value !== null && comparison !== null ? value - comparison : null;
  const baseNow = options.base ?? (kind === "count" ? value ?? 0 : Number.POSITIVE_INFINITY);
  const baseThen = options.comparisonBase ?? (kind === "count" ? comparison ?? 0 : Number.POSITIVE_INFINITY);
  const smallBase = comparison !== null && (baseNow < INSIGHTS_MIN_BASE || baseThen < INSIGHTS_MIN_BASE);
  const deltaPct =
    kind === "rate" || delta === null || comparison === null || comparison === 0 || smallBase ? null : delta / Math.abs(comparison);
  let tone: InsightsMetric["tone"] = "neutral";
  if (delta !== null && better !== "none") {
    const flat = kind === "rate" ? Math.abs(delta) < FLAT_POINTS : comparison ? Math.abs(delta / comparison) < FLAT_PCT : delta === 0;
    if (!flat) tone = (delta > 0) === (better === "up") ? "good" : "bad";
  }
  return { value, comparison_value: comparison, delta, delta_pct: deltaPct, kind, better, tone, small_base: smallBase };
}

export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export const round2 = (value: number): number => Math.round(value * 100) / 100;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Ranks rows by a value (descending), ties share the order of appearance. */
export function rankBy<T>(rows: T[], value: (row: T) => number): Map<T, number> {
  const ranks = new Map<T, number>();
  [...rows].sort((a, b) => value(b) - value(a)).forEach((row, index) => ranks.set(row, index + 1));
  return ranks;
}

/**
 * Builds ranked rows from two keyed aggregations. `toMetrics(current, comparison)` returns the metric map; the
 * row's rank and rank change come from `rankValue` in each period. Rows that only exist in the comparison period
 * are dropped (they have nothing to show this period) unless `keepVanished` is set.
 */
export function rankedRows<A>(input: {
  current: Map<string, A>;
  comparison: Map<string, A> | null;
  label: (key: string, row: A) => string;
  toMetrics: (current: A | undefined, comparison: A | undefined) => Record<string, InsightsMetric>;
  rankValue: (row: A) => number;
  series?: (key: string) => InsightsRow["series"];
  notes?: (key: string, row: A) => InsightsRow["notes"];
  limit?: number;
}): InsightsRow[] {
  const currentKeys = [...input.current.keys()];
  const rankNow = new Map<string, number>();
  [...currentKeys].sort((a, b) => input.rankValue(input.current.get(b)!) - input.rankValue(input.current.get(a)!)).forEach((key, index) => rankNow.set(key, index + 1));
  const rankThen = new Map<string, number>();
  if (input.comparison) {
    const keys = [...input.comparison.keys()].filter((key) => input.rankValue(input.comparison!.get(key)!) > 0);
    keys.sort((a, b) => input.rankValue(input.comparison!.get(b)!) - input.rankValue(input.comparison!.get(a)!)).forEach((key, index) => rankThen.set(key, index + 1));
  }
  const rows = currentKeys
    .map((key): InsightsRow => {
      const current = input.current.get(key)!;
      const then = rankThen.get(key);
      const rank = rankNow.get(key)!;
      return {
        key,
        label: input.label(key, current),
        rank,
        rank_change: input.comparison && then !== undefined ? then - rank : null,
        is_new: Boolean(input.comparison) && then === undefined,
        metrics: input.toMetrics(current, input.comparison?.get(key)),
        ...(input.series ? { series: input.series(key) } : {}),
        ...(input.notes ? { notes: input.notes(key, current) } : {}),
      };
    })
    .sort((a, b) => a.rank - b.rank);
  return input.limit ? rows.slice(0, input.limit) : rows;
}

export function groupBy<T>(rows: readonly T[], key: (row: T) => string | null | undefined): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === null || k === undefined) continue;
    const list = groups.get(k);
    if (list) list.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

const money = (value: number) => `$${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
const pct = (value: number) => `${Math.round(Math.abs(value) * 100)}%`;
const pts = (value: number) => `${(Math.abs(value) * 100).toFixed(1)} pts`;

/** "118 more leads (+41%)", "$3,200 less binder (−12%)", "booking rate fell 3.1 pts". */
export function describeChange(subject: string, noun: string, m: InsightsMetric): string {
  if (m.delta === null) return `${subject}: no comparison`;
  if (m.kind === "rate") return `${subject} ${noun} ${m.delta >= 0 ? "rose" : "fell"} ${pts(m.delta)}`;
  const amount = m.kind === "money" ? money(m.delta) : Math.round(Math.abs(m.delta)).toLocaleString("en-US");
  const more = m.delta >= 0 ? "more" : "fewer";
  const percent = m.delta_pct !== null ? ` (${m.delta >= 0 ? "+" : "−"}${pct(m.delta_pct)})` : ` (was ${m.kind === "money" ? money(m.comparison_value ?? 0) : m.comparison_value ?? 0})`;
  if (m.kind === "money") return `${subject} ${m.delta >= 0 ? "brought" : "lost"} ${amount} ${m.delta >= 0 ? "more" : ""} ${noun}${percent}`.replace(/\s+/g, " ");
  return `${subject} ${m.delta >= 0 ? "brought" : "had"} ${amount} ${more} ${noun}${percent}`;
}
