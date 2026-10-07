/**
 * Live lead pricing for Insights, Today and the Outreach Desk. A lead costs the CPL its feed (Source Granularity)
 * has in the Operations Registry schedule for the lead's New York business day, read at query time. Changing a
 * feed's lead cost in Setup therefore changes every report on its next read, whether or not the stamped
 * `Lead.cpl` has been corrected yet (stamps still serve the Sheets and the CPL correction job).
 *
 * Same rule as the stamping resolver (`resolveCplFromPeriods`): duplicates cost $0, a lead with no feed has no
 * cost, and a feed with no period covering the day is "unpriced" (counted, $0, never hidden).
 */
import type { InsightsCatalog, InsightsFeed } from "./catalog";

export type LeadPrice =
  | { status: "priced"; amount: number }
  | { status: "duplicate"; amount: 0 }
  | { status: "unpriced"; amount: 0 }
  | { status: "no_feed"; amount: 0 };

export type PricedPeriod = {
  amount: number;
  /** Inclusive start business date. */
  from: string;
  /** Exclusive end business date; absent = open-ended. */
  until?: string;
};

export function priceForDay(periods: readonly PricedPeriod[] | undefined, day: string): number | null {
  if (!periods?.length) return null;
  const covering = periods.filter((period) => period.from <= day && (period.until === undefined || day < period.until));
  return covering.length === 1 ? covering[0]!.amount : null;
}

export function priceLead(
  catalog: Pick<InsightsCatalog, "periodsByFeed">,
  lead: { feed: InsightsFeed | null; day: string; duplicate: boolean },
): LeadPrice {
  if (!lead.feed) return { status: "no_feed", amount: 0 };
  if (lead.duplicate) return { status: "duplicate", amount: 0 };
  const amount = priceForDay(catalog.periodsByFeed.get(lead.feed.id), lead.day);
  return amount === null ? { status: "unpriced", amount: 0 } : { status: "priced", amount };
}

/** "$205" for one rate, "$190–$205" when a group's feeds differ, null when nothing is priced. */
export function rateLabel(amounts: Iterable<number>): string | null {
  const values = [...new Set([...amounts].filter((value) => Number.isFinite(value)))].sort((a, b) => a - b);
  if (!values.length) return null;
  const money = (value: number) => `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
  return values.length === 1 ? money(values[0]!) : `${money(values[0]!)}–${money(values[values.length - 1]!)}`;
}
