import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { intelligenceEnvelopeSchema, intelligenceEvidenceRefSchema } from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { payloadHash } from "../transactions";
import { CSI_PROMPT_TEMPLATE, CSI_PROMPT_VERSION, intelligenceReadSchema, intelligenceToolArguments } from "./contracts";
const artifactPath="../vantage-movers-mcp/lib/intelligence/generated/intelligence-contract-v1.json";
test("generated MCP prompt, envelope and every tool exactly match server authority",{skip:!existsSync(artifactPath) ? "Cross-repository parity runs in multi-repo workspace; isolated server snapshot has no MCP checkout" : false},()=>{
  const artifact=JSON.parse(readFileSync(artifactPath,"utf8"));
  assert.deepEqual(artifact.envelope_schema,z.toJSONSchema(intelligenceEnvelopeSchema));
  assert.equal(artifact.schema_digest,payloadHash(artifact.envelope_schema));
  assert.equal(artifact.prompt_template,CSI_PROMPT_TEMPLATE);assert.equal(artifact.prompt_version,CSI_PROMPT_VERSION);
  assert.deepEqual(artifact.tools,Object.fromEntries(Object.entries(intelligenceToolArguments).map(([k,v])=>[k,z.toJSONSchema(v)])));
});
test("closed tool arguments reject authority, operators, arbitrary URLs and excessive pages",()=>{
  for(const raw of [{tool:"mongo_find",args:{}},{tool:"get_lead",args:{model:"FormLead",id:{$ne:null}}},
    {tool:"search_leads",args:{query:"synthetic",limit:1000}},{tool:"search_leads",args:{actor:"owner"}},
    {tool:"get_ringcentral_call",args:{call_log_id:"https://example.invalid"}},
    {tool:"query_operational_records",args:{dataset:"users",filter:{$where:"true"}}}]) assert.equal(intelligenceReadSchema.safeParse(raw).success,false);
});
test("owner-added operational record kinds are citable through the authoritative strict envelope",()=>{
  for(const record_type of ["contact_number","agent","granot_source","ringcentral_queue","ringcentral_user","job_timeline"]){
    assert.equal(intelligenceEvidenceRefSchema.safeParse({source:"vantage_record",snapshot_id:"synthetic",record_type,record_id:"synthetic",field_paths:["name"]}).success,true);
  }
});
