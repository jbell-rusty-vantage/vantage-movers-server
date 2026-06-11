import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { resolveSourceCompany, type SourceCompany } from "../config/domain";
import { shouldCaptureAuthEvents } from "../config/domain/observability";
import { recordOperationalEvent } from "../services/observability";

type ScopedApiRoute = {
  method: string;
  path: string;
};

type ScopedApiKey = {
  name: string;
  secret: string;
  routes: ScopedApiRoute[];
  sourceCompanies: SourceCompany[];
};

export async function requireApiSecret(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const expectedSecret = process.env.VANTAGE_API_SECRET?.trim();
  const providedSecret = req.header("x-api-secret")?.trim();

  if (!expectedSecret && !process.env.VANTAGE_SCOPED_API_KEYS?.trim()) {
    await recordAuthEvent(req, {
      level: "error",
      eventKey: "auth.scoped_key.config_invalid",
      summary: "API secret configuration is invalid.",
      details: { reason: "no_secret_configured" },
      notificationCandidate: true,
    });
    return res.status(500).json({
      ok: false,
      error: "VANTAGE_API_SECRET or VANTAGE_SCOPED_API_KEYS is not set",
    });
  }

  if (!providedSecret) {
    await recordAuthEvent(req, {
      level: "warn",
      eventKey: "auth.api_secret.rejected",
      summary: "Request rejected: missing API secret.",
      details: { reject_reason: "missing_secret" },
      notificationCandidate: false,
      reportable: false,
    });
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
    });
  }

  // Fast path: the primary API secret matches. No event is recorded here to
  // keep the hot path latency-free; observability focuses on scoped keys and
  // rejections.
  if (expectedSecret && secretsEqual(providedSecret, expectedSecret)) {
    return next();
  }

  let scopedKeys: ScopedApiKey[];
  try {
    scopedKeys = parseScopedApiKeys(process.env.VANTAGE_SCOPED_API_KEYS);
  } catch {
    await recordAuthEvent(req, {
      level: "error",
      eventKey: "auth.scoped_key.config_invalid",
      summary: "Scoped API key configuration is invalid.",
      details: { reason: "scoped_keys_parse_error" },
      notificationCandidate: true,
    });
    return res.status(500).json({
      ok: false,
      error: "VANTAGE_SCOPED_API_KEYS is invalid",
    });
  }

  const matchingKey = scopedKeys.find((key) => secretsEqual(providedSecret, key.secret));

  if (!matchingKey) {
    await recordAuthEvent(req, {
      level: "warn",
      eventKey: "auth.api_secret.rejected",
      summary: "Request rejected: unknown API secret.",
      details: { reject_reason: "unknown_secret" },
      notificationCandidate: false,
      reportable: false,
    });
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
    });
  }

  const sourceCompany = readSourceCompany(req);

  if (!isRouteAllowed(req, matchingKey)) {
    await recordAuthEvent(req, {
      level: "warn",
      eventKey: "auth.scoped_key.forbidden",
      summary: "Scoped API key denied: route not allowed.",
      details: { scoped_key_name: matchingKey.name, forbidden_reason: "route_not_allowed" },
      sourceCompany,
      notificationCandidate: false,
    });
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  if (!isSourceCompanyAllowed(req, matchingKey)) {
    await recordAuthEvent(req, {
      level: "warn",
      eventKey: "auth.scoped_key.forbidden",
      summary: "Scoped API key denied: source company not allowed.",
      details: {
        scoped_key_name: matchingKey.name,
        forbidden_reason: "source_company_not_allowed",
      },
      sourceCompany,
      notificationCandidate: false,
    });
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  await recordAuthEvent(req, {
    level: "info",
    eventKey: "auth.scoped_key.accepted",
    summary: "Scoped API key accepted on allowed route.",
    details: { scoped_key_name: matchingKey.name },
    sourceCompany,
  });

  return next();
}

type AuthEventInput = {
  level: "info" | "warn" | "error";
  eventKey: string;
  summary: string;
  details: Record<string, unknown>;
  sourceCompany?: string | null;
  notificationCandidate?: boolean;
  reportable?: boolean;
};

/**
 * Records a source-scoped API key auth decision (no secrets are ever stored).
 * Best-effort and gated by `OBSERVABILITY_CAPTURE_AUTH_EVENTS`.
 */
async function recordAuthEvent(req: Request, input: AuthEventInput): Promise<void> {
  if (!shouldCaptureAuthEvents()) {
    return;
  }
  await recordOperationalEvent({
    request: req,
    category: "auth",
    workflow: "api_secret",
    level: input.level,
    eventKey: input.eventKey,
    summary: input.summary,
    details: input.details,
    sourceCompany: input.sourceCompany ?? null,
    notificationCandidate: input.notificationCandidate,
    reportable: input.reportable,
  });
}

function readSourceCompany(req: Request): string | null {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return null;
  }
  const resolved = resolveSourceCompany(
    getString((req.body as Record<string, unknown>).source_company),
  );
  return resolved ?? null;
}

function parseScopedApiKeys(raw: string | undefined): ScopedApiKey[] {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed) as unknown;
  const entries = Array.isArray(parsed)
    ? parsed
    : Object.entries(asRecord(parsed)).map(([name, config]) => ({
        name,
        ...asRecord(config),
      }));

  return entries.map(parseScopedApiKey);
}

function parseScopedApiKey(value: unknown): ScopedApiKey {
  const config = asRecord(value);
  const name = getString(config.name) || "unnamed";
  const secret = getString(config.secret) || getString(config.key);
  if (!secret) {
    throw new Error("Scoped API key is missing secret");
  }

  const routeValues = Array.isArray(config.routes)
    ? config.routes
    : [{ method: config.method, path: config.path }];
  const routes = routeValues.map(parseScopedApiRoute);

  if (routes.length === 0) {
    throw new Error("Scoped API key is missing routes");
  }

  return {
    name,
    secret,
    routes,
    sourceCompanies: parseSourceCompanyScope(config),
  };
}

function parseScopedApiRoute(value: unknown): ScopedApiRoute {
  const route = asRecord(value);
  const method = getString(route.method)?.toUpperCase();
  const path = normalizePath(getString(route.path));

  if (!method || !path) {
    throw new Error("Scoped API key route requires method and path");
  }

  return { method, path };
}

function parseSourceCompanyScope(config: Record<string, unknown>): SourceCompany[] {
  const raw = config.sourceCompanies ?? config.source_companies;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((value) => {
    const sourceCompany = resolveSourceCompany(getString(value));
    if (!sourceCompany) {
      throw new Error("Scoped API key includes an unknown source company");
    }

    return sourceCompany;
  });
}

function isRouteAllowed(req: Request, key: ScopedApiKey): boolean {
  const method = req.method.toUpperCase();
  const path = normalizePath((req.originalUrl ?? req.url).split("?")[0]);

  return key.routes.some((route) => route.method === method && route.path === path);
}

function isSourceCompanyAllowed(req: Request, key: ScopedApiKey): boolean {
  if (key.sourceCompanies.length === 0) {
    return true;
  }

  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return false;
  }

  const sourceCompany = resolveSourceCompany(
    getString((req.body as Record<string, unknown>).source_company),
  );
  return sourceCompany ? key.sourceCompanies.includes(sourceCompany) : false;
}

function secretsEqual(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function normalizePath(value: string | undefined): string {
  if (!value) {
    return "";
  }

  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/, "")
    : withLeadingSlash;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object");
  }

  return value as Record<string, unknown>;
}
