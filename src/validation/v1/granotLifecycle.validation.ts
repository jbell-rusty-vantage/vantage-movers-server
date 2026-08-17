import { z } from "zod";
import { PROCESSOR_VERSION_PATTERN } from "../../services/granotLifecycle/operations";

export const granotLifecycleActivationCommandSchema = z
  .object({
    reason: z.string().trim().min(10).max(1000),
    processor_version: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(PROCESSOR_VERSION_PATTERN, "processor_version must be a bounded safe identifier"),
  })
  .strict();

export type GranotLifecycleActivationCommandInput = z.infer<
  typeof granotLifecycleActivationCommandSchema
>;
