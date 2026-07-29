import { z } from "zod";
import {
  REGISTRY_CHANGE_ACTIONS,
  REGISTRY_CHANGE_ENTITY_TYPES,
} from "../../models/OperationsRegistryChange";
import { objectIdSchema } from "./common";

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional(),
);

const optionalDateString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.date().optional(),
);

const pageInput = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().int().min(1).optional(),
);

const limitInput = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().int().min(1).max(100).optional(),
);

export const registryChangesQuerySchema = z
  .object({
    entity_type: z.enum(REGISTRY_CHANGE_ENTITY_TYPES).optional(),
    entity_id: optionalTrimmedString,
    actor_id: optionalTrimmedString,
    action: z.enum(REGISTRY_CHANGE_ACTIONS).optional(),
    request_id: optionalTrimmedString,
    from: optionalDateString,
    to: optionalDateString,
    page: pageInput,
    limit: limitInput,
  })
  .strict();

export type RegistryChangesQuery = z.infer<typeof registryChangesQuerySchema>;

export const registryOverviewQuerySchema = z.object({}).strict();

export type RegistryOverviewQuery = z.infer<typeof registryOverviewQuerySchema>;

export const registryHealthQuerySchema = z.object({}).strict();

export type RegistryHealthQuery = z.infer<typeof registryHealthQuerySchema>;

const businessDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD business date")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year!, month! - 1, day!));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month! - 1 &&
      parsed.getUTCDate() === day
    );
  }, "Invalid business date");

const cplAmountSchema = z.number().finite().nonnegative().refine(
  (value) => Number.isInteger(value * 100),
  "CPL amount may have at most two decimal places",
);

const expectedRevisionSchema = z.number().int().nonnegative();
const reasonSchema = z.string().trim().min(1).max(1_000).optional();

export const cplSnapshotQuerySchema = z.object({}).strict();

export const simpleCplScheduleSchema = z
  .object({
    effective_date: businessDateSchema,
    expected_revisions: z.record(objectIdSchema, expectedRevisionSchema),
    changes: z
      .array(
        z
          .object({
            source_granularity_id: objectIdSchema,
            amount: cplAmountSchema,
          })
          .strict(),
      )
      .min(1)
      .max(500),
    reason: reasonSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const [index, change] of value.changes.entries()) {
      if (seen.has(change.source_granularity_id)) {
        context.addIssue({
          code: "custom",
          path: ["changes", index, "source_granularity_id"],
          message: "A granularity may appear only once",
        });
      }
      seen.add(change.source_granularity_id);
      if (value.expected_revisions[change.source_granularity_id] === undefined) {
        context.addIssue({
          code: "custom",
          path: ["expected_revisions", change.source_granularity_id],
          message: "Expected revision is required for every changed granularity",
        });
      }
    }
  });

const replacementPeriodSchema = z
  .object({
    effective_from_date: businessDateSchema,
    effective_until_date: businessDateSchema.optional(),
    amount: cplAmountSchema,
  })
  .strict();

export const advancedCplScheduleCommandSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("add_future"),
      expected_revision: expectedRevisionSchema,
      effective_date: businessDateSchema,
      amount: cplAmountSchema,
      reason: reasonSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("split"),
      expected_revision: expectedRevisionSchema,
      period_id: objectIdSchema,
      effective_date: businessDateSchema,
      amount: cplAmountSchema,
      reason: reasonSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("replace_schedule"),
      expected_revision: expectedRevisionSchema,
      periods: z.array(replacementPeriodSchema).min(1).max(500),
      reason: reasonSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("correct_period"),
      expected_revision: expectedRevisionSchema,
      period_id: objectIdSchema,
      amount: cplAmountSchema,
      reason: z.string().trim().min(1).max(1_000),
    })
    .strict(),
]);

const cplCorrectionSelectionShape = {
  source_granularity_id: objectIdSchema,
  window_from: businessDateSchema,
  window_until: businessDateSchema,
};
const isBoundedCorrectionWindow = (value: {
  window_from: string;
  window_until: string;
}) =>
  Date.parse(`${value.window_until}T00:00:00.000Z`) -
    Date.parse(`${value.window_from}T00:00:00.000Z`) <=
  365 * 24 * 60 * 60 * 1_000;

export const cplCorrectionPreviewSchema = z
  .object({
    ...cplCorrectionSelectionShape,
    sample_limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .refine((value) => value.window_until >= value.window_from, {
    path: ["window_until"],
    message: "Correction window end must be on or after its start",
  })
  .refine(isBoundedCorrectionWindow, {
    path: ["window_until"],
    message: "Correction window cannot exceed 366 inclusive business days",
  });

export const createCplCorrectionSchema = z
  .object({
    ...cplCorrectionSelectionShape,
    target_schedule_revision: expectedRevisionSchema,
    preview_hash: z.string().trim().regex(/^[a-f\d]{64}$/i),
    confirm: z.literal(true),
    reason: reasonSchema,
  })
  .strict()
  .refine((value) => value.window_until >= value.window_from, {
    path: ["window_until"],
    message: "Correction window end must be on or after its start",
  })
  .refine(isBoundedCorrectionWindow, {
    path: ["window_until"],
    message: "Correction window cannot exceed 366 inclusive business days",
  });

export const cancelCplCorrectionSchema = z
  .object({ reason: reasonSchema })
  .strict();

const phoneNumberSchema = z.string().trim().min(8).max(32);

export const ringCentralRouteListQuerySchema = z
  .object({
    include_inactive: z
      .preprocess(
        (value) =>
          value === "true" ? true : value === "false" ? false : value,
        z.boolean().optional(),
      ),
    include_history: z
      .preprocess(
        (value) =>
          value === "true" ? true : value === "false" ? false : value,
        z.boolean().optional(),
      ),
  })
  .strict();

export const ringCentralRouteCreateSchema = z
  .object({
    phone_number: phoneNumberSchema,
    display_label: z.string().trim().min(1).max(200),
    created_from: z.string().trim().min(1).max(100).optional(),
    reason: reasonSchema,
  })
  .strict();

export const ringCentralRouteUpdateSchema = z
  .object({
    phone_number: phoneNumberSchema.optional(),
    display_label: z.string().trim().min(1).max(200).optional(),
    reason: reasonSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.phone_number !== undefined ||
      value.display_label !== undefined ||
      value.reason !== undefined,
    "At least one field is required",
  );

export const ringCentralRouteReasonSchema = z
  .object({ reason: reasonSchema })
  .strict();

export const ringCentralRouteAssignmentSchema = z
  .object({
    source_granularity_id: objectIdSchema,
    reason: reasonSchema,
  })
  .strict();

export type SimpleCplScheduleInput = z.infer<typeof simpleCplScheduleSchema>;
export type AdvancedCplScheduleCommandInput = z.infer<
  typeof advancedCplScheduleCommandSchema
>;
export type CplCorrectionPreviewInput = z.infer<typeof cplCorrectionPreviewSchema>;
export type CreateCplCorrectionInput = z.infer<typeof createCplCorrectionSchema>;
export type CancelCplCorrectionInput = z.infer<typeof cancelCplCorrectionSchema>;
export type RingCentralRouteListQuery = z.infer<
  typeof ringCentralRouteListQuerySchema
>;
export type RingCentralRouteCreateInput = z.infer<
  typeof ringCentralRouteCreateSchema
>;
export type RingCentralRouteUpdateInput = z.infer<
  typeof ringCentralRouteUpdateSchema
>;
export type RingCentralRouteAssignmentInput = z.infer<
  typeof ringCentralRouteAssignmentSchema
>;
