import { resolveRingCentralInboundSource } from "./call-lead-sources";
import type { NormalizedRingCentralPartyEvent } from "./call-candidate-types";
import { normalizePhoneNumberToE164Like } from "./phone-normalization";

export function normalizeRingCentralWebhookPayload(
  payload: unknown,
  receivedAt: Date,
): NormalizedRingCentralPartyEvent[] {
  const root = asRecord(payload);
  const body = asRecord(root?.body);
  const telephonySessionId = valueToString(body?.telephonySessionId);
  const parties = Array.isArray(body?.parties) ? body.parties : [];

  if (!telephonySessionId) {
    return [];
  }

  return parties
    .map((party) =>
      normalizeParty({
        root,
        body,
        party,
        telephonySessionId,
        receivedAt,
      }),
    )
    .filter((event) => event !== null);
}

type NormalizePartyInput = {
  root: Record<string, unknown> | null;
  body: Record<string, unknown> | null;
  party: unknown;
  telephonySessionId: string;
  receivedAt: Date;
};

function normalizeParty(
  input: NormalizePartyInput,
): NormalizedRingCentralPartyEvent | null {
  const party = asRecord(input.party);
  const partyId = valueToString(party?.id ?? party?.partyId);
  if (!party || !partyId) {
    return null;
  }

  const from = asRecord(party.from);
  const to = asRecord(party.to);
  const status = asRecord(party.status);
  const uiCallInfo = asRecord(party.uiCallInfo);
  const uiPrimary = asRecord(uiCallInfo?.primary);
  const uiAdditional = asRecord(uiCallInfo?.additional);
  const toPhoneNumber = valueToString(to?.phoneNumber);
  const normalizedToPhoneNumber = normalizePhoneNumberToE164Like(toPhoneNumber);
  const source = resolveRingCentralInboundSource(normalizedToPhoneNumber);

  return {
    provider: "ringcentral",

    webhookUuid: valueToString(input.root?.uuid),
    subscriptionId: valueToString(input.root?.subscriptionId),
    event: valueToString(input.root?.event),
    ownerId: valueToString(input.root?.ownerId),

    timestamp: valueToDate(input.root?.timestamp),
    eventTime: valueToDate(input.body?.eventTime),
    receivedAt: input.receivedAt,

    sequence: valueToNumber(input.body?.sequence),
    sessionId: valueToString(input.body?.sessionId),
    telephonySessionId: input.telephonySessionId,
    partyId,

    direction: valueToString(party.direction),
    statusCode: valueToString(status?.code ?? status?.reason),

    fromPhoneNumber: valueToString(from?.phoneNumber),
    fromName: valueToString(from?.name),

    toPhoneNumber,
    toName: valueToString(to?.name),

    normalizedFromPhoneNumber: normalizePhoneNumberToE164Like(
      valueToString(from?.phoneNumber),
    ),
    normalizedToPhoneNumber,

    queueCall: valueToBoolean(party.queueCall),
    missedCall: valueToBoolean(party.missedCall),

    uiPrimaryType: valueToString(uiPrimary?.type),
    uiPrimaryValue: valueToString(uiPrimary?.value),
    uiAdditionalType: valueToString(uiAdditional?.type),
    uiAdditionalValue: valueToString(uiAdditional?.value),

    targetMatched: source !== null,
    sourceLabel: source?.sourceLabel ?? null,
    sourceCompany: source?.sourceCompany ?? null,

    rawParty: input.party,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function valueToString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

export function valueToNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function valueToBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  return null;
}

function valueToDate(value: unknown): Date | null {
  const stringValue = valueToString(value);
  if (!stringValue) {
    return null;
  }

  const date = new Date(stringValue);
  return Number.isNaN(date.getTime()) ? null : date;
}
