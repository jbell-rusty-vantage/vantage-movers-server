import { z } from "zod";
import { LEAD_MODELS, LOCAL_TYPES, MOVE_SIZES, SOURCE_COMPANIES } from "../config/domain";

const nonEmptyString = z.string().trim().min(1);
const optionalString = z.string().trim().optional();
const optionalDate = z.coerce.date().optional();
const requiredDate = z.coerce.date();
const finiteNumber = z.coerce.number().finite();
const optionalNumber = z.coerce.number().finite().optional();

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
  name: optionalString,
  email: emailSchema,
  phone_number: nonEmptyString,
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
  .strict();

export const updateCallLeadSchema = z
  .object(callLeadFields)
  .partial()
  .strict()
  .refine(requireAtLeastOne, "At least one call lead field must be provided");

const bookedLeadFields = {
  timestamp: optionalDate,
  agent: nonEmptyString,
  book_date: requiredDate,
  job_no: nonEmptyString,
  lead_ref: objectIdSchema,
  lead_model: leadModelSchema,
  binder_amount: finiteNumber,
  deposit_amount: finiteNumber,
  merchant: nonEmptyString,
  source: nonEmptyString,
  local: localSchema.optional(),
};

export const createBookedLeadSchema = z.object(bookedLeadFields).strict();

export const updateBookedLeadSchema = z
  .object({
    timestamp: bookedLeadFields.timestamp,
    agent: bookedLeadFields.agent,
    book_date: bookedLeadFields.book_date,
    job_no: bookedLeadFields.job_no,
    binder_amount: bookedLeadFields.binder_amount,
    deposit_amount: bookedLeadFields.deposit_amount,
    merchant: bookedLeadFields.merchant,
    source: bookedLeadFields.source,
    local: bookedLeadFields.local,
  })
  .partial()
  .strict()
  .refine(requireAtLeastOne, "At least one booked lead field must be provided");

const cancelledLeadFields = {
  timestamp: optionalDate,
  booked_lead: objectIdSchema.optional(),
  lead_id: objectIdSchema.optional(),
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
export type CreateBookedLeadInput = z.infer<typeof createBookedLeadSchema>;
export type UpdateBookedLeadInput = z.infer<typeof updateBookedLeadSchema>;
export type CreateCancelledLeadInput = z.infer<typeof createCancelledLeadSchema>;
export type UpdateCancelledLeadInput = z.infer<typeof updateCancelledLeadSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
