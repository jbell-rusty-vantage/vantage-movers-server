import { z } from "zod";
import { TESTIMONIAL_SOURCES } from "../../config/domain";
import { booleanInput } from "./common";

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional(),
);

const optionalDateString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.date().optional(),
);

const optionalObjectIdString = optionalTrimmedString.refine(
  (value) => value === undefined || /^[a-f\d]{24}$/i.test(value),
  "Invalid Mongo ObjectId",
);

const directionSchema = z
  .preprocess((value) => (typeof value === "string" ? value.toLowerCase() : value), z.enum(["asc", "desc"]))
  .default("desc");

export const listTestimonialsQuerySchema = z
  .object({
    source: z.enum(TESTIMONIAL_SOURCES).optional(),
    published: booleanInput.optional(),
    featured: booleanInput.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strip();

export const adminTestimonialsQuerySchema = z
  .object({
    source: z.enum(TESTIMONIAL_SOURCES).optional(),
    published: booleanInput.optional(),
    featured: booleanInput.optional(),
    q: optionalTrimmedString,
    reviewer_name: optionalTrimmedString,
    rating: z.coerce.number().int().min(1).max(5).optional(),
    customer: optionalObjectIdString,
    from: optionalDateString,
    to: optionalDateString,
    sort: z.enum(["review_date"]).default("review_date"),
    direction: directionSchema,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(250).default(50),
  })
  .strip();

export type ListTestimonialsQuery = z.infer<typeof listTestimonialsQuerySchema>;
export type AdminTestimonialsQuery = z.infer<typeof adminTestimonialsQuerySchema>;
