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
  /** Form leads only: move_date calendar day is ≥1 day before submission `timestamp`. */
  past_move_date: booleanInput.optional(),
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
    role: nonEmptyString.optional(),
    granot_crm_username: nonEmptyString.optional(),
    // Optional create-time activation. Defaults to active=true in the registry
    // when omitted. Accepted so the extension Sales Rep dialog can create an
    // inactive Agent without a follow-up activation call.
    active: booleanInput.optional(),
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
  .extend({
    reason: optionalTrimmedString,
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.role !== undefined ||
      value.granot_crm_username !== undefined ||
      value.active !== undefined ||
      value.created_from !== undefined,
    "At least one catalog field must be provided",
  );

export const catalogActivationSchema = z
  .object({
    active: booleanInput,
    reason: optionalTrimmedString,
  })
  .strict();

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

const sourceSheetConfigSchema = z
  .object({
    spreadsheet_id: optionalString,
    has_bad_tabs: booleanInput.optional(),
    projection_mode: z.enum(["derived_import", "direct_write"]).optional(),
  })
  .strict();

const leadSourceCompanyWriteBaseSchema = z
  .object({
    company_slug: nonEmptyString,
    name: nonEmptyString,
    owner_label: nonEmptyString.optional(),
    aliases: stringListSchema.optional(),
    active: booleanInput.optional(),
    default_form_granularity: optionalObjectIdString,
    default_call_granularity: optionalObjectIdString,
    default_form_granularity_key: optionalString,
    default_call_granularity_key: optionalString,
    sheet_config: sourceSheetConfigSchema.optional(),
    granularities: z.array(leadSourceGranularitySchema).optional(),
    created_from: nonEmptyString.optional(),
    reason: optionalTrimmedString,
  })
  .strict();

function rejectLegacySourceCompanyWrites(
  value: {
    granularities?: unknown;
    active?: unknown;
    default_form_granularity_key?: unknown;
    default_call_granularity_key?: unknown;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.granularities !== undefined) {
    ctx.addIssue({
      code: "custom",
      message:
        "Embedded granularities are read-only. Use /api/v1/admin/source-granularities.",
      path: ["granularities"],
    });
  }
  if (value.active !== undefined) {
    ctx.addIssue({
      code: "custom",
      message:
        "Source Company activation is managed via /api/v1/admin/source-companies/:id/activation.",
      path: ["active"],
    });
  }
  for (const field of [
    "default_form_granularity_key",
    "default_call_granularity_key",
  ] as const) {
    if (value[field] !== undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          "Compatibility default keys are read-only. Select a first-class Source Granularity ID.",
        path: [field],
      });
    }
  }
}

export const leadSourceCompanyCreateSchema = leadSourceCompanyWriteBaseSchema.superRefine(
  rejectLegacySourceCompanyWrites,
);

export const leadSourceCompanyUpdateSchema = leadSourceCompanyWriteBaseSchema
  .omit({ company_slug: true })
  .partial()
  .superRefine(rejectLegacySourceCompanyWrites)
  .refine(requireAtLeastOne, "At least one source company field must be provided");

export const sourceGranularityListQuerySchema = z
  .object({
    include_inactive: booleanInput.optional(),
    source_company: optionalObjectIdString,
    channel: z.enum(["form", "call"]).optional(),
  })
  .strip();

export const sourceGranularityCreateSchema = z
  .object({
    source_company: z.string().trim().regex(/^[a-f\d]{24}$/i, "Invalid Mongo ObjectId"),
    granularity_key: nonEmptyString,
    channel: z.enum(["form", "call"]),
    owner_label: nonEmptyString,
    crm_label: nonEmptyString,
    aliases: stringListSchema.optional(),
    local: localSchema.optional(),
    source_sites: stringListSchema.optional(),
    priority: z.coerce.number().int().optional(),
    sheet_tab_name: optionalString,
    created_from: nonEmptyString.optional(),
    reason: optionalTrimmedString,
  })
  .strict();

export const sourceGranularityUpdateSchema = sourceGranularityCreateSchema
  .omit({ source_company: true, granularity_key: true, channel: true })
  .partial()
  .refine(requireAtLeastOne, "At least one source granularity field must be provided");

export const sourceActivationSchema = z
  .object({
    active: booleanInput,
    reason: optionalTrimmedString,
    replacement_default_id: optionalObjectIdString,
    remove_automatic_use_for_channel: booleanInput.optional(),
  })
  .strict();

const registryReasonSchema = z.string().trim().min(10).max(1000);

export const granotCrmSourceRegistryUpdateSchema = z
  .object({
    granot_label: z.string().trim().min(1).max(200),
    default_channel: z.enum(["form", "call", "unknown"]).optional(),
    enabled: booleanInput.optional(),
    notes: z.string().trim().max(2000).optional().nullable(),
    lifecycle_enabled: booleanInput,
    lifecycle_disposition: z.enum([
      "source_scoped_lead",
      "referral_booking",
      "deferred",
    ]),
    lead_created_policy: z.enum([
      "link_only",
      "observation_only",
      "create_if_missing",
    ]),
    lead_source_company: optionalObjectIdString.nullable(),
    lifecycle_routes: z.array(
      z
        .object({
          route_key: z.string().trim().min(1).max(80),
          lead_model: z.enum(["FormLead", "CallLead"]),
          move_type: z.enum(["local", "long_distance", "any"]),
          source_granularity_id: z
            .string()
            .trim()
            .regex(/^[a-f\d]{24}$/i, "Invalid Mongo ObjectId"),
        })
        .strict(),
    ),
    lifecycle_policy_version: z.string().trim().max(120).optional(),
    reason: registryReasonSchema,
  })
  .strict();

export const granotCrmSourceOutboundSmsSchema = z
  .object({
    enabled: booleanInput,
    body_template: z.string().trim().min(1).max(320),
    consent_basis: z.enum([
      "not_attested",
      "customer_submitted_form",
      "existing_relationship",
    ]),
    reason: registryReasonSchema,
  })
  .strict();

const objectIdString = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "Invalid Mongo ObjectId");

export const ownerGranotNameCreateSchema = z
  .object({
    name_received_from_granot: z.string().trim().min(1).max(200),
    handling: z.enum(["our_lead_source", "referral_booking", "watch_only"]),
    lead_source_id: optionalObjectIdString,
    destination: z.union([
      z
        .object({
          kind: z.literal("one_feed"),
          feed_id: objectIdString,
        })
        .strict(),
      z
        .object({
          kind: z.literal("form_by_move_type"),
          local_feed_id: objectIdString,
          long_distance_feed_id: objectIdString,
        })
        .strict(),
      z.null(),
    ]),
    when_lead_arrives: z.enum([
      "watch_only",
      "existing_only",
      "create_if_missing",
    ]),
    reason: registryReasonSchema,
  })
  .strict();

export const granotCrmSourceOutboundSmsRecentQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

export const granotCrmSourceLifecycleActivationSchema = z
  .object({
    lifecycle_enabled: booleanInput,
    reason: registryReasonSchema,
  })
  .strict();

export const sourceResolutionPreviewSchema = z
  .object({
    channel: z.enum(["form", "call"]),
    company_slug: optionalString,
    granularity_key: optionalString,
    crm_label: optionalString,
    source_site: optionalString,
    fallback_alias: optionalString,
  })
  .strict();

export type AdminBrowseQuery = z.infer<typeof adminBrowseQuerySchema>;
export type AdminSearchQuery = z.infer<typeof adminSearchQuerySchema>;
export type AdminDatabaseScope = z.infer<typeof adminDatabaseScopeSchema>;
export type CatalogListQuery = z.infer<typeof catalogListQuerySchema>;
export type CatalogCreateInput = z.infer<typeof catalogCreateSchema>;
export type CatalogUpdateInput = z.infer<typeof catalogUpdateSchema>;
export type CatalogActivationInput = z.infer<typeof catalogActivationSchema>;
export type CplRateUpdateInput = z.infer<typeof cplRateUpdateSchema>;
export type LeadSourceCompanyCreateInput = z.infer<typeof leadSourceCompanyCreateSchema>;
export type LeadSourceCompanyUpdateInput = z.infer<typeof leadSourceCompanyUpdateSchema>;
export type SourceGranularityListQuery = z.infer<typeof sourceGranularityListQuerySchema>;
export type SourceGranularityCreateInput = z.infer<typeof sourceGranularityCreateSchema>;
export type SourceGranularityUpdateInput = z.infer<typeof sourceGranularityUpdateSchema>;
export type SourceActivationInput = z.infer<typeof sourceActivationSchema>;
export type SourceResolutionPreviewInput = z.infer<typeof sourceResolutionPreviewSchema>;
export type GranotCrmSourceRegistryUpdateInput = z.infer<
  typeof granotCrmSourceRegistryUpdateSchema
>;
export type GranotCrmSourceLifecycleActivationInput = z.infer<
  typeof granotCrmSourceLifecycleActivationSchema
>;
export type GranotCrmSourceOutboundSmsInput = z.infer<
  typeof granotCrmSourceOutboundSmsSchema
>;
export type OwnerGranotNameCreateInput = z.infer<
  typeof ownerGranotNameCreateSchema
>;
