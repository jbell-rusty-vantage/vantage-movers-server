/** Read-only discovery. Domain collections are read via the raw driver; only the shared lease is written. */
import { randomUUID, createHmac } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { configureMongoDnsServers } from '../../src/db';
import { MongoLeaseStore } from '../../src/services/durableWork/leases';
import { SheetSyncLease } from '../../src/models/SheetSyncLease';
import { openGranotAuthenticatedSession } from '../../src/services/granotHttpCollector';
import { collectVerifiedEstimates } from '../../src/services/granotHttpCollector/estimatesCollection';
import { planEstimatesIdentities } from '../../src/services/granotHttpCollector/estimatesIdentityPlanning';
import { normalizeJobNo } from '../../src/services/bookings/bookingIdentity';
import { canonicalFactsSchema, type PoolRow } from './contracts';
import { classifyPoolRows } from './matching';
import { getGranotDateWindowProblem } from '../../src/services/granotHttpCollector';

async function main() {
  if (!process.argv.includes('--run')) throw new Error('Explicit --run required');
  const out = process.argv.find(v => v.startsWith('--out='))?.slice(6);
  if (!out) throw new Error('Explicit --out required');
  const discoveryFrom=process.argv.find(v=>v.startsWith('--from='))?.slice(7)??'01/01/2026';
  const chunkDays=Number(process.argv.find(v=>v.startsWith('--chunk-days='))?.slice(13)??7);
  const binding = (a: string, b: string) => process.env[a]?.trim() || process.env[b]?.trim() || '';
  const credentials = { networkUsername: binding('GRANOT_NETWORK_USERNAME','MAIN_LOGIN_USERNAME'), networkPassword: binding('GRANOT_NETWORK_PASSWORD','MAIN_LOGIN_PASSWORD'), username: binding('GRANOT_USERNAME','SPECIFIC_USERNAME'), password: binding('GRANOT_PASSWORD','SPECIFIC_PASSWORD') };
  if (Object.values(credentials).some(v=>!v) || !process.env.MONGO_URI) throw new Error('Required bindings missing');
  mongoose.set('autoIndex',false); mongoose.set('autoCreate',false);
  configureMongoDnsServers();
  await mongoose.connect(process.env.MONGO_URI,{dbName:'vantagemovers',autoIndex:false,autoCreate:false,maxPoolSize:4,serverSelectionTimeoutMS:10000});
  console.log(JSON.stringify({stage:'database_connected'}));
  const store = new MongoLeaseStore(SheetSyncLease), ttl = 45*60_000;
  let lease = await store.acquire({scope:'granot:automation:account',owner:`pool-read:${randomUUID()}`,now:new Date(),ttl_ms:ttl});
  if (!lease) throw new Error('Shared lease busy; no login attempted');
  const fence = async () => { const renewed = await store.renew({token:lease!,now:new Date(),ttl_ms:ttl}); if(!renewed) throw new Error('Shared lease lost'); lease=renewed; };
  let requests=0, released=false;
  const started=new Date(), salt=randomUUID(), hash=(v:unknown)=>createHmac('sha256',salt).update(String(v)).digest('hex').slice(0,16);
  try {
    const transport: typeof fetch = async (url,init) => { if(++requests>256) throw new Error('Request budget exhausted'); if(new URL(String(url)).origin!=='https://eagle.hellomoving.com') throw new Error('Unexpected host'); await fence(); const r=await fetch(url,init); await fence(); return r; };
    const session=await openGranotAuthenticatedSession(credentials,{fetch:transport});
    console.log(JSON.stringify({stage:'authenticated_under_shared_lease'}));
    // The deployed ALL collector is unchanged. This local session seam replaces only its report selector.
    let poolPosts=0;
    const poolSession={...session,request:async (path:string,init?:Parameters<typeof session.request>[1])=>{
      if(init?.method==='POST' && path.includes('~estprocessret~')) { const body=new URLSearchParams(String(init.body)); if(body.get('FUSTATUS')!=='10') throw new Error('Unexpected selector'); body.set('FUSTATUS','9'); poolPosts++; return session.request(path,{...init,body}); }
      return session.request(path,init);
    }};
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const mmdd=(s:string)=>`${s.slice(5,7)}/${s.slice(8,10)}/${s.slice(0,4)}`;
    const coverage:unknown[]=[];
    const month=await collectVerifiedEstimates(poolSession,{from:mmdd(day.slice(0,8)+'01'),to:mmdd(day)},{beforeRequest:fence,onCoverage:v=>{coverage.push({scope:'current_month',...v});}});
    console.log(JSON.stringify({stage:'current_month_complete',rows:month.flatMap(s=>s.sections.followUpEstimates).length,requests}));
    if(getGranotDateWindowProblem({from:discoveryFrom,to:mmdd(day)}))throw new Error('Invalid discovery date');
    const year=await collectVerifiedEstimates(poolSession,{from:discoveryFrom,to:mmdd(day)},{beforeRequest:fence,chunkDays,maxRequests:192,onCoverage:v=>{coverage.push({scope:'declared_discovery_range',...v});}});
    const rows=year.flatMap(s=>s.sections.followUpEstimates);
    if(rows.some(r=>r.values.priority!=='9')) throw new Error('Returned priority was not Pool');
    console.log(JSON.stringify({stage:'year_complete',rows:rows.length,requests}));
    const db=mongoose.connection.db!;
    const projection=Object.fromEntries(['job_no','normalized_job_no','ref_no','granot_priority','duplicate','bad_lead','created_on_unmatched','booked','cancelled','receiver_agent','receiver_agent_source','lead_source_company','source_granularity_id','source_granularity_key','source_company','ingestion_origin','no_sync','sheet_sync','quoted','cubic_feet','domain_revision'].map(k=>[k,1]));
    const forms=await db.collection('form_leads').find({},{projection}).toArray();
    const calls=await db.collection('call_leads').find({},{projection}).toArray();
    const bookings=await db.collection('booked_leads').find({},{projection:{job_no:1,normalized_job_no:1,lead_ref:1,lead_model:1,is_referral_booking:1,is_leadless_booking:1,booking_origin:1,cancelled:1}}).toArray();
    const links=await db.collection('granot_record_links').find({state:'active'},{projection:{normalized_job_no:1,lead_ref:1,booking_ref:1,disputed:1,source_scope:1}}).toArray();
    const lead=(v:any)=>({id:String(v._id),job_no:v.job_no,normalized_job_no:v.normalized_job_no,ref_no:v.ref_no,priority:v.granot_priority,duplicate:!!v.duplicate,bad:!!v.bad_lead,created_on_unmatched:!!v.created_on_unmatched,booked_id:v.booked?String(v.booked):undefined,receiver_agent_id:v.receiver_agent?String(v.receiver_agent):undefined,receiver_source:v.receiver_agent_source,cancelled:!!v.cancelled,source_company_key:v.source_company,source_granularity_key:v.source_granularity_key,no_sync:v.no_sync,master_sheet_lineage:(v.sheet_sync??[]).some((s:any)=>['master_forms','master_calls'].includes(s.target)&&s.last_synced_at)?'present':'unknown'});
    const facts=canonicalFactsSchema.parse({coverage:'complete_for_jobs',forms:forms.map(lead),calls:calls.map(lead),bookings:bookings.map(v=>({id:String(v._id),job_no:v.job_no,normalized_job_no:v.normalized_job_no,lead_ref:v.lead_ref||v.lead_model?{id:v.lead_ref?String(v.lead_ref):undefined,model:v.lead_model}:null,anchor_evidence:v.lead_ref&&v.lead_model?'complete':v.lead_ref||v.lead_model?'partial':'empty',raw_lead_ref_present:!!v.lead_ref,raw_lead_model_present:!!v.lead_model,is_referral_booking:v.is_referral_booking,is_leadless_booking:v.is_leadless_booking,booking_origin:v.booking_origin,cancelled:!!v.cancelled})),record_links:links.map(v=>({id:String(v._id),normalized_job_no:v.normalized_job_no,lead_ref:v.lead_ref?{id:String(v.lead_ref.id),model:v.lead_ref.model}:null,booking_id:v.booking_ref?String(v.booking_ref):undefined,disputed:v.disputed}))});
    const poolRows:PoolRow[]=rows.map(r=>({job_no:r.values.job_no??null,open_date:r.values.open_date??null,priority:r.values.priority??null,source:r.values.source??null,user:r.values.user??null,ref_no:r.values.ref_no??null}));
    const matching=classifyPoolRows(poolRows,facts);
    const plan=await planEstimatesIdentities(year,{runId:new mongoose.Types.ObjectId().toHexString(),beforeRow:fence});
    const all:Array<Record<string,any>>=[...forms.map(v=>({...v,model:'FormLead'})),...calls.map(v=>({...v,model:'CallLead'}))];
    const targets=plan.actions.flatMap(a=>a.lifecycle_apply?.expected_target?[a.lifecycle_apply.expected_target]:[]);
    const targetKeys=new Set(targets.map(t=>`${t.model}:${t.id}`)), matched=all.filter(v=>targetKeys.has(`${v.model}:${v._id}`));
    const ids=matched.map(v=>v._id);
    const changes=await db.collection('entity_changes').find({'entity.id':{$in:ids.map(String)},changed_paths:'granot_priority'},{projection:{entity:1,fields:1,applied_at:1,'provenance.observation_id':1}}).toArray();
    const transitions=changes.filter(c=>(c.fields??[]).some((f:any)=>f.path==='granot_priority'&&String(f.after)==='9'&&f.before!=null&&String(f.before)!=='9'));
    const observations=await db.collection('granot_observations').find({'identity.normalized_job_no':{$in:rows.map(r=>normalizeJobNo(r.values.job_no)).filter(Boolean)}},{projection:{'identity.normalized_job_no':1,'priority.canonical':1,captured_at:1,route_event_class:1}}).toArray();
    const group=(values:unknown[])=>values.reduce<Record<string,number>>((acc,v)=>{const k=String(v??'unknown');acc[k]=(acc[k]??0)+1;return acc;},{});
    const timeline=matched.map(v=>{const key=normalizeJobNo(v.job_no);const obs=observations.filter(o=>o.identity?.normalized_job_no===key).sort((a,b)=>+a.captured_at-+b.captured_at);return {lead_key:hash(`${v.model}:${v._id}`),model:v.model,stored_priority:v.granot_priority??'unknown',source_company:v.source_company??'unknown',source_granularity:v.source_granularity_key??'unknown',ingestion_origin:v.ingestion_origin??'unknown',receiver_present:!!v.receiver_agent,receiver_source:v.receiver_agent_source??'unknown',quoted:!!v.quoted,has_cubic_feet:typeof v.cubic_feet==='number',sheet_targets:(v.sheet_sync??[]).map((s:any)=>({target:s.target,status:s.status,has_synced_at:!!s.last_synced_at})),transition_proven:transitions.some(c=>String(c.entity.id)===String(v._id)),observation_priorities:group(obs.map(o=>o.priority?.canonical)),observed_non9_before9:obs.some((o,i)=>o.priority?.canonical==='9'&&obs.slice(0,i).some(p=>p.priority?.canonical&&p.priority.canonical!=='9'))};});
    await fence();
    released=await store.release({token:lease,now:new Date()});
    const dates=rows.map(r=>new Date(r.values.open_date!).toISOString().slice(0,10)).sort();
    const cutoff=new Date(+new Date(day+'T00:00:00Z')-89*86400000).toISOString().slice(0,10);
    const scopeEvidence={from:discoveryFrom,to:mmdd(day),chunk_days:chunkDays,earliest_observed_open_date:dates[0]??null,latest_observed_open_date:dates.at(-1)??null,open_months:group(dates.map(d=>d.slice(0,7))),trailing90_cutoff:cutoff,older_than_trailing90:dates.filter(d=>d<cutoff).length};
    const report={provenance:'live_pool_selected_read_only_2026_10_14',started_at:started.toISOString(),completed_at:new Date().toISOString(),as_of_ny:day,selectors:{FUSTATUS:'9',STATUS:'V9',TYPEDTE:'OPEN',USER:'',DEPT:'ALL',form_verified_by:'verifyEstimatesForm (Pool=9, ALL=10)',returned_priorities:group(rows.map(r=>r.values.priority))},requests,pool_report_posts:poolPosts,lease:{scope:lease.scope,fenced_before_auth:true,renewed_around_requests:true,released},coverage,month_rows:month.flatMap(s=>s.sections.followUpEstimates).length,year_rows:rows.length,older_than_current_month:rows.filter(r=>r.values.open_date!&&mmdd(day.slice(0,8)+'01')!==r.values.open_date&&new Date(r.values.open_date!)<new Date(day.slice(0,8)+'01')).length,provider_sources:group(rows.map(r=>r.values.source)),canonical_inventory:{forms:forms.length,calls:calls.length,bookings:bookings.length,active_links:links.length,raw_booking_coverage:'all rows, no populate/cancellation filter; sequential non-atomic reads'},matching,canonical_preview:{counters:plan.counters,match_methods:group(plan.actions.map(a=>a.report_identity?.match_method)),holds:group(plan.actions.filter(a=>a.classification!=='update').map(a=>a.reason)),matched_models:group(matched.map(v=>v.model)),stored_priorities:group(matched.map(v=>v.granot_priority)),ingestion_origins:group(matched.map(v=>v.ingestion_origin)),priority_transition_proven:timeline.filter(v=>v.transition_proven).length,observed_non9_before9:timeline.filter(v=>v.observed_non9_before9).length},leads:timeline,held_rows:plan.actions.filter(a=>a.classification!=='update').map(a=>({job_key:hash(a.report_identity?.normalized_job_sha256??a.row_id),source:a.source_label,reason:a.reason,classification:a.classification})),limits:['Declared Open Date range only; earlier unknown dates not proven absent','Canonical reads are sequential, not a point-in-time transaction','EntityChange proves recorded Vantage change, not original Granot transition instant','No Pool admission eligibility granted'],domain_mutations:0};
    Object.assign(report,{discovery_scope:scopeEvidence});
    await writeFile(out,JSON.stringify(report,null,2));
    console.log(JSON.stringify({ok:true,out,requests,rows:rows.length,matched:matched.length,holds:report.canonical_preview.holds,lease_released:released,domain_mutations:0}));
  } finally {if(!released) await store.release({token:lease,now:new Date()});}
}
main().catch(()=>{console.error('Pool inspection failed; details suppressed to protect credentials and provider data.');process.exitCode=1;}).finally(()=>mongoose.disconnect());
