import { z } from "zod";
import { LEAD_MESSAGE_STATUSES } from "../../config/domain";
import { objectIdSchema } from "./common";

export const leadMessagesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    status: z.enum(LEAD_MESSAGE_STATUSES).optional(),
    form_lead_id: objectIdSchema.optional(),
    phone: z.string().trim().min(1).optional(),
  })
  .strict();

export const leadMessageRetrySchema = z
  .object({
    confirm: z.literal(true),
  })
  .strict();

export type LeadMessagesQuery = z.infer<typeof leadMessagesQuerySchema>;
