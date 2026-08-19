import mongoose from "mongoose";
import { toObjectId } from "../../utils/objectId";
import {
  getGranotObservationModel,
  type GranotObservationDocument,
} from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { assertReceiptChannelShape } from "../../models/granotLifecycleSchemas";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import {
  hasControlOrBidiCharacters,
  normalizeGranotSourceLabel,
} from "./sourceLabel";
import { isRecognizedApplyItemHint } from "./applyItem";
import type {
  ChannelOperationKind,
  GranotBookingAction,
  GranotObservationKind,
  GranotRouteEventClass,
  NormalizationIssueCode,
  NormalizationResult,
  ObservationChannel,
} from "./types";

export const VANTAGE_BUSINESS_TIMEZONE = "America/New_York";

export const NORMALIZATION_FIELD_BOUNDS = {
  source_label: 200,
  job_no: 64,
  form_ref: 128,
  person_name: 100,
  phone: 32,
  email: 254,
  city: 100,
  state_raw: 16,
  zip: 16,
  service_type: 64,
  move_size: 64,
  cubic_feet: 32,
  money: 32,
  agent: 100,
  event_type: 64,
  provider_type: 32,
  move_date: 16,
} as const;

export const PRIORITY_BROAD_ENRICHMENT_CANONICALS = ["1", "5"] as const;

const PRIORITY_STRING = /^[0-9]{1,12}$/;
const MOVE_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const MONEY = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATE = /^[A-Z]{2}$/;
const FORM_REF_ABSENT = /^(not provided|not_provided)$/i;

export class ObservationIntegrityError extends Error {
  readonly code = "GRANOT_OBSERVATION_INTEGRITY_CONFLICT";

  constructor(readonly receipt_id: string) {
    super("Persisted Observation does not match the current normalization candidate");
    this.name = "ObservationIntegrityError";
  }
}

export type NormalizationReceiptInput = {
  _id?: mongoose.Types.ObjectId | string;
  observation_channel: ObservationChannel;
  captured_at: Date;
  route_event_class?: GranotRouteEventClass;
  channel_operation_kind?: ChannelOperationKind;
  channel_operation_id?: string;
  payload_schema_hint?: string;
  payload: unknown;
};

export type NormalizedObservationIssue = {
  code: NormalizationIssueCode;
  path?: string;
  severity: "warning" | "error";
};

export type NormalizedObservationCandidate = {
  schema_version: 1;
  kind: GranotObservationKind;
  normalization_result: NormalizationResult;
  route_event_class?: GranotRouteEventClass;
  payload_event_type_raw?: string;
  source_label_raw?: string;
  normalized_source_label?: string;
  captured_at: Date;
  identity: GranotObservationDocument["identity"];
  contact: GranotObservationDocument["contact"];
  move: GranotObservationDocument["move"];
  priority: GranotObservationDocument["priority"];
  booking_action: GranotObservationDocument["booking_action"];
  display_money: GranotObservationDocument["display_money"];
  agent_identity: GranotObservationDocument["agent_identity"];
  provider_context: GranotObservationDocument["provider_context"];
  issues: NormalizedObservationIssue[];
};

export type ObservationStore = {
  findByReceiptId(
    receiptId: mongoose.Types.ObjectId,
  ): Promise<(GranotObservationDocument & { receipt_id: mongoose.Types.ObjectId }) | null>;
  insert(
    document: NormalizedObservationCandidate & { receipt_id: mongoose.Types.ObjectId },
  ): Promise<GranotObservationDocument>;
};

export type UpsertGranotObservationInput =
  | { receipt_id: string }
  | { receipt: NormalizationReceiptInput & { _id: mongoose.Types.ObjectId | string } };

export type UpsertGranotObservationResult = {
  observation: GranotObservationDocument;
  created: boolean;
};

type IssueCollector = NormalizedObservationIssue[];

function addIssue(
  issues: IssueCollector,
  code: NormalizationIssueCode,
  severity: "warning" | "error",
  path?: string,
): void {
  if (issues.some((issue) => issue.code === code && issue.path === path)) {
    return;
  }
  issues.push(path ? { code, severity, path } : { code, severity });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isJsonScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function hasControlOrBidi(value: string): boolean {
  return hasControlOrBidiCharacters(value);
}

function readStringScalar(
  value: unknown,
  max: number,
): { raw?: string; overBound: boolean; invalid: boolean } {
  if (value === undefined) {
    return { overBound: false, invalid: false };
  }
  if (typeof value !== "string") {
    return { overBound: false, invalid: true };
  }
  if (value.length > max) {
    return { raw: value.slice(0, max), overBound: true, invalid: true };
  }
  return { raw: value, overBound: false, invalid: false };
}

function firstPresent(object: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (object[key] !== undefined) {
      return object[key];
    }
  }
  return undefined;
}

function normalizeLookupLabel(raw: string): string | undefined {
  return normalizeGranotSourceLabel(raw);
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function timezoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  return asUtc - instant.getTime();
}

export function calendarDateInBusinessTimezone(
  year: number,
  month: number,
  day: number,
): Date | undefined {
  if (!isRealCalendarDate(year, month, day)) {
    return undefined;
  }
  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0);
  let instant = new Date(
    utcMidnight - timezoneOffsetMs(new Date(utcMidnight), VANTAGE_BUSINESS_TIMEZONE),
  );
  instant = new Date(
    utcMidnight - timezoneOffsetMs(instant, VANTAGE_BUSINESS_TIMEZONE),
  );
  return instant;
}

function parseMoveDate(raw: string): Date | undefined {
  const match = MOVE_DATE.exec(raw);
  if (!match) {
    return undefined;
  }
  return calendarDateInBusinessTimezone(
    Number(match[3]),
    Number(match[1]),
    Number(match[2]),
  );
}

function formatBusinessCalendarDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VANTAGE_BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const read = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("month")}/${read("day")}/${read("year")}`;
}

function canonicalizePriority(raw: unknown): string | undefined {
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw >= 0 ? String(raw) : undefined;
  }
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!PRIORITY_STRING.test(trimmed)) {
    return undefined;
  }
  return trimmed.replace(/^0+(?=\d)/, "");
}

function canonicalizeMoney(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!MONEY.test(trimmed)) {
    return undefined;
  }
  const [whole, fraction] = trimmed.split(".");
  const strippedWhole = whole.replace(/^0+(?=\d)/, "");
  if (fraction === undefined) {
    return strippedWhole;
  }
  return `${strippedWhole}.${fraction}`;
}

export function normalizeBookingAction(
  raw: string | undefined,
): GranotBookingAction | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "booked") {
    return "booked";
  }
  if (normalized === "releas" || normalized === "release") {
    return "release";
  }
  return undefined;
}

export function isSupportedGranotBookingAction(raw: unknown): boolean {
  return typeof raw === "string" && normalizeBookingAction(raw) !== undefined;
}

export function extractNormalizationStatement(
  payload: Record<string, unknown>,
  receipt?: Pick<
    NormalizationReceiptInput,
    "payload_schema_hint" | "channel_operation_kind" | "channel_operation_id"
  >,
): Record<string, unknown> {
  const looksLikeEnvelope =
    isPlainObject(payload.granot_statement) &&
    (typeof payload.operation_kind === "string" ||
      typeof payload.operation_id === "string");
  if (!looksLikeEnvelope) {
    return payload;
  }
  if (
    typeof receipt?.payload_schema_hint === "string" &&
    !isRecognizedApplyItemHint(receipt.payload_schema_hint)
  ) {
    return payload;
  }
  if (
    receipt?.channel_operation_kind &&
    payload.operation_kind !== receipt.channel_operation_kind
  ) {
    return payload;
  }
  if (
    receipt?.channel_operation_id &&
    payload.operation_id !== receipt.channel_operation_id
  ) {
    return payload;
  }
  return payload.granot_statement as Record<string, unknown>;
}

function eventTypeToken(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function deriveKind(receipt: NormalizationReceiptInput): GranotObservationKind {
  if (receipt.observation_channel === "granot_webhook") {
    return receipt.route_event_class === "booking_status_changed"
      ? "booking_action_snapshot"
      : "lead_snapshot";
  }
  return receipt.channel_operation_kind === "booking_action_apply"
    ? "booking_action_snapshot"
    : "lead_snapshot";
}

function classifyAuthority(
  receipt: NormalizationReceiptInput,
  payload: Record<string, unknown> | undefined,
  issues: IssueCollector,
): {
  kind: GranotObservationKind;
  payloadEventRaw?: string;
  bookingActionRaw?: string;
  bookingAction?: GranotBookingAction;
  primaryResult?: NormalizationResult;
} {
  const kind = deriveKind(receipt);
  const eventRaw = payload
    ? readStringScalar(payload.event_type, NORMALIZATION_FIELD_BOUNDS.event_type)
    : { invalid: false, overBound: false };
  const payloadEventRaw = eventRaw.raw;
  const eventToken = eventTypeToken(payloadEventRaw);
  const bookingAction = normalizeBookingAction(payloadEventRaw);

  if (receipt.observation_channel === "granot_webhook") {
    if (receipt.route_event_class === "lead_created") {
      if (eventRaw.invalid || (eventToken !== undefined && eventToken !== "lead_created")) {
        addIssue(issues, "route_payload_event_conflict", "error", "event_type");
        return { kind, payloadEventRaw, primaryResult: "invalid" };
      }
      if (eventToken === undefined) {
        addIssue(issues, "missing_payload_event_type", "warning", "event_type");
      }
      return { kind, payloadEventRaw };
    }
    if (receipt.route_event_class === "priority_updated") {
      if (
        eventRaw.invalid ||
        (eventToken !== undefined &&
          eventToken !== "priority_update" &&
          eventToken !== "priority_updated")
      ) {
        addIssue(issues, "route_payload_event_conflict", "error", "event_type");
        return { kind, payloadEventRaw, primaryResult: "invalid" };
      }
      if (eventToken === undefined) {
        addIssue(issues, "missing_payload_event_type", "warning", "event_type");
      }
      return { kind, payloadEventRaw };
    }
    if (bookingAction) {
      return {
        kind,
        payloadEventRaw,
        bookingActionRaw: payloadEventRaw,
        bookingAction,
      };
    }
    addIssue(issues, "unsupported_booking_action", "error", "event_type");
    return {
      kind,
      payloadEventRaw,
      bookingActionRaw: payloadEventRaw,
      primaryResult: "unsupported",
    };
  }

  if (receipt.channel_operation_kind === "lead_snapshot_apply") {
    if (bookingAction) {
      addIssue(issues, "route_payload_event_conflict", "error", "event_type");
      return {
        kind,
        payloadEventRaw,
        bookingActionRaw: payloadEventRaw,
        primaryResult: "invalid",
      };
    }
    return { kind, payloadEventRaw };
  }

  if (bookingAction) {
    return {
      kind,
      payloadEventRaw,
      bookingActionRaw: payloadEventRaw,
      bookingAction,
    };
  }
  addIssue(issues, "unsupported_booking_action", "error", "event_type");
  return {
    kind,
    payloadEventRaw,
    bookingActionRaw: payloadEventRaw,
    primaryResult: "unsupported",
  };
}

function normalizeSourceLabel(
  payload: Record<string, unknown>,
  issues: IssueCollector,
): { source_label_raw?: string; normalized_source_label?: string } {
  const value = firstPresent(payload, ["label", "source"]);
  if (value === undefined) {
    return {};
  }
  const read = readStringScalar(value, NORMALIZATION_FIELD_BOUNDS.source_label);
  if (read.invalid || read.raw === undefined) {
    addIssue(issues, "invalid_source_label", "error", "label");
    return read.raw ? { source_label_raw: read.raw } : {};
  }
  if (hasControlOrBidi(read.raw)) {
    addIssue(issues, "invalid_source_label", "error", "label");
    return { source_label_raw: read.raw };
  }
  const normalized = normalizeLookupLabel(read.raw);
  if (!normalized) {
    addIssue(issues, "invalid_source_label", "error", "label");
    return { source_label_raw: read.raw };
  }
  return { source_label_raw: read.raw, normalized_source_label: normalized };
}

function normalizeIdentity(
  payload: Record<string, unknown>,
  issues: IssueCollector,
): GranotObservationDocument["identity"] {
  const identity: GranotObservationDocument["identity"] = {};
  const job = readStringScalar(payload.job_no, NORMALIZATION_FIELD_BOUNDS.job_no);
  if (job.raw !== undefined) {
    identity.job_no_raw = job.raw;
  }
  if (job.invalid) {
    // Unbounded or non-scalar Job Number is omitted as identity; no extra issue code exists.
  } else if (job.raw !== undefined && !hasControlOrBidi(job.raw)) {
    const normalized = normalizeJobNo(job.raw);
    if (normalized) {
      identity.normalized_job_no = normalized;
    }
  }

  const formRef = readStringScalar(payload.ref_no, NORMALIZATION_FIELD_BOUNDS.form_ref);
  if (formRef.raw !== undefined) {
    identity.form_ref_raw = formRef.raw;
  }
  if (payload.ref_no !== undefined) {
    if (formRef.invalid || (formRef.raw !== undefined && hasControlOrBidi(formRef.raw))) {
      addIssue(issues, "invalid_form_reference", "error", "ref_no");
    } else if (formRef.raw !== undefined) {
      const trimmed = formRef.raw.trim();
      if (trimmed && !FORM_REF_ABSENT.test(trimmed)) {
        identity.normalized_form_ref = trimmed;
      }
    }
  }
  return identity;
}

function normalizeContact(
  payload: Record<string, unknown>,
  issues: IssueCollector,
): GranotObservationDocument["contact"] {
  const contact: GranotObservationDocument["contact"] = {};
  const first = readStringScalar(payload.first_name, NORMALIZATION_FIELD_BOUNDS.person_name);
  const last = readStringScalar(payload.last_name, NORMALIZATION_FIELD_BOUNDS.person_name);
  const display = readStringScalar(
    payload.customer_name,
    NORMALIZATION_FIELD_BOUNDS.person_name,
  );
  if (first.raw && !first.invalid && !hasControlOrBidi(first.raw)) {
    const trimmed = first.raw.normalize("NFKC").trim();
    if (trimmed) {
      contact.first_name = trimmed;
    }
  }
  if (last.raw && !last.invalid && !hasControlOrBidi(last.raw)) {
    const trimmed = last.raw.normalize("NFKC").trim();
    if (trimmed) {
      contact.last_name = trimmed;
    }
  }
  if (display.raw && !display.invalid && !hasControlOrBidi(display.raw)) {
    const trimmed = display.raw.normalize("NFKC").trim();
    if (trimmed) {
      contact.display_name = trimmed;
    }
  } else if (contact.first_name || contact.last_name) {
    const composed = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
    if (composed) {
      contact.display_name = composed;
    }
  }

  const phoneValue = firstPresent(payload, ["phone", "phone_number"]);
  if (phoneValue !== undefined) {
    const phone = readStringScalar(phoneValue, NORMALIZATION_FIELD_BOUNDS.phone);
    if (phone.raw !== undefined) {
      contact.phone_raw = phone.raw;
    }
    if (phone.invalid || phone.raw === undefined || hasControlOrBidi(phone.raw)) {
      addIssue(issues, "invalid_phone", "error", "phone");
    } else {
      const normalized = normalizePhoneNumberForMatch(phone.raw);
      if (normalized) {
        contact.normalized_phone = normalized;
      } else if (phone.raw.trim()) {
        addIssue(issues, "invalid_phone", "error", "phone");
      }
    }
  }

  if (payload.email !== undefined) {
    const email = readStringScalar(payload.email, NORMALIZATION_FIELD_BOUNDS.email);
    if (email.raw !== undefined) {
      contact.email_raw = email.raw;
    }
    if (email.invalid || email.raw === undefined || hasControlOrBidi(email.raw)) {
      addIssue(issues, "invalid_email", "error", "email");
    } else {
      const normalized = email.raw.trim().toLowerCase();
      if (normalized && EMAIL.test(normalized) && !hasControlOrBidi(normalized)) {
        contact.normalized_email = normalized;
      } else if (email.raw.trim()) {
        addIssue(issues, "invalid_email", "error", "email");
      }
    }
  }
  return contact;
}

function normalizeLocation(
  payload: Record<string, unknown>,
  prefix: "from" | "to",
  issues: IssueCollector,
): GranotObservationDocument["move"]["origin"] | undefined {
  const cityValue = payload[`${prefix}_city`];
  const stateValue = payload[`${prefix}_state`];
  const zipValue = payload[`${prefix}_zip`];
  if (cityValue === undefined && stateValue === undefined && zipValue === undefined) {
    return undefined;
  }
  const location: NonNullable<GranotObservationDocument["move"]["origin"]> = {};
  const city = readStringScalar(cityValue, NORMALIZATION_FIELD_BOUNDS.city);
  if (city.raw && !city.invalid && !hasControlOrBidi(city.raw)) {
    const trimmed = city.raw.normalize("NFKC").trim();
    if (trimmed) {
      location.city = trimmed;
    }
  }
  if (stateValue !== undefined) {
    const state = readStringScalar(stateValue, NORMALIZATION_FIELD_BOUNDS.state_raw);
    if (state.invalid || state.raw === undefined || hasControlOrBidi(state.raw)) {
      addIssue(issues, "invalid_state", "error", `${prefix}_state`);
    } else {
      const normalized = state.raw.normalize("NFKC").trim().toUpperCase();
      if (!normalized) {
        // blank present state is absent
      } else if (STATE.test(normalized)) {
        location.state = normalized;
      } else {
        addIssue(issues, "invalid_state", "error", `${prefix}_state`);
      }
    }
  }
  const zip = readStringScalar(zipValue, NORMALIZATION_FIELD_BOUNDS.zip);
  if (zip.raw && !zip.invalid && !hasControlOrBidi(zip.raw)) {
    const trimmed = zip.raw.normalize("NFKC").trim();
    if (trimmed) {
      location.zip = trimmed;
    }
  }
  return Object.keys(location).length > 0 ? location : undefined;
}

function normalizeMove(
  payload: Record<string, unknown>,
  issues: IssueCollector,
): GranotObservationDocument["move"] {
  const move: GranotObservationDocument["move"] = {};
  if (payload.move_date !== undefined) {
    const date = readStringScalar(payload.move_date, NORMALIZATION_FIELD_BOUNDS.move_date);
    if (date.raw !== undefined) {
      move.move_date_raw = date.raw;
    }
    if (date.invalid || date.raw === undefined) {
      addIssue(issues, "invalid_move_date", "error", "move_date");
    } else {
      const parsed = parseMoveDate(date.raw.trim());
      if (parsed && formatBusinessCalendarDate(parsed) === date.raw.trim()) {
        move.move_date = parsed;
      } else if (date.raw.trim()) {
        addIssue(issues, "invalid_move_date", "error", "move_date");
      }
    }
  }

  const service = readStringScalar(
    payload.service_type,
    NORMALIZATION_FIELD_BOUNDS.service_type,
  );
  if (service.raw && !service.invalid && !hasControlOrBidi(service.raw)) {
    const trimmed = service.raw.normalize("NFKC").trim();
    if (trimmed) {
      move.service_type_raw = trimmed;
    }
  }

  const moveSize = readStringScalar(
    firstPresent(payload, ["move_size", "granot_move_size"]),
    NORMALIZATION_FIELD_BOUNDS.move_size,
  );
  if (moveSize.raw && !moveSize.invalid && !hasControlOrBidi(moveSize.raw)) {
    const trimmed = moveSize.raw.normalize("NFKC").trim();
    if (trimmed) {
      move.granot_move_size_raw = trimmed;
    }
  }

  const cubicValue = firstPresent(payload, ["est_cf", "estimated_cubic_feet"]);
  if (cubicValue !== undefined) {
    if (typeof cubicValue === "number") {
      move.estimated_cubic_feet_raw = String(cubicValue);
      if (Number.isInteger(cubicValue) && Number.isFinite(cubicValue) && cubicValue >= 0) {
        move.estimated_cubic_feet = cubicValue;
      } else {
        addIssue(issues, "invalid_cubic_feet", "error", "est_cf");
      }
    } else {
      const cubic = readStringScalar(cubicValue, NORMALIZATION_FIELD_BOUNDS.cubic_feet);
      if (cubic.raw !== undefined) {
        move.estimated_cubic_feet_raw = cubic.raw;
      }
      if (cubic.invalid || cubic.raw === undefined) {
        addIssue(issues, "invalid_cubic_feet", "error", "est_cf");
      } else {
        const trimmed = cubic.raw.trim();
        if (trimmed) {
          if (/^\d+$/.test(trimmed)) {
            move.estimated_cubic_feet = Number(trimmed);
          } else {
            addIssue(issues, "invalid_cubic_feet", "error", "est_cf");
          }
        }
      }
    }
  }

  const origin = normalizeLocation(payload, "from", issues);
  if (origin) {
    move.origin = origin;
  }
  const destination = normalizeLocation(payload, "to", issues);
  if (destination) {
    move.destination = destination;
  }
  return move;
}

function normalizeMoneyField(
  payload: Record<string, unknown>,
  field: "estimate" | "payment" | "balance",
  issues: IssueCollector,
): GranotObservationDocument["display_money"]["estimate"] | undefined {
  const value = payload[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      addIssue(issues, "invalid_money", "error", field);
      return { raw: String(value) };
    }
    const raw = String(value);
    const canonical = canonicalizeMoney(raw);
    if (!canonical) {
      addIssue(issues, "invalid_money", "error", field);
      return { raw };
    }
    return { raw, canonical };
  }
  const money = readStringScalar(value, NORMALIZATION_FIELD_BOUNDS.money);
  if (money.invalid || money.raw === undefined) {
    addIssue(issues, "invalid_money", "error", field);
    return money.raw ? { raw: money.raw } : undefined;
  }
  const canonical = canonicalizeMoney(money.raw);
  if (!canonical) {
    addIssue(issues, "invalid_money", "error", field);
    return { raw: money.raw };
  }
  return { raw: money.raw, canonical };
}

function normalizePriority(
  payload: Record<string, unknown> | undefined,
  issues: IssueCollector,
): GranotObservationDocument["priority"] {
  const raw = payload?.priority;
  if (raw === undefined) {
    return { valid: false };
  }
  if (!isJsonScalar(raw) || typeof raw === "boolean" || raw === null) {
    addIssue(issues, "invalid_priority", "error", "priority");
    return { raw, valid: false };
  }
  const canonical = canonicalizePriority(raw);
  if (!canonical) {
    addIssue(issues, "invalid_priority", "error", "priority");
    return { raw, valid: false };
  }
  return { raw, canonical, valid: true };
}

function resolveResult(input: {
  primaryResult?: NormalizationResult;
  issues: NormalizedObservationIssue[];
  isPriorityUpdate: boolean;
  priorityValid: boolean;
  priorityPresent: boolean;
}): NormalizationResult {
  if (input.primaryResult === "invalid" || input.primaryResult === "unsupported") {
    return input.primaryResult;
  }
  if (input.isPriorityUpdate && (!input.priorityPresent || !input.priorityValid)) {
    return "invalid";
  }
  if (input.issues.length === 0) {
    return "valid";
  }
  return "valid_with_issues";
}

export function normalizeGranotReceipt(
  receipt: NormalizationReceiptInput,
): NormalizedObservationCandidate {
  assertReceiptChannelShape({
    observation_channel: receipt.observation_channel,
    route_event_class: receipt.route_event_class,
    channel_operation_kind: receipt.channel_operation_kind,
    channel_operation_id: receipt.channel_operation_id,
  });

  const issues: IssueCollector = [];
  if (!isPlainObject(receipt.payload)) {
    addIssue(issues, "payload_not_object", "error");
    const kind = deriveKind(receipt);
    return {
      schema_version: 1,
      kind,
      normalization_result: "invalid",
      route_event_class: receipt.route_event_class,
      captured_at: receipt.captured_at,
      identity: {},
      contact: {},
      move: {},
      priority: { valid: false },
      booking_action: {},
      display_money: {},
      agent_identity: {},
      provider_context: {},
      issues,
    };
  }

  const payload = extractNormalizationStatement(receipt.payload, receipt);
  const authority = classifyAuthority(receipt, payload, issues);
  const source = normalizeSourceLabel(payload, issues);
  const identity = normalizeIdentity(payload, issues);
  const contact = normalizeContact(payload, issues);
  const move = normalizeMove(payload, issues);
  const priority = normalizePriority(payload, issues);
  const estimate = normalizeMoneyField(payload, "estimate", issues);
  const payment = normalizeMoneyField(payload, "payment", issues);
  const balance = normalizeMoneyField(payload, "balance", issues);
  const user = readStringScalar(payload.user, NORMALIZATION_FIELD_BOUNDS.agent);
  const rep = readStringScalar(payload.rep, NORMALIZATION_FIELD_BOUNDS.agent);
  const providerType = readStringScalar(payload.type, NORMALIZATION_FIELD_BOUNDS.provider_type);

  const isPriorityUpdate =
    receipt.observation_channel === "granot_webhook" &&
    receipt.route_event_class === "priority_updated";
  if (isPriorityUpdate && (payload.priority === undefined || !priority.valid)) {
    addIssue(issues, "invalid_priority", "error", "priority");
  }

  const normalizationResult = resolveResult({
    primaryResult: authority.primaryResult,
    issues,
    isPriorityUpdate,
    priorityValid: priority.valid,
    priorityPresent: payload.priority !== undefined,
  });

  return {
    schema_version: 1,
    kind: authority.kind,
    normalization_result: normalizationResult,
    route_event_class: receipt.route_event_class,
    payload_event_type_raw: authority.payloadEventRaw,
    source_label_raw: source.source_label_raw,
    normalized_source_label: source.normalized_source_label,
    captured_at: receipt.captured_at,
    identity,
    contact,
    move,
    priority,
    booking_action: {
      raw: authority.bookingActionRaw,
      normalized: authority.bookingAction,
    },
    display_money: {
      estimate,
      payment,
      balance,
    },
    agent_identity: {
      user_raw:
        user.raw && !user.invalid && !hasControlOrBidi(user.raw) ? user.raw : undefined,
      rep_raw: rep.raw && !rep.invalid && !hasControlOrBidi(rep.raw) ? rep.raw : undefined,
    },
    provider_context: {
      type_raw:
        providerType.raw && !providerType.invalid && !hasControlOrBidi(providerType.raw)
          ? providerType.raw
          : undefined,
    },
    issues,
  };
}

function stableJson(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof mongoose.Types.ObjectId) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value != null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function observationMeaningEquals(
  left: NormalizedObservationCandidate | GranotObservationDocument,
  right: NormalizedObservationCandidate | GranotObservationDocument,
): boolean {
  const pick = (value: NormalizedObservationCandidate | GranotObservationDocument) => ({
    schema_version: value.schema_version,
    kind: value.kind,
    normalization_result: value.normalization_result,
    route_event_class: value.route_event_class,
    payload_event_type_raw: value.payload_event_type_raw,
    source_label_raw: value.source_label_raw,
    normalized_source_label: value.normalized_source_label,
    captured_at: value.captured_at,
    identity: value.identity,
    contact: value.contact,
    move: value.move,
    priority: value.priority,
    booking_action: value.booking_action,
    display_money: value.display_money,
    agent_identity: value.agent_identity,
    provider_context: value.provider_context,
    issues: value.issues,
  });
  return stableJson(pick(left)) === stableJson(pick(right));
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

export async function persistObservationCandidate(
  input: {
    receipt_id: mongoose.Types.ObjectId;
    candidate: NormalizedObservationCandidate;
  },
  store: ObservationStore,
): Promise<UpsertGranotObservationResult> {
  const existing = await store.findByReceiptId(input.receipt_id);
  if (existing) {
    if (!observationMeaningEquals(existing, input.candidate)) {
      throw new ObservationIntegrityError(String(input.receipt_id));
    }
    return { observation: existing, created: false };
  }

  try {
    const created = await store.insert({
      ...input.candidate,
      receipt_id: input.receipt_id,
    });
    return { observation: created, created: true };
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
    const raced = await store.findByReceiptId(input.receipt_id);
    if (!raced) {
      throw error;
    }
    if (!observationMeaningEquals(raced, input.candidate)) {
      throw new ObservationIntegrityError(String(input.receipt_id));
    }
    return { observation: raced, created: false };
  }
}

function mongooseObservationStore(): ObservationStore {
  const Model = getGranotObservationModel();
  return {
    async findByReceiptId(receiptId) {
      return Model.findOne({ receipt_id: receiptId }).lean();
    },
    async insert(document) {
      try {
        const created = await Model.create(document);
        return created.toObject();
      } catch (error) {
        throw error;
      }
    },
  };
}

export async function upsertGranotObservation(
  input: UpsertGranotObservationInput,
  store: ObservationStore = mongooseObservationStore(),
): Promise<UpsertGranotObservationResult> {
  const receipt =
    "receipt" in input
      ? input.receipt
      : await getGranotObservationReceiptModel().findById(input.receipt_id).lean();
  if (!receipt) {
    throw new Error("GranotObservationReceipt was not found");
  }
  const receiptId =
    "_id" in receipt && receipt._id != null
      ? toObjectId(String(receipt._id))
      : "receipt_id" in input
        ? toObjectId(input.receipt_id)
        : undefined;
  if (!receiptId) {
    throw new Error("GranotObservationReceipt is missing _id");
  }
  const candidate = normalizeGranotReceipt({
    _id: receiptId,
    observation_channel: receipt.observation_channel,
    captured_at: new Date(receipt.captured_at),
    route_event_class: receipt.route_event_class,
    channel_operation_kind: receipt.channel_operation_kind,
    channel_operation_id: receipt.channel_operation_id,
    payload: receipt.payload,
  });
  return persistObservationCandidate({ receipt_id: receiptId, candidate }, store);
}
