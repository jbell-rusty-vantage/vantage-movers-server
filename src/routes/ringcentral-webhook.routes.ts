import { Router, type NextFunction, type Request, type Response } from "express";
import type { Logger } from "pino";
import { logger as rootLogger } from "../logger";
import {
  findRingCentralCallCandidatesByTelephonySessionId,
  listRingCentralCallCandidateDecisions,
  listRingCentralCallCandidates,
  storeRingCentralCallCandidateDecision,
  upsertRingCentralCallCandidateFromEvent,
} from "../services/ringcentral/call-candidate-store";
import {
  findRingCentralCallSession,
  listRingCentralCallSessionDecisions,
  listRingCentralCallSessions,
  processRingCentralCallSession,
} from "../services/ringcentral/call-session-store";
import type { RingCentralCallSessionDocument } from "../services/ringcentral/call-session-types";
import {
  getRingCentralRuntimeConfig,
  isRingCentralWebhookEnabled,
} from "../services/ringcentral/ringcentral-config";
import {
  ingestRingCentralQualifiedCall,
  type RingCentralQualifiedCall,
} from "../services/ringcentral/ringcentral-call-lead-ingest.service";
import type { NormalizedRingCentralPartyEvent } from "../services/ringcentral/call-candidate-types";
import {
  loadRingCentralRouteSnapshot,
  recordRingCentralRouteObservation,
  resolveRingCentralInboundRoute,
} from "../services/operationsRegistry";
import { listProcessedCalls } from "../services/ringcentral/processed-calls-store";
import { recordOperationalEvent } from "../services/observability";
import { normalizeRingCentralWebhookPayload } from "../services/ringcentral/webhook-event-normalizer";
import {
  captureRingCentralWebhookEvent,
  listRingCentralWebhookEvents,
  previewRingCentralWebhookPayload,
  sanitizeHeaders,
} from "../services/ringcentral/webhook-capture";

const router = Router();

type RequestWithLogger = Request & {
  log?: Logger;
};

type CandidateUpdateResponse = {
  telephonySessionId: string;
  partyId: string;
  decisionStatus: string;
  wouldCreateCallLead: boolean;
  decisionReason: string;
};

router.get("/api/webhooks/ringcentral", (_req: Request, res: Response) => {
  return res.json({
    ok: true,
    provider: "ringcentral",
    route: "/api/webhooks/ringcentral",
    method: "GET",
    ready: true,
  });
});

router.post("/api/webhooks/ringcentral", async (req: Request, res: Response) => {
  const receivedAt = new Date();
  const log = (req as RequestWithLogger).log ?? rootLogger;
  const validationToken = getValidationToken(req);
  const validationTokenPresent = validationToken !== null;
  const headers = sanitizeHeaders(headersToRecord(req));
  const normalizedPreview = previewRingCentralWebhookPayload(req.body);

  log.info({
    msg: "ringcentral.webhook.received",
    receivedAt: receivedAt.toISOString(),
    method: req.method,
    validationTokenPresent,
    contentType: req.get("content-type") ?? null,
    userAgent: req.get("user-agent") ?? null,
    eventHeaders: getEventHeaders(headers),
    subscriptionId: normalizedPreview.subscriptionId,
    telephonySessionId: normalizedPreview.telephonySessionId,
    partyId: normalizedPreview.partyId,
    event: normalizedPreview.event,
  });

  if (validationToken) {
    res.setHeader("Validation-Token", validationToken);
  }

  try {
    const captureResult = await captureRingCentralWebhookEvent({
      receivedAt,
      validationTokenPresent,
      headers,
      payload: req.body ?? null,
    });

    // `RINGCENTRAL_WEBHOOK_ENABLED=false` acknowledges + audits the raw event
    // but performs no candidate/session/lead processing (e.g. to run cron-only
    // strategy B while keeping the endpoint reachable for RC validation).
    if (!isRingCentralWebhookEnabled()) {
      log.info({
        msg: "ringcentral.webhook.processing.disabled",
        subscriptionId: normalizedPreview.subscriptionId,
        telephonySessionId: normalizedPreview.telephonySessionId,
      });
      return res.status(200).json({
        ok: true,
        provider: "ringcentral",
        storedRawEvent: captureResult.storedRawEvent,
        duplicateRawEvent: captureResult.duplicate,
        processingEnabled: false,
        normalizedPartyEvents: 0,
        candidateUpdates: [],
        sessionUpdates: [],
      });
    }

    const normalizedPartyEvents = await enrichRingCentralSourceEvents(
      normalizeRingCentralWebhookPayload(
        req.body ?? null,
        receivedAt,
      ),
    );
    const candidateUpdates = await processCandidateUpdates(
      normalizedPartyEvents,
      log,
    );
    const sessionUpdates = await processSessionsAndIngest(
      normalizedPartyEvents,
      log,
    );

    return res.status(200).json({
      ok: true,
      provider: "ringcentral",
      storedRawEvent: captureResult.storedRawEvent,
      duplicateRawEvent: captureResult.duplicate,
      processingEnabled: true,
      normalizedPartyEvents: normalizedPartyEvents.length,
      candidateUpdates,
      sessionUpdates,
    });
  } catch (error) {
    log.error({ err: error, msg: "ringcentral.webhook.processing.failed" });
    return res.status(200).json({
      ok: true,
      provider: "ringcentral",
      storedRawEvent: false,
      normalizedPartyEvents: 0,
      candidateUpdates: [],
      warning: "webhook_acknowledged_processing_failed",
    });
  }
});

router.get(
  "/api/dev/ringcentral/webhook-events",
  requireRingCentralDebugAccess,
  async (req: Request, res: Response) => {
    const limit = parseLimit(req.query.limit);
    const events = await listRingCentralWebhookEvents(limit);
    return res.json({ ok: true, provider: "ringcentral", limit, events });
  },
);

router.get(
  "/api/dev/ringcentral/call-candidates",
  requireRingCentralDebugAccess,
  async (req: Request, res: Response) => {
    const limit = parseLimit(req.query.limit);
    const candidates = await listRingCentralCallCandidates(limit);
    return res.json({ ok: true, provider: "ringcentral", limit, candidates });
  },
);

router.get(
  "/api/dev/ringcentral/call-candidate-decisions",
  requireRingCentralDebugAccess,
  async (req: Request, res: Response) => {
    const limit = parseLimit(req.query.limit);
    const decisions = await listRingCentralCallCandidateDecisions(limit);
    return res.json({ ok: true, provider: "ringcentral", limit, decisions });
  },
);

router.get(
  "/api/dev/ringcentral/call-sessions",
  requireRingCentralDebugAccess,
  async (req: Request, res: Response) => {
    const limit = parseLimit(req.query.limit);
    const sessions = await listRingCentralCallSessions(limit);
    return res.json({ ok: true, provider: "ringcentral", limit, sessions });
  },
);

router.get(
  "/api/dev/ringcentral/call-session-decisions",
  requireRingCentralDebugAccess,
  async (req: Request, res: Response) => {
    const limit = parseLimit(req.query.limit);
    const decisions = await listRingCentralCallSessionDecisions(limit);
    return res.json({ ok: true, provider: "ringcentral", limit, decisions });
  },
);

router.get(
  "/api/dev/ringcentral/processed-calls",
  requireRingCentralDebugAccess,
  async (req: Request, res: Response) => {
    const limit = parseLimit(req.query.limit);
    const processedCalls = await listProcessedCalls(limit);
    return res.json({ ok: true, provider: "ringcentral", limit, processedCalls });
  },
);

router.get(
  "/api/dev/ringcentral/config",
  requireRingCentralDebugAccess,
  (_req: Request, res: Response) => {
    return res.json({
      ok: true,
      provider: "ringcentral",
      config: getRingCentralRuntimeConfig(),
    });
  },
);

router.get(
  "/api/dev/ringcentral/call-candidates/:telephonySessionId",
  requireRingCentralDebugAccess,
  async (req: Request, res: Response) => {
    const telephonySessionId = getSingleRouteParam(req.params.telephonySessionId);
    if (!telephonySessionId) {
      return res.status(400).json({ ok: false, error: "telephonySessionId is required" });
    }

    const candidates = await findRingCentralCallCandidatesByTelephonySessionId(
      telephonySessionId,
    );
    const session = await findRingCentralCallSession(telephonySessionId);
    return res.json({
      ok: true,
      provider: "ringcentral",
      telephonySessionId,
      session,
      candidates,
    });
  },
);

function getValidationToken(req: Request): string | null {
  const token = req.get("validation-token") ?? req.get("Validation-Token");
  return token && token.trim() ? token : null;
}

function headersToRecord(req: Request): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      headers[key] = value;
      continue;
    }
    if (typeof value === "string") {
      headers[key] = value;
    }
  }
  return headers;
}

function getEventHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  const eventHeaders: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (
      key.includes("event") ||
      key.startsWith("x-ringcentral") ||
      key.startsWith("ringcentral")
    ) {
      if (typeof value === "string" || Array.isArray(value)) {
        eventHeaders[key] = value;
      }
    }
  }
  return eventHeaders;
}

async function processCandidateUpdates(
  normalizedPartyEvents: NormalizedRingCentralPartyEvent[],
  log: Logger,
): Promise<CandidateUpdateResponse[]> {
  if (!process.env.MONGO_URI?.trim()) {
    return [];
  }

  const updates: CandidateUpdateResponse[] = [];
  for (const normalizedPartyEvent of normalizedPartyEvents) {
    const { candidate, decision } =
      await upsertRingCentralCallCandidateFromEvent(normalizedPartyEvent);
    await storeRingCentralCallCandidateDecision(candidate, decision);
    log.info({
      msg: "ringcentral.webhook.candidate_decision",
      telephonySessionId: candidate.telephonySessionId,
      partyId: candidate.partyId,
      decisionStatus: decision.decisionStatus,
      decisionReason: decision.decisionReason,
      wouldCreateCallLead: decision.wouldCreateCallLead,
    });
    updates.push({
      telephonySessionId: candidate.telephonySessionId,
      partyId: candidate.partyId,
      decisionStatus: decision.decisionStatus,
      wouldCreateCallLead: decision.wouldCreateCallLead,
      decisionReason: decision.decisionReason,
    });
  }

  return updates;
}

type SessionUpdateResponse = {
  telephonySessionId: string;
  decisionStatus: string;
  statusChanged: boolean;
  wouldCreateCallLead: boolean;
  ingestEligible: boolean;
  ingestAction: string | null;
};

/**
 * For every telephony session touched by this webhook, rebuild the
 * session-level aggregate, persist decision transitions, and — when the
 * session is qualified AND terminal — hand it to the shared ingest service.
 * The ingest service enforces idempotency + duplicate rules and respects the
 * create/shadow/dry-run env posture, so this is safe to call repeatedly.
 */
async function processSessionsAndIngest(
  normalizedPartyEvents: NormalizedRingCentralPartyEvent[],
  log: Logger,
): Promise<SessionUpdateResponse[]> {
  if (!process.env.MONGO_URI?.trim()) {
    return [];
  }

  const telephonySessionIds = [
    ...new Set(normalizedPartyEvents.map((event) => event.telephonySessionId)),
  ];
  const updates: SessionUpdateResponse[] = [];

  for (const telephonySessionId of telephonySessionIds) {
    const result = await processRingCentralCallSession(telephonySessionId);
    if (!result) {
      continue;
    }

    let ingestAction: string | null = null;
    if (result.document.ingestEligible) {
      ingestAction = await ingestSessionLead(result.document, log);
    }

    log.info({
      msg: "ringcentral.webhook.session_decision",
      telephonySessionId,
      decisionStatus: result.document.decisionStatus,
      statusChanged: result.statusChanged,
      wouldCreateCallLead: result.document.wouldCreateCallLead,
      ingestEligible: result.document.ingestEligible,
      ingestAction,
    });

    updates.push({
      telephonySessionId,
      decisionStatus: result.document.decisionStatus,
      statusChanged: result.statusChanged,
      wouldCreateCallLead: result.document.wouldCreateCallLead,
      ingestEligible: result.document.ingestEligible,
      ingestAction,
    });
  }

  return updates;
}

async function enrichRingCentralSourceEvents(
  events: NormalizedRingCentralPartyEvent[],
): Promise<NormalizedRingCentralPartyEvent[]> {
  const snapshot = await loadRingCentralRouteSnapshot();
  return Promise.all(events.map(async (event) => {
    const callStartedAt = event.callStartedAt;
    if (!callStartedAt) return event;
    const resolution = resolveRingCentralInboundRoute(
      snapshot,
      event.normalizedToPhoneNumber ?? event.toPhoneNumber,
      callStartedAt,
    );
    if (!resolution) return event;
    await recordRingCentralRouteObservation(
      resolution.route_id,
      "webhook",
      event.receivedAt,
      event.toName,
    );
    return {
      ...event,
      targetMatched: true,
      sourceCompany: resolution.company_slug,
      sourceLabel: resolution.crm_label_snapshot,
      routeResolution: resolution,
    };
  }));
}

async function ingestSessionLead(
  document: RingCentralCallSessionDocument,
  log: Logger,
): Promise<string | null> {
  const preview = document.leadPreview;
  if (!preview) {
    return null;
  }

  const qualifiedCall: RingCentralQualifiedCall = {
    ingestionSource: "webhook",
    telephonySessionId: preview.telephonySessionId,
    sessionId: preview.sessionId,
    partyId: preview.partyId,
    callLogId: null,
    sourceCompany: preview.sourceCompany,
    sourceLabel: preview.sourceLabel,
    routeResolution: preview.routeResolution,
    callerPhoneNumber: preview.callerPhoneNumber,
    callerName: preview.callerName,
    targetPhoneNumber: preview.targetPhoneNumber,
    targetName: preview.targetName,
    answeredAt: preview.answeredAt,
    terminalAt: preview.terminalAt,
    startTime: document.callStartedAt ?? preview.answeredAt,
    durationSeconds: preview.estimatedDurationSeconds,
    qualificationReason: preview.qualificationReason,
  };

  try {
    const result = await ingestRingCentralQualifiedCall(qualifiedCall);
    return result.action;
  } catch (error) {
    log.error({
      err: error,
      msg: "ringcentral.webhook.ingest_failed",
      telephonySessionId: document.telephonySessionId,
    });
    await recordOperationalEvent({
      level: "error",
      eventKey: "ringcentral.webhook.ingest_failed",
      category: "ringcentral",
      workflow: "ringcentral_webhook_ingest",
      summary: "RingCentral webhook ingest failed for a qualified session.",
      leadIdentity: { name: preview.callerName, phone: preview.callerPhoneNumber },
      sourceCompany: preview.sourceCompany,
      details: {
        telephonySessionId: document.telephonySessionId,
        durationSeconds: preview.estimatedDurationSeconds,
        causeMessage: error instanceof Error ? error.message : String(error),
      },
      errorMessage: error instanceof Error ? error.message : String(error),
      notificationCandidate: true,
    });
    return "ingest_failed";
  }
}

function requireRingCentralDebugAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (process.env.NODE_ENV !== "production") {
    next();
    return;
  }

  const debugToken = process.env.RINGCENTRAL_DEV_DEBUG_TOKEN?.trim();
  const providedToken = req.get("x-debug-token")?.trim();
  if (debugToken && providedToken === debugToken) {
    next();
    return;
  }

  res.status(404).json({ ok: false, error: "Not found" });
}

function parseLimit(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) {
    return 20;
  }
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function getSingleRouteParam(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return null;
}

export default router;
