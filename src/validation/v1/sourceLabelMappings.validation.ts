import { z } from "zod";
import { booleanInput, optionalString } from "./common";

const objectIdString = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "Invalid Mongo ObjectId");

const registryReasonSchema = z.string().trim().min(10).max(1000);

const labelNamespaceSchema = z.enum(["sheet_lead_source", "legacy_api_source"]);

export const sourceLabelMappingCreateSchema = z
  .object({
    label: z.string().min(1).max(200),
    namespace: labelNamespaceSchema,
    source_company: objectIdString,
    source_granularity: objectIdString,
    change_reason: registryReasonSchema,
  })
  .strict();

export const sourceLabelMappingActivationSchema = z
  .object({
    active: booleanInput,
    reason: registryReasonSchema,
  })
  .strict();

export const sourceLabelMappingListQuerySchema = z
  .object({
    source_company: optionalString,
    source_granularity: optionalString,
    namespace: optionalString,
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const key of ["source_company", "source_granularity"] as const) {
      const raw = value[key];
      if (raw && !/^[a-f\d]{24}$/i.test(raw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "Invalid Mongo ObjectId",
        });
      }
    }
    if (
      value.namespace &&
      value.namespace !== "sheet_lead_source" &&
      value.namespace !== "legacy_api_source"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["namespace"],
        message: "namespace must be sheet_lead_source or legacy_api_source",
      });
    }
  });

export const sourceLabelResolutionPreviewSchema = z
  .object({
    namespace: labelNamespaceSchema,
    label: z.string().min(1).max(200),
  })
  .strict();

export type SourceLabelMappingCreateInput = z.infer<
  typeof sourceLabelMappingCreateSchema
>;
export type SourceLabelMappingActivationInput = z.infer<
  typeof sourceLabelMappingActivationSchema
>;
export type SourceLabelMappingListQuery = z.infer<
  typeof sourceLabelMappingListQuerySchema
>;
export type SourceLabelResolutionPreviewInput = z.infer<
  typeof sourceLabelResolutionPreviewSchema
>;
