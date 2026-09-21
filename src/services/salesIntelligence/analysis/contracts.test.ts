import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { intelligenceEvidenceRefSchema } from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { payloadHash } from "../transactions";
import { CSI_PROMPT_TEMPLATE, CSI_PROMPT_VERSION, CSI_PROMPT_VERSIONS, intelligenceReadSchema } from "./contracts";
import { CSI_SCHEMA_ARTIFACT_REVISIONS, CSI_SCHEMA_RESOURCE_URIS, intelligenceEnvelopeJsonSchema, intelligenceSchemaDigest, intelligenceToolJsonSchemas } from "./schemaArtifact";
const artifactPath="../vantage-movers-mcp/lib/intelligence/generated/intelligence-contract-v1.json";
test("generated MCP prompt, envelope and every tool exactly match server authority",{skip:!existsSync(artifactPath) ? "Cross-repository parity runs in multi-repo workspace; isolated server snapshot has no MCP checkout" : false},()=>{
  const artifact=JSON.parse(readFileSync(artifactPath,"utf8"));
  assert.deepEqual(artifact.envelope_schema,intelligenceEnvelopeJsonSchema());
  assert.equal(artifact.schema_digest,payloadHash(artifact.envelope_schema));
  assert.equal(artifact.schema_digest,intelligenceSchemaDigest());
  assert.equal(artifact.prompt_template,CSI_PROMPT_TEMPLATE);assert.equal(artifact.prompt_version,CSI_PROMPT_VERSION);
  assert.deepEqual(artifact.prompt_versions,[...CSI_PROMPT_VERSIONS]);
  assert.deepEqual(artifact.tools,intelligenceToolJsonSchemas());
  // Every rendering revision is published with its own URI and digest so a run
  // pinned to an older one still replays; the digests must all differ (22 §4.2).
  const digests=new Set<string>();
  for(const revision of CSI_SCHEMA_ARTIFACT_REVISIONS){
    const published=artifact.revisions[revision];
    assert.ok(published,revision);
    assert.equal(published.uri,CSI_SCHEMA_RESOURCE_URIS[revision]);
    assert.deepEqual(published.envelope_schema,intelligenceEnvelopeJsonSchema(revision));
    assert.equal(published.schema_digest,intelligenceSchemaDigest(revision));
    assert.deepEqual(published.tools,intelligenceToolJsonSchemas(revision));
    digests.add(published.schema_digest);
  }
  assert.equal(digests.size,CSI_SCHEMA_ARTIFACT_REVISIONS.length);
});
test("the compact rendering is the same contract, smaller, and round-trips through both adapters",()=>{
  // `runtime.ts` rebuilds a Zod validator from the MCP's published JSON Schema
  // and hands that same JSON to the provider. Compaction must survive both.
  const inline=intelligenceToolJsonSchemas("r1").submit_intelligence_analysis;
  const compact=intelligenceToolJsonSchemas("r2").submit_intelligence_analysis;
  const bytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value),"utf8");
  assert(bytes(compact)<bytes(inline)/2,`compact ${bytes(compact)} is not materially smaller than ${bytes(inline)}`);
  const envelope={schema_version:"csi-envelope-v1",summary:{overview:"o",customer_wanted:"",money_and_dates:"",outcome:"",commitments:"",discrepancies:"",finding_keys:[]},findings:[],next_step_suggestion:null,owner_instruction_assessments:[]};
  for(const [name,json] of [["r1",inline],["r2",compact]] as const){
    const rebuilt=z.fromJSONSchema(json as Parameters<typeof z.fromJSONSchema>[0]);
    assert.equal(rebuilt.safeParse({idempotency_key:"k",envelope}).success,true,name);
    assert.equal(rebuilt.safeParse({idempotency_key:"k",envelope:{...envelope,findings:[{unknown:true}]}}).success,false,name);
    assert.equal(rebuilt.safeParse({idempotency_key:"k",envelope,extra:1}).success,false,name);
  }
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
