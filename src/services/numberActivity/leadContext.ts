import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { getNumberLeadAttachmentModel } from "../../models/NumberLeadAttachment";
import {
  numberAttachedLeadDtoSchema,
  type NumberAttachedLeadDto,
  type NumberLeadOfficialDto,
} from "./dto";

/**
 * Deterministic Lead context of a page of Contact Numbers: which Lead each
 * Number resolves to through its retained `number_lead_attachments`, and that
 * Lead's official state from the canonical `form_leads` / `call_leads`,
 * `booked_leads` and `cancelled_leads` rows.
 *
 * Batched for a page: one edges read, one read per Lead collection, one
 * Bookings read and one Cancellations read, whatever the page size. Reads only.
 * Never merges facts from different Leads and never picks a Lead out of several.
 */
type LeadModel = "FormLead" | "CallLead";
export type AttachedLeadRef = { model: LeadModel; id: string };
type Edge = { contact_number_id?: unknown; state: string; lead_ref: { model: LeadModel; id: unknown } };

/**
 * The one Lead a Number resolves to: exactly one `attached` edge. Several attached edges are
 * `multiple`; candidates, ambiguous and rejected edges never lend a Lead to the Number (`none`).
 * Shared by the Numbers row and the Number detail so they cannot disagree.
 */
export function resolveAttachedLead(edges: readonly Edge[]): { status: "resolved"; ref: AttachedLeadRef } | { status: "multiple" | "none" } {
  const attached = edges.filter((edge) => edge.state === "attached");
  if (attached.length > 1) return { status: "multiple" };
  if (attached.length === 0) return { status: "none" };
  return { status: "resolved", ref: { model: attached[0]!.lead_ref.model, id: String(attached[0]!.lead_ref.id) } };
}

export type LeadFlags = {
  _id: unknown;
  name?: string | null;
  job_no?: string | null;
  source_company_label_snapshot?: string | null;
  booked?: unknown;
  cancelled?: unknown;
  duplicate?: boolean | null;
  bad_lead?: unknown;
  no_sync?: boolean | null;
};
export type BookingRow = { _id: unknown; book_date?: Date | null };
export type CancellationRow = { _id: unknown; booked_lead: unknown };

/**
 * Official status: the Lead's own closure flags win (cancelled, booked, duplicate, bad, No-Sync),
 * then the exact Booking relationship (`booked_leads.lead_model` + `lead_ref`) and its
 * Cancellation, else an open Lead. Phone-only or Granot-observed booking evidence never counts.
 */
export function officialLeadState(
  lead: LeadFlags,
  bookings: readonly BookingRow[],
  cancellationByBooking: ReadonlyMap<string, string>,
): NumberLeadOfficialDto {
  const newest = [...bookings].sort((a, b) => (+(b.book_date ?? 0) - +(a.book_date ?? 0)) || String(b._id).localeCompare(String(a._id)))[0] ?? null;
  const cancellationId = newest ? cancellationByBooking.get(String(newest._id)) ?? null : null;
  const flag = lead.cancelled ? "cancelled" : lead.booked ? "booked" : lead.duplicate ? "duplicate" : lead.bad_lead ? "bad_lead" : lead.no_sync ? "no_sync" : null;
  const exact = newest ? (cancellationId ? "cancelled" : "booked") : null;
  return { status: flag ?? exact ?? "open_lead", booking_id: newest ? String(newest._id) : null, cancellation_id: cancellationId };
}

const LEAD_PROJECTION = { name: 1, job_no: 1, source_company_label_snapshot: 1, booked: 1, cancelled: 1, duplicate: 1, bad_lead: 1, no_sync: 1 } as const;
const leadKey = (model: string, id: unknown) => `${model}:${String(id)}`;

/** Lead rows, their Bookings and those Bookings' Cancellations for a set of Lead refs. Reads only. */
export async function loadOfficialLeads(refs: readonly AttachedLeadRef[]): Promise<Map<string, { lead: LeadFlags; official: NumberLeadOfficialDto }>> {
  const out = new Map<string, { lead: LeadFlags; official: NumberLeadOfficialDto }>();
  if (!refs.length) return out;
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
  const ids = (model: LeadModel) => [...new Set(refs.filter((ref) => ref.model === model).map((ref) => ref.id))].map((id) => new mongoose.Types.ObjectId(id));
  const formIds = ids("FormLead");
  const callIds = ids("CallLead");
  const [formLeads, callLeads, bookings] = await Promise.all([
    formIds.length ? db.collection("form_leads").find({ _id: { $in: formIds } }, { projection: LEAD_PROJECTION }).toArray() : [],
    callIds.length ? db.collection("call_leads").find({ _id: { $in: callIds } }, { projection: LEAD_PROJECTION }).toArray() : [],
    db.collection("booked_leads").find(
      { $or: refs.map((ref) => ({ lead_model: ref.model, lead_ref: new mongoose.Types.ObjectId(ref.id) })) },
      { projection: { _id: 1, lead_model: 1, lead_ref: 1, book_date: 1 } },
    ).toArray(),
  ]);
  const cancellations = bookings.length
    ? await db.collection("cancelled_leads").find(
      { booked_lead: { $in: bookings.map((booking) => booking._id) } },
      { projection: { _id: 1, booked_lead: 1 } },
    ).toArray()
    : [];
  const cancellationByBooking = new Map<string, string>();
  for (const row of cancellations) if (!cancellationByBooking.has(String(row.booked_lead))) cancellationByBooking.set(String(row.booked_lead), String(row._id));
  const bookingsByLead = new Map<string, BookingRow[]>();
  for (const booking of bookings) {
    const key = leadKey(String(booking.lead_model), booking.lead_ref);
    bookingsByLead.set(key, [...(bookingsByLead.get(key) ?? []), { _id: booking._id, book_date: booking.book_date ?? null }]);
  }
  for (const [model, rows] of [["FormLead", formLeads], ["CallLead", callLeads]] as const) {
    for (const row of rows) {
      const lead = row as unknown as LeadFlags;
      const key = leadKey(model, row._id);
      out.set(key, { lead, official: officialLeadState(lead, bookingsByLead.get(key) ?? [], cancellationByBooking) });
    }
  }
  return out;
}

/** The attached-Lead item for one resolution from the Leads a page already loaded. Pure. */
export function attachedLeadItem(
  pick: ReturnType<typeof resolveAttachedLead>,
  leads: ReadonlyMap<string, { lead: LeadFlags; official: NumberLeadOfficialDto }>,
): NumberAttachedLeadDto {
  if (pick.status !== "resolved") return { status: pick.status };
  const found = leads.get(leadKey(pick.ref.model, pick.ref.id)) ?? null;
  return numberAttachedLeadDtoSchema.parse({
    status: "resolved",
    lead_ref: pick.ref,
    lead_display: found
      ? { name: found.lead.name ?? null, job_no: found.lead.job_no ?? null, source_company: found.lead.source_company_label_snapshot ?? null }
      : null,
    official: found?.official ?? null,
  });
}

/** Number list helper: the attached Lead of every Number on a page. */
export async function loadAttachedLeadsForNumbers(numberIds: readonly string[]): Promise<Map<string, NumberAttachedLeadDto>> {
  const out = new Map<string, NumberAttachedLeadDto>();
  if (!numberIds.length) return out;
  const edges = (await getNumberLeadAttachmentModel()
    .find({ contact_number_id: { $in: numberIds.map((id) => new mongoose.Types.ObjectId(id)) }, state: "attached" })
    .select({ contact_number_id: 1, state: 1, lead_ref: 1 })
    .lean()) as unknown as Edge[];
  const byNumber = new Map<string, Edge[]>();
  for (const edge of edges) {
    const key = String(edge.contact_number_id);
    byNumber.set(key, [...(byNumber.get(key) ?? []), edge]);
  }
  const picks = new Map(numberIds.map((id) => [id, resolveAttachedLead(byNumber.get(id) ?? [])] as const));
  const leads = await loadOfficialLeads([...picks.values()].flatMap((pick) => (pick.status === "resolved" ? [pick.ref] : [])));
  for (const [id, pick] of picks) out.set(id, attachedLeadItem(pick, leads));
  return out;
}

/** Number detail helper: the attached Lead from the attachment rows the detail read already holds. */
export async function loadAttachedLeadForEdges(edges: readonly Edge[]): Promise<NumberAttachedLeadDto> {
  const pick = resolveAttachedLead(edges);
  return attachedLeadItem(pick, await loadOfficialLeads(pick.status === "resolved" ? [pick.ref] : []));
}
