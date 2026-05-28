import { z } from "zod";
import { emailSchema, nonEmptyString, requireAtLeastOne } from "./common";

/**
 * Customer create / update schemas. Pairs with `api/services/customers/`.
 */

const customerFields = {
  full_name: nonEmptyString,
  phone_number: nonEmptyString,
  email: emailSchema,
};

export const createCustomerSchema = z.object(customerFields).strict();

export const updateCustomerSchema = z
  .object(customerFields)
  .partial()
  .strict()
  .refine(requireAtLeastOne, "At least one customer field must be provided");

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
