import type { Request } from "express";

/**
 * Converts an Express request into safe event context for operational events.
 *
 * Only non-sensitive fields are extracted. Full headers are never stored here;
 * the `httpLogger` redaction policy remains the raw request logging boundary.
 */
export type RequestEventContext = {
  request_id: string | null;
  route: string | null;
  method: string | null;
  origin: string | null;
  user_agent_family: string | null;
};

type RequestWithId = Request & {
  id?: string | number | object;
  route?: { path?: unknown };
  baseUrl?: string;
};

function readRequestId(req: RequestWithId): string | null {
  const id = req.id;
  if (typeof id === "string") {
    return id;
  }
  if (typeof id === "number") {
    return String(id);
  }
  return null;
}

function readRoute(req: RequestWithId): string | null {
  if (req.route && typeof req.route.path === "string") {
    const base = req.baseUrl ?? "";
    const composed = `${base}${req.route.path}`;
    if (composed) {
      return composed;
    }
  }
  const path = (req.originalUrl ?? req.url ?? "").split("?")[0];
  return path || null;
}

function readHeader(req: Request, name: string): string | null {
  const raw = req.headers[name];
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw) && raw.length > 0) {
    return raw[0];
  }
  return null;
}

/**
 * Reduces a user-agent string to a coarse family so we never store a full
 * fingerprintable UA in events. Falls back to a short slice.
 */
function userAgentFamily(ua: string | null): string | null {
  if (!ua) {
    return null;
  }
  const lower = ua.toLowerCase();
  if (lower.includes("bot") || lower.includes("crawler") || lower.includes("spider")) {
    return "bot";
  }
  if (lower.includes("postman")) {
    return "postman";
  }
  if (lower.includes("curl")) {
    return "curl";
  }
  if (lower.includes("node") || lower.includes("axios") || lower.includes("fetch")) {
    return "script";
  }
  if (lower.includes("edg/")) {
    return "edge";
  }
  if (lower.includes("chrome")) {
    return "chrome";
  }
  if (lower.includes("safari")) {
    return "safari";
  }
  if (lower.includes("firefox")) {
    return "firefox";
  }
  return ua.slice(0, 40);
}

export function buildRequestEventContext(
  req: Request | null | undefined,
): RequestEventContext {
  if (!req) {
    return {
      request_id: null,
      route: null,
      method: null,
      origin: null,
      user_agent_family: null,
    };
  }

  const r = req as RequestWithId;
  return {
    request_id: readRequestId(r),
    route: readRoute(r),
    method: req.method ?? null,
    origin: readHeader(req, "origin"),
    user_agent_family: userAgentFamily(readHeader(req, "user-agent")),
  };
}
