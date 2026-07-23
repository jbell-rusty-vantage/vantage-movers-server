import { z } from "zod";
import {
  booleanInput,
  moneyAmount,
  nonEmptyString,
  objectIdSchema,
  optionalFloridaCalendarDate,
  optionalString,
  requiredFloridaCalendarDate,
  requireAtLeastOne,
} from "./common";

const uuidSchema = z.uuid();

const employeeSubmissionBase = {
  submission_id: uuidSchema,
  lead_source_company_id: objectIdSchema,
  source_granularity_key: nonEmptyString,
  agent: nonEmptyString,
  split_agent: optionalString,
  lead_name: nonEmptyString,
  binder_amount: moneyAmount,
  deposit_amount: moneyAmount,
  merchant: nonEmptyString,
  phone_number: nonEmptyString,
  email: optionalString,
  lid: optionalString,
  job_no: nonEmptyString,
};

export const createEmployeeBookingSubmissionSchema = z
  .object(employeeSubmissionBase)
  .strict()
  .refine(
    (value) =>
      !value.split_agent ||
      value.split_agent.trim().toLowerCase() !== value.agent.trim().toLowerCase(),
    "split_agent must be different from agent",
  );

export const bookingLeadReconciliationListQuerySchema = z
  .object({
    status: z.enum(["pending", "resolved", "dismissed"]).optional(),
    reason: z
      .enum([
        "no_match",
        "multiple_matches",
        "identity_conflict",
        "source_conflict",
        "channel_conflict",
        "duplicate_lead",
        "lead_already_booked",
        "lead_cancelled",
        "matching_unavailable",
      ])
      .optional(),
    q: optionalString,
    lead_source_company: objectIdSchema.optional(),
    source_granularity_key: optionalString,
    from: optionalFloridaCalendarDate,
    to: optionalFloridaCalendarDate,
    cursor: optionalString,
    limit: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.enum(["createdAt", "updatedAt"]).default("createdAt"),
    direction: z.enum(["asc", "desc"]).default("asc"),
  })
  .strip();

export const bookingLeadCandidateSearchSchema = z
  .object({
    q: optionalString,
    lead_model: z.enum(["FormLead", "CallLead"]).optional(),
    mongo_id: objectIdSchema.optional(),
    lid: optionalString,
    job_no: optionalString,
    phone_number: optionalString,
    name: optionalString,
    email: optionalString,
    lead_source_company: objectIdSchema.optional(),
    source_granularity_key: optionalString,
    duplicate: booleanInput.optional(),
    booked: booleanInput.optional(),
    cancelled: booleanInput.optional(),
    from: optionalFloridaCalendarDate,
    to: optionalFloridaCalendarDate,
    cursor: optionalString,
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strip();

export const refreshBookingLeadCandidatesSchema = z
  .object({
    revision: z.coerce.number().int().min(0),
  })
  .strict();

const sourceResolutionSchema = z.enum([
  "preserve_lead_source",
  "apply_submission_source",
]);

export const createReconciliationFormLeadSchema = z
  .object({
    name: nonEmptyString,
    phone_number: nonEmptyString,
    email: optionalString,
    lid: optionalString,
    pickup_zip: nonEmptyString,
    destination_zip: nonEmptyString,
    move_size: nonEmptyString,
    move_date: requiredFloridaCalendarDate,
  })
  .strict();

export const createReconciliationCallLeadSchema = z
  .object({
    name: optionalString,
    phone_number: optionalString,
    email: optionalString,
    job_no: optionalString,
    notes: optionalString,
  })
  .strict()
  .refine(
    (value) => Boolean(value.phone_number?.trim() || value.job_no?.trim()),
    "Call lead creation requires phone_number or job_no",
  );

export const resolveBookingLeadReconciliationSchema = z.discriminatedUnion(
  "action",
  [
    z
      .object({
        action: z.literal("attach_existing"),
        revision: z.coerce.number().int().min(0),
        lead_model: z.enum(["FormLead", "CallLead"]),
        lead_id: objectIdSchema,
        source_resolution: sourceResolutionSchema.optional(),
        overridden_warnings: z.array(nonEmptyString).optional(),
        notes: optionalString,
      })
      .strict(),
    z
      .object({
        action: z.literal("create_and_attach"),
        revision: z.coerce.number().int().min(0),
        lead_model: z.enum(["FormLead", "CallLead"]),
        lead_fields: z.record(z.string(), z.unknown()),
        notes: optionalString,
      })
      .strict(),
    z
      .object({
        action: z.literal("dismiss"),
        revision: z.coerce.number().int().min(0),
        notes: optionalString,
      })
      .strict(),
    z
      .object({
        action: z.literal("reassign"),
        revision: z.coerce.number().int().min(0),
        lead_model: z.enum(["FormLead", "CallLead"]),
        lead_id: objectIdSchema,
        source_resolution: sourceResolutionSchema.optional(),
        overridden_warnings: z.array(nonEmptyString).optional(),
        notes: optionalString,
      })
      .strict(),
  ],
).superRefine((command, context) => {
  if (command.action !== "create_and_attach") {
    return;
  }
  const fieldsSchema =
    command.lead_model === "FormLead"
      ? createReconciliationFormLeadSchema
      : createReconciliationCallLeadSchema;
  const parsed = fieldsSchema.safeParse(command.lead_fields);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      context.addIssue({
        code: "custom",
        path: ["lead_fields", ...issue.path],
        message: issue.message,
      });
    }
  }
});

export const reopenBookingLeadReconciliationSchema = z
  .object({
    revision: z.coerce.number().int().min(0),
    notes: optionalString,
  })
  .strict();

export const updatePendingEmployeeBookingSchema = z
  .object({
    revision: z.coerce.number().int().min(0),
    lead_source_company_id: objectIdSchema.optional(),
    source_granularity_key: optionalString,
    lead_name: optionalString,
    phone_number: optionalString,
    email: optionalString,
    lid: optionalString,
    job_no: optionalString,
    binder_amount: moneyAmount.optional(),
    deposit_amount: moneyAmount.optional(),
    merchant: optionalString,
    agent: optionalString,
    split_agent: optionalString,
    book_date: optionalFloridaCalendarDate,
    notes: optionalString,
  })
  .strict()
  .refine(
    (value) =>
      !value.split_agent ||
      !value.agent ||
      value.split_agent.trim().toLowerCase() !== value.agent.trim().toLowerCase(),
    "split_agent must be different from agent",
  )
  .refine(
    (value) =>
      requireAtLeastOne(
        Object.fromEntries(
          Object.entries(value).filter(([key]) => key !== "revision" && key !== "notes"),
        ),
      ),
    "At least one pending booking field must be provided",
  );

export type CreateEmployeeBookingSubmissionInput = z.infer<
  typeof createEmployeeBookingSubmissionSchema
>;
export type BookingLeadReconciliationListQuery = z.infer<
  typeof bookingLeadReconciliationListQuerySchema
>;
export type BookingLeadCandidateSearchInput = z.infer<
  typeof bookingLeadCandidateSearchSchema
>;
export type RefreshBookingLeadCandidatesInput = z.infer<
  typeof refreshBookingLeadCandidatesSchema
>;
export type ResolveBookingLeadReconciliationInput = z.infer<
  typeof resolveBookingLeadReconciliationSchema
>;
export type ReopenBookingLeadReconciliationInput = z.infer<
  typeof reopenBookingLeadReconciliationSchema
>;
export type UpdatePendingEmployeeBookingInput = z.infer<
  typeof updatePendingEmployeeBookingSchema
>;
export type CreateReconciliationFormLeadInput = z.infer<
  typeof createReconciliationFormLeadSchema
>;
export type CreateReconciliationCallLeadInput = z.infer<
  typeof createReconciliationCallLeadSchema
>;
