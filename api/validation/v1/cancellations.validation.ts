import { z } from "zod";
import {
  finiteNumber,
  objectIdSchema,
  optionalDate,
  optionalString,
  requireAtLeastOne,
} from "./common";

/**
 * Cancellation create / update schemas. Pairs with
 * `api/services/cancellations/`.
 */

const cancelledLeadFields = {
  timestamp: optionalDate,
  cancel_date: optionalDate,
  booked_lead: objectIdSchema.optional(),
  lead_id: objectIdSchema.optional(),
  refund_amount: finiteNumber,
  reason: optionalString,
  notes: optionalString,
  cancelled_by: optionalString,
};

export const createCancelledLeadSchema = z
  .object(cancelledLeadFields)
  .strict()
  .refine(
    (value) => Boolean(value.booked_lead || value.lead_id),
    "Either booked_lead or lead_id must be provided",
  );

export const updateCancelledLeadSchema = z
  .object({
    timestamp: cancelledLeadFields.timestamp,
    cancel_date: cancelledLeadFields.cancel_date,
    refund_amount: cancelledLeadFields.refund_amount,
    reason: cancelledLeadFields.reason,
    notes: cancelledLeadFields.notes,
    cancelled_by: cancelledLeadFields.cancelled_by,
  })
  .partial()
  .strict()
  .refine(requireAtLeastOne, "At least one cancelled lead field must be provided");

export type CreateCancelledLeadInput = z.infer<typeof createCancelledLeadSchema>;
export type UpdateCancelledLeadInput = z.infer<typeof updateCancelledLeadSchema>;
