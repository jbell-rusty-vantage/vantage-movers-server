import assert from 'node:assert/strict';
import {test} from 'node:test';
import {captureBundleSchema,canonicalFactsSchema,type CanonicalFactsInput,type PoolRow} from './contracts';
import {SYNTHETIC_FORM,syntheticBundle,syntheticPage} from './fixtures';
import {collectPoolReadOnly,type PoolReadRuntime} from './live';
import {classifyPoolRows} from './matching';
import { parsePoolPage } from './parser';
import { assessWindow, inspectCapture } from './replay';

const facts=(input:Partial<CanonicalFactsInput>={})=>canonicalFactsSchema.parse({forms:[],calls:[],bookings:[],record_links:[],coverage:'synthetic_complete',...input});
const row=(job:string,priority='9'):PoolRow=>({job_no:job,priority,open_date:'2026-10-01',source:'Synthetic Source',user:'REPLAY',ref_no:null});
const match=(job:string,input:Partial<CanonicalFactsInput>)=>classifyPoolRows([row(job)],facts(input)).collisions[0]!;
test('empty, schema drift, login page, unknown priority and returned non-Pool priority fail closed distinctly',()=>{
 assert.equal(parsePoolPage(syntheticPage([])).schema,'explicit_empty');
 assert.equal(parsePoolPage(syntheticPage([],{includeTotal:false})).schema,'ambiguous_empty');
 assert.equal(parsePoolPage('<h1>Follow-Up Estimates, Total of: 0 Transactions</h1>').schema,'explicit_empty');
 assert.equal(parsePoolPage('<h1>All Estimates</h1>').schema,'missing');
 assert.ok(parsePoolPage('<h1>User Login</h1>').diagnostics.includes('invalid_session_page'));
 assert.ok(parsePoolPage(syntheticPage([{job:'P1',priority:'Pool'}])).diagnostics.includes('row_priority_missing_or_ambiguous'));
 assert.ok(parsePoolPage(syntheticPage([{job:'P1',priority:'Prior: 0'}])).diagnostics.includes('non_pool_priority_returned'));
});
test('all rendered pages and declared total are required; missing, repeated, unknown pagers and out-of-window rows refuse completeness',()=>{
 const w={from:'2026-10-01',to:'2026-10-07'},p1=parsePoolPage(syntheticPage([{job:'P1'}],{total:2,page:1,pages:2})),p2=parsePoolPage(syntheticPage([{job:'P2'}],{total:2,page:2,pages:2}));
 assert.equal(assessWindow(w,[p1,p2]).complete_as_rendered,true);
 assert.equal(assessWindow(w,[p1]).complete_as_rendered,false);
 assert.equal(assessWindow(w,[p1,p1]).complete_as_rendered,false);
 assert.equal(assessWindow(w,[parsePoolPage(syntheticPage([{job:'P1',opened:'09/30/2026'}]))]).complete_as_rendered,false);
 assert.equal(assessWindow(w,[parsePoolPage(syntheticPage([{job:'P1'}])+'<button>Next</button>')]).complete_as_rendered,false);
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
