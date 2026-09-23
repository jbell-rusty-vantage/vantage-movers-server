import mongoose, { type ClientSession } from "mongoose";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import type { AttachmentAttribution } from "../attachment/suggest";
import type { RecordRow, FollowupRow, InteractionRow } from "./types";

export type CallFacts = { identityAllowed: boolean; attributable: boolean; outboundAttempt: boolean; human: boolean; missed: boolean;
  outcome: "no_answer" | "left_voicemail" | "spoke_with_customer" | "connected_contact_unknown" | null };
/** Provider connected is never human evidence. Ringing devices/queues alone are not rep attempts. */
export function callFacts(record: RecordRow, call: InteractionRow, attribution: AttachmentAttribution, salesRepIds: readonly string[]): CallFacts {
  const user = call.parties.some(p => p.role === "user" && p.extension_id && (p.connected || (p.direction === "Outbound" && call.terminal)));
  const matches = record.subject.kind === "number_review" ? String(record.subject.contact_number_id) === String(call.contact_number_id) && attribution.blocked_reason === "unlinked" :
    attribution.lead_effects_allowed && attribution.lead_ref?.model === record.subject.model && attribution.lead_ref?.id === String(record.subject.id);
  const attributable = Boolean(matches && call.started_at >= record.trigger_at && user && !call.monitoring && ["Inbound", "Outbound"].includes(call.direction));
  const human = attributable && call.contact_type === "human_conversation" && salesRepIds.length > 0;
  const outboundAttempt = attributable && call.direction === "Outbound" && call.terminal;
  const missed = call.direction === "Inbound" && call.terminal && !call.provider_connected && call.contact_type !== "human_conversation";
  const outcome = human ? "spoke_with_customer" : call.contact_type === "voicemail" ? "left_voicemail" : call.provider_connected ? "connected_contact_unknown" : outboundAttempt ? "no_answer" : null;
  return { identityAllowed: Boolean(matches && call.started_at >= record.trigger_at), attributable, outboundAttempt, human, missed, outcome };
}
export function fulfilledByCall(action: FollowupRow, call: InteractionRow, facts: CallFacts): boolean {
  const trigger = action.first_missed_at ?? action.date_resolution?.anchor ?? action.createdAt;
  if (action.status !== "open" || !trigger || call.started_at <= trigger) return false;
  if (action.kind === "wait") return call.direction === "Inbound" && call.terminal && facts.identityAllowed;
  if (action.kind !== "call") return false;
  if (action.missed_episode_key) return facts.outboundAttempt || (call.direction === "Inbound" && facts.human);
  return facts.outboundAttempt && (!action.due_at || call.started_at >= action.due_at);
}
export function stateWithActions(record: RecordRow, actions: readonly FollowupRow[], now: Date): RecordRow["state"] {
  if (["closed", "identity_review", "unworked"].includes(record.state)) return record.state;
  const open = actions.filter(a => a.status === "open");
  return open.length > 0 && open.every(a => a.kind === "wait" && a.due_at && a.due_at > now) ? "waiting_on_customer" : "open";
}
export function officialClosure(lead: { duplicate?: boolean; bad_lead?: unknown; booked?: unknown; cancelled?: unknown; no_sync?: boolean }): string | null {
  if (lead.cancelled) return "cancelled";
  if (lead.booked) return "booked";
  if (lead.duplicate) return "duplicate";
  if (lead.bad_lead) return "bad_lead";
  if (lead.no_sync) return "no_sync";
  return null;
}
/**
 * §11.1: an official Booking relationship closes work even when the Lead's
 * `booked` mirror or the Outreach projection is delayed. The exact
 * `booked_leads` row `{lead_model, lead_ref}` is the authority; phone-only or
 * Granot-observed booking evidence never counts. Reads only.
 */
export async function authoritativeClosure(lead: Parameters<typeof officialClosure>[0], ref: { model: "FormLead" | "CallLead"; id: string }, session: ClientSession): Promise<string | null> {
  const mirrored = officialClosure(lead);
  if (mirrored) return mirrored;
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
  const booking = await db.collection("booked_leads").findOne({ lead_model: ref.model, lead_ref: new mongoose.Types.ObjectId(ref.id) }, { projection: { _id: 1, cancelled: 1 }, session });
  if (!booking) return null;
  if (booking.cancelled) return "cancelled";
  const cancellation = await db.collection("cancelled_leads").findOne({ booked_lead: booking._id }, { projection: { _id: 1 }, session });
  return cancellation ? "cancelled" : "booked";
}
