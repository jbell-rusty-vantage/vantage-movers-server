import {z} from 'zod';

const id=z.string().trim().min(1).max(128);
const text=z.string().trim().max(256).nullable().optional();
const leadRef=z.object({model:z.enum(['FormLead','CallLead']),id}).strict();
const rawBookingRef=z.object({model:text,id:text}).strict();
const lead=z.object({id,job_no:text,normalized_job_no:text,ref_no:text,priority:text,duplicate:z.boolean().optional(),bad:z.boolean().optional(),created_on_unmatched:z.boolean().optional(),booked_id:text,receiver_agent_id:text,receiver_source:text,cancelled:z.boolean().optional(),closed:z.boolean().optional(),source_company_key:text,source_granularity_key:text,no_sync:z.boolean().optional(),master_sheet_lineage:z.enum(['present','absent','unknown']).default('unknown')}).strict();
export const canonicalFactsSchema=z.object({
  coverage:z.enum(['synthetic_complete','complete_for_jobs','partial']).default('partial'),
  forms:z.array(lead),calls:z.array(lead),
  bookings:z.array(z.object({id,job_no:text,normalized_job_no:text,lead_ref:rawBookingRef.nullable().optional(),anchor_evidence:z.enum(['complete','empty','partial','unknown']).default('unknown'),raw_lead_ref_present:z.boolean().optional(),raw_lead_model_present:z.boolean().optional(),is_referral_booking:z.boolean().optional(),is_leadless_booking:z.boolean().optional(),booking_origin:text,cancelled:z.boolean().optional()}).strict()),
  record_links:z.array(z.object({id,normalized_job_no:z.string(),lead_ref:leadRef.nullable().optional(),booking_id:text,disputed:z.boolean().optional(),state:z.enum(['active','inactive']).default('active')}).strict()).default([]),
}).strict();
export type CanonicalFacts=z.infer<typeof canonicalFactsSchema>;
export type CanonicalFactsInput=z.input<typeof canonicalFactsSchema>;
export type CanonicalLead=CanonicalFacts['forms'][number];
export type CanonicalBooking=CanonicalFacts['bookings'][number];
const isoDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const captureBundleSchema=z.object({
  provenance:z.object({kind:z.enum(['synthetic_replay','sanitized_live_capture']),captured_at:z.string().datetime(),evidence_ref:z.string().min(1),lease_scope:z.literal('granot:automation:account').optional(),lease_verified:z.boolean().optional()}).strict(),
  as_of:z.string().datetime(),form_html:z.string().max(10*1024*1024),
  windows:z.array(z.object({from:isoDate,to:isoDate,pages:z.array(z.object({html:z.string().max(10*1024*1024)}).strict()).min(1).max(500)}).strict()).max(31),
  canonical:canonicalFactsSchema,
}).strict();
export type CaptureBundle=z.infer<typeof captureBundleSchema>;
export type PoolRow={job_no:string|null;open_date:string|null;priority:string|null;source:string|null;user:string|null;ref_no:string|null};
export type ParsedPoolPage={
  schema:'table'|'explicit_empty'|'missing'|'invalid'|'ambiguous_empty';
  rows:PoolRow[];reported_total:number|null;page_number:number|null;page_count:number|null;
  pagination_controls:boolean;unsupported_pagination:boolean;diagnostics:string[];headers:string[];
};
