/** Shared synthetic mutation seam: real aggregate CAS + validated immutable EntityChange in one transaction. */
import { database } from './env';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import mongoose from 'mongoose';

export type Phase1Model = 'BookedLead' | 'FormLead' | 'CancelledLead';
const collections: Record<Phase1Model,string>={BookedLead:'booked_leads',FormLead:'form_leads',CancelledLead:'cancelled_leads'};
function localDb(){
  assert.equal(mongoose.connection.host,'127.0.0.1');assert.equal(mongoose.connection.name,database);
  return mongoose.connection.db!;
}
export async function ensurePhase1EntityChangeIndexes(){
  localDb();
  const {getEntityChangeModel,ENTITY_CHANGE_INDEXES}=await import('../../src/models/EntityChange.js');
  const Model=getEntityChangeModel();await Model.createIndexes();
  const observed=await Model.collection.indexes();
  for(const declared of ENTITY_CHANGE_INDEXES){
    const index=observed.find(value=>value.name===declared.name);assert.ok(index);
    assert.deepEqual(index.key,declared.key);
    if('unique' in declared)assert.equal(index.unique,true);
  }
  return observed.map(index=>({name:index.name,key:index.key,unique:index.unique??false}));
}

export async function writePhase1EntityMutation(
  session: mongoose.ClientSession, model: Phase1Model, id: mongoose.Types.ObjectId,
  changes: Record<string,unknown> | ((before: Record<string,unknown>)=>Record<string,unknown>),
  commandName='local-synthetic-proof',
){
  const db=localDb(),collection=db.collection(collections[model]);
  const before=await collection.findOne({_id:id},{session});assert.ok(before);
  assert.ok(typeof before.job_no==='string'&&before.job_no.startsWith('PHASE1-'),'mutation requires a Phase1 synthetic aggregate');
  const set=typeof changes==='function'?changes(before):changes;
  const paths=Object.keys(set).filter(path=>!isDeepStrictEqual(before[path],set[path])).sort();
  if(!paths.length)return null;
  const revision=before.domain_revision??0;assert.ok(Number.isSafeInteger(revision)&&revision>=0);
  const {getEntityChangeModel}=await import('../../src/models/EntityChange.js');
  const changeId=new mongoose.Types.ObjectId(),now=new Date(),requestId=randomUUID();
  const actor={actor_type:'system' as const,actor_id:'phase1-local-proof',actor_label:'Synthetic local proof',actor_role:'system' as const,request_id:requestId,origin:'granot_lifecycle' as const};
  const receipt={_id:changeId,entity:{model,id:id.toHexString()},command_execution_id:new mongoose.Types.ObjectId(),command_name:commandName,
    provenance:{source_system:'vantage' as const,actor,initiator:actor,request_id:requestId},
    changed_paths:paths,fields:paths.map(path=>({path,value_mode:'stored' as const,before:before[path],after:set[path]})),
    revision_before:revision,revision_after:revision+1,applied_at:now};
  const filter=before.domain_revision===undefined?{_id:id,domain_revision:{$exists:false}}:{_id:id,domain_revision:revision};
  const updated=await collection.updateOne(filter,{$set:{...set,domain_revision:revision+1,last_change_id:changeId,last_changed_at:now,...(before.change_history_started_at?{}:{change_history_started_at:now})}},{session});
  assert.equal(updated.matchedCount,1,'aggregate revision CAS');
  await getEntityChangeModel().create([receipt],{session});
  return receipt;
}

export async function commitPhase1EntityMutation(model:Phase1Model,id:mongoose.Types.ObjectId,changes:Parameters<typeof writePhase1EntityMutation>[3],commandName?:string){
  const session=await mongoose.startSession();
  try{return await session.withTransaction(()=>writePhase1EntityMutation(session,model,id,changes,commandName));}
  finally{await session.endSession();}
}
