import { z } from "zod";
import {
  csiDateSchema as date,
  csiRevisionSchema as revision,
  csiPolicySchema,
} from "../../validation/v1/salesIntelligence";
import { coverageDtoSchema, ownerReadSchema, type CoverageDto } from "./coverageDto";
export { coverageDtoSchema, ownerReadSchema, type CoverageDto };
const nonnegative = z.number().int().nonnegative();
const unknownCount = nonnegative.nullable();
const callLogSweepShape = {
  ran_at: date,
  from: date,
  to: date,
  complete: z.boolean(),
  provider_records: nonnegative,
  stored_in_latest_version: nonnegative,
  applied_changes: nonnegative,
  missing_before: nonnegative,
  stale_before: nonnegative,
  provisional_after_horizon: nonnegative,
  quarantined: nonnegative,
  consecutive_drift_runs: nonnegative,
};
/**
 * `GET /coverage`: capture coverage plus the Call Log, webhook and directory
 * health behind the Numbers and RingCentral Accounts views. Provider metadata only.
 */
export const ownerCoverageDtoSchema = coverageDtoSchema.extend({
  // CC-01/CC-06: Call Log capture completeness, readable without logs.
  // Quarantined records are retried hourly and never hold the window; the
  // last sweep says how many provider calls needed correction.
  call_log_capture: z
    .object({
      quarantined_count: nonnegative,
      oldest_quarantined_at: date.nullable(),
      sync_mode: z.enum(["off", "shadow", "on"]),
      last_sweep: z.object(callLogSweepShape).strict().nullable(),
    })
    .strict(),
  // S5c-HEALTH (G6): the server-computed capture headline.
  // `status`: `broken` when the webhook is `down` or the oldest quarantine is
  // older than 24 h; `attention` when the webhook is `degraded`, a quarantine
  // exists or a call is pending finalization; otherwise `ok`. Stable `reasons`
  // keys, broken ones first: `webhook_down`, `quarantine_over_24h`,
  // `webhook_degraded`, `quarantine`, `pending_finalization`.
  // `webhook.state`: `off` (SALES_INTELLIGENCE_CAPTURE_WEBHOOK off), `down`
  // (no owned subscription, expired or provider-terminal, or the latest
  // maintenance run in the last 26 h failed), `degraded` (no receipt for 30
  // staffed minutes while the Call Log shows calls in those minutes), else
  // `healthy`. Only a suffix of the subscription id is exposed.
  capture_health: z
    .object({
      as_of: date,
      status: z.enum(["ok", "attention", "broken"]),
      reasons: z.array(z.enum(["webhook_down", "quarantine_over_24h", "webhook_degraded", "quarantine", "pending_finalization"])),
      known_complete_through: date.nullable(),
      call_log: z
        .object({
          sync_mode: z.enum(["off", "shadow", "on"]),
          last_reconcile_at: date.nullable(),
          quarantined_count: nonnegative,
          oldest_quarantined_at: date.nullable(),
          last_sweep: z
            .object({
              ...callLogSweepShape,
              // Derived: min(applied_changes, missing_before + stale_before), the
              // measured drift the sweep actually applied (calls added or corrected).
              recovered_calls: nonnegative,
            })
            .strict()
            .nullable(),
        })
        .strict(),
      webhook: z
        .object({
          state: z.enum(["healthy", "degraded", "down", "off"]),
          subscription_id_suffix: z.string().nullable(),
          subscription_expires_at: date.nullable(),
          last_receipt_at: date.nullable(),
          receipts_1h: nonnegative,
          last_renewal_at: date.nullable(),
          last_renewal_error: z.string().nullable(),
        })
        .strict(),
      in_progress_calls: nonnegative,
      pending_finalization: nonnegative,
    })
    .strict(),
  mapping_hygiene: z
    .object({
      unmapped_inbound_numbers: nonnegative,
      unmapped_directory_users: unknownCount,
      last_directory_sync_at: date.nullable(),
      directory_status: z.enum(["stored", "missing"]),
    })
    .strict(),
});
/** `GET /settings`: the retained Owner policy and the environment kill switches (display only). */
export const csiSettingsReadDtoSchema = z
  .object({
    persisted: z.boolean(),
    revision: revision,
    source: z.enum(["persisted", "accepted_defaults"]),
    policy: csiPolicySchema,
    flags: z.record(z.string(), z.boolean()),
    updated_at: date.nullable(),
    updated_by: z.string().nullable(),
  })
  .strict();
export type OwnerCoverageDto = z.infer<typeof ownerCoverageDtoSchema>;
export type CsiSettingsReadDto = z.infer<typeof csiSettingsReadDtoSchema>;
