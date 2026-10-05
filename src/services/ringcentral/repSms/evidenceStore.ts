import { Types } from "mongoose";
import type { RepSmsStatus } from "../../../config/domain/ringcentralRepSms";
import {
  getRingCentralRepSmsEvidenceModel,
  REP_SMS_STATUS_HISTORY_LIMIT,
} from "../../../models/salesOutreach/repSmsEvidence";
import { canonicalJson } from "../../durableWork/checksum";
import type { MappedRepSms } from "./mapper";

/**
 * Idempotent upsert of one mapped message into `ringcentral_rep_sms_evidence`.
 *
 * - The key is (account, owning mailbox, message id); one row per mailbox copy of a message.
 * - A provider version older than the stored one (`lastModifiedTime`) is `stale` and ignored, so a
 *   replayed sync page never rolls a Delivered back to Sent.
 * - Only material changes (status, identity, counterparts, delivery time, availability…) write and
 *   bump `source_revision`; the caller wakes the desk for `(row, source_revision)`.
 * - Every status change is appended to the bounded `status_history` (P07d keeps the Sent entry when a
 *   later SendingFailed/DeliveryFailed revokes the credit).
 */
export type StatusEntry = { status: RepSmsStatus; provider_status: string | null; provider_modified_at: Date | null; observed_at: Date };

export type StoredRepSms = MappedRepSms & {
  _id: string;
  source_revision: number;
  status_history: StatusEntry[];
};

export type EvidenceKey = { provider_account_id: string; owning_extension_id: string; message_id: string };

export type RepSmsEvidenceStore = {
  find(key: EvidenceKey): Promise<StoredRepSms | null>;
  /** Throws a duplicate-key error (code 11000) when another writer inserted the row first. */
  insert(doc: Record<string, unknown>): Promise<string>;
  /** CAS on `source_revision`; false when another writer changed the row first. */
  update(id: string, expectedRevision: number, set: Record<string, unknown>): Promise<boolean>;
};

export type UpsertOutcome = { outcome: "inserted" | "updated" | "unchanged" | "stale"; id: string; source_revision: number };

/** Fields whose change is material to the desk (a change bumps `source_revision`). */
function material(row: MappedRepSms) {
  return canonicalJson({
    conversation_id: row.conversation_id,
    direction: row.direction,
    provider_status: row.provider_status,
    status: row.status,
    credit_effect: row.credit_effect,
    provider_created_at: row.provider_created_at.toISOString(),
    send_at: row.send_at?.toISOString() ?? null,
    sms_delivery_time: row.sms_delivery_time?.toISOString() ?? null,
    availability: row.availability,
    from_number: row.from_number,
    counterpart_numbers: [...row.counterpart_numbers].sort(),
    is_group: row.is_group,
    reviewed_rep_ref: row.reviewed_rep_ref ? { agent_id: String(row.reviewed_rep_ref.agent_id), link_id: String(row.reviewed_rep_ref.link_id) } : null,
    identity_state: row.identity_state,
    identity_reason: row.identity_reason,
  });
}

function entry(row: MappedRepSms, now: Date): StatusEntry {
  return { status: row.status, provider_status: row.provider_status, provider_modified_at: row.provider_modified_at, observed_at: now };
}

export async function upsertRepSmsEvidence(
  mapped: MappedRepSms,
  context: { now: Date; syncKind: "FSync" | "ISync" },
  store: RepSmsEvidenceStore = mongoRepSmsEvidenceStore(),
): Promise<UpsertOutcome> {
  const key: EvidenceKey = {
    provider_account_id: mapped.provider_account_id,
    owning_extension_id: mapped.owning_extension_id,
    message_id: mapped.message_id,
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await store.find(key);
    if (!existing) {
      try {
        const id = await store.insert({
          ...mapped,
          status_history: [entry(mapped, context.now)],
          association_quality: "unresolved",
          opportunity_ref: null,
          source_revision: 1,
          captured_at: context.now,
          last_sync_kind: context.syncKind,
        });
        return { outcome: "inserted", id, source_revision: 1 };
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 11000) continue;
        throw error;
      }
    }
    if (
      mapped.provider_modified_at &&
      existing.provider_modified_at &&
      mapped.provider_modified_at.getTime() < existing.provider_modified_at.getTime()
    ) {
      return { outcome: "stale", id: existing._id, source_revision: existing.source_revision };
    }
    if (material(existing) === material(mapped)) {
      return { outcome: "unchanged", id: existing._id, source_revision: existing.source_revision };
    }
    const history = existing.status === mapped.status ? existing.status_history : [...existing.status_history, entry(mapped, context.now)];
    const next = existing.source_revision + 1;
    const ok = await store.update(existing._id, existing.source_revision, {
      ...mapped,
      status_history: history.slice(-REP_SMS_STATUS_HISTORY_LIMIT),
      source_revision: next,
      last_sync_kind: context.syncKind,
    });
    if (ok) return { outcome: "updated", id: existing._id, source_revision: next };
  }
  throw new Error("rep_sms_evidence_contended");
}

export function mongoRepSmsEvidenceStore(): RepSmsEvidenceStore {
  const Model = getRingCentralRepSmsEvidenceModel;
  const oid = (value: string) => new Types.ObjectId(value);
  const refOut = (ref: { agent_id?: unknown; link_id?: unknown } | null | undefined) =>
    ref ? { agent_id: String(ref.agent_id), link_id: String(ref.link_id) } : null;
  const refIn = (ref: unknown) => {
    const r = ref as { agent_id: string; link_id: string } | null;
    return r ? { agent_id: oid(r.agent_id), link_id: oid(r.link_id) } : null;
  };
  return {
    async find(key) {
      const row = (await Model().findOne(key).lean()) as Record<string, unknown> | null;
      if (!row) return null;
      return { ...(row as unknown as StoredRepSms), _id: String(row._id), reviewed_rep_ref: refOut(row.reviewed_rep_ref as never) };
    },
    async insert(doc) {
      const [created] = await Model().create([{ ...doc, reviewed_rep_ref: refIn(doc.reviewed_rep_ref) }]);
      return String(created!._id);
    },
    async update(id, expectedRevision, set) {
      const result = await Model().updateOne(
        { _id: oid(id), source_revision: expectedRevision },
        { $set: { ...set, reviewed_rep_ref: refIn(set.reviewed_rep_ref) } },
      );
      return result.modifiedCount === 1;
    },
  };
}
