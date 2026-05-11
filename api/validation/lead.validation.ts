import { z } from "zod";

export const moveSizeSchema = z.enum([
  "Studio",
  "2 Bedrooms",
  "3 Bedrooms",
  "4 Bedrooms",
  "5+ Bedrooms",
  "Office",
]);

const zipSchema = z
  .string()
  .trim()
  .regex(/^\d{5}$/, "Zip code must be exactly 5 digits");
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\d{10}$/, "Phone number must be exactly 10 digits");
const booleanSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "") {
      return false;
    }
  }

  return value;
}, z.boolean());

const optionalRefNoSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());

const leadFields = {
  name: z.string().trim().min(1).max(120),
  pickupZip: zipSchema,
  destinationZip: zipSchema,
  moveSize: moveSizeSchema,
  moveDate: z.coerce.date(),
  phoneNumber: phoneSchema,
  refNo: optionalRefNoSchema,
  booked: booleanSchema,
  email: z.email().trim().toLowerCase(),
  sourceCompanySite: z.string().trim().min(1),
  sourceCompanyLabel: z.string().trim().min(1).optional(),
  cancelled: booleanSchema,
};

export const createLeadSchema = z
  .object({
    ...leadFields,
    refNo: optionalRefNoSchema.default("not provided"),
    booked: booleanSchema.default(false),
    cancelled: booleanSchema.default(false),
  })
  .strict();

export const updateLeadSchema = z
  .object(leadFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one lead field must be provided",
  });

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
