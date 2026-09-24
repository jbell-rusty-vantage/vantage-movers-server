import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { redactTranscript } from "../../conversations/redaction";
import { moveViewsForLead, type MoveEndpoint } from "../assessment/views";
import { dispositionFor, normalizePriority, priorityLabel } from "../outreach/leadProgress";
import type { GranotObservationDocument } from "../../../models/GranotObservation";
import { newestObservations, readLeadRows, type LeadRow } from "./sources";
import type { GranotLeadState, StorySubject } from "./types";

/**
 * Current Granot state per Lead (context provenance specification §4.6 `granot`): the Lead's
 * canonical fields, the newest accepted observation (display money stays Granot's raw text) and
 * the Booking, when one exists. Read only.
 */
const db = () => mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
const text = (value: unknown, max = 200): string | null => {
  if (value === null || value === undefined) return null;
  const s = redactTranscript(String(value)).text.trim();
  return s ? (s.length > max ? `${s.slice(0, max - 1)}…` : s) : null;
};
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const endpoint = (e: MoveEndpoint): string | null => {
  const place = [e.city, e.state].filter(Boolean).join(", ");
  return [place, e.zip].filter(Boolean).join(" ") || null;
};
const location = (loc: { city?: string; state?: string; zip?: string } | undefined | null) =>
  loc ? endpoint({ city: loc.city ?? null, state: loc.state ?? null, zip: loc.zip ?? null }) : null;

export type BookingRow = { _id: unknown; job_no?: string | null; book_date?: Date | null; deposit_amount?: number | null; total_binder_amount?: number | null; lead_ref?: unknown };

/** The Booking per Lead (`booked` pointer, else `lead_ref`), keyed `Model:id`. The Case File's §3 Booking line reads the same rows. */
export async function readLeadBookings(leads: readonly LeadRow[]): Promise<Map<string, BookingRow>> {
  const out = new Map<string, BookingRow>();
  const ids = [...new Set(leads.flatMap(l => (l.booked ? [String(l.booked)] : [])))].filter(id => mongoose.isValidObjectId(id));
  const leadIds = leads.map(l => l._id);
  if (!ids.length && !leadIds.length) return out;
  const rows = await db().collection("booked_leads").find({ $or: [...(ids.length ? [{ _id: { $in: ids.map(id => new mongoose.Types.ObjectId(id)) } }] : []), { lead_ref: { $in: leadIds } }] },
    { projection: { job_no: 1, book_date: 1, deposit_amount: 1, total_binder_amount: 1, lead_ref: 1 } }).sort({ book_date: -1 }).limit(leads.length * 2 + 1).toArray();
  for (const lead of leads) {
    const byPointer = lead.booked ? rows.find(r => String(r._id) === String(lead.booked)) : undefined;
    const byRef = rows.find(r => r.lead_ref && String(r.lead_ref) === String(lead._id));
    const row = byPointer ?? byRef;
    if (row) out.set(`${lead.model}:${lead._id}`, row as BookingRow);
  }
  return out;
}

/**
 * The tracked Granot fields of one observation, read exactly as the story reads them (context
 * provenance §4.6). The Case File's Granot history (Case File spec §4.4) uses the same accessors,
 * so a value means the same thing on both pages. Absent values are null.
 */
export type GranotTrackedField = "priority" | "estimate" | "payment" | "balance" | "move_date" | "move_size" | "cubic_feet" | "service_type" | "pickup" | "delivery" | "user_raw" | "rep_raw";
export const GRANOT_TRACKED_FIELDS: readonly GranotTrackedField[] = ["priority", "estimate", "payment", "balance", "move_date", "move_size", "cubic_feet", "service_type", "pickup", "delivery", "user_raw", "rep_raw"];
type ObservationLike = Pick<GranotObservationDocument, "priority" | "display_money" | "move" | "agent_identity"> | null | undefined;
export const observationEstimate = (o: ObservationLike) => text(o?.display_money?.estimate?.raw, 40);
export const observationPayment = (o: ObservationLike) => text(o?.display_money?.payment?.raw, 40);
export const observationBalance = (o: ObservationLike) => text(o?.display_money?.balance?.raw, 40);
export const observationMoveDate = (o: ObservationLike) => (o?.move?.move_date ? o.move.move_date.toISOString().slice(0, 10) : text(o?.move?.move_date_raw, 40));
export const observationMoveSize = (o: ObservationLike) => text(o?.move?.granot_move_size_raw, 40);
export const observationCubicFeet = (o: ObservationLike) => num(o?.move?.estimated_cubic_feet);
export const observationServiceType = (o: ObservationLike) => text(o?.move?.service_type_raw, 40);
export const observationPickup = (o: ObservationLike) => location(o?.move?.origin);
export const observationDelivery = (o: ObservationLike) => location(o?.move?.destination);
export const observationRep = (o: ObservationLike) => text(o?.agent_identity?.rep_raw, 60);
export const observationUser = (o: ObservationLike) => text(o?.agent_identity?.user_raw, 60);
/** Priority as the observation states it (`canonical`, else `raw`), like the story's `granot_observed` event. */
export const observationPriority = (o: ObservationLike) => normalizePriority(o?.priority?.canonical ?? o?.priority?.raw);
export function granotTrackedValues(o: ObservationLike): Record<GranotTrackedField, string | null> {
  const cubic = observationCubicFeet(o);
  return { priority: observationPriority(o), estimate: observationEstimate(o), payment: observationPayment(o), balance: observationBalance(o),
    move_date: observationMoveDate(o), move_size: observationMoveSize(o), cubic_feet: cubic === null ? null : String(cubic), service_type: observationServiceType(o),
    pickup: observationPickup(o), delivery: observationDelivery(o), user_raw: observationUser(o), rep_raw: observationRep(o) };
}

export async function granotLeadStates(subject: StorySubject): Promise<GranotLeadState[]> {
  if (!subject.lead_refs.length) return [];
  const leads = await readLeadRows(subject.lead_refs.slice(0, 100));
  const [observations, bookings] = await Promise.all([newestObservations(leads, subject.as_of), readLeadBookings(leads)]);
  return leads.map(lead => {
    const key = `${lead.model}:${lead._id}`;
    const observation = observations.get(key) ?? null;
    const booking = bookings.get(key) ?? null;
    const priority = normalizePriority(lead.granot_priority);
    const views = moveViewsForLead(lead, lead.model).canonical_current;
    return {
      lead_ref: { model: lead.model, id: String(lead._id) },
      job_no: text(lead.job_no, 40) ?? text(observation?.identity?.job_no_raw, 40),
      granot_priority: priority, priority_label: priorityLabel(priority), disposition: dispositionFor(priority),
      quoted: lead.quoted === true, booked: Boolean(lead.booked) || booking !== null, cancelled: Boolean(lead.cancelled),
      duplicate: Boolean(lead.duplicate), bad_lead: Boolean(lead.bad_lead), no_sync: Boolean(lead.no_sync),
      receiver_agent_name: text(lead.receiver_agent_name_snapshot, 80), granot_rep_raw: observationRep(observation),
      move: {
        pickup: endpoint(views.pickup) ?? observationPickup(observation), delivery: endpoint(views.delivery) ?? observationDelivery(observation),
        move_date: views.move_date ?? observationMoveDate(observation),
        move_size: views.move_size, granot_move_size: views.granot_move_size ?? observationMoveSize(observation),
        cubic_feet: views.cubic_feet ?? observationCubicFeet(observation),
        service_type: text(lead.granot_service_type, 40) ?? observationServiceType(observation),
      },
      money: { estimate: observationEstimate(observation), payment: observationPayment(observation), balance: observationBalance(observation) },
      booking_action: observation?.booking_action?.normalized ?? text(observation?.booking_action?.raw, 40),
      observation: observation ? { id: String(observation._id), kind: observation.kind, captured_at: observation.captured_at.toISOString(), source_label: observation.normalized_source_label ?? null } : null,
      booking: booking ? { id: String(booking._id), job_no: text(booking.job_no, 40), book_date: booking.book_date instanceof Date ? booking.book_date.toISOString() : null,
        deposit_amount: num(booking.deposit_amount), total_binder_amount: num(booking.total_binder_amount) } : null,
    };
  });
}
