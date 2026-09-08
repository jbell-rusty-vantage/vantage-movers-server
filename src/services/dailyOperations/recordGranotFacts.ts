import type { DailyOperationsCard, DailyOperationsLinks } from "../../models/DailyOperationsEvent";
import { normalizeBookingAction } from "../granotLifecycle/normalization";
import type { GranotBookingAction, GranotRouteEventClass, SynchronizationOutcome } from "../granotLifecycle/types";
import { buildMetricTouches, titleForKind, type DailyOperationsKind } from "./kinds";
import { recordDailyOperationsFact } from "./recordDailyOperationsFact";

export type GranotBookingActionKnown = GranotBookingAction;

function asId(value: { toString(): string } | string | null | undefined): string | null {
  if (value == null) return null;
  const id = typeof value === "string" ? value : value.toString();
  return id || null;
}

function payloadEventType(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.event_type === "string") {
    return record.event_type;
  }
  const statement = record.granot_statement;
  if (statement && typeof statement === "object" && !Array.isArray(statement)) {
    const nested = (statement as Record<string, unknown>).event_type;
    if (typeof nested === "string") return nested;
  }
  return undefined;
}

/**
 * Same Booked / Release token `normalization.normalizeBookingAction` uses
 * (`Booked`, `Release`, `Releas`). Reads top-level `event_type`, then
 * `granot_statement.event_type`.
 */
export function classifyGranotBookingActionFromPayload(
  payload: unknown,
): GranotBookingActionKnown | null {
  return normalizeBookingAction(payloadEventType(payload)) ?? null;
}

export function granotReceiptDedupeKey(
  receiptId: string,
  routeEventClass: GranotRouteEventClass,
  bookingAction: GranotBookingActionKnown | null,
): string {
  if (routeEventClass === "booking_status_changed" && bookingAction) {
    return `receipt:${receiptId}:${routeEventClass}:${bookingAction}`;
  }
  return `receipt:${receiptId}:${routeEventClass}`;
}

export function granotReceiptKind(
  routeEventClass: GranotRouteEventClass,
  bookingAction: GranotBookingActionKnown | null,
): DailyOperationsKind | null {
  if (routeEventClass === "lead_created") return "granot.lead_created";
  if (routeEventClass === "priority_updated") return "granot.priority_updated";
  if (routeEventClass === "booking_status_changed" && bookingAction === "booked") {
    return "granot.booked";
  }
  if (routeEventClass === "booking_status_changed" && bookingAction === "release") {
    return "granot.release";
  }
  return null;
}

export function granotReceiptMetricTouches(
  kind: DailyOperationsKind | null,
  routeEventClass: GranotRouteEventClass,
): string[] {
  if (kind) return buildMetricTouches(kind);
  if (routeEventClass === "booking_status_changed") {
    return ["webhooks.booking_status_changed", "hourly.webhooks"];
  }
  return [];
}

function granotCard(input: {
  route_event_class?: string;
  booking_action?: GranotBookingActionKnown | null;
  decision?: string | null;
  job_no?: string | null;
}): DailyOperationsCard {
  return {
    ...(input.job_no ? { job_no: input.job_no } : {}),
    granot: {
      ...(input.route_event_class
        ? { route_event_class: input.route_event_class }
        : {}),
      ...(input.booking_action !== undefined
        ? { booking_action: input.booking_action }
        : {}),
      ...(input.decision !== undefined ? { decision: input.decision } : {}),
    },
  };
}

/**
 * Webhook capture receipt card. `parent_receipt_id` is null. No Source
 * Company — capture does not have one yet.
 *
 * Unclassified `booking_status_changed` still increments the class. The
 * closed catalog has no receipt kind for that row; the writer still
 * stores a Granot-lane card so the class count has an insert-win gate.
 */
export async function recordGranotReceiptDailyOperationsFact(input: {
  receipt_id: string;
  route_event_class: GranotRouteEventClass;
  captured_at?: Date;
  payload: unknown;
}): Promise<void> {
  const bookingAction =
    input.route_event_class === "booking_status_changed"
      ? classifyGranotBookingActionFromPayload(input.payload)
      : null;
  const kind = granotReceiptKind(input.route_event_class, bookingAction);
  const metricTouches = granotReceiptMetricTouches(kind, input.route_event_class);
  if (metricTouches.length === 0) return;

  const recordedKind: DailyOperationsKind = kind ?? "granot.booked";
  await recordDailyOperationsFact({
    kind: recordedKind,
    dedupe_key: granotReceiptDedupeKey(
      input.receipt_id,
      input.route_event_class,
      bookingAction,
    ),
    occurred_at: input.captured_at,
    title: kind ? titleForKind(kind) : "Granot booking status changed",
    parent_receipt_id: null,
    entity_type: "GranotObservationReceipt",
    entity_id: input.receipt_id,
    links: { receipt_id: input.receipt_id },
    card: granotCard({
      route_event_class: input.route_event_class,
      booking_action: bookingAction,
    }),
    metric_touches: metricTouches,
  });
}

export type GranotMintedFactPending = {
  source_receipt_id: string;
  decision_id: string;
  job_no?: string | null;
  source_company?: string | null;
  lead_id: string;
  lead_model: "FormLead" | "CallLead";
  occurred_at?: Date;
};

export async function recordGranotMintedDailyOperationsFact(
  pending: GranotMintedFactPending,
): Promise<void> {
  const receiptId = asId(pending.source_receipt_id);
  const decisionId = asId(pending.decision_id);
  const leadId = asId(pending.lead_id);
  if (!receiptId || !decisionId || !leadId) return;

  const links: DailyOperationsLinks = {
    receipt_id: receiptId,
    lead_id: leadId,
    lead_model: pending.lead_model,
  };
  await recordDailyOperationsFact({
    kind: "granot.minted",
    dedupe_key: `decision:${decisionId}:granot.minted`,
    occurred_at: pending.occurred_at,
    title: titleForKind("granot.minted"),
    source_company: pending.source_company ?? null,
    job_no: pending.job_no ?? null,
    parent_receipt_id: receiptId,
    entity_type: "SynchronizationDecision",
    entity_id: decisionId,
    links,
    card: granotCard({
      route_event_class: "lead_created",
      decision: "minted",
      job_no: pending.job_no ?? null,
    }),
    metric_touches: buildMetricTouches("granot.minted"),
  });
}

export type GranotLinkedFactPending = {
  outcome: SynchronizationOutcome;
  source_receipt_id: string;
  decision_id: string;
  job_no?: string | null;
  source_company?: string | null;
  lead_id: string;
  lead_model: "FormLead" | "CallLead";
  occurred_at?: Date;
};

export async function recordGranotLinkedDailyOperationsFact(
  pending: GranotLinkedFactPending,
): Promise<void> {
  if (pending.outcome !== "applied" && pending.outcome !== "linked") return;
  const receiptId = asId(pending.source_receipt_id);
  const decisionId = asId(pending.decision_id);
  const leadId = asId(pending.lead_id);
  if (!receiptId || !decisionId || !leadId) return;

  await recordDailyOperationsFact({
    kind: "granot.linked",
    dedupe_key: `decision:${decisionId}:granot.linked`,
    occurred_at: pending.occurred_at,
    title: titleForKind("granot.linked"),
    source_company: pending.source_company ?? null,
    job_no: pending.job_no ?? null,
    parent_receipt_id: receiptId,
    entity_type: "SynchronizationDecision",
    entity_id: decisionId,
    links: {
      receipt_id: receiptId,
      lead_id: leadId,
      lead_model: pending.lead_model,
    },
    card: granotCard({
      decision: pending.outcome,
      job_no: pending.job_no ?? null,
    }),
    metric_touches: buildMetricTouches("granot.linked"),
  });
}

export function granotProcessorOutcomeKind(
  outcome: SynchronizationOutcome,
): DailyOperationsKind | null {
  if (outcome === "created" || outcome === "applied" || outcome === "linked") {
    return null;
  }
  if (outcome === "pending_match") return "granot.pending_match";
  if (outcome === "unmatched") return "granot.unmatched";
  return "granot.observed";
}

export async function recordGranotProcessorOutcomeDailyOperationsFact(input: {
  receipt_id: string;
  decision_id: string;
  outcome: SynchronizationOutcome;
  job_no?: string | null;
  source_company?: string | null;
  occurred_at?: Date;
}): Promise<void> {
  const kind = granotProcessorOutcomeKind(input.outcome);
  if (!kind) return;
  const receiptId = asId(input.receipt_id);
  const decisionId = asId(input.decision_id);
  if (!receiptId || !decisionId) return;

  await recordDailyOperationsFact({
    kind,
    dedupe_key: `decision:${decisionId}:${kind}`,
    occurred_at: input.occurred_at,
    title: titleForKind(kind),
    source_company: input.source_company ?? null,
    job_no: input.job_no ?? null,
    parent_receipt_id: receiptId,
    entity_type: "SynchronizationDecision",
    entity_id: decisionId,
    links: { receipt_id: receiptId },
    card: granotCard({
      decision: input.outcome,
      job_no: input.job_no ?? null,
    }),
    metric_touches: buildMetricTouches(kind),
  });
}

export async function recordGranotDeadLetterDailyOperationsFact(input: {
  receipt_id: string;
  detail?: string;
  occurred_at?: Date;
}): Promise<void> {
  const receiptId = asId(input.receipt_id);
  if (!receiptId) return;
  await recordDailyOperationsFact({
    kind: "exception.dead_letter",
    dedupe_key: `exception:dead_letter:${receiptId}`,
    occurred_at: input.occurred_at,
    title: titleForKind("exception.dead_letter"),
    parent_receipt_id: receiptId,
    entity_type: "GranotObservationReceipt",
    entity_id: receiptId,
    links: { receipt_id: receiptId },
    card: {
      exception: {
        code: "dead_letter",
        detail: input.detail ?? "Granot Observation Receipt entered dead letter.",
      },
    },
    metric_touches: buildMetricTouches("exception.dead_letter"),
  });
}

export function processTimeBookingMetricTouches(
  bookingAction: GranotBookingActionKnown | null | undefined,
  captureAlreadyClassified: boolean,
): string[] {
  if (captureAlreadyClassified) return [];
  if (bookingAction === "booked") return ["webhooks.booked"];
  if (bookingAction === "release") return ["webhooks.release"];
  return [];
}

export async function recordGranotIntakeDailyOperationsFact(input: {
  case_id: string;
  kind: "opened" | "refreshed";
  revision?: number;
  job_no?: string | null;
  receipt_id: string;
  decision_id?: string | null;
  booking_action?: GranotBookingActionKnown | null;
  captureAlreadyClassified: boolean;
  occurred_at?: Date;
}): Promise<void> {
  const caseId = asId(input.case_id);
  const receiptId = asId(input.receipt_id);
  if (!caseId || !receiptId) return;

  const kind: DailyOperationsKind =
    input.kind === "opened" ? "intake.opened" : "intake.refreshed";
  const dedupeKey =
    input.kind === "opened"
      ? `intake:${caseId}:opened`
      : `intake:${caseId}:refreshed:${input.revision ?? 0}`;
  const bookingTouches = processTimeBookingMetricTouches(
    input.booking_action,
    input.captureAlreadyClassified,
  );

  await recordDailyOperationsFact({
    kind,
    dedupe_key: dedupeKey,
    occurred_at: input.occurred_at,
    title: titleForKind(kind),
    job_no: input.job_no ?? null,
    parent_receipt_id: receiptId,
    entity_type: "GranotBookingReconciliationCase",
    entity_id: caseId,
    links: {
      receipt_id: receiptId,
      intake_case_id: caseId,
    },
    card: granotCard({
      route_event_class: "booking_status_changed",
      booking_action: input.booking_action ?? null,
      decision: input.decision_id ?? null,
      job_no: input.job_no ?? null,
    }),
    metric_touches: [...buildMetricTouches(kind), ...bookingTouches],
  });
}
