import { z } from "zod";
import { FORM_LEAD_BAD_LEAD_REASONS } from "../../config/domain";
import {
  booleanInput,
  emailSchema,
  localSchema,
  looseEmailString,
  moveSizeSchema,
  nonEmptyString,
  objectIdSchema,
  optionalDate,
  optionalFloridaCalendarDate,
  optionalNumber,
  optionalString,
  requireAtLeastOne,
  sourceCompanySchema,
  zipSchema,
} from "./common";

/**
 * How a lead's `receiver_agent` attribution was made. Mirrors the extension's
 * upsert cascade: a pattern match against Granot's `user`/`rep` column, a
 * manual pick from the candidate/search list, a brand-new agent created on
 * the spot, or a direct API call outside the extension flow.
 */
export const receiverAgentSourceSchema = z.enum([
  "extension_match",
  "extension_selected",
  "extension_created",
  "extension_crm_username_match",
  "manual",
]);

const receiverAgentFields = {
  receiver_agent: objectIdSchema.optional(),
  receiver_agent_source: receiverAgentSourceSchema.optional(),
  receiver_agent_source_value: optionalString,
};

/**
 * Form lead and call lead create / update / search schemas.
 *
 * Pairs with `api/services/leads/` and `api/services/search/`. The
 * identity refinements live here because they are specific to the
 * search and call-lead create payloads.
 */

function requireAtLeastOneTruthySearchField(value: Record<string, unknown>) {
  return ["ref_no", "name", "first_name", "last_name", "email", "phone_number"].some((field) =>
    Boolean(value[field]),
  );
}

function requireAtLeastOneTruthyCallLeadSearchField(value: Record<string, unknown>) {
  return ["phone_number", "job_no", "email", "name", "first_name", "last_name"].some((field) =>
    Boolean(value[field]),
  );
}

function hasLeadName(value: Record<string, unknown>) {
  return Boolean(value.name || value.first_name || value.last_name);
}

function requireCallLeadIdentity(value: Record<string, unknown>) {
  return Boolean(value.phone_number || value.job_no);
}

const optionalFormLeadRefNo = z.preprocess(
  (value: string | undefined) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  nonEmptyString.default("not provided"),
);

const formLeadFields = {
  source_company: sourceCompanySchema,
  company_slug: optionalString,
  source_granularity_key: optionalString,
  name: optionalString,
  first_name: optionalString,
  last_name: optionalString,
  source_company_site: optionalString,
  timestamp: optionalDate,
  pickup_city: optionalString,
  pickup_zip: zipSchema,
  delivery_city: optionalString,
  destination_zip: zipSchema,
  pickup_state: optionalString,
  delivery_state: optionalString,
  move_size: moveSizeSchema,
  move_date: optionalFloridaCalendarDate,
  ref_no: optionalFormLeadRefNo,
  email: looseEmailString,
  phone_number: nonEmptyString,
  quoted: booleanInput.optional(),
  cubic_feet: optionalNumber,
  ...receiverAgentFields,
};

export const createFormLeadSchema = z
  .object({
    ...formLeadFields,
    source_company: sourceCompanySchema.default("not_provided"),
    ref_no: optionalFormLeadRefNo,
    crm_company_label: nonEmptyString.default("Main Site Forms"),
    post_to_granot: booleanInput.default(false),
    // Accepted for logging only until Twilio campaign approval; not persisted yet.
    sms_consent: booleanInput.optional(),
  })
  .strict()
  .refine(hasLeadName, "Form lead requires name, first_name, or last_name");

export const updateFormLeadSchema = z
  .object({
    ...formLeadFields,
    duplicate: booleanInput.optional(),
    bad_lead: z.enum(FORM_LEAD_BAD_LEAD_REASONS).nullable().optional(),
  })
  .partial()
  .strict()
  .refine(requireAtLeastOne, "At least one form lead field must be provided");

export const searchFormLeadsSchema = z
  .object({
    ref_no: optionalString,
    name: optionalString,
    first_name: optionalString,
    last_name: optionalString,
    email: looseEmailString,
    phone_number: optionalString,
    limit: z.coerce.number().int().min(1).max(25).optional(),
    include_duplicates: booleanInput.default(false),
  })
  .strict()
  .refine(
    requireAtLeastOneTruthySearchField,
    "At least one of ref_no, name, email, or phone_number must be provided",
  );

const callLeadFields = {
  source_company: sourceCompanySchema,
  company_slug: optionalString,
  source_granularity_key: optionalString,
  source_company_site: optionalString,
  timestamp: optionalDate,
  job_no: optionalString,
  name: optionalString,
  first_name: optionalString,
  last_name: optionalString,
  email: emailSchema,
  phone_number: optionalString,
  duration: optionalNumber,
  start_time: optionalDate,
  end_time: optionalDate,
  local: localSchema.optional(),
  pickup_city: optionalString,
  pickup_zip: zipSchema.optional(),
  delivery_city: optionalString,
  delivery_zip: zipSchema.optional(),
  pickup_state: optionalString,
  delivery_state: optionalString,
  cubic_feet: optionalNumber,
  ...receiverAgentFields,
};

export const createCallLeadSchema = z
  .object({
    ...callLeadFields,
    source_company: sourceCompanySchema.default("not_provided"),
  })
  .strict()
  .refine(requireCallLeadIdentity, "Call lead requires either phone_number or job_no");

export const updateCallLeadSchema = z
  .object({
    ...callLeadFields,
    duplicate: booleanInput.optional(),
  })
  .partial()
  .strict()
  .refine(requireAtLeastOne, "At least one call lead field must be provided");

export const searchCallLeadsSchema = z
  .object({
    phone_number: optionalString,
    job_no: optionalString,
    email: looseEmailString,
    name: optionalString,
    first_name: optionalString,
    last_name: optionalString,
    limit: z.coerce.number().int().min(1).max(25).optional(),
  })
  .strict()
  .refine(
    requireAtLeastOneTruthyCallLeadSearchField,
    "At least one of phone_number, job_no, email, or name must be provided",
  );

/**
 * Browse / list query for the extension Search workspace. Every filter is
 * optional so an empty query lists the latest leads ("view all"), `q` is a
 * loose full-text match across the lead's identifying fields, and
 * `source_company` can be used as a standalone filter. Distinct from the scored
 * `searchFormLeadsSchema`, which is tuned for fallback id resolution.
 */
export const browseFormLeadsQuerySchema = z
  .object({
    q: optionalString,
    source_company: optionalString,
    lead_source_company: objectIdSchema.optional(),
    source_granularity_key: optionalString,
    name: optionalString,
    email: looseEmailString,
    phone_number: optionalString,
    booked: booleanInput.optional(),
    cancelled: booleanInput.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    skip: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const browseCallLeadsQuerySchema = z
  .object({
    q: optionalString,
    source_company: optionalString,
    lead_source_company: objectIdSchema.optional(),
    source_granularity_key: optionalString,
    name: optionalString,
    email: looseEmailString,
    phone_number: optionalString,
    job_no: optionalString,
    booked: booleanInput.optional(),
    cancelled: booleanInput.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    skip: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type CreateFormLeadInput = z.infer<typeof createFormLeadSchema>;
export type UpdateFormLeadInput = z.infer<typeof updateFormLeadSchema>;
export type SearchFormLeadsInput = z.infer<typeof searchFormLeadsSchema>;
export type CreateCallLeadInput = z.infer<typeof createCallLeadSchema>;
export type UpdateCallLeadInput = z.infer<typeof updateCallLeadSchema>;
export type SearchCallLeadsInput = z.infer<typeof searchCallLeadsSchema>;
export type BrowseFormLeadsQuery = z.infer<typeof browseFormLeadsQuerySchema>;
export type BrowseCallLeadsQuery = z.infer<typeof browseCallLeadsQuerySchema>;
