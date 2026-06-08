import { z } from "zod";
import { TESTIMONIAL_SOURCES } from "../../config/domain";
import { booleanInput } from "./common";

export const listTestimonialsQuerySchema = z
  .object({
    source: z.enum(TESTIMONIAL_SOURCES).optional(),
    published: booleanInput.optional(),
    featured: booleanInput.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strip();

export type ListTestimonialsQuery = z.infer<typeof listTestimonialsQuerySchema>;
