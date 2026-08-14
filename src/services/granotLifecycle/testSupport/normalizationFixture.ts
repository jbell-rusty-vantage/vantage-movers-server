import { z } from "zod";
import type {
  ChannelOperationKind,
  GranotBookingAction,
  GranotObservationKind,
  GranotRouteEventClass,
  NormalizationIssueCode,
  NormalizationResult,
  ObservationChannel,
} from "../types";

export const observationChannelSchema = z.enum([
  "granot_webhook",
  "browser_extension",
  "granot_http_automation",
]);

export const granotRouteEventClassSchema = z.enum([
  "lead_created",
  "priority_updated",
  "booking_status_changed",
]);

export const channelOperationKindSchema = z.enum([
  "lead_snapshot_apply",
  "booking_action_apply",
]);

const granotObservationKindSchema = z.enum([
  "lead_snapshot",
  "booking_action_snapshot",
]);

const normalizationResultSchema = z.enum([
  "valid",
  "valid_with_issues",
  "invalid",
  "unsupported",
]);

const normalizationIssueCodeSchema = z.enum([
  "payload_not_object",
  "route_payload_event_conflict",
  "missing_payload_event_type",
  "unsupported_booking_action",
  "invalid_source_label",
  "missing_job_number",
  "invalid_form_reference",
  "invalid_phone",
  "invalid_email",
  "invalid_move_date",
  "invalid_state",
  "invalid_cubic_feet",
  "invalid_priority",
  "invalid_money",
  "granot_agent_identity_conflict",
]);

const granotBookingActionSchema = z.enum(["booked", "release"]);

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const fixtureInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("payload"),
      value: jsonValueSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("statement"),
      value: jsonValueSchema,
    })
    .strict(),
]);

const expectedNormalizationSchema = z
  .object({
    observation_kind: granotObservationKindSchema,
    normalization_result: normalizationResultSchema,
    issue_codes: z.array(normalizationIssueCodeSchema),
    priority: z
      .object({
        raw: jsonValueSchema.optional(),
        canonical: z.string().regex(/^(0|[1-9][0-9]{0,11})$/).optional(),
        valid: z.boolean(),
      })
      .strict()
      .optional(),
    booking_action: z
      .object({
        raw: z.string().optional(),
        normalized: granotBookingActionSchema.optional(),
      })
      .strict()
      .optional(),
    source_label: z
      .object({
        raw: z.string(),
        normalized: z.string().optional(),
      })
      .strict()
      .optional(),
    identity: z
      .object({
        job_no_raw: z.string().optional(),
        normalized_job_no: z.string().optional(),
        form_ref_raw: z.string().optional(),
        normalized_form_ref: z.string().optional(),
      })
      .strict()
      .optional(),
    provider_context: z
      .object({
        type_raw: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const forbiddenInferenceSchema = z.enum([
  "blank_form_reference_is_exact_identity",
  "mongo_id_precedes_exact_form_reference",
  "priority_authorizes_broad_enrichment",
  "priority_sets_quoted_false",
  "booking_action_is_lifecycle_transition",
  "booking_action_is_official_booking_fact",
  "booking_action_is_official_cancellation_fact",
  "type_drives_source_classification",
  "deferred_source_authorizes_effects",
]);

const fixtureCommonShape = {
  schema_version: z.literal(1),
  fixture_id: z.string().regex(/^synthetic_[a-z0-9_]+$/),
  acceptance_ids: z
    .array(z.string().regex(/^AC-(?:0[1-9]|[1-3][0-9]|40)$/))
    .min(1),
  input: fixtureInputSchema,
  identity_setup: z
    .object({
      persisted_form_ref_no: z.string(),
      posted_leadno: z.string(),
    })
    .strict()
    .optional(),
  expected: expectedNormalizationSchema,
  forbidden_inferences: z.array(forbiddenInferenceSchema),
};

const webhookFixtureSchema = z
  .object({
    ...fixtureCommonShape,
    channel: z.literal("granot_webhook"),
    route_event_class: granotRouteEventClassSchema,
  })
  .strict();

const extensionFixtureSchema = z
  .object({
    ...fixtureCommonShape,
    channel: z.literal("browser_extension"),
    operation_kind: channelOperationKindSchema,
    operation_id: z.string().uuid({ version: "v4" }),
  })
  .strict();

const automationFixtureSchema = z
  .object({
    ...fixtureCommonShape,
    channel: z.literal("granot_http_automation"),
    operation_kind: channelOperationKindSchema,
    operation_id: z
      .string()
      .regex(/^synthetic-run-[a-z0-9-]+:synthetic-action-[a-z0-9-]+$/),
  })
  .strict();

function inputEventType(input: z.infer<typeof fixtureInputSchema>): string | undefined {
  if (
    typeof input.value !== "object" ||
    input.value === null ||
    Array.isArray(input.value)
  ) {
    return undefined;
  }
  const eventType = input.value.event_type;
  return typeof eventType === "string" ? eventType.trim().toLowerCase() : undefined;
}

function inputObject(
  input: z.infer<typeof fixtureInputSchema>,
): { [key: string]: JsonValue } | undefined {
  if (
    typeof input.value !== "object" ||
    input.value === null ||
    Array.isArray(input.value)
  ) {
    return undefined;
  }
  return input.value;
}

function normalizedBookingAction(raw: string | undefined): GranotBookingAction | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "booked") {
    return "booked";
  }
  if (normalized === "releas" || normalized === "release") {
    return "release";
  }
  return undefined;
}

function canonicalPriority(raw: JsonValue | undefined): string | undefined {
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw >= 0 ? String(raw) : undefined;
  }
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!/^[0-9]{1,12}$/.test(trimmed)) {
    return undefined;
  }
  return trimmed.replace(/^0+(?=\d)/, "");
}

export const normalizationFixtureSchema = z
  .discriminatedUnion("channel", [
    webhookFixtureSchema,
    extensionFixtureSchema,
    automationFixtureSchema,
  ])
  .superRefine((fixture, context) => {
    const input = inputObject(fixture.input);
    const priority = fixture.expected.priority;
    const inputPriority = input?.priority;
    if (
      (priority === undefined && inputPriority !== undefined) ||
      (priority?.raw !== undefined &&
        JSON.stringify(priority.raw) !== JSON.stringify(inputPriority)) ||
      (priority?.raw === undefined && inputPriority !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["expected", "priority", "raw"],
        message: "Priority raw expectation must match the input Priority",
      });
    }
    if (priority !== undefined) {
      const derivedCanonical = canonicalPriority(priority.raw);
      if (
        (priority.valid &&
          (priority.raw === undefined ||
            priority.canonical === undefined ||
            priority.canonical !== derivedCanonical)) ||
        (!priority.valid && priority.canonical !== undefined)
      ) {
        context.addIssue({
          code: "custom",
          path: ["expected", "priority"],
          message: "Priority raw, canonical, and validity expectations disagree",
        });
      }
      const hasInvalidPriorityIssue = fixture.expected.issue_codes.includes("invalid_priority");
      if (priority.valid === hasInvalidPriorityIssue) {
        context.addIssue({
          code: "custom",
          path: ["expected", "issue_codes"],
          message: "Priority validity and invalid_priority issue expectation disagree",
        });
      }
    }

    const rawInputAction = inputEventType(fixture.input);
    const expectedRawAction = fixture.expected.booking_action?.raw;
    const derivedAction = normalizedBookingAction(rawInputAction);
    const bookingActionAuthority =
      (fixture.channel === "granot_webhook" &&
        fixture.route_event_class === "booking_status_changed") ||
      (fixture.channel !== "granot_webhook" &&
        fixture.operation_kind === "booking_action_apply");
    if (
      expectedRawAction !== undefined &&
      expectedRawAction.trim().toLowerCase() !== rawInputAction
    ) {
      context.addIssue({
        code: "custom",
        path: ["expected", "booking_action", "raw"],
        message: "Booking Action raw expectation must match the input event_type",
      });
    }
    if (
      fixture.expected.booking_action?.normalized !== undefined &&
      fixture.expected.booking_action.normalized !== derivedAction
    ) {
      context.addIssue({
        code: "custom",
        path: ["expected", "booking_action", "normalized"],
        message: "Booking Action normalization expectation disagrees with input event_type",
      });
    }
    if (
      bookingActionAuthority &&
      derivedAction !== undefined &&
      (fixture.expected.booking_action?.raw === undefined ||
        fixture.expected.booking_action.normalized !== derivedAction)
    ) {
      context.addIssue({
        code: "custom",
        path: ["expected", "booking_action"],
        message: "Supported Booking Action input requires matching raw and normalized expectations",
      });
    }
    if (
      bookingActionAuthority &&
      derivedAction !== undefined &&
      !["valid", "valid_with_issues"].includes(fixture.expected.normalization_result)
    ) {
      context.addIssue({
        code: "custom",
        path: ["expected", "normalization_result"],
        message: "Supported Booking Action input requires a supported normalization result",
      });
    }
    if (
      fixture.expected.booking_action !== undefined &&
      derivedAction === undefined &&
      fixture.expected.normalization_result !== "unsupported"
    ) {
      context.addIssue({
        code: "custom",
        path: ["expected", "normalization_result"],
        message: "Unsupported Booking Action input requires an unsupported result",
      });
    }
    if (
      fixture.expected.booking_action !== undefined &&
      derivedAction === undefined &&
      !fixture.expected.issue_codes.includes("unsupported_booking_action")
    ) {
      context.addIssue({
        code: "custom",
        path: ["expected", "issue_codes"],
        message: "Unsupported Booking Action requires its normalization issue",
      });
    }
    if (
      derivedAction !== undefined &&
      fixture.expected.issue_codes.includes("unsupported_booking_action")
    ) {
      context.addIssue({
        code: "custom",
        path: ["expected", "issue_codes"],
        message: "Supported Booking Action cannot carry unsupported_booking_action",
      });
    }

    const factPairs: Array<{
      inputValue: JsonValue | undefined;
      expectedValue: string | undefined;
      path: string[];
    }> = [
      {
        inputValue: input?.ref_no,
        expectedValue: fixture.expected.identity?.form_ref_raw,
        path: ["expected", "identity", "form_ref_raw"],
      },
      {
        inputValue: input?.job_no,
        expectedValue: fixture.expected.identity?.job_no_raw,
        path: ["expected", "identity", "job_no_raw"],
      },
      {
        inputValue: input?.label,
        expectedValue: fixture.expected.source_label?.raw,
        path: ["expected", "source_label", "raw"],
      },
      {
        inputValue: input?.type,
        expectedValue: fixture.expected.provider_context?.type_raw,
        path: ["expected", "provider_context", "type_raw"],
      },
    ];
    for (const pair of factPairs) {
      if (
        (pair.inputValue !== undefined || pair.expectedValue !== undefined) &&
        (typeof pair.inputValue !== "string" || pair.inputValue !== pair.expectedValue)
      ) {
        context.addIssue({
          code: "custom",
          path: pair.path,
          message: "Expected raw fact must match its synthetic input field",
        });
      }
    }

    if (fixture.channel === "granot_webhook") {
      const requiredKind =
        fixture.route_event_class === "booking_status_changed"
          ? "booking_action_snapshot"
          : "lead_snapshot";
      if (fixture.expected.observation_kind !== requiredKind) {
        context.addIssue({
          code: "custom",
          path: ["expected", "observation_kind"],
          message: "Webhook route class and expected observation kind disagree",
        });
      }
      if (
        fixture.route_event_class === "booking_status_changed" &&
        fixture.expected.booking_action === undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["expected", "booking_action"],
          message: "booking_status_changed requires a Booking Action expectation",
        });
      }
      if (fixture.route_event_class !== "booking_status_changed") {
        const allowedEventTypes =
          fixture.route_event_class === "lead_created"
            ? ["lead_created"]
            : ["priority_update", "priority_updated"];
        const eventConflict =
          rawInputAction !== undefined && !allowedEventTypes.includes(rawInputAction);
        if (
          eventConflict &&
          (fixture.expected.normalization_result !== "invalid" ||
            !fixture.expected.issue_codes.includes("route_payload_event_conflict"))
        ) {
          context.addIssue({
            code: "custom",
            path: ["expected", "normalization_result"],
            message: "Webhook route/payload event conflict must be invalid and explicit",
          });
        }
        if (
          !eventConflict &&
          rawInputAction !== undefined &&
          fixture.expected.issue_codes.includes("route_payload_event_conflict")
        ) {
          context.addIssue({
            code: "custom",
            path: ["expected", "issue_codes"],
            message: "Compatible webhook route/payload events cannot claim a conflict",
          });
        }
      }
      return;
    }

    if (fixture.operation_kind === "lead_snapshot_apply") {
      if (fixture.expected.observation_kind !== "lead_snapshot") {
        context.addIssue({
          code: "custom",
          path: ["expected", "observation_kind"],
          message: "lead_snapshot_apply requires a lead snapshot expectation",
        });
      }
      if (
        fixture.expected.booking_action?.normalized !== undefined ||
        ["booked", "releas", "release"].includes(inputEventType(fixture.input) ?? "")
      ) {
        context.addIssue({
          code: "custom",
          path: ["operation_kind"],
          message: "lead_snapshot_apply cannot authorize a Booking Action",
        });
      }
      return;
    }

    if (
      fixture.expected.observation_kind !== "booking_action_snapshot" ||
      fixture.expected.booking_action?.normalized === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["expected", "booking_action"],
        message: "booking_action_apply requires a supported Booking Action expectation",
      });
    }
  });

export type NormalizationFixture = z.infer<typeof normalizationFixtureSchema>;

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;
type ExpectedNormalization = z.infer<typeof expectedNormalizationSchema>;

type _ObservationChannelSchemaExact = Assert<
  Equal<z.infer<typeof observationChannelSchema>, ObservationChannel>
>;
type _RouteEventSchemaExact = Assert<
  Equal<z.infer<typeof granotRouteEventClassSchema>, GranotRouteEventClass>
>;
type _OperationKindSchemaExact = Assert<
  Equal<z.infer<typeof channelOperationKindSchema>, ChannelOperationKind>
>;
type _ObservationKindSchemaExact = Assert<
  Equal<ExpectedNormalization["observation_kind"], GranotObservationKind>
>;
type _NormalizationResultSchemaExact = Assert<
  Equal<ExpectedNormalization["normalization_result"], NormalizationResult>
>;
type _NormalizationIssueSchemaExact = Assert<
  Equal<ExpectedNormalization["issue_codes"][number], NormalizationIssueCode>
>;
type _BookingActionSchemaExact = Assert<
  Equal<
    NonNullable<ExpectedNormalization["booking_action"]>["normalized"],
    GranotBookingAction | undefined
  >
>;
