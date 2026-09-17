import assert from "node:assert/strict";
import { test } from "node:test";
import { isLikelyTerminalRingCentralStatus } from "../ringcentral/call-candidate-evaluator";
import { EMPTY_DIRECTORY_LOOKUP } from "./directory";
import {
  aliasesFor,
  fromCallLogRecord,
  fromWebhookParties,
  identityFromCallLogRecord,
  mergeProjections,
  sameProjection,
  TERMINAL_PARTY_STATUSES,
} from "./interactionProjection";
import { normalizeWebhookPartyObservations } from "./observeWebhookEvents";
import {
  at,
  inboundConnectedCallLog,
  inboundQueueAnsweredDeliveries,
  internalCallDelivery,
  internalCallLog,
  malformedNumberCallLog,
  outboundMissedCallLog,
  outboundUnansweredDeliveries,
  sessionIdOnlyCallLog,
  SYNTHETIC_ACCOUNT_ID,
  SYNTHETIC_CUSTOMER,
  SYNTHETIC_CUSTOMER_B,
  SYNTHETIC_SALES_DID,
  SYNTHETIC_USER_EXTENSION,
  SYNTHETIC_USER_EXTENSION_B,
  syntheticDirectory,
  transferredCallLog,
  voicemailCallLog,
  webhookDelivery,
  withheldInboundDelivery,
  withheldMissedCallLog,
} from "./fixtures";
import type { InteractionProjection } from "./types";

const directory = syntheticDirectory();
const now = at(600);
const observe = (payload: unknown, receivedAt = now) => normalizeWebhookPartyObservations(payload, receivedAt);
const webhook = (existing: InteractionProjection | null, payload: unknown, receivedAt = now) =>
  fromWebhookParties(existing, observe(payload, receivedAt), directory, SYNTHETIC_ACCOUNT_ID, { now: receivedAt });
const callLog = (existing: InteractionProjection | null, record: Record<string, unknown>, when = now) =>
  fromCallLogRecord(existing, record, directory, SYNTHETIC_ACCOUNT_ID, { now: when });

test("terminal party statuses stay in parity with the qualification evaluator", () => {
  for (const status of TERMINAL_PARTY_STATUSES) assert.equal(isLikelyTerminalRingCentralStatus(status), true);
  for (const status of ["Setup", "Proceeding", "Answered", "Hold", "Ringing"]) {
    assert.equal(isLikelyTerminalRingCentralStatus(status), false);
    assert.equal((TERMINAL_PARTY_STATUSES as readonly string[]).includes(status), false);
  }
});

test("inbound queue call projects all directions of evidence: parties, connection, terminal, external number", () => {
  const d = inboundQueueAnsweredDeliveries();
  let outcome = webhook(null, d.ringing);
  assert.equal(outcome.created, true);
  assert.equal(outcome.next.direction, "Inbound");
  assert.equal(outcome.next.external_e164, SYNTHETIC_CUSTOMER);
  assert.equal(outcome.next.external_endpoint_kind, "external");
  assert.equal(outcome.next.company_e164, SYNTHETIC_SALES_DID);
  assert.equal(outcome.next.terminal, false);
  assert.equal(outcome.next.provider_connected, false);
  assert.equal(outcome.next.queue_fanout, true);
  assert.equal(outcome.next.identity_basis, "telephony_session_id");
  assert.equal(outcome.next.started_at.toISOString(), at(0).toISOString());

  outcome = webhook(outcome.next, d.repRinging);
  assert.equal(outcome.changed, true);
  assert.equal(outcome.next.parties.filter((p) => p.role !== "external").length, 2);

  outcome = webhook(outcome.next, d.answered);
  assert.equal(outcome.next.provider_connected, true);
  assert.equal(outcome.next.answered_at?.toISOString(), at(8).toISOString());
  assert.deepEqual(outcome.next.connected_user_extension_ids, [SYNTHETIC_USER_EXTENSION.id]);
  assert.equal(outcome.next.terminal, false, "queue party disconnected but rep still connected");
  assert.equal(outcome.next.contact_type, "unknown", "provider-connected is not human conversation");

  outcome = webhook(outcome.next, d.disconnected);
  assert.equal(outcome.newly_terminal, true);
  assert.equal(outcome.next.terminal, true);
  assert.equal(outcome.next.ended_at?.toISOString(), at(95).toISOString());
  assert.equal(outcome.next.provider_result, "Call connected");
  assert.equal(outcome.next.contact_type, "unknown");
  const rep = outcome.next.parties.find((p) => p.extension_id === SYNTHETIC_USER_EXTENSION.id)!;
  assert.equal(rep.role, "user");
  assert.equal(rep.last_webhook_sequence, 4);
  const external = outcome.next.parties.find((p) => p.role === "external")!;
  assert.equal(external.e164, SYNTHETIC_CUSTOMER);
  assert.equal(external.name_raw, "Synthetic Customer");
});

test("duplicate webhook delivery is a semantic no-op: no revision, fenced per party", () => {
  const d = inboundQueueAnsweredDeliveries();
  let projected = webhook(null, d.ringing).next;
  projected = webhook(projected, d.repRinging).next;
  const replay = webhook(projected, d.repRinging, at(900));
  assert.equal(replay.changed, false);
  assert.equal(replay.fenced_party_events, 2);
  assert.equal(sameProjection(replay.next, projected), true);
});

test("one party's sequence never suppresses another party in the same delivery", () => {
  const sessionId = "s-fence-1";
  const customer = { phoneNumber: SYNTHETIC_CUSTOMER };
  const did = { phoneNumber: SYNTHETIC_SALES_DID };
  const first = webhookDelivery({
    uuid: "f1",
    telephonySessionId: sessionId,
    sequence: 5,
    eventTime: at(10),
    parties: [{ id: "p-a", extensionId: SYNTHETIC_USER_EXTENSION.id, direction: "Inbound", status: "Answered", from: customer, to: did }],
  });
  const late = webhookDelivery({
    uuid: "f2",
    telephonySessionId: sessionId,
    sequence: 4,
    eventTime: at(6),
    parties: [
      { id: "p-a", extensionId: SYNTHETIC_USER_EXTENSION.id, direction: "Inbound", status: "Proceeding", from: customer, to: did },
      { id: "p-b", extensionId: SYNTHETIC_USER_EXTENSION_B.id, direction: "Inbound", status: "Proceeding", from: customer, to: did },
    ],
  });
  const projected = webhook(null, first).next;
  const outcome = webhook(projected, late);
  assert.equal(outcome.fenced_party_events, 1, "party A at sequence 5 ignores sequence 4");
  assert.equal(outcome.changed, true, "party B is new and must be applied");
  const a = outcome.next.parties.find((p) => p.party_id === "p-a")!;
  const b = outcome.next.parties.find((p) => p.party_id === "p-b")!;
  assert.equal(a.connected, true);
  assert.equal(a.last_webhook_sequence, 5);
  assert.equal(b.last_webhook_sequence, 4);
  assert.equal(outcome.next.max_observed_webhook_sequence, 5);
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

test("identical Call Log replay and older lastModifiedTime never create a new revision or regress facts", () => {
  const record = inboundConnectedCallLog();
  const first = callLog(null, record);
  const replay = callLog(first.next, record, at(2000));
  assert.equal(replay.changed, false);
  assert.deepEqual(replay.new_recording_ids, []);
  assert.deepEqual(replay.new_aliases, []);

  const older = inboundConnectedCallLog("s-inbound-1", {
    result: "Missed",
    duration: 3,
    lastModifiedTime: at(-100),
    legs: [{ id: "leg-late", startTime: at(0).toISOString(), duration: 3, direction: "Inbound", result: "Missed", legType: "PstnToSip", extension: { id: SYNTHETIC_USER_EXTENSION_B.id } }],
  });
  const stale = callLog(first.next, older, at(2100));
  assert.equal(stale.stale_call_log, true);
  assert.equal(stale.next.provider_result, "Call connected");
  assert.equal(stale.next.duration_seconds, 95);
  assert.equal(stale.next.provider_connected, true);
  assert.equal(stale.next.legs.some((l) => l.call_log_id === "leg-late"), true, "additive evidence still lands");
  assert.equal(stale.next.call_log_ids.includes("leg-late"), true);
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

test("delayed recording evidence after terminal is surfaced as new recording ids", () => {
  const first = callLog(null, inboundConnectedCallLog("s-late-rec", { recording: null, legs: [] }));
  assert.equal(first.next.terminal, true);
  assert.deepEqual(first.next.recordings, []);
  const later = callLog(
    first.next,
    inboundConnectedCallLog("s-late-rec", { recording: { id: "rec-late" }, legs: [], lastModifiedTime: at(3000) }),
    at(3100),
  );
  assert.equal(later.changed, true);
  assert.equal(later.newly_terminal, false);
  assert.deepEqual(later.new_recording_ids, ["rec-late"]);
  assert.equal(later.next.recordings[0]!.observed_at.toISOString(), at(3100).toISOString());
  const again = callLog(later.next, inboundConnectedCallLog("s-late-rec", { recording: { id: "rec-late" }, legs: [], lastModifiedTime: at(3000) }), at(4000));
  assert.equal(again.changed, false, "observed_at of a known recording is preserved");
});

test("voicemail is provider evidence; connected is not human; outbound unanswered stays unknown", () => {
  const vm = callLog(null, voicemailCallLog());
  assert.equal(vm.next.contact_type, "voicemail");
  assert.equal(vm.next.contact_type_basis, "provider:voicemail");
  assert.equal(vm.next.provider_connected, false);
  const connected = callLog(null, inboundConnectedCallLog());
  assert.equal(connected.next.contact_type, "unknown");
  assert.equal(connected.next.contact_type_basis, null);
  const missed = callLog(null, outboundMissedCallLog());
  assert.equal(missed.next.direction, "Outbound");
  assert.equal(missed.next.provider_connected, false);
  assert.equal(missed.next.external_e164, SYNTHETIC_CUSTOMER_B);
  assert.equal(missed.next.company_e164, "+15550100100");
  // Owner/transcript-set human conversation is never overwritten by provider rules.
  const human = { ...connected.next, contact_type: "human_conversation" as const, contact_type_basis: "owner" };
  const replay = callLog(human, inboundConnectedCallLog());
  assert.equal(replay.next.contact_type, "human_conversation");
  assert.equal(replay.next.contact_type_basis, "owner");
});

test("internal, withheld and malformed observations keep provider evidence without a customer identity", () => {
  const internal = webhook(null, internalCallDelivery());
  assert.equal(internal.next.direction, "Internal");
  assert.equal(internal.next.external_e164, null);
  assert.equal(internal.next.external_endpoint_kind, "extension");
  const internalLog = callLog(internal.next, internalCallLog());
  assert.equal(internalLog.next.direction, "Internal");
  assert.equal(internalLog.next.external_e164, null);

  const withheld = webhook(null, withheldInboundDelivery());
  assert.equal(withheld.next.direction, "Inbound");
  assert.equal(withheld.next.external_e164, null);
  assert.equal(withheld.next.external_endpoint_kind, "withheld");
  assert.equal(withheld.next.terminal, true);
  assert.equal(withheld.next.provider_result, "Missed");
  assert.equal(withheld.next.parties.find((p) => p.role === "external")?.name_raw, "Anonymous");
  const withheldLog = callLog(withheld.next, withheldMissedCallLog());
  assert.equal(withheldLog.next.external_endpoint_kind, "withheld");
  assert.equal(withheldLog.next.external_e164, null);

  const malformed = callLog(null, malformedNumberCallLog());
  assert.equal(malformed.next.external_endpoint_kind, "malformed");
  assert.equal(malformed.next.external_e164, null);
  assert.equal(malformed.next.parties.find((p) => p.role === "external")?.phone_number_raw, "+1");
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

test("review fix: a party event missing `direction` does not turn an outbound customer call into a sticky Internal", () => {
  const d = outboundUnansweredDeliveries("s-nodir-1");
  const stripped = structuredClone(d.setup) as { body: { parties: Array<Record<string, unknown>> } };
  for (const party of stripped.body.parties) delete party.direction;
  const first = webhook(null, stripped);
  assert.notEqual(first.next.direction, "Internal");
  assert.equal(first.next.direction, "Unknown", "no direction evidence yet");
  assert.equal(first.next.external_e164, SYNTHETIC_CUSTOMER_B, "customer side is still external");
  assert.equal(first.next.external_endpoint_kind, "external");

  const corrected = webhook(first.next, d.proceeding, at(2));
  assert.equal(corrected.next.direction, "Outbound", "later evidence corrects Unknown");
  const reconciled = callLog(corrected.next, outboundMissedCallLog("s-nodir-1"));
  assert.equal(reconciled.next.direction, "Outbound");

  // A true internal call (both sides are extensions) still projects Internal.
  assert.equal(webhook(null, internalCallDelivery()).next.direction, "Internal");
});

test("review fix: a stale Call Log record never regresses leg-level result or duration", () => {
  const first = callLog(
    null,
    inboundConnectedCallLog("s-staleleg-1", {
      legs: [
        { id: "leg-same", startTime: at(0).toISOString(), duration: 95, direction: "Inbound", result: "Accepted", legType: "PstnToSip", extension: { id: SYNTHETIC_USER_EXTENSION.id } },
      ],
    }),
  );
  const leg = (o: InteractionProjection) => o.legs.find((l) => l.call_log_id === "leg-same")!;
  assert.deepEqual([leg(first.next).result, leg(first.next).duration_seconds], ["Accepted", 95]);

  const older = inboundConnectedCallLog("s-staleleg-1", {
    result: "Missed",
    duration: 3,
    lastModifiedTime: at(-100),
    legs: [
      { id: "leg-same", startTime: at(0).toISOString(), duration: 3, direction: "Inbound", result: "Missed", legType: "PstnToSip", extension: { id: SYNTHETIC_USER_EXTENSION.id } },
      { id: "leg-new", startTime: at(1).toISOString(), duration: 2, direction: "Inbound", result: "Missed", legType: "PstnToSip", extension: { id: SYNTHETIC_USER_EXTENSION_B.id } },
    ],
  });
  const stale = callLog(first.next, older, at(2100));
  assert.equal(stale.stale_call_log, true);
  assert.deepEqual([leg(stale.next).result, leg(stale.next).duration_seconds], ["Accepted", 95], "existing leg kept");
  assert.equal(stale.next.legs.some((l) => l.call_log_id === "leg-new"), true, "new leg still added");
  assert.equal(stale.next.provider_result, "Call connected");
});

test("review fix: legs_overflow_count is monotone across records and not double counted on merge", () => {
  const manyLegs = (count: number, prefix: string) =>
    Array.from({ length: count }, (_, i) => ({
      id: `${prefix}-${i}`,
      startTime: at(i).toISOString(),
      duration: 1,
      direction: "Inbound",
      result: "Accepted",
      legType: "PstnToSip",
      extension: { id: SYNTHETIC_USER_EXTENSION.id },
    }));
  const big = callLog(null, inboundConnectedCallLog("s-overflow-1", { legs: manyLegs(45, "big") }));
  assert.equal(big.next.legs.length, 40);
  assert.equal(big.next.legs_overflow_count, 5);
  const fewer = callLog(big.next, inboundConnectedCallLog("s-overflow-1", { legs: manyLegs(3, "big"), lastModifiedTime: at(5000) }), at(5100));
  assert.equal(fewer.next.legs_overflow_count >= 5, true, "dropped legs are not forgotten");

  const other = callLog(null, inboundConnectedCallLog("s-overflow-1", { legs: manyLegs(45, "big") }));
  const merged = mergeProjections(big.next, other.next);
  assert.equal(merged.legs_overflow_count, 5, "same dropped legs observed twice count once");
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

test("mergeProjections requires same account and folds evidence without dropping recordings", () => {
  const a = callLog(null, inboundConnectedCallLog("s-merge")).next;
  const b = webhook(null, inboundQueueAnsweredDeliveries("s-merge").answered).next;
  const merged = mergeProjections(b, a);
  assert.equal(merged.terminal, true);
  assert.equal(merged.provider_result, "Call connected");
  assert.equal(merged.recordings.length, 1);
  assert.equal(merged.parties.filter((p) => p.role !== "external").length >= 2, true);
  assert.throws(() => mergeProjections(a, { ...b, provider_account_id: "999" }), /different provider accounts/);
});

test("no directory snapshot keeps roles unknown instead of guessing", () => {
  const outcome = fromWebhookParties(
    null,
    observe(inboundQueueAnsweredDeliveries().answered),
    EMPTY_DIRECTORY_LOOKUP,
    SYNTHETIC_ACCOUNT_ID,
    { now },
  );
  const roles = outcome.next.parties.filter((p) => p.role !== "external").map((p) => p.role);
  assert.deepEqual([...new Set(roles)], ["unknown"]);
  assert.equal(outcome.next.queue_fanout, true, "provider queueCall flag still describes fan-out");
});
