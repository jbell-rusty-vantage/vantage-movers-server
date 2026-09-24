import mongoose from "mongoose";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { toObjectId } from "../../../utils/objectId";
import type { StoryLeadRef } from "../story/types";
import { readCaseLeads, toCaseLead } from "./assemble";
import { originLines } from "./build";
import { duration, fullTime } from "./time";
import { CALL_PROJECTION, readVantageSideContext, toCaseCall, vantageClauseText, vantageSide } from "./vantageSide";

/**
 * AC2-SUMMARY (spec §4.12, fixes V9): the call facts the summary step reads beside the transcript,
 * so "Monday" is anchored to the call date and the rep is named only as Vantage's records name them:
 *
 *   call: { at: "Thu Sep 17, 2026 10:04 AM ET", at_iso, direction, duration, vantage_side, lead_origin }
 *
 * `vantage_side` is the §4.5 clause (line with its number, queue/transfer, rep); `lead_origin` is the §2
 * line for the bound Lead (the conversation's own Lead, else the only attached one), else null. Read only.
 */
export type SummaryCallContext = { at: string; at_iso: string; direction: string; duration: string; vantage_side: string; lead_origin: string | null };
const oid = toObjectId;

export async function summaryCallContext(input: { conversation_ids: readonly string[]; contact_number_id: string; binding: readonly StoryLeadRef[] }): Promise<Map<string, SummaryCallContext>> {
  const out = new Map<string, SummaryCallContext>();
  const ids = input.conversation_ids.filter(id => mongoose.isValidObjectId(id));
  if (!ids.length) return out;
  const conversations = await getLeadConversationModel().find({ _id: { $in: ids.map(oid) }, contact_number_id: oid(input.contact_number_id) })
    .select("call_interaction_id started_at direction duration_seconds lead_ref").limit(ids.length).lean();
  const callIds = conversations.flatMap(c => (c.call_interaction_id ? [c.call_interaction_id] : []));
  const rows = callIds.length ? await getCallInteractionModel().find({ _id: { $in: callIds } }).select(CALL_PROJECTION).limit(callIds.length).lean() : [];
  const calls = (rows as unknown as Parameters<typeof toCaseCall>[0][]).map(toCaseCall);
  const refs = [...input.binding, ...conversations.flatMap(c => (c.lead_ref ? [{ model: c.lead_ref.model, id: String(c.lead_ref.id) } as StoryLeadRef] : []))]
    .filter((ref, i, all) => all.findIndex(r => r.model === ref.model && r.id === ref.id) === i).slice(0, 20);
  const leads = (await readCaseLeads(refs)).map(toCaseLead);
  const vantage = await readVantageSideContext(calls, leads);
  const sides = new Map(calls.map(c => [c.id, vantageSide(c, vantage)]));
  for (const conversation of conversations) {
    const call = conversation.call_interaction_id ? calls.find(c => c.id === String(conversation.call_interaction_id)) ?? null : null;
    const direction = call?.direction ?? conversation.direction ?? "Unknown";
    const side = call ? sides.get(call.id)! : null;
    const bound = conversation.lead_ref ? leads.find(l => l.ref.model === conversation.lead_ref!.model && l.ref.id === String(conversation.lead_ref!.id))
      : input.binding.length === 1 ? leads.find(l => l.ref.model === input.binding[0]!.model && l.ref.id === input.binding[0]!.id) : undefined;
    const origin = bound ? originLines(bound, "Lead", { calls, sides, routes: vantage.routes }).map(line => line.trim()).join(" ") : null;
    const at = conversation.started_at.toISOString();
    out.set(String(conversation._id), { at: fullTime(at), at_iso: at, direction: direction.toLowerCase(), duration: duration(conversation.duration_seconds ?? call?.duration_seconds ?? null),
      vantage_side: side ? `${direction} ${vantageClauseText(side, direction, call!.provider_connected, true)}` : "Vantage line not recorded", lead_origin: origin });
  }
  return out;
}
