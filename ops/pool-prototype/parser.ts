import * as cheerio from 'cheerio';
import type {Element} from 'domhandler' with {'resolution-mode':'import'};
import type {ParsedPoolPage,PoolRow} from './contracts';

const REQUIRED=['job_no','open_date','follow_up','user','customer','source'];
const clean=(value:string)=>value.replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const header=(value:string)=>clean(value).toLowerCase().replace(/\s+/g,'_');
const optional=(value:string|undefined)=>value?.trim()||null;
function ownRows($:cheerio.CheerioAPI,table:Element){return $(table).find('tr').filter((_i,row)=>$(row).closest('table').get(0)===table).toArray();}
function cellTexts($:cheerio.CheerioAPI,row:Element,headers=false){return $(row).children('td,th').toArray().map(cell=>{
  if(headers&&$(cell).find('table').length)return '';
  const clone=$(cell).clone();clone.find('table').remove();return clean(clone.text());
});}
function date(value:string):string|null{
  const match=/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)?$/i.exec(value);if(!match)return null;
  const [,month,day,year]=match;const candidate=`${year}-${month!.padStart(2,'0')}-${day!.padStart(2,'0')}`;
  const parsed=new Date(`${candidate}T00:00:00Z`);return Number.isFinite(+parsed)&&parsed.toISOString().slice(0,10)===candidate?candidate:null;
}

/** Verifies the actual posted selector labels; never treats the query's FUSTATUS as a row priority. */
export function inspectPoolForm(html:string){
  const $=cheerio.load(html),select=$('select[name="FUSTATUS"]');
  const options=select.find('option').toArray().map(option=>({value:$(option).attr('value')??'',label:clean($(option).text()),disabled:$(option).is('[disabled]')}));
  const diagnostics:string[]=[];
  if(select.length!==1||select.is('[disabled]'))diagnostics.push('priority_select_missing_or_ambiguous');
  if(options.filter(o=>o.value==='9').length!==1||options.filter(o=>o.value==='9'&&!o.disabled&&/^pool$/i.test(o.label)).length!==1)diagnostics.push('pool_9_label_not_verified');
  if(options.filter(o=>o.value==='10').length!==1||options.filter(o=>o.value==='10'&&!o.disabled&&/^all$/i.test(o.label)).length!==1)diagnostics.push('all_10_label_not_verified');
  if($('[name="STATUS"][value="V9"]').length!==1)diagnostics.push('follow_up_v9_not_verified');
  if($('[name="TYPEDTE"] option[value="OPEN"], [name="TYPEDTE"][value="OPEN"]').length!==1)diagnostics.push('open_date_factor_not_verified');
  for(const field of ['DATE1','DATE2','USER','DEPT','TYPE','SORT'])if(!$(`[name="${field}"]`).length)diagnostics.push(`required_control_missing:${field}`);
  for(const [field,value] of [['DEPT','ALL'],['TYPE','V1'],['SORT','V6'],['USER','']])if(!$(`select[name="${field}"] option[value="${value}"],input[name="${field}"][value="${value}"]`).length)diagnostics.push(`requested_control_value_not_verified:${field}`);
  const form=select.closest('form');
  const action=form.attr('action');
  const scripted=[...html.matchAll(/document\.theForm\.action\s*=\s*["'](\/wc\.dll\?mv~estprocessret~[A-Za-z0-9-]+)["']/g)];
  const safeAction=action?/^\/wc\.dll\?mv~estprocessret~[A-Za-z0-9-]+$/.test(action):form.attr('name')==='theForm'&&scripted.length===1;
  if(form.length!==1||!safeAction||(form.attr('method')??'get').toLowerCase()!=='post')diagnostics.push('estprocessret_post_form_not_verified');
  return {verified:diagnostics.length===0,priority_options:options,diagnostics};
}

export function poolRequestBody(formHtml:string,window:{from:string;to:string}){
  const form=inspectPoolForm(formHtml);if(!form.verified)throw new Error('Pool form contract is unverified');
  const mmdd=(value:string)=>{const parsed=new Date(`${value}T00:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(+parsed)||parsed.toISOString().slice(0,10)!==value)throw new Error('invalid date');return `${value.slice(5,7)}/${value.slice(8,10)}/${value.slice(0,4)}`;};
  if(window.to<window.from)throw new Error('invalid date window');
  return new URLSearchParams({STATUS:'V9',TYPEDTE:'OPEN',DATE1:mmdd(window.from),DATE2:mmdd(window.to),FUSTATUS:'9',USER:'',DEPT:'ALL',TYPE:'V1',SORT:'V6'});
}

/** Strict new-table replay parser. Never logs contact cells or session-bearing links. */
export function parsePoolPage(html:string):ParsedPoolPage{
  const $=cheerio.load(html);$('script,style').remove();const text=clean($('body').text()),diagnostics:string[]=[];
  const result:ParsedPoolPage={schema:'missing',rows:[],reported_total:null,page_number:null,page_count:null,pagination_controls:false,unsupported_pagination:false,diagnostics,headers:[]};
  if(/security alert|network login|user login/i.test(text)){diagnostics.push('invalid_session_page');return result;}
  const totals=[...text.matchAll(/Total\s+of:\s*([\d,]+)\s+Transactions/gi)].map(m=>Number(m[1]!.replaceAll(',','')));
  if(new Set(totals).size>1){result.schema='invalid';diagnostics.push('contradictory_transaction_totals');return result;}
  result.reported_total=totals[0]??null;
  const pageMatches=[...text.matchAll(/\bPage\s+(\d+)\s+(?:of|\/)\s*(\d+)\b/gi)];
  if(pageMatches.length){
    const page=pageMatches[0]!;result.page_number=Number(page[1]);result.page_count=Number(page[2]);result.pagination_controls=true;
    if(pageMatches.some(m=>m[1]!==page[1]||m[2]!==page[2])||result.page_number<1||result.page_count<result.page_number){result.unsupported_pagination=true;diagnostics.push('invalid_or_conflicting_page_summary');}
  }
  $('a,button,input,select').each((_i,element)=>{
    const elementText=clean($(element).text()||$(element).attr('value')||''),name=$(element).attr('name')??'',rel=$(element).attr('rel')??'';
    if(/^(next|previous|prev|first|last|[<>]{1,2})$/i.test(elementText)||/next|prev/i.test(rel)||/^(page|pageno|page_no|offset)$/i.test(name))result.pagination_controls=true;
  });
  if(result.pagination_controls&&result.page_count===null){result.unsupported_pagination=true;diagnostics.push('pager_without_supported_page_summary');}
  const candidates:Array<{table:Element;row:Element;headers:string[]}>=[];
  $('table').each((_i,table)=>{
    for(const row of ownRows($,table)){
      const headers=cellTexts($,row,true).map(header);
      if(headers.includes('job_no')&&headers.includes('customer')){candidates.push({table,row,headers});break;}
    }
  });
  if(candidates.length!==1){
    if(!candidates.length&&/Follow[- ]Up Estimates/i.test(text)&&result.reported_total===0){result.schema='explicit_empty';return result;}
    diagnostics.push(candidates.length?'multiple_candidate_tables':'expected_table_missing');return result;
  }
  const selected=candidates[0]!;result.headers=selected.headers;
  if(REQUIRED.some(h=>!selected.headers.includes(h))||selected.headers.includes('no')||selected.headers.filter(Boolean).length!==new Set(selected.headers.filter(Boolean)).size){result.schema='invalid';diagnostics.push('new_table_headers_invalid');return result;}
  const rows=ownRows($,selected.table);const start=rows.indexOf(selected.row);
  for(const row of rows.slice(start+1)){
    const cells=cellTexts($,row),raw=Object.fromEntries(selected.headers.filter(Boolean).map(h=>[h,cells[selected.headers.indexOf(h)]??'']));
    if(!cells.some(Boolean))continue;
    if(!raw.job_no&&(/\btotals?\b/i.test(raw.customer??'')||cells.every((cell,i)=>!cell||!['job_no','customer','source','open_date','follow_up','user'].includes(selected.headers[i]??''))))continue;
    if(cells.length!==selected.headers.length){result.schema='invalid';diagnostics.push('data_row_cell_count_mismatch');return result;}
    // Same primary-line rule as the corrected Estimates collector: labels after br are evidence, never Job identity.
    const jobCell=$(row).children('th,td').get(selected.headers.indexOf('job_no'));
    if(jobCell){const clone=$(jobCell).clone();clone.find('table').remove();clone.find('br').replaceWith('\u241e');raw.job_no=clean(clone.text().split('\u241e')[0]??'');}
    const parsedDate=raw.open_date?date(raw.open_date):null;
    if(raw.open_date&&!parsedDate)diagnostics.push('invalid_open_date');
    const digits=[...(raw.follow_up??'').matchAll(/\bprior:\s*(\d{1,12}|Pool)(?=\s|$)/gi)].map(m=>/^pool$/i.test(m[1]!)?'9':m[1]!);
    const markers=(raw.follow_up??'').match(/\bprior:/gi)??[];
    const rowData:PoolRow={job_no:optional(raw.job_no),open_date:parsedDate,priority:markers.length===digits.length&&new Set(digits).size===1&&/^[0-9]$/.test(digits[0]!)?digits[0]!:null,source:optional(raw.source),user:optional(raw.user),ref_no:optional(raw.ref_no)};
    if(rowData.priority===null)diagnostics.push('row_priority_missing_or_ambiguous');
    else if(rowData.priority!=='9')diagnostics.push('non_pool_priority_returned');
    if(!rowData.job_no)diagnostics.push('row_job_identity_missing');
    if(!rowData.source)diagnostics.push('row_source_missing');
    if(!rowData.open_date)diagnostics.push('row_open_date_missing');
    result.rows.push(rowData);
  }
  result.schema=result.rows.length?'table':result.reported_total===0?'explicit_empty':'ambiguous_empty';
  if(result.schema==='ambiguous_empty')diagnostics.push('empty_table_without_explicit_zero_total');
  return result;
}
