import { z } from "zod";
import { LEAD_MODELS, LOCAL_TYPES, MOVE_SIZES } from "../../config/domain";
import { parseFloridaCalendarDate } from "../../utils/easternTime";

/**
 * Shared zod building blocks for the v1 validation modules.
 *
 * These are intentionally module-internal helpers (not part of the public
 * barrel) so that the sibling validation files in `api/validation/v1/`
 * compose them when declaring their domain-specific schemas. Public scalar
 * schemas exported below are re-exported by `api/validation/v1.validation.ts`
 * to preserve the legacy public API.
 */

export const nonEmptyString = z.string().trim().min(1);
export const optionalString = z.string().trim().optional();
export const optionalDate = z.coerce.date().optional();
export const requiredDate = z.coerce.date();
export const optionalFloridaCalendarDate = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return parseFloridaCalendarDate(value);
}, z.date().optional());
export const requiredFloridaCalendarDate = z.preprocess(
  (value) => {
    try {
      return parseFloridaCalendarDate(value);
    } catch {
      // Let Zod turn missing or malformed input into a structured issue.
      return value;
    }
  },
  z.date(),
);
// In Zod v4, `z.number()` (and `z.coerce.number()`) rejects Infinity/NaN by
// default, so `.finite()` is a deprecated no-op. The helpers below are
// kept named `finiteNumber` / `moneyAmount` because the *intent* is still
// "finite numeric value" -- the constraint is just implicit now.
export const finiteNumber = z.coerce.number();
export const optionalNumber = z.coerce.number().optional();
export const moneyAmount = z.coerce.number().min(0);

export const booleanInput = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  return value;
}, z.boolean());

export const objectIdSchema = z.string().trim().regex(/^[a-f\d]{24}$/i, "Invalid Mongo ObjectId");
export const sourceCompanySchema = z.string().trim().min(1);
export const localSchema = z.enum(LOCAL_TYPES);
export const leadModelSchema = z.enum(LEAD_MODELS);
export const moveSizeSchema = z.enum(MOVE_SIZES);

export const zipSchema = z.string().trim().regex(/^\d{5}$/, "Zip code must be exactly 5 digits");
export const emailSchema = z.email().trim().toLowerCase().optional();
export const looseEmailString = z.string().trim().optional();

/**
 * Generic refinement asserting that a partial update payload contains at
 * least one field. Used by every `.partial()` update schema across the
 * v1 validation surface.
 */
export function requireAtLeastOne(value: Record<string, unknown>) {
  return Object.keys(value).length > 0;
}
