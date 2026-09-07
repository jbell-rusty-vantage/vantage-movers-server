import { FORM_LEAD_UNKNOWN_STATE } from "../../models/FormLead";
import { FLORIDA_TIME_ZONE } from "../../utils/easternTime";
import type { DailyOperationsCard, DailyOperationsLinks } from "../../models/DailyOperationsEvent";
import { buildMetricTouches, titleForKind, type DailyOperationsKind } from "./kinds";
import { recordDailyOperationsFact } from "./recordDailyOperationsFact";

const UNKNOWN_STATES = new Set(["", FORM_LEAD_UNKNOWN_STATE]);

export function phoneLast4(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

export function hasPresentZip(zip: string | null | undefined): boolean {
  return Boolean(zip && zip.trim());
}

export function isMissingState(state: string | null | undefined): boolean {
  if (state == null) return true;
  return UNKNOWN_STATES.has(state.trim());
}

export function zipMissSides(input: {
  pickup_zip?: string | null;
  pickup_state?: string | null;
  delivery_zip?: string | null;
  delivery_state?: string | null;
}): { pickup: boolean; delivery: boolean } {
  return {
    pickup: hasPresentZip(input.pickup_zip) && isMissingState(input.pickup_state),
    delivery:
      hasPresentZip(input.delivery_zip) && isMissingState(input.delivery_state),
  };
}

export function formatHeldUntilTime(sendAt: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: FLORIDA_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(sendAt);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value ?? "AM";
  return `${hour}:${minute} ${dayPeriod}`;
}

export function deferredTextTitle(sendAt: Date): string {
  return titleForKind("text.deferred").replace("{time}", formatHeldUntilTime(sendAt));
}

function moveTypeFromLocal(
  local: unknown,
): "local" | "long_distance" | null {
  if (local === true || local === "local") return "local";
  if (local === false || local === "long_distance") return "long_distance";
  return null;
}

function asId(value: { toString(): string } | string | null | undefined): string | null {
  if (value == null) return null;
  const id = typeof value === "string" ? value : value.toString();
  return id || null;
}

function asDate(value: Date | string | null | undefined): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}

export type LeadDailyOperationsSnapshot = {
  reusedExistingLead?: boolean;
  duplicate?: boolean;
  source_company?: string | null;
  lead: {
    _id: { toString(): string };
    name?: string | null;
    phone_number?: string | null;
    ingestion_origin?: string | null;
    pickup_zip?: string | null;
    pickup_state?: string | null;
    destination_zip?: string | null;
    delivery_zip?: string | null;
    delivery_state?: string | null;
    local?: unknown;
    timestamp?: Date | string | null;
    job_no?: string | null;
    created_on_unmatched?: boolean;
    duplicate?: boolean;
    source_company?: string | null;
  };
};

function leadCard(lead: LeadDailyOperationsSnapshot["lead"], zipMiss: {
  pickup: boolean;
  delivery: boolean;
}): DailyOperationsCard {
  const deliveryZip = lead.destination_zip ?? lead.delivery_zip ?? null;
  return {
    customer_name: lead.name ?? null,
    phone_last4: phoneLast4(lead.phone_number),
    ...(lead.job_no ? { job_no: lead.job_no } : {}),
    move: {
      pickup_zip: lead.pickup_zip ?? null,
      pickup_state: lead.pickup_state ?? null,
      delivery_zip: deliveryZip,
      delivery_state: lead.delivery_state ?? null,
      move_type: moveTypeFromLocal(lead.local),
    },
    ...(zipMiss.pickup || zipMiss.delivery ? { zip_miss: zipMiss } : {}),
  };
}

function zipMissFingerprint(
  leadModel: "FormLead" | "CallLead",
  leadId: string,
): string {
  return `exception:zip_missing:${leadModel}:${leadId}`;
}

async function recordZipMissIfNeeded(input: {
  leadModel: "FormLead" | "CallLead";
  leadId: string;
  source_company?: string | null;
  ingestion_origin?: string | null;
  lead_kind: "form" | "call";
  occurred_at?: Date;
  name?: string | null;
  phone?: string | null;
  zipMiss: { pickup: boolean; delivery: boolean };
  pickup_zip?: string | null;
  delivery_zip?: string | null;
}): Promise<void> {
  if (!input.zipMiss.pickup && !input.zipMiss.delivery) return;
  const sides = [
    input.zipMiss.pickup ? `pickup ${input.pickup_zip ?? ""}`.trim() : null,
    input.zipMiss.delivery ? `delivery ${input.delivery_zip ?? ""}`.trim() : null,
  ].filter(Boolean);
  await recordDailyOperationsFact({
    kind: "exception.zip_missing",
    dedupe_key: zipMissFingerprint(input.leadModel, input.leadId),
    occurred_at: input.occurred_at,
    title: titleForKind("exception.zip_missing"),
    source_company: input.source_company ?? null,
    ingestion_origin: input.ingestion_origin ?? null,
    lead_kind: input.lead_kind,
    entity_type: input.leadModel,
    entity_id: input.leadId,
    links: { lead_id: input.leadId, lead_model: input.leadModel },
    card: {
      customer_name: input.name ?? null,
      phone_last4: phoneLast4(input.phone),
      zip_miss: input.zipMiss,
      exception: {
        code: "zip_missing",
        detail: `ZIP did not produce a state (${sides.join("; ")})`,
      },
    },
    metric_touches: buildMetricTouches("exception.zip_missing"),
  });
}

export async function recordFormLeadDailyOperationsFact(
  pending: LeadDailyOperationsSnapshot,
): Promise<void> {
  if (pending.reusedExistingLead) return;
  const lead = pending.lead;
  const leadId = lead._id.toString();
  const sourceCompany = pending.source_company ?? lead.source_company ?? null;
  const origin = lead.ingestion_origin ?? null;
  const duplicate = pending.duplicate === true || lead.duplicate === true;
  const kind: DailyOperationsKind = duplicate
    ? "form_lead.duplicate"
    : "form_lead.created";
  const deliveryZip = lead.destination_zip ?? lead.delivery_zip ?? null;
  const zipMiss = zipMissSides({
    pickup_zip: lead.pickup_zip,
    pickup_state: lead.pickup_state,
    delivery_zip: deliveryZip,
    delivery_state: lead.delivery_state,
  });
  const occurredAt = asDate(lead.timestamp);

  await recordDailyOperationsFact({
    kind,
    dedupe_key: `form_lead:${leadId}:${duplicate ? "duplicate" : "created"}`,
    occurred_at: occurredAt,
    title: titleForKind(kind),
    source_company: sourceCompany,
    ingestion_origin: origin,
    lead_kind: "form",
    job_no: lead.job_no ?? null,
    entity_type: "FormLead",
    entity_id: leadId,
    links: { lead_id: leadId, lead_model: "FormLead" },
    card: leadCard(lead, zipMiss),
    metric_touches: buildMetricTouches(kind, {
      origin,
      sourceCompany,
    }),
  });

  await recordZipMissIfNeeded({
    leadModel: "FormLead",
    leadId,
    source_company: sourceCompany,
    ingestion_origin: origin,
    lead_kind: "form",
    occurred_at: occurredAt,
    name: lead.name,
    phone: lead.phone_number,
    zipMiss,
    pickup_zip: lead.pickup_zip,
    delivery_zip: deliveryZip,
  });
}

export async function recordCallLeadDailyOperationsFact(
  pending: LeadDailyOperationsSnapshot,
): Promise<void> {
  const lead = pending.lead;
  const leadId = lead._id.toString();
  const sourceCompany = pending.source_company ?? lead.source_company ?? null;
  const origin = lead.ingestion_origin ?? null;
  const unmatched = lead.created_on_unmatched === true;
  const duplicate = pending.duplicate === true || lead.duplicate === true;
  const kind: DailyOperationsKind = unmatched
    ? "call_lead.unmatched"
    : duplicate
      ? "call_lead.duplicate"
      : "call_lead.created";
  const suffix = unmatched ? "unmatched" : duplicate ? "duplicate" : "created";
  const deliveryZip = lead.delivery_zip ?? lead.destination_zip ?? null;
  const zipMiss = zipMissSides({
    pickup_zip: lead.pickup_zip,
    pickup_state: lead.pickup_state,
    delivery_zip: deliveryZip,
    delivery_state: lead.delivery_state,
  });
  const occurredAt = asDate(lead.timestamp);

  await recordDailyOperationsFact({
    kind,
    dedupe_key: `call_lead:${leadId}:${suffix}`,
    occurred_at: occurredAt,
    title: titleForKind(kind),
    source_company: sourceCompany,
    ingestion_origin: origin,
    lead_kind: "call",
    job_no: lead.job_no ?? null,
    entity_type: "CallLead",
    entity_id: leadId,
    links: { lead_id: leadId, lead_model: "CallLead" },
    card: leadCard(lead, zipMiss),
    metric_touches: buildMetricTouches(kind, {
      origin,
      sourceCompany,
    }),
  });

  await recordZipMissIfNeeded({
    leadModel: "CallLead",
    leadId,
    source_company: sourceCompany,
    ingestion_origin: origin,
    lead_kind: "call",
    occurred_at: occurredAt,
    name: lead.name,
    phone: lead.phone_number,
    zipMiss,
    pickup_zip: lead.pickup_zip,
    delivery_zip: deliveryZip,
  });
}

export type LeadMessageFactSnapshot = {
  _id: { toString(): string };
  to?: string | null;
  form_lead?: { toString(): string } | null;
  lead_ref?: {
    model?: "FormLead" | "CallLead" | null;
    id?: { toString(): string } | null;
  } | null;
  purpose?: string | null;
  status?: string | null;
  skip_reason?: string | null;
  origin?: string | null;
};

function messageLinks(message: LeadMessageFactSnapshot): DailyOperationsLinks {
  const leadId =
    asId(message.form_lead) ?? asId(message.lead_ref?.id) ?? undefined;
  const leadModel: "FormLead" | "CallLead" | undefined = message.lead_ref?.model
    ? message.lead_ref.model
    : message.form_lead
      ? "FormLead"
      : undefined;
  return {
    message_id: message._id.toString(),
    ...(leadId ? { lead_id: leadId } : {}),
    ...(leadModel ? { lead_model: leadModel } : {}),
  };
}

function textCard(input: {
  message: LeadMessageFactSnapshot;
  status: string;
  deferred: boolean;
  sendAt?: Date | null;
}): DailyOperationsCard {
  return {
    phone_last4: phoneLast4(input.message.to),
    text: {
      ...(input.message.purpose ? { purpose: input.message.purpose } : {}),
      status: input.status,
      deferred: input.deferred,
      ...(input.sendAt ? { send_at: input.sendAt.toISOString() } : {}),
      ...(input.message.skip_reason
        ? { skip_reason: input.message.skip_reason }
        : {}),
    },
  };
}

export async function recordLeadMessageAfterTwilioAccept(input: {
  message: LeadMessageFactSnapshot;
  sendAt?: Date | null;
  status: string;
}): Promise<void> {
  const messageId = input.message._id.toString();
  const sendAt = input.sendAt ?? null;
  if (sendAt) {
    await recordDailyOperationsFact({
      kind: "text.deferred",
      dedupe_key: `message:${messageId}:deferred`,
      title: deferredTextTitle(sendAt),
      entity_type: "LeadMessage",
      entity_id: messageId,
      links: messageLinks(input.message),
      card: textCard({
        message: input.message,
        status: input.status,
        deferred: true,
        sendAt,
      }),
      metric_touches: buildMetricTouches("text.deferred"),
    });
    return;
  }

  await recordDailyOperationsFact({
    kind: "text.sent",
    dedupe_key: `message:${messageId}:successful`,
    title: titleForKind("text.sent"),
    entity_type: "LeadMessage",
    entity_id: messageId,
    links: messageLinks(input.message),
    card: textCard({
      message: input.message,
      status: input.status,
      deferred: false,
    }),
    metric_touches: buildMetricTouches("text.sent"),
  });
}

export async function recordLeadMessageAfterStatusCallback(input: {
  message: LeadMessageFactSnapshot;
  providerStatus: string;
  applied: boolean;
}): Promise<void> {
  if (!input.applied) return;
  const messageId = input.message._id.toString();
  const status = input.providerStatus.toLowerCase();
  if (status === "sent" || status === "delivered") {
    await recordDailyOperationsFact({
      kind: "text.sent",
      dedupe_key: `message:${messageId}:successful`,
      title: titleForKind("text.sent"),
      entity_type: "LeadMessage",
      entity_id: messageId,
      links: messageLinks(input.message),
      card: textCard({
        message: input.message,
        status,
        deferred: false,
      }),
      metric_touches: buildMetricTouches("text.sent"),
    });
    return;
  }
  if (status === "failed" || status === "undelivered" || status === "canceled") {
    await recordDailyOperationsFact({
      kind: "text.failed",
      dedupe_key: `message:${messageId}:failed`,
      title: titleForKind("text.failed"),
      entity_type: "LeadMessage",
      entity_id: messageId,
      links: messageLinks(input.message),
      card: textCard({
        message: input.message,
        status,
        deferred: false,
      }),
      metric_touches: buildMetricTouches("text.failed"),
    });
  }
}

export async function recordLeadMessageSkipped(
  message: LeadMessageFactSnapshot,
): Promise<void> {
  const messageId = message._id.toString();
  await recordDailyOperationsFact({
    kind: "text.skipped",
    dedupe_key: `message:${messageId}:skipped`,
    title: titleForKind("text.skipped"),
    entity_type: "LeadMessage",
    entity_id: messageId,
    links: messageLinks(message),
    card: textCard({
      message,
      status: "skipped",
      deferred: false,
    }),
    metric_touches: buildMetricTouches("text.skipped"),
  });
}

export async function recordBookingDailyOperationsFact(input: {
  bookingId: string;
  bookingKind: string;
  employeePending?: boolean;
  customer_name?: string | null;
  phone?: string | null;
  job_no?: string | null;
  source_company?: string | null;
  lead_id?: string | null;
  lead_model?: "FormLead" | "CallLead" | null;
  occurred_at?: Date;
}): Promise<void> {
  const kind: DailyOperationsKind = input.employeePending
    ? "booking.employee_pending"
    : "booking.created";
  const leadModel = input.lead_model ?? undefined;
  const leadId = input.lead_id ?? undefined;
  await recordDailyOperationsFact({
    kind,
    dedupe_key: `booking:${input.bookingId}:created`,
    occurred_at: input.occurred_at,
    title: titleForKind(kind),
    source_company: input.source_company ?? null,
    job_no: input.job_no ?? null,
    entity_type: "BookedLead",
    entity_id: input.bookingId,
    links: {
      booking_id: input.bookingId,
      ...(leadId ? { lead_id: leadId } : {}),
      ...(leadModel ? { lead_model: leadModel } : {}),
    },
    card: {
      customer_name: input.customer_name ?? null,
      phone_last4: phoneLast4(input.phone),
      job_no: input.job_no ?? null,
      booking_kind: input.bookingKind,
    },
    metric_touches: buildMetricTouches(kind, {
      bookingKind: input.employeePending ? undefined : input.bookingKind,
    }),
  });
}

export async function recordCancellationDailyOperationsFact(input: {
  cancellationId: string;
  bookingId?: string | null;
  customer_name?: string | null;
  phone?: string | null;
  job_no?: string | null;
  source_company?: string | null;
  lead_id?: string | null;
  lead_model?: "FormLead" | "CallLead" | null;
  occurred_at?: Date;
}): Promise<void> {
  const leadModel = input.lead_model ?? undefined;
  const leadId = input.lead_id ?? undefined;
  await recordDailyOperationsFact({
    kind: "cancellation.created",
    dedupe_key: `cancellation:${input.cancellationId}:created`,
    occurred_at: input.occurred_at,
    title: titleForKind("cancellation.created"),
    source_company: input.source_company ?? null,
    job_no: input.job_no ?? null,
    entity_type: "CancelledLead",
    entity_id: input.cancellationId,
    links: {
      cancellation_id: input.cancellationId,
      ...(input.bookingId ? { booking_id: input.bookingId } : {}),
      ...(leadId ? { lead_id: leadId } : {}),
      ...(leadModel ? { lead_model: leadModel } : {}),
    },
    card: {
      customer_name: input.customer_name ?? null,
      phone_last4: phoneLast4(input.phone),
      job_no: input.job_no ?? null,
    },
    metric_touches: buildMetricTouches("cancellation.created"),
  });
}

export async function recordCrmFailedDailyOperationsFact(input: {
  leadId: string;
  leadModel?: "FormLead" | "CallLead";
  customer_name?: string | null;
  phone?: string | null;
  source_company?: string | null;
  detail: string;
}): Promise<void> {
  const leadModel = input.leadModel ?? "FormLead";
  await recordDailyOperationsFact({
    kind: "exception.crm_failed",
    dedupe_key: `exception:crm_failed:${leadModel}:${input.leadId}`,
    title: titleForKind("exception.crm_failed"),
    source_company: input.source_company ?? null,
    lead_kind: leadModel === "CallLead" ? "call" : "form",
    entity_type: leadModel,
    entity_id: input.leadId,
    links: { lead_id: input.leadId, lead_model: leadModel },
    card: {
      customer_name: input.customer_name ?? null,
      phone_last4: phoneLast4(input.phone),
      exception: {
        code: "crm_failed",
        detail: input.detail,
      },
    },
    metric_touches: buildMetricTouches("exception.crm_failed"),
  });
}

export async function recordAdoptionConflictDailyOperationsFact(input: {
  telephonySessionId: string;
  source_company?: string | null;
  detail?: string;
}): Promise<void> {
  await recordDailyOperationsFact({
    kind: "exception.adoption_conflict",
    dedupe_key: `exception:adoption_conflict:ringcentral:${input.telephonySessionId}`,
    title: titleForKind("exception.adoption_conflict"),
    source_company: input.source_company ?? null,
    lead_kind: "call",
    entity_type: "RingCentralCall",
    entity_id: input.telephonySessionId,
    card: {
      exception: {
        code: "adoption_conflict",
        detail:
          input.detail ??
          "Qualified RingCentral call found multiple Granot Call Lead convergence candidates.",
      },
    },
    metric_touches: buildMetricTouches("exception.adoption_conflict"),
  });
}
