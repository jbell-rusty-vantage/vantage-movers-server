import {normalizeJobNo} from '../../src/services/bookings/bookingIdentity';
import {captureBundleSchema,type CaptureBundle,type ParsedPoolPage,type PoolRow} from './contracts';
import {classifyPoolRows,redactKey} from './matching';
import {inspectPoolForm,parsePoolPage} from './parser';

const day=(date:string,delta:number)=>new Date(Date.parse(`${date}T00:00:00Z`)+delta*86_400_000).toISOString().slice(0,10);
export function newYorkDate(asOf:string){
  const instant=new Date(asOf);if(!Number.isFinite(+instant))throw new Error('invalid as_of');
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant);
  const get=(name:string)=>parts.find(part=>part.type===name)!.value;return `${get('year')}-${get('month')}-${get('day')}`;
}
/** Seven days is a conservative observed request choice, not a universal Granot limit. */
export function currentMonthWindows(asOf:string,partitionDays=7){
  if(!Number.isInteger(partitionDays)||partitionDays<1||partitionDays>7)throw new Error('prototype partitions must be 1–7 days');
  const today=newYorkDate(asOf),windows:Array<{from:string;to:string}>=[];
  for(let from=`${today.slice(0,7)}-01`;from<=today;){const to=day(from,partitionDays-1)>today?today:day(from,partitionDays-1);windows.push({from,to});from=day(to,1);}
  return windows;
}

export function assessWindow(window:{from:string;to:string},pages:ParsedPoolPage[]){
  const reasons:string[]=[];
  if(!pages.length)reasons.push('no_pages_captured');
  for(const page of pages){
    if(!['table','explicit_empty'].includes(page.schema))reasons.push(`schema:${page.schema}`);
    if(page.unsupported_pagination)reasons.push('unsupported_pagination');
    reasons.push(...page.diagnostics);
    if(page.rows.some(row=>!row.open_date||row.open_date<window.from||row.open_date>window.to))reasons.push('row_outside_open_date_window');
  }
  const totals=new Set(pages.map(page=>page.reported_total));if(totals.has(null))reasons.push('reported_total_missing');
  if(totals.size!==1)reasons.push('reported_total_disagrees_between_pages');
  const total=pages[0]?.reported_total??null,rows=pages.flatMap(page=>page.rows);
  if(total!==null&&rows.length!==total)reasons.push('reported_total_does_not_equal_captured_rows');
  const paged=pages.some(page=>page.pagination_controls);
  if(paged){
    const counts=new Set(pages.map(page=>page.page_count));
    if(counts.size!==1||pages[0]?.page_count!==pages.length||pages.some((page,index)=>page.page_number!==index+1))reasons.push('page_sequence_incomplete_or_repeated');
  }else if(pages.length!==1)reasons.push('multiple_pages_without_pagination_evidence');
  const fingerprints=pages.map(page=>JSON.stringify(page.rows));
  if(pages.length>1&&new Set(fingerprints).size!==fingerprints.length)reasons.push('identical_pages_repeated');
  return {from:window.from,to:window.to,complete_as_rendered:reasons.length===0,captured_pages:pages.length,
    observed_rows:rows.length,reported_total:total,reasons:[...new Set(reasons)],rows};
}

export function inspectCapture(bundleInput:unknown){
  const bundle:CaptureBundle=captureBundleSchema.parse(bundleInput),expected=currentMonthWindows(bundle.as_of);
  const form=inspectPoolForm(bundle.form_html),issues:string[]=[];
  if(!form.verified)issues.push('actual_pool_form_not_verified');
  if(JSON.stringify(bundle.windows.map(({from,to})=>({from,to})))!==JSON.stringify(expected))issues.push('current_month_window_coverage_not_exact');
  if(bundle.provenance.kind==='sanitized_live_capture'&&(bundle.provenance.lease_scope!=='granot:automation:account'||!bundle.provenance.lease_verified))issues.push('live_capture_shared_account_lease_not_attested');
  const windows=bundle.windows.map(window=>assessWindow(window,window.pages.map(page=>parsePoolPage(page.html))));
  if(windows.some(window=>!window.complete_as_rendered))issues.push('one_or_more_rendered_queries_incomplete');
  const rows:PoolRow[]=windows.flatMap(window=>window.rows);
  const matching=classifyPoolRows(rows,bundle.canonical);
  const sourceCounts:Record<string,number>={};for(const row of rows){const key=redactKey('source',row.source??'missing');sourceCounts[key]=(sourceCounts[key]??0)+1;}
  return {prototype_version:1,provenance:{...bundle.provenance,lease_evidence:bundle.provenance.kind==='sanitized_live_capture'?'external_capture_attestation_not_independently_verified':'synthetic_no_live_authority'},business_day:newYorkDate(bundle.as_of),requested_windows:expected,
    selector:{verified:form.verified,pool_value:'9',all_value:'10',diagnostics:form.diagnostics},
    discovery_complete_as_rendered:issues.length===0,scope:'current_month_open_date_only',issues,
    windows:windows.map(({rows:omitted,...summary})=>({...summary,priority_counts:omitted.reduce<Record<string,number>>((counts,row)=>{const key=row.priority??'unknown';counts[key]=(counts[key]??0)+1;return counts;},{})})),
    observed_normalized_job_count:new Set(rows.map(row=>normalizeJobNo(row.job_no)).filter(Boolean)).size,
    source_counts_redacted:sourceCounts,matching,production_mutations:0,network_requests:0,
    limitation:'Rendered-query completeness does not prove Pool jobs opened before the current month or historical modifications. Matching is an inventory, not reconciliation approval.',
  };
}
