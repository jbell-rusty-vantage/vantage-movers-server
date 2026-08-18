import { z } from "zod";
import { PROCESSOR_VERSION_PATTERN } from "../../services/granotLifecycle/operations";
import {
  NORMALIZATION_FIELD_BOUNDS,
  isSupportedGranotBookingAction,
} from "../../services/granotLifecycle/normalization";
import { resolveForbiddenCredentialKey } from "../../services/granotLifecycle/receiptEvidence";
import { assertChannelOperationId } from "../../models/granotLifecycleSchemas";

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

export const granotLifecycleRequeueCommandSchema = z
  .object({
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

export type GranotLifecycleRequeueCommandInput = z.infer<
  typeof granotLifecycleRequeueCommandSchema
>;

export const EXTENSION_APPLY_BATCH_MAX = 100;
const LOWERCASE_UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STATEMENT_STRING_MAX = Math.max(
  ...Object.values(NORMALIZATION_FIELD_BOUNDS),
  300,
);
const CREDENTIAL_LIKE_KEY = /authorization|cookie|password|secret|token|api[_-]?key/i;
const CONTROL_OR_BIDI = /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/;

const leadModelSchema = z.enum(["FormLead", "CallLead"]);

const expectedTargetSchema = z
  .object({
    model: leadModelSchema,
    id: z.string().trim().min(1).max(128),
  })
  .strict();

function isCredentialLikeStatementKey(key: string): boolean {
  return resolveForbiddenCredentialKey(key) !== undefined || CREDENTIAL_LIKE_KEY.test(key);
}

const granotStatementSchema = z
  .record(
    z.string().trim().min(1).max(64),
    z.union([
      z.string().max(STATEMENT_STRING_MAX),
      z.number().finite(),
      z.null(),
    ]),
  )
  .superRefine((statement, ctx) => {
    for (const [key, value] of Object.entries(statement)) {
      if (isCredentialLikeStatementKey(key)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "credential-like statement keys are forbidden",
        });
      }
      if (typeof value === "string" && CONTROL_OR_BIDI.test(value)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "statement values must not contain control or bidirectional characters",
        });
      }
    }
  });

export const extensionGranotApplyItemSchema = z
  .object({
    operation_id: z
      .string()
      .trim()
      .regex(LOWERCASE_UUID_V4, "operation_id must be a lowercase UUID v4"),
    operation_kind: z.enum(["lead_snapshot_apply", "booking_action_apply"]),
    granot_statement: granotStatementSchema,
    expected_target: expectedTargetSchema.optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    try {
      assertChannelOperationId(item.operation_id, "browser_extension");
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        path: ["operation_id"],
        message: error instanceof Error ? error.message : "operation_id is invalid",
      });
    }
    const bookingActionPresent = isSupportedGranotBookingAction(
      item.granot_statement.event_type,
    );
    if (item.operation_kind === "lead_snapshot_apply" && bookingActionPresent) {
      ctx.addIssue({
        code: "custom",
        path: ["granot_statement", "event_type"],
        message: "lead_snapshot_apply rejects a Booked/Release payload event",
      });
    }
    if (item.operation_kind === "booking_action_apply" && !bookingActionPresent) {
      ctx.addIssue({
        code: "custom",
        path: ["granot_statement", "event_type"],
        message: "booking_action_apply requires a supported Booking Action",
      });
    }
  });

export const extensionGranotApplyBatchSchema = z
  .object({
    items: z
      .array(extensionGranotApplyItemSchema)
      .min(1)
      .max(EXTENSION_APPLY_BATCH_MAX)
      .superRefine((items, ctx) => {
        const seen = new Set<string>();
        items.forEach((item, index) => {
          if (seen.has(item.operation_id)) {
            ctx.addIssue({
              code: "custom",
              path: [index, "operation_id"],
              message: "duplicate operation_id inside one request",
            });
          }
          seen.add(item.operation_id);
        });
      }),
  })
  .strict();

export type ExtensionGranotApplyItemInput = z.infer<
  typeof extensionGranotApplyItemSchema
>;
export type ExtensionGranotApplyBatchInput = z.infer<
  typeof extensionGranotApplyBatchSchema
>;
