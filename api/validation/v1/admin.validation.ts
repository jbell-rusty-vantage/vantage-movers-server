import { z } from "zod";
import { booleanInput, nonEmptyString, requireAtLeastOne } from "./common";

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

const adminQueryBase = {
  database_scope: adminDatabaseScopeSchema,
  q: optionalTrimmedString,
  from: optionalDateString,
  to: optionalDateString,
  date_field: optionalTrimmedString,
  source_company: optionalTrimmedString,
  source: optionalTrimmedString,
  source_label: optionalTrimmedString,
  agent: optionalTrimmedString,
  customer_name: optionalTrimmedString,
  customer_phone: optionalTrimmedString,
  customer_email: optionalTrimmedString,
  job_no: optionalTrimmedString,
  merchant: optionalTrimmedString,
  local: optionalTrimmedString,
  booked: booleanInput.optional(),
  cancelled: booleanInput.optional(),
  leadless: booleanInput.optional(),
  pickup_state: optionalTrimmedString,
  pickup_zip: optionalTrimmedString,
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
  })
  .strict();

export const catalogUpdateSchema = catalogCreateSchema
  .partial()
  .refine(requireAtLeastOne, "At least one catalog field must be provided");

export type AdminBrowseQuery = z.infer<typeof adminBrowseQuerySchema>;
export type AdminSearchQuery = z.infer<typeof adminSearchQuerySchema>;
export type AdminDatabaseScope = z.infer<typeof adminDatabaseScopeSchema>;
export type CatalogListQuery = z.infer<typeof catalogListQuerySchema>;
export type CatalogCreateInput = z.infer<typeof catalogCreateSchema>;
export type CatalogUpdateInput = z.infer<typeof catalogUpdateSchema>;
