import test from "node:test";
import assert from "node:assert/strict";
import { parseWebsiteAttribution, WEBSITE_DESIGN } from "../../contracts/websiteAttribution";
import { createFormLeadSchema, updateFormLeadSchema } from "../../validation/v1/leads.validation";
import { summarizeWebsiteOutcomes, websiteOutcomePeriod } from "./websiteOutcomes.service";
import { rowsForCsv } from "./analyticsExport.service";

const now = new Date("2026-11-12T18:00:00Z");
const first = { path: "/resources/moving-cost-guide", occurred_at: "2026-10-01T12:00:00Z", channel: "campaign", referring_host: "none", campaign: { source: "review", medium: "review", name: "preview-qualification" } };
const snapshot = { version: 1, first_touch: first, latest_non_direct_touch: first, capture_page: { path: "/es" }, design: WEBSITE_DESIGN };
const stored = { ...snapshot, received_at: new Date("2026-10-01T12:10:00Z") };
const period = { from: new Date("2026-10-01Z"), to: now, now };

test("Florida route capture retains directed content identity and rejects unregistered reverse routes", () => {
  const input = { ...snapshot, first_touch: { ...first, path: "/locations/florida-movers" }, latest_non_direct_touch: undefined, capture_page: { path: "/es/rutas/florida-a-carolina-del-norte" } };
  const parsed = parseWebsiteAttribution(input, stored.received_at.getTime());
  assert.equal(parsed?.first_touch.content_id, "florida");
  assert.deepEqual(parsed?.capture_page, { path: "/es/rutas/florida-a-carolina-del-norte", content_id: "florida-to-north-carolina", locale: "es" });
  assert.equal(parseWebsiteAttribution({ ...input, capture_page: { path: "/moving-routes/north-carolina-to-florida" } }, stored.received_at.getTime()), undefined);
});

test("attribution sanitizes before canonical command capture; invalid tracking does not reject a Lead", () => {
  const base = { source_company: "main_site", name: "Synthetic", phone_number: "2025550100", pickup_zip: "10001", destination_zip: "53703", move_size: "Studio" };
  const current = { ...snapshot, first_touch: { ...first, occurred_at: new Date().toISOString() }, latest_non_direct_touch: undefined };
  const parsed = createFormLeadSchema.parse({ ...base, website_attribution: { ...current, email: "private@example.com", experiment: "fake" } });
  assert.ok(parsed.website_attribution);
  assert.doesNotMatch(JSON.stringify(parsed.website_attribution), /private|experiment/);
  for (const value of [null, "bad", { ...current, version: 2 }, { ...current, design: { id: "arbitrary", version: "x" } }]) {
    assert.equal(createFormLeadSchema.parse({ ...base, website_attribution: value }).website_attribution, undefined);
  }
  assert.equal(updateFormLeadSchema.safeParse({ website_attribution: current }).success, false);
  assert.equal(parseWebsiteAttribution({ ...snapshot, latest_non_direct_touch: { ...first, channel: "direct" } }, stored.received_at.getTime()), undefined);
});

test("canonical Booking and Cancellation references win over lead flags, phones, jobs and cancellation snapshots", () => {
  const leads = [
    { _id: "a", timestamp: new Date("2026-10-01Z"), website_attribution: stored, booked: "stale" },
    { _id: "b", timestamp: new Date("2026-10-02Z"), duplicate: true },
    { _id: "c", timestamp: now, bad_lead: "invalid", booked: "invented" },
  ];
  const bookings = [
    { _id: "book-a", lead_ref: "a", lead_model: "FormLead", book_date: new Date("2026-10-03Z"), cancelled: "cancel-a", deposit_amount: 500, total_binder_amount: 300 },
    { _id: "book-b", lead_ref: "b", lead_model: "FormLead", book_date: now, deposit_amount: 200, total_binder_amount: 100 },
    { _id: "call", lead_ref: "c", lead_model: "CallLead", book_date: now, deposit_amount: 9999 },
    { _id: "leadless", book_date: now, deposit_amount: 9999 },
  ];
  const cancellations = [{ _id: "cancel-a", booked_lead: "book-a", lead_ref: "wrong-lead", cancel_date: now, refund_amount: 125 }, { _id: "orphan", booked_lead: "book-b", cancel_date: now, refund_amount: 9999 }];
  const report = summarizeWebsiteOutcomes(leads, bookings, cancellations, period);
  assert.equal(report.totals.form_leads, 3);
  assert.equal(report.totals.eligible_leads, 1);
  assert.equal(report.totals.bookings, 2);
  assert.equal(report.totals.cancelled_bookings, 1);
  assert.equal(report.totals.total_refund_amount, 125);
  assert.equal(report.totals.total_deposit_amount, 700);
  assert.equal(report.totals.deposit_less_recorded_refunds, 575);
  assert.equal(report.totals.active_binder_amount, 100);
  assert.equal(report.totals.booking_rate, 1);
  assert.equal(report.totals.unknown_attribution_leads, 2);
  assert.equal(report.totals.attributed_leads, 1); // Historical valid snapshots remain known.
  assert.equal(report.items[0].capture_locale, "es");
  assert.equal(report.items[0].content_id, "moving-cost-guide");
  assert.equal(rowsForCsv("website-outcomes", report).length, report.items.length);
});

test("missing or mismatched cancellation records never manufacture refunds; missing money stays unknown", () => {
  const report = summarizeWebsiteOutcomes([{ _id: "a", timestamp: now }], [
    { _id: "book-a", lead_ref: "a", lead_model: "FormLead", book_date: now, cancelled: "cancel-a", total_binder_amount: 200 },
  ], [{ _id: "cancel-a", booked_lead: "different-booking", cancel_date: now, refund_amount: 500 }], period);
  assert.equal(report.totals.cancelled_bookings, 1);
  assert.equal(report.totals.unknown_refund_bookings, 1);
  assert.equal(report.totals.total_refund_amount, 0);
  assert.equal(report.totals.deposit_less_recorded_refunds, null);
  assert.equal(report.totals.relationship_anomalies, 1);
});

test("report windows are half-open and bounded; unrelated filters are rejected", () => {
  assert.equal(websiteOutcomePeriod({ granularity: "month", lead_type: undefined }, now).to.toISOString(), "2026-11-12T13:00:00.000Z");
  for (const query of [ { from: now, to: now }, { from: new Date("2025-01-01"), to: now }, { to: new Date("2099-01-01") }, { source_company: "top10_leads" }, { agent: "someone" } ]) {
    assert.throws(() => websiteOutcomePeriod({ granularity: "month", lead_type: undefined, ...query }, now));
  }
});

test("same Florida calendar-day booking is zero days even when the Lead arrived after midnight", () => {
  const report = summarizeWebsiteOutcomes([{ _id: "a", timestamp: new Date("2026-11-12T13:00:00Z") }], [
    { _id: "book-a", lead_ref: "a", lead_model: "FormLead", book_date: new Date("2026-11-12T00:00:00Z"), deposit_amount: 0, total_binder_amount: 0 },
  ], [], period);
  assert.equal(report.totals.average_days_to_book, 0);
  assert.equal(report.totals.relationship_anomalies, 0);
});
