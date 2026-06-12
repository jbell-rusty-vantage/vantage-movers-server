import mongoose from "mongoose";
import { connectMongo } from "../../db";
import {
  getOperationalEventModel,
  type OperationalEventDocument,
} from "../../models/OperationalEvent";
import { getOperationalIncidentModel } from "../../models/OperationalIncident";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  NOTIFICATION_PURPOSES,
  NOTIFICATION_RECIPIENT_TYPES,
  NOTIFICATION_STATUSES,
  OBSERVABILITY_LEVELS,
  OPERATIONAL_EVENT_CATEGORIES,
  REPORT_RUN_STATUSES,
  type IncidentSeverity,
  type IncidentStatus,
} from "../../config/domain/observability";
import { OPERATIONAL_REPORT_KEYS } from "./operationalReports.service";
import { getNotificationDeliveryModel } from "../../models/NotificationDelivery";
import { V1ServiceError } from "../v1ServiceError";
import { getSheetSyncHealth } from "../admin/adminSheetSync.service";
import { toCsv } from "../../utils/csv";
import { recordOperationalEvent } from "./recordOperationalEvent";
import type {
  ObservabilityEventsQuery,
  ObservabilityFacetsQuery,
  ObservabilityIncidentsQuery,
  ObservabilityIncidentStatusInput,
  ObservabilityNotificationsQuery,
  ObservabilityOverviewQuery,
} from "../../validation/v1.validation";

/**
 * Read services + incident status mutation backing the admin Observational
 * endpoints. All reads are paginated and start with an indexed date/field
 * match. Responses use the standard `{ items, page, limit, total, has_next_page }`
 * browse shape.
 */

const EVENT_LIST_PROJECTION = {
  occurred_at: 1,
  level: 1,
  event_key: 1,
  category: 1,
  workflow: 1,
  summary: 1,
  source_company: 1,
  lead_name: 1,
  lead_phone: 1,
  lead_email: 1,
  route: 1,
  entity_type: 1,
  entity_id: 1,
  run_id: 1,
  incident_id: 1,
  notification_candidate: 1,
  reportable: 1,
} as const;

const INCIDENT_LIST_PROJECTION = {
  status: 1,
  severity: 1,
  event_key: 1,
  category: 1,
  workflow: 1,
  title: 1,
  summary: 1,
  source_company: 1,
  route: 1,
  entity_type: 1,
  entity_id: 1,
  lead_name: 1,
  lead_phone: 1,
  lead_email: 1,
  first_seen_at: 1,
  last_seen_at: 1,
  count: 1,
  owner_visible: 1,
  notification_state: 1,
} as const;

const ALLOWED_STATUS_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  open: ["acknowledged", "resolved", "ignored"],
  acknowledged: ["resolved", "ignored"],
  ignored: ["open"],
  resolved: ["open"],
  auto_resolved: ["open"],
};

const INCIDENT_SEVERITY_RANK: Record<IncidentSeverity, number> = {
  warn: 1,
  error: 2,
  critical: 3,
};

type PaginatedResult<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  has_next_page: boolean;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive "contains" regex for owner-friendly partial matching. */
function containsRegex(value: string): RegExp {
  return new RegExp(escapeRegex(value.trim()), "i");
}

/**
 * Phone filters match on digits only so the owner can paste any format
 * ("(555) 123-4567", "555.123.4567", "1231"). Falls back to a plain contains
 * match when the input has no digits.
 */
function phoneContainsRegex(value: string): RegExp {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return containsRegex(value);
  }
  // Allow common separators between each digit so formatted stored values
  // ("(555) 123-4567") still match a raw digit query.
  const pattern = digits.split("").map(escapeRegex).join("[\\s().+-]*");
  return new RegExp(pattern);
}

/**
 * Shared partial-match filters for owner-facing lead identity fields. Other
 * filters stay exact; these are the "track down a customer" search paths.
 */
function applyLeadIdentityFilters(
  filter: Record<string, unknown>,
  query: { lead_name?: string; lead_phone?: string; lead_email?: string },
): void {
  if (query.lead_name) filter.lead_name = containsRegex(query.lead_name);
  if (query.lead_phone) filter.lead_phone = phoneContainsRegex(query.lead_phone);
  if (query.lead_email) filter.lead_email = containsRegex(query.lead_email);
}

/** Exported for unit tests; not part of the route-facing surface. */
export function buildEventFilter(query: ObservabilityEventsQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const occurred: Record<string, Date> = {};
  if (query.from) occurred.$gte = query.from;
  if (query.to) occurred.$lt = query.to;
  if (Object.keys(occurred).length > 0) filter.occurred_at = occurred;

  if (query.level) filter.level = query.level;
  if (query.category) filter.category = query.category;
  if (query.workflow) filter.workflow = query.workflow;
  if (query.event_key) filter.event_key = query.event_key;
  if (query.source_company) filter.source_company = query.source_company;
  applyLeadIdentityFilters(filter, query);
  if (query.route) filter.route = query.route;
  if (query.entity_type) filter.entity_type = query.entity_type;
  if (query.entity_id) filter.entity_id = query.entity_id;
  if (query.run_id) filter.run_id = query.run_id;
  if (query.request_id) filter.request_id = query.request_id;
  if (query.notification_candidate !== undefined) {
    filter.notification_candidate = query.notification_candidate;
  }
  if (query.reportable !== undefined) filter.reportable = query.reportable;
  if (query.q) filter.$text = { $search: query.q };
  return filter;
}

/** Exported for unit tests; not part of the route-facing surface. */
export function buildIncidentFilter(query: ObservabilityIncidentsQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const seen: Record<string, Date> = {};
  if (query.from) seen.$gte = query.from;
  if (query.to) seen.$lt = query.to;
  if (Object.keys(seen).length > 0) filter.last_seen_at = seen;

  if (query.status) filter.status = query.status;
  if (query.severity) filter.severity = query.severity;
  if (query.category) filter.category = query.category;
  if (query.workflow) filter.workflow = query.workflow;
  if (query.event_key) filter.event_key = query.event_key;
  if (query.source_company) filter.source_company = query.source_company;
  applyLeadIdentityFilters(filter, query);
  if (query.entity_type) filter.entity_type = query.entity_type;
  if (query.entity_id) filter.entity_id = query.entity_id;
  if (query.owner_visible !== undefined) filter.owner_visible = query.owner_visible;
  if (query.q) {
    // Incidents have no text index; volume is low enough for a regex OR scan.
    const pattern = containsRegex(query.q);
    filter.$or = [
      { title: pattern },
      { summary: pattern },
      { event_key: pattern },
      { workflow: pattern },
      { lead_name: pattern },
      { source_company: pattern },
    ];
  }
  return filter;
}

export async function listOperationalEvents(
  query: ObservabilityEventsQuery,
): Promise<PaginatedResult<Partial<OperationalEventDocument>>> {
  await connectMongo();
  const Event = getOperationalEventModel();
  const filter = buildEventFilter(query);
  const sortField = query.sort || "occurred_at";
  const sortDir = query.direction === "asc" ? 1 : -1;
  const skip = (query.page - 1) * query.limit;

  const [items, total] = await Promise.all([
    Event.find(filter)
      .select(EVENT_LIST_PROJECTION)
      .sort({ [sortField]: sortDir })
      .skip(skip)
      .limit(query.limit)
      .lean(),
    Event.countDocuments(filter),
  ]);

  return {
    items: items as Partial<OperationalEventDocument>[],
    page: query.page,
    limit: query.limit,
    total,
    has_next_page: query.page * query.limit < total,
  };
}

export async function getOperationalEventDetail(id: string) {
  if (!mongoose.isValidObjectId(id)) {
    throw new V1ServiceError("Invalid event id", 400);
  }
  await connectMongo();
  const Event = getOperationalEventModel();
  const event = await Event.findById(id).lean();
  if (!event) {
    throw new V1ServiceError("Operational event not found", 404);
  }

  let incident = null;
  if (event.incident_id) {
    const Incident = getOperationalIncidentModel();
    incident = await Incident.findById(event.incident_id)
      .select(INCIDENT_LIST_PROJECTION)
      .lean();
  }

  return { event, incident };
}

export async function listOperationalIncidents(query: ObservabilityIncidentsQuery) {
  await connectMongo();
  const Incident = getOperationalIncidentModel();
  const filter = buildIncidentFilter(query);
  const sortField = query.sort || "last_seen_at";
  const sortDir = query.direction === "asc" ? 1 : -1;
  const skip = (query.page - 1) * query.limit;

  const [items, total] = await Promise.all([
    Incident.find(filter)
      .select(INCIDENT_LIST_PROJECTION)
      .sort({ [sortField]: sortDir })
      .skip(skip)
      .limit(query.limit)
      .lean(),
    Incident.countDocuments(filter),
  ]);

  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    has_next_page: query.page * query.limit < total,
  };
}

export async function getOperationalIncidentDetail(id: string) {
  if (!mongoose.isValidObjectId(id)) {
    throw new V1ServiceError("Invalid incident id", 400);
  }
  await connectMongo();
  const Incident = getOperationalIncidentModel();
  const incident = await Incident.findById(id).lean();
  if (!incident) {
    throw new V1ServiceError("Operational incident not found", 404);
  }

  const Event = getOperationalEventModel();
  const Delivery = getNotificationDeliveryModel();
  const [events, notifications] = await Promise.all([
    Event.find({ incident_id: incident._id })
      .select(EVENT_LIST_PROJECTION)
      .sort({ occurred_at: -1 })
      .limit(50)
      .lean(),
    Delivery.find({ incident_id: incident._id }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);

  return {
    incident,
    events,
    notifications,
    suggested_action: suggestedAction(incident.event_key, incident.category),
  };
}

export async function updateOperationalIncidentStatus(
  id: string,
  input: ObservabilityIncidentStatusInput,
) {
  if (!mongoose.isValidObjectId(id)) {
    throw new V1ServiceError("Invalid incident id", 400);
  }
  await connectMongo();
  const Incident = getOperationalIncidentModel();
  const incident = await Incident.findById(id);
  if (!incident) {
    throw new V1ServiceError("Operational incident not found", 404);
  }

  const current = incident.status as IncidentStatus;
  const next = input.status;
  if (current !== next && !ALLOWED_STATUS_TRANSITIONS[current]?.includes(next)) {
    throw new V1ServiceError(
      `Invalid status transition from ${current} to ${next}`,
      409,
    );
  }

  const now = new Date();
  incident.status = next;
  if (next === "resolved") {
    incident.resolved_at = now;
  } else if (next === "acknowledged") {
    incident.acknowledged_at = now;
    incident.acknowledged_by = input.actor ?? null;
  } else if (next === "ignored") {
    incident.ignored_at = now;
    incident.ignored_by = input.actor ?? null;
  } else if (next === "open") {
    incident.resolved_at = null;
  }
  await incident.save();

  await recordOperationalEvent({
    level: "info",
    eventKey: "admin.incident.status_changed",
    category: "admin",
    workflow: "incident_status",
    summary: `Incident status changed from ${current} to ${next}.`,
    entity: { type: "operational_incident", id: incident._id.toString() },
    details: {
      from_status: current,
      to_status: next,
      actor: input.actor ?? null,
      note: input.note ?? null,
    },
    reportable: false,
  });

  return incident.toObject();
}

export async function listNotificationDeliveries(
  query: ObservabilityNotificationsQuery,
) {
  await connectMongo();
  const Delivery = getNotificationDeliveryModel();
  const filter: Record<string, unknown> = {};
  const created: Record<string, Date> = {};
  if (query.from) created.$gte = query.from;
  if (query.to) created.$lt = query.to;
  if (Object.keys(created).length > 0) filter.createdAt = created;
  if (query.status) filter.status = query.status;
  if (query.purpose) filter.purpose = query.purpose;
  if (query.recipient_type) filter.recipient_type = query.recipient_type;
  if (query.provider) filter.provider = query.provider;
  if (query.incident_id && mongoose.isValidObjectId(query.incident_id)) {
    filter.incident_id = new mongoose.Types.ObjectId(query.incident_id);
  }
  if (query.report_run_id && mongoose.isValidObjectId(query.report_run_id)) {
    filter.report_run_id = new mongoose.Types.ObjectId(query.report_run_id);
  }
  if (query.q) filter.subject = { $regex: query.q, $options: "i" };

  const sortDir = query.direction === "asc" ? 1 : -1;
  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    Delivery.find(filter).sort({ createdAt: sortDir }).skip(skip).limit(query.limit).lean(),
    Delivery.countDocuments(filter),
  ]);

  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    has_next_page: query.page * query.limit < total,
  };
}

export async function getObservabilityOverview(query: ObservabilityOverviewQuery) {
  await connectMongo();
  const timezone = "America/New_York";
  const now = new Date();
  const from = query.from ?? startOfDayInTimeZone(now, timezone);
  const to = query.to ?? now;

  const Event = getOperationalEventModel();
  const Incident = getOperationalIncidentModel();
  const Delivery = getNotificationDeliveryModel();

  const eventMatch = { occurred_at: { $gte: from, $lt: to } };

  const [
    byLevel,
    byCategory,
    byWorkflow,
    openCounts,
    topOpenIncidents,
    recentCritical,
    sheetSync,
    notificationCounts,
    ringcentralIncidents,
  ] = await Promise.all([
    Event.aggregate([
      { $match: eventMatch },
      { $group: { _id: "$level", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Event.aggregate([
      { $match: eventMatch },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Event.aggregate([
      { $match: eventMatch },
      { $group: { _id: "$workflow", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
    Incident.aggregate([
      { $match: { status: { $in: ["open", "acknowledged"] } } },
      { $group: { _id: "$severity", count: { $sum: 1 } } },
    ]),
    Incident.aggregate([
      { $match: { status: { $in: ["open", "acknowledged"] } } },
      {
        $addFields: {
          severity_rank: {
            $switch: {
              branches: [
                { case: { $eq: ["$severity", "critical"] }, then: 3 },
                { case: { $eq: ["$severity", "error"] }, then: 2 },
                { case: { $eq: ["$severity", "warn"] }, then: 1 },
              ],
              default: 0,
            },
          },
        },
      },
      { $sort: { severity_rank: -1, last_seen_at: -1 } },
      { $limit: 10 },
      { $project: { severity_rank: 0 } },
    ]),
    Event.find({ level: "critical", occurred_at: { $gte: from, $lt: to } })
      .select(EVENT_LIST_PROJECTION)
      .sort({ occurred_at: -1 })
      .limit(10)
      .lean(),
    getSheetSyncHealth().catch(() => null),
    Promise.all([
      Delivery.countDocuments({ status: "sent", createdAt: { $gte: from, $lt: to } }),
      Delivery.countDocuments({ status: "failed", createdAt: { $gte: from, $lt: to } }),
      Delivery.countDocuments({ status: "suppressed", createdAt: { $gte: from, $lt: to } }),
    ]),
    Incident.countDocuments({
      category: "ringcentral",
      status: { $in: ["open", "acknowledged"] },
    }),
  ]);

  const openBySeverity = countsToMap(openCounts);
  const openCritical = openBySeverity.critical ?? 0;
  const openError = openBySeverity.error ?? 0;
  const openWarn = openBySeverity.warn ?? 0;
  const overallStatus =
    openCritical > 0 ? "critical" : openError > 0 ? "degraded" : "healthy";

  const [sentToday, failedToday, suppressedToday] = notificationCounts;

  return {
    generated_at: now.toISOString(),
    period: { from: from.toISOString(), to: to.toISOString(), timezone },
    health: {
      overall_status: overallStatus,
      open_critical: openCritical,
      open_error: openError,
      open_warn: openWarn,
    },
    event_counts_by_level: byLevel.map(toCountRow),
    event_counts_by_category: byCategory.map(toCountRow),
    event_counts_by_workflow: byWorkflow.map(toCountRow),
    top_open_incidents: topOpenIncidents,
    recent_critical_events: recentCritical,
    sheet_sync: sheetSync,
    ringcentral: { open_incidents: ringcentralIncidents },
    notifications: {
      sent_today: sentToday,
      failed_today: failedToday,
      suppressed_today: suppressedToday,
    },
  };
}

const FACET_VALUE_CAP = 200;
const FACET_DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Distinct event-field values plus the static enums, so the admin UI can
 * populate every Observational filter dropdown from one call. Distinct values
 * come from `operational_events` over a bounded window (default last 30 days)
 * and are capped/sorted for stable dropdowns.
 */
export async function getObservabilityFacets(query: ObservabilityFacetsQuery) {
  await connectMongo();
  const Event = getOperationalEventModel();
  const to = query.to ?? new Date();
  const from = query.from ?? new Date(to.getTime() - FACET_DEFAULT_WINDOW_MS);
  const match = { occurred_at: { $gte: from, $lt: to } };

  const [workflows, eventKeys, sourceCompanies, entityTypes, routes] =
    await Promise.all([
      Event.distinct("workflow", match),
      Event.distinct("event_key", match),
      Event.distinct("source_company", match),
      Event.distinct("entity_type", match),
      Event.distinct("route", match),
    ]);

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    workflows: capFacetValues(workflows),
    event_keys: capFacetValues(eventKeys),
    source_companies: capFacetValues(sourceCompanies),
    entity_types: capFacetValues(entityTypes),
    routes: capFacetValues(routes),
    levels: [...OBSERVABILITY_LEVELS],
    categories: [...OPERATIONAL_EVENT_CATEGORIES],
    incident_statuses: [...INCIDENT_STATUSES],
    incident_severities: [...INCIDENT_SEVERITIES],
    notification_statuses: [...NOTIFICATION_STATUSES],
    notification_purposes: [...NOTIFICATION_PURPOSES],
    notification_recipient_types: [...NOTIFICATION_RECIPIENT_TYPES],
    report_keys: [...OPERATIONAL_REPORT_KEYS],
    report_run_statuses: [...REPORT_RUN_STATUSES],
  };
}

function capFacetValues(values: unknown[]): string[] {
  return values
    .filter((value): value is string => typeof value === "string" && value !== "")
    .sort((a, b) => a.localeCompare(b))
    .slice(0, FACET_VALUE_CAP);
}

export async function exportOperationalEventsCsv(query: ObservabilityEventsQuery) {
  await connectMongo();
  const Event = getOperationalEventModel();
  const filter = buildEventFilter(query);
  const rows = await Event.find(filter)
    .select(EVENT_LIST_PROJECTION)
    .sort({ occurred_at: -1 })
    .limit(5000)
    .lean();

  const columns = [
    "occurred_at",
    "level",
    "event_key",
    "category",
    "workflow",
    "summary",
    "source_company",
    "lead_name",
    "lead_phone",
    "lead_email",
    "route",
    "entity_type",
    "entity_id",
    "run_id",
  ];
  return {
    filename: `operational-events-${new Date().toISOString().slice(0, 10)}.csv`,
    csv: toCsv(rows as Record<string, unknown>[], columns),
  };
}

export async function exportOperationalIncidentsCsv(query: ObservabilityIncidentsQuery) {
  await connectMongo();
  const Incident = getOperationalIncidentModel();
  const filter = buildIncidentFilter(query);
  const rows = await Incident.find(filter)
    .select(INCIDENT_LIST_PROJECTION)
    .sort({ last_seen_at: -1 })
    .limit(5000)
    .lean();

  const columns = [
    "status",
    "severity",
    "event_key",
    "category",
    "workflow",
    "title",
    "source_company",
    "lead_name",
    "lead_phone",
    "lead_email",
    "count",
    "first_seen_at",
    "last_seen_at",
    "owner_visible",
  ];
  return {
    filename: `operational-incidents-${new Date().toISOString().slice(0, 10)}.csv`,
    csv: toCsv(rows as Record<string, unknown>[], columns),
  };
}

function toCountRow(entry: { _id: unknown; count: number }) {
  return { key: entry._id ?? "unknown", count: entry.count };
}

function countsToMap(entries: Array<{ _id: string; count: number }>): Record<string, number> {
  const map: Record<string, number> = {};
  for (const entry of entries) {
    map[entry._id] = entry.count;
  }
  return map;
}

/**
 * Computes the UTC instant for the start of the current day in the given IANA
 * timezone. Uses the wall-clock round-trip trick so DST is handled by the
 * runtime's Intl data.
 */
function startOfDayInTimeZone(now: Date, timeZone: string): Date {
  const wall = new Date(now.toLocaleString("en-US", { timeZone }));
  const offsetMs = now.getTime() - wall.getTime();
  const midnight = new Date(wall);
  midnight.setHours(0, 0, 0, 0);
  return new Date(midnight.getTime() + offsetMs);
}

function suggestedAction(eventKey: string, category: string): string {
  if (eventKey.startsWith("sheet_sync.")) {
    return "Review failed sheet sync jobs in the Sheet Sync tab or run the failed-sheet-sync resync script.";
  }
  if (eventKey.startsWith("ringcentral.")) {
    return "Check RingCentral connectivity and recent call log / analytics cron runs.";
  }
  if (eventKey.startsWith("crm.")) {
    return "Verify the Granot CRM endpoint and credentials, then re-submit affected leads.";
  }
  if (category === "auth") {
    return "Confirm source-partner API keys and scoped route/source configuration.";
  }
  if (category === "mongo") {
    return "Check MongoDB Atlas availability and connection limits.";
  }
  return "Investigate the linked events and entity records for root cause.";
}

export function compareIncidentSeverity(
  a: IncidentSeverity,
  b: IncidentSeverity,
): number {
  return INCIDENT_SEVERITY_RANK[a] - INCIDENT_SEVERITY_RANK[b];
}
