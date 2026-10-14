/** Disposable Phase1 browser live/reconnect mutation, never a production command or booking create. */
import {database} from './env';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import {commitPhase1EntityMutation,ensurePhase1EntityChangeIndexes} from './phase1-entity-changes';
async function main(){
  const {connectMongo}=await import('../../src/db.js');await connectMongo();
  assert.equal(mongoose.connection.name,database);assert.equal(mongoose.connection.host,'127.0.0.1');
  const db=mongoose.connection.db!,booking=await db.collection('booked_leads').findOne({job_no:'PHASE1-today'});assert.ok(booking);
  const total=process.argv.includes('--restore')?100.01:110.01;
  await ensurePhase1EntityChangeIndexes();
  const receipt=await commitPhase1EntityMutation('BookedLead',booking._id,before=>({total_binder_amount:total,agent_allocations:(before.agent_allocations as Record<string,unknown>[]).map(allocation=>({...allocation,binder_amount:String(allocation.agent)==='360f2f6456d420c391c73535'?Math.round((total-50.01)*100)/100:50.01}))}),'local-browser-proof');
  console.log(JSON.stringify({database,local_synthetic_booking_total:total,revision_before:receipt?.revision_before??null,revision_after:receipt?.revision_after??null,no_change:receipt===null}));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>mongoose.disconnect());
