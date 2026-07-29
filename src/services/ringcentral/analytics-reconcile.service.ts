import { logger } from "../../logger";
import { recordOperationalEvent } from "../observability";
import { CALL_LEAD_MINIMUM_ANSWERED_SECONDS } from "./call-candidate-evaluator";
import {
  listActiveRingCentralSnapshotNumbers,
  loadRingCentralRouteSnapshot,
} from "../operationsRegistry";
import { ringCentralRequest } from "./client";
import {
  getRingCentralAnalyticsEndBufferMinutes,
  getRingCentralCollectionName,
} from "./ringcentral-config";
import { getRingCentralDb } from "./ringcentral-mongo";

/**
 * Optional reconciliation snapshot job.
 *
 * Analytics Aggregate returns grouped counters/timers (not caller-level lead
 * records), so it is NOT used to create leads. Instead this job stores a daily
 * rollup of inbound answered calls >=120s per company number, which the owner
 * can compare against the leads actually produced to catch systematic
 * under/over counting in the webhook + cron pipeline.
 *
 * Caveat: Analytics `timeTo` must not be in the future (ANL-302), so the
 * window end is always trimmed by the configured buffer.
 */
const ANALYTICS_ENDPOINT =
  "/analytics/calls/v1/accounts/~/aggregation/fetch?page=1&perPage=200";

export type RingCentralAnalyticsSnapshotSummary = {
  ranAt: string;
  windowFrom: string;
  windowTo: string;
  groupCount: number;
  totalAnsweredOver120: number;
};

export async function runRingCentralAnalyticsReconcile(
  options: { hoursBack?: number; now?: Date } = {},
): Promise<RingCentralAnalyticsSnapshotSummary> {
  const now = options.now ?? new Date();
  const bufferMs = getRingCentralAnalyticsEndBufferMinutes() * 60 * 1000;
  const windowTo = new Date(now.getTime() - bufferMs);
  const windowFrom = new Date(
    windowTo.getTime() - (options.hoursBack ?? 24) * 60 * 60 * 1000,
  );
  const routeSnapshot = await loadRingCentralRouteSnapshot();
  const diagnosticNumbers = listActiveRingCentralSnapshotNumbers(routeSnapshot);

  const body = {
    grouping: { groupBy: "CompanyNumbers", keys: [] as string[] },
    timeSettings: {
      timeZone: "America/New_York",
      timeRange: {
        timeFrom: windowFrom.toISOString(),
        timeTo: windowTo.toISOString(),
      },
    },
    callFilters: {
      directions: ["Inbound"],
      callResponses: ["Answered"],
      callDuration: { minSeconds: CALL_LEAD_MINIMUM_ANSWERED_SECONDS },
      calledNumbers: diagnosticNumbers,
    },
    responseOptions: {
      counters: {
        allCalls: { aggregationType: "Sum" },
        callsByResponse: { aggregationType: "Sum" },
      },
      timers: { allCallsDuration: { aggregationType: "Sum" } },
    },
  };

  const payload = await ringCentralRequest("POST", ANALYTICS_ENDPOINT, body);
  const records = Array.isArray(payload?.data?.records)
    ? payload.data.records
    : Array.isArray(payload?.records)
      ? payload.records
      : [];

  const groups = records.map((record: any) => ({
    key: stringOrNull(record?.key),
    name: stringOrNull(record?.info?.name),
    answeredOver120: numberOrZero(record?.counters?.allCalls?.values),
    durationSeconds: numberOrZero(record?.timers?.allCalls?.values),
  }));
  const totalAnsweredOver120 = groups.reduce(
    (sum: number, group: { answeredOver120: number }) => sum + group.answeredOver120,
    0,
  );

  const summary: RingCentralAnalyticsSnapshotSummary = {
    ranAt: now.toISOString(),
    windowFrom: windowFrom.toISOString(),
    windowTo: windowTo.toISOString(),
    groupCount: groups.length,
    totalAnsweredOver120,
  };

  await storeSnapshot({ ...summary, groups, capturedAt: now });
  logger.info({ msg: "ringcentral.analytics_reconcile.completed", ...summary });

  await recordOperationalEvent({
    level: "info",
    eventKey: "ringcentral.analytics_reconcile.completed",
    category: "ringcentral",
    workflow: "ringcentral_analytics_reconcile",
    summary: "RingCentral analytics reconcile snapshot completed.",
    runId: summary.ranAt,
    details: {
      windowFrom: summary.windowFrom,
      windowTo: summary.windowTo,
      groupCount: summary.groupCount,
      totalAnsweredOver120: summary.totalAnsweredOver120,
    },
    autoResolveKey: `ringcentral.analytics_reconcile.failed:${
      process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development"
    }`,
  });

  return summary;
}

async function storeSnapshot(snapshot: Record<string, unknown>): Promise<void> {
  const db = await getRingCentralDb();
  const collection = db.collection(getRingCentralCollectionName("analyticsSnapshots"));
  await collection.insertOne({ provider: "ringcentral", ...snapshot });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
