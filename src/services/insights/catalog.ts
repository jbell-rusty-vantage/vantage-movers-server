/**
 * The read-only catalog Insights prices and labels with: Source Companies, their feeds (Source Granularities), the
 * live CPL schedule per feed, and Agents. Read fresh on every request (a few dozen documents), so a lead cost
 * edited in Setup shows on the next read.
 */
import type { Collection, Document } from "mongodb";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain";
import type { PricedPeriod } from "./pricing";

export type InsightsCompany = { slug: string; id: string | null; label: string; active: boolean };
export type InsightsFeed = {
  id: string;
  key: string;
  label: string;
  channel: "form" | "call";
  company_slug: string;
  active: boolean;
};
export type InsightsAgent = { id: string; name: string; active: boolean };

export type InsightsCatalog = {
  companies: Map<string, InsightsCompany>;
  companyById: Map<string, InsightsCompany>;
  feeds: Map<string, InsightsFeed>;
  feedByKey: Map<string, InsightsFeed>;
  periodsByFeed: Map<string, PricedPeriod[]>;
  agents: Map<string, InsightsAgent>;
  /** First New York business day with a recorded lead (comparison coverage). */
  first_lead_day: string | null;
};

/** Pseudo source companies for bookings that have no paid lead behind them. */
export const PSEUDO_COMPANIES: Record<string, string> = {
  referral: "Referrals",
  no_lead: "No lead (booked directly)",
  unknown: "Unknown source",
};

export function insightsCollection(name: string): Collection<Document> {
  const dbName = getMongoDatabaseName();
  const connection = mongoose.connection.name === dbName ? mongoose.connection : mongoose.connection.useDb(dbName, { useCache: true });
  return connection.collection(name) as unknown as Collection<Document>;
}

const str = (value: unknown): string => (value === null || value === undefined ? "" : String(value));

let firstLeadDayCache: { value: string | null; at: number } | null = null;

async function firstLeadDay(): Promise<string | null> {
  if (firstLeadDayCache && Date.now() - firstLeadDayCache.at < 3_600_000) return firstLeadDayCache.value;
  const [form] = await insightsCollection("form_leads").find({}, { projection: { timestamp: 1 } }).sort({ timestamp: 1 }).limit(1).toArray();
  const value = form?.timestamp instanceof Date ? form.timestamp.toISOString().slice(0, 10) : null;
  firstLeadDayCache = { value, at: Date.now() };
  return value;
}

export async function loadInsightsCatalog(): Promise<InsightsCatalog> {
  const [companyDocs, feedDocs, periodDocs, agentDocs, firstDay] = await Promise.all([
    insightsCollection("lead_source_companies").find({}, { projection: { company_slug: 1, name: 1, owner_label: 1, active: 1 } }).toArray(),
    insightsCollection("lead_source_granularities")
      .find({}, { projection: { source_company: 1, granularity_key: 1, owner_label: 1, channel: 1, active: 1 } })
      .toArray(),
    insightsCollection("cpl_rate_periods")
      .find({ archived_at: null }, { projection: { source_granularity: 1, amount_cents: 1, effective_from_date: 1, effective_until_date_exclusive: 1 } })
      .toArray(),
    insightsCollection("agents").find({}, { projection: { name: 1, active: 1 } }).toArray(),
    firstLeadDay(),
  ]);
  return buildInsightsCatalog({ companyDocs, feedDocs, periodDocs, agentDocs, firstDay });
}

/** Pure assembly (unit-tested with plain objects). */
export function buildInsightsCatalog(input: {
  companyDocs: Document[];
  feedDocs: Document[];
  periodDocs: Document[];
  agentDocs: Document[];
  firstDay: string | null;
}): InsightsCatalog {
  const companies = new Map<string, InsightsCompany>();
  const companyById = new Map<string, InsightsCompany>();
  for (const doc of input.companyDocs) {
    const slug = str(doc.company_slug).toLowerCase();
    if (!slug) continue;
    const company: InsightsCompany = { slug, id: str(doc._id) || null, label: str(doc.owner_label) || str(doc.name) || slug, active: doc.active !== false };
    companies.set(slug, company);
    if (company.id) companyById.set(company.id, company);
  }
  const feeds = new Map<string, InsightsFeed>();
  const feedByKey = new Map<string, InsightsFeed>();
  for (const doc of input.feedDocs) {
    const company = companyById.get(str(doc.source_company));
    const feed: InsightsFeed = {
      id: str(doc._id),
      key: str(doc.granularity_key).toLowerCase(),
      label: str(doc.owner_label) || str(doc.granularity_key),
      channel: doc.channel === "call" ? "call" : "form",
      company_slug: company?.slug ?? "unknown",
      active: doc.active !== false,
    };
    feeds.set(feed.id, feed);
    if (feed.key) feedByKey.set(feed.key, feed);
  }
  const periodsByFeed = new Map<string, PricedPeriod[]>();
  for (const doc of input.periodDocs) {
    const feedId = str(doc.source_granularity);
    const from = str(doc.effective_from_date);
    if (!feedId || !from || typeof doc.amount_cents !== "number") continue;
    const list = periodsByFeed.get(feedId) ?? [];
    list.push({
      amount: doc.amount_cents / 100,
      from,
      ...(doc.effective_until_date_exclusive ? { until: str(doc.effective_until_date_exclusive) } : {}),
    });
    periodsByFeed.set(feedId, list);
  }
  for (const list of periodsByFeed.values()) list.sort((a, b) => a.from.localeCompare(b.from));
  const agents = new Map<string, InsightsAgent>();
  for (const doc of input.agentDocs) {
    agents.set(str(doc._id), { id: str(doc._id), name: str(doc.name) || "Unnamed agent", active: doc.active !== false });
  }
  return { companies, companyById, feeds, feedByKey, periodsByFeed, agents, first_lead_day: input.firstDay };
}

export function companyLabel(catalog: Pick<InsightsCatalog, "companies">, slug: string): string {
  return catalog.companies.get(slug)?.label ?? PSEUDO_COMPANIES[slug] ?? slug.replaceAll("_", " ");
}

/** Today's open-ended rate of a feed (for "$205/lead" labels); null when it has none. */
export function currentFeedRate(catalog: Pick<InsightsCatalog, "periodsByFeed">, feedId: string, today: string): number | null {
  const periods = catalog.periodsByFeed.get(feedId);
  if (!periods) return null;
  const covering = periods.filter((period) => period.from <= today && (period.until === undefined || today < period.until));
  return covering.length === 1 ? covering[0]!.amount : null;
}
