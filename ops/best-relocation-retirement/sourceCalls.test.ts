import assert from "node:assert/strict";
import { test } from "node:test";
import { planFinalSourceCalls } from "./sourceCalls";
import type { ParsedCallLead } from "../../src/services/bestRelocationSheetIngest/types";
import { BEST_RELOCATION_ADMISSION_COMPANY_ID as company, BEST_RELOCATION_ADMISSION_CALL_FEED_ID as feed } from "../../src/services/leads/callLeadAdmission";

const id="600000000000000000000001",copy="600000000000000000000002",copy2="600000000000000000000003";
function source(checker="",phone="3055551212",timestamp="2026-06-01T16:00:00.000Z"): ParsedCallLead {
  return {kind:"call",source_tab:"Calls",sheet_row:2,phone,normalized_phone:phone,date:"6/1/2026",time:"12:00",timestamp,
    booked_flag:"",over_2000:"",over_4000:"",form_fill_checker:checker,provenance:{workbook_id:"1KZrKD9Oa8vMkuEkHUGOVXcsPV0tkKutDGb3Qq1wFuk0",
      workbook_title:"Synthetic",tab:"Calls",sheet_row:2,source_row_key:"synthetic",raw:{PHONE_NUMBER:phone,"Form Fill Checker":checker,vantage_ingestion_id:"vantage:11111111-1111-4111-8111-111111111111"}}};
}
function canonical(overrides:Record<string,unknown>={}) {return {_id:id,phone_number:"3055551212",source_company:"best_relocation_leads",lead_source_company:company,
  source_granularity_id:feed,timestamp:new Date("2026-06-01T12:00:00Z"),createdAt:new Date("2026-06-01T16:01:00Z"),duplicate:false,domain_revision:0,...overrides};}
test("missing ordinary Calls are held and explicitly flagged, never admitted",async()=>{
  const result=await planFinalSourceCalls({calls:[source()],candidates:[],formPhones:new Set(),receipts:new Map()});
  assert.equal(result.normal_call_flags.length,1);assert.equal(result.actions[0]?.command,"record_conflict");
  assert.equal(result.actions[0]?.conflict?.type,"new_normal_call_creation");assert.equal(result.actions[0]?.command_payload,undefined);
});
test("one original among exact duplicate copies adopts without new entities and binds aliases",async()=>{
  const original=canonical(),result=await planFinalSourceCalls({calls:[source("Bad info")],candidates:[canonical({_id:copy,duplicate:true}),original,canonical({_id:copy2,duplicate:true})],formPhones:new Set(),receipts:new Map()});
  assert.equal(result.actions.length,3);assert.equal(result.actions[0]?.command_payload?.target_lead_id,id);assert.equal(result.actions[0]?.classification,"adoption");
  assert.equal(result.actions[0]?.command_payload?.expected_disposition,"bad_call_leads");assert.equal(result.aliases.length,2);
  for(const alias of result.aliases){assert.equal(alias.action.command_payload?.primary_lead_id,id);assert.equal(alias.action.command_payload?.expected_disposition,"duplicate_calls");assert.deepEqual(alias.action.depends_on,[result.actions[0]!.action_key]);}
  assert.equal(original.duplicate,false);
});
test("multiple nonduplicate exact matches remain conflicts",async()=>{
  const result=await planFinalSourceCalls({calls:[source()],candidates:[canonical(),canonical({_id:copy})],formPhones:new Set(),receipts:new Map()});
  assert.equal(result.actions[0]?.command,"record_conflict");assert.equal(result.actions[0]?.conflict?.type,"ambiguous_lead_match");
});
test("checker and factual Form matches permit planned exceptions without RC evidence",async()=>{
  for(const [checker,forms,destination] of [["Form Fill",new Set(),"duplicate_calls"],["Freight Move",new Set(),"bad_call_leads"],["",new Set(["3055551212"]),"duplicate_calls"]] as const){
    const result=await planFinalSourceCalls({calls:[source(checker)],candidates:[],formPhones:forms as Set<string>,receipts:new Map()});
    assert.equal(result.normal_call_flags.length,0);assert.equal(result.actions[0]?.command,"admit_final_best_relocation_call");
    assert.equal(result.actions[0]?.command_payload?.expected_disposition,destination);assert.equal(result.actions[0]?.command_payload?.reviewed_for_insert,true);
    assert.equal(result.actions[0]?.command_payload?.ringcentral,undefined);
  }
});
test("phone-only mismatches never adopt an unrelated canonical record",async()=>{
  const result=await planFinalSourceCalls({calls:[source()],candidates:[canonical({timestamp:new Date("2026-06-01T11:59:27Z")})],formPhones:new Set(),receipts:new Map()});
  assert.equal(result.actions[0]?.command,"record_conflict");assert.deepEqual(result.normal_call_flags[0]?.same_phone_ids,[id]);
});
test("prior nonduplicate call within the shared ninety-day window makes a new call duplicate",async()=>{
  const result=await planFinalSourceCalls({calls:[source("Bad info")],candidates:[canonical({timestamp:new Date("2026-05-01T12:00:00Z"),createdAt:new Date("2026-05-01T16:00:01Z")})],formPhones:new Set(),receipts:new Map()});
  assert.equal(result.actions[0]?.command_payload?.duplicate,true);assert.equal(result.actions[0]?.command_payload?.expected_disposition,"duplicate_calls");
});

test("a definite frozen Booking match may propose a normal Call for the additional canonical insert gate",async()=>{
  const row=source(),stable=row.provenance.raw.vantage_ingestion_id!;
  const result=await planFinalSourceCalls({calls:[row],candidates:[],formPhones:new Set(),receipts:new Map(),definiteBookings:new Map([[stable,"P5550001"]])});
  assert.equal(result.normal_call_flags.length,0);
  assert.equal(result.actions[0]!.command,"admit_final_best_relocation_call");
  assert.equal(result.actions[0]!.command_payload!.expected_disposition,"calls");
  assert.equal(result.actions[0]!.command_payload!.reviewed_for_insert,true);
});
