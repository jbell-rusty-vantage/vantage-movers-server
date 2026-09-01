import { getGranotBookingReconciliationCaseModel } from "../../models/GranotBookingReconciliationCase";
import {
  getGranotObservationModel,
  type GranotObservationDocument,
} from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getGranotReleaseReconciliationCaseModel } from "../../models/GranotReleaseReconciliationCase";
import { toObjectId } from "../../utils/objectId";
import {
  projectBookingPriorityPairing,
  toBookingPriorityPairingProjection,
  type BookingPriorityPairingJobObservation,
  type BookingPriorityPairingProjection,
} from "./bookingPriorityPairing";
import { GRANOT_LIFECYCLE_ERROR_CODES, GranotLifecycleError } from "./errors";
import { redactCredentialKeys } from "./receiptEvidence";
import type { GranotBookingAction, GranotRouteEventClass } from "./types";

export type BookingIntakeEvidenceAction = "priority_5" | "booked" | "release";
export type CreatingObservationSelection =
  | "preferred_booked"
  | "preferred_release"
  | "latest_creating";

export type BookingIntakeEvidenceItem = {
  observation_id: { toString(): string } | string;
  captured_at: Date | string;
  action: BookingIntakeEvidenceAction;
};

export type CreatingObservationSnapshot = {
  observation_id: string;
  receipt_id: string;
  kind?: GranotObservationDocument["kind"];
  normalization_result?: GranotObservationDocument["normalization_result"];
  route_event_class?: GranotRouteEventClass;
  payload_event_type_raw?: string;
  captured_at: string;
  source_label_raw?: string;
  normalized_source_label?: string;
  identity: GranotObservationDocument["identity"];
  contact: GranotObservationDocument["contact"];
  move: Record<string, unknown>;
  priority: GranotObservationDocument["priority"];
  booking_action: GranotObservationDocument["booking_action"];
  display_money: GranotObservationDocument["display_money"];
  agent_identity: GranotObservationDocument["agent_identity"];
};

export type BookingIntakeCreatingObservation = {
  case_id: string;
  job_no: string;
  normalized_job_no: string;
  observation_id: string;
  receipt_id: string;
  captured_at: string;
  route_event_class?: GranotRouteEventClass;
  payload_event_type_raw?: string;
  booking_action?: GranotBookingAction;
  evidence_action: BookingIntakeEvidenceAction;
  selection: CreatingObservationSelection;
  observation: CreatingObservationSnapshot;
  granot_statement: unknown;
  priority_pairing: BookingPriorityPairingProjection | null;
  paired_priority_5_observation?: CreatingObservationSnapshot;
};

export type CreatingObservationCaseRow = {
  _id: { toString(): string };
  job_no_snapshot: string;
  normalized_job_no: string;
  evidence: BookingIntakeEvidenceItem[];
};

export type CreatingObservationLoaders = {
  findBookingCase(caseId: string): Promise<CreatingObservationCaseRow | null>;
  findReleaseCase(caseId: string): Promise<CreatingObservationCaseRow | null>;
  findObservation(
    observationId: string,
  ): Promise<GranotObservationDocument | null>;
  findReceipt(
    receiptId: string,
  ): Promise<{ payload?: unknown } | null>;
  findJobObservations(
    normalizedJobNo: string,
  ): Promise<BookingPriorityPairingJobObservation[]>;
};

const defaultLoaders: CreatingObservationLoaders = {
  async findBookingCase(caseId) {
    return getGranotBookingReconciliationCaseModel()
      .findById(toObjectId(caseId))
      .select({
        job_no_snapshot: 1,
        normalized_job_no: 1,
        evidence: 1,
      })
      .lean();
  },
  async findReleaseCase(caseId) {
    return getGranotReleaseReconciliationCaseModel()
      .findById(toObjectId(caseId))
      .select({
        job_no_snapshot: 1,
        normalized_job_no: 1,
        evidence: 1,
      })
      .lean();
  },
  async findObservation(observationId) {
    return getGranotObservationModel()
      .findById(toObjectId(observationId))
      .lean();
  },
  async findReceipt(receiptId) {
    return getGranotObservationReceiptModel()
      .findById(toObjectId(receiptId))
      .select({ payload: 1 })
      .lean();
  },
  async findJobObservations(normalizedJobNo) {
    return getGranotObservationModel()
      .find({ "identity.normalized_job_no": normalizedJobNo })
      .select({
        _id: 1,
        receipt_id: 1,
        captured_at: 1,
        route_event_class: 1,
        payload_event_type_raw: 1,
        priority: 1,
        identity: 1,
        booking_action: 1,
      })
      .lean();
  },
};

export function selectCreatingObservationEvidence(
  evidence: BookingIntakeEvidenceItem[],
): { item: BookingIntakeEvidenceItem; selection: CreatingObservationSelection } | null {
  if (evidence.length === 0) return null;
  const booked = evidence
    .filter((item) => item.action === "booked")
    .sort(compareEvidenceNewestFirst)[0];
  if (booked) {
    return { item: booked, selection: "preferred_booked" };
  }
  const released = evidence
    .filter((item) => item.action === "release")
    .sort(compareEvidenceNewestFirst)[0];
  if (released) {
    return { item: released, selection: "preferred_release" };
  }
  const latest = [...evidence].sort(compareEvidenceNewestFirst)[0];
  return latest ? { item: latest, selection: "latest_creating" } : null;
}

export function selectReleaseCreatingObservationEvidence(
  evidence: BookingIntakeEvidenceItem[],
): { item: BookingIntakeEvidenceItem; selection: CreatingObservationSelection } | null {
  if (evidence.length === 0) return null;
  const released = evidence
    .filter((item) => item.action === "release")
    .sort(compareEvidenceNewestFirst)[0];
  if (released) {
    return { item: released, selection: "preferred_release" };
  }
  const latest = [...evidence].sort(compareEvidenceNewestFirst)[0];
  return latest ? { item: latest, selection: "latest_creating" } : null;
}

export async function getBookingIntakeCreatingObservation(
  caseId: string,
  loaders: CreatingObservationLoaders = defaultLoaders,
): Promise<BookingIntakeCreatingObservation | null> {
  const row = await loaders.findBookingCase(caseId);
  if (!row) return null;
  const selected = selectCreatingObservationEvidence(row.evidence);
  if (!selected) return null;
  const observationId = String(selected.item.observation_id);
  const observation = await loaders.findObservation(observationId);
  if (!observation) return null;
  const receipt = await loaders.findReceipt(String(observation.receipt_id));
  const capturedAt = iso(selected.item.captured_at, "creating_observation.captured_at");
  const pairing = await projectCreatingObservationPairing({
    selected,
    observation,
    normalizedJobNo: row.normalized_job_no,
    loaders,
  });
  return {
    case_id: String(row._id),
    job_no: row.job_no_snapshot,
    normalized_job_no: row.normalized_job_no,
    observation_id: observationId,
    receipt_id: String(observation.receipt_id),
    captured_at: capturedAt,
    route_event_class: observation.route_event_class,
    payload_event_type_raw: observation.payload_event_type_raw,
    booking_action: observation.booking_action?.normalized,
    evidence_action: selected.item.action,
    selection: selected.selection,
    observation: projectObservation(observation, capturedAt),
    granot_statement: redactCredentialKeys(receipt?.payload).value,
    priority_pairing: pairing.priority_pairing,
    paired_priority_5_observation: pairing.paired_priority_5_observation,
  };
}

export async function getCancellationIntakeCreatingObservation(
  caseId: string,
  loaders: CreatingObservationLoaders = defaultLoaders,
): Promise<BookingIntakeCreatingObservation | null> {
  const row = await loaders.findReleaseCase(caseId);
  if (!row) return null;
  const selected = selectReleaseCreatingObservationEvidence(row.evidence);
  if (!selected) return null;
  const observationId = String(selected.item.observation_id);
  const observation = await loaders.findObservation(observationId);
  if (!observation) return null;
  const receipt = await loaders.findReceipt(String(observation.receipt_id));
  const capturedAt = iso(selected.item.captured_at, "creating_observation.captured_at");
  return {
    case_id: String(row._id),
    job_no: row.job_no_snapshot,
    normalized_job_no: row.normalized_job_no,
    observation_id: observationId,
    receipt_id: String(observation.receipt_id),
    captured_at: capturedAt,
    route_event_class: observation.route_event_class,
    payload_event_type_raw: observation.payload_event_type_raw,
    booking_action: observation.booking_action?.normalized,
    evidence_action: selected.item.action,
    selection: selected.selection,
    observation: projectObservation(observation, capturedAt),
    granot_statement: redactCredentialKeys(receipt?.payload).value,
    priority_pairing: null,
  };
}

/**
 * Technical case-id lookup: booking case first, then a historical Release case.
 * Owner Intakes only requests booking case ids (list is booking-only), so it
 * never uses the Release fallback. Keep the fallback for
 * `GET .../cases/:id/creating-observation` on a historical Release id.
 */
export async function getIntakeCreatingObservation(
  caseId: string,
  loaders: CreatingObservationLoaders = defaultLoaders,
): Promise<BookingIntakeCreatingObservation | null> {
  return (
    (await getBookingIntakeCreatingObservation(caseId, loaders))
    ?? (await getCancellationIntakeCreatingObservation(caseId, loaders))
  );
}

async function projectCreatingObservationPairing(input: {
  selected: { item: BookingIntakeEvidenceItem; selection: CreatingObservationSelection };
  observation: GranotObservationDocument;
  normalizedJobNo: string;
  loaders: CreatingObservationLoaders;
}): Promise<{
  priority_pairing: BookingPriorityPairingProjection | null;
  paired_priority_5_observation?: CreatingObservationSnapshot;
}> {
  if (
    input.selected.item.action !== "booked" ||
    input.observation.booking_action?.normalized !== "booked" ||
    !input.observation.identity?.normalized_job_no
  ) {
    return { priority_pairing: null };
  }
  const jobObservations = await input.loaders.findJobObservations(input.normalizedJobNo);
  const pairing = projectBookingPriorityPairing({
    creating_booked: input.observation,
    job_observations: jobObservations,
  });
  const projected = toBookingPriorityPairingProjection(pairing);
  if (!pairing.preceding_priority_5) {
    return { priority_pairing: projected };
  }
  const paired = await input.loaders.findObservation(pairing.preceding_priority_5.observation_id);
  return {
    priority_pairing: projected,
    paired_priority_5_observation: paired
      ? projectObservation(paired, pairing.preceding_priority_5.captured_at.toISOString())
      : undefined,
  };
}

function compareEvidenceNewestFirst(
  left: BookingIntakeEvidenceItem,
  right: BookingIntakeEvidenceItem,
): number {
  const byTime = capturedAtMs(right.captured_at) - capturedAtMs(left.captured_at);
  if (byTime !== 0) return byTime;
  return String(right.observation_id).localeCompare(String(left.observation_id));
}

function capturedAtMs(value: Date | string): number {
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) ? time : 0;
}

function iso(value: unknown, field: string): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) {
    throw new GranotLifecycleError(
      `Unable to project ${field}`,
      GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
      400,
    );
  }
  return date.toISOString();
}

function projectObservation(
  observation: GranotObservationDocument,
  fallbackCapturedAt: string,
): CreatingObservationSnapshot {
  return {
    observation_id: String(observation._id),
    receipt_id: String(observation.receipt_id),
    kind: observation.kind,
    normalization_result: observation.normalization_result,
    route_event_class: observation.route_event_class,
    payload_event_type_raw: observation.payload_event_type_raw,
    captured_at: observation.captured_at
      ? iso(observation.captured_at, "creating_observation.observation.captured_at")
      : fallbackCapturedAt,
    source_label_raw: observation.source_label_raw,
    normalized_source_label: observation.normalized_source_label,
    identity: observation.identity ?? {},
    contact: observation.contact ?? {},
    move: asJsonRecord(observation.move),
    priority: observation.priority,
    booking_action: observation.booking_action ?? {},
    display_money: observation.display_money ?? {},
    agent_identity: observation.agent_identity ?? {},
  };
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  return (jsonSafe(value) ?? {}) as Record<string, unknown>;
}

function jsonSafe(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && typeof (value as { toHexString?: unknown }).toHexString === "function") {
    return (value as { toHexString: () => string }).toHexString();
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "__v")
        .map(([key, child]) => [key, jsonSafe(child)]),
    );
  }
  return value;
}
