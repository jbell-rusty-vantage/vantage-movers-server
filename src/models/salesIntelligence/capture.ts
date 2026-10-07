import { Schema } from "mongoose";
import {
  defineCsiModel,
  str,
  text,
  oid,
  ref,
  date,
  at,
  revision,
  count,
  strings,
  enumeration,
  unique,
  index,
} from "./common";
export const CALL_INTERACTION_ALIAS_INDEXES = [
  unique("csi_alias_unique", {
    provider: 1,
    provider_account_id: 1,
    kind: 1,
    value: 1,
  }),
  index("csi_alias_interaction", { interaction_id: 1 }),
];
export const CallInteractionAliasSchema = new Schema(
  {
    provider: enumeration(["ringcentral"]),
    provider_account_id: str,
    kind: enumeration(["telephony_session_id", "session_id", "call_log_id"]),
    value: str,
    interaction_id: oid,
    proof_ref: text,
  },
  { collection: "call_interaction_aliases" },
);
export const getCallInteractionAliasModel = defineCsiModel(
  "CallInteractionAlias",
  CallInteractionAliasSchema,
  CALL_INTERACTION_ALIAS_INDEXES,
);
export const RING_CENTRAL_DIRECTORY_SNAPSHOT_INDEXES = [
  unique("csi_directory_digest_unique", { provider_account_id: 1, digest: 1 }),
  index("csi_directory_taken", { taken_at: -1 }),
];
export const RingCentralDirectorySnapshotSchema = new Schema(
  {
    provider_account_id: str,
    taken_at: at,
    digest: str,
    extensions: {
      type: [
        new Schema(
          {
            id: str,
            extension_number: text,
            type: str,
            name: text,
            status: str,
            direct_numbers: strings,
            sms_sender_numbers: strings,
          },
          { _id: false, strict: "throw" },
        ),
      ],
      default: [],
    },
    company_numbers: {
      type: [
        new Schema(
          { id: str, e164: str, usage_type: text, extension_id: text },
          { _id: false, strict: "throw" },
        ),
      ],
      default: [],
    },
    queues: {
      type: [
        new Schema(
          {
            id: str,
            extension_number: text,
            name: text,
            member_extension_ids: strings,
          },
          { _id: false, strict: "throw" },
        ),
      ],
      default: [],
    },
    counts: {
      type: new Schema(
        {
          extensions: count,
          users: count,
          departments: count,
          company_numbers: count,
          queues: count,
        },
        { _id: false, strict: "throw" },
      ),
      required: true,
    },
  },
  { collection: "ringcentral_directory_snapshots" },
);
export const getRingCentralDirectorySnapshotModel = defineCsiModel(
  "RingCentralDirectorySnapshot",
  RingCentralDirectorySnapshotSchema,
  RING_CENTRAL_DIRECTORY_SNAPSHOT_INDEXES,
  true,
);
export const SALES_INTELLIGENCE_SYNC_STATE_INDEXES = [
  unique("sales_intelligence_sync_state_scope_unique", { scope: 1 }),
];
export const SalesIntelligenceSyncStateSchema = new Schema(
  {
    scope: str,
    lease_owner: text,
    leased_until: date,
    lease_epoch: count,
    cursor: {
      type: new Schema(
        {
          last_sync_from: date,
          last_sync_to: date,
          provider_modified_watermark: date,
          attachment_source_id: ref,
          entity_change_applied_at: date,
          entity_change_id: ref,
          // Sales Outreach Desk revision reconcile: the last subject id of its bounded pass.
          outreach_subject_id: ref,
          // Sales Outreach Desk contact-event sweep (S3, SRV-6): `(updatedAt, _id)` of the last
          // source row derived (scopes `outreach_contact_calls` / `outreach_contact_sms`) and the
          // first instant the derived evidence covers (the bootstrap start).
          outreach_source_updated_at: date,
          outreach_source_id: ref,
          outreach_coverage_from: date,
        },
        { _id: false, strict: "throw" },
      ),
      default: () => ({}),
    },
    known_complete_through: date,
    // Outreach lifecycle repair A3 (D-A3): the same watermark without the provisional-row cap (it keeps
    // the finalization lag and the ISync-time cap); never below `known_complete_through`. Written by the
    // Call Log reconcile (`call_log_all_directions`) and by the contact-event calls sweep when it catches
    // up (`outreach_contact_calls`). Goal counting reads it; cadence verdicts keep the capped value.
    observed_complete_through: date,
    // Outreach lifecycle repair A3 (F5): last instant the 5-minute reconcile's own Call Log Sync step
    // (mode `on`) stored a token, i.e. confirmed calls outside the minute lane (`call_log_all_directions`).
    // Sticky: a run without a sync success leaves it unchanged.
    reconcile_sync_success_at: date,
    last_run: {
      type: new Schema(
        {
          started_at: at,
          finished_at: date,
          runtime_ms: count,
          pages: count,
          records: count,
          upserts: count,
          throttled_count: count,
          error_code: text,
          // Call Log reconcile (CC-01/CC-03/CC-05). Absent on other scopes.
          quarantined: { type: Number, min: 0 },
          quarantine_retries: { type: Number, min: 0 },
          straggler_reads: { type: Number, min: 0 },
          settled_from_store: { type: Number, min: 0 },
          sync_mode: { type: String },
          sync_type: { type: String },
          sync_records: { type: Number, min: 0 },
          sync_changed: { type: Number, min: 0 },
          sync_applied: { type: Number, min: 0 },
          sync_token_stored: { type: Boolean },
          sync_error_code: { type: String },
          // Nightly Call Log sweep (CC-06), scope `call_log_sweep`.
          from: { type: Date },
          to: { type: Date },
          provider_records: { type: Number, min: 0 },
          stored_in_latest_version: { type: Number, min: 0 },
          applied_changes: { type: Number, min: 0 },
          missing_before: { type: Number, min: 0 },
          stale_before: { type: Number, min: 0 },
          provisional_after_horizon: { type: Number, min: 0 },
          failures: { type: Number, min: 0 },
        },
        { _id: false, strict: "throw" },
      ),
      default: null,
    },
    // CC-01: records that failed repeatedly, retried by id on a backoff so one
    // bad record never holds the window (scope `call_log_all_directions`).
    quarantined_records: {
      type: [
        new Schema(
          {
            call_log_id: str,
            telephony_session_id: text,
            start_time: date,
            error_code: str,
            error_name: str,
            failures: count,
            first_failed_at: at,
            last_failed_at: at,
            next_retry_at: at,
          },
          { _id: false, strict: "throw" },
        ),
      ],
      default: undefined,
      validate: (v: unknown[] | undefined) => (v?.length ?? 0) <= 200,
    },
    record_failures: {
      type: [
        new Schema(
          { call_log_id: str, failures: count, last_error_code: str },
          { _id: false, strict: "throw" },
        ),
      ],
      default: undefined,
      validate: (v: unknown[] | undefined) => (v?.length ?? 0) <= 500,
    },
    // CC-05: account Call Log Sync position. The token is provider state; it
    // never appears in logs, events or summaries.
    call_log_sync: {
      type: new Schema(
        {
          token: text,
          sync_time: date,
          last_full_sync_at: date,
          consecutive_expiries: count,
        },
        { _id: false, strict: "throw" },
      ),
      default: undefined,
    },
    // RINGCENTRAL-CAPTURE §4: the staffed-hours minute ISync lane's last outcome
    // (scope `call_log_all_directions`). Freshness reads use `last_success_at`.
    isync_lane: {
      type: new Schema(
        {
          last_run_at: date,
          last_success_at: date,
          last_error_code: text,
          last_records: { type: Number, min: 0, default: 0 },
          last_applied: { type: Number, min: 0, default: 0 },
        },
        { _id: false, strict: "throw" },
      ),
      default: undefined,
    },
    // RINGCENTRAL-CAPTURE §5: one rep mailbox's message-sync position and coverage
    // (scope `rep_sms:<extensionId>`). The token is provider state and never logged.
    message_sync: {
      type: new Schema(
        {
          extension_id: text,
          token: text,
          sync_time: date,
          last_full_sync_at: date,
          last_success_at: date,
          /** Oldest instant the stored history is complete from (FSync `dateFrom`, or the oldest record when older ones exist). */
          coverage_from: date,
          consecutive_expiries: { type: Number, min: 0, default: 0 },
        },
        { _id: false, strict: "throw" },
      ),
      default: undefined,
    },
    // Outreach lifecycle repair C7: this mailbox's SMS contact events still `pending_identity` /
    // `pending_association` with `event_at` in the last 7 days (scope `rep_sms:<extensionId>`), refreshed by
    // the contact-events cron at most every 5 minutes. `agent_id` is the mailbox's reviewed rep at
    // `computed_at` (null when it is no longer a reviewed mailbox); `since` the oldest pending event.
    rep_sms_pending: {
      type: new Schema(
        {
          identity: count,
          association: count,
          since: date,
          agent_id: ref,
          computed_at: at,
        },
        { _id: false, strict: "throw" },
      ),
      default: undefined,
    },
    // CC-06: consecutive sweeps that found drift (scope `call_log_sweep`).
    consecutive_drift_runs: { type: Number, min: 0, default: undefined },
    gaps: {
      type: [
        new Schema(
          { from: at, to: at, reason: str, opened_at: at },
          { _id: false, strict: "throw" },
        ),
      ],
      default: [],
      validate: (v: unknown[]) => v.length <= 50,
    },
    consecutive_failures: count,
  },
  { collection: "sales_intelligence_sync_state" },
);
export const getSalesIntelligenceSyncStateModel = defineCsiModel(
  "SalesIntelligenceSyncState",
  SalesIntelligenceSyncStateSchema,
  SALES_INTELLIGENCE_SYNC_STATE_INDEXES,
);
