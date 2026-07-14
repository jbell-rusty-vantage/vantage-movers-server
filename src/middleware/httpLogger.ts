import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Request } from "express";
import pinoHttp from "pino-http";
import {
  getObservabilitySlowRequestMs,
  shouldCaptureHttp5xx,
} from "../config/domain/observability";
import { logger as rootLogger } from "../logger";
import { recordOperationalEvent } from "../services/observability";

type ExpressRequestDetails = IncomingMessage & {
  id?: string | number | object;
  route?: {
    path?: unknown;
  };
  baseUrl?: string;
  originalUrl?: string;
  url?: string;
};

function readIncomingHeader(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw) && raw.length > 0) {
    return raw[0];
  }
  return undefined;
}

function requestPath(req: ExpressRequestDetails): string {
  return (req.originalUrl ?? req.url ?? "").split("?")[0];
}

function expressRouteLabel(req: ExpressRequestDetails): string {
  if (req.route && typeof req.route.path === "string") {
    const base = req.baseUrl ?? "";
    return `${base}${req.route.path}` || requestPath(req);
  }
  return requestPath(req);
}

function shouldSkipSlowRequest(path: string): boolean {
  return path === "/" || path === "/health" || path === "/db" || path.startsWith("/api/cron/");
}

function captureSlowRequest(
  req: IncomingMessage,
  res: ServerResponse,
  responseTime: number | undefined,
): void {
  const durationMs = Math.round(Number(responseTime ?? 0));
  const thresholdMs = getObservabilitySlowRequestMs();
  if (thresholdMs <= 0 || durationMs < thresholdMs) {
    return;
  }
  if (res.statusCode >= 500 && shouldCaptureHttp5xx()) {
    return;
  }

  const r = req as ExpressRequestDetails;
  const path = requestPath(r);
  if (shouldSkipSlowRequest(path)) {
    return;
  }

  void recordOperationalEvent({
    level: "warn",
    eventKey: "http.request.slow",
    category: "http",
    workflow: "http_request",
    summary: `Slow ${req.method ?? "HTTP"} request completed in ${durationMs}ms.`,
    request: r as unknown as Request,
    route: expressRouteLabel(r),
    method: req.method,
    statusCode: res.statusCode,
    durationMs,
    details: {
      path,
      threshold_ms: thresholdMs,
      duration_ms: durationMs,
      status_code: res.statusCode,
    },
    notificationCandidate: false,
  });
}

function httpReqSerializer(req: IncomingMessage) {
  const r = req as ExpressRequestDetails;
  return {
    id: r.id,
    method: req.method,
    path: requestPath(r),
    route: expressRouteLabel(r),
    headers: {
      host: req.headers.host,
      origin: req.headers.origin ?? null,
      "user-agent": req.headers["user-agent"] ?? null,
      "content-type": req.headers["content-type"] ?? null,
    },
  };
}

function httpResSerializer(res: ServerResponse) {
  return { statusCode: res.statusCode };
}

export const httpLogger = pinoHttp({
  logger: rootLogger,
  genReqId(req, res) {
    const incoming = readIncomingHeader(req, "x-request-id");
    const id = incoming?.trim() || randomUUID();
    res.setHeader("x-request-id", id);
    return id;
  },
  serializers: {
    req: httpReqSerializer,
    res: httpResSerializer,
  },
  customSuccessObject(req, res, val) {
    const r = req as ExpressRequestDetails;
    captureSlowRequest(req, res, val.responseTime);
    return {
      ...val,
      http: {
        method: req.method,
        route: expressRouteLabel(r),
        origin: req.headers.origin ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        contentType: req.headers["content-type"] ?? null,
        statusCode: res.statusCode,
        responseTime: val.responseTime,
      },
    };
  },
  customErrorObject(req, res, error, val) {
    const r = req as ExpressRequestDetails;
    captureSlowRequest(req, res, val.responseTime);
    return {
      ...val,
      http: {
        method: req.method,
        route: expressRouteLabel(r),
        origin: req.headers.origin ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        contentType: req.headers["content-type"] ?? null,
        statusCode: res.statusCode,
        responseTime: val.responseTime,
        errMessage: error.message,
      },
    };
  },
});
