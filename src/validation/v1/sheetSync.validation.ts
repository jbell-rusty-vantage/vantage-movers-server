import { z } from "zod";
import {
  SHEET_CONTAINS_MAX_IDS,
  SHEET_SYNC_ENTITY_MODELS,
  SHEET_SYNC_JOB_STATUSES,
  SHEET_SYNC_RESOURCES,
  SHEET_SYNC_RUN_STATUSES,
} from "../../config/domain";
import { objectIdSchema } from "./common";

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional(),
);

/**
 * `GET /api/v1/admin/sheet-sync/jobs` filters. All read-only; the admin surface
 * exposes the durable outbox for inspection (no mutation here).
 */
export const sheetSyncJobsQuerySchema = z
  .object({
    status: z.enum(SHEET_SYNC_JOB_STATUSES).optional(),
    resource: z.enum(SHEET_SYNC_RESOURCES).optional(),
    entity_id: optionalTrimmedString,
    job_id: objectIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(250).default(50),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strip();

/** `GET /api/v1/admin/sheet-sync/runs` filters. */
export const sheetSyncRunsQuerySchema = z
  .object({
    status: z.enum(SHEET_SYNC_RUN_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strip();

/**
 * `POST /api/v1/admin/sheet-sync/retry` body. Re-queues jobs either by explicit
 * ids or by a status filter (defaulting to failed). Bounded by `limit` so a
 * single retry call can never re-arm an unbounded backlog.
 */
export const sheetSyncRetrySchema = z
  .object({
    job_ids: z.array(objectIdSchema).max(500).optional(),
    statuses: z.array(z.enum(SHEET_SYNC_JOB_STATUSES)).nonempty().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strip();

/**
 * `POST /api/v1/admin/sheet-sync/contains` body. Owner-only live read of
 * Master Sheets for a bounded set of Mongo ids. Does not write or retry.
 */
export const sheetContainsSchema = z
  .object({
    entity_model: z.enum(SHEET_SYNC_ENTITY_MODELS),
    ids: z.array(objectIdSchema).min(1).max(SHEET_CONTAINS_MAX_IDS),
  })
  .strip();

export type SheetSyncJobsQuery = z.infer<typeof sheetSyncJobsQuerySchema>;
export type SheetSyncRunsQuery = z.infer<typeof sheetSyncRunsQuerySchema>;
export type SheetSyncRetryInput = z.infer<typeof sheetSyncRetrySchema>;
export type SheetContainsInput = z.infer<typeof sheetContainsSchema>;
