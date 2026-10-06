import type {
  RepSmsCreditEffect,
  RepSmsDirection,
  RepSmsIdentityState,
  RepSmsStatus,
} from "../../../config/domain/ringcentralRepSms";
import { toE164 } from "../../numberActivity/phone";
import type { SmsProviderStatus } from "../../salesOutreach/engine/credit";

/**
 * Pure mapping of one RingCentral message-store / message-sync record to rep SMS evidence
 * (RINGCENTRAL-CAPTURE §5, P07d/P07e). Metadata only: `subject` (the text), attachments and names are
 * read past and never returned.
 */
export type ProviderMessage = {
  id?: unknown;
  type?: unknown;
  direction?: unknown;
  messageStatus?: unknown;
  availability?: unknown;
  creationTime?: unknown;
  lastModifiedTime?: unknown;
  smsDeliveryTime?: unknown;
  conversationId?: unknown;
  conversation?: { id?: unknown } | null;
  from?: { phoneNumber?: unknown; extensionNumber?: unknown } | null;
  to?: Array<{ phoneNumber?: unknown; extensionNumber?: unknown }> | null;
};

/** Reviewed `sales_rep` identity of the owning mailbox at an instant (built from `rep_identity_links`). */
export type MailboxIdentityAt = (at: Date) => { agent_id: string; link_id: string } | null;

export type MailboxContext = {
  provider_account_id: string;
  extension_id: string;
  /** Numbers the reviewed link recorded for the rep (empty = unknown, not checked). */
  sender_numbers: readonly string[];
  identityAt: MailboxIdentityAt;
};

export type MappedRepSms = {
  provider_account_id: string;
  owning_extension_id: string;
  message_id: string;
  canonical_logical_id: string;
  conversation_id: string | null;
  direction: RepSmsDirection;
  provider_status: string | null;
  status: RepSmsStatus;
  credit_effect: RepSmsCreditEffect;
  provider_created_at: Date;
  provider_modified_at: Date | null;
  send_at: Date | null;
  sms_delivery_time: Date | null;
  availability: string | null;
  from_number: string | null;
  counterpart_numbers: string[];
  is_group: boolean;
  reviewed_rep_ref: { agent_id: string; link_id: string } | null;
  identity_state: RepSmsIdentityState;
  identity_reason: string | null;
};

const OUTBOUND_STATUS: Record<string, RepSmsStatus> = {
  Queued: "queued",
  Sent: "sent",
  Delivered: "delivered",
  SendingFailed: "send_failed",
  DeliveryFailed: "delivery_failed",
};

/** §5 status mapping. Inbound is history only, whatever status the provider reports. */
export function mapSmsStatus(direction: RepSmsDirection, providerStatus: string | null): { status: RepSmsStatus; credit_effect: RepSmsCreditEffect } {
  if (direction === "inbound") return { status: "received", credit_effect: "history" };
  const status = (providerStatus && OUTBOUND_STATUS[providerStatus]) || "unknown";
  if (status === "sent" || status === "delivered") return { status, credit_effect: "credit" };
  if (status === "send_failed" || status === "delivery_failed") return { status, credit_effect: "revoke" };
  return { status, credit_effect: "none" };
}

/** The engine's provider status (`classifySmsEvidence`) for a captured status; inbound has none. */
export function engineSmsStatus(status: RepSmsStatus): SmsProviderStatus | null {
  switch (status) {
    case "queued":
    case "sent":
    case "delivered":
    case "send_failed":
    case "delivery_failed":
      return status;
    case "unknown":
      return "pending";
    case "received":
      return null;
  }
}

export type MessageIdentity = {
  identity_state: RepSmsIdentityState;
  identity_reason: string | null;
  reviewed_rep_ref: { agent_id: string; link_id: string } | null;
};

/**
 * P07e rep identity of one mailbox message, shared by the mapper and the olr C7 re-map (`remap.ts`):
 * - the owner is the mailbox's reviewed `sales_rep` link at the message's creation instant
 *   (prospective identity: a link reviewed later never claims an earlier message);
 * - no owner ⇒ `pending_identity` / `owner_not_reviewed_sales_rep`;
 * - an outbound message whose sender is not one of the numbers the current reviewed link recorded ⇒
 *   `pending_identity` / `shared_sender` (no recorded numbers = unknown, not checked).
 * `from_number` is the normalized sender, as `mapProviderMessage` stores it.
 */
export function identityForMessage(
  message: { direction: RepSmsDirection; from_number: string | null; created: Date },
  mailbox: Pick<MailboxContext, "sender_numbers" | "identityAt">,
): MessageIdentity {
  const owner = mailbox.identityAt(message.created);
  if (!owner) return { identity_state: "pending_identity", identity_reason: "owner_not_reviewed_sales_rep", reviewed_rep_ref: null };
  if (message.direction === "outbound" && mailbox.sender_numbers.length) {
    const own = new Set(mailbox.sender_numbers.map((n) => number(n)).filter((n): n is string => n !== null));
    if (!message.from_number || !own.has(message.from_number))
      return { identity_state: "pending_identity", identity_reason: "shared_sender", reviewed_rep_ref: owner };
  }
  return { identity_state: "reviewed", identity_reason: null, reviewed_rep_ref: owner };
}

export type MapResult = { ok: true; evidence: MappedRepSms } | { ok: false; reason: "not_sms" | "id_missing" | "direction_missing" | "created_missing" };

export function mapProviderMessage(raw: ProviderMessage, mailbox: MailboxContext): MapResult {
  if (raw.type !== undefined && raw.type !== null && raw.type !== "SMS") return { ok: false, reason: "not_sms" };
  const id = scalar(raw.id);
  if (!id) return { ok: false, reason: "id_missing" };
  const direction: RepSmsDirection | null = raw.direction === "Outbound" ? "outbound" : raw.direction === "Inbound" ? "inbound" : null;
  if (!direction) return { ok: false, reason: "direction_missing" };
  const created = instant(raw.creationTime);
  if (!created) return { ok: false, reason: "created_missing" };
  const providerStatus = scalar(raw.messageStatus);
  const { status, credit_effect } = mapSmsStatus(direction, providerStatus);
  const from = number(raw.from?.phoneNumber);
  const to = (Array.isArray(raw.to) ? raw.to : []).map((p) => number(p?.phoneNumber)).filter((n): n is string => n !== null);
  const counterparts = direction === "outbound" ? [...new Set(to)] : from ? [from] : [];

  const { identity_state, identity_reason, reviewed_rep_ref: owner } = identityForMessage({ direction, from_number: from, created }, mailbox);

  return {
    ok: true,
    evidence: {
      provider_account_id: mailbox.provider_account_id,
      owning_extension_id: mailbox.extension_id,
      message_id: id,
      canonical_logical_id: `${mailbox.provider_account_id}:${id}`,
      conversation_id: scalar(raw.conversationId) ?? scalar(raw.conversation?.id),
      direction,
      provider_status: providerStatus,
      status,
      credit_effect,
      provider_created_at: created,
      provider_modified_at: instant(raw.lastModifiedTime),
      send_at: direction === "outbound" ? created : null,
      sms_delivery_time: instant(raw.smsDeliveryTime),
      availability: scalar(raw.availability),
      from_number: from,
      counterpart_numbers: counterparts,
      is_group: counterparts.length > 1,
      reviewed_rep_ref: owner,
      identity_state,
      identity_reason,
    },
  };
}

function scalar(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function instant(value: unknown): Date | null {
  const s = scalar(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function number(value: unknown): string | null {
  const raw = scalar(value);
  if (!raw) return null;
  return toE164(raw) ?? raw;
}
