import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { csiLiveTopic, CSI_LIVE_COLLECTIONS, CSI_LIVE_TOPICS, streamCsiInvalidations } from './live';
import { createSalesIntelligenceAdminRouter } from '../../routes/sales-intelligence-admin.routes';
import { requireApiSecret } from '../../middleware/requireApiSecret';
import { computeAdminActorSignature } from '../operationsRegistry/trustedActor';

test('real HTTP CSI live auth, current scope, clock invalidations and cleanup',async()=>{
 process.env.VANTAGE_API_SECRET='unit-secret';process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET='unit-signing-secret';
 let closed=0,connects=0;
 const app=express();app.use(express.json());app.use('/api/v1',requireApiSecret);
 app.use(createSalesIntelligenceAdminRouter({flag:()=>true,connect:async()=>{connects++;},live:(req,res)=>streamCsiInvalidations(req,res,{clockMs:30,enabled:()=>true,watch:()=>({next:()=>new Promise(()=>{}),close:async()=>{closed++;}})})}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert.ok(address && typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 const path='/api/v1/admin/sales-intelligence/live';
 const headers=(role='owner')=>{const f={adminId:'owner',email:'owner@example.test',role,timestamp:String(Date.now()),requestId:'unit-csi07',method:'GET',path};return {'x-api-secret':'unit-secret','x-vantage-admin-user-id':f.adminId,'x-vantage-admin-email':f.email,'x-vantage-admin-role':role,'x-vantage-admin-timestamp':f.timestamp,'x-vantage-admin-request-id':f.requestId,'x-vantage-admin-signature':computeAdminActorSignature(f,'unit-signing-secret')};};
 try {
  assert.equal((await fetch(base+path)).status,401);
  assert.equal((await fetch(base+path,{headers:{'x-api-secret':'unit-secret'}})).status,403);
  assert.equal((await fetch(base+path,{headers:headers('admin')})).status,403);
  assert.equal((await fetch(base+path+'?scope=historical',{headers:headers()})).status,403);
  assert.equal(connects,0);
  const abort=new AbortController();const response=await fetch(base+path,{headers:{...headers(),'last-event-id':'missed'},signal:abort.signal});
  assert.equal(response.status,200);assert.equal(response.headers.get('x-accel-buffering'),'no');const reader=response.body!.getReader();
  let text='';while(!text.includes('"clock"')) text+=new TextDecoder().decode((await reader.read()).value);
  assert.match(text,/"reconnect"/);assert.match(text,/"refetch":"all"/);assert.match(text,/"version":2/);
  // A reconnect and a clock carry no topics, so the client resyncs everything on both.
  for(const frame of frames(text)) assert.deepEqual(frame.topics,[],frame.reason);
  abort.abort();await reader.cancel().catch(()=>{});
  await new Promise(r=>setTimeout(r,50));assert.equal(closed,1);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

type Frame={version:number;reason:string;topics:string[];refetch:string};
const frames=(text:string):Frame[]=>text.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)) as Frame);

test('CSI live topics map changed collections only, coalesce and de-duplicate',async()=>{
 for(const [coll,topic] of Object.entries(CSI_LIVE_TOPICS)) assert.equal(csiLiveTopic({ns:{db:'x',coll}}),topic);
 for(const coll of CSI_LIVE_COLLECTIONS.filter(c=>!(c in CSI_LIVE_TOPICS))) assert.equal(csiLiveTopic({ns:{db:'x',coll}}),'other');
 assert.equal(csiLiveTopic({ns:{db:'x',coll:'unwatched_future_collection'}}),'other');
 assert.equal(csiLiveTopic(null),'other');assert.equal(csiLiveTopic({}),'other');
 let release:((change:unknown)=>void)|null=null;const queue:unknown[]=[];
 const emit=(change:unknown)=>{if(release){const resolve=release;release=null;resolve(change);}else queue.push(change);};
 const app=express();
 app.get('/live',(req,res)=>streamCsiInvalidations(req,res,{clockMs:5_000,enabled:()=>true,
  watch:()=>({next:()=>queue.length?Promise.resolve(queue.shift()):new Promise(resolve=>{release=resolve;}),close:async()=>{}})}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert.ok(address&&typeof address!=='string');
 const abort=new AbortController();
 try {
  const response=await fetch(`http://127.0.0.1:${address.port}/live`,{signal:abort.signal});const reader=response.body!.getReader();
  const read=async(match:(frame:Frame)=>boolean)=>{let text='';for(;;){text+=new TextDecoder().decode((await reader.read()).value);const frame=frames(text).find(match);if(frame) return frame;}};
  assert.deepEqual((await read(f=>f.reason==='connect')).topics,[]);
  // Two collections inside one 250ms window become one frame; the repeat never duplicates a slug.
  emit({ns:{db:'x',coll:'outreach_followups'}});emit({ns:{db:'x',coll:'intelligence_runs'}});emit({ns:{db:'x',coll:'outreach_records'}});
  const change=await read(f=>f.reason==='change');
  assert.deepEqual(change.topics,['analysis','outreach']);assert.equal(change.version,2);assert.equal(change.refetch,'all');
  emit({ns:{db:'x',coll:'number_lead_attachments'}});
  assert.deepEqual((await read(f=>f.reason==='change'&&f.topics.includes('attachment'))).topics,['attachment']);
  emit({ns:{db:'x',coll:'sales_intelligence_policy_pointers'}});
  assert.deepEqual((await read(f=>f.reason==='change'&&f.topics.includes('other'))).topics,['other']);
  // Nothing but the slug leaves the process: no id, phone number or provider body.
  emit({ns:{db:'x',coll:'contact_numbers'},documentKey:{_id:'6ab03e836894bcef715051db'},fullDocument:{e164:'+15550100200'}});
  const guarded=await read(f=>f.reason==='change'&&f.topics.includes('number'));
  assert.deepEqual(Object.keys(guarded).sort(),['as_of','reason','refetch','topics','version']);
  abort.abort();await reader.cancel().catch(()=>{});
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
