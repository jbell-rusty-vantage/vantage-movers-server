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
          // CSI-14: durable position in the CSI audit stream, so number
          // synthesis follows committed change rather than a round-robin
          // poll that laps in days (14 §10).
          audit_recorded_at: date,
          audit_event_id: ref,
        },
        { _id: false, strict: "throw" },
      ),
      default: () => ({}),
    },
    known_complete_through: date,
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
export const SALES_INTELLIGENCE_SYNC_WINDOW_INDEXES = [
  unique("csi_window_unique", { stream: 1, window_from: 1 }),
];
export const SalesIntelligenceSyncWindowSchema = new Schema(
  {
    stream: str,
    window_from: at,
    window_to: at,
    status: enumeration(
      ["planned", "running", "complete", "partial", "failed"],
      "planned",
    ),
    pages_done: count,
    records: count,
    checkpoint_page: count,
    attempts: count,
    last_error_code: text,
    completed_at: date,
    work_lease_owner: text,
    work_lease_epoch: count,
    work_leased_until: date,
    retry_after_until: date,
    activation_status: { type: String, enum: ["pending", "complete"], default: null },
    permission_paused: { type: Boolean, default: false },
    activation_contact_cursor: ref,
    activation_number_id: ref,
    activation_call_at: date,
    activation_call_id: ref,
  },
  { collection: "sales_intelligence_sync_windows" },
);
export const getSalesIntelligenceSyncWindowModel = defineCsiModel(
  "SalesIntelligenceSyncWindow",
  SalesIntelligenceSyncWindowSchema,
  SALES_INTELLIGENCE_SYNC_WINDOW_INDEXES,
);
