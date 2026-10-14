/** Canonical GET-equivalent follow-up to a redacted Pool capture; raw-driver reads only. */
import mongoose from 'mongoose';
import { readFile, writeFile } from 'node:fs/promises';
import { configureMongoDnsServers } from '../../src/db';
import { redactKey } from './matching';
import { normalizeJobNo } from '../../src/services/bookings/bookingIdentity';

async function main(){
  if(!process.argv.includes('--run'))throw new Error('Explicit --run required');
  const input=process.argv.find(v=>v.startsWith('--input='))?.slice(8),out=process.argv.find(v=>v.startsWith('--out='))?.slice(6);
  if(!input||!out)throw new Error('Input and output required');
  const report=JSON.parse(await readFile(input,'utf8'));
  configureMongoDnsServers();mongoose.set('autoIndex',false);mongoose.set('autoCreate',false);
  await mongoose.connect(process.env.MONGO_URI!,{dbName:'vantagemovers',autoIndex:false,autoCreate:false,maxPoolSize:2});
  const db=mongoose.connection.db!,projection={job_no:1,normalized_job_no:1,granot_priority:1,duplicate:1,bad_lead:1,created_on_unmatched:1,no_sync:1,booked:1,cancelled:1,receiver_agent:1,receiver_agent_source:1,sheet_sync:1};
  const forms=await db.collection('form_leads').find({},{projection}).toArray(),calls=await db.collection('call_leads').find({},{projection}).toArray();
  const all:Array<Record<string,any>>=[...forms.map(v=>({...v,model:'FormLead'})),...calls.map(v=>({...v,model:'CallLead'}))];
  const byKey=new Map(all.map(v=>[redactKey('lead',`${v.model}:${v._id}`),v]));
  const groups=report.matching.collisions.map((c:any)=>({...c,leads:c.canonical_anchor_keys.flatMap((k:string)=>byKey.has(k)?[byKey.get(k)!]:[])}));
  const anchored=[...new Map(groups.flatMap((c:any)=>c.leads).map((v:any)=>[`${v.model}:${v._id}`,v])).values()] as Array<Record<string,any>>;
  const ids=anchored.map(v=>v._id);
  const subjects=await db.collection('sales_outreach_subjects').find({lead_id:{$in:ids}},{projection:{lead_id:1,lead_model:1,status:1,review_reasons:1,'priority.raw':1}}).toArray();
  const changes=await db.collection('entity_changes').find({'entity.id':{$in:ids.map(String)},changed_paths:'granot_priority'},{projection:{entity:1,fields:1,command_name:1,applied_at:1,provenance:1}}).toArray();
  const transitions=changes.filter(c=>(c.fields??[]).some((f:any)=>f.path==='granot_priority'&&String(f.after)==='9'&&f.before!=null&&String(f.before)!=='9'));
  const observationIds=transitions.flatMap(c=>c.provenance?.observation_id?[c.provenance.observation_id]:[]);
  const observations=await db.collection('granot_observations').find({_id:{$in:observationIds}},{projection:{receipt_id:1,route_event_class:1,captured_at:1,'priority.canonical':1}}).toArray();
  const receipts=await db.collection('granot_webhook_receipts').find({_id:{$in:observations.map(o=>o.receipt_id)}},{projection:{observation_channel:1,route_event_class:1,'processing.state':1}}).toArray();
  const decisions=await db.collection('synchronization_decisions').find({observation_id:{$in:observationIds}},{projection:{observation_id:1,attempt:1,outcome:1,reason_code:1,effects:1}}).sort({attempt:-1}).toArray();
  const sheetJobs=await db.collection('sheet_sync_jobs').find({entity_id:{$in:transitions.map(c=>String(c.entity.id))}},{projection:{entity_id:1,entity_model:1,status:1}}).toArray();
  const transitionEvidence=transitions.map(c=>{const o=observations.find(o=>String(o._id)===String(c.provenance?.observation_id)),d=decisions.find(d=>String(d.observation_id)===String(o?._id));return {lead_key:redactKey('lead',`${c.entity.model}:${c.entity.id}`),applied_at:c.applied_at,priority_before:(c.fields??[]).find((f:any)=>f.path==='granot_priority')?.before,priority_after:'9',observation_found:!!o,receipt_found:receipts.some(r=>String(r._id)===String(o?.receipt_id)),route:o?.route_event_class,observation_captured_at:o?.captured_at,latest_decision:d?{attempt:d.attempt,outcome:d.outcome,reason:d.reason_code,effect_kinds:(d.effects??[]).map((e:any)=>e.kind)}:null,sheet_job_statuses:sheetJobs.filter(j=>j.entity_id===c.entity.id&&j.entity_model===c.entity.model).map(j=>j.status)};});
  const group=(values:unknown[])=>values.reduce<Record<string,number>>((a,v)=>{const k=String(v??'unknown');a[k]=(a[k]??0)+1;return a;},{});
  const rows=groups.filter((c:any)=>c.leads.length).map((c:any)=>({job_key:c.job_key,classification:c.classification,candidates:c.leads.map((v:any)=>({lead_key:redactKey('lead',`${v.model}:${v._id}`),model:v.model,stored_priority:v.granot_priority??'unknown',stored_raw_job_agrees:normalizeJobNo(v.job_no)===normalizeJobNo(v.normalized_job_no),duplicate:!!v.duplicate,bad:!!v.bad_lead,unmatched:!!v.created_on_unmatched,no_sync:v.no_sync??'missing',booked_ref:!!v.booked,cancelled_ref:!!v.cancelled,assigned:!!v.receiver_agent,receiver_source:v.receiver_agent_source??'unknown',desk_states:subjects.filter(s=>s.lead_model===v.model&&String(s.lead_id)===String(v._id)).map(s=>({status:s.status,review_reasons:s.review_reasons,priority:s.priority?.raw})),sheet_lineage:(v.sheet_sync??[]).map((s:any)=>({target:s.target,status:s.status,has_synced_at:!!s.last_synced_at}))}))}));
  const result={provenance:'read_only_canonical_followup_to_observed_pool_job_hashes',captured_at:new Date().toISOString(),input_evidence:input,anchored_leads:anchored.length,subjects:group(subjects.map(v=>v.status)),priority_change_rows:changes.length,proven_non9_to9_changes:transitions.length,transition_history_limit:'Missing before or absent change evidence cannot establish a Granot transition',rows,production_mutations:0};
  Object.assign(result,{transition_evidence:transitionEvidence,transition_receipt_channels:group(receipts.map(r=>r.observation_channel)),transition_receipt_states:group(receipts.map(r=>r.processing?.state)),history_join:'EntityChange.entity.id is a string; corrected from initial live-capture ObjectId query',unique_transition_leads:new Set(transitionEvidence.map(v=>v.lead_key)).size});
  await writeFile(out,JSON.stringify(result,null,2));console.log(JSON.stringify({out,anchored_leads:result.anchored_leads,subjects:result.subjects,proven_non9_to9_changes:transitions.length,production_mutations:0}));
}
main().catch(()=>{console.error('Canonical follow-up failed; private errors suppressed');process.exitCode=1;}).finally(()=>mongoose.disconnect());
