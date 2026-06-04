import { z } from "zod";
import { nonEmptyString, optionalString } from "./common";

/**
 * Operational batch schemas for CRM-driven workflows.
 *
 * - Call lead enrichment batches (pairs with `api/services/enrichment/`).
 * - Booked call lead reconciliation batches (pairs with
 *   `api/services/reconciliation/`).
 */

const callLeadEnrichmentRowSchema = z
  .object({
    row_id: nonEmptyString,
    row_index: z.coerce.number().int().min(0).optional(),
    job_no: optionalString,
    source: optionalString,
    customer: optionalString,
    phone: optionalString,
    email: optionalString,
    from_zip: optionalString,
    to_zip: optionalString,
    est_cf: optionalString,
  })
  .strict();

export const callLeadEnrichmentBatchSchema = z
  .object({
    rows: z.array(callLeadEnrichmentRowSchema).min(1).max(100),
  })
  .strict();

const bookedCallLeadReconciliationRowSchema = z
  .object({
    row_id: nonEmptyString,
    row_index: z.coerce.number().int().min(0).optional(),
    section: z.enum(["bookedJobs", "followUpEstimates"]).optional(),
    job_no: optionalString,
    source: optionalString,
    prior: optionalString,
    book_date: optionalString,
    customer: optionalString,
    phone: optionalString,
    email: optionalString,
    from_zip: optionalString,
    to_zip: optionalString,
    est_cf: optionalString,
  })
  .strict();

export const bookedCallLeadReconciliationBatchSchema = z
  .object({
    rows: z.array(bookedCallLeadReconciliationRowSchema).min(1).max(100),
  })
  .strict();

export type CallLeadEnrichmentBatchInput = z.infer<typeof callLeadEnrichmentBatchSchema>;
export type CallLeadEnrichmentRowInput = CallLeadEnrichmentBatchInput["rows"][number];
export type BookedCallLeadReconciliationBatchInput = z.infer<
  typeof bookedCallLeadReconciliationBatchSchema
>;
export type BookedCallLeadReconciliationRowInput =
  BookedCallLeadReconciliationBatchInput["rows"][number];
