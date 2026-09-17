import { canonicalJson } from "../durableWork/checksum";
import type { DirectoryLookup } from "./directory";
import { classifyEndpoint, isCompanySide, type ClassifiedEndpoint } from "./phone";
import type {
  AliasKind,
  CaptureSource,
  ContactType,
  IdentityBasis,
  InteractionDirection,
  InteractionIdentity,
  InteractionProjection,
  PartyDirection,
  PartyRole,
  ProjectedLeg,
  ProjectedParty,
  ProjectedRecording,
  ProjectionOutcome,
  RouteResolver,
  WebhookPartyObservation,
} from "./types";

/**
 * Pure projection: provider observations in, canonical Call Interaction out.
 * No I/O. Both the webhook path and the authoritative Detailed Call Log
 * reconcile feed the same projection, so replaying either source is a no-op
 * once the stored facts already reflect it.
 *
 * Invariants enforced here:
 * - `terminal` never flips back; `provider_connected` never flips back.
 * - Each party is fenced by its own `last_webhook_sequence`; one party's
 *   sequence never suppresses another party in the same delivery.
 * - A Call Log record older than the stored provider modification adds
 *   evidence (ids, legs, recordings) but cannot regress result/duration.
 * - Once a Call Log record has been applied, its result/duration/ended_at are
 *   authoritative over later webhook observations.
 * - `contact_type` is only `voicemail` (provider-declared) or `unknown` here;
 *   human conversation is never inferred from connection or duration.
 * - Identical semantic input yields `changed: false`.
 */

/** Parity set with the qualification evaluator; kept local because `call-candidate-*` is a forbidden import. */
export const TERMINAL_PARTY_STATUSES = Object.freeze([
  "Disconnected",
  "Gone",
  "Finished",
  "Voicemail",
  "Missed",
  "NoCall",
] as const);
const TERMINAL = new Set<string>(TERMINAL_PARTY_STATUSES);
const CONNECTED_STATUSES = new Set(["Answered", "Hold", "Parked"]);
export const CONNECTED_CALL_LOG_RESULTS = Object.freeze([
  "Accepted",
  "Completed",
  "Call connected",
  "Connected",
  "Answered",
] as const);
const CONNECTED_RESULTS = new Set<string>(CONNECTED_CALL_LOG_RESULTS);
const MONITORING_MARKERS = new Set([
  "Monitoring",
  "Call Monitoring",
  "Call Coaching",
  "Whisper",
  "Barge In",
  "Coaching",
  "Barge",
]);
const TRANSFER_MARKERS = new Set([
  "Transfer",
  "Call Flip",
  "Move",
  "Call Transfer",
  "BlindTransfer",
  "WarmTransfer",
]);
export const MAX_LEGS = 40;

export type CallLogRecordInput = Record<string, unknown>;

export type ProjectionOptions = {
  now: Date;
  resolveRoute?: RouteResolver;
};

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export function identityFromCallLogRecord(record: CallLogRecordInput): InteractionIdentity {
  const legs = arrayOfRecords(record.legs);
  const legIds = legs.map((leg) => str(leg.id)).filter(isString);
  const recordId = str(record.id);
  return {
    telephony_session_id: str(record.telephonySessionId),
    session_id: str(record.sessionId),
    call_log_ids: uniqueSorted([...(recordId ? [recordId] : []), ...legIds]),
  };
}

export function identityFromWebhookEvents(
  events: readonly WebhookPartyObservation[],
): InteractionIdentity {
  const sessions = uniqueSorted(events.map((e) => e.telephony_session_id));
  if (sessions.length !== 1) {
    throw new TypeError("Webhook events must share exactly one telephony session");
  }
  const sessionIds = uniqueSorted(events.map((e) => e.session_id).filter(isString));
  return {
    telephony_session_id: sessions[0]!,
    session_id: sessionIds.length === 1 ? sessionIds[0]! : null,
    call_log_ids: [],
  };
}

export function aliasesFor(
  identity: InteractionIdentity,
): Array<{ kind: AliasKind; value: string }> {
  const out: Array<{ kind: AliasKind; value: string }> = [];
  if (identity.telephony_session_id)
    out.push({ kind: "telephony_session_id", value: identity.telephony_session_id });
  if (identity.session_id) out.push({ kind: "session_id", value: identity.session_id });
  for (const id of identity.call_log_ids) out.push({ kind: "call_log_id", value: id });
  return out;
}

export function strongestBasis(identity: InteractionIdentity): IdentityBasis {
  if (identity.telephony_session_id) return "telephony_session_id";
  if (identity.session_id) return "session_id";
  if (identity.call_log_ids.length) return "call_log_id";
  throw new TypeError("A Call Interaction needs at least one provider identity");
}

export function sameProjection(a: InteractionProjection, b: InteractionProjection): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

// ---------------------------------------------------------------------------
// Webhook party events
// ---------------------------------------------------------------------------

export function fromWebhookParties(
  existing: InteractionProjection | null,
  events: readonly WebhookPartyObservation[],
  directory: DirectoryLookup,
  accountId: string,
  options: ProjectionOptions,
): ProjectionOutcome {
  if (!events.length) throw new TypeError("At least one webhook party event is required");
  const identity = identityFromWebhookEvents(events);
  const parties = new Map<string, ProjectedParty>();
  for (const party of existing?.parties ?? []) parties.set(partyKey(party), { ...party });
  const externalByParty = new Map<string, ClassifiedEndpoint>();
  const companyByParty = new Map<string, ClassifiedEndpoint>();
  let fenced = 0;
  let maxSequence = existing?.max_observed_webhook_sequence ?? null;
  const observedRecordings: string[] = [];
  let earliestStart: Date | null = existing?.started_at ?? null;

  const byParty = new Map<string, WebhookPartyObservation[]>();
  for (const event of events) {
    const list = byParty.get(event.party_id) ?? [];
    list.push(event);
    byParty.set(event.party_id, list);
  }

  for (const [partyId, partyEvents] of byParty) {
    const ordered = [...partyEvents].sort(compareBySequenceThenTime);
    const key = `id:${partyId}`;
    let party = parties.get(key) ?? adoptExtensionParty(parties, ordered[0]!.extension_id, partyId);
    for (const event of ordered) {
      if (
        party &&
        event.sequence !== null &&
        party.last_webhook_sequence !== null &&
        event.sequence <= party.last_webhook_sequence
      ) {
        fenced += 1;
        continue;
      }
      if (event.sequence !== null && (maxSequence === null || event.sequence > maxSequence)) {
        maxSequence = event.sequence;
      }
      const startCandidate = event.call_started_at ?? event.event_time ?? event.received_at;
      if (!earliestStart || startCandidate < earliestStart) earliestStart = startCandidate;
      const direction = normalizeDirection(event.direction);
      const externalSide = direction === "Outbound" ? event.to : event.from;
      const companySide = direction === "Outbound" ? event.from : event.to;
      const company = classifyEndpoint(
        {
          phoneNumber: companySide.phone_number,
          name: companySide.name,
          extensionId: event.extension_id ?? companySide.extension_id,
          extensionNumber: companySide.extension_number,
        },
        directory,
      );
      const external = classifyEndpoint(
        {
          phoneNumber: externalSide.phone_number,
          name: externalSide.name,
          extensionId: externalSide.extension_id,
          extensionNumber: externalSide.extension_number,
        },
        directory,
      );
      externalByParty.set(key, external);
      companyByParty.set(key, company);
      party = applyPartyEvent(party, event, direction, company, companySide.name, directory);
      for (const recording of event.recordings) if (recording.id) observedRecordings.push(recording.id);
    }
    if (party) parties.set(key, party);
  }

  const accountParties = [...parties.values()].filter((p) => p.role !== "external");
  const externals = [...externalByParty.values()];
  const externalIsCompany = externals.length > 0 && externals.every((e) => isCompanySide(e.kind));
  const direction = deriveWebhookDirection(accountParties, existing?.direction ?? null, externalIsCompany);
  const external = pickEndpoint(externals) ?? null;
  const company = pickEndpoint([...companyByParty.values()]) ?? null;
  const startedAt = existing?.started_at ?? earliestStart ?? options.now;

  const externalParty = buildExternalParty(
    existing?.parties.find((p) => p.role === "external") ?? null,
    external,
    externalSideName(events, direction),
    direction,
  );
  if (externalParty) parties.set("external", externalParty);

  const anyConnected = accountParties.some((p) => p.connected);
  const allTerminal =
    accountParties.length > 0 && accountParties.every((p) => p.terminal_at !== null);
  const terminal = (existing?.terminal ?? false) || allTerminal;
  const callLogAuthoritative = existing?.provider_last_modified_at != null;
  const voicemailDeclared = accountParties.some((p) => p.terminal_status === "Voicemail");
  const providerResult = callLogAuthoritative
    ? existing!.provider_result
    : existing?.provider_result ?? (allTerminal ? summarizeWebhookResult(accountParties) : null);
  const contact = deriveContactType(existing, voicemailDeclared);
  const recordings = mergeRecordings(
    existing?.recordings ?? [],
    observedRecordings.map((id) => ({ id, type: null })),
    options.now,
  );
  const fullIdentity: InteractionIdentity = {
    telephony_session_id: identity.telephony_session_id ?? existing?.telephony_session_id ?? null,
    session_id: existing?.session_id ?? identity.session_id,
    call_log_ids: existing?.call_log_ids ?? [],
  };
  const externalE164 = direction === "Internal" ? null : external?.e164 ?? existing?.external_e164 ?? null;
  const companyE164 = company?.e164 ?? existing?.company_e164 ?? null;
  const next: InteractionProjection = {
    provider: "ringcentral",
    provider_account_id: accountId,
    telephony_session_id: fullIdentity.telephony_session_id,
    session_id: fullIdentity.session_id,
    call_log_ids: fullIdentity.call_log_ids,
    identity_basis: strongestBasis(fullIdentity),
    direction,
    external_e164: externalE164,
    external_endpoint_kind: external?.kind ?? existing?.external_endpoint_kind ?? null,
    company_e164: companyE164,
    inbound_route_id:
      existing?.inbound_route_id ??
      (direction === "Inbound" && options.resolveRoute
        ? options.resolveRoute(companyE164, startedAt)
        : null),
    started_at: startedAt,
    answered_at: earliest([existing?.answered_at ?? null, ...accountParties.map((p) => p.answered_at)]),
    ended_at: callLogAuthoritative
      ? existing!.ended_at
      : terminal
        ? existing?.ended_at ?? latest(accountParties.map((p) => p.terminal_at))
        : existing?.ended_at ?? null,
    duration_seconds: existing?.duration_seconds ?? null,
    provider_result: providerResult,
    provider_connected: (existing?.provider_connected ?? false) || anyConnected,
    contact_type: contact.contact_type,
    contact_type_basis: contact.contact_type_basis,
    parties: orderParties([...parties.values()]),
    legs: existing?.legs ?? [],
    legs_overflow_count: existing?.legs_overflow_count ?? 0,
    connected_user_extension_ids: uniqueSorted([
      ...(existing?.connected_user_extension_ids ?? []),
      ...accountParties
        .filter((p) => p.connected && p.extension_id && (p.role === "user" || p.role === "unknown"))
        .map((p) => p.extension_id!),
    ]),
    queue_fanout:
      (existing?.queue_fanout ?? false) ||
      accountParties.some((p) => p.role === "queue") ||
      events.some((e) => e.queue_call === true) ||
      accountParties.filter((p) => p.role === "user" || p.role === "unknown").length >= 3,
    transfer: existing?.transfer ?? false,
    monitoring: (existing?.monitoring ?? false) || accountParties.some((p) => p.role === "monitoring"),
    recordings,
    sources: unionSources(existing?.sources ?? [], ["webhook"]),
    provider_last_modified_at: existing?.provider_last_modified_at ?? null,
    terminal,
    max_observed_webhook_sequence: maxSequence,
  };
  return finish(existing, next, fullIdentity, fenced, false);
}

/**
 * A Call Log leg applied before any webhook event leaves an extension-keyed
 * party (`party_id: null`). When the webhook party for that extension arrives,
 * it takes over that row instead of duplicating the participant.
 */
function adoptExtensionParty(
  parties: Map<string, ProjectedParty>,
  extensionId: string | null,
  partyId: string,
): ProjectedParty | null {
  if (!extensionId) return null;
  const key = `ext:${extensionId}`;
  const adopted = parties.get(key);
  if (!adopted || adopted.party_id !== null) return null;
  parties.delete(key);
  return { ...adopted, party_id: partyId };
}

function applyPartyEvent(
  party: ProjectedParty | null,
  event: WebhookPartyObservation,
  direction: PartyDirection,
  company: ClassifiedEndpoint,
  companyName: string | null,
  directory: DirectoryLookup,
): ProjectedParty {
  const eventAt = event.event_time ?? event.received_at;
  const status = event.status_code;
  const connectedNow = status !== null && CONNECTED_STATUSES.has(status);
  const terminalNow = status !== null && TERMINAL.has(status);
  const base: ProjectedParty = party ?? {
    party_id: event.party_id,
    last_webhook_sequence: null,
    last_event_at: null,
    role: "unknown",
    direction: null,
    extension_id: null,
    extension_number: null,
    phone_number_raw: null,
    e164: null,
    name_raw: null,
    connected: false,
    answered_at: null,
    terminal_at: null,
    terminal_status: null,
  };
  return {
    ...base,
    last_webhook_sequence:
      event.sequence !== null
        ? Math.max(base.last_webhook_sequence ?? event.sequence, event.sequence)
        : base.last_webhook_sequence,
    last_event_at: latest([base.last_event_at, eventAt]),
    role: resolvePartyRole(event, directory, base.role),
    direction: direction ?? base.direction,
    extension_id: event.extension_id ?? base.extension_id ?? company.extension_id,
    extension_number: company.extension_number ?? base.extension_number,
    phone_number_raw: company.raw ?? base.phone_number_raw,
    e164: company.e164 ?? base.e164,
    name_raw: companyName ?? base.name_raw,
    connected: base.connected || connectedNow,
    answered_at: base.answered_at ?? (connectedNow ? eventAt : null),
    // Terminal facts never regress; a later terminal status may refine the code.
    terminal_at: base.terminal_at ?? (terminalNow ? eventAt : null),
    terminal_status: terminalNow ? status : base.terminal_status,
  };
}

function resolvePartyRole(
  event: WebhookPartyObservation,
  directory: DirectoryLookup,
  previous: PartyRole,
): PartyRole {
  if (event.extension_id) {
    const entry = directory.extensionById(event.extension_id);
    if (entry) {
      switch (entry.type) {
        case "User":
          return "user";
        case "Department":
          return "queue";
        case "IvrMenu":
          return "ivr";
        case "Voicemail":
        case "VoicemailExtension":
          return "voicemail";
        default:
          return previous;
      }
    }
    if (directory.isQueueExtension(event.extension_id)) return "queue";
  }
  // Without directory evidence an account party stays `unknown`; `queueCall`
  // describes the call flow, not this party's own kind.
  return previous;
}

function deriveWebhookDirection(
  accountParties: ProjectedParty[],
  previous: InteractionDirection | null,
  externalIsCompany: boolean,
): InteractionDirection {
  if (previous === "Internal") return previous;
  const directions = new Set(accountParties.map((p) => p.direction).filter(isString));
  if (directions.has("Inbound") && directions.has("Outbound")) return "Internal";
  if (externalIsCompany) return "Internal";
  if (previous && previous !== "Unknown") return previous;
  if (directions.size === 1) return [...directions][0] as InteractionDirection;
  return "Unknown";
}

function summarizeWebhookResult(accountParties: ProjectedParty[]): string | null {
  if (accountParties.some((p) => p.connected)) return "Call connected";
  if (accountParties.some((p) => p.terminal_status === "Voicemail")) return "Voicemail";
  if (accountParties.some((p) => p.terminal_status === "Missed")) return "Missed";
  return accountParties.find((p) => p.terminal_status)?.terminal_status ?? null;
}

function externalSideName(
  events: readonly WebhookPartyObservation[],
  direction: InteractionDirection,
): string | null {
  for (const event of events) {
    const side = direction === "Outbound" ? event.to : event.from;
    if (side.name) return side.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Detailed Call Log record
// ---------------------------------------------------------------------------

export function fromCallLogRecord(
  existing: InteractionProjection | null,
  record: CallLogRecordInput,
  directory: DirectoryLookup,
  accountId: string,
  options: ProjectionOptions & { source?: CaptureSource },
): ProjectionOutcome {
  const identity = identityFromCallLogRecord(record);
  const source = options.source ?? "call_log_reconcile";
  const legsRaw = arrayOfRecords(record.legs);
  const startTime =
    dateOf(record.startTime) ??
    earliest(legsRaw.map((leg) => dateOf(leg.startTime))) ??
    existing?.started_at ??
    null;
  if (!startTime) throw new TypeError("Call Log record has no start time");
  const lastModified = dateOf(record.lastModifiedTime);
  const stale =
    existing?.provider_last_modified_at != null &&
    lastModified !== null &&
    lastModified < existing.provider_last_modified_at;

  const from = classifyEndpoint(endpointInput(recordOf(record.from)), directory);
  const to = classifyEndpoint(endpointInput(recordOf(record.to)), directory);
  const recordDirection = normalizeDirection(str(record.direction));
  const bothCompany = isCompanySide(from.kind) && isCompanySide(to.kind);
  const direction: InteractionDirection = bothCompany
    ? "Internal"
    : recordDirection ?? existing?.direction ?? "Unknown";
  const external = direction === "Outbound" ? to : from;
  const company = direction === "Outbound" ? from : to;

  const durationSeconds = numberOf(record.duration) ?? msToSeconds(numberOf(record.durationMs));
  const result = str(record.result);
  const legs = legsRaw.map((leg) => projectLeg(leg));
  const connected =
    (result !== null && CONNECTED_RESULTS.has(result)) ||
    legs.some((leg) => leg.result !== null && CONNECTED_RESULTS.has(leg.result));
  const recordingIds = [recordOf(record.recording), ...legsRaw.map((leg) => recordOf(leg.recording))]
    .filter((r): r is Record<string, unknown> => r !== null)
    .map((r) => ({ id: str(r.id), type: str(r.type) }))
    .filter((r): r is { id: string; type: string | null } => r.id !== null);
  const mergedLegs = mergeLegs(existing?.legs ?? [], legs);
  const transfer =
    (existing?.transfer ?? false) ||
    legsRaw.some(
      (leg) =>
        TRANSFER_MARKERS.has(str(leg.action) ?? "") ||
        TRANSFER_MARKERS.has(str(leg.legType) ?? "") ||
        recordOf(leg.transferTarget) !== null ||
        recordOf(leg.transferee) !== null,
    ) ||
    TRANSFER_MARKERS.has(str(record.action) ?? "");
  const monitoring =
    (existing?.monitoring ?? false) ||
    legsRaw.some(
      (leg) =>
        MONITORING_MARKERS.has(str(leg.action) ?? "") || MONITORING_MARKERS.has(str(leg.legType) ?? ""),
    );
  const connectedExtensions = legs
    .filter((leg) => leg.result !== null && CONNECTED_RESULTS.has(leg.result) && leg.extension_id)
    .map((leg) => leg.extension_id!);
  const voicemailDeclared = result === "Voicemail" || legs.some((leg) => leg.result === "Voicemail");
  const contact = deriveContactType(existing, voicemailDeclared);

  const fullIdentity: InteractionIdentity = {
    telephony_session_id: identity.telephony_session_id ?? existing?.telephony_session_id ?? null,
    session_id: identity.session_id ?? existing?.session_id ?? null,
    call_log_ids: uniqueSorted([...(existing?.call_log_ids ?? []), ...identity.call_log_ids]),
  };
  const endedAt =
    durationSeconds !== null ? new Date(startTime.getTime() + durationSeconds * 1000) : null;
  const externalE164 = direction === "Internal" ? null : external.e164;
  const companyE164 = company.e164;
  const parties = mergeCallLogParties(existing?.parties ?? [], {
    direction,
    external,
    externalName: strOf((direction === "Outbound" ? recordOf(record.to) : recordOf(record.from))?.name),
    company,
    companyName: strOf((direction === "Outbound" ? recordOf(record.from) : recordOf(record.to))?.name),
    legs: legsRaw,
    directory,
    startTime,
    connectedExtensions,
    result,
  });

  const next: InteractionProjection = {
    provider: "ringcentral",
    provider_account_id: accountId,
    telephony_session_id: fullIdentity.telephony_session_id,
    session_id: fullIdentity.session_id,
    call_log_ids: fullIdentity.call_log_ids,
    identity_basis: strongestBasis(fullIdentity),
    direction: stale ? existing!.direction : direction,
    external_e164: stale ? existing!.external_e164 : externalE164 ?? existing?.external_e164 ?? null,
    external_endpoint_kind: stale ? existing!.external_endpoint_kind : external.kind,
    company_e164: stale ? existing!.company_e164 : companyE164 ?? existing?.company_e164 ?? null,
    inbound_route_id:
      existing?.inbound_route_id ??
      (direction === "Inbound" && options.resolveRoute
        ? options.resolveRoute(companyE164, startTime)
        : null),
    started_at: stale ? existing!.started_at : startTime,
    answered_at: existing?.answered_at ?? null,
    ended_at: stale ? existing!.ended_at : endedAt ?? existing?.ended_at ?? null,
    duration_seconds: stale ? existing!.duration_seconds : durationSeconds ?? existing?.duration_seconds ?? null,
    provider_result: stale ? existing!.provider_result : result ?? existing?.provider_result ?? null,
    provider_connected: (existing?.provider_connected ?? false) || connected,
    contact_type: contact.contact_type,
    contact_type_basis: contact.contact_type_basis,
    parties,
    legs: mergedLegs.legs,
    legs_overflow_count: mergedLegs.overflow,
    connected_user_extension_ids: uniqueSorted([
      ...(existing?.connected_user_extension_ids ?? []),
      ...connectedExtensions.filter((id) => {
        const entry = directory.extensionById(id);
        return !entry || entry.type === "User";
      }),
    ]),
    queue_fanout:
      (existing?.queue_fanout ?? false) ||
      legsRaw.some((leg) => {
        const action = str(leg.action) ?? "";
        return action === "Call Queue" || action === "Hunt Group" || action === "Ring Group";
      }),
    transfer,
    monitoring,
    recordings: mergeRecordings(existing?.recordings ?? [], recordingIds, options.now),
    sources: unionSources(existing?.sources ?? [], [source]),
    provider_last_modified_at: stale
      ? existing!.provider_last_modified_at
      : latest([existing?.provider_last_modified_at ?? null, lastModified]),
    // A Call Log record is a finalized provider fact: the session has ended.
    terminal: true,
    max_observed_webhook_sequence: existing?.max_observed_webhook_sequence ?? null,
  };
  return finish(existing, next, fullIdentity, 0, stale);
}

function projectLeg(leg: Record<string, unknown>): ProjectedLeg {
  const duration = numberOf(leg.duration) ?? msToSeconds(numberOf(leg.durationMs));
  return {
    call_log_id: str(leg.id),
    leg_type: str(leg.legType),
    direction: str(leg.direction),
    result: str(leg.result),
    start_time: dateOf(leg.startTime),
    duration_seconds: duration,
    extension_id: strOf(recordOf(leg.extension)?.id),
    transfer_target_session_id:
      strOf(recordOf(leg.transferTarget)?.telephonySessionId) ??
      strOf(recordOf(leg.transferee)?.telephonySessionId) ??
      null,
    recording_id: strOf(recordOf(leg.recording)?.id),
  };
}

function legKey(leg: ProjectedLeg): string {
  return (
    leg.call_log_id ??
    canonicalJson([
      leg.start_time,
      leg.leg_type,
      leg.direction,
      leg.extension_id,
      leg.result,
      leg.recording_id,
    ])
  );
}

function mergeLegs(
  existing: ProjectedLeg[],
  incoming: ProjectedLeg[],
): { legs: ProjectedLeg[]; overflow: number } {
  const map = new Map<string, ProjectedLeg>();
  for (const leg of existing) map.set(legKey(leg), leg);
  for (const leg of incoming) map.set(legKey(leg), leg);
  const ordered = [...map.values()].sort((a, b) => {
    const at = a.start_time?.getTime() ?? 0;
    const bt = b.start_time?.getTime() ?? 0;
    return at !== bt ? at - bt : legKey(a).localeCompare(legKey(b));
  });
  return {
    legs: ordered.slice(0, MAX_LEGS),
    overflow: Math.max(0, ordered.length - MAX_LEGS),
  };
}

function mergeCallLogParties(
  existing: ProjectedParty[],
  input: {
    direction: InteractionDirection;
    external: ClassifiedEndpoint;
    externalName: string | null;
    company: ClassifiedEndpoint;
    companyName: string | null;
    legs: Record<string, unknown>[];
    directory: DirectoryLookup;
    startTime: Date;
    connectedExtensions: string[];
    result: string | null;
  },
): ProjectedParty[] {
  const parties = new Map<string, ProjectedParty>();
  for (const party of existing) parties.set(partyKey(party), { ...party });
  const externalParty = buildExternalParty(
    existing.find((p) => p.role === "external") ?? null,
    input.direction === "Internal" ? null : input.external,
    input.externalName,
    input.direction,
  );
  if (externalParty) parties.set("external", externalParty);
  // Call Log legs describe account extensions that handled the call. They are
  // merged as extension-keyed parties only when no webhook party already
  // represents that extension, so webhook sequences stay authoritative.
  const knownExtensions = new Set(existing.map((p) => p.extension_id).filter(isString));
  for (const leg of input.legs) {
    const extensionId = strOf(recordOf(leg.extension)?.id);
    if (!extensionId || knownExtensions.has(extensionId)) continue;
    const key = `ext:${extensionId}`;
    const legResult = str(leg.result);
    const legDirection = normalizeDirection(str(leg.direction));
    const legTo = recordOf(leg.to);
    const legFrom = recordOf(leg.from);
    const companySide = legDirection === "Outbound" ? legFrom : legTo;
    const entry = input.directory.extensionById(extensionId);
    const role: PartyRole = entry
      ? entry.type === "User"
        ? "user"
        : entry.type === "Department"
          ? "queue"
          : entry.type === "IvrMenu"
            ? "ivr"
            : entry.type.startsWith("Voicemail")
              ? "voicemail"
              : "unknown"
      : MONITORING_MARKERS.has(str(leg.action) ?? "")
        ? "monitoring"
        : "unknown";
    const previous = parties.get(key);
    const connected = legResult !== null && CONNECTED_RESULTS.has(legResult);
    const start = dateOf(leg.startTime);
    const duration = numberOf(leg.duration);
    parties.set(key, {
      party_id: previous?.party_id ?? null,
      last_webhook_sequence: previous?.last_webhook_sequence ?? null,
      last_event_at: previous?.last_event_at ?? null,
      role: previous && previous.role !== "unknown" ? previous.role : role,
      direction: legDirection ?? previous?.direction ?? null,
      extension_id: extensionId,
      extension_number: strOf(companySide?.extensionNumber) ?? previous?.extension_number ?? null,
      phone_number_raw: strOf(companySide?.phoneNumber) ?? previous?.phone_number_raw ?? null,
      e164: classifyEndpoint(endpointInput(companySide), input.directory).e164 ?? previous?.e164 ?? null,
      name_raw: strOf(companySide?.name) ?? previous?.name_raw ?? null,
      connected: (previous?.connected ?? false) || connected,
      answered_at: previous?.answered_at ?? null,
      terminal_at:
        previous?.terminal_at ??
        (start && duration !== null ? new Date(start.getTime() + duration * 1000) : null),
      terminal_status: previous?.terminal_status ?? legResult,
    });
  }
  return orderParties([...parties.values()]);
}

// ---------------------------------------------------------------------------
// Merge with explicit same-session provider proof
// ---------------------------------------------------------------------------

/**
 * Folds two persisted projections that one provider record proved to be the
 * same session (it carried both identities). Never called on phone/time
 * similarity. `canonical` wins on conflicting scalar facts unless `other`
 * carries a newer Call Log modification.
 */
export function mergeProjections(
  canonical: InteractionProjection,
  other: InteractionProjection,
): InteractionProjection {
  if (canonical.provider_account_id !== other.provider_account_id) {
    throw new TypeError("Cannot merge interactions from different provider accounts");
  }
  const otherAuthoritative =
    other.provider_last_modified_at !== null &&
    (canonical.provider_last_modified_at === null ||
      other.provider_last_modified_at > canonical.provider_last_modified_at);
  const primary = otherAuthoritative ? other : canonical;
  const secondary = otherAuthoritative ? canonical : other;
  const parties = new Map<string, ProjectedParty>();
  for (const party of [...secondary.parties, ...primary.parties]) {
    const key = partyKey(party);
    const previous = parties.get(key);
    parties.set(key, previous ? mergeParty(previous, party) : party);
  }
  const legs = mergeLegs(secondary.legs, primary.legs);
  const identity: InteractionIdentity = {
    telephony_session_id: canonical.telephony_session_id ?? other.telephony_session_id,
    session_id: canonical.session_id ?? other.session_id,
    call_log_ids: uniqueSorted([...canonical.call_log_ids, ...other.call_log_ids]),
  };
  const contact = deriveContactType(
    primary.contact_type !== "unknown" ? primary : secondary,
    primary.contact_type === "voicemail" || secondary.contact_type === "voicemail",
  );
  return {
    provider: "ringcentral",
    provider_account_id: canonical.provider_account_id,
    ...identity,
    identity_basis: strongestBasis(identity),
    direction:
      primary.direction !== "Unknown" ? primary.direction : secondary.direction,
    external_e164: primary.external_e164 ?? secondary.external_e164,
    external_endpoint_kind: primary.external_endpoint_kind ?? secondary.external_endpoint_kind,
    company_e164: primary.company_e164 ?? secondary.company_e164,
    inbound_route_id: primary.inbound_route_id ?? secondary.inbound_route_id,
    started_at: earliest([canonical.started_at, other.started_at])!,
    answered_at: earliest([canonical.answered_at, other.answered_at]),
    ended_at: primary.ended_at ?? secondary.ended_at,
    duration_seconds: primary.duration_seconds ?? secondary.duration_seconds,
    provider_result: primary.provider_result ?? secondary.provider_result,
    provider_connected: canonical.provider_connected || other.provider_connected,
    contact_type: contact.contact_type,
    contact_type_basis: contact.contact_type_basis,
    parties: orderParties([...parties.values()]),
    legs: legs.legs,
    legs_overflow_count: legs.overflow + canonical.legs_overflow_count + other.legs_overflow_count,
    connected_user_extension_ids: uniqueSorted([
      ...canonical.connected_user_extension_ids,
      ...other.connected_user_extension_ids,
    ]),
    queue_fanout: canonical.queue_fanout || other.queue_fanout,
    transfer: canonical.transfer || other.transfer,
    monitoring: canonical.monitoring || other.monitoring,
    recordings: mergeRecordings(
      canonical.recordings,
      other.recordings.map((r) => ({ id: r.provider_recording_id, type: r.recording_type })),
      other.recordings[0]?.observed_at ?? canonical.started_at,
    ),
    sources: unionSources(canonical.sources, other.sources),
    provider_last_modified_at: latest([
      canonical.provider_last_modified_at,
      other.provider_last_modified_at,
    ]),
    terminal: canonical.terminal || other.terminal,
    max_observed_webhook_sequence: Math.max(
      canonical.max_observed_webhook_sequence ?? Number.NEGATIVE_INFINITY,
      other.max_observed_webhook_sequence ?? Number.NEGATIVE_INFINITY,
    ) === Number.NEGATIVE_INFINITY
      ? null
      : Math.max(
          canonical.max_observed_webhook_sequence ?? Number.NEGATIVE_INFINITY,
          other.max_observed_webhook_sequence ?? Number.NEGATIVE_INFINITY,
        ),
  };
}

function mergeParty(a: ProjectedParty, b: ProjectedParty): ProjectedParty {
  const newer =
    (b.last_webhook_sequence ?? -1) >= (a.last_webhook_sequence ?? -1) ? b : a;
  const older = newer === a ? b : a;
  return {
    ...older,
    ...newer,
    last_webhook_sequence: Math.max(a.last_webhook_sequence ?? -1, b.last_webhook_sequence ?? -1) < 0
      ? null
      : Math.max(a.last_webhook_sequence ?? -1, b.last_webhook_sequence ?? -1),
    last_event_at: latest([a.last_event_at, b.last_event_at]),
    connected: a.connected || b.connected,
    answered_at: earliest([a.answered_at, b.answered_at]),
    terminal_at: earliest([a.terminal_at, b.terminal_at]),
    terminal_status: newer.terminal_status ?? older.terminal_status,
    role: newer.role !== "unknown" ? newer.role : older.role,
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function finish(
  existing: InteractionProjection | null,
  next: InteractionProjection,
  identity: InteractionIdentity,
  fenced: number,
  stale: boolean,
): ProjectionOutcome {
  const changed = existing === null || !sameProjection(existing, next);
  const existingRecordings = new Set((existing?.recordings ?? []).map((r) => r.provider_recording_id));
  const existingAliases = new Set(
    existing ? aliasesFor(existing).map((a) => `${a.kind}:${a.value}`) : [],
  );
  return {
    next,
    changed,
    created: existing === null,
    newly_terminal: next.terminal && !(existing?.terminal ?? false),
    new_recording_ids: next.recordings
      .map((r) => r.provider_recording_id)
      .filter((id) => !existingRecordings.has(id)),
    new_aliases: aliasesFor(identity).filter((a) => !existingAliases.has(`${a.kind}:${a.value}`)),
    fenced_party_events: fenced,
    stale_call_log: stale,
  };
}

function buildExternalParty(
  previous: ProjectedParty | null,
  external: ClassifiedEndpoint | null,
  name: string | null,
  direction: InteractionDirection,
): ProjectedParty | null {
  if (!external && !previous) return null;
  if (!external) return previous;
  return {
    party_id: null,
    last_webhook_sequence: null,
    last_event_at: previous?.last_event_at ?? null,
    role: "external",
    direction: direction === "Inbound" ? "Outbound" : direction === "Outbound" ? "Inbound" : null,
    extension_id: null,
    extension_number: null,
    phone_number_raw: external.raw ?? previous?.phone_number_raw ?? null,
    e164: external.e164 ?? previous?.e164 ?? null,
    name_raw: name ?? previous?.name_raw ?? null,
    connected: previous?.connected ?? false,
    answered_at: previous?.answered_at ?? null,
    terminal_at: previous?.terminal_at ?? null,
    terminal_status: previous?.terminal_status ?? null,
  };
}

function deriveContactType(
  existing: InteractionProjection | null,
  voicemailDeclared: boolean,
): { contact_type: ContactType; contact_type_basis: string | null } {
  // Transcript or Owner evidence (set downstream) always outranks provider rules.
  if (existing && existing.contact_type !== "unknown" && existing.contact_type_basis !== "provider:voicemail") {
    return { contact_type: existing.contact_type, contact_type_basis: existing.contact_type_basis };
  }
  if (voicemailDeclared || existing?.contact_type === "voicemail") {
    return { contact_type: "voicemail", contact_type_basis: "provider:voicemail" };
  }
  return { contact_type: "unknown", contact_type_basis: null };
}

function mergeRecordings(
  existing: ProjectedRecording[],
  incoming: Array<{ id: string; type: string | null }>,
  now: Date,
): ProjectedRecording[] {
  const map = new Map<string, ProjectedRecording>();
  for (const recording of existing) map.set(recording.provider_recording_id, recording);
  for (const recording of incoming) {
    const previous = map.get(recording.id);
    map.set(recording.id, {
      provider_recording_id: recording.id,
      recording_type: previous?.recording_type ?? recording.type,
      observed_at: previous?.observed_at ?? now,
      lead_conversation_id: previous?.lead_conversation_id ?? null,
    });
  }
  return [...map.values()].sort((a, b) => a.provider_recording_id.localeCompare(b.provider_recording_id));
}

function unionSources(existing: CaptureSource[], incoming: CaptureSource[]): CaptureSource[] {
  return uniqueSorted([...existing, ...incoming]) as CaptureSource[];
}

function pickEndpoint(endpoints: ClassifiedEndpoint[]): ClassifiedEndpoint | null {
  return endpoints.find((e) => e.e164) ?? endpoints[0] ?? null;
}

function partyKey(party: ProjectedParty): string {
  if (party.role === "external") return "external";
  if (party.party_id) return `id:${party.party_id}`;
  if (party.extension_id) return `ext:${party.extension_id}`;
  return `anon:${canonicalJson([party.phone_number_raw, party.direction])}`;
}

function orderParties(parties: ProjectedParty[]): ProjectedParty[] {
  return [...parties].sort((a, b) => {
    if (a.role === "external" && b.role !== "external") return -1;
    if (b.role === "external" && a.role !== "external") return 1;
    return partyKey(a).localeCompare(partyKey(b));
  });
}

function compareBySequenceThenTime(a: WebhookPartyObservation, b: WebhookPartyObservation): number {
  if (a.sequence !== null && b.sequence !== null && a.sequence !== b.sequence) return a.sequence - b.sequence;
  if (a.sequence === null && b.sequence !== null) return 1;
  if (b.sequence === null && a.sequence !== null) return -1;
  return (a.event_time ?? a.received_at).getTime() - (b.event_time ?? b.received_at).getTime();
}

function normalizeDirection(value: string | null): PartyDirection {
  if (value === "Inbound" || value === "Outbound") return value;
  return null;
}

function endpointInput(value: Record<string, unknown> | null): {
  phoneNumber: string | null;
  name: string | null;
  extensionId: string | null;
  extensionNumber: string | null;
} {
  return {
    phoneNumber: strOf(value?.phoneNumber),
    name: strOf(value?.name),
    extensionId: strOf(value?.extensionId),
    extensionNumber: strOf(value?.extensionNumber),
  };
}

function msToSeconds(ms: number | null): number | null {
  return ms === null ? null : Math.floor(ms / 1000);
}

function earliest(values: Array<Date | null | undefined>): Date | null {
  let out: Date | null = null;
  for (const v of values) if (v && (!out || v < out)) out = v;
  return out;
}

function latest(values: Array<Date | null | undefined>): Date | null {
  let out: Date | null = null;
  for (const v of values) if (v && (!out || v > out)) out = v;
  return out;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function strOf(value: unknown): string | null {
  return str(value);
}

function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dateOf(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = str(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map(recordOf).filter((v): v is Record<string, unknown> => v !== null);
}
