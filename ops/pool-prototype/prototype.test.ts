import assert from 'node:assert/strict';
import {test} from 'node:test';
import {captureBundleSchema,canonicalFactsSchema,type CanonicalFactsInput,type PoolRow} from './contracts';
import {SYNTHETIC_FORM,syntheticBundle,syntheticPage} from './fixtures';
import {collectPoolReadOnly,type PoolReadRuntime} from './live';
import {classifyPoolRows} from './matching';
import {inspectPoolForm,parsePoolPage,poolRequestBody} from './parser';
import {assessWindow,currentMonthWindows,inspectCapture} from './replay';

const facts=(input:Partial<CanonicalFactsInput>={})=>canonicalFactsSchema.parse({forms:[],calls:[],bookings:[],record_links:[],coverage:'synthetic_complete',...input});
const row=(job:string,priority='9'):PoolRow=>({job_no:job,priority,open_date:'2026-10-01',source:'Synthetic Source',user:'REPLAY',ref_no:null});
const match=(job:string,input:Partial<CanonicalFactsInput>)=>classifyPoolRows([row(job)],facts(input)).collisions[0]!;

test('New York current month is partitioned inclusively without gaps at DST/year/month boundaries',()=>{
 assert.deepEqual(currentMonthWindows('2026-10-14T03:10:00Z'),[{from:'2026-10-01',to:'2026-10-07'},{from:'2026-10-08',to:'2026-10-13'}]);
 assert.deepEqual(currentMonthWindows('2027-01-01T02:00:00Z').at(-1),{from:'2026-12-29',to:'2026-12-31'});
 assert.deepEqual(currentMonthWindows('2026-03-08T07:00:00Z'),[{from:'2026-03-01',to:'2026-03-07'},{from:'2026-03-08',to:'2026-03-08'}]);
 assert.throws(()=>currentMonthWindows('2026-10-14T03:10:00Z',8));
});
test('actual selector and fixed safe control values are verified before constructing a Pool request',()=>{
 assert.equal(inspectPoolForm(SYNTHETIC_FORM).verified,true);
 const body=poolRequestBody(SYNTHETIC_FORM,{from:'2026-10-01',to:'2026-10-07'});
 assert.deepEqual(Object.fromEntries(body),{STATUS:'V9',TYPEDTE:'OPEN',DATE1:'10/01/2026',DATE2:'10/07/2026',FUSTATUS:'9',USER:'',DEPT:'ALL',TYPE:'V1',SORT:'V6'});
 assert.equal(inspectPoolForm(SYNTHETIC_FORM.replace('>Pool<','>Not Pool<')).verified,false);
 assert.equal(inspectPoolForm(SYNTHETIC_FORM.replace('<option value="9">Pool</option>','<option value="9">Pool</option><option value="9">Other</option>')).verified,false);
 assert.throws(()=>poolRequestBody(SYNTHETIC_FORM.replace('value="V6"','value="V7"'),{from:'2026-10-01',to:'2026-10-07'}));
 assert.throws(()=>poolRequestBody(SYNTHETIC_FORM,{from:'2026-02-30',to:'2026-03-01'}));
});
test('new table has no old numeric no requirement; nested tables and totals do not become jobs',()=>{
 const original=syntheticPage([{job:'P101'}]);
 const nested=original.replace('<th>cf</th>','<th>cf</th><th><table><tr><th>customer</th></tr></table></th>').replace('<td>300</td>','<td>300</td><td><table><tr><td>nested fake row</td></tr></table></td>').replace('</table>','</table>');
 const parsed=parsePoolPage(nested);assert.equal(parsed.schema,'table');assert.equal(parsed.rows.length,1);assert.equal(parsed.rows[0]!.priority,'9');
 assert.equal(parsePoolPage(syntheticPage([{job:'P101'}],{oldNo:true})).schema,'invalid');
 const totals=original.replace('</table>','<tr><td></td><td></td><td></td><td></td><td>Totals</td><td></td><td></td><td></td><td></td><td></td><td>300</td></tr></table>');
 assert.equal(parsePoolPage(totals).rows.length,1);
});
test('empty, schema drift, login page, unknown priority and returned non-Pool priority fail closed distinctly',()=>{
 assert.equal(parsePoolPage(syntheticPage([])).schema,'explicit_empty');
 assert.equal(parsePoolPage(syntheticPage([],{includeTotal:false})).schema,'ambiguous_empty');
 assert.equal(parsePoolPage('<h1>Follow-Up Estimates, Total of: 0 Transactions</h1>').schema,'explicit_empty');
 assert.equal(parsePoolPage('<h1>All Estimates</h1>').schema,'missing');
 assert.ok(parsePoolPage('<h1>User Login</h1>').diagnostics.includes('invalid_session_page'));
 assert.ok(parsePoolPage(syntheticPage([{job:'P1',priority:'Pool'}])).diagnostics.includes('row_priority_missing_or_ambiguous'));
 assert.ok(parsePoolPage(syntheticPage([{job:'P1',priority:'Prior: 0'}])).diagnostics.includes('non_pool_priority_returned'));
});
test('schema/data cardinality and multiple candidate tables do not silently truncate a result',()=>{
 const page=syntheticPage([{job:'P1'}]);
 assert.equal(parsePoolPage(page.replace('<td>300</td>','')).schema,'invalid');
 assert.equal(parsePoolPage(page+page).schema,'missing');
 assert.equal(assessWindow({from:'2026-10-01',to:'2026-10-07'},[parsePoolPage(syntheticPage([{job:'P1'}],{total:2}))]).complete_as_rendered,false);
});
test('all rendered pages and declared total are required; missing, repeated, unknown pagers and out-of-window rows refuse completeness',()=>{
 const w={from:'2026-10-01',to:'2026-10-07'},p1=parsePoolPage(syntheticPage([{job:'P1'}],{total:2,page:1,pages:2})),p2=parsePoolPage(syntheticPage([{job:'P2'}],{total:2,page:2,pages:2}));
 assert.equal(assessWindow(w,[p1,p2]).complete_as_rendered,true);
 assert.equal(assessWindow(w,[p1]).complete_as_rendered,false);
 assert.equal(assessWindow(w,[p1,p1]).complete_as_rendered,false);
 assert.equal(assessWindow(w,[parsePoolPage(syntheticPage([{job:'P1',opened:'09/30/2026'}]))]).complete_as_rendered,false);
 assert.equal(assessWindow(w,[parsePoolPage(syntheticPage([{job:'P1'}])+'<button>Next</button>')]).complete_as_rendered,false);
});
test('unique identities across both Lead models, duplicates/cross-model collisions and other canonical priorities are reported without admission',()=>{
 assert.equal(match('P1',{forms:[{id:'f1',job_no:'P1',priority:'1'}]}).classification,'unique_exact');
 assert.equal(match('P1',{calls:[{id:'c1',job_no:'P1'}]}).classification,'unique_exact');
 const crossed=match('P1',{forms:[{id:'same-id',job_no:'P1',priority:'1'}],calls:[{id:'same-id',job_no:'P1',priority:'9'}]});
 assert.equal(crossed.classification,'cross_model_collision');assert.equal(crossed.priority_counts['1'],1);assert.equal(crossed.priority_counts['9'],1);
 assert.equal(crossed.other_canonical_priority,true);assert.equal(crossed.admission_eligibility,'not_evaluated');assert.equal(crossed.allowed_mutation,false);
 assert.equal(match('P1',{forms:[{id:'f1',job_no:'P1',duplicate:true},{id:'f2',job_no:'P1'}]}).classification,'ambiguous_same_model');
});
test('official Booking canonical anchor resolves a cross-model collision without erasing the collision inventory',()=>{
 const result=match('P1',{forms:[{id:'f1',job_no:'P1',priority:'5'}],calls:[{id:'c1',job_no:'P1'}],bookings:[{id:'b1',job_no:'P1',lead_ref:{model:'FormLead',id:'f1'}}]});
 assert.equal(result.classification,'official_booking_anchor');assert.equal(result.cross_model_exact,true);assert.equal(result.official_booking_count,1);assert.equal(result.canonical_anchor_keys.length,1);
});
test('pending/partial/unknown Booking pointers are held and never downgraded to unmatched or promoted to legacy leadless',()=>{
 assert.equal(match('P1',{bookings:[{id:'b1',job_no:'P1',anchor_evidence:'empty',is_leadless_booking:true,booking_origin:'owner_booking'}]}).classification,'pending_booking_anchor');
 assert.equal(match('P1',{bookings:[{id:'b1',job_no:'P1',lead_ref:{model:'FormLead'},is_leadless_booking:true}]}).classification,'malformed_booking_anchor');
 assert.equal(match('P1',{bookings:[{id:'b1',job_no:'P1',raw_lead_model_present:true,anchor_evidence:'empty',is_leadless_booking:true}]}).classification,'malformed_booking_anchor');
 assert.equal(match('P1',{bookings:[{id:'b1',job_no:'P1',is_leadless_booking:true}]}).classification,'booking_anchor_uncertain');
 assert.equal(match('P1',{bookings:[{id:'b1',job_no:'P1',anchor_evidence:'empty',is_referral_booking:true}]}).classification,'official_booking_anchor');
});
test('dangling/competing Booking and Granot anchors, multiple official bookings, and raw/stored job disagreement are held',()=>{
 assert.equal(match('P1',{bookings:[{id:'b1',job_no:'P1',lead_ref:{model:'FormLead',id:'absent'}}]}).classification,'booking_anchor_missing_lead');
 assert.equal(match('P1',{bookings:[{id:'b1',job_no:'P1',lead_ref:{model:'FormLead',id:'f1'}},{id:'b2',job_no:'P1',lead_ref:{model:'CallLead',id:'c1'}}]}).classification,'multiple_official_bookings');
 assert.equal(match('P1',{forms:[{id:'f1',job_no:'P1'},{id:'f2',job_no:'P1'}],bookings:[{id:'b1',job_no:'P1',lead_ref:{model:'FormLead',id:'f1'}}],record_links:[{id:'link',normalized_job_no:'P1',lead_ref:{model:'FormLead',id:'f2'},state:'active'}]}).classification,'canonical_anchor_conflict');
 assert.equal(match('P1',{forms:[{id:'f1',job_no:'P1',normalized_job_no:'P2'}]}).classification,'canonical_job_disagreement');
 assert.equal(match('P2',{forms:[{id:'f1',job_no:'P1',normalized_job_no:'P2'}]}).classification,'canonical_job_disagreement');
});
test('compatibility digit-core aliases remain secondary review; source/assignment/closed facts do not imply eligible admission',()=>{
 assert.equal(match('P123',{calls:[{id:'c1',job_no:'Q123'}]}).classification,'compatibility_only');
 const result=match('P1',{forms:[{id:'f1',job_no:'P1',closed:true,cancelled:true,no_sync:false,receiver_source:'manual',master_sheet_lineage:'unknown'}]});
 assert.equal(result.classification,'unique_exact');assert.equal(result.excluded_candidate_count,1);assert.equal(result.existing_master_sheet_lineage_count,0);assert.equal(result.explicit_no_sync_false_candidate_count,1);assert.equal(result.manual_assignment_policy_checked,false);
});
test('unmatched, missing identity, changed receiver snapshots and partial canonical inventory are explicit',()=>{
 assert.equal(match('---',{}).classification,'insufficient_identity');assert.equal(match('P1',{}).classification,'unmatched');
 const result=classifyPoolRows([row('P1'),{...row('P1'),user:'DIFFERENT'}],facts({coverage:'partial'}));
 assert.equal(result.repeated_job_observation_count,1);assert.ok(result.collisions[0]!.warnings.includes('observed_priority_source_or_receiver_changed'));assert.ok(result.collisions[0]!.warnings.includes('canonical_inventory_partial'));
});
test('synthetic full replay stays labelled synthetic, redacts identities/contacts and holds all important collision classes',()=>{
 const report=inspectCapture(syntheticBundle());assert.equal(report.discovery_complete_as_rendered,true);assert.equal(report.provenance.kind,'synthetic_replay');assert.equal(report.production_mutations,0);assert.equal(report.network_requests,0);
 const output=JSON.stringify(report);for(const forbidden of ['synthetic@example.test','5550100000','Synthetic customer','P101','REPLAY'])assert.equal(output.includes(forbidden),false);
 for(const category of ['unique_exact','cross_model_collision','ambiguous_same_model','official_booking_anchor','booking_anchor_missing_lead','pending_booking_anchor','malformed_booking_anchor','booking_anchor_uncertain','canonical_job_disagreement','compatibility_only','unmatched'])assert.ok(report.matching.classifications[category]);
});
test('missing current-month partitions, live lease attestation, unexpected contact keys and malformed captures cannot claim completeness',()=>{
 const bundle=syntheticBundle();assert.equal(inspectCapture({...bundle,windows:bundle.windows.slice(0,1)}).discovery_complete_as_rendered,false);
 assert.equal(inspectCapture({...bundle,provenance:{...bundle.provenance,kind:'sanitized_live_capture'}}).discovery_complete_as_rendered,false);
 assert.equal(inspectCapture({...bundle,provenance:{...bundle.provenance,kind:'sanitized_live_capture',lease_scope:'granot:automation:account',lease_verified:true}}).provenance.lease_evidence,'external_capture_attestation_not_independently_verified');
 assert.throws(()=>captureBundleSchema.parse({...bundle,canonical:{...bundle.canonical,forms:[{id:'x',phone_number:'live contact'}]}}));
});

function runtime(responsePages:string[],options:{leaseBusy?:boolean;lostAfter?:number;authorityMismatch?:boolean}={}){
 const events:string[]=[],posted:URLSearchParams[]=[];let checks=0;
 const dependencies:PoolReadRuntime={kind:'synthetic_fixture',acquireAccountLease:async(scope,ttl)=>{events.push(`lease:${scope}:${ttl}`);return options.leaseBusy?null:{scope,authority:options.authorityMismatch?'managed_shared_account':'synthetic_fixture',assertHeld:async()=>{events.push('fence');if(options.lostAfter!==undefined&&++checks>options.lostAfter)throw new Error('secret-bearing provider failure');},release:async()=>{events.push('release');}};},
 openAuthenticatedSession:async()=>{events.push('login');return {sessionToken:'REPLAY',request:async(path,init)=>{events.push(`request:${path.split('~').slice(0,2).join('~')}`);if(init?.body)posted.push(init.body);const page=responsePages.shift();assert.ok(page);return page;}};},readCanonicalFacts:async()=>{events.push('canonical-read');return facts();}};
 return {dependencies,events,posted};
}
test('collector acquires real-scope authority before login, fences each request, posts only Pool9/V9 and releases in finally',async()=>{
 const {dependencies,events,posted}=runtime([SYNTHETIC_FORM,syntheticPage([{job:'P1'}]),syntheticPage([{job:'P2',opened:'10/08/2026'}])]);
 const result=await collectPoolReadOnly('2026-10-14T03:10:00Z',dependencies);assert.equal(result.available,true);if(!result.available)return;
 assert.equal(result.provenance.kind,'synthetic_transport_replay');assert.equal(result.collection_requests,3);assert.equal(result.authentication_request_count,'runtime_not_reported');assert.equal(result.discovery_complete_as_rendered,true);
 assert.ok(events.indexOf('login')>events.indexOf('lease:granot:automation:account:2700000'));assert.equal(events.at(-1),'release');assert.equal(posted.length,2);for(const body of posted){assert.equal(body.get('FUSTATUS'),'9');assert.equal(body.get('STATUS'),'V9');}
});
test('lease busy/lost/authority mismatch and request-budget exhaustion fail closed and never substitute local auth authority',async()=>{
 const busy=runtime([],{leaseBusy:true});assert.equal((await collectPoolReadOnly('2026-10-14T03:10:00Z',busy.dependencies)).available,false);assert.equal(busy.events.includes('login'),false);
 const lost=runtime([SYNTHETIC_FORM],{lostAfter:2});assert.equal((await collectPoolReadOnly('2026-10-14T03:10:00Z',lost.dependencies)).available,false);assert.equal(lost.events.at(-1),'release');
 const mismatch=runtime([],{authorityMismatch:true});assert.equal((await collectPoolReadOnly('2026-10-14T03:10:00Z',mismatch.dependencies)).available,false);assert.equal(mismatch.events.includes('login'),false);assert.equal(mismatch.events.at(-1),'release');
 const budget=runtime([SYNTHETIC_FORM]);assert.equal((await collectPoolReadOnly('2026-10-14T03:10:00Z',budget.dependencies,1)).available,false);assert.equal(budget.events.at(-1),'release');
});
test('collector follows bounded same-session pagination and refuses an unsafe cross-origin link',async()=>{
 const first=syntheticPage([{job:'P1'}],{total:2,page:1,pages:2,next:'/wc.dll?mv~estprocessret~REPLAY~2'}),second=syntheticPage([{job:'P2'}],{total:2,page:2,pages:2});
 const valid=runtime([SYNTHETIC_FORM,first,second,syntheticPage([])]);const report=await collectPoolReadOnly('2026-10-14T03:10:00Z',valid.dependencies);assert.equal(report.available,true);if(report.available)assert.equal(report.discovery_complete_as_rendered,true);
 const unsafe=runtime([SYNTHETIC_FORM,first.replace('/wc.dll?mv~estprocessret~REPLAY~2','https://evil.invalid/wc.dll?mv~estprocessret~REPLAY~2'),syntheticPage([])]);const refused=await collectPoolReadOnly('2026-10-14T03:10:00Z',unsafe.dependencies);assert.equal(refused.available,true);if(refused.available)assert.equal(refused.discovery_complete_as_rendered,false);assert.equal(unsafe.events.at(-1),'release');
});
