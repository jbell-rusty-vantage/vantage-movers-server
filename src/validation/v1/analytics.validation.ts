import { z } from "zod";
import { adminDatabaseScopeSchema } from "./admin.validation";

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional(),
);

const optionalDateString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.date().optional(),
);

const optionalObjectIdString = optionalTrimmedString.refine(
  (value) => value === undefined || /^[a-f\d]{24}$/i.test(value),
  "Invalid Mongo ObjectId",
);

export const analyticsReportSchema = z.enum([
  "summary",
  "revenue-trend",
  "source-company-performance",
  "agent-performance",
  "booking-cancellation-ratio",
  "source-company-funnel",
  "cancellation-reasons",
  "lead-source-performance",
  "local-vs-long-distance",
  "geographic-lanes",
  "pickup-state-performance",
  "delivery-state-performance",
  "receiver-agent-performance",
  "receiver-agent-trend",
  "receiver-agent-source-breakdown",
  "sms-successfully-sent-then-booked",
]);

export const analyticsQuerySchema = z
  .object({
    database_scope: adminDatabaseScopeSchema,
    from: optionalDateString,
    to: optionalDateString,
    source_company: optionalTrimmedString,
    source_granularity_key: optionalTrimmedString,
    source: optionalTrimmedString,
    agent: optionalTrimmedString,
    receiver_agent: optionalObjectIdString,
    merchant: optionalTrimmedString,
    local: optionalTrimmedString,
    lead_type: z
      .preprocess(
        (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
        z.enum(["form", "call", "FormLead", "CallLead"]).optional(),
      )
      .transform((value) => {
        if (value === "form") return "FormLead";
        if (value === "call") return "CallLead";
        return value;
      }),
    granularity: z
      .preprocess(
        (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
        z.enum(["day", "month"]).optional(),
      )
      .default("month"),
  })
  .strip();

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type AnalyticsReport = z.infer<typeof analyticsReportSchema>;

export const overviewQuerySchema = z
  .object({
    database_scope: adminDatabaseScopeSchema,
  })
  .strip();

export type OverviewQuery = z.infer<typeof overviewQuerySchema>;
