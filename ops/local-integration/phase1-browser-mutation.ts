/** Disposable Phase1 browser live/reconnect mutation, never a production command or booking create. */
import {database} from './env';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
async function main(){
  const {connectMongo}=await import('../../src/db.js');await connectMongo();
  assert.equal(mongoose.connection.name,database);assert.equal(mongoose.connection.host,'127.0.0.1');
  const db=mongoose.connection.db!,booking=await db.collection('booked_leads').findOne({job_no:'PHASE1-today'});assert.ok(booking);
  const total=process.argv.includes('--restore')?100.01:110.01;
  const allocations=booking.agent_allocations.map((allocation:Record<string,unknown>)=>({...allocation,binder_amount:String(allocation.agent)==='360f2f6456d420c391c73535'?Math.round((total-50.01)*100)/100:50.01}));
  const session=await mongoose.startSession();
  try{await session.withTransaction(async()=>{
    await db.collection('booked_leads').updateOne({_id:booking._id},{$set:{total_binder_amount:total,agent_allocations:allocations}},{session});
    await db.collection('entity_changes').insertOne({entity:{model:'BookedLead',id:booking._id},changed_paths:['total_binder_amount','agent_allocations'],fields:[{path:'agent_allocations',value_mode:'stored',before:booking.agent_allocations,after:allocations}],command_execution_id:new mongoose.Types.ObjectId(),command_name:'local-browser-proof',revision_before:1,revision_after:2,applied_at:new Date()},{session});
  });}finally{await session.endSession();}
  console.log(JSON.stringify({database,local_synthetic_booking_total:total}));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>mongoose.disconnect());
