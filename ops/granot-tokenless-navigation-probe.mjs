/** Bounded read-only compatibility probe. Domain writes: none; shared automation lease only. */
import mongoose from 'mongoose';
import * as cheerio from 'cheerio';
import { randomUUID } from 'node:crypto';
async function main() {
  const job=process.argv.find(value=>value.startsWith('--job='))?.slice(6);
  const reportHandle=process.argv.find(value=>value.startsWith('--report-handle='))?.slice(16);
  if(!process.argv.includes('--run')||!job||!/^\d{1,20}$/.test(job)||(reportHandle&&!/^[A-Z\d]{1,40}$/i.test(reportHandle)))throw new Error('explicit_run_and_numeric_job_required');
  const load = async path => { const module = await import(path); return module.default ?? module; };
  const { configureMongoDnsServers } = await load('../src/db.ts');
  const { MongoLeaseStore } = await load('../src/services/durableWork/leases.ts');
  const { SheetSyncLease } = await load('../src/models/SheetSyncLease.ts');
  const { openGranotAuthenticatedSession } = await load('../src/services/granotHttpCollector/index.ts');
  const { readGranotCredentials } = await load('../src/services/granotHttpCollector/credentials.ts');
  configureMongoDnsServers(); mongoose.set('autoIndex',false); mongoose.set('autoCreate',false);
  await mongoose.connect(process.env.MONGO_URI,{dbName:'vantagemovers',autoIndex:false,autoCreate:false,maxPoolSize:1,serverSelectionTimeoutMS:10000});
  const store=new MongoLeaseStore(SheetSyncLease), ttl=180000;
  let lease=await store.acquire({scope:'granot:automation:account',owner:`tokenless-read:${randomUUID()}`,now:new Date(),ttl_ms:ttl});
  if(!lease)throw new Error('lease_busy');
  let requests=0; const cookiePolicies=[];
  try{
    const transport=async(input,init)=>{
      if(++requests>40||new URL(String(input)).origin!=='https://eagle.hellomoving.com')throw new Error('request_budget');
      const renewed=await store.renew({token:lease,now:new Date(),ttl_ms:ttl});if(!renewed)throw new Error('lease_lost');lease=renewed;
      const response=await fetch(input,init);
      for(const cookie of response.headers.getSetCookie()) cookiePolicies.push({same_site:/;\s*SameSite=([^;]+)/i.exec(cookie)?.[1]??'unspecified',secure:/;\s*Secure(?:;|$)/i.test(cookie),http_only:/;\s*HttpOnly(?:;|$)/i.test(cookie)});
      return response;
    };
    const session=await openGranotAuthenticatedSession(readGranotCredentials(),{fetch:transport,timeoutMs:10000});
    const probes=[
      ['menu_without_token','/wc.dll?mv~mainmenuwc'],
      ['search_without_token','/wc.dll?mv~searchwc'],
      ['quick_search_without_token_post','/wc.dll?mv~searchret~~QSEARCH',{method:'POST',body:new URLSearchParams({VALUE:job,B5:'Search'})}],
      ['quick_search_without_token_get',`/wc.dll?mv~searchret~~QSEARCH&VALUE=${job}&B5=Search`],
      ['advanced_search_without_token_post','/wc.dll?mv~searchret~',{method:'POST',body:new URLSearchParams({ORDNO:job})}],
      ['advanced_search_without_token_get',`/wc.dll?mv~searchret~&ORDNO=${job}`],
      ['charges_with_job_number',`/wc.dll?mpcharge~chargeswc~${job}`],
      ['control_native_session_search',`/wc.dll?mv~searchret~${session.sessionToken}~QSEARCH`,{method:'POST',body:new URLSearchParams({VALUE:job,B5:'Search'})}],
      ['native_session_search_get',`/wc.dll?mv~searchret~${session.sessionToken}~QSEARCH&VALUE=${job}&B5=Search`],
      ['native_session_search_get_ordno',`/wc.dll?mv~searchret~${session.sessionToken}&ORDNO=${job}`],
      ['native_session_search_get_path_argument',`/wc.dll?mv~searchret~${session.sessionToken}~QSEARCH~${job}`],
    ];
    if(reportHandle)probes.push(['report_link_without_session',`/wc.dll?mprep~printselect~~${reportHandle}`]);
    const results=[]; let observedJobToken;
    for(const [name,path,init]of probes){
      try{
        const html=await session.request(path,init);const $=cheerio.load(html),text=$('body').text().replace(/\s+/g,' ');
        const labels=$('td').toArray().filter(c=>/^Job No:\s*$/i.test($(c).text().trim()));
        const actual=labels.length===1?$(labels[0]).next().text().replace(/\s/g,''):null;
        const title=$('title').text().trim();
        results.push({name,job_matches:actual==='P'+job||actual===job,has_job_form:labels.length===1,login_page:!!$('input[type=password]').length,security_error:/cookie security|security alert|invalid session|session expired/i.test(text),has_signed_in_label:/Logged\s+in\s+as\s+/i.test(text),page_kind:/Access Denied/i.test(title)?'access_denied':/Close Window|Not active SCR ID/i.test(title)?'invalid_context':labels.length===1?'job_form':'other',body_length:html.length});
        if(name==='control_native_session_search'){
          const jobToken=html.match(/\/wc\.dll\?mpcharge~chargeswc~([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})/i)?.[1];
          observedJobToken=jobToken;
          if(jobToken){
            probes.push(['job_context_search_get',`/wc.dll?mv~searchret~${jobToken}~QSEARCH&VALUE=${job}&B5=Search`]);
            probes.push(['job_context_search_post',`/wc.dll?mv~searchret~${jobToken}~QSEARCH`,{method:'POST',body:new URLSearchParams({VALUE:job,B5:'Search'})}]);
          }
        }
      }catch(error){results.push({name,provider_error:true,code:error.code??'bounded_read_failed'});}
    }
    if(observedJobToken){
      // Separate public cookie jar: no username/password is submitted for this browser-cookie control.
      const initial=await transport('https://eagle.hellomoving.com/wc.dll?mp~NetLogonWc~VANTAGE',{redirect:'manual'});
      const publicCookies=initial.headers.getSetCookie().map(cookie=>cookie.split(';',1)[0]).join('; ');
      const contextMenu=await session.request(`/wc.dll?mv~mainmenuwc~${session.sessionToken}~LOGIN`);
      const originalUser=/Logged\s+in\s+as\s+([A-Z\d._@-]+)/i.exec(cheerio.load(contextMenu)('body').text().replace(/\s+/g,' '))?.[1];
      for(const withPublicCookie of [false,true]){
        const response=await transport(`https://eagle.hellomoving.com/wc.dll?mpcharge~chargeswc~${observedJobToken}`,{headers:withPublicCookie?{Cookie:publicCookies}:{},redirect:'manual'});
        const html=await response.text(),$=cheerio.load(html),text=$('body').text().replace(/\s+/g,' ');
        results.push({name:withPublicCookie?'shared_context_with_public_login_page_cookie':'shared_context_with_no_cookies',has_job_form:/Job No:/i.test(text),security_error:/cookie|security alert/i.test(text),public_cookie_available:!!publicCookies});
      }
      const menuResponse=await transport(`https://eagle.hellomoving.com/wc.dll?mv~mainmenuwc~${observedJobToken}~LOGIN`,{headers:{Cookie:publicCookies},redirect:'manual'});
      const menuHtml=await menuResponse.text(),menuText=cheerio.load(menuHtml)('body').text().replace(/\s+/g,' ');
      const contextUser=/Logged\s+in\s+as\s+([A-Z\d._@-]+)/i.exec(menuText)?.[1];
      results.push({name:'public_cookie_context_identity',logged_in_label:!!contextUser,matches_url_creator:!!contextUser&&contextUser===originalUser});
    }
    console.log(JSON.stringify({results,cookie_policies:[...new Map(cookiePolicies.map(p=>[JSON.stringify(p),p])).values()],requests,domain_mutations:0}));
  }finally{await store.release({token:lease,now:new Date()});}
}
main().catch(error=>{console.error(JSON.stringify({ok:false,code:['lease_busy','lease_lost','request_budget','explicit_run_and_numeric_job_required'].includes(error.message)?error.message:'private_probe_error'}));process.exitCode=1;}).finally(()=>mongoose.disconnect());
