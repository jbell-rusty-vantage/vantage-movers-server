import { normalizePhoneNumberForMatch } from "../../src/utils/phone";
import { leadInstant } from "../../src/services/salesOutreach/subjects/leadInstant";
import { toFloridaTimestamp } from "../../src/utils/easternTime";
import { classifyRingCentralCallLeadDuplicate } from "../../src/services/ringcentral/ringcentral-duplicate-guard";
import { classifyExternalReview, EXTERNAL_REVIEW_POLICY_VERSION } from "../../src/services/leads/externalSheetReview";
import { BEST_RELOCATION_ADMISSION_COMPANY_ID, BEST_RELOCATION_ADMISSION_CALL_FEED_ID } from "../../src/services/leads/callLeadAdmission";
import { stableSourceRowId } from "../../src/services/bestRelocationSheetIngest/identity";
import type { ParsedCallLead } from "../../src/services/bestRelocationSheetIngest/types";
import type { BestRelocationPlanAction } from "../../src/services/bestRelocationSheetIngest/applicationPlan";
import { hash } from "./sourceSnapshot";

type Row = Record<string, any>;
export type NewNormalCallFlag = { stable_source_row_id: string; row: number; timestamp: string; phone_number: string; same_phone_ids: string[]; held: true };
export type SourceCallPlan = { actions: BestRelocationPlanAction[]; normal_call_flags: NewNormalCallFlag[]; aliases: Array<{ source: ParsedCallLead; action: BestRelocationPlanAction; target: Row }> };

/** Read-only, source-specific planning. A proposed missing normal Call is held,
 * never silently converted into permission to create or into fake RC facts. */
export async function planFinalSourceCalls(input: {
  calls: ParsedCallLead[]; candidates: Row[]; formPhones: Set<string>;
  receipts: Map<string, Row>;
}): Promise<SourceCallPlan> {
  const actions: BestRelocationPlanAction[] = [], flags: NewNormalCallFlag[] = [], aliases: SourceCallPlan["aliases"] = [];
  const candidates = input.candidates.filter(row => row.source_company === "best_relocation_leads" &&
    String(row.lead_source_company) === BEST_RELOCATION_ADMISSION_COMPANY_ID && String(row.source_granularity_id) === BEST_RELOCATION_ADMISSION_CALL_FEED_ID);
  const priorCreates: Row[] = [];
  for (const row of [...input.calls].sort((a,b) => Date.parse(a.timestamp!) - Date.parse(b.timestamp!) || stableSourceRowId(a).localeCompare(stableSourceRowId(b)))) {
    const stable = stableSourceRowId(row), phone = normalizePhoneNumberForMatch(row.phone), timestamp = row.timestamp!;
    const contentHash = hash([EXTERNAL_REVIEW_POLICY_VERSION, row.provenance.raw]);
    const base: BestRelocationPlanAction = { action_key: `final-call:${stable}:${contentHash}`, command: "record_conflict", classification: "conflict",
      dataset_key: "calls", stable_source_row_id: stable, content_hash: contentHash, schema_profile: "calls:final-import-v1", schema_version: 2,
      provenance: row.provenance, depends_on: [], conflict: { type: "canonical_divergence", severity: "blocking" } };
    if (!phone || !Number.isFinite(Date.parse(timestamp))) { actions.push(base); continue; }
    const samePhone = candidates.filter(candidate => normalizePhoneNumberForMatch(candidate.normalized_phone_number ?? candidate.phone_number) === phone);
    const receipt = input.receipts.get(`calls:${stable}`);
    const receiptId = receipt?.resulting_canonical_model === "CallLead" && receipt.resulting_canonical_ids?.length === 1 ? String(receipt.resulting_canonical_ids[0]) : undefined;
    const exact = receiptId ? candidates.filter(candidate => String(candidate._id) === receiptId) : samePhone.filter(candidate => leadInstant(candidate)?.getTime() === Date.parse(timestamp));
    const originals = exact.filter(candidate => candidate.duplicate !== true);
    const target = exact.length === 1 ? exact[0] : originals.length === 1 && exact.every(candidate => candidate === originals[0] || candidate.duplicate === true) ? originals[0] : undefined;
    if (receipt && !target || exact.length && !target) { actions.push({ ...base, conflict: {type:"ambiguous_lead_match",severity:"blocking"} }); continue; }
    let review: ReturnType<typeof classifyExternalReview>;
    try { review = classifyExternalReview(row.provenance.raw["Form Fill Checker"] ?? row.form_fill_checker, "CallLead"); }
    catch { actions.push({ ...base, conflict: {type:"schema_drift",severity:"blocking"} }); continue; }
    const formFill = target?.form_fill === true || input.formPhones.has(phone);
    // The Owner held the missing blank-checker cohort for inspection. A later
    // repeat-window heuristic must not silently turn those holds into creates.
    if (!target && !review && !formFill) {
      flags.push({stable_source_row_id:stable,row:row.sheet_row,timestamp,phone_number:row.phone,same_phone_ids:samePhone.map(candidate=>String(candidate._id)),held:true});
      actions.push({...base,conflict:{type:"new_normal_call_creation",severity:"blocking"},matching:{method:"owner_hold",score:0,calibration_version:"best-relocation-final-import-v1",evidence:["owner_hold_new_normal_calls"]}}); continue;
    }
    if (!target && samePhone.some(candidate=>leadInstant(candidate)!=null&&Math.abs(+leadInstant(candidate)!-Date.parse(timestamp))<=6*3600000)) {
      actions.push({...base,conflict:{type:"ambiguous_lead_match",severity:"blocking"}});continue;
    }
    const repeated = target ? target.duplicate === true : (await classifyRingCentralCallLeadDuplicate({ sourceCompany: "best_relocation_leads",
      sourceGranularityId: BEST_RELOCATION_ADMISSION_CALL_FEED_ID, callerPhoneNumber: phone, callTimestamp: new Date(timestamp) }, {
      findRecentCallLeads: async ({from,to}) => [...candidates, ...priorCreates].filter(candidate => candidate.duplicate !== true &&
        normalizePhoneNumberForMatch(candidate.phone_number) === phone && leadInstant(candidate) != null &&
        +toFloridaTimestamp(leadInstant(candidate)!) >= +from && +toFloridaTimestamp(leadInstant(candidate)!) < +to).map(candidate=>({...candidate,_id:candidate._id as {toString():string}})),
    })).isDuplicate;
    const disposition = repeated || formFill || review?.kind === "duplicate_call" ? "duplicate_calls" : review?.kind === "bad_call" ? "bad_call_leads" : "calls";
    if (!target && disposition === "calls") {
      flags.push({stable_source_row_id:stable,row:row.sheet_row,timestamp,phone_number:row.phone,same_phone_ids:samePhone.map(candidate=>String(candidate._id)),held:true});
      actions.push({...base,conflict:{type:"new_normal_call_creation",severity:"blocking"},matching:{method:"owner_hold",score:0,calibration_version:"best-relocation-final-import-v1",evidence:["owner_hold_new_normal_calls"]}}); continue;
    }
    // A different timestamp on the same phone is not durable identity proof.
    if (!target && samePhone.length && disposition !== "duplicate_calls") { actions.push({...base,conflict:{type:"ambiguous_lead_match",severity:"blocking"}}); continue; }
    const payload: Row = { phone_number:row.phone,timestamp,source_company:"best_relocation_leads",lead_source_company:BEST_RELOCATION_ADMISSION_COMPANY_ID,
      source_granularity_id:BEST_RELOCATION_ADMISSION_CALL_FEED_ID,duplicate:repeated,reviewed_for_insert:!target && disposition !== "calls",expected_disposition:disposition,
      ...(target ? {target_lead_id:String(target._id),expected_revision:Number(target.domain_revision??0)} : {}),...(receiptId ? {matching_receipt_id:String(receipt!._id)} : {}) };
    const {conflict:_conflict,...clean} = base;
    const action: BestRelocationPlanAction = {...clean,action_key:`${base.action_key}:target:${target?String(target._id):"new"}`,command:"admit_final_best_relocation_call",
      classification:target?"adoption":"create",command_payload:payload,...(target?{adopted_entity_refs:[{model:"CallLead",id:String(target._id)}]}:{})};
    actions.push(action);
    if (!target) priorCreates.push({_id:`planned:${stable}`,phone_number:row.phone,timestamp:new Date(timestamp),ingestion_origin:"granot_lead_created",duplicate:repeated});
    if (target && exact.length > 1) for (const alias of exact.filter(candidate=>candidate!==target)) {
      const aliasStable=`${stable}:alias:${alias._id}`;
      const aliasAction: BestRelocationPlanAction={...action,action_key:`final-call-alias:${aliasStable}:${contentHash}`,dataset_key:"call_aliases",stable_source_row_id:aliasStable,
        depends_on:[action.action_key],command_payload:{...payload,target_lead_id:String(alias._id),expected_revision:Number(alias.domain_revision??0),
          source_stable_row_id:stable,primary_lead_id:String(target._id),duplicate:true,reviewed_for_insert:false,expected_disposition:"duplicate_calls"},adopted_entity_refs:[{model:"CallLead",id:String(alias._id)}]};
      actions.push(aliasAction); aliases.push({source:row,action:aliasAction,target:alias});
    }
  }
  return {actions,normal_call_flags:flags,aliases};
}
