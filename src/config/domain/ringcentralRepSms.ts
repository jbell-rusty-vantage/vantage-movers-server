/**
 * Rep SMS capture vocabularies (RINGCENTRAL-CAPTURE §5, CONTRACTS `ringcentral_rep_sms_evidence`).
 * Value sets only; nothing here activates behaviour.
 */

/** Normalized message status. Provider values: Queued, Sent, Delivered, DeliveryFailed, SendingFailed, Received. */
export const REP_SMS_STATUSES = ["queued", "sent", "delivered", "send_failed", "delivery_failed", "received", "unknown"] as const;
export type RepSmsStatus = (typeof REP_SMS_STATUSES)[number];

/**
 * What a status does to SMS credit (§5, P07d): `credit` (Sent/Delivered), `none` (Queued, unknown),
 * `revoke` (SendingFailed/DeliveryFailed — an earlier credit is withdrawn and recomputed),
 * `history` (inbound Received: history and Last interaction only, never credit).
 */
export const REP_SMS_CREDIT_EFFECTS = ["credit", "none", "revoke", "history"] as const;
export type RepSmsCreditEffect = (typeof REP_SMS_CREDIT_EFFECTS)[number];

export const REP_SMS_DIRECTIONS = ["inbound", "outbound"] as const;
export type RepSmsDirection = (typeof REP_SMS_DIRECTIONS)[number];

/**
 * P07e sender/origin: `reviewed` = the owning mailbox is a reviewed `sales_rep` at message time and
 * (when the link knows the rep's numbers) the message went from one of them; anything else waits
 * as `pending_identity` and never earns credit until reviewed.
 */
export const REP_SMS_IDENTITY_STATES = ["reviewed", "pending_identity"] as const;
export type RepSmsIdentityState = (typeof REP_SMS_IDENTITY_STATES)[number];

/** Association is resolved by the desk (SRV-6, IMPL-07); capture leaves it `unresolved`. */
export const REP_SMS_ASSOCIATION_QUALITIES = ["unresolved", "unique", "ambiguous", "none"] as const;

export const REP_SMS_SYNC_KINDS = ["FSync", "ISync"] as const;

/** Sync-state scope of one mailbox (`sales_intelligence_sync_state`). */
export function repSmsSyncScope(extensionId: string): string {
  return `rep_sms:${extensionId}`;
}
