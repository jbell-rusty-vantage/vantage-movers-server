import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutreachActor } from "../auth";
import { completeConfigurationInput } from "../evaluation/testing";
import { toDeskLeadFacts, type DeskLeadFacts } from "../subjects/leadFacts";
import { salesOutreachRepMetricsDtoSchema, salesOutreachRepMetricsQuerySchema } from "../../../validation/v1/salesOutreachReads";
import { activeInspection, fixedConfigurationLoader } from "./testing";
import { applyPotentialCancellations, composeAssignedPotential, composeOfficialBinder, isOfficialMetricBooking, readRepMetrics, repBinderWindows, toRepMetricBooking, type RepMetricBooking, type RepMetricsStore } from "./repMetrics";
const A = "aaaaaaaaaaaaaaaaaaaaaaaa", B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = new Date("2026-10-13T15:00:00Z");
const key = (n: number) => n.toString(16).padStart(24, "0");
function lead(n: number, patch: Record<string, unknown> = {}, model: "FormLead" | "CallLead" = "FormLead"): DeskLeadFacts {
  return toDeskLeadFacts(model, { _id: key(n), receiver_agent: A, ...patch });
}
function booking(n: number, patch: Partial<RepMetricBooking> = {}): RepMetricBooking {
  const lead = patch.lead === undefined ? { model: "FormLead" as const, id: key(n) } : patch.lead;
  return { raw_lead_ref: lead?.id, raw_lead_model: lead?.model, id: key(n), book_date: "2026-10-13", allocations: [{ agent_id: A, amount: 50.01 }, { agent_id: B, amount: 50 }], total: 100.01, cancelled: false, lead: { model: "FormLead", id: key(n) }, referral: false, leadless: false, origin: null, ...patch };
}

test("NY calendar windows are entire previous week/month across January, midnight and DST", () => {
  assert.deepEqual(repBinderWindows(NOW), {
    today: { from: "2026-10-13", to: "2026-10-13" }, last_week: { from: "2026-10-05", to: "2026-10-11" }, last_month: { from: "2026-09-01", to: "2026-09-30" },
  });
  const jan = repBinderWindows(new Date("2027-01-01T05:00:00Z"));
  assert.deepEqual(jan.last_month, { from: "2026-12-01", to: "2026-12-31" });
  assert.deepEqual(jan.last_week, { from: "2026-12-21", to: "2026-12-27" });
  assert.equal(repBinderWindows(new Date("2027-01-01T04:59:59Z")).today.from, "2026-12-31");
  for (const instant of ["2026-03-08T06:30:00Z", "2026-03-08T07:30:00Z"]) assert.equal(repBinderWindows(new Date(instant)).today.from, "2026-03-08");
  for (const instant of ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"]) assert.equal(repBinderWindows(new Date(instant)).today.from, "2026-11-01");
});

test("official gross credit is the own stable-id allocation; unlimited history, cents, cancelled and calendar-date boundaries", () => {
  const all = Array.from({ length: 650 }, (_, i) => booking(i + 1, { book_date: "1999-01-01", allocations: [{ agent_id: A, amount: 0.01 }] }));
  all.push(booking(700, { book_date: "2026-10-05" }), booking(701, { book_date: "2026-10-11", cancelled: true }), booking(702, { book_date: "2026-09-30" }), booking(703), booking(704, { allocations: [{ agent_id: B, amount: 999 }] }));
  all.push(booking(705, { lead: null, leadless: true, origin: "employee_booking" }), booking(706, { lead: null, leadless: true, origin: "owner_booking" }));
  all.push(booking(707, { lead: null, leadless: true, allocations: [{ agent_id: A, amount: 0 }] }), all[0]!);
  const result = composeOfficialBinder(A, NOW, all);
  assert.equal(result.today, 50.01);
  assert.equal(result.last_week, 100.02);
  assert.equal(result.last_month, 50.01);
  assert.equal(result.all_time, 206.54);
  assert.equal(result.booking_count, 655);
  const raw = toRepMetricBooking({ _id: key(800), book_date: new Date("2026-10-13T00:00:00Z"), total_binder_amount: 0 });
  assert.equal(raw.book_date, "2026-10-13");
  assert.equal(raw.total, 0);
});

test("official missing allocation/date coverage is explicit; malformed amount is unknown instead of NaN", () => {
  const result = composeOfficialBinder(A, NOW, [booking(1, { book_date: null, allocations: [{ agent_id: A, amount: null }] }), booking(2, { book_date: null })]);
  assert.equal(result.all_time, 50.01);
  assert.equal(result.missing_amount_count, 1);
  assert.equal(result.missing_book_date_count, 2);
  assert.equal(toRepMetricBooking({ _id: key(1), total_binder_amount: NaN }).total, null);
});

test("potential uses attached total on complete assignment scope including booked and priority5, not allocation or cadence page", () => {
  const leads = Array.from({ length: 350 }, (_, i) => lead(i + 1, { booked: key(i + 1), granot_priority: "5" }));
  const bookings = Array.from({ length: 350 }, (_, i) => booking(i + 1));
  const result = composeAssignedPotential(A, leads, bookings);
  assert.equal(result.known_binder_total, 35003.5);
  assert.equal(result.linked_booking_count, 350);
  assert.equal(result.coverage, "complete");
  // Current assignment moves potential ownership and leaves historical allocation credit alone.
  const reassigned = lead(1, { booked: key(1), receiver_agent: B });
  assert.equal(composeAssignedPotential(A, [reassigned], [booking(1)]).known_binder_total, 0);
  assert.equal(composeAssignedPotential(B, [reassigned], [booking(1)]).known_binder_total, 100.01);
  assert.equal(composeOfficialBinder(A, NOW, [booking(1)]).all_time, 50.01);
});

test("potential excludes 7/8/9, duplicates, bad, cancelled and unmatched anchors while keeping no-sync/Form Fill", () => {
  const specs = [ { granot_priority: "7" }, { granot_priority: "8" }, { granot_priority: "9" }, { duplicate: true }, { bad_lead: "invalid" }, { cancelled: key(99) }, { created_on_unmatched: true } ];
  const leads = specs.map((patch, i) => lead(i + 1, { booked: key(i + 1), ...patch }));
  leads.push(lead(20, { booked: key(20), no_sync: true }), lead(21, { booked: key(21), form_fill: true }, "CallLead"), lead(22, { booked: key(22) }));
  const bookings = [...specs.map((_, i) => booking(i + 1)), booking(20), booking(21, { lead: { model: "CallLead", id: key(21) } }), booking(22, { cancelled: true })];
  const result = composeAssignedPotential(A, leads, bookings);
  assert.equal(result.eligible_lead_count, 2);
  assert.equal(result.known_binder_total, 200.02);
});

test("coverage distinguishes zero, missing link, dangling, missing amount and cross-model/cross-Rep alias; exact anchor wins same-job unlinked alias", () => {
  const leads = [lead(1, { booked: key(1), normalized_job_no: "V100" }), lead(2, { normalized_job_no: "V100" }, "CallLead"), lead(3, { booked: key(999) }), lead(4, { booked: key(4) }), lead(5, { booked: key(1) }, "CallLead"), lead(6, { booked: key(6) }), lead(1, { booked: key(1) })];
  const bookings = [booking(1), booking(4, { total: null }), booking(6, { total: 0 })];
  const result = composeAssignedPotential(A, leads, bookings);
  assert.equal(result.known_binder_total, 100.01);
  assert.equal(result.eligible_lead_count, 6);
  assert.equal(result.linked_booking_count, 3);
  assert.equal(result.missing_link_count, 1);
  assert.equal(result.dangling_link_count, 1);
  assert.equal(result.missing_amount_count, 1);
  assert.equal(result.mismatched_link_count, 1);
  assert.equal(result.coverage, "partial");
  assert.equal(composeAssignedPotential(B, [lead(5, { booked: key(1), receiver_agent: B }, "CallLead")], bookings).known_binder_total, 0);
  const conflicting = composeAssignedPotential(A, [lead(1, { booked: key(1), normalized_job_no: "V100" }), lead(2, { booked: key(2), normalized_job_no: "V100" })], [booking(1), booking(2)]);
  assert.equal(conflicting.known_binder_total, 0);
  assert.equal(conflicting.ambiguous_identity_count, 2);
});

test("rep isolation is enforced before money reads; Owner/Manager can explicitly view Rep and DTO validates", async () => {
  const rep: OutreachActor = { role: "rep", agent_id: A, actor: { kind: "rep", id: "rep", request_id: "r", run_id: null, agent_id: A } };
  const calls: string[] = [];
  const store: RepMetricsStore = { ownBookings: async (agent) => { calls.push(agent); return [booking(1)]; }, assignedLeads: async (agent) => { calls.push(agent); return [lead(1, { booked: key(1) })]; }, attachedBookings: async () => [booking(1)] };
  const deps = { now: NOW, loader: fixedConfigurationLoader(activeInspection(completeConfigurationInput({ desk_enabled: true }))), metricsStore: store };
  await assert.rejects(readRepMetrics(rep, { agent_id: B }, deps), /FORBIDDEN/);
  assert.deepEqual(calls, []);
  const dto = salesOutreachRepMetricsDtoSchema.parse(await readRepMetrics(rep, {}, deps));
  assert.equal(dto.agent_id, A);
  for (const role of ["owner", "manager"] as const) {
    const actor: OutreachActor = { role, agent_id: null, actor: { kind: role, id: "owner", request_id: "r", run_id: null } };
    assert.equal((await readRepMetrics(actor, { agent_id: A }, deps)).agent_id, A);
    await assert.rejects(readRepMetrics(actor, {}, deps), /INVALID_INPUT/);
  }
  assert.throws(() => salesOutreachRepMetricsQuerySchema.parse({ agent_id: A, unsafe: true }));
});


test("canonical cancellation records exclude missing Lead/Booking cancellation mirrors by either anchor", () => {
  const leads = applyPotentialCancellations([lead(1, { booked: key(1) }), lead(2, { booked: key(2) }), lead(3, { booked: key(3) })], [
    { _id: key(99), lead_model: "FormLead", lead_ref: key(1) }, { _id: key(98), booked_lead: key(2) },
  ]);
  assert.equal(composeAssignedPotential(A, leads, [booking(1), booking(2), booking(3)]).known_binder_total, 100.01);
});


test("official leadless credit rejects residual raw Lead pointers after adapter normalization", () => {
  const base = {
    book_date: new Date("2026-10-13T00:00:00Z"), is_leadless_booking: true,
    agent_allocations: [{ agent: A, binder_amount: 100.01 }], total_binder_amount: 100.01,
  };
  const partialLinks = [
    { lead_ref: key(1) },
    { lead_model: "FormLead" },
    { lead_model: "CallLead" },
    { lead_ref: key(1), lead_model: "LegacyLead" },
    { lead_ref: key(1), lead_model: null },
    { lead_ref: null, lead_model: "FormLead" },
  ];
  const malformed = partialLinks.map((link, index) => toRepMetricBooking({ ...base, _id: key(index + 1), ...link }));
  for (const booking of malformed) {
    assert.equal(booking.lead, null, "a partial pointer has no canonical attached Lead");
    assert.equal(isOfficialMetricBooking(booking), false, "partial identity must not fall through to official leadless");
  }
  const officialLeadless = toRepMetricBooking({ ...base, _id: key(20) });
  const explicitNullLeadless = toRepMetricBooking({ ...base, _id: key(21), lead_ref: null, lead_model: null });
  const attached = toRepMetricBooking({ ...base, _id: key(22), is_leadless_booking: false, lead_ref: key(22), lead_model: "CallLead" });
  for (const booking of [officialLeadless, explicitNullLeadless, attached]) assert.equal(isOfficialMetricBooking(booking), true);
  const total = composeOfficialBinder(A, NOW, [...malformed, officialLeadless, explicitNullLeadless, attached]);
  assert.equal(total.all_time, 300.03);
  assert.equal(total.booking_count, 3);
});
