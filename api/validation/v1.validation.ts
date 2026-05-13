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

export const createFormLeadSchema = z
  .object({
    source_company: sourceCompanySchema.default("not_provided"),
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
    ref_no: nonEmptyString.default("not provided"),
    email: emailSchema,
    phone_number: nonEmptyString,
    quoted: z.coerce.boolean().optional(),
    cubic_feet: optionalNumber,
  })
  .strict();

export const updateFormLeadSchema = createFormLeadSchema
  .partial()
  .strict()
  .refine(requireAtLeastOne, "At least one form lead field must be provided");

export const createCallLeadSchema = z
  .object({
    source_company: sourceCompanySchema.default("not_provided"),
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
  })
  .strict();

export const updateCallLeadSchema = createCallLeadSchema
  .partial()
  .strict()
  .refine(requireAtLeastOne, "At least one call lead field must be provided");

export const createBookedLeadSchema = z
  .object({
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
  })
  .strict();

export const updateBookedLeadSchema = createBookedLeadSchema
  .omit({ lead_ref: true, lead_model: true })
  .partial()
  .strict()
  .refine(requireAtLeastOne, "At least one booked lead field must be provided");

export const createCancelledLeadSchema = z
  .object({
    timestamp: optionalDate,
    booked_lead: objectIdSchema,
    reason: optionalString,
    notes: optionalString,
    cancelled_by: optionalString,
  })
  .strict();

export const updateCancelledLeadSchema = createCancelledLeadSchema
  .omit({ booked_lead: true })
  .partial()
  .strict()
  .refine(requireAtLeastOne, "At least one cancelled lead field must be provided");

export const createCustomerSchema = z
  .object({
    full_name: nonEmptyString,
    phone_number: nonEmptyString,
    email: emailSchema,
  })
  .strict();

export const updateCustomerSchema = createCustomerSchema
  .partial()
  .strict()
  .refine(requireAtLeastOne, "At least one customer field must be provided");

export type CreateFormLeadInput = z.infer<typeof createFormLeadSchema>;
export type UpdateFormLeadInput = z.infer<typeof updateFormLeadSchema>;
export type CreateCallLeadInput = z.infer<typeof createCallLeadSchema>;
export type UpdateCallLeadInput = z.infer<typeof updateCallLeadSchema>;
export type CreateBookedLeadInput = z.infer<typeof createBookedLeadSchema>;
export type UpdateBookedLeadInput = z.infer<typeof updateBookedLeadSchema>;
export type CreateCancelledLeadInput = z.infer<typeof createCancelledLeadSchema>;
export type UpdateCancelledLeadInput = z.infer<typeof updateCancelledLeadSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
