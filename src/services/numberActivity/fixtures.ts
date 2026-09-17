/**
 * Synthetic RingCentral provider fixtures for Call & Sales Intelligence capture.
 *
 * All values are fictional (555-01xx numbers, made-up ids). They mirror the
 * shapes of account telephony-session webhook deliveries and Detailed Call Log
 * records well enough for projection tests; they are not proof of live
 * provider behavior. CSI-03 (webhook fan-out), CSI-04 (Number Activity) and
 * Team C (attachment/Outreach) can import these builders directly.
 */
import { buildDirectoryLookup, type DirectoryLookup } from "./directory";

export const SYNTHETIC_ACCOUNT_ID = "800000000001";
export const SYNTHETIC_OTHER_ACCOUNT_ID = "800000000002";
export const SYNTHETIC_COMPANY_DID = "+15550100100";
export const SYNTHETIC_SALES_DID = "+15550100101";
export const SYNTHETIC_CUSTOMER = "+15550100200";
export const SYNTHETIC_CUSTOMER_B = "+15550100201";
export const SYNTHETIC_USER_EXTENSION = { id: "900000000101", number: "101", name: "Synthetic Rep One" };
export const SYNTHETIC_USER_EXTENSION_B = { id: "900000000102", number: "102", name: "Synthetic Rep Two" };
export const SYNTHETIC_USER_EXTENSION_C = { id: "900000000103", number: "103", name: "Synthetic Rep Three" };
export const SYNTHETIC_QUEUE_EXTENSION = { id: "900000000201", number: "201", name: "Sales Queue" };

export const T0 = new Date("2026-09-17T14:00:00.000Z");
export const at = (offsetSeconds: number) => new Date(T0.getTime() + offsetSeconds * 1000);

export function syntheticDirectory(): DirectoryLookup {
  return buildDirectoryLookup({
    provider_account_id: SYNTHETIC_ACCOUNT_ID,
    taken_at: at(-3600),
    extensions: [
      { id: SYNTHETIC_USER_EXTENSION.id, extension_number: SYNTHETIC_USER_EXTENSION.number, type: "User", name: SYNTHETIC_USER_EXTENSION.name },
      { id: SYNTHETIC_USER_EXTENSION_B.id, extension_number: SYNTHETIC_USER_EXTENSION_B.number, type: "User", name: SYNTHETIC_USER_EXTENSION_B.name },
      { id: SYNTHETIC_USER_EXTENSION_C.id, extension_number: SYNTHETIC_USER_EXTENSION_C.number, type: "User", name: SYNTHETIC_USER_EXTENSION_C.name },
      { id: SYNTHETIC_QUEUE_EXTENSION.id, extension_number: SYNTHETIC_QUEUE_EXTENSION.number, type: "Department", name: SYNTHETIC_QUEUE_EXTENSION.name },
    ],
    company_numbers: [
      { id: "700000000001", e164: SYNTHETIC_COMPANY_DID, usage_type: "MainCompanyNumber", extension_id: null },
      { id: "700000000002", e164: SYNTHETIC_SALES_DID, usage_type: "DirectNumber", extension_id: SYNTHETIC_QUEUE_EXTENSION.id },
    ],
    queues: [{ id: SYNTHETIC_QUEUE_EXTENSION.id }],
  });
}

// ---------------------------------------------------------------------------
// Webhook deliveries (account telephony sessions, all directions)
// ---------------------------------------------------------------------------

export type WebhookPartyInput = {
  id: string;
  extensionId?: string | null;
  direction: "Inbound" | "Outbound";
  status: string;
  from: { phoneNumber?: string | null; name?: string | null; extensionId?: string | null; extensionNumber?: string | null };
  to: { phoneNumber?: string | null; name?: string | null; extensionId?: string | null; extensionNumber?: string | null };
  queueCall?: boolean;
  missedCall?: boolean;
  recordings?: Array<{ id: string; active: boolean }>;
};

export function webhookDelivery(input: {
  uuid: string;
  telephonySessionId: string;
  sessionId?: string | null;
  sequence: number;
  eventTime: Date;
  accountId?: string;
  parties: WebhookPartyInput[];
}) {
  const accountId = input.accountId ?? SYNTHETIC_ACCOUNT_ID;
  return {
    uuid: input.uuid,
    event: `/restapi/v1.0/account/${accountId}/telephony/sessions`,
    timestamp: input.eventTime.toISOString(),
    subscriptionId: "synthetic-subscription",
    ownerId: SYNTHETIC_USER_EXTENSION.id,
    body: {
      sequence: input.sequence,
      sessionId: input.sessionId === undefined ? `${input.telephonySessionId}-sid` : input.sessionId,
      telephonySessionId: input.telephonySessionId,
      serverId: "synthetic",
      eventTime: input.eventTime.toISOString(),
      parties: input.parties.map((party) => ({
        accountId,
        extensionId: party.extensionId ?? null,
        id: party.id,
        direction: party.direction,
        from: party.from,
        to: party.to,
        status: { code: party.status, rcc: false },
        queueCall: party.queueCall ?? false,
        missedCall: party.missedCall ?? false,
        standAlone: false,
        ...(party.recordings ? { recordings: party.recordings } : {}),
      })),
      origin: { type: "Call" },
    },
  };
}

/** Customer calls the sales DID; queue rings one rep who answers. */
export function inboundQueueAnsweredDeliveries(sessionId = "s-inbound-1") {
  const customer = { phoneNumber: SYNTHETIC_CUSTOMER, name: "Synthetic Customer" };
  const salesDid = { phoneNumber: SYNTHETIC_SALES_DID, name: "Sales Line" };
  const queueParty = (status: string): WebhookPartyInput => ({
    id: `p-${sessionId}-queue`,
    extensionId: SYNTHETIC_QUEUE_EXTENSION.id,
    direction: "Inbound",
    status,
    from: customer,
    to: salesDid,
    queueCall: true,
  });
  const repParty = (status: string): WebhookPartyInput => ({
    id: `p-${sessionId}-rep`,
    extensionId: SYNTHETIC_USER_EXTENSION.id,
    direction: "Inbound",
    status,
    from: customer,
    to: { ...salesDid, extensionId: SYNTHETIC_USER_EXTENSION.id },
    queueCall: true,
  });
  return {
    ringing: webhookDelivery({ uuid: `${sessionId}-u1`, telephonySessionId: sessionId, sequence: 1, eventTime: at(0), parties: [queueParty("Proceeding")] }),
    repRinging: webhookDelivery({ uuid: `${sessionId}-u2`, telephonySessionId: sessionId, sequence: 2, eventTime: at(3), parties: [queueParty("Proceeding"), repParty("Proceeding")] }),
    answered: webhookDelivery({ uuid: `${sessionId}-u3`, telephonySessionId: sessionId, sequence: 3, eventTime: at(8), parties: [queueParty("Disconnected"), repParty("Answered")] }),
    disconnected: webhookDelivery({ uuid: `${sessionId}-u4`, telephonySessionId: sessionId, sequence: 4, eventTime: at(95), parties: [repParty("Disconnected")] }),
  };
}

/** Rep dials a customer who never answers. */
export function outboundUnansweredDeliveries(sessionId = "s-outbound-1") {
  const party = (status: string): WebhookPartyInput => ({
    id: `p-${sessionId}-rep`,
    extensionId: SYNTHETIC_USER_EXTENSION.id,
    direction: "Outbound",
    status,
    from: { phoneNumber: SYNTHETIC_COMPANY_DID, name: SYNTHETIC_USER_EXTENSION.name, extensionId: SYNTHETIC_USER_EXTENSION.id },
    to: { phoneNumber: SYNTHETIC_CUSTOMER_B },
  });
  return {
    setup: webhookDelivery({ uuid: `${sessionId}-u1`, telephonySessionId: sessionId, sequence: 1, eventTime: at(0), parties: [party("Setup")] }),
    proceeding: webhookDelivery({ uuid: `${sessionId}-u2`, telephonySessionId: sessionId, sequence: 2, eventTime: at(2), parties: [party("Proceeding")] }),
    disconnected: webhookDelivery({ uuid: `${sessionId}-u3`, telephonySessionId: sessionId, sequence: 3, eventTime: at(30), parties: [party("Disconnected")] }),
  };
}

/** Internal extension-to-extension call: both sides are account parties. */
export function internalCallDelivery(sessionId = "s-internal-1", sequence = 1) {
  return webhookDelivery({
    uuid: `${sessionId}-u${sequence}`,
    telephonySessionId: sessionId,
    sequence,
    eventTime: at(0),
    parties: [
      {
        id: `p-${sessionId}-caller`,
        extensionId: SYNTHETIC_USER_EXTENSION.id,
        direction: "Outbound",
        status: "Answered",
        from: { extensionId: SYNTHETIC_USER_EXTENSION.id, extensionNumber: SYNTHETIC_USER_EXTENSION.number, name: SYNTHETIC_USER_EXTENSION.name },
        to: { extensionId: SYNTHETIC_USER_EXTENSION_B.id, extensionNumber: SYNTHETIC_USER_EXTENSION_B.number, name: SYNTHETIC_USER_EXTENSION_B.name },
      },
      {
        id: `p-${sessionId}-callee`,
        extensionId: SYNTHETIC_USER_EXTENSION_B.id,
        direction: "Inbound",
        status: "Answered",
        from: { extensionId: SYNTHETIC_USER_EXTENSION.id, extensionNumber: SYNTHETIC_USER_EXTENSION.number, name: SYNTHETIC_USER_EXTENSION.name },
        to: { extensionId: SYNTHETIC_USER_EXTENSION_B.id, extensionNumber: SYNTHETIC_USER_EXTENSION_B.number, name: SYNTHETIC_USER_EXTENSION_B.name },
      },
    ],
  });
}

/** Inbound call with no caller id (withheld). */
export function withheldInboundDelivery(sessionId = "s-withheld-1", status = "Missed") {
  return webhookDelivery({
    uuid: `${sessionId}-u1`,
    telephonySessionId: sessionId,
    sequence: 1,
    eventTime: at(0),
    parties: [
      {
        id: `p-${sessionId}-rep`,
        extensionId: SYNTHETIC_USER_EXTENSION.id,
        direction: "Inbound",
        status,
        from: { name: "Anonymous" },
        to: { phoneNumber: SYNTHETIC_SALES_DID },
        missedCall: status === "Missed",
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Detailed Call Log records
// ---------------------------------------------------------------------------

export function callLogRecord(input: {
  id: string;
  telephonySessionId?: string | null;
  sessionId?: string | null;
  direction: "Inbound" | "Outbound";
  result: string;
  startTime: Date;
  duration: number;
  from: Record<string, unknown>;
  to: Record<string, unknown>;
  recording?: { id: string; type?: string } | null;
  legs?: Array<Record<string, unknown>>;
  lastModifiedTime?: Date;
  accountId?: string;
  action?: string;
}) {
  const accountId = input.accountId ?? SYNTHETIC_ACCOUNT_ID;
  return {
    uri: `https://platform.example/restapi/v1.0/account/${accountId}/call-log/${input.id}?view=Detailed`,
    id: input.id,
    sessionId: input.sessionId === undefined ? `${input.telephonySessionId ?? input.id}-sid` : input.sessionId,
    ...(input.telephonySessionId ? { telephonySessionId: input.telephonySessionId } : {}),
    startTime: input.startTime.toISOString(),
    duration: input.duration,
    durationMs: input.duration * 1000,
    type: "Voice",
    direction: input.direction,
    action: input.action ?? (input.direction === "Inbound" ? "Phone Call" : "VoIP Call"),
    result: input.result,
    to: input.to,
    from: input.from,
    ...(input.recording
      ? { recording: { id: input.recording.id, uri: `https://platform.example/restapi/v1.0/account/${accountId}/recording/${input.recording.id}`, type: input.recording.type ?? "Automatic", contentUri: "https://media.example/redacted" } }
      : {}),
    lastModifiedTime: (input.lastModifiedTime ?? new Date(input.startTime.getTime() + (input.duration + 60) * 1000)).toISOString(),
    transport: "PSTN",
    ...(input.legs ? { legs: input.legs } : {}),
  };
}

export function inboundConnectedCallLog(sessionId = "s-inbound-1", overrides: Partial<Parameters<typeof callLogRecord>[0]> = {}) {
  return callLogRecord({
    id: `cl-${sessionId}`,
    telephonySessionId: sessionId,
    direction: "Inbound",
    result: "Call connected",
    startTime: at(0),
    duration: 95,
    from: { phoneNumber: SYNTHETIC_CUSTOMER, name: "Synthetic Customer", location: "Somewhere, US" },
    to: { phoneNumber: SYNTHETIC_SALES_DID, name: "Sales Line" },
    recording: { id: `rec-${sessionId}-1` },
    legs: [
      { startTime: at(0).toISOString(), duration: 95, type: "Voice", direction: "Inbound", action: "Call Queue", result: "Accepted", legType: "PstnToSip", master: true, from: { phoneNumber: SYNTHETIC_CUSTOMER }, to: { phoneNumber: SYNTHETIC_SALES_DID }, extension: { id: SYNTHETIC_QUEUE_EXTENSION.id } },
      { startTime: at(8).toISOString(), duration: 87, type: "Voice", direction: "Inbound", action: "Accept Call", result: "Accepted", legType: "Accept", from: { phoneNumber: SYNTHETIC_CUSTOMER }, to: { phoneNumber: SYNTHETIC_SALES_DID, extensionId: SYNTHETIC_USER_EXTENSION.id, extensionNumber: SYNTHETIC_USER_EXTENSION.number }, extension: { id: SYNTHETIC_USER_EXTENSION.id }, recording: { id: `rec-${sessionId}-1`, type: "Automatic" } },
    ],
    ...overrides,
  });
}

/** Transfer: rep one accepts, transfers to rep two; each leg has its own recording. */
export function transferredCallLog(sessionId = "s-transfer-1") {
  return callLogRecord({
    id: `cl-${sessionId}`,
    telephonySessionId: sessionId,
    direction: "Inbound",
    result: "Call connected",
    startTime: at(0),
    duration: 300,
    from: { phoneNumber: SYNTHETIC_CUSTOMER, name: "Synthetic Customer" },
    to: { phoneNumber: SYNTHETIC_SALES_DID, name: "Sales Line" },
    recording: { id: `rec-${sessionId}-1` },
    legs: [
      { startTime: at(0).toISOString(), duration: 120, direction: "Inbound", action: "Accept Call", result: "Accepted", legType: "Accept", master: true, from: { phoneNumber: SYNTHETIC_CUSTOMER }, to: { phoneNumber: SYNTHETIC_SALES_DID }, extension: { id: SYNTHETIC_USER_EXTENSION.id }, recording: { id: `rec-${sessionId}-1`, type: "Automatic" } },
      { startTime: at(120).toISOString(), duration: 5, direction: "Outbound", action: "Transfer", result: "Call connected", legType: "Transfer", from: { extensionId: SYNTHETIC_USER_EXTENSION.id }, to: { extensionId: SYNTHETIC_USER_EXTENSION_B.id }, extension: { id: SYNTHETIC_USER_EXTENSION.id }, transferTarget: { telephonySessionId: `${sessionId}-target` } },
      { startTime: at(125).toISOString(), duration: 175, direction: "Inbound", action: "Accept Call", result: "Accepted", legType: "Accept", from: { phoneNumber: SYNTHETIC_CUSTOMER }, to: { extensionId: SYNTHETIC_USER_EXTENSION_B.id }, extension: { id: SYNTHETIC_USER_EXTENSION_B.id }, recording: { id: `rec-${sessionId}-2`, type: "Automatic" } },
    ],
  });
}

export function outboundMissedCallLog(sessionId = "s-outbound-1") {
  return callLogRecord({
    id: `cl-${sessionId}`,
    telephonySessionId: sessionId,
    direction: "Outbound",
    result: "No Answer",
    startTime: at(0),
    duration: 30,
    from: { phoneNumber: SYNTHETIC_COMPANY_DID, name: SYNTHETIC_USER_EXTENSION.name, extensionId: SYNTHETIC_USER_EXTENSION.id, extensionNumber: SYNTHETIC_USER_EXTENSION.number },
    to: { phoneNumber: SYNTHETIC_CUSTOMER_B },
    legs: [
      { startTime: at(0).toISOString(), duration: 30, direction: "Outbound", action: "VoIP Call", result: "No Answer", legType: "CallOut", master: true, from: { phoneNumber: SYNTHETIC_COMPANY_DID, extensionId: SYNTHETIC_USER_EXTENSION.id }, to: { phoneNumber: SYNTHETIC_CUSTOMER_B }, extension: { id: SYNTHETIC_USER_EXTENSION.id } },
    ],
  });
}

export function voicemailCallLog(sessionId = "s-voicemail-1") {
  return callLogRecord({
    id: `cl-${sessionId}`,
    telephonySessionId: sessionId,
    direction: "Inbound",
    result: "Voicemail",
    startTime: at(0),
    duration: 45,
    from: { phoneNumber: SYNTHETIC_CUSTOMER, name: "Synthetic Customer" },
    to: { phoneNumber: SYNTHETIC_SALES_DID },
    recording: null,
    legs: [
      { startTime: at(0).toISOString(), duration: 45, direction: "Inbound", action: "Phone Call", result: "Voicemail", legType: "PstnToSip", master: true, from: { phoneNumber: SYNTHETIC_CUSTOMER }, to: { phoneNumber: SYNTHETIC_SALES_DID }, extension: { id: SYNTHETIC_USER_EXTENSION.id } },
    ],
  });
}

export function internalCallLog(sessionId = "s-internal-1") {
  return callLogRecord({
    id: `cl-${sessionId}`,
    telephonySessionId: sessionId,
    direction: "Outbound",
    result: "Call connected",
    startTime: at(0),
    duration: 60,
    from: { extensionId: SYNTHETIC_USER_EXTENSION.id, extensionNumber: SYNTHETIC_USER_EXTENSION.number, name: SYNTHETIC_USER_EXTENSION.name },
    to: { extensionId: SYNTHETIC_USER_EXTENSION_B.id, extensionNumber: SYNTHETIC_USER_EXTENSION_B.number, name: SYNTHETIC_USER_EXTENSION_B.name },
    legs: [
      { startTime: at(0).toISOString(), duration: 60, direction: "Outbound", action: "VoIP Call", result: "Call connected", legType: "SipToSip", master: true, from: { extensionId: SYNTHETIC_USER_EXTENSION.id }, to: { extensionId: SYNTHETIC_USER_EXTENSION_B.id }, extension: { id: SYNTHETIC_USER_EXTENSION.id } },
    ],
  });
}

export function withheldMissedCallLog(sessionId = "s-withheld-1") {
  return callLogRecord({
    id: `cl-${sessionId}`,
    telephonySessionId: sessionId,
    direction: "Inbound",
    result: "Missed",
    startTime: at(0),
    duration: 20,
    from: { name: "Anonymous" },
    to: { phoneNumber: SYNTHETIC_SALES_DID },
  });
}

export function malformedNumberCallLog(sessionId = "s-malformed-1") {
  return callLogRecord({
    id: `cl-${sessionId}`,
    telephonySessionId: sessionId,
    direction: "Inbound",
    result: "Missed",
    startTime: at(0),
    duration: 12,
    from: { phoneNumber: "+1", name: "Garbled" },
    to: { phoneNumber: SYNTHETIC_SALES_DID },
  });
}

/** Same session id as `inboundQueueAnsweredDeliveries` but the identifiers only appear in Call Log. */
export function sessionIdOnlyCallLog(sessionId = "s-inbound-1") {
  return callLogRecord({
    id: `cl-${sessionId}-sidonly`,
    telephonySessionId: null,
    sessionId: `${sessionId}-sid`,
    direction: "Inbound",
    result: "Call connected",
    startTime: at(0),
    duration: 95,
    from: { phoneNumber: SYNTHETIC_CUSTOMER, name: "Synthetic Customer" },
    to: { phoneNumber: SYNTHETIC_SALES_DID },
  });
}
