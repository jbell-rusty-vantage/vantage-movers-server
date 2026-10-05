/**
 * Pure half of the E01 rep SMS access proof (`ops/ringcentral/prove-rep-sms-access.ts`,
 * RINGCENTRAL-CAPTURE §6). The script performs only GET requests; this module builds them and turns
 * the answers into a verdict. Nothing here holds or prints a token, a phone number or a message body.
 */
import { repSmsEventFilters } from "../../src/services/ringcentral/webhook-subscription-lifecycle";

export type ProbeAnswer = { status: number; body: unknown } | { status: "error"; error_name: string };

export type MailboxProbe = {
  extension_id: string;
  message_store: ProbeAnswer;
  message_sync: ProbeAnswer;
  outbound_sample: ProbeAnswer;
};

export type MailboxVerdict = {
  extension_id: string;
  message_store_ok: boolean;
  message_sync_ok: boolean;
  sync_token_returned: boolean;
  outbound_sms_seen: number;
  outbound_sent_or_delivered: number;
  failures: string[];
};

export function probeEndpoints(extensionId: string, sampleSince: Date) {
  if (!/^\d+$/.test(extensionId)) throw new Error("invalid_extension_id");
  const base = `/restapi/v1.0/account/~/extension/${extensionId}`;
  return {
    message_store: `${base}/message-store?messageType=SMS&perPage=1`,
    message_sync: `${base}/message-sync?syncType=FSync&messageType=SMS&recordCount=1`,
    outbound_sample: `${base}/message-store?${new URLSearchParams({ messageType: "SMS", direction: "Outbound", dateFrom: sampleSince.toISOString(), perPage: "25" }).toString()}`,
  };
}

const ok = (answer: ProbeAnswer) => answer.status === 200;
const failure = (name: string, answer: ProbeAnswer) =>
  answer.status === "error" ? `${name}: ${answer.error_name}` : `${name}: HTTP ${answer.status}`;

export function judgeMailbox(probe: MailboxProbe): MailboxVerdict {
  const failures: string[] = [];
  if (!ok(probe.message_store)) failures.push(failure("message-store", probe.message_store));
  if (!ok(probe.message_sync)) failures.push(failure("message-sync", probe.message_sync));
  const syncInfo = ok(probe.message_sync) ? ((probe.message_sync as { body: { syncInfo?: { syncToken?: unknown } } }).body?.syncInfo ?? {}) : {};
  const tokenReturned = typeof syncInfo.syncToken === "string" && syncInfo.syncToken.length > 0;
  if (ok(probe.message_sync) && !tokenReturned) failures.push("message-sync: no syncToken");
  if (!ok(probe.outbound_sample)) failures.push(failure("outbound sample", probe.outbound_sample));
  const records = ok(probe.outbound_sample)
    ? ((probe.outbound_sample as { body: { records?: unknown } }).body?.records as Array<{ direction?: unknown; messageStatus?: unknown }> | undefined) ?? []
    : [];
  const outbound = Array.isArray(records) ? records.filter((r) => r?.direction === "Outbound") : [];
  return {
    extension_id: probe.extension_id,
    message_store_ok: ok(probe.message_store),
    message_sync_ok: ok(probe.message_sync),
    sync_token_returned: tokenReturned,
    outbound_sms_seen: outbound.length,
    outbound_sent_or_delivered: outbound.filter((r) => r.messageStatus === "Sent" || r.messageStatus === "Delivered").length,
    failures,
  };
}

export type ProofVerdict = {
  verdict: "pass" | "fail";
  /** Access (steps 1–2) proven for every reviewed mailbox. */
  access_proven: boolean;
  /** Step 3: at least one rep-sent SMS was observed Outbound with Sent/Delivered in the window. */
  sent_sms_observed: boolean;
  subscription_body_valid: boolean;
  mailboxes: MailboxVerdict[];
  notes: string[];
};

/** Step 4: dry-validate the `rep_sms` subscription body (never sent). */
export function dryValidateSubscriptionBody(extensionIds: readonly string[], address: string) {
  const eventFilters = repSmsEventFilters(extensionIds);
  const problems: string[] = [];
  if (!eventFilters.length) problems.push("no reviewed sales_rep mailbox");
  if (eventFilters.length !== new Set(extensionIds).size) problems.push("a mailbox id is not numeric");
  if (!address.startsWith("https://")) problems.push("delivery address is not https");
  return {
    valid: problems.length === 0,
    problems,
    body: { eventFilters, deliveryMode: { transportType: "WebHook", address, verificationToken: "<generated at create>" }, expiresIn: 315_360_000 },
  };
}

export function judgeProof(mailboxes: MailboxVerdict[], subscription: { valid: boolean; problems: string[] }): ProofVerdict {
  const accessProven = mailboxes.length > 0 && mailboxes.every((m) => m.message_store_ok && m.message_sync_ok && m.sync_token_returned);
  const sentObserved = mailboxes.some((m) => m.outbound_sent_or_delivered > 0);
  const notes: string[] = [];
  if (!mailboxes.length) notes.push("no reviewed sales_rep mailbox to probe");
  if (accessProven && !sentObserved)
    notes.push("access works but no rep-sent SMS was seen in the window: have a rep send one from the RingCentral app and re-run with --sent-within-minutes");
  notes.push(...subscription.problems.map((p) => `subscription body: ${p}`));
  return {
    verdict: accessProven && sentObserved && subscription.valid ? "pass" : "fail",
    access_proven: accessProven,
    sent_sms_observed: sentObserved,
    subscription_body_valid: subscription.valid,
    mailboxes,
    notes,
  };
}
