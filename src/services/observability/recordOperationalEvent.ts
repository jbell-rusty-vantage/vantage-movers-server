import type { Request } from "express";
import {
  getObservabilityBulkBatchSize,
  isObservabilityEnabled,
  shouldPersistEventLevel,
  shouldWriteObservabilityCollections,
  type IncidentSeverity,
  type ObservabilityLevel,
  type OperationalEventCategory,
  type PiiPolicy,
} from "../../config/domain/observability";
import { connectMongo } from "../../db";
import { logger } from "../../logger";
import {
  getOperationalEventModel,
  type OperationalEventDocument,
} from "../../models/OperationalEvent";
import { buildDedupeKey, computeFingerprint } from "./fingerprint";
import { normalizeLeadIdentity } from "./leadIdentity";
import { dispatchEventNotifications } from "./notificationPolicy";
import { sanitizeEventDetails } from "./operationalEventSanitizer";
import {
  autoResolveIncidents,
  upsertIncidentForEvent,
} from "./operationalIncident.service";
import { buildRequestEventContext } from "./requestEventContext";
import {
  captureOperationalEventForTest,
  isTestObservabilitySinkActive,
} from "./testObservabilitySink";

/**
 * Records a single operational event: persists it to `operational_events`,
 * upserts an incident for failure-level events, auto-resolves matching
 * incidents on success events, and evaluates inline notification policy.
 *
 * Observability is best-effort: this function never throws to the caller and
 * never alters the business workflow. Failures are logged via pino.
 */

export type RecordOperationalEventInput = {
  level: ObservabilityLevel;
  eventKey: string;
  category: OperationalEventCategory;
  workflow: string;
  summary: string;
  details?: Record<string, unknown>;
  trace?: Record<string, unknown> | null;
  occurredAt?: Date;
  /** Express request to derive safe context from (request id, route, method). */
  request?: Request | null;
  requestId?: string | number | object;
  route?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  entity?: { type: string; id: string };
  leadIdentity?: { name?: string | null; phone?: string | null; email?: string | null };
  sourceCompany?: string | null;
  jobNo?: string | null;
  runId?: string | null;
  dedupeKey?: string;
  errorMessage?: string | null;
  notificationCandidate?: boolean;
  reportable?: boolean;
  ownerVisible?: boolean;
  piiPolicy?: PiiPolicy;
  /** When set on a success event, resolves open incidents with this dedupe key. */
  autoResolveKey?: string;
};

const FAILURE_LEVELS: readonly ObservabilityLevel[] = ["warn", "error", "critical"];

function resolveEnvironment(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
}

function stringifyRequestId(
  requestId: string | number | object | undefined,
): string | null {
  if (requestId === undefined || requestId === null) {
    return null;
  }
  if (typeof requestId === "string") {
    return requestId;
  }
  if (typeof requestId === "number") {
    return String(requestId);
  }
  return null;
}

function logLevelForEvent(level: ObservabilityLevel): "debug" | "info" | "warn" | "error" {
  if (level === "debug") return "debug";
  if (level === "info") return "info";
  if (level === "warn") return "warn";
  return "error";
}

function mirrorToPino(input: RecordOperationalEventInput): void {
  const method = logLevelForEvent(input.level);
  logger[method]({
    msg: input.eventKey,
    observability_level: input.level,
    category: input.category,
    workflow: input.workflow,
    source_company: input.sourceCompany ?? undefined,
    entity_id: input.entity?.id,
    run_id: input.runId ?? undefined,
  });
}

export async function recordOperationalEvent(
  input: RecordOperationalEventInput,
): Promise<OperationalEventDocument | null> {
  // Always mirror to pino so Vercel log search and Mongo events share keys.
  mirrorToPino(input);

  if (isTestObservabilitySinkActive()) {
    captureOperationalEventForTest(input);
    return null;
  }

  if (!isObservabilityEnabled()) {
    return null;
  }
  if (!shouldWriteObservabilityCollections()) {
    // log_only mode: pino mirror already happened; no Mongo writes.
    return null;
  }

  try {
    await connectMongo();

    const now = new Date();
    const occurredAt = input.occurredAt ?? now;
    const environment = resolveEnvironment();

    const requestContext = input.request
      ? buildRequestEventContext(input.request)
      : null;

    const identity = normalizeLeadIdentity(input.leadIdentity);
    const hasIdentity = Boolean(
      identity.lead_name || identity.lead_phone || identity.lead_email,
    );

    const route = input.route ?? requestContext?.route ?? null;
    const method = input.method ?? requestContext?.method ?? null;
    const requestId =
      requestContext?.request_id ?? stringifyRequestId(input.requestId);

    const fingerprintInput = {
      environment,
      eventKey: input.eventKey,
      workflow: input.workflow,
      entityType: input.entity?.type ?? null,
      entityId: input.entity?.id ?? null,
      route,
      errorMessage: input.errorMessage ?? null,
      dedupeKey: input.dedupeKey ?? null,
    };
    const fingerprint = computeFingerprint(fingerprintInput);
    const dedupeKey = buildDedupeKey(fingerprintInput);

    const isFailure = FAILURE_LEVELS.includes(input.level);
    const notificationCandidate =
      input.notificationCandidate ??
      (input.level === "error" || input.level === "critical");
    const ownerVisible =
      input.ownerVisible ?? (hasIdentity || input.level === "critical");
    if (!shouldPersistEventLevel(input.level, { ownerVisible })) {
      return null;
    }
    const piiPolicy: PiiPolicy =
      input.piiPolicy ?? (hasIdentity ? "internal" : "none");

    const Event = getOperationalEventModel();
    const event = await Event.create({
      occurred_at: occurredAt,
      received_at: now,
      level: input.level,
      event_key: input.eventKey,
      category: input.category,
      workflow: input.workflow,
      summary: input.summary,
      details: sanitizeEventDetails(input.details),
      fingerprint,
      dedupe_key: dedupeKey,
      environment,
      service: "vantage-main-server",
      region: process.env.VERCEL_REGION ?? null,
      request_id: requestId,
      route,
      method,
      status_code: input.statusCode ?? null,
      duration_ms: input.durationMs ?? null,
      entity_type: input.entity?.type ?? null,
      entity_id: input.entity?.id ?? null,
      lead_name: identity.lead_name,
      lead_phone: identity.lead_phone,
      lead_email: identity.lead_email,
      source_company: input.sourceCompany ?? null,
      job_no: input.jobNo ?? null,
      run_id: input.runId ?? null,
      trace: input.trace ?? null,
      pii_policy: piiPolicy,
      notification_candidate: notificationCandidate,
      reportable: input.reportable ?? true,
    });

    let incident = null;

    if (isFailure) {
      try {
        const upsert = await upsertIncidentForEvent({
          eventId: event._id,
          severity: input.level as IncidentSeverity,
          fingerprint,
          dedupeKey,
          eventKey: input.eventKey,
          category: input.category,
          workflow: input.workflow,
          title: input.summary.slice(0, 200),
          summary: input.summary,
          environment,
          service: "vantage-main-server",
          sourceCompany: input.sourceCompany ?? null,
          route,
          entityType: input.entity?.type ?? null,
          entityId: input.entity?.id ?? null,
          leadName: identity.lead_name,
          leadPhone: identity.lead_phone,
          leadEmail: identity.lead_email,
          runId: input.runId ?? null,
          lastDetails: sanitizeEventDetails(input.details),
          ownerVisible,
          occurredAt,
        });
        incident = upsert.incident;
        await Event.updateOne(
          { _id: event._id },
          { $set: { incident_id: incident._id } },
        );
        event.incident_id = incident._id;
      } catch (error) {
        // Event remains searchable even if incident upsert fails.
        logger.warn({
          msg: "observability.incident.upsert_failed",
          event_key: input.eventKey,
          err: error,
        });
      }
    }

    if (input.autoResolveKey) {
      try {
        await autoResolveIncidents({ dedupeKey: input.autoResolveKey, now });
      } catch (error) {
        logger.warn({
          msg: "observability.incident.auto_resolve_failed",
          event_key: input.eventKey,
          err: error,
        });
      }
    }

    try {
      const dispatchResult = await dispatchEventNotifications({ event, incident });
      if (dispatchResult && !dispatchResult.ok && !dispatchResult.skipped) {
        // Record (but never re-notify for) a notification failure. The
        // `notification` category short-circuits notification policy, so this
        // cannot loop.
        await recordOperationalEvent({
          level: "error",
          eventKey: "notification.email.failed",
          category: "notification",
          workflow: "email_notification",
          summary: "Owner/developer email notification failed to send.",
          details: {
            source_event_key: input.eventKey,
            source_event_id: event._id.toString(),
            error: dispatchResult.errorMessage ?? "unknown",
          },
          notificationCandidate: false,
          reportable: true,
        });
      }
    } catch (error) {
      logger.warn({
        msg: "observability.notification.dispatch_failed",
        event_key: input.eventKey,
        err: error,
      });
    }

    return event;
  } catch (error) {
    logger.error({
      msg: "observability.record_event_failed",
      event_key: input.eventKey,
      err: error,
    });
    return null;
  }
}

/**
 * Bulk-records many events for scripts/backfills. Inserts sanitized docs with
 * an unordered `bulkWrite` in batches; does not upsert incidents or evaluate
 * notifications. Do not use from normal request handlers.
 */
export async function recordOperationalEventsBulk(
  inputs: RecordOperationalEventInput[],
): Promise<number> {
  if (isTestObservabilitySinkActive()) {
    for (const input of inputs) {
      captureOperationalEventForTest(input);
    }
    return 0;
  }

  if (!shouldWriteObservabilityCollections() || inputs.length === 0) {
    return 0;
  }

  await connectMongo();
  const Event = getOperationalEventModel();
  const environment = resolveEnvironment();
  const batchSize = getObservabilityBulkBatchSize();
  let inserted = 0;

  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize);
    const ops = batch.map((input) => {
      const occurredAt = input.occurredAt ?? new Date();
      const identity = normalizeLeadIdentity(input.leadIdentity);
      const fingerprintInput = {
        environment,
        eventKey: input.eventKey,
        workflow: input.workflow,
        entityType: input.entity?.type ?? null,
        entityId: input.entity?.id ?? null,
        route: input.route ?? null,
        errorMessage: input.errorMessage ?? null,
        dedupeKey: input.dedupeKey ?? null,
      };
      return {
        insertOne: {
          document: {
            occurred_at: occurredAt,
            received_at: new Date(),
            level: input.level,
            event_key: input.eventKey,
            category: input.category,
            workflow: input.workflow,
            summary: input.summary,
            details: sanitizeEventDetails(input.details),
            fingerprint: computeFingerprint(fingerprintInput),
            dedupe_key: buildDedupeKey(fingerprintInput),
            environment,
            service: "vantage-main-server",
            region: process.env.VERCEL_REGION ?? null,
            request_id: stringifyRequestId(input.requestId),
            route: input.route ?? null,
            method: input.method ?? null,
            status_code: input.statusCode ?? null,
            duration_ms: input.durationMs ?? null,
            entity_type: input.entity?.type ?? null,
            entity_id: input.entity?.id ?? null,
            lead_name: identity.lead_name,
            lead_phone: identity.lead_phone,
            lead_email: identity.lead_email,
            source_company: input.sourceCompany ?? null,
            job_no: input.jobNo ?? null,
            run_id: input.runId ?? null,
            trace: input.trace ?? null,
            pii_policy: input.piiPolicy ?? "none",
            incident_id: null,
            notification_candidate: input.notificationCandidate ?? false,
            reportable: input.reportable ?? true,
          },
        },
      };
    });

    const result = await Event.bulkWrite(ops, { ordered: false });
    inserted += result.insertedCount ?? 0;
  }

  return inserted;
}
