import { z } from "zod";
import {
  INCIDENT_STATUSES,
  INCIDENT_SEVERITIES,
  NOTIFICATION_PURPOSES,
  NOTIFICATION_RECIPIENT_TYPES,
  NOTIFICATION_STATUSES,
  OBSERVABILITY_LEVELS,
  OPERATIONAL_EVENT_CATEGORIES,
} from "../../config/domain/observability";

/**
 * Request schemas for the admin Observational endpoints. These mirror the
 * `admin.validation.ts` style: trimmed optional strings, coerced dates, and
 * bounded pagination. All admin observability routes inherit `requireApiSecret`
 * via `v1.routes.ts`.
 */

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional(),
);

const optionalDateString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.date().optional(),
);

const booleanInput = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(lower)) return true;
    if (["false", "0", "no", "off"].includes(lower)) return false;
  }
  return value;
}, z.boolean());

const directionSchema = z
  .preprocess(
    (value) => (typeof value === "string" ? value.toLowerCase() : value),
    z.enum(["asc", "desc"]),
  )
  .default("desc");

const optionalLevel = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.enum(OBSERVABILITY_LEVELS).optional(),
);

const optionalSeverity = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.enum(INCIDENT_SEVERITIES).optional(),
);

const optionalIncidentStatus = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.enum(INCIDENT_STATUSES).optional(),
);

const optionalCategory = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.enum(OPERATIONAL_EVENT_CATEGORIES).optional(),
);

const optionalNotificationStatus = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.enum(NOTIFICATION_STATUSES).optional(),
);

const optionalNotificationPurpose = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.enum(NOTIFICATION_PURPOSES).optional(),
);

const optionalNotificationRecipientType = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.enum(NOTIFICATION_RECIPIENT_TYPES).optional(),
);

const sharedFilters = {
  from: optionalDateString,
  to: optionalDateString,
  category: optionalCategory,
  workflow: optionalTrimmedString,
  event_key: optionalTrimmedString,
  source_company: optionalTrimmedString,
  lead_name: optionalTrimmedString,
  lead_phone: optionalTrimmedString,
  lead_email: optionalTrimmedString,
  route: optionalTrimmedString,
  entity_type: optionalTrimmedString,
  entity_id: optionalTrimmedString,
  run_id: optionalTrimmedString,
  request_id: optionalTrimmedString,
  q: optionalTrimmedString,
  limit: z.coerce.number().int().min(1).max(250).default(50),
  page: z.coerce.number().int().min(1).default(1),
  sort: optionalTrimmedString,
  direction: directionSchema,
};

export const observabilityOverviewQuerySchema = z
  .object({
    from: optionalDateString,
    to: optionalDateString,
  })
  .strip();

export const observabilityEventsQuerySchema = z
  .object({
    ...sharedFilters,
    level: optionalLevel,
    notification_candidate: booleanInput.optional(),
    reportable: booleanInput.optional(),
  })
  .strip();

export const observabilityIncidentsQuerySchema = z
  .object({
    ...sharedFilters,
    status: optionalIncidentStatus,
    severity: optionalSeverity,
    owner_visible: booleanInput.optional(),
  })
  .strip();

export const observabilityNotificationsQuerySchema = z
  .object({
    from: optionalDateString,
    to: optionalDateString,
    status: optionalNotificationStatus,
    purpose: optionalNotificationPurpose,
    recipient_type: optionalNotificationRecipientType,
    provider: optionalTrimmedString,
    incident_id: optionalTrimmedString,
    report_run_id: optionalTrimmedString,
    q: optionalTrimmedString,
    limit: z.coerce.number().int().min(1).max(250).default(50),
    page: z.coerce.number().int().min(1).default(1),
    direction: directionSchema,
  })
  .strip();

export const observabilityIncidentStatusSchema = z
  .object({
    status: z.enum(INCIDENT_STATUSES),
    actor: optionalTrimmedString,
    note: optionalTrimmedString,
  })
  .strict();

export const observabilityReportsQuerySchema = z
  .object({
    report_key: optionalTrimmedString,
    status: optionalTrimmedString,
    limit: z.coerce.number().int().min(1).max(100).default(25),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strip();

export const observabilityReportRunSchema = z
  .object({
    report_key: z.string().trim().min(1),
    from: z.coerce.date(),
    to: z.coerce.date(),
    timezone: z.string().trim().default("America/New_York"),
    category: optionalCategory,
    workflow: optionalTrimmedString,
    source_company: optionalTrimmedString,
    level: optionalLevel,
    include_resolved: booleanInput.optional(),
    requested_by: optionalTrimmedString,
  })
  .strip();

export type ObservabilityOverviewQuery = z.infer<typeof observabilityOverviewQuerySchema>;
export type ObservabilityEventsQuery = z.infer<typeof observabilityEventsQuerySchema>;
export type ObservabilityIncidentsQuery = z.infer<typeof observabilityIncidentsQuerySchema>;
export type ObservabilityNotificationsQuery = z.infer<
  typeof observabilityNotificationsQuerySchema
>;
export type ObservabilityIncidentStatusInput = z.infer<
  typeof observabilityIncidentStatusSchema
>;
export type ObservabilityReportsQuery = z.infer<typeof observabilityReportsQuerySchema>;
export type ObservabilityReportRunInput = z.infer<typeof observabilityReportRunSchema>;
