/** Real replica indexed change-stream proof; loopback test DB only, no provider traffic or .env. */
import { database } from './env';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { commitPhase1EntityMutation, ensurePhase1EntityChangeIndexes, writePhase1EntityMutation } from './phase1-entity-changes';

async function main() {
  const { connectMongo }=await import('../../src/db.js');
  const { watchOutreachLiveEvents,outreachLiveHint }=await import('../../src/services/salesOutreach/live/stream.js');
  const {CancelledLead}=await import('../../src/models/CancelledLead.js');
  await connectMongo();
  assert.equal(mongoose.connection.name,database);assert.equal(mongoose.connection.host,'127.0.0.1');
  const db=mongoose.connection.db!,indexes=await ensurePhase1EntityChangeIndexes();
  const booking=await db.collection('booked_leads').findOne({job_no:'PHASE1-today'});assert.ok(booking);
  const lead=await db.collection('form_leads').findOne({_id:booking.lead_ref});assert.ok(lead);
  const cancelledBooking=await db.collection('booked_leads').findOne({job_no:'PHASE1-cancelled'});assert.ok(cancelledBooking);
  let cancellation=await db.collection('cancelled_leads').findOne({job_no:'PHASE1-live-cancellation'});
  if(!cancellation){
    const fixture=new CancelledLead({job_no:'PHASE1-live-cancellation',booked_lead:cancelledBooking._id,cancel_date:new Date('2026-10-13T00:00:00Z'),refund_amount:0,lead_ref:null,lead_model:null});
    await fixture.validate();await CancelledLead.collection.insertOne(fixture.toObject({versionKey:false}));
    cancellation=await db.collection('cancelled_leads').findOne({_id:fixture._id});
  }
  assert.ok(cancellation);
  const cancellationId=cancellation._id,cancellationRestore={lead_ref:cancellation.lead_ref??null,lead_model:cancellation.lead_model??null};
  const scopes=[{role:'rep' as const,agent_id:'d9e98cc15237c848c5c8732b'},{role:'rep' as const,agent_id:'360f2f6456d420c391c73535'},{role:'rep' as const,agent_id:'827afd4ea8fe654e16526da9'}];
  const streams=scopes.map(watchOutreachLiveEvents);
  const timeout=<T>(promise:Promise<T>,ms=5000)=>Promise.race([promise,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('change stream timeout')),ms))]);
  const next=(index:number)=>streams[index]!.next().then(event=>outreachLiveHint(event,scopes[index]!));
  const verify=async(promise:ReturnType<typeof next>,index:number)=>{
    const hint=await timeout(promise);assert.equal(hint?.topic,'outreach_rep_metrics');assert.deepEqual(hint?.agent_ids,[scopes[index]!.agent_id]);assert.deepEqual(hint?.subject_ids,[]);
  };
  const bookingRestore={total_binder_amount:booking.total_binder_amount,agent_allocations:booking.agent_allocations};
  const assignmentRestore={receiver_agent:lead.receiver_agent};
  const receipts:Array<{entity:{model:string;id:string};revision_before:number;revision_after:number}>=[];
  const remember=(receipt:Awaited<ReturnType<typeof commitPhase1EntityMutation>>)=>{assert.ok(receipt);receipts.push(receipt);};
  try {
    const ap=next(0),bp=next(1),cp=next(2);await new Promise(resolve=>setTimeout(resolve,150));
    const increasedAllocations=booking.agent_allocations.map((allocation:Record<string,unknown>)=>({...allocation,binder_amount:String(allocation.agent)===scopes[1]!.agent_id?60:50.01}));
    remember(await commitPhase1EntityMutation('BookedLead',booking._id,{total_binder_amount:110.01,agent_allocations:increasedAllocations}));
    await verify(ap,0);await verify(bp,1);

    const afterRollback=next(0),beforeRollback=await db.collection('booked_leads').findOne({_id:booking._id});assert.ok(beforeRollback);
    const countBeforeRollback=await db.collection('entity_changes').countDocuments({});
    const rollback=await mongoose.startSession();rollback.startTransaction();
    const aborted=await writePhase1EntityMutation(rollback,'BookedLead',booking._id,{book_date:new Date('2026-10-14T00:00:00Z')});assert.ok(aborted);
    await rollback.abortTransaction();await rollback.endSession();
    assert.equal((await db.collection('booked_leads').findOne({_id:booking._id}))?.domain_revision,beforeRollback.domain_revision);
    assert.equal(await db.collection('entity_changes').countDocuments({}),countBeforeRollback);
    assert.equal(await Promise.race([afterRollback.then(()=>true),new Promise<false>(resolve=>setTimeout(()=>resolve(false),350))]),false,'aborted aggregate/receipt emits no hint');

    const assignmentB=next(1);
    remember(await commitPhase1EntityMutation('FormLead',lead._id,{receiver_agent:new mongoose.Types.ObjectId(scopes[1]!.agent_id)}));
    await verify(afterRollback,0);await verify(assignmentB,1);
    const cancellationA=next(0),cancellationB=next(1);
    remember(await commitPhase1EntityMutation('CancelledLead',cancellationId,{lead_ref:cancelledBooking.lead_ref,lead_model:'FormLead'}));
    await verify(cp,2);await verify(cancellationA,0);await verify(cancellationB,1);

    const allocated=[next(0),next(1),next(2)];
    remember(await commitPhase1EntityMutation('BookedLead',booking._id,{agent_allocations:[{agent:new mongoose.Types.ObjectId(scopes[2]!.agent_id),agent_name_snapshot:'Pilot Rep Casey',binder_amount:110.01}]}));
    await Promise.all(allocated.map(verify));
    const restored=[next(0),next(1),next(2)];remember(await commitPhase1EntityMutation('BookedLead',booking._id,bookingRestore));await Promise.all(restored.map(verify));
    const assignmentRestored=[next(0),next(1)];remember(await commitPhase1EntityMutation('FormLead',lead._id,assignmentRestore));await Promise.all(assignmentRestored.map(verify));
    const cancellationRestored=[next(0),next(1),next(2)];remember(await commitPhase1EntityMutation('CancelledLead',cancellationId,cancellationRestore));await Promise.all(cancellationRestored.map(verify));

    for(const receipt of receipts)assert.equal(receipt.revision_after,receipt.revision_before+1);
    const latest=await db.collection('entity_changes').findOne({'entity.model':'BookedLead','entity.id':booking._id.toHexString()},{sort:{revision_after:-1}});assert.ok(latest);
    await assert.rejects(db.collection('entity_changes').insertOne({...latest,_id:new mongoose.Types.ObjectId(),command_execution_id:new mongoose.Types.ObjectId()}),error=>Boolean(error&&typeof error==='object'&&'code' in error&&error.code===11000),'unique entity/revision index rejects duplicate receipt');
    assert.equal((await db.collection('booked_leads').findOne({_id:booking._id}))?.domain_revision,latest.revision_after);
    console.log(JSON.stringify({database,proof:'passed',indexes,receipts,checks:['committed binder update reaches allocation and current assignment reps','foreign rep isolation','aborted aggregate plus EntityChange emits no hint and revision stays unchanged','actual assignment before/after both refresh','allocation before/after plus distinct current assignment all refresh','actual cancellation mutation own-scope broadcast','ids-only projection and topic','aggregate revisions advance with unique validated receipts','duplicate entity revision rejected with 11000'],restored_total:booking.total_binder_amount},null,2));
  } finally {
    await commitPhase1EntityMutation('BookedLead',booking._id,bookingRestore);
    await commitPhase1EntityMutation('FormLead',lead._id,assignmentRestore);
    await commitPhase1EntityMutation('CancelledLead',cancellationId,cancellationRestore);
    await Promise.all(streams.map(s=>s.close()));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>mongoose.disconnect());
