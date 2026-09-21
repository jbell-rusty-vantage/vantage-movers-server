import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import pinoHttp from "pino-http";
import { logger as rootLogger } from "../logger";

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
