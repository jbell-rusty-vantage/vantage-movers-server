/** Clearly synthetic replay-only fixtures; no live customer, session, credential, or provider data. */
import {canonicalFactsSchema,type CaptureBundle} from './contracts';
export const SYNTHETIC_FORM=`<h1>Estimates in Process</h1><form action="/wc.dll?mv~estprocessret~REPLAY" method="post">
 <input name="STATUS" type="radio" value="V9"><select name="TYPEDTE"><option value="OPEN">Open Date</option></select>
 <input name="DATE1"><input name="DATE2"><select name="FUSTATUS"><option value="9">Pool</option><option value="10">ALL</option></select>
 <select name="USER"><option value="">All users</option></select><select name="DEPT"><option value="ALL">ALL</option></select>
 <select name="TYPE"><option value="V1">All move types</option></select><select name="SORT"><option value="V6">Priority</option></select></form>`;
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export type SyntheticRow={job:string;opened?:string;priority?:string;source?:string;user?:string;ref?:string};
export function syntheticPage(rows:SyntheticRow[],options:{total?:number;page?:number;pages?:number;next?:string;includeTotal?:boolean;oldNo?:boolean}={}){
  const headers=['job_no','open_date','follow_up','user','customer','source','ref_no','email','phone1','phone2','cf'];
  if(options.oldNo)headers.unshift('no');
  const values=(row:SyntheticRow,index:number)=>[...(options.oldNo?[String(index+1)]:[]),row.job,row.opened??'10/01/2026',row.priority??'Prior: 9',row.user??'REPLAY', 'Synthetic customer',row.source??'Synthetic Source',row.ref??'','synthetic@example.test','5550100000','5550100001','300'];
  return `<h1>Follow-Up Estimates${options.includeTotal===false?'':`, Total of: ${options.total??rows.length} Transactions`}</h1>
   ${options.page?`<p>Page ${options.page} of ${options.pages??1}</p>`:''}
   <table><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr>${rows.map((row,i)=>`<tr>${values(row,i).map(v=>`<td>${escape(v)}</td>`).join('')}</tr>`).join('')}</table>
   ${options.next?`<a rel="next" href="${escape(options.next)}">Next</a>`:''}`;
}
export function syntheticBundle():CaptureBundle{
  return {provenance:{kind:'synthetic_replay',captured_at:'2026-10-14T03:10:00Z',evidence_ref:'ops/pool-prototype/fixtures.ts'},as_of:'2026-10-14T03:10:00Z',form_html:SYNTHETIC_FORM,
   windows:[{from:'2026-10-01',to:'2026-10-07',pages:[{html:syntheticPage([{job:'P101'},{job:'P102'},{job:'P103'},{job:'P104'},{job:'P105'},{job:'P106'},{job:'P107'},{job:'P108'},{job:'P109'},{job:'P110'},{job:'P111'},{job:'P112'}])}]},{from:'2026-10-08',to:'2026-10-13',pages:[{html:syntheticPage([{job:'P101',opened:'10/08/2026',user:'CHANGED'},{job:'P113',opened:'10/08/2026'}])}]}],
   canonical:canonicalFactsSchema.parse({coverage:'synthetic_complete',forms:[{id:'f1',job_no:'P101',priority:'1',receiver_source:'manual',no_sync:false,master_sheet_lineage:'present'},{id:'f3',job_no:'P103',priority:'9'},{id:'f4a',job_no:'P104',duplicate:true},{id:'f4b',job_no:'P104'},{id:'f5',job_no:'P105',priority:'5'},{id:'f8',job_no:'P108'},{id:'f9',job_no:'P109'},{id:'f10',job_no:'P110',priority:'7',closed:true},{id:'f11',job_no:'P111',normalized_job_no:'P999'}],calls:[{id:'c2',job_no:'P102',priority:'0'},{id:'c3',job_no:'P103',priority:'1'},{id:'c5',job_no:'P105',priority:'9'},{id:'c12',job_no:'Q112'}],
    bookings:[{id:'b5',job_no:'P105',lead_ref:{model:'FormLead',id:'f5'}},{id:'b6',job_no:'P106',lead_ref:{model:'FormLead',id:'missing-f6'}},{id:'b7',job_no:'P107',anchor_evidence:'empty',is_leadless_booking:true,booking_origin:'owner_booking'},{id:'b8',job_no:'P108',lead_ref:{model:'FormLead'},is_leadless_booking:true},{id:'b9',job_no:'P109',is_leadless_booking:true}],record_links:[{id:'link10',normalized_job_no:'P110',lead_ref:{model:'FormLead',id:'f10'},disputed:true}]})};
}
