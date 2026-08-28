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
  "granot_username_match",
  "best_relocation_sheet",
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
  return [
    "ref_no",
    "name",
    "first_name",
    "last_name",
    "email",
    "phone_number",
  ].some((field) => Boolean(value[field]));
}

function requireAtLeastOneTruthyCallLeadSearchField(
  value: Record<string, unknown>,
) {
  return [
    "phone_number",
    "job_no",
    "email",
    "name",
    "first_name",
    "last_name",
  ].some((field) => Boolean(value[field]));
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

const optionalLeadId = z.preprocess(
  (value: unknown) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z
    .string()
    .trim()
    .regex(
      /^(?:LID[0-9a-f]{13}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
      "Lead ID must be a legacy LID or UUID",
    )
    .optional(),
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
  lid: optionalLeadId,
  email: looseEmailString,
  phone_number: nonEmptyString,
  over_2000: booleanInput.optional(),
  over_4000: booleanInput.optional(),
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
    local: localSchema.optional(),
    ingestion_source: z.literal("best_relocation_sheet").optional(),
    // Parsed here before the service applies the strict true-only messaging gate.
    sms_consent: booleanInput.optional(),
    wordpress_submission_key: z
      .string()
      .trim()
      .min(8)
      .max(128)
      .optional(),
  })
  .strict()
  .refine(
    (value) => value.local === undefined || value.ingestion_source === "best_relocation_sheet",
    "local override is restricted to Best Relocation sheet ingestion",
  )
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

export const resolveGranotFormLeadSchema = z
  .object({
    ref_no: optionalString,
    name: optionalString,
    email: looseEmailString,
    phone_number: optionalString,
    source_label: nonEmptyString,
    prior: optionalString,
  })
  .strict()
  .refine(
    requireAtLeastOneTruthySearchField,
    "At least one of ref_no, name, email, or phone_number must be provided",
  );

const granotFormLeadPatchSchema = z
  .object({
    quoted: booleanInput.optional(),
    cubic_feet: optionalNumber,
    pickup_city: optionalString,
    pickup_zip: zipSchema.optional(),
    pickup_state: optionalString,
    delivery_city: optionalString,
    destination_zip: zipSchema.optional(),
    delivery_state: optionalString,
    receiver_agent: objectIdSchema.optional(),
    receiver_agent_source: z
      .literal("extension_crm_username_match")
      .optional(),
    receiver_agent_source_value: optionalString,
  })
  .strict()
  .refine(requireAtLeastOne, "At least one Granot sync field must be provided")
  .superRefine((patch, ctx) => {
    const hasReceiverProvenance =
      patch.receiver_agent_source !== undefined ||
      patch.receiver_agent_source_value !== undefined;
    if (
      (patch.receiver_agent !== undefined || hasReceiverProvenance) &&
      (
        patch.receiver_agent === undefined ||
        patch.receiver_agent_source !== "extension_crm_username_match" ||
        !patch.receiver_agent_source_value
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["receiver_agent"],
        message:
          "Granot receiver updates require receiver_agent, extension provenance, and source value together",
      });
    }
  });

export const granotFormLeadSyncSchema = z
  .object({
    patch: granotFormLeadPatchSchema,
    expected_source_company: sourceCompanySchema,
    expected_snapshot: z
      .object({
        quoted: z.boolean().nullable(),
        cubic_feet: z.number().nullable(),
        pickup_city: z.string().nullable(),
        pickup_zip: z.string().nullable(),
        pickup_state: z.string().nullable(),
        delivery_city: z.string().nullable(),
        destination_zip: z.string().nullable(),
        delivery_state: z.string().nullable(),
        receiver_agent: objectIdSchema.nullable(),
      })
      .strict(),
  })
  .strict();

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
  over_2000: booleanInput.optional(),
  over_4000: booleanInput.optional(),
  ...receiverAgentFields,
};

export const createCallLeadSchema = z
  .object({
    ...callLeadFields,
    source_company: sourceCompanySchema.default("not_provided"),
  })
  .strict()
  .refine(
    requireCallLeadIdentity,
    "Call lead requires either phone_number or job_no",
  );

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
export type ResolveGranotFormLeadInput = z.infer<
  typeof resolveGranotFormLeadSchema
>;
export type GranotFormLeadSyncInput = z.infer<
  typeof granotFormLeadSyncSchema
>;
export type CreateCallLeadInput = z.infer<typeof createCallLeadSchema>;
export type UpdateCallLeadInput = z.infer<typeof updateCallLeadSchema>;
export type SearchCallLeadsInput = z.infer<typeof searchCallLeadsSchema>;
export type BrowseFormLeadsQuery = z.infer<typeof browseFormLeadsQuerySchema>;
export type BrowseCallLeadsQuery = z.infer<typeof browseCallLeadsQuerySchema>;
