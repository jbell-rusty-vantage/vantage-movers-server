import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { redactTranscript } from "../../conversations/redaction";
import { moveViewsForLead, type MoveEndpoint } from "../assessment/views";
import { dispositionFor, normalizePriority, priorityLabel } from "../outreach/leadProgress";
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

type BookingRow = { _id: unknown; job_no?: string | null; book_date?: Date | null; deposit_amount?: number | null; total_binder_amount?: number | null; lead_ref?: unknown };

async function readBookings(leads: readonly LeadRow[]): Promise<Map<string, BookingRow>> {
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

export async function granotLeadStates(subject: StorySubject): Promise<GranotLeadState[]> {
  if (!subject.lead_refs.length) return [];
  const leads = await readLeadRows(subject.lead_refs.slice(0, 100));
  const [observations, bookings] = await Promise.all([newestObservations(leads, subject.as_of), readBookings(leads)]);
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
      receiver_agent_name: text(lead.receiver_agent_name_snapshot, 80), granot_rep_raw: text(observation?.agent_identity?.rep_raw, 60),
      move: {
        pickup: endpoint(views.pickup) ?? location(observation?.move?.origin), delivery: endpoint(views.delivery) ?? location(observation?.move?.destination),
        move_date: views.move_date ?? (observation?.move?.move_date ? observation.move.move_date.toISOString().slice(0, 10) : text(observation?.move?.move_date_raw, 40)),
        move_size: views.move_size, granot_move_size: views.granot_move_size ?? text(observation?.move?.granot_move_size_raw, 40),
        cubic_feet: views.cubic_feet ?? num(observation?.move?.estimated_cubic_feet),
        service_type: text(lead.granot_service_type, 40) ?? text(observation?.move?.service_type_raw, 40),
      },
      money: { estimate: text(observation?.display_money?.estimate?.raw, 40), payment: text(observation?.display_money?.payment?.raw, 40), balance: text(observation?.display_money?.balance?.raw, 40) },
      booking_action: observation?.booking_action?.normalized ?? text(observation?.booking_action?.raw, 40),
      observation: observation ? { id: String(observation._id), kind: observation.kind, captured_at: observation.captured_at.toISOString(), source_label: observation.normalized_source_label ?? null } : null,
      booking: booking ? { id: String(booking._id), job_no: text(booking.job_no, 40), book_date: booking.book_date instanceof Date ? booking.book_date.toISOString() : null,
        deposit_amount: num(booking.deposit_amount), total_binder_amount: num(booking.total_binder_amount) } : null,
    };
  });
}
