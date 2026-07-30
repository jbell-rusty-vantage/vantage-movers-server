import { logger } from "../../logger";
import { recordOperationalEvent } from "../observability";
import { ringCentralRequest } from "./client";
import { vetRingCentralCallLogRecord } from "./call-log-vetting";
import {
  loadRingCentralRouteSnapshot,
  recordRingCentralRouteObservation,
} from "../operationsRegistry";
import {
  getCallLogSyncState,
  recordCallLogSyncError,
  recordCallLogSyncSuccess,
} from "./call-log-sync-state.store";
import {
  getRingCentralCallLogSyncLookbackMinutes,
  getRingCentralCallLogSyncOverlapMinutes,
  getRingCentralCallLogSyncRollingLookbackMinutes,
} from "./ringcentral-config";
import {
  ingestRingCentralQualifiedCall,
  type RingCentralIngestAction,
  type RingCentralQualifiedCall,
} from "./ringcentral-call-lead-ingest.service";

/**
 * Scheduled Call Log sync (the cron half of the hybrid strategy).
 *
 * Each run reads the high-water-mark cursor, fetches detailed inbound Call Log
 * records for a conservative rolling window. On normal runs the start is the
 * earlier of `[lastSyncTo - overlap]` and `[now - rollingLookback]`; on first
 * run it uses `[now - lookback]`, still honoring the rolling floor. This guards
 * against very long calls and RingCentral finalization lag: a record whose
 * `startTime` has already fallen behind the short overlap can still be seen on
 * a later run after it appears in Call Log. Because ingest is idempotent by
 * `telephonySessionId` / `callLogId`, repeated scans safely skip already
 * processed calls.
 *
 * The cursor only advances on success; an error leaves the window intact so
 * the next run retries the same range.
 */
const PER_PAGE = 250;
const MAX_PAGES = 20;

export type RingCentralCallLogSyncSummary = {
  ranAt: string;
  windowFrom: string;
  windowTo: string;
  fetchedRecords: number;
  candidateRecords: number;
  qualifiedRecords: number;
  ingestActions: Record<RingCentralIngestAction, number>;
  leadsCreated: number;
  duplicatesFlagged: number;
  errors: string[];
};

export async function runRingCentralCallLogSync(
  now: Date = new Date(),
): Promise<RingCentralCallLogSyncSummary> {
  const windowTo = now;
  const windowFrom = await resolveWindowStart(windowTo);

  const summary: RingCentralCallLogSyncSummary = {
    ranAt: now.toISOString(),
    windowFrom: windowFrom.toISOString(),
    windowTo: windowTo.toISOString(),
    fetchedRecords: 0,
    candidateRecords: 0,
    qualifiedRecords: 0,
    ingestActions: {
      lead_created: 0,
      lead_created_duplicate: 0,
      shadow_recorded: 0,
      dry_run: 0,
      skipped_already_processed: 0,
    },
    leadsCreated: 0,
    duplicatesFlagged: 0,
    errors: [],
  };

  try {
    const routeSnapshot = await loadRingCentralRouteSnapshot();
    const records = await fetchDetailedInboundCallLog(windowFrom, windowTo);
    summary.fetchedRecords = records.length;

    for (const record of records) {
      const vet = vetRingCentralCallLogRecord(record, routeSnapshot);
      if (vet.matchedTargetNumber) {
        summary.candidateRecords += 1;
        if (vet.routeResolution) {
          await recordRingCentralRouteObservation(
            vet.routeResolution.route_id,
            "call_log",
            vet.startTime ?? now,
            vet.targetName,
          );
        }
      }
      if (
        vet.rejectionReasons.length > 0 ||
        !vet.sourceCompany ||
        !vet.callerPhoneNumber ||
        !vet.routeResolution
      ) {
        continue;
      }
      summary.qualifiedRecords += 1;

      const qualifiedCall: RingCentralQualifiedCall = {
        ingestionSource: "call_log_sync",
        telephonySessionId: vet.telephonySessionId,
        sessionId: vet.sessionId,
        partyId: null,
        callLogId: vet.callLogId,
        sourceCompany: vet.sourceCompany,
        sourceLabel: vet.sourceLabel,
        routeResolution: vet.routeResolution,
        callerPhoneNumber: vet.callerPhoneNumber,
        callerName: vet.callerName,
        targetPhoneNumber: vet.targetPhoneNumber ?? "",
        targetName: vet.targetName,
        answeredAt: vet.startTime,
        terminalAt:
          vet.startTime && vet.durationSeconds !== null
            ? new Date(vet.startTime.getTime() + vet.durationSeconds * 1000)
            : null,
        startTime: vet.startTime,
        durationSeconds: vet.durationSeconds ?? 0,
        qualificationReason: "call_log_inbound_target_answered_over_120s",
      };

      const result = await ingestRingCentralQualifiedCall(qualifiedCall, now);
      summary.ingestActions[result.action] += 1;
      if (result.action === "lead_created" || result.action === "lead_created_duplicate") {
        summary.leadsCreated += 1;
      }
      if (result.duplicate) {
        summary.duplicatesFlagged += 1;
      }
    }

    await recordCallLogSyncSuccess({
      syncFrom: windowFrom,
      syncTo: windowTo,
      processedCount: summary.fetchedRecords,
      qualifiedCount: summary.qualifiedRecords,
      leadActionCount: summary.leadsCreated,
      now,
    });

    logger.info({ msg: "ringcentral.call_log_sync.completed", ...summary });

    await recordOperationalEvent({
      level: "info",
      eventKey: "ringcentral.call_log_sync.completed",
      category: "ringcentral",
      workflow: "ringcentral_call_log_sync",
      summary: "RingCentral Call Log sync completed.",
      runId: summary.ranAt,
      details: {
        windowFrom: summary.windowFrom,
        windowTo: summary.windowTo,
        fetchedRecords: summary.fetchedRecords,
        candidateRecords: summary.candidateRecords,
        qualifiedRecords: summary.qualifiedRecords,
        leadsCreated: summary.leadsCreated,
        duplicatesFlagged: summary.duplicatesFlagged,
        ingestActions: summary.ingestActions,
      },
      // A clean run resolves any open Call Log sync failure incident.
      autoResolveKey:
        summary.errors.length === 0
          ? `ringcentral.call_log_sync.failed:${resolveEnvironmentName()}`
          : undefined,
    });

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary.errors.push(message);
    await recordCallLogSyncError({ error: message, now });
    logger.error({
      err: error,
      msg: "ringcentral.call_log_sync.failed",
      windowFrom: summary.windowFrom,
      windowTo: summary.windowTo,
    });

    await recordOperationalEvent({
      level: "error",
      eventKey: "ringcentral.call_log_sync.failed",
      category: "ringcentral",
      workflow: "ringcentral_call_log_sync",
      summary: "RingCentral Call Log sync failed.",
      dedupeKey: `ringcentral.call_log_sync.failed:${resolveEnvironmentName()}`,
      details: {
        windowFrom: summary.windowFrom,
        windowTo: summary.windowTo,
        errorName: error instanceof Error ? error.name : "Error",
        causeMessage: message,
      },
      errorMessage: message,
      notificationCandidate: true,
    });

    throw error;
  }
}

function resolveEnvironmentName(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
}

async function resolveWindowStart(windowTo: Date): Promise<Date> {
  const state = await getCallLogSyncState();
  const overlapMs = getRingCentralCallLogSyncOverlapMinutes() * 60 * 1000;
  const rollingLookbackMs =
    getRingCentralCallLogSyncRollingLookbackMinutes() * 60 * 1000;
  const rollingWindowStart = new Date(windowTo.getTime() - rollingLookbackMs);
  if (state?.lastSyncTo) {
    const cursorWindowStart = new Date(state.lastSyncTo.getTime() - overlapMs);
    return earlierDate(cursorWindowStart, rollingWindowStart);
  }
  const lookbackMs = getRingCentralCallLogSyncLookbackMinutes() * 60 * 1000;
  const initialWindowStart = new Date(windowTo.getTime() - lookbackMs);
  return earlierDate(initialWindowStart, rollingWindowStart);
}

function earlierDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

async function fetchDetailedInboundCallLog(
  from: Date,
  to: Date,
): Promise<unknown[]> {
  const records: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      dateFrom: from.toISOString(),
      dateTo: to.toISOString(),
      direction: "Inbound",
      type: "Voice",
      view: "Detailed",
      perPage: String(PER_PAGE),
      page: String(page),
    });
    const payload = await ringCentralRequest(
      "GET",
      `/restapi/v1.0/account/~/call-log?${query.toString()}`,
    );
    const pageRecords = Array.isArray(payload?.records) ? payload.records : [];
    records.push(...pageRecords);
    if (pageRecords.length < PER_PAGE) {
      break;
    }
  }
  return records;
}
