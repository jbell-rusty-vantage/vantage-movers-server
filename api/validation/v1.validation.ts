import { z } from "zod";
import { LEAD_MODELS, LOCAL_TYPES, MOVE_SIZES, SOURCE_COMPANIES } from "../config/domain";

const nonEmptyString = z.string().trim().min(1);
const optionalString = z.string().trim().optional();
const optionalDate = z.coerce.date().optional();
const requiredDate = z.coerce.date();
const finiteNumber = z.coerce.number().finite();
const optionalNumber = z.coerce.number().finite().optional();
const moneyAmount = z.coerce.number().finite().min(0);

export const objectIdSchema = z.string().trim().regex(/^[a-f\d]{24}$/i, "Invalid Mongo ObjectId");
export const sourceCompanySchema = z.string().trim().min(1);
export const localSchema = z.enum(LOCAL_TYPES);
export const leadModelSchema = z.enum(LEAD_MODELS);
export const moveSizeSchema = z.enum(MOVE_SIZES);

const zipSchema = z.string().trim().regex(/^\d{5}$/, "Zip code must be exactly 5 digits");
const emailSchema = z.email().trim().toLowerCase().optional();

function requireAtLeastOne(value: Record<string, unknown>) {
  return Object.keys(value).length > 0;
}

function requireAtLeastOneTruthySearchField(value: Record<string, unknown>) {
  return ["ref_no", "name", "email", "phone_number"].some((field) => Boolean(value[field]));
}

function requireAtLeastOneTruthyCallLeadSearchField(value: Record<string, unknown>) {
  return ["phone_number", "job_no", "email", "name"].some((field) => Boolean(value[field]));
}

function requireCallLeadIdentity(value: Record<string, unknown>) {
  return Boolean(value.phone_number || value.job_no);
}

const formLeadFields = {
  source_company: sourceCompanySchema,
  name: nonEmptyString,
  source_company_site: optionalString,
  timestamp: optionalDate,
  lid: optionalString,
  pickup_zip: zipSchema,
  destination_zip: zipSchema,
  pickup_state: optionalString,
  delivery_state: optionalString,
  move_size: moveSizeSchema,
  move_date: optionalDate,
  ref_no: nonEmptyString,
  email: emailSchema,
  phone_number: nonEmptyString,
  quoted: z.coerce.boolean().optional(),
  cubic_feet: optionalNumber,
};

export const createFormLeadSchema = z
  .object({
    ...formLeadFields,
    source_company: sourceCompanySchema.default("not_provided"),
    ref_no: nonEmptyString.default("not provided"),
    crm_company_label: nonEmptyString.default("Get Movers"),
    post_to_granot: z.coerce.boolean().default(true),
  })
  .strict();

export const updateFormLeadSchema = z
  .object(formLeadFields)
  .partial()
  .strict()
  .refine(requireAtLeastOne, "At least one form lead field must be provided");

export const searchFormLeadsSchema = z
  .object({
    ref_no: optionalString,
    name: optionalString,
    email: emailSchema,
    phone_number: optionalString,
    limit: z.coerce.number().int().min(1).max(25).optional(),
  })
  .strict()
  .refine(
    requireAtLeastOneTruthySearchField,
    "At least one of ref_no, name, email, or phone_number must be provided",
  );

const callLeadFields = {
  source_company: sourceCompanySchema,
  source_company_site: optionalString,
  timestamp: optionalDate,
  job_no: optionalString,
  name: optionalString,
  email: emailSchema,
  phone_number: optionalString,
  duration: optionalNumber,
  start_time: optionalDate,
  end_time: optionalDate,
  local: localSchema.optional(),
  pickup_zip: zipSchema.optional(),
  delivery_zip: zipSchema.optional(),
  pickup_state: optionalString,
  delivery_state: optionalString,
  cubic_feet: optionalNumber,
};

export const createCallLeadSchema = z
  .object({
    ...callLeadFields,
    source_company: sourceCompanySchema.default("not_provided"),
  })
  .strict()
  .refine(requireCallLeadIdentity, "Call lead requires either phone_number or job_no");

export const updateCallLeadSchema = z
  .object(callLeadFields)
  .partial()
  .strict()
  .refine(requireAtLeastOne, "At least one call lead field must be provided");

export const searchCallLeadsSchema = z
  .object({
    phone_number: optionalString,
    job_no: optionalString,
    email: emailSchema,
    name: optionalString,
    limit: z.coerce.number().int().min(1).max(25).optional(),
  })
  .strict()
  .refine(
    requireAtLeastOneTruthyCallLeadSearchField,
    "At least one of phone_number, job_no, email, or name must be provided",
  );

const callLeadEnrichmentRowSchema = z
  .object({
    row_id: nonEmptyString,
    row_index: z.coerce.number().int().min(0).optional(),
    job_no: optionalString,
    customer: optionalString,
    phone: optionalString,
    email: optionalString,
    from_zip: optionalString,
    to_zip: optionalString,
    est_cf: optionalString,
  })
  .strict();

export const callLeadEnrichmentBatchSchema = z
  .object({
    rows: z.array(callLeadEnrichmentRowSchema).min(1).max(100),
  })
  .strict();

const bookedCallLeadReconciliationRowSchema = z
  .object({
    row_id: nonEmptyString,
    row_index: z.coerce.number().int().min(0).optional(),
    section: z.enum(["bookedJobs", "followUpEstimates"]).optional(),
    job_no: optionalString,
    source: optionalString,
    prior: optionalString,
    book_date: optionalString,
    customer: optionalString,
    phone: optionalString,
    email: optionalString,
    from_zip: optionalString,
    to_zip: optionalString,
    est_cf: optionalString,
  })
  .strict();

export const bookedCallLeadReconciliationBatchSchema = z
  .object({
    rows: z.array(bookedCallLeadReconciliationRowSchema).min(1).max(100),
  })
  .strict();

const bookedLeadFields = {
  timestamp: optionalDate,
  book_date: requiredDate,
  job_no: nonEmptyString,
  lead_ref: objectIdSchema,
  lead_model: leadModelSchema,
  total_binder_amount: moneyAmount.optional(),
  deposit_amount: finiteNumber,
  merchant: nonEmptyString,
  source: nonEmptyString,
  local: localSchema.optional(),
  submission_id: optionalString,
};

const agentAllocationInputSchema = z
  .object({
    agent_name: nonEmptyString,
    binder_amount: moneyAmount,
  })
  .strict();

function binderTotalMatches(value: {
  total_binder_amount?: number;
  agent_allocations?: { binder_amount: number }[];
}) {
  if (value.total_binder_amount === undefined || !value.agent_allocations) {
    return true;
  }
  const allocationTotal = value.agent_allocations.reduce(
    (sum, allocation) => sum + allocation.binder_amount,
    0,
  );
  return Math.abs(allocationTotal - value.total_binder_amount) < 0.001;
}

export const createBookedLeadSchema = z
  .object({
    ...bookedLeadFields,
    agent_allocations: z.array(agentAllocationInputSchema).min(1),
  })
  .strict()
  .refine(binderTotalMatches, "total_binder_amount must equal the sum of agent binder amounts");

const bookedLeadFromSourceSharedFields = {
  timestamp: bookedLeadFields.timestamp,
  book_date: bookedLeadFields.book_date,
  deposit_amount: bookedLeadFields.deposit_amount,
  merchant: bookedLeadFields.merchant,
  source_company: optionalString,
  submission_id: bookedLeadFields.submission_id,
  agent: nonEmptyString,
  split_agent: optionalString,
  binder_amount: moneyAmount,
};

export const createBookedLeadFromSourceSchema = z.discriminatedUnion("lead_type", [
  z
    .object({
      ...bookedLeadFromSourceSharedFields,
      lead_type: z.literal("FormLead"),
      form_lead_id: objectIdSchema,
      job_no: bookedLeadFields.job_no,
    })
    .strict(),
  z
    .object({
      ...bookedLeadFromSourceSharedFields,
      lead_type: z.literal("CallLead"),
      call_job_no: nonEmptyString,
      call_phone_number: optionalString,
    })
    .strict(),
]);

export const updateBookedLeadSchema = z
  .object({
    timestamp: bookedLeadFields.timestamp,
    book_date: bookedLeadFields.book_date,
    job_no: bookedLeadFields.job_no,
    total_binder_amount: bookedLeadFields.total_binder_amount,
    deposit_amount: bookedLeadFields.deposit_amount,
    merchant: bookedLeadFields.merchant,
    source: bookedLeadFields.source,
    local: bookedLeadFields.local,
    submission_id: bookedLeadFields.submission_id,
    agent_allocation_mode: z.enum(["patch", "replace"]).optional(),
    agent_allocations: z.array(agentAllocationInputSchema).min(1).optional(),
  })
  .partial()
  .strict()
  .refine(binderTotalMatches, "total_binder_amount must equal the sum of agent binder amounts")
  .refine(requireAtLeastOne, "At least one booked lead field must be provided");

const cancelledLeadFields = {
  timestamp: optionalDate,
  cancel_date: optionalDate,
  booked_lead: objectIdSchema.optional(),
  lead_id: objectIdSchema.optional(),
  refund_amount: finiteNumber,
  reason: optionalString,
  notes: optionalString,
  cancelled_by: optionalString,
};

export const createCancelledLeadSchema = z
  .object(cancelledLeadFields)
  .strict()
  .refine(
    (value) => Boolean(value.booked_lead || value.lead_id),
    "Either booked_lead or lead_id must be provided",
  );

export const updateCancelledLeadSchema = z
  .object({
    timestamp: cancelledLeadFields.timestamp,
    cancel_date: cancelledLeadFields.cancel_date,
    refund_amount: cancelledLeadFields.refund_amount,
    reason: cancelledLeadFields.reason,
    notes: cancelledLeadFields.notes,
    cancelled_by: cancelledLeadFields.cancelled_by,
  })
  .partial()
  .strict()
  .refine(requireAtLeastOne, "At least one cancelled lead field must be provided");

const customerFields = {
  full_name: nonEmptyString,
  phone_number: nonEmptyString,
  email: emailSchema,
};

export const createCustomerSchema = z.object(customerFields).strict();

export const updateCustomerSchema = z
  .object(customerFields)
  .partial()
  .strict()
  .refine(requireAtLeastOne, "At least one customer field must be provided");

export type CreateFormLeadInput = z.infer<typeof createFormLeadSchema>;
export type UpdateFormLeadInput = z.infer<typeof updateFormLeadSchema>;
export type SearchFormLeadsInput = z.infer<typeof searchFormLeadsSchema>;
export type CreateCallLeadInput = z.infer<typeof createCallLeadSchema>;
export type UpdateCallLeadInput = z.infer<typeof updateCallLeadSchema>;
export type SearchCallLeadsInput = z.infer<typeof searchCallLeadsSchema>;
export type CallLeadEnrichmentBatchInput = z.infer<typeof callLeadEnrichmentBatchSchema>;
export type CallLeadEnrichmentRowInput = CallLeadEnrichmentBatchInput["rows"][number];
export type BookedCallLeadReconciliationBatchInput = z.infer<
  typeof bookedCallLeadReconciliationBatchSchema
>;
export type BookedCallLeadReconciliationRowInput =
  BookedCallLeadReconciliationBatchInput["rows"][number];
export type CreateBookedLeadInput = z.infer<typeof createBookedLeadSchema>;
export type CreateBookedLeadFromSourceInput = z.infer<typeof createBookedLeadFromSourceSchema>;
export type UpdateBookedLeadInput = z.infer<typeof updateBookedLeadSchema>;
export type CreateCancelledLeadInput = z.infer<typeof createCancelledLeadSchema>;
export type UpdateCancelledLeadInput = z.infer<typeof updateCancelledLeadSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
