/** Required-authority adapter only. No credential discovery, default transport, Mongo fallback, apply, or CLI live mode. */
import * as cheerio from 'cheerio';
import type {CanonicalFacts,ParsedPoolPage,PoolRow} from './contracts';
import {classifyPoolRows} from './matching';
import {inspectPoolForm,parsePoolPage,poolRequestBody} from './parser';
import {assessWindow,currentMonthWindows,newYorkDate} from './replay';

const ACCOUNT_SCOPE='granot:automation:account' as const;
/** Structural transport seam compatible with the existing authenticated session; no auth module is loaded here. */
export type PoolAuthenticatedSession={sessionToken:string;request(path:string,init?:{method?:'GET'|'POST';body?:URLSearchParams}):Promise<string>};
export type PoolLeaseFence={
  scope:typeof ACCOUNT_SCOPE;
  authority:'managed_shared_account'|'synthetic_fixture';
  assertHeld():Promise<void>;
  release():Promise<void>;
};
export type PoolReadRuntime={
  kind:'managed_shared_account'|'synthetic_fixture';
  /** Must acquire the existing global account lease, not a separate process/local-test substitute. */
  acquireAccountLease(scope:typeof ACCOUNT_SCOPE,ttlMs:number):Promise<PoolLeaseFence|null>;
  /** Runtime supplies the existing openGranotAuthenticatedSession; called only after lease acquisition. */
  openAuthenticatedSession():Promise<PoolAuthenticatedSession>;
  readCanonicalFacts(rows:readonly PoolRow[]):Promise<CanonicalFacts>;
};

function nextPagePath(html:string,sessionToken:string):string|null{
  const $=cheerio.load(html),next=$('a').toArray().filter(element=>$(element).attr('rel')==='next'||/^(next|>)$/i.test($(element).text().trim()));
  if(next.length!==1)return null;
  const href=$(next[0]!).attr('href')??'';
  if(!href.startsWith('/wc.dll?'))return null;
  const url=new URL(href,'https://pool-prototype.invalid');
  if(url.origin!=='https://pool-prototype.invalid'||url.hash||!url.search.startsWith(`?mv~estprocessret~${sessionToken}`))return null;
  return `${url.pathname}${url.search}`;
}

/** Runs only with an explicitly supplied approved runtime. Fixture runtimes remain labelled synthetic. */
export async function collectPoolReadOnly(asOf:string,runtime:PoolReadRuntime,maxRequests=64){
  if(!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>256)throw new Error('invalid prototype request budget');
  const windows=currentMonthWindows(asOf),lease=await runtime.acquireAccountLease(ACCOUNT_SCOPE,45*60_000);
  if(!lease)return {available:false as const,reason:'shared_account_lease_busy',production_mutations:0};
  let requests=0;
  try{
    if(lease.scope!==ACCOUNT_SCOPE||lease.authority!==runtime.kind)throw new Error('shared account runtime authority mismatch');
    await lease.assertHeld();
    const session=await runtime.openAuthenticatedSession();
    await lease.assertHeld();
    const request=async(path:string,init?:{method?:'GET'|'POST';body?:URLSearchParams})=>{
      if(++requests>maxRequests)throw new Error('prototype request budget exceeded');
      await lease.assertHeld();const html=await session.request(path,init);await lease.assertHeld();return html;
    };
    const formHtml=await request(`/wc.dll?mv~estprocesswc~${session.sessionToken}`),form=inspectPoolForm(formHtml);
    if(!form.verified)return {available:false as const,reason:'pool_form_contract_unverified',diagnostics:form.diagnostics,collection_requests:requests,authentication_request_count:'runtime_not_reported',production_mutations:0};
    const captured:Array<ReturnType<typeof assessWindow>>=[];
    for(const window of windows){
      let html=await request(`/wc.dll?mv~estprocessret~${session.sessionToken}`,{method:'POST',body:poolRequestBody(formHtml,window)});
      const pages:ParsedPoolPage[]=[],seenPaths=new Set<string>();
      for(;;){
        const parsed=parsePoolPage(html);pages.push(parsed);
        if(!['table','explicit_empty'].includes(parsed.schema)||parsed.unsupported_pagination)break;
        if(parsed.page_count===null||parsed.page_number===parsed.page_count)break;
        const next=nextPagePath(html,session.sessionToken);
        if(!next||seenPaths.has(next)){parsed.unsupported_pagination=true;parsed.diagnostics.push('missing_unsafe_or_repeated_next_page_path');break;}
        seenPaths.add(next);html=await request(next);
      }
      captured.push(assessWindow(window,pages));
    }
    const rows=captured.flatMap(window=>window.rows);await lease.assertHeld();
    const facts=await runtime.readCanonicalFacts(rows);await lease.assertHeld();
    return {available:true as const,provenance:{kind:runtime.kind==='synthetic_fixture'?'synthetic_transport_replay':'leased_live_capture',lease_scope:ACCOUNT_SCOPE,lease_verified:true},business_day:newYorkDate(asOf),
      selector:{verified:true,pool_value:'9',all_value:'10'},
      discovery_complete_as_rendered:captured.every(window=>window.complete_as_rendered),collection_requests:requests,collection_request_budget:maxRequests,authentication_request_count:'runtime_not_reported',overall_http_count_verified:false,
      windows:captured.map(({rows:omitted,...summary})=>({...summary,observed_rows:omitted.length})),matching:classifyPoolRows(rows,facts),production_mutations:0,
      limitation:'Only the current-month Open Date query scope is inspected. No reconciliation or membership writes are authorized.'};
  }catch{
    // Do not surface session-bearing URLs, credentials, contacts, provider response HTML, or an arbitrary cause.
    return {available:false as const,reason:'capture_failed_closed',collection_requests:requests,authentication_request_count:'runtime_not_reported',production_mutations:0};
  }finally{await lease.release();}
}
