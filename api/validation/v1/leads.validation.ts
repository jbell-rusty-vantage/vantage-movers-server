import { z } from "zod";
import {
  booleanInput,
  emailSchema,
  localSchema,
  looseEmailString,
  moveSizeSchema,
  nonEmptyString,
  optionalDate,
  optionalNumber,
  optionalString,
  requireAtLeastOne,
  sourceCompanySchema,
  zipSchema,
} from "./common";

/**
 * Form lead and call lead create / update / search schemas.
 *
 * Pairs with `api/services/leads/` and `api/services/search/`. The
 * identity refinements live here because they are specific to the
 * search and call-lead create payloads.
 */

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
  email: looseEmailString,
  phone_number: nonEmptyString,
  quoted: booleanInput.optional(),
  cubic_feet: optionalNumber,
};

export const createFormLeadSchema = z
  .object({
    ...formLeadFields,
    source_company: sourceCompanySchema.default("not_provided"),
    ref_no: nonEmptyString.default("not provided"),
    crm_company_label: nonEmptyString.default("Get Movers"),
    post_to_granot: booleanInput.default(true),
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

export type CreateFormLeadInput = z.infer<typeof createFormLeadSchema>;
export type UpdateFormLeadInput = z.infer<typeof updateFormLeadSchema>;
export type SearchFormLeadsInput = z.infer<typeof searchFormLeadsSchema>;
export type CreateCallLeadInput = z.infer<typeof createCallLeadSchema>;
export type UpdateCallLeadInput = z.infer<typeof updateCallLeadSchema>;
export type SearchCallLeadsInput = z.infer<typeof searchCallLeadsSchema>;
