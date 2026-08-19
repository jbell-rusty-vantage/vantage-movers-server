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

const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{24}$/i, "must be a Mongo ObjectId");

const opaqueCursorSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+$/, "cursor must be opaque base64url");

const optionalTrimmed = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    schema.optional(),
  );

const optionalIsoDate = optionalTrimmed(
  z.string().trim().datetime({ offset: true }),
);

export const granotLifecycleCaseListQuerySchema = z
  .object({
    kind: optionalTrimmed(z.enum(["booking", "release"])),
    state: optionalTrimmed(z.enum(["open", "resolved"])),
    mode: optionalTrimmed(
      z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, "mode must be lowercase snake_case"),
    ),
    source_id: optionalTrimmed(objectIdSchema),
    normalized_job_no: optionalTrimmed(z.string().trim().min(1).max(64)),
    opened_from: optionalIsoDate,
    opened_to: optionalIsoDate,
    sort: optionalTrimmed(z.enum(["last_evidence_at", "opened_at"])),
    order: optionalTrimmed(z.enum(["asc", "desc"])),
    cursor: optionalTrimmed(opaqueCursorSchema),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.opened_from &&
      value.opened_to &&
      Date.parse(value.opened_from) > Date.parse(value.opened_to)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["opened_from"],
        message: "opened_from must be before or equal to opened_to",
      });
    }
  });

export const granotLifecycleCaseParamsSchema = z
  .object({ case_id: objectIdSchema })
  .strict();

export const granotLifecycleCandidateQuerySchema = z
  .object({
    scope: optionalTrimmed(z.enum(["source", "all"])),
    lead_model: optionalTrimmed(z.enum(["FormLead", "CallLead"])),
    q: optionalTrimmed(z.string().trim().min(1).max(100)),
    cursor: optionalTrimmed(opaqueCursorSchema),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .transform((value) => ({ ...value, scope: value.scope ?? "source" as const }));

export const granotLifecycleTimelineQuerySchema = z
  .object({
    cursor: optionalTrimmed(opaqueCursorSchema),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export const granotLifecycleLeadTimelineParamsSchema = z
  .object({
    lead_model: z.enum(["FormLead", "CallLead"]),
    lead_id: objectIdSchema,
  })
  .strict();

export type GranotLifecycleCaseListQuery = z.infer<
  typeof granotLifecycleCaseListQuerySchema
>;
export type GranotLifecycleCandidateQuery = z.infer<
  typeof granotLifecycleCandidateQuerySchema
>;
export type GranotLifecycleTimelineQuery = z.infer<
  typeof granotLifecycleTimelineQuerySchema
>;

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
