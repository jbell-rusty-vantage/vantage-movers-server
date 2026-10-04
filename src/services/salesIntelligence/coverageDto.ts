import { z } from "zod";
import { csiDateSchema as date } from "../../validation/v1/salesIntelligence";

/**
 * Capture Coverage as every Owner read carries it: how far the Call Log is
 * known complete, the open gaps, and whether the Call Log and the telephony
 * webhook streams are healthy. Provider metadata only. Kept apart from
 * `./dto` so the Numbers and Accounts reads import no Outreach or analysis schema.
 */
export const CAPTURE_STREAM_STATES = ["ok", "unknown", "unavailable"] as const;
export const coverageDtoSchema = z
  .object({
    known_through: date.nullable(),
    gaps: z.array(z.object({ from: date, to: date, reason: z.string() }).strict()),
    capabilities: z
      .object({ call_log: z.enum(CAPTURE_STREAM_STATES), webhook: z.enum(CAPTURE_STREAM_STATES) })
      .strict(),
  })
  .strict();
export type CoverageDto = z.infer<typeof coverageDtoSchema>;

export const ownerReadSchema = <T extends z.ZodType>(data: T) =>
  z.object({ as_of: date, coverage: coverageDtoSchema, data }).strict();
