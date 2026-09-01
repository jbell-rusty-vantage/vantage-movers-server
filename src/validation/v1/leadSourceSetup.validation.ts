import { z } from "zod";

const registryReasonSchema = z.string().trim().min(10).max(1000);

const granotSetupSchema = z
  .object({
    name_received_from_granot: z.string().trim().min(1).max(200),
    when_lead_arrives: z.enum([
      "watch_only",
      "existing_only",
      "create_if_missing",
    ]),
  })
  .strict();

export const leadSourceSetupCommandSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    owner_label: z.string().trim().min(1).max(200).optional(),
    aliases: z.array(z.string().trim().min(1).max(200)).optional(),
    channel: z.enum(["form", "call"]),
    feed_display_name: z.string().trim().min(1).max(200).optional(),
    crm_label: z.string().trim().min(1).max(200),
    move_type: z.enum(["local", "long_distance"]).optional(),
    feed_aliases: z.array(z.string().trim().min(1).max(200)).optional(),
    source_sites: z.array(z.string().trim().min(1).max(200)).optional(),
    granot: granotSetupSchema.nullable().optional(),
    reason: registryReasonSchema,
  })
  .strict();

export const leadSourceListQuerySchema = z.object({}).strict();

export const leadSourceDetailQuerySchema = z.object({}).strict();

export type LeadSourceSetupCommandInput = z.infer<
  typeof leadSourceSetupCommandSchema
>;
