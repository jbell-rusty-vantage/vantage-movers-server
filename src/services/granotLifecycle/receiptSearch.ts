import mongoose from "mongoose";
import { getGranotBookingReconciliationCaseModel } from "../../models/GranotBookingReconciliationCase";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import { GRANOT_LIFECYCLE_ERROR_CODES, GranotLifecycleError } from "./errors";
import {
  extractLiveWebhookLead,
  LIVE_WEBHOOK_EVENT_CLASSES,
  type LiveWebhookEventClass,
} from "./liveReceipts";
import { redactCredentialKeys } from "./receiptEvidence";
import type { GranotBookingAction, ReceiptWorkState } from "./types";
import type { GranotLifecycleReceiptSearchQuery } from "../../validation/v1/granotLifecycle.validation";

export type GranotWebhookReceiptListItem = {
  receipt_id: string;
  captured_at: string;
  route_event_class: LiveWebhookEventClass;
  booking_action: "booked" | "release" | null;
  processing_state: string;
  observation_id: string | null;
  decision_outcome: string | null;
  ref_no: string | null;
  job_no: string | null;
  contact: {
    display_name: string | null;
    phone: string | null;
    email: string | null;
  };
  source_company: {
    id: string;
    owner_label: string;
  } | null;
  intake_case_id: string | null;
  granot_statement: unknown;
};

export type GranotWebhookReceiptListPage = {
  items: GranotWebhookReceiptListItem[];
  next_cursor: string | null;
};

export type ReceiptSearchReceiptRow = {
  _id: string;
  observation_channel: string;
  route_event_class?: string;
  captured_at: Date;
  processing?: { state?: string; latest_decision_id?: string };
  payload?: unknown;
};

export type ReceiptSearchObservationRow = {
  _id: string;
  receipt_id: string;
  identity?: { normalized_form_ref?: string; normalized_job_no?: string };
  contact?: {
    display_name?: string;
    first_name?: string;
    last_name?: string;
    phone_raw?: string;
    normalized_phone?: string;
    email_raw?: string;
    normalized_email?: string;
  };
  booking_action?: { normalized?: string };
  granot_crm_source_id?: string;
};

export type ReceiptSearchDecisionRow = {
  _id: string;
  outcome?: string;
};

export type ReceiptSearchCrmSourceRow = {
  _id: string;
  lead_source_company?: string;
};

export type ReceiptSearchSourceCompanyRow = {
  _id: string;
  owner_label: string;
};

export type ReceiptSearchBookingCaseRow = {
  _id: string;
  normalized_job_no: string;
  state: "open" | "resolved";
};

export type ReceiptFindInput = {
  route_event_classes: LiveWebhookEventClass[];
  processing_state?: ReceiptWorkState;
  captured_from?: Date;
  captured_to?: Date;
  receipt_ids?: string[];
  pending_work_states_only?: boolean;
  cursor?: { captured_at: Date; id: string };
  limit?: number;
};

export type ObservationFindInput = {
  receipt_ids?: string[];
  normalized_form_ref?: string;
  normalized_job_no?: string;
  name_contains?: string;
  normalized_phone?: string;
  normalized_email?: string;
  granot_crm_source_ids?: string[];
  booking_action?: GranotBookingAction;
};

export type ReceiptSearchStores = {
  findReceipts: (input: ReceiptFindInput) => Promise<ReceiptSearchReceiptRow[]>;
  findObservations: (input: ObservationFindInput) => Promise<ReceiptSearchObservationRow[]>;
  findDecisionsByIds: (ids: string[]) => Promise<ReceiptSearchDecisionRow[]>;
  findCrmSourcesByCompanyId: (companyId: string) => Promise<ReceiptSearchCrmSourceRow[]>;
  findCrmSourcesByIds: (ids: string[]) => Promise<ReceiptSearchCrmSourceRow[]>;
  findSourceCompaniesByIds: (ids: string[]) => Promise<ReceiptSearchSourceCompanyRow[]>;
  findBookingCasesByJobNos: (jobNos: string[]) => Promise<ReceiptSearchBookingCaseRow[]>;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORM_REF_ABSENT = /^(not provided|not_provided)$/i;
const PENDING_WORK_STATES: ReceiptWorkState[] = ["pending", "claimed", "retry_scheduled"];

export async function searchReceipts(
  query: GranotLifecycleReceiptSearchQuery,
  stores: ReceiptSearchStores = defaultReceiptSearchStores(),
): Promise<GranotWebhookReceiptListPage> {
  const routeClasses: LiveWebhookEventClass[] = query.route_event_class
    ? [query.route_event_class]
    : [...LIVE_WEBHOOK_EVENT_CLASSES];
  const captured_from = query.captured_from ? new Date(query.captured_from) : undefined;
  const captured_to = query.captured_to ? new Date(query.captured_to) : undefined;
  const decodedCursor = query.cursor ? decodeReceiptSearchCursor(query.cursor) : undefined;
  const cursor = decodedCursor
    ? { captured_at: new Date(decodedCursor.sort_value), id: decodedCursor.id }
    : undefined;

  const hasIdentity = Boolean(
    query.ref_no || query.job_no || query.name || query.phone || query.email,
  );
  const hasObservationRequired = Boolean(query.source_company_id || query.booking_action);

  let receiptIds: string[] | undefined;
  if (hasIdentity || hasObservationRequired) {
    receiptIds = await resolveCandidateReceiptIds(query, stores, {
      routeClasses,
      captured_from,
      captured_to,
      hasIdentity,
      hasObservationRequired,
    });
    if (receiptIds.length === 0) {
      return { items: [], next_cursor: null };
    }
  }

  const rows = await stores.findReceipts({
    route_event_classes: routeClasses,
    processing_state: query.processing_state,
    captured_from,
    captured_to,
    receipt_ids: receiptIds,
    cursor,
    limit: query.limit + 1,
  });

  const pageRows = rows.slice(0, query.limit);
  const items = await enrichReceiptPage(pageRows, stores);
  const last = pageRows.at(-1);
  return {
    items,
    next_cursor:
      rows.length > query.limit && last
        ? encodeReceiptSearchCursor({
            sort_value: last.captured_at.toISOString(),
            id: last._id,
          })
        : null,
  };
}

async function resolveCandidateReceiptIds(
  query: GranotLifecycleReceiptSearchQuery,
  stores: ReceiptSearchStores,
  input: {
    routeClasses: LiveWebhookEventClass[];
    captured_from?: Date;
    captured_to?: Date;
    hasIdentity: boolean;
    hasObservationRequired: boolean;
  },
): Promise<string[]> {
  let crmSourceIds: string[] | undefined;
  if (query.source_company_id) {
    const sources = await stores.findCrmSourcesByCompanyId(query.source_company_id);
    crmSourceIds = sources.map((source) => source._id);
    if (crmSourceIds.length === 0) {
      return [];
    }
  }

  const observations = await stores.findObservations({
    normalized_form_ref: query.ref_no,
    normalized_job_no: query.job_no,
    name_contains: query.name,
    normalized_phone: query.phone,
    normalized_email: query.email,
    granot_crm_source_ids: crmSourceIds,
    booking_action: query.booking_action,
  });
  const observationReceiptIds = uniqueIds(observations.map((row) => row.receipt_id));

  if (input.hasObservationRequired) {
    return observationReceiptIds;
  }

  const pendingMatches = await findPendingIdentityMatches(query, stores, {
    routeClasses: input.routeClasses,
    captured_from: input.captured_from,
    captured_to: input.captured_to,
    processing_state: query.processing_state,
  });
  return uniqueIds([...observationReceiptIds, ...pendingMatches]);
}

async function findPendingIdentityMatches(
  query: GranotLifecycleReceiptSearchQuery,
  stores: ReceiptSearchStores,
  input: {
    routeClasses: LiveWebhookEventClass[];
    captured_from?: Date;
    captured_to?: Date;
    processing_state?: ReceiptWorkState;
  },
): Promise<string[]> {
  if (input.processing_state && !PENDING_WORK_STATES.includes(input.processing_state)) {
    return [];
  }
  const pendingRows = await stores.findReceipts({
    route_event_classes: input.routeClasses,
    processing_state: input.processing_state,
    captured_from: input.captured_from,
    captured_to: input.captured_to,
    pending_work_states_only: input.processing_state ? false : true,
  });
  if (pendingRows.length === 0) {
    return [];
  }
  const observations = await stores.findObservations({
    receipt_ids: pendingRows.map((row) => row._id),
  });
  const observed = new Set(observations.map((row) => row.receipt_id));
  return pendingRows
    .filter((row) => !observed.has(row._id) && pendingExtractMatches(row, query))
    .map((row) => row._id);
}

function pendingExtractMatches(
  row: ReceiptSearchReceiptRow,
  query: GranotLifecycleReceiptSearchQuery,
): boolean {
  const redacted = redactCredentialKeys(row.payload).value;
  const lead = extractLiveWebhookLead(redacted);
  if (query.ref_no && pendingRefNo(redacted) !== query.ref_no) {
    return false;
  }
  if (query.job_no && normalizeJobNo(lead.job_no) !== query.job_no) {
    return false;
  }
  if (query.phone && normalizePhoneNumberForMatch(lead.phone) !== query.phone) {
    return false;
  }
  if (query.email && normalizeEmail(lead.email) !== query.email) {
    return false;
  }
  if (
    query.name &&
    !nameContains(query.name, [lead.display_name, lead.first_name, lead.last_name])
  ) {
    return false;
  }
  return true;
}

async function enrichReceiptPage(
  rows: ReceiptSearchReceiptRow[],
  stores: ReceiptSearchStores,
): Promise<GranotWebhookReceiptListItem[]> {
  if (rows.length === 0) {
    return [];
  }
  const observations = await stores.findObservations({
    receipt_ids: rows.map((row) => row._id),
  });
  const observationsByReceiptId = new Map(observations.map((row) => [row.receipt_id, row]));
  const decisionIds = uniqueIds(
    rows.flatMap((row) => (row.processing?.latest_decision_id ? [row.processing.latest_decision_id] : [])),
  );
  const crmSourceIds = uniqueIds(
    observations.flatMap((row) => (row.granot_crm_source_id ? [row.granot_crm_source_id] : [])),
  );
  const [decisions, crmSources] = await Promise.all([
    decisionIds.length > 0 ? stores.findDecisionsByIds(decisionIds) : Promise.resolve([]),
    crmSourceIds.length > 0 ? stores.findCrmSourcesByIds(crmSourceIds) : Promise.resolve([]),
  ]);
  const decisionsById = new Map(decisions.map((row) => [row._id, row]));
  const crmById = new Map(crmSources.map((row) => [row._id, row]));
  const companyIds = uniqueIds(
    crmSources.flatMap((row) => (row.lead_source_company ? [row.lead_source_company] : [])),
  );
  const companies =
    companyIds.length > 0 ? await stores.findSourceCompaniesByIds(companyIds) : [];
  const companiesById = new Map(companies.map((row) => [row._id, row]));

  const pageJobNos = uniqueIds(
    rows.flatMap((row) => {
      const observation = observationsByReceiptId.get(row._id);
      const jobNo = observation
        ? observation.identity?.normalized_job_no
        : normalizeJobNo(extractLiveWebhookLead(redactCredentialKeys(row.payload).value).job_no);
      return jobNo ? [jobNo] : [];
    }),
  );
  const cases =
    pageJobNos.length > 0 ? await stores.findBookingCasesByJobNos(pageJobNos) : [];
  const caseByJobNo = pickIntakeCaseByJobNo(cases);

  return rows.flatMap((row) => {
    const item = projectReceiptRow({
      row,
      observation: observationsByReceiptId.get(row._id),
      decision: row.processing?.latest_decision_id
        ? decisionsById.get(row.processing.latest_decision_id)
        : undefined,
      crmSourcesById: crmById,
      companiesById,
      caseByJobNo,
    });
    return item ? [item] : [];
  });
}

function projectReceiptRow(input: {
  row: ReceiptSearchReceiptRow;
  observation?: ReceiptSearchObservationRow;
  decision?: ReceiptSearchDecisionRow;
  crmSourcesById: Map<string, ReceiptSearchCrmSourceRow>;
  companiesById: Map<string, ReceiptSearchSourceCompanyRow>;
  caseByJobNo: Map<string, string>;
}): GranotWebhookReceiptListItem | null {
  if (input.row.observation_channel !== "granot_webhook") {
    return null;
  }
  if (!isLiveWebhookEventClass(input.row.route_event_class)) {
    return null;
  }
  if (!(input.row.captured_at instanceof Date) || Number.isNaN(input.row.captured_at.getTime())) {
    return null;
  }

  const granot_statement = redactCredentialKeys(input.row.payload).value;
  const pending = extractPendingIdentity(input.row.payload);
  const ref_no = input.observation
    ? input.observation.identity?.normalized_form_ref ?? null
    : pending.ref_no;
  const job_no = input.observation
    ? input.observation.identity?.normalized_job_no ?? null
    : pending.job_no;
  const display_name = input.observation
    ? observationDisplayName(input.observation)
    : pending.display_name;
  const phone = firstNonEmpty([
    input.observation?.contact?.normalized_phone,
    input.observation?.contact?.phone_raw,
    pending.phone,
  ]);
  const email = firstNonEmpty([
    input.observation?.contact?.normalized_email,
    input.observation?.contact?.email_raw,
    pending.email,
  ]);
  const booking_action =
    input.row.route_event_class === "booking_status_changed"
      ? asBookingAction(input.observation?.booking_action?.normalized)
      : null;
  const source_company = sourceCompanyFromObservation(
    input.observation,
    input.crmSourcesById,
    input.companiesById,
  );

  return {
    receipt_id: input.row._id,
    captured_at: input.row.captured_at.toISOString(),
    route_event_class: input.row.route_event_class,
    booking_action,
    processing_state: input.row.processing?.state ?? "pending",
    observation_id: input.observation?._id ?? null,
    decision_outcome: input.decision?.outcome ?? null,
    ref_no,
    job_no,
    contact: { display_name, phone, email },
    source_company,
    intake_case_id: job_no ? input.caseByJobNo.get(job_no) ?? null : null,
    granot_statement,
  };
}

function extractPendingIdentity(payload: unknown): {
  ref_no: string | null;
  job_no: string | null;
  display_name: string | null;
  phone: string | null;
  email: string | null;
} {
  const redacted = redactCredentialKeys(payload).value;
  const lead = extractLiveWebhookLead(redacted);
  return {
    ref_no: pendingRefNo(redacted),
    job_no: normalizeJobNo(lead.job_no) ?? null,
    display_name: lead.display_name,
    phone: normalizePhoneNumberForMatch(lead.phone) ?? lead.phone,
    email: normalizeEmail(lead.email) ?? lead.email,
  };
}

function pendingRefNo(payload: unknown): string | null {
  const body =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const raw = scalar(body.leadno) ?? scalar(body.ref_no);
  if (!raw || FORM_REF_ABSENT.test(raw)) {
    return null;
  }
  return raw;
}

function scalar(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized && EMAIL.test(normalized) ? normalized : undefined;
}

function nameContains(needle: string, haystacks: Array<string | null | undefined>): boolean {
  const query = needle.trim().toLowerCase();
  if (!query) {
    return false;
  }
  return haystacks.some((value) => typeof value === "string" && value.toLowerCase().includes(query));
}

function observationDisplayName(observation: ReceiptSearchObservationRow): string | null {
  if (observation.contact?.display_name) {
    return observation.contact.display_name;
  }
  const composed = [observation.contact?.first_name, observation.contact?.last_name]
    .filter((part): part is string => Boolean(part))
    .join(" ");
  return composed.length > 0 ? composed : null;
}

function asBookingAction(value: string | undefined): "booked" | "release" | null {
  return value === "booked" || value === "release" ? value : null;
}

function sourceCompanyFromObservation(
  observation: ReceiptSearchObservationRow | undefined,
  crmSourcesById: Map<string, ReceiptSearchCrmSourceRow>,
  companiesById: Map<string, ReceiptSearchSourceCompanyRow>,
): { id: string; owner_label: string } | null {
  if (!observation?.granot_crm_source_id) {
    return null;
  }
  const companyId = crmSourcesById.get(observation.granot_crm_source_id)?.lead_source_company;
  if (!companyId) {
    return null;
  }
  const company = companiesById.get(companyId);
  return company ? { id: company._id, owner_label: company.owner_label } : null;
}

function pickIntakeCaseByJobNo(cases: ReceiptSearchBookingCaseRow[]): Map<string, string> {
  const chosen = new Map<string, ReceiptSearchBookingCaseRow>();
  for (const row of cases) {
    if (row.state !== "open" && row.state !== "resolved") {
      continue;
    }
    const current = chosen.get(row.normalized_job_no);
    if (!current) {
      chosen.set(row.normalized_job_no, row);
      continue;
    }
    if (current.state === "resolved" && row.state === "open") {
      chosen.set(row.normalized_job_no, row);
      continue;
    }
    if (current.state === row.state && row._id > current._id) {
      chosen.set(row.normalized_job_no, row);
    }
  }
  return new Map([...chosen].map(([jobNo, row]) => [jobNo, row._id]));
}

function isLiveWebhookEventClass(value: unknown): value is LiveWebhookEventClass {
  return (
    value === "lead_created" ||
    value === "priority_updated" ||
    value === "booking_status_changed"
  );
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

type ReceiptSearchCursor = { sort_value: string; id: string };

export function encodeReceiptSearchCursor(value: ReceiptSearchCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeReceiptSearchCursor(value: string): ReceiptSearchCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!isReceiptSearchCursor(parsed)) {
      throw new Error("invalid cursor shape");
    }
    return parsed;
  } catch {
    throw new GranotLifecycleError(
      "Invalid request",
      GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
      400,
      undefined,
      [{ path: "cursor", message: "cursor is invalid" }],
    );
  }
}

function isReceiptSearchCursor(value: unknown): value is ReceiptSearchCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(",") === "id,sort_value" &&
    typeof record.sort_value === "string" &&
    Number.isFinite(Date.parse(record.sort_value)) &&
    typeof record.id === "string" &&
    /^[a-f0-9]{24}$/i.test(record.id)
  );
}

function asObjectId(id: string): mongoose.Types.ObjectId | null {
  if (!/^[a-fA-F0-9]{24}$/.test(id)) {
    return null;
  }
  return new mongoose.Types.ObjectId(id);
}

function asIdString(value: unknown): string | null {
  if (value instanceof mongoose.Types.ObjectId) {
    return String(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function defaultReceiptSearchStores(): ReceiptSearchStores {
  return {
    findReceipts: defaultFindReceipts,
    findObservations: defaultFindObservations,
    findDecisionsByIds: defaultFindDecisionsByIds,
    findCrmSourcesByCompanyId: defaultFindCrmSourcesByCompanyId,
    findCrmSourcesByIds: defaultFindCrmSourcesByIds,
    findSourceCompaniesByIds: defaultFindSourceCompaniesByIds,
    findBookingCasesByJobNos: defaultFindBookingCasesByJobNos,
  };
}

async function defaultFindReceipts(input: ReceiptFindInput): Promise<ReceiptSearchReceiptRow[]> {
  if (input.receipt_ids && input.receipt_ids.length === 0) {
    return [];
  }
  const receiptObjectIds = input.receipt_ids
    ?.map(asObjectId)
    .filter((id): id is mongoose.Types.ObjectId => id !== null);
  if (input.receipt_ids && receiptObjectIds?.length === 0) {
    return [];
  }
  const filter: Record<string, unknown> = {
    observation_channel: "granot_webhook",
    route_event_class: { $in: input.route_event_classes },
  };
  if (receiptObjectIds) {
    filter._id = { $in: receiptObjectIds };
  }
  if (input.processing_state) {
    filter["processing.state"] = input.processing_state;
  } else if (input.pending_work_states_only) {
    filter["processing.state"] = { $in: PENDING_WORK_STATES };
  }
  if (input.captured_from || input.captured_to) {
    filter.captured_at = {
      ...(input.captured_from ? { $gte: input.captured_from } : {}),
      ...(input.captured_to ? { $lte: input.captured_to } : {}),
    };
  }
  if (input.cursor) {
    const cursorId = asObjectId(input.cursor.id);
    filter.$or = cursorId
      ? [
          { captured_at: { $lt: input.cursor.captured_at } },
          { captured_at: input.cursor.captured_at, _id: { $lt: cursorId } },
        ]
      : [{ captured_at: { $lt: input.cursor.captured_at } }];
  }
  const query = getGranotObservationReceiptModel()
    .find(filter)
    .sort({ captured_at: -1, _id: -1 })
    .select({
      observation_channel: 1,
      captured_at: 1,
      route_event_class: 1,
      payload: 1,
      "processing.state": 1,
      "processing.latest_decision_id": 1,
    });
  if (input.limit !== undefined) {
    query.limit(input.limit);
  }
  const rows = await query.lean().exec();
  return rows.flatMap((row) => {
    const id = asIdString(row._id);
    if (!id || !(row.captured_at instanceof Date)) {
      return [];
    }
    return [
      {
        _id: id,
        observation_channel: String(row.observation_channel),
        route_event_class: row.route_event_class,
        captured_at: row.captured_at,
        processing: {
          state: row.processing?.state,
          latest_decision_id: asIdString(row.processing?.latest_decision_id) ?? undefined,
        },
        payload: row.payload,
      },
    ];
  });
}

async function defaultFindObservations(
  input: ObservationFindInput,
): Promise<ReceiptSearchObservationRow[]> {
  const filter: Record<string, unknown> = {};
  if (input.receipt_ids) {
    const ids = input.receipt_ids.map(asObjectId).filter((id): id is mongoose.Types.ObjectId => id !== null);
    if (ids.length === 0) {
      return [];
    }
    filter.receipt_id = { $in: ids };
  }
  if (input.normalized_form_ref) {
    filter["identity.normalized_form_ref"] = input.normalized_form_ref;
  }
  if (input.normalized_job_no) {
    filter["identity.normalized_job_no"] = input.normalized_job_no;
  }
  if (input.normalized_phone) {
    filter["contact.normalized_phone"] = input.normalized_phone;
  }
  if (input.normalized_email) {
    filter["contact.normalized_email"] = input.normalized_email;
  }
  if (input.booking_action) {
    filter["booking_action.normalized"] = input.booking_action;
  }
  if (input.granot_crm_source_ids) {
    const ids = input.granot_crm_source_ids
      .map(asObjectId)
      .filter((id): id is mongoose.Types.ObjectId => id !== null);
    if (ids.length === 0) {
      return [];
    }
    filter.granot_crm_source_id = { $in: ids };
  }
  if (input.name_contains) {
    const regex = new RegExp(escapeRegex(input.name_contains), "i");
    filter.$or = [
      { "contact.display_name": regex },
      { "contact.first_name": regex },
      { "contact.last_name": regex },
    ];
  }
  const rows = await getGranotObservationModel()
    .find(filter)
    .select({
      receipt_id: 1,
      identity: 1,
      contact: 1,
      booking_action: 1,
      granot_crm_source_id: 1,
    })
    .lean()
    .exec();
  return rows.flatMap((row) => {
    const id = asIdString(row._id);
    const receiptId = asIdString(row.receipt_id);
    if (!id || !receiptId) {
      return [];
    }
    return [
      {
        _id: id,
        receipt_id: receiptId,
        identity: row.identity,
        contact: row.contact,
        booking_action: row.booking_action,
        granot_crm_source_id: asIdString(row.granot_crm_source_id) ?? undefined,
      },
    ];
  });
}

async function defaultFindDecisionsByIds(ids: string[]): Promise<ReceiptSearchDecisionRow[]> {
  const objectIds = ids.map(asObjectId).filter((id): id is mongoose.Types.ObjectId => id !== null);
  if (objectIds.length === 0) {
    return [];
  }
  const rows = await getSynchronizationDecisionModel()
    .find({ _id: { $in: objectIds } })
    .select({ outcome: 1 })
    .lean()
    .exec();
  return rows.flatMap((row) => {
    const id = asIdString(row._id);
    return id ? [{ _id: id, outcome: row.outcome }] : [];
  });
}

async function defaultFindCrmSourcesByCompanyId(
  companyId: string,
): Promise<ReceiptSearchCrmSourceRow[]> {
  const id = asObjectId(companyId);
  if (!id) {
    return [];
  }
  const rows = await getGranotCrmSourceModel()
    .find({ lead_source_company: id })
    .select({ lead_source_company: 1 })
    .lean()
    .exec();
  return rows.flatMap((row) => {
    const sourceId = asIdString(row._id);
    return sourceId
      ? [{ _id: sourceId, lead_source_company: asIdString(row.lead_source_company) ?? undefined }]
      : [];
  });
}

async function defaultFindCrmSourcesByIds(ids: string[]): Promise<ReceiptSearchCrmSourceRow[]> {
  const objectIds = ids.map(asObjectId).filter((id): id is mongoose.Types.ObjectId => id !== null);
  if (objectIds.length === 0) {
    return [];
  }
  const rows = await getGranotCrmSourceModel()
    .find({ _id: { $in: objectIds } })
    .select({ lead_source_company: 1 })
    .lean()
    .exec();
  return rows.flatMap((row) => {
    const sourceId = asIdString(row._id);
    return sourceId
      ? [{ _id: sourceId, lead_source_company: asIdString(row.lead_source_company) ?? undefined }]
      : [];
  });
}

async function defaultFindSourceCompaniesByIds(
  ids: string[],
): Promise<ReceiptSearchSourceCompanyRow[]> {
  const objectIds = ids.map(asObjectId).filter((id): id is mongoose.Types.ObjectId => id !== null);
  if (objectIds.length === 0) {
    return [];
  }
  const rows = await getLeadSourceCompanyModel()
    .find({ _id: { $in: objectIds } })
    .select({ owner_label: 1 })
    .lean()
    .exec();
  return rows.flatMap((row) => {
    const id = asIdString(row._id);
    return id ? [{ _id: id, owner_label: String(row.owner_label ?? "") }] : [];
  });
}

async function defaultFindBookingCasesByJobNos(
  jobNos: string[],
): Promise<ReceiptSearchBookingCaseRow[]> {
  if (jobNos.length === 0) {
    return [];
  }
  const rows = await getGranotBookingReconciliationCaseModel()
    .find({ normalized_job_no: { $in: jobNos }, state: { $in: ["open", "resolved"] } })
    .select({ normalized_job_no: 1, state: 1 })
    .lean()
    .exec();
  return rows.flatMap((row) => {
    const id = asIdString(row._id);
    if (!id || (row.state !== "open" && row.state !== "resolved")) {
      return [];
    }
    return [{ _id: id, normalized_job_no: row.normalized_job_no, state: row.state }];
  });
}
