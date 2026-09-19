import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { streamCsiInvalidations } from './live';
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
  assert.match(text,/"reconnect"/);assert.match(text,/"refetch":"all"/);abort.abort();await reader.cancel().catch(()=>{});
  await new Promise(r=>setTimeout(r,50));assert.equal(closed,1);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
