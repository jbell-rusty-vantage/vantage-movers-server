/** Synthetic CSI-08 fixtures and HTTP checks. Requires the existing guarded local preview. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

async function main() {
 const local=JSON.parse(await readFile(join(tmpdir(),'vantage-csi07-local/session.json'),'utf8'));
 assert.equal(local.env.MONGO_URI,'mongodb://127.0.0.1:27189/?replicaSet=csi01');
 assert.equal(local.env.TEST_MONGO_DATABASE_NAME,'testvantagemovers_csi07preview');
 assert.equal(local.env.TEST_MODE,'true');
 Object.assign(process.env,local.env);
 const mongoose=(await import('mongoose')).default;
 const {connectMongo,withTransaction}=await import('../src/db.js');
 const {getMongoDatabaseName}=await import('../src/config/domain/runtime.js');
 assert.equal(getMongoDatabaseName(),'testvantagemovers_csi07preview');
 if(process.argv[2]==='manual-attachment-regression') {
  await connectMongo();
  const {getContactNumberModel}=await import('../src/models/ContactNumber.js');
  const {commandAttachment}=await import('../src/services/salesIntelligence/attachment/commands.js');
  const number=await getContactNumberModel().findById('000000000000000000000713').lean();assert.ok(number);
  const express=(await import('express')).default;
  const {requireCsiOwner}=await import('../src/services/salesIntelligence/auth.js');
  const {computeAdminActorSignature}=await import('../src/services/operationsRegistry/trustedActor.js');
  const request=Object.assign(Object.create(express.request),{method:'POST',originalUrl:'/api/v1/admin/sales-intelligence/attachments/attach',headers:{},vantageAuth:{kind:'user',userId:'synthetic-owner',email:'owner@example.test',roles:['owner']}});
  const fields={adminId:'synthetic-owner',email:'owner@example.test',role:'owner',timestamp:String(Date.now()),requestId:'csi08-manual-proof',method:request.method,path:request.originalUrl};
  request.headers={'x-vantage-admin-user-id':fields.adminId,'x-vantage-admin-email':fields.email,'x-vantage-admin-role':fields.role,'x-vantage-admin-timestamp':fields.timestamp,'x-vantage-admin-request-id':fields.requestId,'x-vantage-admin-signature':computeAdminActorSignature(fields,process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!)};
  const result=await commandAttachment({actor:requireCsiOwner(request),idempotency_key:randomUUID(),command:{command:'attach_lead',expected_revision:number.revision,contact_number_id:String(number._id),lead_ref:{model:'FormLead',id:'000000000000000000001004'},reason:'Synthetic absent-pair regression'}});
  assert.equal(result.response.state,'attached');await mongoose.disconnect();console.log('PASS: absent-pair attachment persists.');return;
 }
 if(process.argv[2]==='expire-attention') {
  const url=new URL((await readFile('docs/call-sales-intelligence/workspace/evidence/csi-08/attention-pagination-url.txt','utf8')).trim());
  assert.equal(url.origin,'http://127.0.0.1:3108');assert.equal(url.pathname,'/sales-intelligence');
  const cursor=JSON.parse(Buffer.from(url.searchParams.get('attention_cursor')!,'base64url').toString());assert.ok(String(cursor.snapshot_id).startsWith('outreach:'));
  await connectMongo();const {getSalesIntelligenceAttentionSnapshotModel}=await import('../src/models/SalesIntelligenceAttentionSnapshot.js');
  // Test-only fault injection in the explicitly guarded preview database; runtime snapshots remain append-only.
  const result=await getSalesIntelligenceAttentionSnapshotModel().collection.updateOne({snapshot_id:cursor.snapshot_id},{$set:{expires_at:new Date(0)}});assert.equal(result.matchedCount,1);
  await mongoose.disconnect();console.log('PASS: only the selected synthetic Attention snapshot was expired for browser recovery proof.');return;
 }
 if(process.argv[2]==='lead-identity-regression') {
  await connectMongo();
  const {getSalesIntelligenceReviewItemModel}=await import('../src/models/SalesIntelligenceReviewItem.js');
  if(!await getSalesIntelligenceReviewItemModel().exists({cause_key:'csi08-lead-identity'}))await getSalesIntelligenceReviewItemModel().create({subject_key:'lead:FormLead:000000000000000000001004',cause_kind:'identity',cause_key:'csi08-lead-identity',opened_at:new Date()});
  await mongoose.disconnect();
 }
 if(['seed','clock-regression'].includes(process.argv[2])) {
  await connectMongo();const db=mongoose.connection.useDb(getMongoDatabaseName(),{useCache:true}).db!;
  assert.equal((await db.admin().command({hello:1})).setName,'csi01');
  const {getContactNumberModel}=await import('../src/models/ContactNumber.js');
  const {getOutreachRecordModel}=await import('../src/models/OutreachRecord.js');
  const {getSalesIntelligenceReviewItemModel}=await import('../src/models/SalesIntelligenceReviewItem.js');
  const {getRingCentralDirectorySnapshotModel}=await import('../src/models/RingCentralDirectorySnapshot.js');
  const {getRepIdentityLinkModel}=await import('../src/models/RepIdentityLink.js');
  const {persistLeadAttachments}=await import('../src/services/salesIntelligence/attachment/store.js');
  const {ensureLead,workerContext}=await import('../src/services/salesIntelligence/outreach/ensure.js');
  const {publishAttentionSnapshot}=await import('../src/services/salesIntelligence/outreach/attention.js');
  const {defaultCsiPolicy}=await import('../src/services/salesIntelligence/policy.js');
  const oid=(value:string)=>new mongoose.Types.ObjectId(value.padStart(24,'0')),now=new Date();
  const numbers=getContactNumberModel(),records=getOutreachRecordModel();
  if(process.argv[2]==='clock-regression') {
   const {getOutreachFollowupModel}=await import('../src/models/OutreachFollowup.js');
   const {refreshRecord}=await import('../src/services/salesIntelligence/outreach/store.js');
   const recordId=new mongoose.Types.ObjectId(),numberId=new mongoose.Types.ObjectId();
   await records.create({_id:recordId,subject:{kind:'number_review',contact_number_id:numberId},state:'waiting_on_customer',trigger_kind:'owner_open',trigger_at:now,policy_version:defaultCsiPolicy().version});
   const action=await getOutreachFollowupModel().create({outreach_record_id:recordId,commitment_key:`csi08-clock:${recordId}`,kind:'wait',description:'Synthetic clock regression',origin:'owner',due_at:now,base_attention_due_at:now});
   const tick=async(at:Date)=>withTransaction(async session=>{const row=await records.findById(recordId).session(session);assert.ok(row);await refreshRecord(row,workerContext(session,String(new mongoose.Types.ObjectId()),at),'clock_boundary',row.toObject());});
   await tick(new Date(+now-60000));
   const before=await records.findById(recordId).lean();assert.ok(before);
   await tick(new Date(+now-30000));
   assert.equal((await records.findById(recordId).lean())?.revision,before.revision);
   await tick(new Date(+now+1000));
   const after=await records.findById(recordId).lean();assert.ok(after);assert.equal(after.revision,before.revision+1);assert.equal(after.state,'open');
   const expired=await getOutreachFollowupModel().findById(action._id).lean();assert.ok(expired?.wait_expired_at);assert.equal(expired.revision,action.revision+1);
   await tick(new Date(+now+2000));assert.equal((await records.findById(recordId).lean())?.revision,after.revision);
   await getOutreachFollowupModel().deleteOne({_id:action._id});await records.deleteOne({_id:recordId});
   await mongoose.disconnect();console.log('PASS: idle clock scans preserve revisions; actual wait expiry updates action and aggregate once.');return;
  }
  // Remove only this runner's legacy clock fixtures, which intentionally have no Number.
  const {getOutreachFollowupModel}=await import('../src/models/OutreachFollowup.js');
  for(const action of await getOutreachFollowupModel().find({description:'Synthetic clock regression'}).lean()) {
   const row=await records.findById(action.outreach_record_id).lean();
   if(row?.subject.kind==='number_review'&&!await numbers.exists({_id:row.subject.contact_number_id})) {
    await getOutreachFollowupModel().deleteOne({_id:action._id});await records.deleteOne({_id:row._id});
   }
  }
  for(let i=40;i<94;i++) {
   const id=oid(`8${i}`),e164=`+120255501${i}`;
   if(await numbers.exists({_id:id}))continue;
   await numbers.create({_id:id,e164,digits_reversed:e164.slice(1).split('').reverse().join(''),provider_names:[`Synthetic pagination ${i}`],search_terms:[`synthetic pagination ${i}`],first_observed_at:now,last_activity_at:now,contact_eligibility:{state:'allowed'}});
   await records.create({_id:oid(`9${i}`),subject:{kind:'number_review',contact_number_id:id},primary_contact_number_id:id,state:'open',trigger_kind:'owner_open',trigger_at:now,policy_version:defaultCsiPolicy().version});
  }
  const numberId=oid('804'),leadId=oid('1004');
  if(!await numbers.exists({_id:numberId})) {
   const phone='+12025550104';await numbers.create({_id:numberId,e164:phone,digits_reversed:phone.slice(1).split('').reverse().join(''),provider_names:['Morgan (synthetic)'],search_terms:['morgan synthetic'],first_observed_at:now,last_activity_at:now,contact_eligibility:{state:'allowed'}});
   const lead={_id:leadId,timestamp:now,createdAt:now,updatedAt:now,name:'Morgan (synthetic)',phone_number:phone,normalized_phone_number:phone,job_no:'CSI08-MORGAN',source_company_label_snapshot:'Synthetic source',ingested_contact_snapshot:{normalized_phone_number:phone,captured_at:now}};
   await db.collection('form_leads').insertOne(lead);
   await withTransaction(async session=>{await ensureLead({model:'FormLead',id:String(leadId)},workerContext(session,String(oid('4004')),now),String(numberId));await persistLeadAttachments(lead,'FormLead',session,String(oid('4005')),now);});
  }
  if(!await getSalesIntelligenceReviewItemModel().exists({cause_key:'csi08-review-only'}))await getSalesIntelligenceReviewItemModel().create({subject_key:`lead:FormLead:${oid('1005')}`,cause_kind:'official_mismatch',cause_key:'csi08-review-only',opened_at:now});
  {
   const phone='+12025550106',leadId=oid('1006'),bookingId=oid('2006'),cancellationId=oid('3006');
   if(!await numbers.exists({_id:oid('806')}))await numbers.create({_id:oid('806'),e164:phone,digits_reversed:phone.slice(1).split('').reverse().join(''),provider_names:['Taylor (synthetic)'],search_terms:['taylor synthetic'],first_observed_at:now,last_activity_at:now,contact_eligibility:{state:'allowed'}});
   const lead={_id:leadId,timestamp:now,createdAt:now,updatedAt:now,name:'Taylor (synthetic)',phone_number:phone,normalized_phone_number:phone,job_no:'CSI08-TAYLOR',source_company_label_snapshot:'Synthetic source',booked:bookingId,cancelled:cancellationId,ingested_contact_snapshot:{normalized_phone_number:phone,captured_at:now}};
   if(!await db.collection('form_leads').findOne({_id:leadId}))await db.collection('form_leads').insertOne(lead);
   const {BookedLead}=await import('../src/models/BookedLead.js');const {CancelledLead}=await import('../src/models/CancelledLead.js');
   const fixtureDb=mongoose.connection.useDb(getMongoDatabaseName(),{useCache:true});const Booking=fixtureDb.model('BookedLead',BookedLead.schema),Cancellation=fixtureDb.model('CancelledLead',CancelledLead.schema);
   if(!await Booking.exists({_id:bookingId}))await Booking.create({_id:bookingId,book_date:now,lead_model:'FormLead',lead_ref:leadId,customer_name:'Taylor (synthetic)',job_no:'CSI08-TAYLOR',agent_allocations:[{agent:oid('701'),agent_name_snapshot:'Alex (synthetic)',binder_amount:0}],total_binder_amount:0,deposit_amount:0,merchant:'Synthetic merchant',source:'Synthetic source',cancelled:cancellationId});
   if(!await Cancellation.exists({_id:cancellationId}))await Cancellation.create({_id:cancellationId,booked_lead:bookingId,lead_model:'FormLead',lead_ref:leadId,customer_name:'Taylor (synthetic)',job_no:'CSI08-TAYLOR',book_date:now,cancel_date:now,refund_amount:0,reason:'Synthetic destination proof',merchant:'Synthetic merchant',source:'Synthetic source'});
   if(!await records.exists({'subject.model':'FormLead','subject.id':leadId}))await records.create({_id:oid('906'),subject:{kind:'lead',model:'FormLead',id:leadId},primary_contact_number_id:oid('806'),state:'closed',closed_reason:'booked',closure_origin:'official',closed_at:now,trigger_kind:'lead_arrival',trigger_at:now,policy_version:defaultCsiPolicy().version});
   await withTransaction(async session=>{await persistLeadAttachments(lead,'FormLead',session,String(oid('4006')),now);});
   const {getSalesIntelligenceContactRestrictionModel}=await import('../src/models/SalesIntelligenceContactRestriction.js');
   if(!await getSalesIntelligenceContactRestrictionModel().exists({_id:oid('5006')}))await getSalesIntelligenceContactRestrictionModel().create({_id:oid('5006'),contact_number_id:oid('806'),channels:['call'],until:null,origin:'owner',actor:{kind:'owner',id:'local-owner',request_id:'csi08-local-seed'}});
   if(!await getSalesIntelligenceReviewItemModel().exists({cause_key:String(oid('5006'))}))await getSalesIntelligenceReviewItemModel().create({subject_key:`number:${oid('806')}`,cause_kind:'restriction',cause_key:String(oid('5006')),opened_at:now});
  }
  for(const [id,name] of [['701','Alex (synthetic)'],['702','Jordan (synthetic)'],['703','Casey (synthetic)']])await db.collection('agents').updateOne({_id:oid(id)},{$set:{name,normalized_name:name.toLowerCase(),active:true}},{upsert:true});
  if(!await db.collection('call_leads').findOne({_id:oid('1007')})) {
   const phone='+12025550107',lead={_id:oid('1007'),timestamp:now,createdAt:now,updatedAt:now,name:'Riley (synthetic)',phone_number:phone,normalized_phone_number:phone,job_no:'CSI08-RILEY',source_company_label_snapshot:'Synthetic source',ingested_contact_snapshot:{normalized_phone_number:phone,captured_at:now}};
   await db.collection('call_leads').insertOne(lead);
   await numbers.create({_id:oid('807'),e164:phone,digits_reversed:phone.slice(1).split('').reverse().join(''),provider_names:['Riley (synthetic)'],search_terms:['riley synthetic'],first_observed_at:now,last_activity_at:now,contact_eligibility:{state:'allowed'}});
   await withTransaction(async session=>{await ensureLead({model:'CallLead',id:String(lead._id)},workerContext(session,String(oid('4007')),now),String(oid('807')));await persistLeadAttachments(lead,'CallLead',session,String(oid('4008')),now);});
  }
  if(!await getRingCentralDirectorySnapshotModel().exists({provider_account_id:'csi08-synthetic'}))await getRingCentralDirectorySnapshotModel().create({_id:oid('6001'),provider_account_id:'csi08-synthetic',taken_at:now,digest:'csi08-synthetic-v1',extensions:[{id:'101',extension_number:'101',type:'User',name:'Alex (synthetic)',status:'Enabled',direct_numbers:[],sms_sender_numbers:[]}],counts:{extensions:1,users:1}});
  if(!await getRepIdentityLinkModel().exists({_id:oid('6101')}))await getRepIdentityLinkModel().create({_id:oid('6101'),agent_id:oid('701'),agent_name_snapshot:'Alex (synthetic)',rc_account_id:'csi08-synthetic',rc_extension_id:'101',rc_extension_name_snapshot:'Alex (synthetic)',role_kind:'sales_rep',status:'proposed',effective_from:now,nudge_channels_allowed:[]});
  const {getCallInteractionModel}=await import('../src/models/CallInteraction.js');
  for(const [id,type] of [['7007','unknown'],['7008','voicemail']] as const)if(!await getCallInteractionModel().exists({_id:oid(id)}))await getCallInteractionModel().create({_id:oid(id),provider_account_id:'csi08-synthetic',telephony_session_id:`csi08-${id}`,identity_basis:'telephony_session_id',direction:'Inbound',contact_number_id:oid('806'),external_e164:'+12025550106',started_at:new Date(+now-(type==='voicemail'?60000:120000)),first_observed_at:now,last_observed_at:now,provider_result:type==='voicemail'?'Voicemail':'Call connected',provider_connected:true,contact_type:type});
  const projection=await publishAttentionSnapshot();assert.equal(projection.status,'published');
  await mongoose.disconnect();console.log('PASS: synthetic CSI-08 pagination, attachment, review-only and Rep fixtures persisted in the guarded preview DB.');return;
 }
 const base='http://127.0.0.1:3108',prefix='/api/proxy/api/v1/admin/sales-intelligence';
 const login=async(role:string)=>{const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${role}@csi07.example.test`,password:local.password})});assert.equal(response.status,200);return response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');};
 const cookie=await login('owner');
 const read=async(path:string)=>{const response=await fetch(base+prefix+path,{headers:{cookie}});assert.equal(response.status,200,`${path}: ${response.status}`);return response.json();};
 const send=async(path:string,body:object,key=randomUUID(),method='POST')=>{const response=await fetch(base+prefix+path,{method,headers:{cookie,'content-type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const recordId='000000000000000000000721';
 const record=(await read(`/outreach/${recordId}?scope=production`)).data.outreach;
 if(process.argv[2]==='clock-ui') {
  const result=await send('/followups',{command:'create_followup',outreach_record_id:recordId,expected_revision:record.revision,action:{kind:'review',description:'Synthetic CSI-08 clock refresh',due_at:new Date(Date.now()+45000).toISOString(),responsible_agent_id:null}});
  assert.equal(result.status,200);console.log('PASS: real BFF created a follow-up due 45 seconds ahead for clock-only UI proof.');return;
 }
 if(process.argv[2]==='lead-identity-regression') {
  const reviews=await read('/review-items?subject_key=lead:FormLead:000000000000000000001004');
  const review=reviews.data.items.find((item:{cause_key:string})=>item.cause_key==='csi08-lead-identity');assert.ok(review);
  const result=await send(`/review-items/${review.id}/resolve`,{command:'resolve_review',expected_revision:review.revision,resolution:'no_action',completed_command_id:null,reason:'Synthetic Lead identity ambiguity has been removed.'});
  assert.equal(result.status,200,`Unblocked Lead identity review rejected: ${result.body.code??result.body.registry_code}`);console.log('PASS: Lead-scoped identity review resolves after attachment blockers are gone.');return;
 }
 if(process.argv[2]==='note-regression') {
  const created=await send(`/followups`,{command:'create_followup',outreach_record_id:recordId,expected_revision:record.revision,action:{kind:'review',description:'Synthetic completion note regression',due_at:null,responsible_agent_id:null}});assert.equal(created.status,200);
  const current=(await read(`/outreach/${recordId}`)).data.outreach;
  const action=current.followups.find((item:{description:string;status:string})=>item.description==='Synthetic completion note regression'&&item.status==='open');assert.ok(action);
  const note=`Synthetic completion context ${randomUUID()}`;
  const completed=await send(`/followups/${action.id}/complete`,{command:'complete_followup',expected_revision:action.revision,expected_revisions:[{target:'outreach',id:recordId,revision:current.revision}],disposition:'completed',note});assert.equal(completed.status,200);
  const timeline=await read('/numbers/000000000000000000000711/timeline?limit=100');
  assert.ok(timeline.data.items.some((event:{detail:{current?:{note?:string}}})=>event.detail.current?.note===note),'Completion note is missing from Number Activity');
  console.log('PASS: completion note is retained in real Number Activity.');return;
 }
 if(process.argv[2]==='idle-revision') {
  await new Promise(resolve=>setTimeout(resolve,12000));
  const after=(await read(`/outreach/${recordId}?scope=production`)).data.outreach;
  console.log(JSON.stringify({before:record.revision,after:after.revision,changedFields:Object.keys(record).filter(key=>JSON.stringify(record[key])!==JSON.stringify(after[key]))}));
  assert.equal(after.revision,record.revision,'Idle worker changed Outreach revision');return;
 }
 if(process.argv[2]==='change') {
  const result=await send(`/outreach/${recordId}/commands`,{command:'add_note',expected_revision:record.revision,text:'Synthetic concurrent CSI-08 update'});assert.equal(result.status,200);console.log('PASS: concurrent real BFF note applied for draft/conflict proof.');return;
 }
 assert.ok(record.allowed_actions.some((a:{action:string})=>a.action==='create_followup'));
 const first=await read('/attention?limit=2&scope=production');assert.ok(first.data.cursor);
 const second=await read(`/attention?limit=2&scope=production&cursor=${encodeURIComponent(first.data.cursor)}`);assert.equal(first.data.snapshot_id,second.data.snapshot_id);
 assert.equal(new Set([...first.data.items,...second.data.items].map((r:{subject_key:string})=>r.subject_key)).size,4);
 const search=await read('/numbers?q=0104&scope=production');assert.equal(search.data.items[0].e164,'+12025550104');
 const attachments=await read('/attachments?contact_number_id=000000000000000000000804');assert.ok(attachments.data.items[0].allowed_actions.some((a:{enabled:boolean})=>a.enabled));
 const review=await read('/review-items?subject_key=lead:FormLead:000000000000000000001005');assert.equal(review.data.items.length,1);
 const key=randomUUID(),body={command:'add_note',expected_revision:record.revision,text:'Synthetic CSI-08 durable retry proof'};
 const firstWrite=await send(`/outreach/${recordId}/commands`,body,key),retry=await send(`/outreach/${recordId}/commands`,body,key);assert.equal(firstWrite.status,200);assert.equal(retry.body.data.replayed,true);assert.deepEqual(firstWrite.body.data.response,retry.body.data.response);
 assert.equal((await send(`/outreach/${recordId}/commands`,{...body,text:'Changed payload'},key)).status,409);
 const stale=await send(`/outreach/${recordId}/commands`,body);assert.equal(stale.body.code??stale.body.registry_code,'REVISION_CONFLICT');
 const admin=await login('admin');assert.equal((await fetch(base+prefix+'/numbers',{headers:{cookie:admin}})).status,403);
 assert.equal((await fetch(base+prefix+'/attention?scope=historical',{headers:{cookie}})).status,403);
 console.log('PASS real BFF/API: immutable Attention pagination, number suffix search, attachment availability, targeted review, durable replay/payload conflict, revision conflict, Admin and historical-scope denial.');
}
main().catch(async error=>{console.error(error instanceof Error?error.message:'CSI-08 proof failed');process.exitCode=1;await (await import('mongoose')).default.disconnect();});




