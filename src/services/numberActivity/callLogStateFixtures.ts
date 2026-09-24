/**
 * Synthetic Detailed Call Log records for the CC-04 provisional/settled gate
 * (`classifyCallLogRecordState`). The shapes follow the production evidence in
 * the Call Log capture completeness specification §2.3: the 24 stored Internal
 * mid-call snapshots (every leg a `PstnToSip` company ring-out, top-level result
 * `Stopped` / `IP Phone Offline`), the 3 `Inbound`/`Accepted` snapshots with a
 * short `Accept` leg, and settled records of every observed result family.
 *
 * Every value is invented: 555-01xx numbers, made-up ids and names. Leg counts,
 * results and durations mirror the observed structure only.
 */
import {
  at,
  callLogRecord,
  inboundConnectedCallLog,
  internalCallLog,
  malformedNumberCallLog,
  outboundMissedCallLog,
  sessionIdOnlyCallLog,
  SYNTHETIC_COMPANY_DID,
  SYNTHETIC_CUSTOMER,
  SYNTHETIC_CUSTOMER_B,
  SYNTHETIC_QUEUE_EXTENSION,
  SYNTHETIC_SALES_DID,
  SYNTHETIC_USER_EXTENSION,
  SYNTHETIC_USER_EXTENSION_B,
  SYNTHETIC_USER_EXTENSION_C,
  transferredCallLog,
  voicemailCallLog,
  withheldMissedCallLog,
} from "./fixtures";

export type CallLogFixture = { name: string; record: Record<string, unknown> };

/** Ring-out targets: the directory's three reps plus extensions the directory does not know. */
const RING_TARGETS = [
  SYNTHETIC_USER_EXTENSION,
  SYNTHETIC_USER_EXTENSION_B,
  SYNTHETIC_USER_EXTENSION_C,
  ...Array.from({ length: 17 }, (_, i) => ({
    id: `9000000003${String(i).padStart(2, "0")}`,
    number: `3${String(i).padStart(2, "0")}`,
    name: `Synthetic Rep ${i + 4}`,
  })),
];

const customerNumber = (i: number) => `+1555010${String(300 + i).padStart(4, "0")}`;

/** `[result, duration seconds, count]` groups, expanded in order. */
type LegGroup = readonly [string, number, number];

/**
 * A company ring-out leg as RingCentral lists it while a queue call rings: the
 * caller id passes through on `from` with the rep's extension id, `to` is the
 * company number with the rep's extension number.
 */
export function ringOutLeg(input: {
  sessionId: string;
  index: number;
  caller: string;
  result: string;
  duration: number;
  start?: Date;
  legType?: "PstnToSip" | "SipToSip";
  recordingId?: string;
}): Record<string, unknown> {
  const rep = RING_TARGETS[input.index % RING_TARGETS.length]!;
  return {
    startTime: (input.start ?? at(6 + input.index * 0.1)).toISOString(),
    duration: input.duration,
    durationMs: input.duration * 1000 + 137,
    type: "Voice",
    internalType: "Sip",
    direction: "Outbound",
    action: "VoIP Call",
    result: input.result,
    ...(input.result === "IP Phone Offline" ? { reason: "No Digital Line" } : {}),
    to: { phoneNumber: SYNTHETIC_COMPANY_DID, extensionNumber: rep.number },
    from: { phoneNumber: input.caller, extensionId: rep.id },
    extension: { id: rep.id },
    telephonySessionId: input.sessionId,
    partyId: `p-${input.sessionId}-${input.index + 2}`,
    transport: "VoIP",
    legType: input.legType ?? "PstnToSip",
    ...(input.recordingId ? { recording: { id: input.recordingId, type: "Automatic" } } : {}),
  };
}

function ringOutLegs(sessionId: string, caller: string, groups: readonly LegGroup[]) {
  const legs: Record<string, unknown>[] = [];
  for (const [result, duration, count] of groups) {
    for (let n = 0; n < count; n += 1) {
      legs.push(ringOutLeg({ sessionId, index: legs.length, caller, result, duration }));
    }
  }
  return legs;
}

/** The inbound caller's `Accept` leg (the answered party's own leg). */
function acceptLeg(sessionId: string, caller: string, result: string, duration: number, recordingId?: string) {
  return {
    startTime: at(0).toISOString(),
    duration,
    durationMs: duration * 1000,
    type: "Voice",
    internalType: "LocalNumber",
    direction: "Inbound",
    action: "Phone Call",
    result,
    to: { phoneNumber: SYNTHETIC_SALES_DID },
    from: { phoneNumber: caller, location: "Somewhere, US" },
    telephonySessionId: sessionId,
    partyId: `p-${sessionId}-1`,
    transport: "PSTN",
    legType: "Accept",
    master: true,
    ...(recordingId ? { recording: { id: recordingId, type: "Automatic" } } : {}),
  };
}

type SnapshotSpec = {
  result: "Stopped" | "IP Phone Offline";
  duration: number;
  legs: readonly LegGroup[];
  /** RingCentral copies the ring-out leg's direction onto the snapshot; a few say Inbound. */
  direction?: "Inbound" | "Outbound";
  /** How the top-level `from` names the rep; the default passes the caller id through. */
  fromShape?: "caller_with_extension" | "extension_number";
};

/**
 * The 24 stored Internal mid-call snapshots of calls that really lasted more
 * than five minutes (spec §2.3, `inspect-provisional-call-log-rows.ts`): top
 * result and duration as stored, legs as `[result, duration, count]`.
 */
export const INTERNAL_SNAPSHOT_SPECS: readonly SnapshotSpec[] = [
  { result: "Stopped", duration: 5, legs: [["Stopped", 5, 3], ["IP Phone Offline", 0, 1], ["Stopped", 5, 1], ["IP Phone Offline", 0, 1], ["Stopped", 5, 8], ["IP Phone Offline", 0, 3]] },
  { result: "IP Phone Offline", duration: 0, legs: [["Stopped", 23, 1], ["IP Phone Offline", 0, 2], ["Stopped", 23, 4], ["IP Phone Offline", 0, 8]] },
  { result: "Stopped", duration: 4, legs: [["Stopped", 4, 7], ["IP Phone Offline", 0, 1], ["Stopped", 4, 3]] },
  { result: "IP Phone Offline", duration: 0, legs: [["Stopped", 3, 8], ["IP Phone Offline", 0, 1]], direction: "Inbound" },
  { result: "Stopped", duration: 2, legs: [["Stopped", 2, 4], ["IP Phone Offline", 0, 1], ["Stopped", 2, 4]] },
  { result: "Stopped", duration: 4, legs: [["Stopped", 4, 1], ["IP Phone Offline", 0, 1], ["Stopped", 4, 7]] },
  { result: "Stopped", duration: 2, legs: [["Stopped", 3, 6], ["IP Phone Offline", 0, 1], ["Stopped", 3, 2], ["Stopped", 2, 2]] },
  { result: "IP Phone Offline", duration: 0, legs: [["IP Phone Offline", 0, 2], ["Stopped", 16, 3], ["Stopped", 2, 2], ["IP Phone Offline", 0, 2], ["Stopped", 9, 3]] },
  { result: "Stopped", duration: 2, legs: [["Stopped", 6, 9], ["IP Phone Offline", 0, 1], ["Stopped", 2, 1]] },
  { result: "Stopped", duration: 3, legs: [["Stopped", 3, 3], ["IP Phone Offline", 0, 1], ["Stopped", 3, 5]], fromShape: "extension_number" },
  { result: "Stopped", duration: 3, legs: [["Stopped", 3, 1], ["IP Phone Offline", 0, 1], ["Stopped", 3, 8], ["IP Phone Offline", 0, 1], ["Stopped", 3, 1]] },
  { result: "IP Phone Offline", duration: 0, legs: [["Stopped", 17, 5], ["IP Phone Offline", 0, 7]] },
  { result: "Stopped", duration: 14, legs: [["Stopped", 14, 1]] },
  { result: "IP Phone Offline", duration: 0, legs: [["Stopped", 15, 1], ["IP Phone Offline", 0, 1], ["Stopped", 15, 6], ["IP Phone Offline", 0, 2], ["Stopped", 15, 2]], direction: "Inbound" },
  { result: "IP Phone Offline", duration: 0, legs: [["IP Phone Offline", 0, 2], ["Stopped", 27, 5], ["IP Phone Offline", 0, 5]] },
  { result: "IP Phone Offline", duration: 0, legs: [["Stopped", 12, 1], ["IP Phone Offline", 0, 1], ["Stopped", 5, 1], ["IP Phone Offline", 0, 1], ["Stopped", 12, 2], ["IP Phone Offline", 0, 2], ["Stopped", 12, 4]] },
  { result: "IP Phone Offline", duration: 0, legs: [["Stopped", 18, 1], ["IP Phone Offline", 0, 1], ["Stopped", 18, 1], ["IP Phone Offline", 0, 1], ["Stopped", 18, 1], ["IP Phone Offline", 0, 2], ["Stopped", 18, 1], ["IP Phone Offline", 0, 1], ["Stopped", 18, 3]] },
  { result: "Stopped", duration: 3, legs: [["Stopped", 4, 1], ["IP Phone Offline", 0, 2], ["Stopped", 4, 5], ["IP Phone Offline", 0, 1], ["Stopped", 4, 3]] },
  { result: "IP Phone Offline", duration: 0, legs: [["IP Phone Offline", 0, 1]] },
  { result: "Stopped", duration: 3, legs: [["Stopped", 3, 3], ["IP Phone Offline", 0, 1], ["Stopped", 3, 7]], fromShape: "extension_number" },
  { result: "Stopped", duration: 6, legs: [["Stopped", 6, 1]], direction: "Inbound" },
  { result: "Stopped", duration: 5, legs: [["Stopped", 5, 6], ["IP Phone Offline", 0, 1], ["Stopped", 5, 3], ["IP Phone Offline", 0, 1], ["Stopped", 5, 1]] },
  { result: "IP Phone Offline", duration: 0, legs: [["Stopped", 22, 1], ["Stopped", 21, 1], ["IP Phone Offline", 0, 2], ["Stopped", 21, 3], ["IP Phone Offline", 0, 5]] },
  { result: "Stopped", duration: 2, legs: [["Stopped", 3, 3], ["IP Phone Offline", 0, 1], ["Stopped", 3, 6], ["Stopped", 2, 3]] },
];

/** A stored-shape Internal mid-call snapshot: every leg a company ring-out. */
export function internalSnapshotRecord(index: number, overrides: { sessionId?: string; caller?: string; lastModifiedTime?: Date } = {}) {
  const spec = INTERNAL_SNAPSHOT_SPECS[index]!;
  const sessionId = overrides.sessionId ?? `s-snapshot-${index + 1}`;
  const caller = overrides.caller ?? customerNumber(index);
  const firstRep = RING_TARGETS[0]!;
  const from =
    spec.fromShape === "extension_number"
      ? { extensionNumber: firstRep.number, extensionId: firstRep.id, name: firstRep.name }
      : { phoneNumber: caller, extensionId: firstRep.id };
  return callLogRecord({
    id: `cl-${sessionId}`,
    telephonySessionId: sessionId,
    direction: spec.direction ?? "Outbound",
    result: spec.result,
    startTime: at(6),
    duration: spec.duration,
    from,
    to: { phoneNumber: SYNTHETIC_COMPANY_DID, extensionNumber: firstRep.number },
    legs: ringOutLegs(sessionId, caller, spec.legs),
    // Published within a minute of the unanswered ring-out legs ending.
    lastModifiedTime: overrides.lastModifiedTime ?? at(40),
    action: "VoIP Call",
  });
}

export function internalSnapshotFixtures(): CallLogFixture[] {
  return INTERNAL_SNAPSHOT_SPECS.map((spec, i) => ({
    name: `snapshot ${i + 1}: ${spec.direction ?? "Outbound"} ${spec.result}, ${spec.legs.reduce((n, g) => n + g[2], 0)} ring-out legs`,
    record: internalSnapshotRecord(i),
  }));
}

/**
 * The snapshot shape seen live on 2026-09-24 (read-only watch, two queue calls
 * observed as snapshot then final): top-level `direction: "Outbound"`, result
 * `Stopped`, a PSTN-shaped `from` with no extension id, `to` naming only the
 * rep's extension number, no recording, 17 `PstnToSip` ring-out legs and no
 * `Accept` leg. The final version keeps the record id, moves `startTime`
 * earlier, becomes `Inbound`/`Accepted` with `Accept` legs, one connected
 * ring-out leg and a recording.
 */
export function liveSnapshotRecord(n: 1 | 2, sessionId = `s-live-snapshot-${n}`) {
  const caller = customerNumber(50 + n);
  const groups: readonly LegGroup[] = n === 1
    ? [["Stopped", 18, 1], ["IP Phone Offline", 0, 1], ["Stopped", 18, 1], ["IP Phone Offline", 0, 1], ["Stopped", 17, 11], ["Stopped", 7, 2]]
    : [["Stopped", 10, 1], ["IP Phone Offline", 0, 1], ["Stopped", 10, 13], ["IP Phone Offline", 0, 1], ["Stopped", 10, 1]];
  const legs = ringOutLegs(sessionId, caller, groups).map((leg) => ({
    ...leg,
    // The live legs name the rep only by extension number on `to`.
    to: { extensionNumber: (leg.to as { extensionNumber: string }).extensionNumber },
    from: { phoneNumber: caller },
  }));
  return callLogRecord({
    id: `cl-${sessionId}`,
    telephonySessionId: sessionId,
    direction: "Outbound",
    result: "Stopped",
    startTime: at(20),
    duration: n === 1 ? 7 : 10,
    from: { phoneNumber: caller },
    to: { extensionNumber: RING_TARGETS[3]!.number },
    legs,
    lastModifiedTime: at(47),
    action: "VoIP Call",
  });
}

/** The final version of {@link liveSnapshotRecord}: same id, Inbound/Accepted, recorded. */
export function liveFinalRecord(n: 1 | 2, sessionId = `s-live-snapshot-${n}`) {
  const snapshot = liveSnapshotRecord(n, sessionId);
  const caller = customerNumber(50 + n);
  const duration = n === 1 ? 139 : 63;
  const recordingId = `rec-${sessionId}-1`;
  const accepts = Array.from({ length: n === 1 ? 1 : 2 }, () => acceptLeg(sessionId, caller, "Accepted", duration, recordingId));
  const connected = ringOutLeg({ sessionId, index: 30, caller, result: "Call connected", duration: duration - 7, recordingId });
  return callLogRecord({
    id: String(snapshot.id),
    telephonySessionId: sessionId,
    direction: "Inbound",
    result: "Accepted",
    startTime: at(0),
    duration,
    from: { phoneNumber: caller },
    to: { phoneNumber: SYNTHETIC_SALES_DID },
    recording: { id: recordingId },
    legs: [...accepts, ...(snapshot.legs as Record<string, unknown>[]), connected],
    lastModifiedTime: at(duration + 20),
    action: "Phone Call",
  });
}

export function liveSnapshotFixtures(): CallLogFixture[] {
  return [
    { name: "live snapshot 1: Outbound Stopped 7 s, PSTN from, 17 ring-out legs", record: liveSnapshotRecord(1) },
    { name: "live snapshot 2: Outbound Stopped 10 s, PSTN from, 17 ring-out legs", record: liveSnapshotRecord(2) },
  ];
}

/**
 * The three `Inbound`/`Accepted` snapshots with a short `Accept` leg plus the
 * ring-out legs. Deliberately settled: indistinguishable from a genuine short
 * answered queue call (spec §6.4 "Deliberately not gated").
 */
export function acceptedSnapshotFixtures(): CallLogFixture[] {
  const build = (n: number, acceptSeconds: number, groups: readonly LegGroup[], connectedLeg?: number) => {
    const sessionId = `s-accepted-snapshot-${n}`;
    const caller = customerNumber(40 + n);
    const legs = [acceptLeg(sessionId, caller, "Accepted", acceptSeconds), ...ringOutLegs(sessionId, caller, groups)];
    if (connectedLeg !== undefined) {
      legs.push(ringOutLeg({ sessionId, index: legs.length, caller, result: "Call connected", duration: connectedLeg }));
    }
    return callLogRecord({
      id: `cl-${sessionId}`,
      telephonySessionId: sessionId,
      direction: "Inbound",
      result: "Accepted",
      startTime: at(0),
      duration: acceptSeconds,
      from: { phoneNumber: caller, location: "Somewhere, US" },
      to: { phoneNumber: SYNTHETIC_SALES_DID },
      legs,
      lastModifiedTime: at(acceptSeconds + 45),
    });
  };
  return [
    { name: "accepted snapshot: Accept 18 s + 3 Stopped + 6 IP Phone Offline", record: build(1, 18, [["Stopped", 15, 3], ["IP Phone Offline", 0, 6]]) },
    { name: "accepted snapshot: Accept 34 s + ring-outs + a connected leg", record: build(2, 34, [["Stopped", 2, 11]], 26) },
    { name: "accepted snapshot: Accept 0 s + ring-outs", record: build(3, 0, [["IP Phone Offline", 0, 2], ["Stopped", 27, 5], ["IP Phone Offline", 0, 10]]) },
  ];
}

/** An outbound record from a rep's DID to a customer, one `SipToPstn` leg. */
function outboundRecord(n: number, result: string, duration: number, extra: { recording?: boolean; transferLeg?: number } = {}) {
  const sessionId = `s-settled-out-${n}`;
  const customer = customerNumber(60 + n);
  const legs: Record<string, unknown>[] = [
    {
      startTime: at(0).toISOString(),
      duration,
      type: "Voice",
      direction: "Outbound",
      action: "VoIP Call",
      result,
      legType: "SipToPstnUnmetered",
      master: true,
      from: { phoneNumber: SYNTHETIC_COMPANY_DID, extensionId: SYNTHETIC_USER_EXTENSION.id },
      to: { phoneNumber: customer },
      extension: { id: SYNTHETIC_USER_EXTENSION.id },
      ...(extra.recording ? { recording: { id: `rec-${sessionId}`, type: "Automatic" } } : {}),
    },
  ];
  if (extra.transferLeg !== undefined) {
    legs.push({
      startTime: at(duration).toISOString(),
      duration: extra.transferLeg,
      type: "Voice",
      direction: "Outbound",
      action: "VoIP Call",
      result,
      legType: "TransferCall",
      from: { phoneNumber: SYNTHETIC_COMPANY_DID, extensionId: SYNTHETIC_USER_EXTENSION.id },
      to: { phoneNumber: customer },
      extension: { id: SYNTHETIC_USER_EXTENSION.id },
    });
  }
  return callLogRecord({
    id: `cl-${sessionId}`,
    telephonySessionId: sessionId,
    direction: "Outbound",
    result,
    startTime: at(0),
    duration,
    from: { phoneNumber: SYNTHETIC_COMPANY_DID, name: SYNTHETIC_USER_EXTENSION.name, extensionId: SYNTHETIC_USER_EXTENSION.id },
    to: { phoneNumber: customer },
    recording: extra.recording ? { id: `rec-${sessionId}` } : null,
    legs,
  });
}

/** An inbound queue call: the caller's `Accept` leg plus ring-out legs, optionally one connected leg. */
function inboundQueueRecord(
  n: number,
  result: string,
  duration: number,
  groups: readonly LegGroup[],
  connected?: { duration: number; recording: boolean },
) {
  const sessionId = `s-settled-in-${n}`;
  const caller = customerNumber(80 + n);
  const recordingId = connected?.recording ? `rec-${sessionId}` : undefined;
  const legs = [acceptLeg(sessionId, caller, result, duration, recordingId), ...ringOutLegs(sessionId, caller, groups)];
  if (connected) {
    legs.push(ringOutLeg({ sessionId, index: legs.length, caller, result: "Call connected", duration: connected.duration, recordingId }));
  }
  return callLogRecord({
    id: `cl-${sessionId}`,
    telephonySessionId: sessionId,
    direction: "Inbound",
    result,
    startTime: at(0),
    duration,
    from: { phoneNumber: caller, location: "Somewhere, US" },
    to: { phoneNumber: SYNTHETIC_SALES_DID },
    recording: recordingId ? { id: recordingId } : null,
    legs,
  });
}

/** Extension-to-extension call with only extension endpoints (no PSTN side). */
function extensionToExtensionRecord(n: number, result: string, duration: number, shape: "sip_to_sip" | "short_dial") {
  const sessionId = `s-settled-internal-${n}`;
  const caller = SYNTHETIC_USER_EXTENSION_B;
  const callee = SYNTHETIC_USER_EXTENSION_C;
  const from = shape === "short_dial"
    ? { phoneNumber: caller.number, name: caller.name }
    : { extensionId: caller.id, extensionNumber: caller.number, name: caller.name };
  const to = shape === "short_dial"
    ? { phoneNumber: callee.number, name: callee.name }
    : { extensionId: callee.id, extensionNumber: callee.number, name: callee.name };
  return callLogRecord({
    id: `cl-${sessionId}`,
    telephonySessionId: sessionId,
    direction: "Outbound",
    result,
    startTime: at(0),
    duration,
    from,
    to,
    legs: [
      { startTime: at(0).toISOString(), duration, direction: "Outbound", action: "VoIP Call", result, legType: "SipToSip", master: true, from, to: { ...to, extensionId: callee.id }, extension: { id: caller.id } },
    ],
  });
}

/** Internal call observed as the monitored/queue shapes stored since 09-21 (Accept + Monitoring/SipToPstn legs). */
function internalServiceRecord(n: number, result: string, duration: number, second: "Monitoring" | "SipToPstnMetered") {
  const sessionId = `s-settled-internal-svc-${n}`;
  const rep = SYNTHETIC_USER_EXTENSION;
  return callLogRecord({
    id: `cl-${sessionId}`,
    telephonySessionId: sessionId,
    direction: "Inbound",
    result,
    startTime: at(0),
    duration,
    from: { extensionId: rep.id, extensionNumber: rep.number, name: rep.name },
    to: { extensionId: SYNTHETIC_QUEUE_EXTENSION.id, extensionNumber: SYNTHETIC_QUEUE_EXTENSION.number, name: SYNTHETIC_QUEUE_EXTENSION.name },
    legs: [
      { startTime: at(0).toISOString(), duration, direction: "Inbound", action: "Phone Call", result, legType: "Accept", master: true, from: { extensionNumber: rep.number }, to: { extensionNumber: SYNTHETIC_QUEUE_EXTENSION.number } },
      { startTime: at(0).toISOString(), duration, direction: "Outbound", action: second === "Monitoring" ? "Monitoring" : "VoIP Call", result: "Call connected", legType: second, from: { extensionId: rep.id }, to: { extensionNumber: SYNTHETIC_QUEUE_EXTENSION.number }, extension: { id: rep.id } },
    ],
  });
}

/**
 * Settled records of every result family observed since 09-21 (§2.3): outbound
 * `Call connected`/`Hang Up`/`Call Failed`/`Wrong Number`/`Busy`/`Rejected`/`No Answer`,
 * inbound `Call connected`/`Accepted`/`Missed`/`Voicemail`/`Hang Up`, genuine
 * internal calls (extension-to-extension, monitoring, internal queue misses),
 * withheld and malformed callers, transfers, and the final versions of snapshots.
 */
export function settledFixtures(): CallLogFixture[] {
  const out: CallLogFixture[] = [
    { name: "outbound Call connected", record: outboundRecord(1, "Call connected", 312, { recording: true }) },
    { name: "outbound Call connected 2 s with a TransferCall leg", record: outboundRecord(2, "Call connected", 2, { recording: true, transferLeg: 49 }) },
    { name: "outbound Hang Up 0 s", record: outboundRecord(3, "Hang Up", 0) },
    { name: "outbound Hang Up 40 s", record: outboundRecord(4, "Hang Up", 40) },
    { name: "outbound Call Failed", record: outboundRecord(5, "Call Failed", 1) },
    { name: "outbound Wrong Number", record: outboundRecord(6, "Wrong Number", 1) },
    { name: "outbound Busy", record: outboundRecord(7, "Busy", 0) },
    { name: "outbound Rejected", record: outboundRecord(8, "Rejected", 0) },
    { name: "outbound No Answer (fixtures.ts)", record: outboundMissedCallLog("s-settled-noanswer") },
    { name: "outbound No Answer 6 s", record: outboundRecord(9, "No Answer", 6) },
    { name: "inbound queue Call connected (fixtures.ts)", record: inboundConnectedCallLog("s-settled-inbound") },
    { name: "inbound Call connected, no legs (list view)", record: sessionIdOnlyCallLog("s-settled-nolegs") },
    { name: "inbound queue Accepted 23 min, final version of a Stopped snapshot", record: inboundQueueRecord(1, "Accepted", 1424, [["Stopped", 3, 8], ["IP Phone Offline", 0, 9]], { duration: 1417, recording: true }) },
    { name: "inbound queue Accepted 46 min, final version of an IP Phone Offline snapshot", record: inboundQueueRecord(2, "Accepted", 2772, [["IP Phone Offline", 0, 4], ["Stopped", 23, 10]], { duration: 2765, recording: true }) },
    { name: "inbound short answered queue call, Accepted 1 s", record: inboundQueueRecord(3, "Accepted", 1, []) },
    { name: "inbound short answered queue call, Accepted 4 s after ring-outs", record: inboundQueueRecord(4, "Accepted", 4, [["Stopped", 2, 5], ["IP Phone Offline", 0, 1]], { duration: 3, recording: false }) },
    { name: "inbound Call connected 28 min with ring-outs", record: inboundQueueRecord(5, "Call connected", 1680, [["Stopped", 5, 6]], { duration: 1675, recording: true }) },
    { name: "genuine missed queue call, Missed 1 s", record: inboundQueueRecord(6, "Missed", 1, []) },
    { name: "genuine missed queue call, Missed 24 s after every ring-out stopped", record: inboundQueueRecord(7, "Missed", 24, [["Stopped", 22, 6], ["IP Phone Offline", 0, 3]]) },
    { name: "genuine queue voicemail after ring-outs", record: inboundQueueRecord(8, "Voicemail", 14, [["Stopped", 4, 1], ["IP Phone Offline", 0, 1]]) },
    { name: "genuine voicemail (fixtures.ts)", record: voicemailCallLog("s-settled-voicemail") },
    { name: "inbound Hang Up while ringing", record: inboundQueueRecord(9, "Hang Up", 9, [["Stopped", 8, 4]]) },
    { name: "inbound Call Failed", record: inboundQueueRecord(10, "Call Failed", 0, []) },
    { name: "inbound transfer, Call connected (fixtures.ts)", record: transferredCallLog("s-settled-transfer") },
    { name: "withheld caller, Missed (fixtures.ts)", record: withheldMissedCallLog("s-settled-withheld") },
    { name: "malformed caller id, Missed (fixtures.ts)", record: malformedNumberCallLog("s-settled-malformed") },
    { name: "internal extension-to-extension Call connected (fixtures.ts)", record: internalCallLog("s-settled-internal") },
    { name: "internal extension-to-extension SipToSip Call connected", record: extensionToExtensionRecord(1, "Call connected", 134, "sip_to_sip") },
    { name: "internal extension-to-extension SipToSip Missed", record: extensionToExtensionRecord(2, "Missed", 12, "sip_to_sip") },
    { name: "internal extension-to-extension short-dial Hang Up", record: extensionToExtensionRecord(3, "Hang Up", 3, "short_dial") },
    { name: "internal monitoring, Call connected", record: internalServiceRecord(1, "Call connected", 25, "Monitoring") },
    { name: "internal queue call, Missed", record: internalServiceRecord(2, "Missed", 2, "SipToPstnMetered") },
    {
      name: "internal call from a company DID to the queue, Missed",
      record: callLogRecord({
        id: "cl-s-settled-did-queue",
        telephonySessionId: "s-settled-did-queue",
        direction: "Inbound",
        result: "Missed",
        startTime: at(0),
        duration: 1,
        from: { phoneNumber: SYNTHETIC_SALES_DID },
        to: { phoneNumber: SYNTHETIC_COMPANY_DID, extensionId: SYNTHETIC_QUEUE_EXTENSION.id },
        legs: [
          { startTime: at(0).toISOString(), duration: 1, direction: "Inbound", action: "Phone Call", result: "Missed", legType: "Accept", master: true, from: { phoneNumber: SYNTHETIC_SALES_DID }, to: { phoneNumber: SYNTHETIC_COMPANY_DID } },
          { startTime: at(0).toISOString(), duration: 1, direction: "Inbound", action: "Phone Call", result: "Missed", legType: "Accept", from: { phoneNumber: SYNTHETIC_SALES_DID }, to: { phoneNumber: SYNTHETIC_COMPANY_DID }, extension: { id: SYNTHETIC_QUEUE_EXTENSION.id } },
        ],
      }),
    },
    {
      name: "inbound Call connected to a second customer number, no ring-outs",
      record: callLogRecord({
        id: "cl-s-settled-direct",
        telephonySessionId: "s-settled-direct",
        direction: "Inbound",
        result: "Call connected",
        startTime: at(0),
        duration: 75,
        from: { phoneNumber: SYNTHETIC_CUSTOMER_B },
        to: { phoneNumber: SYNTHETIC_SALES_DID },
        legs: [acceptLeg("s-settled-direct", SYNTHETIC_CUSTOMER_B, "Call connected", 75)],
      }),
    },
    {
      name: "inbound Accepted to the main number, IVR leg 1 s",
      record: callLogRecord({
        id: "cl-s-settled-ivr",
        telephonySessionId: "s-settled-ivr",
        direction: "Inbound",
        result: "Accepted",
        startTime: at(0),
        duration: 1,
        from: { phoneNumber: SYNTHETIC_CUSTOMER },
        to: { phoneNumber: SYNTHETIC_COMPANY_DID },
        legs: [acceptLeg("s-settled-ivr", SYNTHETIC_CUSTOMER, "Accepted", 1)],
      }),
    },
    { name: "live final version: Inbound Accepted 139 s, one Accept leg + ring-outs", record: liveFinalRecord(1) },
    { name: "live final version: Inbound Accepted 63 s, two Accept legs + ring-outs", record: liveFinalRecord(2) },
  ];
  return out;
}
