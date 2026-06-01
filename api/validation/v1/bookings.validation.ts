import { z } from "zod";
import {
  finiteNumber,
  leadModelSchema,
  localSchema,
  moneyAmount,
  nonEmptyString,
  objectIdSchema,
  optionalDate,
  optionalString,
  requireAtLeastOne,
  requiredDate,
} from "./common";

/**
 * Booked lead lifecycle schemas.
 *
 * Pairs with `api/services/bookings/` and `api/services/agents/`.
 * Owns `binderTotalMatches` and the call-booking identity refinement
 * because both are specific to the booking payload shape.
 */

function requireCallBookingIdentity(value: Record<string, unknown>) {
  return Boolean(value.call_job_no || value.call_phone_number);
}

function binderTotalMatches(value: {
  total_binder_amount?: number;
  agent_allocations?: { binder_amount: number }[];
}) {
  if (value.total_binder_amount === undefined || !value.agent_allocations) {
    return true;
  }
  const allocationTotal = value.agent_allocations.reduce(
    (sum, allocation) => sum + allocation.binder_amount,
    0,
  );
  return Math.abs(allocationTotal - value.total_binder_amount) < 0.001;
}

const bookedLeadFields = {
  timestamp: optionalDate,
  book_date: requiredDate,
  job_no: nonEmptyString,
  lead_ref: objectIdSchema,
  lead_model: leadModelSchema,
  total_binder_amount: moneyAmount.optional(),
  deposit_amount: finiteNumber,
  merchant: nonEmptyString,
  source: nonEmptyString,
  local: localSchema.optional(),
  submission_id: optionalString,
};

const agentAllocationInputSchema = z
  .object({
    agent_name: nonEmptyString,
    binder_amount: moneyAmount,
  })
  .strict();

export const createBookedLeadSchema = z
  .object({
    ...bookedLeadFields,
    job_no: optionalString,
    agent_allocations: z.array(agentAllocationInputSchema).min(1),
  })
  .strict()
  .refine(binderTotalMatches, "total_binder_amount must equal the sum of agent binder amounts");

const bookedLeadFromSourceSharedFields = {
  timestamp: bookedLeadFields.timestamp,
  book_date: bookedLeadFields.book_date,
  deposit_amount: bookedLeadFields.deposit_amount,
  merchant: bookedLeadFields.merchant,
  source_company: optionalString,
  submission_id: bookedLeadFields.submission_id,
  agent: nonEmptyString,
  split_agent: optionalString,
  binder_amount: moneyAmount,
};

export const createBookedLeadFromSourceSchema = z.discriminatedUnion("lead_type", [
  z
    .object({
      ...bookedLeadFromSourceSharedFields,
      lead_type: z.literal("FormLead"),
      form_lead_id: objectIdSchema,
      job_no: bookedLeadFields.job_no,
    })
    .strict(),
  z
    .object({
      ...bookedLeadFromSourceSharedFields,
      lead_type: z.literal("CallLead"),
      call_job_no: optionalString,
      call_phone_number: optionalString,
    })
    .strict()
    .refine(
      requireCallBookingIdentity,
      "CallLead booking requires either call_job_no or call_phone_number",
    ),
]);

export const createReferralBookingSchema = z
  .object({
    book_date: bookedLeadFields.book_date,
    job_no: bookedLeadFields.job_no,
    customer_name: nonEmptyString,
    agent: nonEmptyString,
    split_agent: optionalString,
    total_binder_amount: moneyAmount,
    deposit_amount: bookedLeadFields.deposit_amount,
    merchant: bookedLeadFields.merchant,
    local: bookedLeadFields.local,
  })
  .strict();

export const updateBookedLeadSchema = z
  .object({
    timestamp: bookedLeadFields.timestamp,
    book_date: bookedLeadFields.book_date,
    job_no: bookedLeadFields.job_no,
    total_binder_amount: bookedLeadFields.total_binder_amount,
    deposit_amount: bookedLeadFields.deposit_amount,
    merchant: bookedLeadFields.merchant,
    source: bookedLeadFields.source,
    local: bookedLeadFields.local,
    submission_id: bookedLeadFields.submission_id,
    agent_allocation_mode: z.enum(["patch", "replace"]).optional(),
    agent_allocations: z.array(agentAllocationInputSchema).min(1).optional(),
  })
  .partial()
  .strict()
  .refine(binderTotalMatches, "total_binder_amount must equal the sum of agent binder amounts")
  .refine(requireAtLeastOne, "At least one booked lead field must be provided");

export type CreateBookedLeadInput = z.infer<typeof createBookedLeadSchema>;
export type CreateBookedLeadFromSourceInput = z.infer<typeof createBookedLeadFromSourceSchema>;
export type CreateReferralBookingInput = z.infer<typeof createReferralBookingSchema>;
export type UpdateBookedLeadInput = z.infer<typeof updateBookedLeadSchema>;
