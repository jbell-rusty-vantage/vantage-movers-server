/** Real replica change-stream proof; loopback test DB only, no provider traffic or .env. */
import { database } from './env';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

async function main() {
  const { connectMongo }=await import('../../src/db.js');
  const { watchOutreachLiveEvents,outreachLiveHint }=await import('../../src/services/salesOutreach/live/stream.js');
  await connectMongo();
  assert.equal(mongoose.connection.name,database);
  assert.equal(mongoose.connection.host,'127.0.0.1');
  const db=mongoose.connection.db!;
  const scopes=[{role:'rep' as const,agent_id:'d9e98cc15237c848c5c8732b'},{role:'rep' as const,agent_id:'360f2f6456d420c391c73535'},{role:'rep' as const,agent_id:'827afd4ea8fe654e16526da9'}];
  const streams=scopes.map(watchOutreachLiveEvents);
  const timeout=<T>(promise:Promise<T>,ms=5000)=>Promise.race([promise,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('change stream timeout')),ms))]);
  const booking=await db.collection('booked_leads').findOne({job_no:'PHASE1-today'});
  assert.ok(booking);
  const a=scopes[0]!,b=scopes[1]!;
  const change=(model:string,id:mongoose.Types.ObjectId,paths:string[],fields:unknown[]=[])=>({entity:{model,id},changed_paths:paths,fields,command_execution_id:new mongoose.Types.ObjectId(),command_name:'local-synthetic-proof',revision_before:1,revision_after:2,applied_at:new Date(),provenance:{source_system:'vantage',request_id:randomUUID()}});
  const next=(index:number)=>streams[index]!.next().then(event=>outreachLiveHint(event,scopes[index]!));
  try {
    const ap=next(0),bp=next(1),cp=next(2);
    await new Promise(resolve=>setTimeout(resolve,150));
    const session=await mongoose.startSession();
    try { await session.withTransaction(async()=>{
      await db.collection('booked_leads').updateOne({_id:booking._id},{$set:{total_binder_amount:110.01}},{session});
      await db.collection('entity_changes').insertOne(change('BookedLead',booking._id,['total_binder_amount']),{session});
    }); } finally {await session.endSession();}
    for(const [promise,scope] of [[ap,a],[bp,b]] as const) {const hint=await timeout(promise);assert.equal(hint?.topic,'outreach_rep_metrics');assert.deepEqual(hint?.agent_ids,[scope.agent_id]);assert.deepEqual(hint?.subject_ids,[]);}
    const afterRollback=next(0);
    const rollback=await mongoose.startSession();
    rollback.startTransaction();
    await db.collection('entity_changes').insertOne(change('BookedLead',booking._id,['book_date']),{session:rollback});
    await rollback.abortTransaction();await rollback.endSession();
    const rollbackResult=await Promise.race([afterRollback.then(()=>true),new Promise<false>(resolve=>setTimeout(()=>resolve(false),350))]);
    assert.equal(rollbackResult,false,'aborted transaction emitted no metric hint');
    const assignmentB=next(1);
    await db.collection('entity_changes').insertOne(change('FormLead',booking.lead_ref,['receiver_agent'],[{path:'receiver_agent',value_mode:'stored',before:new mongoose.Types.ObjectId(a.agent_id),after:new mongoose.Types.ObjectId(b.agent_id)}]));
    assert.deepEqual((await timeout(afterRollback))?.agent_ids,[a.agent_id]);
    assert.deepEqual((await timeout(assignmentB))?.agent_ids,[b.agent_id]);
    const cancellationA=next(0),cancellationB=next(1);
    await db.collection('entity_changes').insertOne(change('CancelledLead',new mongoose.Types.ObjectId(),['cancelled']));
    assert.deepEqual((await timeout(cp))?.agent_ids,[scopes[2]!.agent_id],'foreign rep receives only subsequent broad cancellation own-scope hint');
    await timeout(cancellationA);await timeout(cancellationB);
    const oldAllocations=booking.agent_allocations;
    assert.ok(Array.isArray(oldAllocations));
    const replacementAllocations=oldAllocations.map(allocation=>({...allocation,agent:new mongoose.Types.ObjectId(scopes[2]!.agent_id)}));
    const allocated=[next(0),next(1),next(2)];
    const allocationSession=await mongoose.startSession();
    try {await allocationSession.withTransaction(async()=>{
      await db.collection('booked_leads').updateOne({_id:booking._id},{$set:{agent_allocations:replacementAllocations}},{session:allocationSession});
      await db.collection('entity_changes').insertOne(change('BookedLead',booking._id,['agent_allocations'],[{path:'agent_allocations',value_mode:'stored',before:oldAllocations,after:replacementAllocations}]),{session:allocationSession});
    });} finally {await allocationSession.endSession();}
    for(let index=0;index<allocated.length;index++) assert.deepEqual((await timeout(allocated[index]!))?.agent_ids,[scopes[index]!.agent_id],'old allocation owner, new allocation owner, and current assigned rep each refresh only themselves');
    const restore=next(0);
    await db.collection('booked_leads').updateOne({_id:booking._id},{$set:{total_binder_amount:booking.total_binder_amount,agent_allocations:booking.agent_allocations}});
    await db.collection('entity_changes').insertOne(change('BookedLead',booking._id,['total_binder_amount','agent_allocations'],[{path:'agent_allocations',value_mode:'stored',before:replacementAllocations,after:oldAllocations}]));
    await timeout(restore);
    console.log(JSON.stringify({database,proof:'passed',checks:['committed binder update reaches allocation and current assignment reps','foreign rep isolation','aborted EntityChange emits no hint','assignment before/after both refresh','allocation before/after plus current assignment all refresh','cancellation own-scope broadcast','ids-only projection and topic'],restored_total:booking.total_binder_amount},null,2));
  } finally {
    await db.collection('booked_leads').updateOne({_id:booking._id},{$set:{total_binder_amount:booking.total_binder_amount,agent_allocations:booking.agent_allocations}});
    await Promise.all(streams.map(s=>s.close()));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>mongoose.disconnect());
