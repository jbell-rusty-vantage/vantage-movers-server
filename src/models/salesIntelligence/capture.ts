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
        },
        { _id: false, strict: "throw" },
      ),
      default: null,
    },
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
