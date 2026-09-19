/** Real local HTTP proof. Requires the guarded CSI-07 preview launcher; no .env or provider. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
const base='http://127.0.0.1:3108',prefix='/api/proxy/api/v1/admin/sales-intelligence';
async function main() {
 const local=z.object({password:z.string(),env:z.object({TEST_MONGO_DATABASE_NAME:z.literal('testvantagemovers_csi07preview'),MONGO_URI:z.literal('mongodb://127.0.0.1:27189/?replicaSet=csi01')})}).parse(JSON.parse(await readFile(join(tmpdir(),'vantage-csi07-local/session.json'),'utf8')));
 const login=async(role:string)=>{const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${role}@csi07.example.test`,password:local.password})});assert.equal(response.status,200);return response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');};
 const cookie=await login('owner');
 const read=async(path:string)=>{const response=await fetch(base+prefix+path,{headers:{cookie}});assert.equal(response.status,200);return response.json();};
 const recordId='000000000000000000000721';
 const mode=process.argv[2] ?? 'proof';
 const detail=await read(`/outreach/${recordId}?scope=production`);
 const action=detail.data.outreach.followups.find((f:{kind:string})=>f.kind==='call');
 if(mode==='clock') {
  const response=await fetch(base+prefix+`/followups/${action.id}?scope=production`,{method:'PATCH',headers:{cookie,'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({command:'patch_followup',expected_revision:action.revision,changes:{due_at:new Date(Date.now()+45000).toISOString()},reason:'Synthetic local clock-only refresh proof'})});
  assert.equal(response.status,200);console.log('CLOCK ARMED: real PATCH moved callback 45 seconds ahead; observe it become overdue without another command.');return;
 }
 if(mode==='rename') {
  const description=`Synthetic callback updated ${new Date().toISOString()}`;
  const response=await fetch(base+prefix+`/followups/${action.id}?scope=production`,{method:'PATCH',headers:{cookie,'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({command:'patch_followup',expected_revision:action.revision,changes:{description},reason:'Synthetic command live refresh proof'})});
  assert.equal(response.status,200);console.log('COMMAND APPLIED:',description);return;
 }
 const admin=await login('admin');
 for(const path of ['/attention?scope=production','/numbers/000000000000000000000711','/outreach/'+recordId]) assert.equal((await fetch(base+prefix+path,{headers:{cookie:admin}})).status,403);
 assert.equal((await fetch(base+'/api/sales-intelligence-live',{headers:{cookie:admin}})).status,403);
 assert.equal((await fetch(base+prefix+'/attention?scope=historical',{headers:{cookie}})).status,403);
 assert.equal((await fetch(base+prefix+'/attention?scope=production&scope=combined',{headers:{cookie}})).status,403);
 assert.equal((await fetch(base+'/api/sales-intelligence-live?scope=combined',{headers:{cookie}})).status,403);
 assert.equal((await fetch(base+'/api/sales-intelligence-live')).status,401);
 const page=await read('/attention?scope=production');assert.equal(page.data.status,'ready');assert.ok(page.as_of);assert.equal(page.coverage.known_through,null);
 const url=base+prefix+`/outreach/${recordId}/commands?scope=production`,key=randomUUID();const body={command:'add_note',expected_revision:detail.data.outreach.revision,text:'Synthetic CSI-07 idempotency proof'};
 const send=(value:object)=>fetch(url,{method:'POST',headers:{cookie,'content-type':'application/json','idempotency-key':key,'x-vantage-admin-user-id':'forged','x-vantage-admin-role':'admin'},body:JSON.stringify(value)});
 const first=await send(body);assert.equal(first.status,200);const result=await first.json();const replay=await send(body);assert.equal(replay.status,200);const repeated=await replay.json();assert.equal(repeated.data.replayed,true);assert.deepEqual(repeated.data.response,result.data.response);
 assert.equal((await send({...body,text:'different payload'})).status,409);
 const abort=new AbortController();const stream=await fetch(base+'/api/sales-intelligence-live?scope=production',{headers:{cookie,'last-event-id':'deliberately-missed'},signal:abort.signal});assert.equal(stream.status,200);assert.equal(stream.headers.get('x-accel-buffering'),'no');
 const reader=stream.body!.getReader();let frames='';while(!frames.includes('"clock"')){frames+=new TextDecoder().decode((await reader.read()).value);}
 assert.match(frames,/"change"/);assert.match(frames,/"reconnect"/);assert.match(frames,/"refetch":"all"/);abort.abort();await reader.cancel().catch(()=>{});
 console.log('PASS real local HTTP: Owner reads + metadata, Admin/anonymous denial, conflicting scope denial, signed identity isolation, idempotency replay/conflict, streaming reconnect + clock frames.');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Proof failed');process.exitCode=1;});


