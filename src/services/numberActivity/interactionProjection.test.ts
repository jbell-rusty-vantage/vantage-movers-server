import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aliasesFor,
  fromCallLogRecord,
  fromWebhookParties,
  identityFromCallLogRecord,
  sameProjection,
} from "./interactionProjection";
import { normalizeWebhookPartyObservations } from "./observeWebhookEvents";
import {
  at,
  inboundConnectedCallLog,
  inboundQueueAnsweredDeliveries,
  internalCallLog,
  outboundUnansweredDeliveries,
  sessionIdOnlyCallLog,
  SYNTHETIC_ACCOUNT_ID,
  SYNTHETIC_CUSTOMER,
  SYNTHETIC_CUSTOMER_B,
  SYNTHETIC_USER_EXTENSION,
  SYNTHETIC_USER_EXTENSION_B,
  syntheticDirectory,
  transferredCallLog,
} from "./fixtures";
import type { InteractionProjection } from "./types";

const directory = syntheticDirectory();
const now = at(600);
const observe = (payload: unknown, receivedAt = now) => normalizeWebhookPartyObservations(payload, receivedAt);
const webhook = (existing: InteractionProjection | null, payload: unknown, receivedAt = now) =>
  fromWebhookParties(existing, observe(payload, receivedAt), directory, SYNTHETIC_ACCOUNT_ID, { now: receivedAt });
const callLog = (existing: InteractionProjection | null, record: Record<string, unknown>, when = now) =>
  fromCallLogRecord(existing, record, directory, SYNTHETIC_ACCOUNT_ID, { now: when });

test("duplicate webhook delivery is a semantic no-op: no revision, fenced per party", () => {
  const d = inboundQueueAnsweredDeliveries();
  let projected = webhook(null, d.ringing).next;
  projected = webhook(projected, d.repRinging).next;
  const replay = webhook(projected, d.repRinging, at(900));
  assert.equal(replay.changed, false);
  assert.equal(replay.fenced_party_events, 2);
  assert.equal(sameProjection(replay.next, projected), true);
});

test("out-of-order and late events never regress terminal or connected facts", () => {
  const d = outboundUnansweredDeliveries();
  let projected = webhook(null, d.disconnected).next;
  assert.equal(projected.terminal, true);
  assert.equal(projected.direction, "Outbound");
  assert.equal(projected.external_e164, SYNTHETIC_CUSTOMER_B);
  const stale = webhook(projected, d.proceeding, at(31));
  assert.equal(stale.changed, false);
  assert.equal(stale.next.terminal, true);
  // A null-sequence late event applies monotone rules only.
  const noSeq = observe(d.setup).map((e) => ({ ...e, sequence: null }));
  const applied = fromWebhookParties(projected, noSeq, directory, SYNTHETIC_ACCOUNT_ID, { now });
  assert.equal(applied.next.terminal, true);
  assert.equal(applied.next.parties.find((p) => p.party_id === `p-s-outbound-1-rep`)!.terminal_status, "Disconnected");
  projected = applied.next;
  assert.equal(projected.provider_result, "Disconnected", "unanswered outbound keeps the provider terminal status, never Spoke");
  assert.equal(projected.contact_type, "unknown");
});

test("Call Log is authoritative: result/duration survive a late webhook terminal event", () => {
  const d = inboundQueueAnsweredDeliveries();
  let projected = webhook(null, d.ringing).next;
  projected = webhook(projected, d.answered).next;
  const reconciled = callLog(projected, inboundConnectedCallLog());
  assert.equal(reconciled.changed, true);
  assert.equal(reconciled.next.terminal, true);
  assert.equal(reconciled.newly_terminal, true);
  assert.equal(reconciled.next.duration_seconds, 95);
  assert.equal(reconciled.next.provider_result, "Call connected");
  assert.deepEqual(reconciled.next.recordings.map((r) => r.provider_recording_id), ["rec-s-inbound-1-1"]);
  assert.deepEqual(reconciled.new_recording_ids, ["rec-s-inbound-1-1"]);
  assert.deepEqual(reconciled.next.sources, ["call_log_reconcile", "webhook"]);
  assert.deepEqual(reconciled.new_aliases.map((a) => a.kind), ["call_log_id"]);

  const late = webhook(reconciled.next, d.disconnected, at(1000));
  assert.equal(late.next.provider_result, "Call connected");
  assert.equal(late.next.duration_seconds, 95);
  assert.equal(late.next.ended_at?.toISOString(), reconciled.next.ended_at?.toISOString());
  assert.equal(late.next.terminal, true);
  assert.equal(late.newly_terminal, false);
});

test("transfer with multiple recordings keeps every leg and recording, counted once as one interaction", () => {
  const outcome = callLog(null, transferredCallLog());
  assert.equal(outcome.next.transfer, true);
  assert.equal(outcome.next.legs.length, 3);
  assert.deepEqual(
    outcome.next.recordings.map((r) => r.provider_recording_id),
    ["rec-s-transfer-1-1", "rec-s-transfer-1-2"],
  );
  assert.deepEqual(outcome.next.connected_user_extension_ids, [SYNTHETIC_USER_EXTENSION.id, SYNTHETIC_USER_EXTENSION_B.id]);
  assert.equal(outcome.next.legs.find((l) => l.leg_type === "Transfer")?.transfer_target_session_id, "s-transfer-1-target");
  assert.equal(outcome.next.parties.filter((p) => p.role !== "external").length, 2);
  assert.equal(outcome.next.external_e164, SYNTHETIC_CUSTOMER);
});

test("review fix: an unknown short caller id is malformed, never a fabricated extension that makes a customer call Internal", () => {
  // Garbled inbound caller id "12": no directory extension, no provider extension label.
  const garbled = callLog(
    null,
    inboundConnectedCallLog("s-garbled-1", {
      from: { phoneNumber: "12", name: "Unknown Caller" },
      recording: { id: "rec-garbled" },
      legs: [],
    }),
  );
  assert.equal(garbled.next.direction, "Inbound", "not Internal");
  assert.equal(garbled.next.external_endpoint_kind, "malformed");
  assert.equal(garbled.next.external_e164, null);
  assert.equal(garbled.next.parties.find((p) => p.role === "external")?.phone_number_raw, "12");
  assert.equal(garbled.next.parties.find((p) => p.role === "external")?.extension_number ?? null, null, "no fabricated extension number");
  assert.deepEqual(garbled.next.recordings.map((r) => r.provider_recording_id), ["rec-garbled"], "recording evidence retained for discovery");

  // A short dial the directory knows, or that the provider labels as an extension, is still an extension.
  const known = callLog(null, internalCallLog());
  assert.equal(known.next.direction, "Internal");
  assert.equal(known.next.external_endpoint_kind, "extension");
  const labelled = callLog(
    null,
    inboundConnectedCallLog("s-labelled-1", {
      from: { phoneNumber: "77", extensionNumber: "77", name: "Unknown Ext" },
      to: { extensionId: SYNTHETIC_USER_EXTENSION.id, extensionNumber: SYNTHETIC_USER_EXTENSION.number },
      legs: [],
    }),
  );
  assert.equal(labelled.next.direction, "Internal", "provider-labelled extension is provider evidence");
});

test("session-id only Call Log record resolves to fallback identity and gains the strongest basis when bridged", () => {
  const sidOnly = callLog(null, sessionIdOnlyCallLog());
  assert.equal(sidOnly.next.identity_basis, "session_id");
  assert.equal(sidOnly.next.telephony_session_id, null);
  assert.deepEqual(aliasesFor(identityFromCallLogRecord(sessionIdOnlyCallLog())).map((a) => a.kind), ["session_id", "call_log_id"]);
  const bridged = webhook(sidOnly.next, inboundQueueAnsweredDeliveries().ringing);
  assert.equal(bridged.next.identity_basis, "telephony_session_id");
  assert.equal(bridged.next.session_id, "s-inbound-1-sid");
  assert.equal(bridged.next.terminal, true, "Call Log terminal fact is not regressed by an earlier ringing event");
});

test("Call Log first, webhook later: the extension party is adopted, not duplicated", () => {
  const fromLog = callLog(null, inboundConnectedCallLog("s-order-1"));
  const extensionParties = fromLog.next.parties.filter((p) => p.role !== "external");
  assert.equal(extensionParties.length, 2, "queue leg and rep leg");
  assert.equal(extensionParties.every((p) => p.party_id === null), true);
  const d = inboundQueueAnsweredDeliveries("s-order-1");
  const withWebhook = webhook(fromLog.next, d.answered, at(1200));
  const after = withWebhook.next.parties.filter((p) => p.role !== "external");
  assert.equal(after.length, 2, "webhook parties reuse the extension-keyed rows");
  const rep = after.find((p) => p.extension_id === SYNTHETIC_USER_EXTENSION.id)!;
  assert.equal(rep.party_id, "p-s-order-1-rep");
  assert.equal(rep.last_webhook_sequence, 3);
  assert.equal(rep.connected, true);
  assert.equal(withWebhook.next.terminal, true);
  assert.equal(withWebhook.next.provider_result, "Call connected");
  assert.equal(withWebhook.next.queue_fanout, true);
});
