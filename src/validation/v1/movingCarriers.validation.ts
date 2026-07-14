import { z } from "zod";
import { booleanInput, nonEmptyString, requireAtLeastOne } from "./common";

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional(),
);

export const listMovingCarriersQuerySchema = z
  .object({
    q: optionalTrimmedString,
    active: booleanInput.optional().default(true),
    include_inactive: booleanInput.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(250).default(100),
  })
  .strip();

export const movingCarrierCreateSchema = z
  .object({
    name: nonEmptyString,
    dot_number: nonEmptyString,
    mc_number: nonEmptyString,
    active: booleanInput.optional(),
    created_from: nonEmptyString.optional(),
  })
  .strict();

export const movingCarrierUpdateSchema = movingCarrierCreateSchema
  .partial()
  .refine(requireAtLeastOne, "At least one carrier field must be provided");

export const movingCarrierImportSchema = z
  .object({
    csv_text: z.string().min(1),
    mode: z.enum(["patch", "replace"]).default("patch"),
  })
  .strict();

export type ListMovingCarriersQuery = z.infer<typeof listMovingCarriersQuerySchema>;
export type MovingCarrierCreateInput = z.infer<typeof movingCarrierCreateSchema>;
export type MovingCarrierUpdateInput = z.infer<typeof movingCarrierUpdateSchema>;
export type MovingCarrierImportInput = z.infer<typeof movingCarrierImportSchema>;
