import { Schema } from "mongoose";
import {
  REP_SMS_ASSOCIATION_QUALITIES,
  REP_SMS_CREDIT_EFFECTS,
  REP_SMS_DIRECTIONS,
  REP_SMS_IDENTITY_STATES,
  REP_SMS_STATUSES,
  REP_SMS_SYNC_KINDS,
} from "../../config/domain/ringcentralRepSms";
import { at, date, defineCsiModel, enumeration, index, oid, ref, revision, str, strings, text, unique } from "../salesIntelligence/common";

/**
 * `ringcentral_rep_sms_evidence` — one row per (provider account, owning rep mailbox, message id),
 * written by the rep SMS mailbox sync (RINGCENTRAL-CAPTURE §5, CONTRACTS, IMPLEMENTATION-PLAN §4.7).
 *
 * Metadata only: no message body, subject or attachment is ever stored. The status history is kept
 * (bounded) so a later SendingFailed/DeliveryFailed can revoke an earlier Sent credit while the
 * history stays visible (P07d). `source_revision` increases on every material change; the desk wakes
 * on `(row, source_revision)`. Association to a desk subject is resolved by the desk (SRV-6).
 */
export const RINGCENTRAL_REP_SMS_EVIDENCE_INDEXES = [
  unique("sod_rsms_message_unique", { provider_account_id: 1, owning_extension_id: 1, message_id: 1 }),
  index("sod_rsms_counterpart_created", { counterpart_numbers: 1, provider_created_at: 1 }),
  index("sod_rsms_rep_send", { "reviewed_rep_ref.agent_id": 1, send_at: 1 }),
  index("sod_rsms_updated", { updatedAt: 1, _id: 1 }),
  // SRV-6: mailbox copies of one logical message (one credit per logical send).
  index("sod_rsms_logical", { canonical_logical_id: 1, _id: 1 }),
];

export const REP_SMS_STATUS_HISTORY_LIMIT = 20;

const statusEntrySchema = new Schema(
  {
    status: enumeration(REP_SMS_STATUSES),
    provider_status: text,
    provider_modified_at: date,
    observed_at: at,
  },
  { _id: false, strict: "throw" },
);

const reviewedRepSchema = new Schema({ agent_id: oid, link_id: oid }, { _id: false, strict: "throw" });

export const RingCentralRepSmsEvidenceSchema = new Schema(
  {
    provider_account_id: str,
    owning_extension_id: str,
    message_id: str,
    /** One logical message for cross-mailbox dedupe: `<account>:<message id>`. */
    canonical_logical_id: str,
    conversation_id: text,
    direction: enumeration(REP_SMS_DIRECTIONS),
    provider_status: text,
    status: enumeration(REP_SMS_STATUSES),
    credit_effect: enumeration(REP_SMS_CREDIT_EFFECTS),
    status_history: {
      type: [statusEntrySchema],
      default: [],
      validate: (v: unknown[]) => v.length <= REP_SMS_STATUS_HISTORY_LIMIT,
    },
    provider_created_at: at,
    provider_modified_at: date,
    /** P07g: confirmed sent time of an outbound message = provider `creationTime` (§5); null inbound. */
    send_at: date,
    sms_delivery_time: date,
    availability: text,
    from_number: text,
    /** Customer side: outbound `to[]`, inbound `from`. E.164 where it normalizes, else the raw value. */
    counterpart_numbers: strings,
    is_group: { type: Boolean, required: true, default: false },
    reviewed_rep_ref: { type: reviewedRepSchema, default: null },
    identity_state: enumeration(REP_SMS_IDENTITY_STATES),
    identity_reason: text,
    association_quality: enumeration(REP_SMS_ASSOCIATION_QUALITIES, "unresolved"),
    opportunity_ref: ref,
    source_revision: revision,
    captured_at: at,
    last_sync_kind: enumeration(REP_SMS_SYNC_KINDS),
  },
  { collection: "ringcentral_rep_sms_evidence" },
);

export const getRingCentralRepSmsEvidenceModel = defineCsiModel(
  "RingCentralRepSmsEvidence",
  RingCentralRepSmsEvidenceSchema,
  RINGCENTRAL_REP_SMS_EVIDENCE_INDEXES,
);
