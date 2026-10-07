/**
 * Lean facts for one period: the leads that arrived in it, the bookings booked in it, the cancellations recorded in
 * it, and the bookings of its leads (cohort). Everything below the loaders is pure, so the metric code is tested on
 * plain rows. Volume is small (≈2k leads and ≈230 bookings a month), so the reports aggregate in memory.
 */
import type { Document } from "mongodb";
import { ObjectId } from "mongodb";
import { easternDayKey, easternHour } from "../dailyOperations/dayDocument";
import { leadInstant } from "../salesOutreach/subjects/leadInstant";
import { insightsCollection, type InsightsCatalog, type InsightsFeed } from "./catalog";
import { addDays, dayToUtc, inRange, storedRange } from "./period";
import { priceLead, type LeadPrice } from "./pricing";
import type { InsightsRange } from "./types";

type RangeLike = Pick<InsightsRange, "start" | "end_exclusive">;

export type LeadFact = {
  id: string;
  kind: "form" | "call";
  day: string;
  hour: number;
  duplicate: boolean;
  feed: InsightsFeed | null;
  company: string;
  price: LeadPrice;
  receiver_id: string | null;
  receiver_name: string | null;
  booked_id: string | null;
  local: string | null;
  pickup_state: string | null;
  delivery_state: string | null;
};

export type BookingAllocation = { agent_id: string | null; agent_name: string; binder: number };

export type BookingFact = {
  id: string;
  day: string;
  binder: number;
  deposit: number;
  merchant: string;
  local: string | null;
  referral: boolean;
  leadless: boolean;
  cancelled: boolean;
  allocations: BookingAllocation[];
  lead_id: string | null;
  lead_day: string | null;
  feed: InsightsFeed | null;
  company: string;
};

export type CancellationFact = {
  id: string;
  day: string;
  refund: number;
  reason: string;
  booking_day: string | null;
  company: string;
  feed: InsightsFeed | null;
  agents: string[];
};

export type PeriodFacts = {
  range: RangeLike;
  leads: LeadFact[];
  bookings: BookingFact[];
  cancellations: CancellationFact[];
  /** Bookings of this period's leads, keyed by booking id (cohort basis). */
  cohortBookings: Map<string, BookingFact>;
};

const str = (value: unknown): string => (value === null || value === undefined ? "" : String(value));
const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const LEAD_PROJECTION = {
  timestamp: 1,
  createdAt: 1,
  ingestion_origin: 1,
  duplicate: 1,
  created_on_unmatched: 1,
  source_granularity_id: 1,
  source_granularity_key: 1,
  lead_source_company: 1,
  source_company: 1,
  receiver_agent: 1,
  receiver_agent_name_snapshot: 1,
  booked: 1,
  local: 1,
  pickup_state: 1,
  delivery_state: 1,
} as const;

/** Business day and hour of a lead's real arrival (the Daily Operations rule, `leadInstant`). */
export function leadDayAndHour(doc: Document): { day: string; hour: number } | null {
  const timestamp = doc.timestamp instanceof Date ? doc.timestamp : null;
  if (!timestamp || Number.isNaN(timestamp.getTime())) return null;
  const instant = leadInstant({
    timestamp,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt : null,
    ingestion_origin: typeof doc.ingestion_origin === "string" ? doc.ingestion_origin : null,
  });
  return instant ? { day: easternDayKey(instant), hour: easternHour(instant) } : null;
}

export function resolveFeed(catalog: InsightsCatalog, idValue: unknown, keyValue: unknown): InsightsFeed | null {
  const id = idValue ? str(idValue) : "";
  if (id && catalog.feeds.has(id)) return catalog.feeds.get(id)!;
  const key = str(keyValue).toLowerCase();
  return key ? (catalog.feedByKey.get(key) ?? null) : null;
}

export function resolveCompany(catalog: InsightsCatalog, feed: InsightsFeed | null, companyId: unknown, companySlug: unknown): string {
  if (feed && feed.company_slug !== "unknown") return feed.company_slug;
  const byId = companyId ? catalog.companyById.get(str(companyId)) : undefined;
  if (byId) return byId.slug;
  const slug = str(companySlug).toLowerCase().trim().replaceAll(" ", "_");
  return slug && catalog.companies.has(slug) ? slug : "unknown";
}

/** A lead row → fact; null for rows that are not leads (unmatched calls) or have no readable day. */
export function toLeadFact(catalog: InsightsCatalog, kind: "form" | "call", doc: Document): LeadFact | null {
  if (kind === "call" && doc.created_on_unmatched === true) return null;
  const at = leadDayAndHour(doc);
  if (!at) return null;
  const feed = resolveFeed(catalog, doc.source_granularity_id, doc.source_granularity_key);
  const duplicate = doc.duplicate === true;
  const receiver = doc.receiver_agent ? str(doc.receiver_agent) : null;
  return {
    id: str(doc._id),
    kind,
    day: at.day,
    hour: at.hour,
    duplicate,
    feed,
    company: resolveCompany(catalog, feed, doc.lead_source_company, doc.source_company),
    price: priceLead(catalog, { feed, day: at.day, duplicate }),
    receiver_id: receiver,
    receiver_name: receiver ? (catalog.agents.get(receiver)?.name ?? (str(doc.receiver_agent_name_snapshot) || null)) : null,
    booked_id: doc.booked ? str(doc.booked) : null,
    local: doc.local ? str(doc.local) : null,
    pickup_state: doc.pickup_state ? str(doc.pickup_state).toUpperCase().trim() : null,
    delivery_state: doc.delivery_state ? str(doc.delivery_state).toUpperCase().trim() : null,
  };
}

export function toBookingFact(catalog: InsightsCatalog, doc: Document, lead: Document | undefined): BookingFact | null {
  if (!(doc.book_date instanceof Date)) return null;
  const snapshot = (doc.employee_source_snapshot ?? {}) as Document;
  const feed = resolveFeed(catalog, snapshot.source_granularity_id ?? lead?.source_granularity_id, snapshot.source_granularity_key ?? lead?.source_granularity_key);
  const referral = doc.is_referral_booking === true;
  const leadless = doc.is_leadless_booking === true;
  let company = resolveCompany(catalog, feed, snapshot.lead_source_company ?? lead?.lead_source_company, snapshot.source_company ?? lead?.source_company);
  if (company === "unknown") company = referral ? "referral" : leadless || !doc.lead_ref ? "no_lead" : "unknown";
  const allocations = Array.isArray(doc.agent_allocations)
    ? (doc.agent_allocations as Document[]).map((allocation) => ({
        agent_id: allocation.agent ? str(allocation.agent) : null,
        agent_name: catalog.agents.get(str(allocation.agent))?.name ?? (str(allocation.agent_name_snapshot) || "Unknown rep"),
        binder: num(allocation.binder_amount),
      }))
    : [];
  return {
    id: str(doc._id),
    day: doc.book_date.toISOString().slice(0, 10),
    binder: num(doc.total_binder_amount),
    deposit: num(doc.deposit_amount),
    merchant: str(doc.merchant) || "Unknown",
    local: doc.local ? str(doc.local) : lead?.local ? str(lead.local) : null,
    referral,
    leadless,
    cancelled: Boolean(doc.cancelled),
    allocations,
    lead_id: doc.lead_ref ? str(doc.lead_ref) : null,
    lead_day: lead ? (leadDayAndHour(lead)?.day ?? null) : null,
    feed,
    company,
  };
}

async function findLeadsByIds(ids: string[]): Promise<Map<string, Document>> {
  const objectIds = [...new Set(ids)].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const map = new Map<string, Document>();
  if (!objectIds.length) return map;
  const [form, call] = await Promise.all([
    insightsCollection("form_leads").find({ _id: { $in: objectIds } }, { projection: LEAD_PROJECTION }).toArray(),
    insightsCollection("call_leads").find({ _id: { $in: objectIds } }, { projection: LEAD_PROJECTION }).toArray(),
  ]);
  for (const doc of [...form, ...call]) map.set(str(doc._id), doc);
  return map;
}

const BOOKING_PROJECTION = {
  book_date: 1,
  total_binder_amount: 1,
  deposit_amount: 1,
  merchant: 1,
  local: 1,
  is_referral_booking: 1,
  is_leadless_booking: 1,
  cancelled: 1,
  agent_allocations: 1,
  lead_ref: 1,
  lead_model: 1,
  employee_source_snapshot: 1,
} as const;

async function bookingFacts(catalog: InsightsCatalog, docs: Document[]): Promise<BookingFact[]> {
  const leads = await findLeadsByIds(docs.map((doc) => str(doc.lead_ref)).filter(Boolean));
  return docs.map((doc) => toBookingFact(catalog, doc, leads.get(str(doc.lead_ref)))).filter((fact): fact is BookingFact => fact !== null);
}

export async function loadLeadFacts(catalog: InsightsCatalog, range: RangeLike): Promise<LeadFact[]> {
  // Both timestamp conventions fit in the wall-clock range widened by six hours (`leadTimestampScanRange`).
  const scan = { $gte: dayToUtc(range.start), $lt: new Date(dayToUtc(range.end_exclusive).getTime() + 6 * 3_600_000) };
  const [form, call] = await Promise.all([
    insightsCollection("form_leads").find({ timestamp: scan }, { projection: LEAD_PROJECTION }).toArray(),
    insightsCollection("call_leads").find({ timestamp: scan }, { projection: LEAD_PROJECTION }).toArray(),
  ]);
  const facts: LeadFact[] = [];
  for (const [kind, docs] of [["form", form], ["call", call]] as const) {
    for (const doc of docs) {
      const fact = toLeadFact(catalog, kind, doc);
      if (fact && inRange(fact.day, range)) facts.push(fact);
    }
  }
  return facts;
}

export async function loadPeriodFacts(catalog: InsightsCatalog, range: RangeLike): Promise<PeriodFacts> {
  const [leads, bookingDocs, cancellationDocs] = await Promise.all([
    loadLeadFacts(catalog, range),
    insightsCollection("booked_leads").find({ book_date: storedRange(range) }, { projection: BOOKING_PROJECTION }).toArray(),
    insightsCollection("cancelled_leads")
      .find({ cancel_date: storedRange(range) }, { projection: { cancel_date: 1, refund_amount: 1, reason: 1, booked_lead: 1, agent: 1, book_date: 1 } })
      .toArray(),
  ]);
  const bookings = await bookingFacts(catalog, bookingDocs);
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));

  // Cohort: the bookings of this period's leads, wherever their book date falls.
  const cohortIds = leads.map((lead) => lead.booked_id).filter((id): id is string => Boolean(id) && !bookingById.has(id!));
  const cancelledBookingIds = cancellationDocs.map((doc) => str(doc.booked_lead)).filter((id) => id && !bookingById.has(id));
  const extraIds = [...new Set([...cohortIds, ...cancelledBookingIds])].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const extra = extraIds.length
    ? await bookingFacts(catalog, await insightsCollection("booked_leads").find({ _id: { $in: extraIds } }, { projection: BOOKING_PROJECTION }).toArray())
    : [];
  const anyBooking = new Map([...bookingById, ...extra.map((booking) => [booking.id, booking] as const)]);
  const cohortBookings = new Map<string, BookingFact>();
  for (const lead of leads) {
    const booking = lead.booked_id ? anyBooking.get(lead.booked_id) : undefined;
    if (booking) cohortBookings.set(booking.id, booking);
  }

  const cancellations: CancellationFact[] = [];
  for (const doc of cancellationDocs) {
    if (!(doc.cancel_date instanceof Date)) continue;
    const booking = anyBooking.get(str(doc.booked_lead));
    cancellations.push({
      id: str(doc._id),
      day: doc.cancel_date.toISOString().slice(0, 10),
      refund: num(doc.refund_amount),
      reason: str(doc.reason).trim() || "No reason given",
      booking_day: booking?.day ?? (doc.book_date instanceof Date ? doc.book_date.toISOString().slice(0, 10) : null),
      company: booking?.company ?? "unknown",
      feed: booking?.feed ?? null,
      agents: booking?.allocations.length ? booking.allocations.map((allocation) => allocation.agent_name) : [str(doc.agent) || "Unknown rep"],
    });
  }
  return { range, leads, bookings, cancellations, cohortBookings };
}

/** Today, yesterday and the day before, for the live Daily Operations spend tile. */
export async function loadRecentLeadFacts(catalog: InsightsCatalog, today: string): Promise<LeadFact[]> {
  return loadLeadFacts(catalog, { start: addDays(today, -2), end_exclusive: addDays(today, 1) });
}

export function filterBySources<T extends { company: string }>(rows: T[], sources: readonly string[]): T[] {
  if (!sources.length) return rows;
  const wanted = new Set(sources);
  return rows.filter((row) => wanted.has(row.company));
}

export function filterFacts(facts: PeriodFacts, sources: readonly string[]): PeriodFacts {
  if (!sources.length) return facts;
  const wanted = new Set(sources);
  return {
    ...facts,
    leads: facts.leads.filter((lead) => wanted.has(lead.company)),
    bookings: facts.bookings.filter((booking) => wanted.has(booking.company)),
    cancellations: facts.cancellations.filter((cancellation) => wanted.has(cancellation.company)),
    cohortBookings: new Map([...facts.cohortBookings].filter(([, booking]) => wanted.has(booking.company))),
  };
}
