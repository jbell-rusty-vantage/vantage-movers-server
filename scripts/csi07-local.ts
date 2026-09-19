/** Local-only preview seed/runtime. Never loads .env. Launch via Admin scripts/csi07-local.mjs. */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectMongo } from '../src/db';
import { getMongoDatabaseName } from '../src/config/domain/runtime';
import { applyCsiMigration } from './migrations/sales-intelligence.lib';
import { getContactNumberModel } from '../src/models/ContactNumber';
import { getOutreachRecordModel } from '../src/models/OutreachRecord';
import { getOutreachFollowupModel } from '../src/models/OutreachFollowup';
import { runOutreachEnsureOnce } from '../src/services/salesIntelligence/outreach/worker';
import { defaultCsiPolicy } from '../src/services/salesIntelligence/policy';
import app from '../src/app';

async function main() {
 assert.equal(process.env.MONGO_URI,'mongodb://127.0.0.1:27189/?replicaSet=csi01');
 assert.equal(getMongoDatabaseName(),'testvantagemovers_csi07preview');
 assert.equal(process.env.TEST_MODE,'true');
 await connectMongo();
 const db=mongoose.connection.useDb(getMongoDatabaseName(),{useCache:true}).db!;
 assert.equal((await db.admin().command({hello:1})).setName,'csi01');
 await applyCsiMigration(); // Only guarded disposable local dataset, no operational migration.
 const now=new Date(),oid=(n:string)=>new mongoose.Types.ObjectId(n.padStart(24,'0'));
 const alex=oid('701'),jordan=oid('702');
 for(const [id,name] of [[alex,'Alex (synthetic)'],[jordan,'Jordan (synthetic)']] as const) await db.collection('agents').updateOne({_id:id},{$set:{name,normalized_name:name.toLowerCase()}},{upsert:true});
 const numbers=getContactNumberModel(),records=getOutreachRecordModel(),actions=getOutreachFollowupModel();
 for(let i=1;i<=3;i++) {
  const id=oid(String(710+i)),recordId=oid(String(720+i));
  if(await numbers.exists({_id:id})) continue;
  const phone=`+1202555010${i}`;
  await numbers.create({_id:id,e164:phone,digits_reversed:phone.replace('+','').split('').reverse().join(''),first_observed_at:now,last_activity_at:now,classification:'customer',contact_eligibility:{state:'allowed'}});
  await records.create({_id:recordId,subject:{kind:'number_review',contact_number_id:id},primary_contact_number_id:id,state:i===3?'unworked':'open',trigger_kind:'owner_open',trigger_at:now,
    policy_version:defaultCsiPolicy().version,responsible_agent_id:alex,assignment:{origin:'owner',assigned_at:now,actor_id:'local-owner'}});
  if(i<3) for(let a=0;a<2;a++) await actions.create({outreach_record_id:recordId,commitment_key:`csi07:${i}:${a}`,kind:a?'send_estimate':'call',description:a?'Prepare moving estimate (synthetic)':'Return the customer’s call (synthetic)',
    origin:a?'owner':'rep_promise',due_at:a?null:new Date(+now+(i===1?-60000:120000)),base_attention_due_at:a?null:new Date(+now+(i===1?-60000:120000)),
    responsible_agent_id:a?null:jordan,promised_by_agent_id:a?null:jordan,assignment:a?null:{origin:'rep_promise',assigned_at:now}});
 }
 await runOutreachEnsureOnce();
 const server=app.listen(3107,'127.0.0.1',()=>console.log('CSI-07 API http://127.0.0.1:3107 — isolated replica, providers disabled'));
 let stopped=false,timer:ReturnType<typeof setTimeout>;
 async function recover() { try { await runOutreachEnsureOnce(); } catch(error) { console.error('Local Outreach recovery failed:',error instanceof Error?error.name:'Error'); } finally { if(!stopped) timer=setTimeout(()=>void recover(),5000); } }
 timer=setTimeout(()=>void recover(),5000);
 const stop=()=>{stopped=true;clearTimeout(timer);server.close();void mongoose.disconnect();};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
main().catch(error=>{ console.error(error instanceof Error?error.message:'Local preview failed');process.exitCode=1;void mongoose.disconnect(); });


