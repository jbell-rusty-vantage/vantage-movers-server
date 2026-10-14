import {createHash} from 'node:crypto';
import {jobNumbersEquivalent,normalizeJobNo} from '../../src/services/bookings/bookingIdentity';
import type {CanonicalBooking,CanonicalFacts,CanonicalLead,PoolRow} from './contracts';

export const redactKey=(kind:string,value:string)=>createHash('sha256').update(`pool-discovery:${kind}:${value}`).digest('hex').slice(0,16);
const job=(row:{job_no?:string|null;normalized_job_no?:string|null})=>normalizeJobNo(row.normalized_job_no)??normalizeJobNo(row.job_no)??null;
const unique=<T extends {id:string}>(rows:T[])=>[...new Map(rows.map(row=>[row.id,row])).values()];
const jobs=(row:{job_no?:string|null;normalized_job_no?:string|null})=>[...new Set([normalizeJobNo(row.job_no),normalizeJobNo(row.normalized_job_no)].filter((value):value is string=>Boolean(value)))];
const jobConflict=(row:{job_no?:string|null;normalized_job_no?:string|null})=>jobs(row).length>1;
const bookingRef=(booking:CanonicalBooking)=>booking.lead_ref?.id&&(booking.lead_ref.model==='FormLead'||booking.lead_ref.model==='CallLead')?{model:booking.lead_ref.model,id:booking.lead_ref.id}:null;
const malformed=(booking:CanonicalBooking)=>booking.anchor_evidence==='partial'||Boolean(booking.lead_ref&&!bookingRef(booking))||Boolean(!bookingRef(booking)&&(booking.raw_lead_ref_present||booking.raw_lead_model_present));
const anchorUnknown=(booking:CanonicalBooking)=>!bookingRef(booking)&&!malformed(booking)&&booking.anchor_evidence!=='empty';
const official=(booking:CanonicalBooking)=>!malformed(booking)&&!anchorUnknown(booking)&&Boolean(bookingRef(booking)||booking.is_referral_booking||(booking.is_leadless_booking&&!['owner_booking','employee_booking'].includes(booking.booking_origin??'')));
type Candidate=CanonicalLead&{model:'FormLead'|'CallLead'};
export type MatchClassification='insufficient_identity'|'unmatched'|'unique_exact'|'ambiguous_same_model'|'cross_model_collision'|'official_booking_anchor'|'multiple_official_bookings'|'booking_anchor_missing_lead'|'malformed_booking_anchor'|'booking_anchor_uncertain'|'pending_booking_anchor'|'canonical_job_disagreement'|'canonical_link_anchor'|'canonical_anchor_conflict'|'compatibility_only';

/** Inventory only: no proposed create/merge/assignment action is produced. All candidate exclusions remain visible. */
export function classifyPoolRows(rows:PoolRow[],facts:CanonicalFacts){
  const forms=unique(facts.forms).map(row=>({...row,model:'FormLead' as const}));
  const calls=unique(facts.calls).map(row=>({...row,model:'CallLead' as const}));
  const leads:Candidate[]=[...forms,...calls],byRef=new Map(leads.map(row=>[`${row.model}:${row.id}`,row]));
  const bookings=unique(facts.bookings),links=unique(facts.record_links.filter(link=>link.state==='active'));
  const snapshots=new Map<string,PoolRow[]>();
  for(const [index,row] of rows.entries()){const key=job(row)??`missing:${index}`;snapshots.set(key,[...(snapshots.get(key)??[]),row]);}
  const results=[...snapshots].map(([key,observations])=>{
    const observed=observations[0]!,normalized=job(observed);
    const exact=normalized?leads.filter(lead=>jobs(lead).includes(normalized)):[];
    const exactBookings=normalized?bookings.filter(booking=>jobs(booking).includes(normalized)):[];
    const officialBookings=exactBookings.filter(official);
    const exactLinks=normalized?links.filter(link=>normalizeJobNo(link.normalized_job_no)===normalized):[];
    const equivalent=normalized?leads.filter(lead=>job(lead)!==normalized&&jobNumbersEquivalent(job(lead),normalized)):[];
    const equivalentBookings=normalized?bookings.filter(booking=>job(booking)!==normalized&&jobNumbersEquivalent(job(booking),normalized)):[];
    const refs=[...officialBookings.flatMap(booking=>{const ref=bookingRef(booking);return ref?[`${ref.model}:${ref.id}`]:[];}),...exactLinks.flatMap(link=>link.lead_ref?[`${link.lead_ref.model}:${link.lead_ref.id}`]:[])];
    const anchors=[...new Set(refs)],warnings:string[]=[];
    let classification:MatchClassification;
    if(!normalized)classification='insufficient_identity';
    else if(exact.some(jobConflict)||exactBookings.some(jobConflict))classification='canonical_job_disagreement';
    else if(exactBookings.some(malformed))classification='malformed_booking_anchor';
    else if(exactBookings.some(anchorUnknown))classification='booking_anchor_uncertain';
    else if(officialBookings.length>1)classification='multiple_official_bookings';
    else if(exactLinks.some(link=>link.disputed)||anchors.length>1||exactLinks.some(link=>link.booking_id&&officialBookings.length===1&&link.booking_id!==officialBookings[0]!.id))classification='canonical_anchor_conflict';
    else if(officialBookings.length===1){
      const booking=officialBookings[0]!;
      const ref=bookingRef(booking);
      classification=ref&&!byRef.has(`${ref.model}:${ref.id}`)?'booking_anchor_missing_lead':'official_booking_anchor';
      if(!ref)warnings.push('official_referral_or_legacy_leadless_has_no_lead_anchor');
    }else if(anchors.length===1)classification=byRef.has(anchors[0]!)?'canonical_link_anchor':'canonical_anchor_conflict';
    else if(exactBookings.length)classification='pending_booking_anchor';
    else if(new Set(exact.map(lead=>lead.model)).size>1)classification='cross_model_collision';
    else if(exact.length>1)classification='ambiguous_same_model';
    else if(exact.length===1)classification='unique_exact';
    else if(equivalent.length||equivalentBookings.length)classification='compatibility_only';
    else classification='unmatched';
    if(exactBookings.length!==officialBookings.length)warnings.push('pending_booking_rows_do_not_establish_official_anchor');
    if(anchors.some(ref=>{const anchored=byRef.get(ref);return anchored&&job(anchored)!==normalized;}))warnings.push('anchor_lead_job_differs_from_observed_job');
    if(new Set(observations.map(row=>JSON.stringify([row.priority,row.source,row.user]))).size>1)warnings.push('observed_priority_source_or_receiver_changed');
    const related=[...new Map([...exact,...anchors.flatMap(ref=>byRef.has(ref)?[byRef.get(ref)!]:[])].map(lead=>[`${lead.model}:${lead.id}`,lead])).values()];
    const priorityCounts:Record<string,number>={};
    for(const candidate of related){const priority=candidate.priority??'unknown';priorityCounts[priority]=(priorityCounts[priority]??0)+1;}
    const excluded=related.filter(lead=>lead.duplicate||lead.bad||lead.created_on_unmatched||lead.cancelled||lead.closed).length;
    if(excluded)warnings.push('excluded_or_closed_identity_candidate_requires_review');
    if(facts.coverage==='partial')warnings.push('canonical_inventory_partial');
    return {job_key:redactKey('job',normalized??key),classification,identity_only:true,admission_eligibility:'not_evaluated' as const,allowed_mutation:false,observations:observations.length,
      exact_form_count:exact.filter(lead=>lead.model==='FormLead').length,exact_call_count:exact.filter(lead=>lead.model==='CallLead').length,
      official_booking_count:officialBookings.length,pending_booking_count:exactBookings.length-officialBookings.length,
      equivalent_only_candidates:equivalent.length+equivalentBookings.length,excluded_candidate_count:excluded,
      cross_model_exact:new Set(exact.map(lead=>lead.model)).size>1,
      canonical_anchor_keys:anchors.map(ref=>redactKey('lead',ref)),priority_counts:priorityCounts,
      other_canonical_priority:related.some(lead=>lead.priority!==undefined&&lead.priority!==null&&lead.priority!=='9'),
      explicit_no_sync_false_candidate_count:related.filter(lead=>lead.no_sync===false).length,
      existing_master_sheet_lineage_count:related.filter(lead=>lead.master_sheet_lineage==='present').length,
      candidate_state_counts:{duplicate:related.filter(lead=>lead.duplicate).length,bad:related.filter(lead=>lead.bad).length,unmatched_anchor:related.filter(lead=>lead.created_on_unmatched).length,cancelled:related.filter(lead=>lead.cancelled).length,closed:related.filter(lead=>lead.closed).length},
      source_scope_checked:false,manual_assignment_policy_checked:false,
      warnings,
    };
  });
  const counts:Record<string,number>={};for(const result of results)counts[result.classification]=(counts[result.classification]??0)+1;
  return {canonical_coverage:facts.coverage,observed_rows:rows.length,distinct_job_or_missing_identity_count:results.length,
    repeated_job_observation_count:results.filter(result=>result.observations>1).length,
    cross_model_exact_count:results.filter(result=>result.cross_model_exact).length,
    other_canonical_priority_count:results.filter(result=>result.other_canonical_priority).length,
    classifications:counts,collisions:results,mutation_count:0 as const};
}
