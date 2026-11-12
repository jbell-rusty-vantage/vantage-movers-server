import { getFormLeadModel } from "../../src/models/FormLead";
import { getLeadSourceGranularityModel } from "../../src/models/LeadSourceGranularity";
import { normalizePhoneNumberForMatch } from "../../src/utils/phone";
import { toFloridaTimestamp } from "../../src/utils/easternTime";
import { classifyExternalReview } from "../../src/services/leads/externalSheetReview";
import type { BestRelocationPlanAction } from "../../src/services/bestRelocationSheetIngest/applicationPlan";
import type { FinalBookingGraph } from "./bookingGraph";

export type BookingMatchEdge = { lead_action_key: string; booking_action_key: string; booking_identity: string; evidence: string[] };
export type SkippedSourceRow = { dataset_key: string; stable_source_row_id: string; action_key: string; reason: string };
type Row = Record<string, any>;

/** Same exact feed, stored-business-time cohort and earlier nonduplicate phone
 * rule as canonical Form creation. This is a preview; the transaction rechecks. */
export async function loadFinalFormDuplicateContext(companyId: string) {
  const feeds = await getLeadSourceGranularityModel().find({ source_company: companyId, channel: "form" }).select("_id local").limit(10).lean();
  if (!feeds.length || feeds.length === 10) throw new Error("final_form_feed_inventory_incomplete");
  const rows = await getFormLeadModel().find({ source_granularity_id: { $in: feeds.map(row => row._id) }, duplicate: { $ne: true } })
    .select("_id source_granularity_id phone_number timestamp duplicate").limit(10001).lean();
  if (rows.length > 10000) throw new Error("final_form_duplicate_candidate_bound_exceeded");
  return { feeds: feeds.map(row => ({ id: String(row._id), local: row.local })), rows: rows as Row[] };
}

export function finalFormWouldBeDuplicate(payload: Row, context: Awaited<ReturnType<typeof loadFinalFormDuplicateContext>>) {
  const feed = context.feeds.filter(row => row.local === payload.local);
  if (feed.length !== 1) throw new Error("final_form_feed_ambiguous");
  const phone = normalizePhoneNumberForMatch(payload.phone_number), at = +toFloridaTimestamp(new Date(payload.timestamp));
  const cutoff = +new Date("2026-04-30T04:00:00.000Z");
  return !!phone && context.rows.some(row => String(row.source_granularity_id) === feed[0].id && row.duplicate !== true &&
    normalizePhoneNumberForMatch(row.phone_number) === phone && row.timestamp instanceof Date && +row.timestamp < at &&
    (at < cutoff || +row.timestamp >= cutoff));
}

/** Explicit skips account for normal unbooked rows without producing a domain
 * command, review fact, admission stamp or normal Master Leads projection. */
export function selectFinalLeadActions(input: { actions: BestRelocationPlanAction[]; graph: FinalBookingGraph;
  targets: Map<string, Row>; duplicates: Awaited<ReturnType<typeof loadFinalFormDuplicateContext>> }) {
  const skipped: SkippedSourceRow[] = [], edges: BookingMatchEdge[] = [];
  const duplicateContext = { ...input.duplicates, rows: [...input.duplicates.rows] };
  const actions = input.actions.map(action => {
    if (!["forms", "local_forms", "calls"].includes(action.dataset_key)) return action;
    const isCall = action.dataset_key === "calls", model = isCall ? "CallLead" : "FormLead";
    const targetId = action.command_payload?.target_lead_id ?? action.adopted_entity_refs?.find(ref => ref.model === model)?.id;
    const target = targetId ? input.targets.get(`${model}:${targetId}`) : undefined;
    let review;
    try { review = classifyExternalReview("rows" in action.provenance ? "" : action.provenance.raw[isCall ? "Form Fill Checker" : "Bad Lead Checker"] ?? "", model); }
    catch { return action; }
    const duplicate = target?.duplicate === true || (isCall ? action.command_payload?.expected_disposition === "duplicate_calls" :
      action.command === "create_form_lead" && finalFormWouldBeDuplicate(action.command_payload ?? {}, duplicateContext));
    const exception = !!review || duplicate || isCall && target?.form_fill === true;
    const match = input.graph.permitted_normal_leads.find(row => row.dataset_key === action.dataset_key && row.stable_source_row_id === action.stable_source_row_id);
    const booking = match && input.actions.find(row => row.dataset_key === "booked_deals" && row.stable_source_row_id === `booking:${match.booking_job}` &&
      row.command !== "record_conflict" && !["invalid", "conflict"].includes(row.classification));
    if (exception) {
      if (!isCall && action.command === "create_form_lead") {
        const payload = action.command_payload! as Row, feed = duplicateContext.feeds.find(row => row.local === payload.local)!;
        if (duplicate) {
          const phone = normalizePhoneNumberForMatch(payload.phone_number), at = +toFloridaTimestamp(new Date(payload.timestamp));
          const dependency = duplicateContext.rows.find(row => row.planned_action_key && String(row.source_granularity_id) === feed.id &&
            normalizePhoneNumberForMatch(row.phone_number) === phone && +row.timestamp < at);
          if (dependency) return { ...action, depends_on: [...new Set([...action.depends_on, dependency.planned_action_key])] };
        } else duplicateContext.rows.push({ source_granularity_id: feed.id, phone_number: payload.phone_number,
          timestamp: toFloridaTimestamp(new Date(payload.timestamp)), duplicate: false, planned_action_key: action.action_key });
      }
      return action;
    }
    // An existing official attachment is sufficient to retain the already saved
    // Lead, but does not authorize a different or missing source Lead.
    const alreadyBooked = target?.booked && input.actions.some(row => row.dataset_key === "booked_deals" &&
      row.adopted_entity_refs?.some(ref => ref.model === "BookedLead" && ref.id === String(target.booked)));
    if (booking && match) {
      const bookingId = booking.adopted_entity_refs?.find(ref=>ref.model==="BookedLead")?.id;
      const savedBooking = bookingId ? input.targets.get(`BookedLead:${bookingId}`) : undefined;
      if (savedBooking?.lead_ref && (String(savedBooking.lead_ref)!==String(targetId??"") || savedBooking.lead_model!==model)) {
        return {...action,command:"record_conflict" as const,classification:"conflict" as const,
          conflict:{type:"ambiguous_lead_match" as const,severity:"blocking" as const}};
      }
      const evidence = [...match.evidence, `booking_action:${booking.action_key}`];
      edges.push({ lead_action_key: action.action_key, booking_action_key: booking.action_key, booking_identity: booking.stable_source_row_id, evidence });
      if (!isCall && action.command === "create_form_lead") {
        const payload = action.command_payload! as Row, feed = duplicateContext.feeds.find(row => row.local === payload.local)!;
        duplicateContext.rows.push({ source_granularity_id: feed.id, phone_number: payload.phone_number,
          timestamp: toFloridaTimestamp(new Date(payload.timestamp)), duplicate: false, planned_action_key: action.action_key });
      }
      return { ...action, matching: { method: "definite_booking", calibration_version: "best-relocation-conservative-v2" as const, evidence } };
    }
    if (alreadyBooked) return action;
    skipped.push({ dataset_key: action.dataset_key, stable_source_row_id: action.stable_source_row_id, action_key: action.action_key, reason: "normal_source_row_without_definite_booking" });
    const { command_payload: _payload, conflict: _conflict, ...rest } = action;
    return { ...rest, command: "unchanged" as const, classification: "unchanged" as const, depends_on: [],
      matching: { method: "excluded_unbooked_normal", calibration_version: "best-relocation-conservative-v2" as const, evidence: ["no_definite_in_scope_booking"] } };
  });
  return { actions, skipped, booking_matches: edges };
}
