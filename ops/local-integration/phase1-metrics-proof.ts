/** Local-only synthetic metric fixtures and real-Mongo proof. Run after the pilot seed/policy install.
 * node --import tsx ops/local-integration/phase1-metrics-proof.ts --database=testvantagemovers_phase1
 * Re-run with --verify-only to read the fixture without inserting it again.
 */
import { database } from './env';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';

export const REP_A = 'd9e98cc15237c848c5c8732b';
export const REP_B = '360f2f6456d420c391c73535';
const oid = (key: string) => new mongoose.Types.ObjectId(createHash('sha256').update(`phase1-proof:${key}`).digest('hex').slice(0,24));
const at = new Date('2026-10-14T01:00:00Z');

async function main() {
  const { connectMongo } = await import('../../src/db.js');
  const { readRepMetrics } = await import('../../src/services/salesOutreach/reads/repMetrics.js');
  const { createConfigurationLoader } = await import('../../src/services/salesOutreach/config/load.js');
  const { csiOperatorActor } = await import('../../src/services/salesIntelligence/auth.js');
  const { BookedLead } = await import('../../src/models/BookedLead.js');
  await connectMongo();
  assert.equal(mongoose.connection.host, '127.0.0.1');
  assert.equal(mongoose.connection.name, database);
  const db = mongoose.connection.db!;
  const agent = new mongoose.Types.ObjectId(REP_A), other = new mongoose.Types.ObjectId(REP_B);
  const actor = {role:'owner' as const, agent_id:null, actor:csiOperatorActor('phase1-local-proof')};
  const loader = createConfigurationLoader();
  const read = (now = at) => readRepMetrics(actor, {agent_id:REP_A}, {loader,now});
  if (!process.argv.includes('--verify-only')) {
    assert.equal(await db.collection('form_leads').countDocuments({_id:oid('lead:today')}), 0, 'fixtures already exist; use --verify-only');
    const cases = [
      {key:'today',date:'2026-10-13',total:100.01,own:50.01},
      {key:'week',date:'2026-10-05',total:200,own:75},
      {key:'month',date:'2026-09-30',total:300,own:125},
      {key:'ancient',date:'1999-01-01',total:400,own:200},
      {key:'cancelled',date:'2026-10-13',total:50,own:25,cancelled:true},
      {key:'zero',date:'2026-10-13',total:0,own:0},
      {key:'missing',date:'2026-10-13',total:10,own:10,missing:true},
      ...['7','8','9'].map(priority=>({key:`excluded-${priority}`,date:'2026-10-13',total:999,own:0,priority})),
      {key:'december',date:'2026-12-31',total:3,own:3,receiver:other},
      {key:'january',date:'2027-01-01',total:7,own:7,receiver:other},
    ];
    for (const c of cases) {
      const leadId=oid(`lead:${c.key}`), bookingId=oid(`booking:${c.key}`);
      await db.collection('form_leads').insertOne({_id:leadId,name:`Phase1 ${c.key}`,job_no:`PHASE1-${c.key}`,normalized_job_no:`PHASE1${c.key.toUpperCase().replaceAll('-','')}`,phone_number:'5550100990',receiver_agent:'receiver' in c ? c.receiver : agent,receiver_agent_source:'manual',granot_priority:'priority' in c ? c.priority : '0',booked:bookingId,duplicate:false,no_sync:true,domain_revision:1,createdAt:at,timestamp:at});
      const booking = new BookedLead({_id:bookingId,book_date:new Date(`${c.date}T00:00:00Z`),lead_model:'FormLead',lead_ref:leadId,job_no:`PHASE1-${c.key}`,agent_allocations:[{agent,agent_name_snapshot:'Former snapshot name',binder_amount:c.own},{agent:other,agent_name_snapshot:'Pilot Rep Blake',binder_amount:Math.round((c.total-c.own)*100)/100}],total_binder_amount:c.total,deposit_amount:0,merchant:'Local synthetic',source:'local synthetic',...('cancelled' in c ? {cancelled:oid('cancellation')} : {})});
      assert.equal(booking.validateSync(),undefined);
      const raw=booking.toObject({versionKey:false}) as Record<string,unknown>;
      if ('missing' in c) delete raw.total_binder_amount; // deliberate legacy coverage fixture
      await db.collection('booked_leads').insertOne(raw);
    }
    for (const key of ['unlinked','dangling']) await db.collection('form_leads').insertOne({_id:oid(`lead:${key}`),name:`Phase1 ${key}`,receiver_agent:agent,receiver_agent_source:'manual',granot_priority:'0',duplicate:false,no_sync:true,...(key==='dangling'?{booked:oid('absent-booking')}:{})});
    await db.collection('call_leads').insertOne({_id:oid('crossmodel'),first_name:'Phase1',last_name:'crossmodel duplicate',receiver_agent:agent,granot_priority:'0',job_no:'PHASE1-today',normalized_job_no:'PHASE1TODAY',booked:oid('booking:today'),duplicate:false,no_sync:true,created_on_unmatched:false});
  }
  const result=await read();
  assert.equal(result.official_binder.today,60.01);
  assert.equal(result.official_binder.week_to_date,60.01);
  assert.equal(result.official_binder.last_week,75);
  assert.equal(result.official_binder.last_month,125);
  assert.equal(result.official_binder.all_time,470.01);
  assert.equal(result.assigned_potential.known_binder_total,1000.01);
  assert.equal(result.assigned_potential.linked_booking_count,6);
  assert.equal(result.assigned_potential.dangling_link_count,1);
  assert.equal(result.assigned_potential.missing_amount_count,1);
  assert.equal(result.assigned_potential.mismatched_link_count,1);
  assert.equal(result.assigned_potential.coverage,'partial');
  const january=await read(new Date('2027-01-01T17:00:00Z'));
  assert.equal(january.official_binder.today,7);
  assert.equal(january.official_binder.last_week,0);
  assert.equal(january.official_binder.last_month,3);
  assert.equal(january.assigned_potential.known_binder_total,1000.01);
  console.log(JSON.stringify({database,proof:'passed',fixture_booking:oid('booking:today').toHexString(),metrics:result,january_windows:january.official_binder.windows},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>mongoose.disconnect());
