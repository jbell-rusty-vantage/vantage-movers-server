import { z } from "zod";
import {
  booleanInput,
  localSchema,
  moneyAmount,
  nonEmptyString,
  optionalString,
  requireAtLeastOne,
} from "./common";

export const adminDatabaseScopeSchema = z
  .enum(["production", "historical", "combined"])
  .default("production");

const directionSchema = z
  .preprocess((value) => (typeof value === "string" ? value.toLowerCase() : value), z.enum(["asc", "desc"]))
  .default("desc");

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional(),
);

const optionalDateString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.date().optional(),
);

const optionalNumberInput = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().optional(),
);

const optionalObjectIdString = optionalTrimmedString.refine(
  (value) => value === undefined || /^[a-f\d]{24}$/i.test(value),
  "Invalid Mongo ObjectId",
);

const adminQueryBase = {
  database_scope: adminDatabaseScopeSchema,
  q: optionalTrimmedString,
  from: optionalDateString,
  to: optionalDateString,
  date_field: optionalTrimmedString,
  source_company: optionalTrimmedString,
  lead_source_company: optionalObjectIdString,
  source_granularity_key: optionalTrimmedString,
  source: optionalTrimmedString,
  source_label: optionalTrimmedString,
  agent: optionalTrimmedString,
  receiver_agent: optionalObjectIdString,
  customer_name: optionalTrimmedString,
  customer_phone: optionalTrimmedString,
  customer_email: optionalTrimmedString,
  job_no: optionalTrimmedString,
  merchant: optionalTrimmedString,
  local: optionalTrimmedString,
  booked: booleanInput.optional(),
  cancelled: booleanInput.optional(),
  leadless: booleanInput.optional(),
  pickup_city: optionalTrimmedString,
  pickup_state: optionalTrimmedString,
  pickup_zip: optionalTrimmedString,
  delivery_city: optionalTrimmedString,
  delivery_state: optionalTrimmedString,
  delivery_zip: optionalTrimmedString,
  deposit_min: optionalNumberInput,
  deposit_max: optionalNumberInput,
  binder_min: optionalNumberInput,
  binder_max: optionalNumberInput,
  refund_min: optionalNumberInput,
  refund_max: optionalNumberInput,
  reason: optionalTrimmedString,
  cancelled_by: optionalTrimmedString,
  name: optionalTrimmedString,
  email: optionalTrimmedString,
  phone_number: optionalTrimmedString,
  ref_no: optionalTrimmedString,
  move_size: optionalTrimmedString,
  duplicate: booleanInput.optional(),
  active: booleanInput.optional(),
  role: optionalTrimmedString,
  limit: z.coerce.number().int().min(1).max(250).default(50),
  page: z.coerce.number().int().min(1).default(1),
  sort: optionalTrimmedString,
  direction: directionSchema,
};

export const adminBrowseQuerySchema = z.object(adminQueryBase).strip();

export const adminSearchQuerySchema = z
  .object({
    database_scope: adminDatabaseScopeSchema,
    q: z.string().trim().min(1),
    limit: z.coerce.number().int().min(1).max(25).default(5),
  })
  .strip();

export const catalogListQuerySchema = z
  .object({
    include_inactive: booleanInput.optional(),
  })
  .strip();

export const catalogCreateSchema = z
  .object({
    name: nonEmptyString,
    active: booleanInput.optional(),
    role: nonEmptyString.optional(),
    granot_crm_username: nonEmptyString.optional(),
    // Optional provenance override. Defaults to the catalog's configured
    // `created_from` (see `CATALOGS` in `catalog.service.ts`) when omitted;
    // used by callers like the extension's sales-rep upsert dialog to tag
    // agents created that way (`extension_sales_rep_match`) instead of
    // `admin`.
    created_from: nonEmptyString.optional(),
  })
  .strict();

export const catalogUpdateSchema = catalogCreateSchema
  .partial()
  .refine(requireAtLeastOne, "At least one catalog field must be provided");

export const cplRateUpdateSchema = z
  .object({
    cpl: moneyAmount,
  })
  .strict();

const stringListSchema = z.array(nonEmptyString).default([]);

export const leadSourceGranularitySchema = z
  .object({
    granularity_key: nonEmptyString,
    channel: z.enum(["form", "call"]),
    owner_label: nonEmptyString,
    crm_label: nonEmptyString,
    aliases: stringListSchema.optional(),
    active: booleanInput.optional(),
    cpl: moneyAmount.optional(),
    local: localSchema.optional(),
    source_sites: stringListSchema.optional(),
    inbound_phone_numbers: stringListSchema.optional(),
    priority: z.coerce.number().int().optional(),
    sheet_tab_name: optionalString,
  })
  .strict();

export const leadSourceCompanyCreateSchema = z
  .object({
    company_slug: nonEmptyString,
    name: nonEmptyString,
    owner_label: nonEmptyString.optional(),
    aliases: stringListSchema.optional(),
    active: booleanInput.optional(),
    default_form_granularity_key: optionalString,
    default_call_granularity_key: optionalString,
    sheet_config: z
      .object({
        spreadsheet_id: optionalString,
        has_bad_tabs: booleanInput.optional(),
      })
      .strict()
      .optional(),
    granularities: z.array(leadSourceGranularitySchema).optional(),
    created_from: nonEmptyString.optional(),
  })
  .strict();

export const leadSourceCompanyUpdateSchema = leadSourceCompanyCreateSchema
  .omit({ company_slug: true })
  .partial()
  .refine(requireAtLeastOne, "At least one source company field must be provided");

export type AdminBrowseQuery = z.infer<typeof adminBrowseQuerySchema>;
export type AdminSearchQuery = z.infer<typeof adminSearchQuerySchema>;
export type AdminDatabaseScope = z.infer<typeof adminDatabaseScopeSchema>;
export type CatalogListQuery = z.infer<typeof catalogListQuerySchema>;
export type CatalogCreateInput = z.infer<typeof catalogCreateSchema>;
export type CatalogUpdateInput = z.infer<typeof catalogUpdateSchema>;
export type CplRateUpdateInput = z.infer<typeof cplRateUpdateSchema>;
export type LeadSourceCompanyCreateInput = z.infer<typeof leadSourceCompanyCreateSchema>;
export type LeadSourceCompanyUpdateInput = z.infer<typeof leadSourceCompanyUpdateSchema>;
