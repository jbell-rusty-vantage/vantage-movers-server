/** Local-only presentation fixtures, applied after pilot enrollment/evaluation. No provider calls. */
import { database } from './env';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
async function main(){
  const {connectMongo}=await import('../../src/db.js');
  await connectMongo();assert.equal(mongoose.connection.name,database);assert.equal(mongoose.connection.host,'127.0.0.1');
  const db=mongoose.connection.db!;
  const fixtures=[{job:'JOB-2001',move:'2026-10-13',last:new Date(Date.now()-120_000)},{job:'JOB-2004',move:'2026-10-12',last:new Date(Date.now()-2*86_400_000)},{job:'JOB-2007',move:null,last:null}];
  for(const f of fixtures){
    const lead=await db.collection('form_leads').findOne({job_no:f.job});assert.ok(lead);
    await db.collection('form_leads').updateOne({_id:lead._id},{$set:{move_date:f.move?new Date(`${f.move}T00:00:00Z`):null}});
    const subject=await db.collection('sales_outreach_subjects').findOne({lead_id:lead._id});assert.ok(subject);
    await db.collection('sales_outreach_subjects').updateOne({_id:subject._id},{$set:{'display.move_date':f.move}});
    await db.collection('sales_outreach_projections').updateOne({subject_id:subject._id},{$set:{'display.move_date':f.move,last_interaction_at:f.last,'queue_keys.last_interaction':f.last??new Date(0),'status_flags.move_date_passed':f.move==='2026-10-12','status_flags.move_date_unknown':f.move===null}});
  }
  console.log(JSON.stringify({database,fixtures,synthetic_projection_interactions:true},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>mongoose.disconnect());
