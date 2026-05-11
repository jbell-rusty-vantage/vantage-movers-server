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

export const createLeadSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    pickupZip: zipSchema,
    destinationZip: zipSchema,
    moveSize: moveSizeSchema,
    moveDate: z.coerce.date(),
    phoneNumber: phoneSchema,
    refNo: optionalRefNoSchema.default("not provided"),
    booked: booleanSchema.default(false),
    email: z.email().trim().toLowerCase(),
    sourceCompanySite: z.string().trim().min(1),
    sourceCompanyLabel: z.string().trim().min(1),
    cancelled: booleanSchema.default(false),
  })
  .strict();

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
