/** Guarded local-only EntityChange index install; optional cleanup deletes only old synthetic proof receipts. */
import {database} from './env';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {ensurePhase1EntityChangeIndexes} from './phase1-entity-changes';
async function main(){
  const {connectMongo}=await import('../../src/db.js');await connectMongo();
  assert.equal(mongoose.connection.host,'127.0.0.1');assert.equal(mongoose.connection.name,database);
  let deletedLegacyReceipts=0;
  if(process.argv.includes('--reset-legacy-proof-receipts')){
    assert.equal(database,'testvantagemovers_phase1','legacy cleanup restricted to the named disposable proof database');
    const result=await mongoose.connection.db!.collection('entity_changes').deleteMany({command_name:{$in:['local-browser-proof','local-synthetic-proof']},$or:[{'provenance.actor':{$exists:false}},{'provenance.initiator':{$exists:false}}]});
    deletedLegacyReceipts=result.deletedCount;
  }
  const indexes=await ensurePhase1EntityChangeIndexes();
  console.log(JSON.stringify({database,deleted_legacy_synthetic_receipts:deletedLegacyReceipts,indexes},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>mongoose.disconnect());
