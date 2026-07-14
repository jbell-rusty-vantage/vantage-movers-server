import { z } from "zod";
import { GRANOT_CRM_CSV_KINDS } from "../../config/domain";
import { nonEmptyString, optionalString } from "./common";

export const listGranotCrmSourcesQuerySchema = z
  .object({
    crm_origin: optionalString,
    seed: z.coerce.boolean().optional(),
  })
  .strict();

export const uploadGranotCrmCsvSchema = z
  .object({
    crm_origin: nonEmptyString,
    csv_kind: z.enum(GRANOT_CRM_CSV_KINDS),
    csv_path: nonEmptyString,
    csv_text: nonEmptyString,
    trigger: z.enum(["extension", "script", "manual"]).default("extension"),
    workspace_slug: optionalString,
    granot_label: optionalString,
    frame_url: optionalString,
    fetched_at: z.coerce.date().optional(),
    byte_length: z.coerce.number().int().min(0).optional(),
    row_count: z.coerce.number().int().min(0).optional(),
    data_row_count: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export type ListGranotCrmSourcesQuery = z.infer<
  typeof listGranotCrmSourcesQuerySchema
>;
export type UploadGranotCrmCsvInput = z.infer<typeof uploadGranotCrmCsvSchema>;
