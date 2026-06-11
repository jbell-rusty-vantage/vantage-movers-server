import { createHash } from "node:crypto";
import { connectMongo } from "../../db";
import { getNotificationDeliveryModel } from "../../models/NotificationDelivery";
import { getOperationalEventModel } from "../../models/OperationalEvent";
import { getOperationalIncidentModel } from "../../models/OperationalIncident";
import {
  getOperationalReportRunModel,
  type OperationalReportRunDocument,
} from "../../models/OperationalReportRun";
import { getSheetSyncHealth } from "../admin/adminSheetSync.service";
import { toCsv } from "../../utils/csv";
import { V1ServiceError } from "../v1ServiceError";
import type { ObservabilityReportRunInput } from "../../validation/v1.validation";

/**
 * Deterministic operational report generation.
 *
 * Every report has a stable `report_key` + integer `report_version`, runs over
 * `[from, to)` boundaries, sorts grouped rows by primary metric descending then
 * label ascending, and stores a `result_hash` computed from canonical JSON of
 * `{ report_key, report_version, period, filters, result }`. Re-running the
 * same inputs over the same data yields the same hash.
 *
 * Report definitions are fixed server-side; callers choose filters, not Mongo
 * pipelines.
 */

export const OPERATIONAL_REPORT_KEYS = [
  "daily-owner-operational-summary",
  "workflow-failure-summary",
  "source-company-issue-summary",
  "sheet-sync-health-summary",
  "ringcentral-health-summary",
  "notification-delivery-summary",
  "http-error-summary",
] as const;
export type OperationalReportKey = (typeof OPERATIONAL_REPORT_KEYS)[number];

const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_ROWS = 5000;

type ReportContext = {
  from: Date;
  to: Date;
  timezone: string;
  filters: Record<string, unknown>;
  includeResolved: boolean;
};

type ReportDefinition = {
  version: number;
  run: (ctx: ReportContext) => Promise<Record<string, unknown>>;
};

function baseEventMatch(ctx: ReportContext): Record<string, unknown> {
  const match: Record<string, unknown> = {
    occurred_at: { $gte: ctx.from, $lt: ctx.to },
    reportable: true,
  };
  if (ctx.filters.category) match.category = ctx.filters.category;
  if (ctx.filters.workflow) match.workflow = ctx.filters.workflow;
  if (ctx.filters.source_company) match.source_company = ctx.filters.source_company;
  if (ctx.filters.level) match.level = ctx.filters.level;
  return match;
}

/** Deterministic sort: primary metric desc, then label asc. */
function sortRows<T extends Record<string, unknown>>(
  rows: T[],
  metricKey: string,
  labelKey: string,
): T[] {
  return [...rows].sort((a, b) => {
    const metricDiff = Number(b[metricKey] ?? 0) - Number(a[metricKey] ?? 0);
    if (metricDiff !== 0) return metricDiff;
    return String(a[labelKey] ?? "").localeCompare(String(b[labelKey] ?? ""));
  });
}

const REPORTS: Record<OperationalReportKey, ReportDefinition> = {
  "workflow-failure-summary": {
    version: 1,
    run: async (ctx) => {
      const Event = getOperationalEventModel();
      const grouped = await Event.aggregate([
        { $match: { ...baseEventMatch(ctx), level: { $in: ["warn", "error", "critical"] } } },
        {
          $group: {
            _id: {
              category: "$category",
              workflow: "$workflow",
              event_key: "$event_key",
              level: "$level",
            },
            event_count: { $sum: 1 },
            first_seen_at: { $min: "$occurred_at" },
            last_seen_at: { $max: "$occurred_at" },
          },
        },
        {
          $sort: {
            event_count: -1,
            "_id.event_key": 1,
            "_id.workflow": 1,
            "_id.category": 1,
            "_id.level": 1,
          },
        },
        { $limit: MAX_ROWS },
      ]);
      const rows = grouped.map((g) => ({
        category: g._id.category,
        workflow: g._id.workflow,
        event_key: g._id.event_key,
        level: g._id.level,
        event_count: g.event_count,
        first_seen_at: g.first_seen_at,
        last_seen_at: g.last_seen_at,
      }));
      return { rows: sortRows(rows, "event_count", "event_key") };
    },
  },

  "source-company-issue-summary": {
    version: 1,
    run: async (ctx) => {
      const Event = getOperationalEventModel();
      const grouped = await Event.aggregate([
        {
          $match: {
            ...baseEventMatch(ctx),
            level: { $in: ["warn", "error", "critical"] },
            source_company: { $ne: null },
          },
        },
        {
          $group: {
            _id: {
              source_company: "$source_company",
              workflow: "$workflow",
              event_key: "$event_key",
            },
            event_count: { $sum: 1 },
            affected_entities: { $addToSet: "$entity_id" },
            latest_event_at: { $max: "$occurred_at" },
          },
        },
        {
          $sort: {
            event_count: -1,
            "_id.source_company": 1,
            "_id.workflow": 1,
            "_id.event_key": 1,
          },
        },
        { $limit: MAX_ROWS },
      ]);
      const rows = grouped.map((g) => ({
        source_company: g._id.source_company,
        workflow: g._id.workflow,
        event_key: g._id.event_key,
        event_count: g.event_count,
        affected_entity_count: (g.affected_entities ?? []).filter(Boolean).length,
        latest_event_at: g.latest_event_at,
      }));
      return { rows: sortRows(rows, "event_count", "source_company") };
    },
  },

  "http-error-summary": {
    version: 1,
    run: async (ctx) => {
      const Event = getOperationalEventModel();
      const grouped = await Event.aggregate([
        {
          $match: {
            ...baseEventMatch(ctx),
            category: "http",
            level: { $in: ["error", "critical"] },
          },
        },
        {
          $group: {
            _id: { route: "$route", event_key: "$event_key" },
            event_count: { $sum: 1 },
            last_seen_at: { $max: "$occurred_at" },
          },
        },
        { $sort: { event_count: -1, "_id.route": 1, "_id.event_key": 1 } },
        { $limit: MAX_ROWS },
      ]);
      const rows = grouped.map((g) => ({
        route: g._id.route,
        event_key: g._id.event_key,
        event_count: g.event_count,
        last_seen_at: g.last_seen_at,
      }));
      return { rows: sortRows(rows, "event_count", "route") };
    },
  },

  "notification-delivery-summary": {
    version: 1,
    run: async (ctx) => {
      const Delivery = getNotificationDeliveryModel();
      const grouped = await Delivery.aggregate([
        { $match: { createdAt: { $gte: ctx.from, $lt: ctx.to } } },
        {
          $group: {
            _id: { status: "$status", purpose: "$purpose" },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1, "_id.status": 1, "_id.purpose": 1 } },
        { $limit: MAX_ROWS },
      ]);
      const rows = grouped.map((g) => ({
        status: g._id.status,
        purpose: g._id.purpose,
        count: g.count,
      }));
      return { rows: sortRows(rows, "count", "status") };
    },
  },

  "ringcentral-health-summary": {
    version: 1,
    run: async (ctx) => {
      const Event = getOperationalEventModel();
      const grouped = await Event.aggregate([
        { $match: { ...baseEventMatch(ctx), category: "ringcentral" } },
        {
          $group: {
            _id: { event_key: "$event_key", level: "$level" },
            count: { $sum: 1 },
            last_seen_at: { $max: "$occurred_at" },
          },
        },
        { $sort: { count: -1, "_id.event_key": 1, "_id.level": 1 } },
        { $limit: MAX_ROWS },
      ]);
      const rows = grouped.map((g) => ({
        event_key: g._id.event_key,
        level: g._id.level,
        count: g.count,
        last_seen_at: g.last_seen_at,
      }));
      return { rows: sortRows(rows, "count", "event_key") };
    },
  },

  "sheet-sync-health-summary": {
    version: 1,
    run: async (ctx) => {
      const Event = getOperationalEventModel();
      const [health, grouped] = await Promise.all([
        getSheetSyncHealth().catch(() => null),
        Event.aggregate([
          { $match: { ...baseEventMatch(ctx), category: "sheet_sync" } },
          {
            $group: {
              _id: { event_key: "$event_key", level: "$level" },
              count: { $sum: 1 },
              last_seen_at: { $max: "$occurred_at" },
            },
          },
          { $sort: { count: -1, "_id.event_key": 1, "_id.level": 1 } },
          { $limit: MAX_ROWS },
        ]),
      ]);
      const rows = grouped.map((g) => ({
        event_key: g._id.event_key,
        level: g._id.level,
        count: g.count,
        last_seen_at: g.last_seen_at,
      }));
      return { health, rows: sortRows(rows, "count", "event_key") };
    },
  },

  "daily-owner-operational-summary": {
    version: 1,
    run: async (ctx) => {
      const Event = getOperationalEventModel();
      const Incident = getOperationalIncidentModel();
      const Delivery = getNotificationDeliveryModel();

      const [byLevel, byCategory, newIncidents, resolvedIncidents, notifications] =
        await Promise.all([
          Event.aggregate([
            { $match: baseEventMatch(ctx) },
            { $group: { _id: "$level", count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
          ]),
          Event.aggregate([
            { $match: baseEventMatch(ctx) },
            { $group: { _id: "$category", count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
          ]),
          Incident.countDocuments({
            first_seen_at: { $gte: ctx.from, $lt: ctx.to },
            ...(ctx.includeResolved ? {} : { status: { $in: ["open", "acknowledged"] } }),
          }),
          Incident.countDocuments({
            resolved_at: { $gte: ctx.from, $lt: ctx.to },
            ...(ctx.includeResolved ? {} : { status: { $in: ["open", "acknowledged"] } }),
          }),
          Promise.all([
            Delivery.countDocuments({ status: "sent", createdAt: { $gte: ctx.from, $lt: ctx.to } }),
            Delivery.countDocuments({ status: "failed", createdAt: { $gte: ctx.from, $lt: ctx.to } }),
          ]),
        ]);

      const levelMap = countsToMap(byLevel);
      const openCritical = await Incident.countDocuments({
        status: { $in: ["open", "acknowledged"] },
        severity: "critical",
      });
      const openError = await Incident.countDocuments({
        status: { $in: ["open", "acknowledged"] },
        severity: "error",
      });
      const executiveStatus =
        openCritical > 0 ? "critical" : openError > 0 ? "degraded" : "healthy";

      const [sent, failed] = notifications;
      return {
        executive_status: executiveStatus,
        events_by_level: sortRows(byLevel.map(toCountRow), "count", "key"),
        events_by_category: sortRows(byCategory.map(toCountRow), "count", "key"),
        new_incidents: newIncidents,
        resolved_incidents: resolvedIncidents,
        critical_events: levelMap.critical ?? 0,
        error_events: levelMap.error ?? 0,
        warn_events: levelMap.warn ?? 0,
        notifications_sent: sent,
        notifications_failed: failed,
      };
    },
  },
};

export function isOperationalReportKey(value: string): value is OperationalReportKey {
  return (OPERATIONAL_REPORT_KEYS as readonly string[]).includes(value);
}

/**
 * Canonicalizes a value into a deterministic JSON string (object keys sorted,
 * Dates as ISO). Used to compute the stable `result_hash`.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function computeResultHash(input: {
  report_key: string;
  report_version: number;
  period: { from: Date; to: Date; timezone: string };
  filters: Record<string, unknown>;
  result: Record<string, unknown>;
}): string {
  return createHash("sha256").update(canonicalize(input)).digest("hex");
}

export async function runOperationalReport(
  input: ObservabilityReportRunInput,
): Promise<OperationalReportRunDocument> {
  if (!isOperationalReportKey(input.report_key)) {
    throw new V1ServiceError(`Unknown report_key: ${input.report_key}`, 400);
  }
  if (input.to.getTime() <= input.from.getTime()) {
    throw new V1ServiceError("Report 'to' must be after 'from'", 400);
  }
  if (input.to.getTime() - input.from.getTime() > MAX_RANGE_MS) {
    throw new V1ServiceError("Report range exceeds the 90-day maximum", 400);
  }

  await connectMongo();
  const definition = REPORTS[input.report_key];
  const filters = normalizeFilters(input);
  const ReportRun = getOperationalReportRunModel();

  const run = await ReportRun.create({
    report_key: input.report_key,
    report_version: definition.version,
    status: "running",
    requested_by: input.requested_by ?? "admin",
    database_scope: "production",
    period: {
      from: input.from,
      to: input.to,
      timezone: input.timezone,
      granularity: "day",
    },
    filters,
    started_at: new Date(),
  });

  try {
    const ctx: ReportContext = {
      from: input.from,
      to: input.to,
      timezone: input.timezone,
      filters,
      includeResolved: Boolean(input.include_resolved),
    };
    const result = await definition.run(ctx);
    const watermark = await computeWatermark(ctx);
    const resultHash = computeResultHash({
      report_key: input.report_key,
      report_version: definition.version,
      period: { from: input.from, to: input.to, timezone: input.timezone },
      filters,
      result,
    });

    run.status = "completed";
    run.result = result;
    run.result_hash = resultHash;
    run.input_watermark = watermark;
    run.finished_at = new Date();
    await run.save();
    return run.toObject();
  } catch (error) {
    run.status = "failed";
    run.error_message = error instanceof Error ? error.message : String(error);
    run.finished_at = new Date();
    await run.save();
    throw error;
  }
}

export async function listOperationalReportRuns(query: {
  report_key?: string;
  status?: string;
  page: number;
  limit: number;
}) {
  await connectMongo();
  const ReportRun = getOperationalReportRunModel();
  const filter: Record<string, unknown> = {};
  if (query.report_key) filter.report_key = query.report_key;
  if (query.status) filter.status = query.status;

  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    ReportRun.find(filter)
      .select({ result: 0 })
      .sort({ started_at: -1 })
      .skip(skip)
      .limit(query.limit)
      .lean(),
    ReportRun.countDocuments(filter),
  ]);
  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    has_next_page: query.page * query.limit < total,
  };
}

export async function exportReportRunCsv(id: string) {
  await connectMongo();
  const ReportRun = getOperationalReportRunModel();
  const run = await ReportRun.findById(id).lean();
  if (!run) {
    throw new V1ServiceError("Report run not found", 404);
  }
  const rows = extractRows(run.result);
  const columns = rows.length > 0 ? Object.keys(rows[0]) : ["value"];
  return {
    filename: `${run.report_key}-${id}.csv`,
    csv: toCsv(rows, columns),
  };
}

function extractRows(result: unknown): Record<string, unknown>[] {
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  if (result && typeof result === "object") {
    return [result as Record<string, unknown>];
  }
  return [];
}

async function computeWatermark(ctx: ReportContext) {
  const Event = getOperationalEventModel();
  const Incident = getOperationalIncidentModel();
  const [maxEvent, eventsCount, incidentsCount] = await Promise.all([
    Event.findOne({ occurred_at: { $gte: ctx.from, $lt: ctx.to } })
      .sort({ occurred_at: -1 })
      .select({ occurred_at: 1 })
      .lean(),
    Event.countDocuments({ occurred_at: { $gte: ctx.from, $lt: ctx.to } }),
    Incident.countDocuments({ last_seen_at: { $gte: ctx.from, $lt: ctx.to } }),
  ]);
  return {
    events_max_occurred_at: maxEvent?.occurred_at ?? null,
    events_count: eventsCount,
    incidents_count: incidentsCount,
  };
}

function normalizeFilters(input: ObservabilityReportRunInput): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  if (input.category) filters.category = input.category;
  if (input.workflow) filters.workflow = input.workflow;
  if (input.source_company) filters.source_company = input.source_company;
  if (input.level) filters.level = input.level;
  if (input.include_resolved !== undefined) filters.include_resolved = input.include_resolved;
  return filters;
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
