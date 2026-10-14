import mongoose from "mongoose";
import { SALES_OUTREACH_CONTRACT_VERSION, SALES_OUTREACH_TIMEZONE } from "../../../config/domain/salesOutreach";
import { CancelledLead } from "../../../models/CancelledLead";
import { BookedLead } from "../../../models/BookedLead";
import { getFormLeadModel } from "../../../models/FormLead";
import { getCallLeadModel } from "../../../models/CallLead";
import type { SalesOutreachRepMetricsDto, SalesOutreachRepMetricsQuery } from "../../../validation/v1/salesOutreachReads";
import type { OutreachActor } from "../auth";
import { OutreachError } from "../errors";
import { isGranotOfficialLeadlessBooking } from "../../granotLifecycle/confirmAttachment";
import { addDays } from "../engine/calendar";
import { deskLeadKey, DESK_LEAD_PROJECTION, toDeskLeadFacts, type DeskLeadFacts } from "../subjects/leadFacts";
import { newYorkBusinessDay, isoWeekdayOf } from "./businessDay";
import { requireDeskConfiguration, type DeskReadDeps } from "./common";

/** Money is read from canonical records, never the paged/enrolled outreach projection. */
export type RepMetricBooking = Readonly<{
  id: string;
  book_date: string | null;
  allocations: readonly Readonly<{ agent_id: string; amount: number | null }>[];
  total: number | null;
  cancelled: boolean;
  lead: Readonly<{ model: "FormLead" | "CallLead"; id: string }> | null;
  referral: boolean;
  leadless: boolean;
  origin: string | null;
}>;
export type RepMetricsStore = Readonly<{
  ownBookings(agentId: string): Promise<readonly RepMetricBooking[]>;
  assignedLeads(agentId: string): Promise<readonly DeskLeadFacts[]>;
  attachedBookings(ids: readonly string[]): Promise<readonly RepMetricBooking[]>;
}>;
const oid = (id: string) => new mongoose.Types.ObjectId(id);
const amount = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const cents = (value: number) => Math.round(value * 100);

export function toRepMetricBooking(raw: Record<string, unknown>): RepMetricBooking {
  const allocations = Array.isArray(raw.agent_allocations) ? raw.agent_allocations : [];
  return {
    id: String(raw._id),
    // book_date is stored calendar midnight UTC; do not convert it to New York midnight.
    book_date: raw.book_date instanceof Date && Number.isFinite(+raw.book_date) ? raw.book_date.toISOString().slice(0, 10) : null,
    allocations: allocations.map((entry: Record<string, unknown>) => ({ agent_id: String(entry.agent), amount: amount(entry.binder_amount) })),
    total: amount(raw.total_binder_amount),
    cancelled: Boolean(raw.cancelled),
    lead: raw.lead_ref && (raw.lead_model === "FormLead" || raw.lead_model === "CallLead") ? { model: raw.lead_model, id: String(raw.lead_ref) } : null,
    referral: raw.is_referral_booking === true,
    leadless: raw.is_leadless_booking === true,
    origin: typeof raw.booking_origin === "string" ? raw.booking_origin : null,
  };
}
const BOOKING_PROJECTION = { book_date: 1, agent_allocations: 1, total_binder_amount: 1, cancelled: 1, lead_ref: 1, lead_model: 1, is_referral_booking: 1, is_leadless_booking: 1, booking_origin: 1 };
export const mongoRepMetricsStore: RepMetricsStore = {
  async ownBookings(agentId) {
    const rows = await BookedLead.find({ "agent_allocations.agent": oid(agentId) }, BOOKING_PROJECTION).lean();
    return rows.map(toRepMetricBooking);
  },
  async assignedLeads(agentId) {
    const filter = { receiver_agent: oid(agentId) };
    const [forms, calls] = await Promise.all([
      getFormLeadModel().find(filter, DESK_LEAD_PROJECTION).lean(),
      getCallLeadModel().find(filter, DESK_LEAD_PROJECTION).lean(),
    ]);
    const leads = [...forms.map((row) => toDeskLeadFacts("FormLead", row)), ...calls.map((row) => toDeskLeadFacts("CallLead", row))];
    if (!leads.length) return leads;
    const matches: Record<string, unknown>[] = [];
    for (const model of ["FormLead", "CallLead"] as const) {
      const ids = leads.filter((lead) => lead.ref.model === model).map((lead) => oid(lead.ref.id));
      if (ids.length) matches.push({ lead_model: model, lead_ref: { $in: ids } });
    }
    const bookedIds = leads.flatMap((lead) => lead.booked_id && mongoose.isValidObjectId(lead.booked_id) ? [oid(lead.booked_id)] : []);
    if (bookedIds.length) matches.push({ booked_lead: { $in: bookedIds } });
    const cancellations = await CancelledLead.find({ $or: matches }, { lead_ref: 1, lead_model: 1, booked_lead: 1 }).lean();
    return applyPotentialCancellations(leads, cancellations);

  },
  async attachedBookings(ids) {
    if (!ids.length) return [];
    const rows = await BookedLead.find({ _id: { $in: [...new Set(ids)].filter((id) => mongoose.isValidObjectId(id)).map(oid) } }, BOOKING_PROJECTION).lean();
    return rows.map(toRepMetricBooking);
  },
};

/** Any canonical cancellation anchor excludes potential, even when a legacy mirror is absent. */
export function applyPotentialCancellations(leads: readonly DeskLeadFacts[], cancellations: readonly Record<string, unknown>[]): DeskLeadFacts[] {
  const byLead = new Map<string, string>();
  const byBooking = new Map<string, string>();
  for (const row of cancellations) {
    if (row.lead_ref && (row.lead_model === "FormLead" || row.lead_model === "CallLead")) byLead.set(deskLeadKey({ model: row.lead_model, id: String(row.lead_ref) }), String(row._id));
    if (row.booked_lead) byBooking.set(String(row.booked_lead), String(row._id));
  }
  return leads.map((lead) => ({ ...lead, cancelled_id: lead.cancelled_id ?? byLead.get(deskLeadKey(lead.ref)) ?? (lead.booked_id ? byBooking.get(lead.booked_id) : undefined) ?? null }));
}

/** Pending Owner/employee intake rows do not become official credit until linked. */
export function isOfficialMetricBooking(booking: RepMetricBooking): boolean {
  return booking.lead !== null || booking.referral || isGranotOfficialLeadlessBooking({
    is_leadless_booking: booking.leadless, is_referral_booking: booking.referral, booking_origin: booking.origin,
  });
}

export function repBinderWindows(now: Date) {
  const today = newYorkBusinessDay(now);
  const monday = addDays(today, 1 - isoWeekdayOf(today));
  const monthStart = `${today.slice(0, 7)}-01`;
  const previousMonthEnd = addDays(monthStart, -1);
  return {
    today: { from: today, to: today },
    last_week: { from: addDays(monday, -7), to: addDays(monday, -1) },
    last_month: { from: `${previousMonthEnd.slice(0, 7)}-01`, to: previousMonthEnd },
  };
}

export function composeOfficialBinder(agentId: string, now: Date, bookings: readonly RepMetricBooking[]): SalesOutreachRepMetricsDto["official_binder"] {
  const windows = repBinderWindows(now);
  const sum = { today: 0, last_week: 0, last_month: 0, all_time: 0 };
  let booking_count = 0, missing_amount_count = 0, missing_book_date_count = 0;
  const seen = new Set<string>();
  for (const booking of bookings) {
    if (seen.has(booking.id) || !isOfficialMetricBooking(booking)) continue;
    seen.add(booking.id);
    const own = booking.allocations.filter((allocation) => allocation.agent_id === agentId);
    if (!own.length) continue;
    booking_count++;
    if (!booking.book_date) missing_book_date_count++;
    if (own.some((allocation) => allocation.amount === null)) missing_amount_count++;
    const ownCents = own.reduce((total, allocation) => total + (allocation.amount === null ? 0 : cents(allocation.amount)), 0);
    sum.all_time += ownCents;
    if (!booking.book_date) continue;
    for (const key of ["today", "last_week", "last_month"] as const) {
      if (booking.book_date >= windows[key].from && booking.book_date <= windows[key].to) sum[key] += ownCents;
    }
  }
  return { basis: "gross_own_allocation", ...Object.fromEntries(Object.entries(sum).map(([key, value]) => [key, value / 100])) as typeof sum, booking_count, missing_amount_count, missing_book_date_count, windows };
}

/** Metric-specific eligibility: linked Bookings/priority 5 are allowed; cadence's booked closure is unchanged. */
export function isPotentialMetricLead(lead: DeskLeadFacts): boolean {
  return !lead.duplicate && !lead.cancelled_id && !lead.bad_lead && !lead.created_on_unmatched && !["7", "8", "9"].includes(lead.granot_priority ?? "");
}

export function composeAssignedPotential(agentId: string, leads: readonly DeskLeadFacts[], bookings: readonly RepMetricBooking[]): SalesOutreachRepMetricsDto["assigned_potential"] {
  const eligible = [...new Map(leads.filter((lead) => lead.receiver_agent_id === agentId && isPotentialMetricLead(lead)).map((lead) => [deskLeadKey(lead.ref), lead])).values()];
  const byId = new Map(bookings.map((booking) => [booking.id, booking]));
  const totals = { eligible_lead_count: 0, linked_booking_count: 0, missing_link_count: 0, dangling_link_count: 0, missing_amount_count: 0, mismatched_link_count: 0, deduplicated_lead_count: 0, ambiguous_identity_count: 0 };
  let knownCents = 0;
  const seenBooking = new Set<string>();
  // Only reciprocal authoritative Booking anchors can conflict; an unlinked same-job alias cannot erase known dollars.
  const jobs = new Map<string, Set<string>>();
  for (const lead of eligible) if (lead.normalized_job_no && lead.booked_id) {
    const linked = byId.get(lead.booked_id);
    if (!linked?.lead || linked.cancelled || deskLeadKey(linked.lead) !== deskLeadKey(lead.ref)) continue;
    const identities = jobs.get(lead.normalized_job_no) ?? new Set<string>();
    identities.add(lead.booked_id);
    jobs.set(lead.normalized_job_no, identities);
  }
  for (const lead of eligible) {
    const booking = lead.booked_id ? byId.get(lead.booked_id) : undefined;
    if (booking?.cancelled) continue;
    totals.eligible_lead_count++;
    if (!lead.booked_id) { totals.missing_link_count++; continue; }
    if (!booking) { totals.dangling_link_count++; continue; }
    // The reciprocal Booking anchor is authoritative, including cross-model/cross-Rep duplicate links.
    if (!booking.lead || deskLeadKey(booking.lead) !== deskLeadKey(lead.ref)) { totals.mismatched_link_count++; continue; }
    if (lead.normalized_job_no && (jobs.get(lead.normalized_job_no)?.size ?? 0) > 1) { totals.ambiguous_identity_count++; continue; }
    if (seenBooking.has(booking.id)) { totals.deduplicated_lead_count++; continue; }
    seenBooking.add(booking.id);
    totals.linked_booking_count++;
    if (booking.total === null) totals.missing_amount_count++;
    else knownCents += cents(booking.total);
  }
  const unknown = totals.missing_link_count + totals.dangling_link_count + totals.missing_amount_count + totals.mismatched_link_count + totals.ambiguous_identity_count;
  return { basis: "current_assignment_attached_booking_total", known_binder_total: knownCents / 100, ...totals, coverage: unknown ? "partial" : "complete" };
}

export async function readRepMetrics(actor: OutreachActor, query: SalesOutreachRepMetricsQuery, deps: DeskReadDeps & { metricsStore?: RepMetricsStore }): Promise<SalesOutreachRepMetricsDto> {
  if (actor.role === "rep" && query.agent_id !== undefined && query.agent_id !== actor.agent_id)
    throw new OutreachError("FORBIDDEN", [{ path: "agent_id", code: "foreign_agent" }]);
  const agentId = actor.role === "rep" ? actor.agent_id : query.agent_id;
  if (!agentId) throw new OutreachError("INVALID_INPUT", [{ path: "agent_id", code: "required" }]);
  await requireDeskConfiguration(deps.loader);
  const store = deps.metricsStore ?? mongoRepMetricsStore;
  const [bookings, leads] = await Promise.all([store.ownBookings(agentId), store.assignedLeads(agentId)]);
  const attached = await store.attachedBookings(leads.filter(isPotentialMetricLead).flatMap((lead) => lead.booked_id ? [lead.booked_id] : []));
  return {
    contract_version: SALES_OUTREACH_CONTRACT_VERSION,
    as_of: deps.now.toISOString(), timezone: SALES_OUTREACH_TIMEZONE, agent_id: agentId,
    business_day: newYorkBusinessDay(deps.now),
    official_binder: composeOfficialBinder(agentId, deps.now, bookings),
    assigned_potential: composeAssignedPotential(agentId, leads, attached),
  };
}
