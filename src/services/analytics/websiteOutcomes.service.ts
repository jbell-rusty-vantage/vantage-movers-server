import type { AnalyticsQuery } from "../../validation/v1.validation";
import type { AdminModels } from "../admin/adminScope.service";
import { BadRequestError } from "../errors";
import { leadMatchForQuery, roundMoney } from "./analyticsFilters";
import { parseWebsiteAttribution } from "../../contracts/websiteAttribution";
import { floridaCalendarToday, toFloridaTimestamp } from "../../utils/easternTime";

type Row = Record<string, unknown>;
type WebsiteDimensions = Record<"channel" | "source" | "medium" | "campaign" | "landing_path" | "content_id" | "locale" | "capture_content_id" | "capture_locale" | "design_id" | "design_version", string>;
const DAY = 86_400_000;
const MAX_RECORDS = 10_000;
const id = (value: unknown) => value == null ? "" : String(value);
const time = (value: unknown) => value instanceof Date ? value.getTime() : Date.parse(String(value));
const money = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

export function websiteOutcomePeriod(query: AnalyticsQuery, now: Date) {
  if ((query.source_company && query.source_company !== "main_site") || query.source_granularity_key || query.source || query.agent || query.receiver_agent || query.merchant || query.local || (query.lead_type && query.lead_type !== "FormLead")) {
    throw new BadRequestError("Website outcomes supports only the Main Site Form Lead cohort and from/to filters");
  }
  const localNow = toFloridaTimestamp(now);
  const to = query.to ?? localNow;
  const from = query.from ?? new Date(to.getTime() - 30 * DAY);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to || to > now || to.getTime() - from.getTime() > 93 * DAY) {
    throw new BadRequestError("Use a past half-open from/to interval of at most 93 days");
  }
  return { from, to };
}

/** Read-only, bounded cohort report. Never match a customer, phone, job number or sibling. */
export async function getWebsiteOutcomes(models: AdminModels, query: AnalyticsQuery, now = new Date()) {
  const period = websiteOutcomePeriod(query, now);
  const source = await leadMatchForQuery("FormLead", { granularity: "month", source_company: "main_site", lead_type: "FormLead" });
  const leads = await models["form-leads"].find({ $and: [source, { timestamp: { $gte: period.from, $lt: period.to } }] })
    .select("_id timestamp duplicate bad_lead website_attribution").limit(MAX_RECORDS + 1).maxTimeMS(10_000).lean() as Row[];
  if (leads.length > MAX_RECORDS) throw new BadRequestError("Cohort exceeds 10000 Form Leads; request a smaller date interval");
  const bookings = leads.length ? await models["booked-leads"].find({ lead_model: "FormLead", lead_ref: { $in: leads.map(l => l._id) }, book_date: { $lte: floridaCalendarToday(now) } })
    .select("_id lead_ref lead_model book_date cancelled deposit_amount total_binder_amount").limit(MAX_RECORDS + 1).maxTimeMS(10_000).lean() as Row[] : [];
  if (bookings.length > MAX_RECORDS) throw new BadRequestError("Booking result exceeds safety bound; request a smaller date interval");
  const cancellationIds = bookings.filter(b => b.cancelled).map(b => b.cancelled);
  const cancellations = cancellationIds.length ? await models["cancelled-leads"].find({ _id: { $in: cancellationIds } })
    .select("_id booked_lead cancel_date refund_amount").limit(MAX_RECORDS + 1).maxTimeMS(10_000).lean() as Row[] : [];
  return summarizeWebsiteOutcomes(leads, bookings, cancellations, { ...period, now });
}

function blankMetrics() {
  return { form_leads: 0, duplicate_leads: 0, bad_leads: 0, eligible_leads: 0, attributed_leads: 0, unknown_attribution_leads: 0, immature_leads: 0,
    booked_leads: 0, eligible_booked_leads: 0, bookings: 0, cancelled_bookings: 0, active_bookings: 0,
    total_deposit_amount: 0, total_binder_amount: 0, total_refund_amount: 0, active_binder_amount: 0,
    unknown_deposit_bookings: 0, unknown_binder_bookings: 0, unknown_refund_bookings: 0, relationship_anomalies: 0,
    time_to_book_days_sum: 0, time_to_book_samples: 0 };
}
type Metrics = ReturnType<typeof blankMetrics>;
function derived(metrics: Metrics) {
  return { ...metrics,
    booking_rate: metrics.eligible_leads ? metrics.eligible_booked_leads / metrics.eligible_leads : null,
    attribution_coverage: metrics.form_leads ? metrics.attributed_leads / metrics.form_leads : null,
    average_days_to_book: metrics.time_to_book_samples ? metrics.time_to_book_days_sum / metrics.time_to_book_samples : null,
    deposit_less_recorded_refunds: metrics.unknown_deposit_bookings || metrics.unknown_refund_bookings ? null : roundMoney(metrics.total_deposit_amount - metrics.total_refund_amount),
  };
}

export function summarizeWebsiteOutcomes(leads: Row[], bookings: Row[], cancellations: Row[], period: { from: Date; to: Date; now: Date }) {
  const cancelById = new Map(cancellations.map(c => [id(c._id), c]));
  const byLead = new Map<string, Row[]>();
  for (const booking of bookings) {
    if (booking.lead_model !== "FormLead" || !Number.isFinite(time(booking.book_date)) || Math.floor(time(booking.book_date) / DAY) > floridaCalendarToday(period.now).getTime() / DAY) continue;
    const key = id(booking.lead_ref);
    byLead.set(key, [...(byLead.get(key) ?? []), booking]);
  }
  const groups = new Map<string, { dimensions: WebsiteDimensions; metrics: Metrics }>();
  const totals = blankMetrics();
  for (const lead of leads) {
    const stored = lead.website_attribution as Row | undefined;
    // Validate against capture time, not report time: valid historical snapshots do not expire.
    const received = stored ? time(stored.received_at) : NaN;
    const snapshot = Number.isFinite(received) ? parseWebsiteAttribution(stored, received) : undefined;
    const touch = snapshot?.latest_non_direct_touch ?? snapshot?.first_touch;
    const dimensions = {
      channel: touch?.channel ?? "unknown", source: touch?.campaign?.source ?? touch?.referring_host ?? "unknown",
      medium: touch?.campaign?.medium ?? "none", campaign: touch?.campaign?.name ?? "none",
      landing_path: touch?.path ?? "unknown", content_id: touch?.content_id ?? "unknown", locale: touch?.locale ?? "unknown",
      capture_content_id: snapshot?.capture_page.content_id ?? "unknown", capture_locale: snapshot?.capture_page.locale ?? "unknown",
      design_id: snapshot?.design.id ?? "unknown", design_version: snapshot?.design.version ?? "unknown",
    };
    const key = JSON.stringify(dimensions);
    const group = groups.get(key) ?? { dimensions, metrics: blankMetrics() };
    const metrics = blankMetrics();
    metrics.form_leads = 1;
    metrics.duplicate_leads = lead.duplicate === true ? 1 : 0;
    metrics.bad_leads = lead.bad_lead ? 1 : 0;
    metrics.eligible_leads = metrics.duplicate_leads || metrics.bad_leads ? 0 : 1;
    metrics.attributed_leads = snapshot ? 1 : 0;
    metrics.unknown_attribution_leads = snapshot ? 0 : 1;
    metrics.immature_leads = toFloridaTimestamp(period.now).getTime() - time(lead.timestamp) < 30 * DAY ? 1 : 0;
    const linked = byLead.get(id(lead._id)) ?? [];
    metrics.booked_leads = linked.length ? 1 : 0;
    metrics.eligible_booked_leads = linked.length && metrics.eligible_leads ? 1 : 0;
    if (linked.length > 1) metrics.relationship_anomalies++;
    for (const booking of linked) {
      metrics.bookings++;
      const cancelled = Boolean(booking.cancelled);
      metrics.cancelled_bookings += cancelled ? 1 : 0;
      metrics.active_bookings += cancelled ? 0 : 1;
      const deposit = money(booking.deposit_amount), binder = money(booking.total_binder_amount);
      metrics.total_deposit_amount += deposit ?? 0;
      metrics.total_binder_amount += binder ?? 0;
      metrics.active_binder_amount += cancelled ? 0 : binder ?? 0;
      metrics.unknown_deposit_bookings += deposit === null ? 1 : 0;
      metrics.unknown_binder_bookings += binder === null ? 1 : 0;
      // Both fields store Florida calendar components; a Booking date has no time of day.
      const days = Math.floor(time(booking.book_date) / DAY) - Math.floor(time(lead.timestamp) / DAY);
      if (days >= 0 && Number.isFinite(days)) { metrics.time_to_book_days_sum += days; metrics.time_to_book_samples++; }
      else metrics.relationship_anomalies++;
      if (cancelled) {
        const cancellation = cancelById.get(id(booking.cancelled));
        const valid = cancellation && id(cancellation.booked_lead) === id(booking._id) && Math.floor(time(cancellation.cancel_date) / DAY) <= floridaCalendarToday(period.now).getTime() / DAY;
        const refund = valid ? money(cancellation.refund_amount) : null;
        metrics.total_refund_amount += refund ?? 0;
        metrics.unknown_refund_bookings += refund === null ? 1 : 0;
        if (!valid) metrics.relationship_anomalies++;
      }
    }
    for (const field of Object.keys(metrics) as (keyof Metrics)[]) { group.metrics[field] += metrics[field]; totals[field] += metrics[field]; }
    groups.set(key, group);
  }
  for (const metrics of [totals, ...[...groups.values()].map(g => g.metrics)]) {
    for (const field of ["total_deposit_amount", "total_binder_amount", "total_refund_amount", "active_binder_amount"] as const) metrics[field] = roundMoney(metrics[field]);
  }
  return {
    model: "session_latest_non_direct_else_first_touch_v1", source_company: "main_site", lead_type: "FormLead",
    from_inclusive: period.from.toISOString(), to_exclusive: period.to.toISOString(), outcomes_observed_at: period.now.toISOString(),
    maturity_window_days: 30, totals: derived(totals),
    items: [...groups.values()].map(g => ({ ...g.dimensions, ...derived(g.metrics) })),
    interpretation: {
      next_action: totals.unknown_attribution_leads ? "Review attribution coverage before comparing channels." : totals.immature_leads ? "Allow the Lead cohort to mature before comparing Booking rates." : "Review eligible Lead and Booking quality alongside volume; this is observational evidence.",
      limits: ["Main Site Form Lead cohort only; no visitor conversion rate or causal experiment result.", "Touch data is visitor-declared, session-bounded and optional. Unknown includes historical, declined and failed tracking.", "Call Leads, leadless Bookings and Bookings linked to another Lead are outside this cohort; no inferred phone/job/sibling matches.", "Cancellation status uses the official Booking ref; refunds require its matching Cancellation record. Missing amounts remain explicitly unknown.", "Money is recorded deposit/binder/refund, not revenue or profit. Active binder is not refund-adjusted revenue.", "Outcomes are current surviving records observed now, not a historical as-of reconstruction. Thirty days is a declared review window, not a proven sales-cycle duration."],
    },
  };
}
