import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import {
  getExtensionUserFromAccessToken,
  hasExtensionRole,
  type CurrentExtensionRole,
} from "../auth/extension";
import { resolveSourceCompany } from "../config/domain";
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
  sourceCompanies: string[];
  sourceGranularities: string[];
};

export type VantageAuthContext =
  | { kind: "secret" }
  | { kind: "scoped_key"; scopedKeyName: string; scopedKeyFingerprint: string }
  | { kind: "user"; userId: string; email: string; roles: CurrentExtensionRole[] };

const TARIFF_ADJUSTMENT_BEARER_ROUTE: ScopedApiRoute = {
  method: "POST",
  path: "/api/v1/tariff-adjustments",
};

const LIMITED_EXTENSION_ROLE_ALLOWED_ROUTES: Record<string, readonly ScopedApiRoute[]> = {
  customer_service: [TARIFF_ADJUSTMENT_BEARER_ROUTE],
  sales: [],
};

export const vantageAuthLookups = {
  getExtensionUserFromAccessToken,
};

type RequestWithVantageAuth = Request & {
  vantageAuth?: VantageAuthContext;
};

export async function requireVantageAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const expectedSecret = process.env.VANTAGE_API_SECRET?.trim();
  const providedSecret = req.header("x-api-secret")?.trim();
  const bearerToken = readBearerToken(req);
  const hasScopedKeys = Boolean(process.env.VANTAGE_SCOPED_API_KEYS?.trim());

  if (!expectedSecret && !hasScopedKeys && !bearerToken) {
    await recordAuthEvent(req, {
      level: "error",
      eventKey: "auth.scoped_key.config_invalid",
      summary: "API auth configuration is invalid.",
      details: { reason: "no_auth_configured" },
      notificationCandidate: true,
    });
    return res.status(500).json({
      ok: false,
      error: "VANTAGE_API_SECRET, VANTAGE_SCOPED_API_KEYS, or Bearer auth is not configured",
    });
  }

  // Fast path: the primary API secret matches. No event is recorded here to
  // keep the hot path latency-free; observability focuses on scoped keys and
  // rejections.
  if (expectedSecret && providedSecret && secretsEqual(providedSecret, expectedSecret)) {
    setVantageAuth(req, { kind: "secret" });
    return next();
  }

  if (bearerToken) {
    const user = await vantageAuthLookups.getExtensionUserFromAccessToken(
      bearerToken,
    );
    if (user) {
      if (
        !hasExtensionRole(user.roles, "owner") &&
        !isAnyLimitedExtensionRoleAllowedRoute(req, user.roles)
      ) {
        await recordAuthEvent(req, {
          level: "warn",
          eventKey: "auth.user.forbidden",
          summary: "Extension user denied protected API route.",
          details: {
            user_id: user.id,
            roles: user.roles,
            forbidden_reason: "role_route_not_allowed",
          },
          notificationCandidate: false,
          reportable: false,
        });
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      setVantageAuth(req, {
        kind: "user",
        userId: user.id,
        email: user.email,
        roles: user.roles,
      });
      return next();
    }
  }

  if (!providedSecret) {
    await recordAuthEvent(req, {
      level: "warn",
      eventKey: "auth.api_secret.rejected",
      summary: "Request rejected: missing API credentials.",
      details: { reject_reason: "missing_credentials" },
      notificationCandidate: false,
      reportable: false,
    });
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
    });
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

  setVantageAuth(req, {
    kind: "scoped_key",
    scopedKeyName: matchingKey.name,
    scopedKeyFingerprint: createHash("sha256")
      .update(matchingKey.secret)
      .digest("hex")
      .slice(0, 32),
  });
  return next();
}

export const requireApiSecret = requireVantageAuth;

export function isLimitedExtensionRoleAllowedRoute(
  req: Request,
  role: string,
): boolean {
  const allowedRoutes = LIMITED_EXTENSION_ROLE_ALLOWED_ROUTES[role];
  if (!allowedRoutes || allowedRoutes.length === 0) {
    return false;
  }
  const method = req.method.toUpperCase();
  const path = normalizePath((req.originalUrl ?? req.url).split("?")[0]);
  return allowedRoutes.some(
    (route) => route.method === method && route.path === path,
  );
}

function isAnyLimitedExtensionRoleAllowedRoute(
  req: Request,
  roles: readonly CurrentExtensionRole[],
): boolean {
  return roles.some((role) => isLimitedExtensionRoleAllowedRoute(req, role));
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
  const body = req.body as Record<string, unknown>;
  return normalizeScopedSourceCompany(
    getString(body.company_slug) ?? getString(body.source_company),
  );
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
    sourceGranularities: parseSourceGranularityScope(config),
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

function parseSourceCompanyScope(config: Record<string, unknown>): string[] {
  const raw = config.sourceCompanies ?? config.source_companies;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((value) => {
    const sourceCompany = normalizeScopedSourceCompany(getString(value));
    if (!sourceCompany) {
      throw new Error("Scoped API key includes an invalid source company");
    }

    return sourceCompany;
  });
}

function parseSourceGranularityScope(config: Record<string, unknown>): string[] {
  const raw =
    config.sourceGranularities ??
    config.source_granularities ??
    config.granularityKeys ??
    config.granularity_keys;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((value) => {
    const granularity = normalizeKey(getString(value));
    if (!granularity) {
      throw new Error("Scoped API key includes an invalid source granularity");
    }
    return granularity;
  });
}

function isRouteAllowed(req: Request, key: ScopedApiKey): boolean {
  const method = req.method.toUpperCase();
  const path = normalizePath((req.originalUrl ?? req.url).split("?")[0]);

  return key.routes.some((route) => route.method === method && route.path === path);
}

function isSourceCompanyAllowed(req: Request, key: ScopedApiKey): boolean {
  if (key.sourceCompanies.length === 0 && key.sourceGranularities.length === 0) {
    return true;
  }

  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return false;
  }

  const body = req.body as Record<string, unknown>;
  const sourceCompany = normalizeScopedSourceCompany(
    getString(body.company_slug) ?? getString(body.source_company),
  );
  const sourceCompanyAllowed =
    key.sourceCompanies.length === 0 ||
    (sourceCompany ? key.sourceCompanies.includes(sourceCompany) : false);

  const sourceGranularity = normalizeKey(getString(body.source_granularity_key));
  const granularityAllowed =
    key.sourceGranularities.length === 0 ||
    (sourceGranularity ? key.sourceGranularities.includes(sourceGranularity) : false);

  return sourceCompanyAllowed && granularityAllowed;
}

function readBearerToken(req: Request): string | undefined {
  const authorization = req.header("authorization")?.trim();
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return undefined;
  }
  const token = authorization.slice("bearer ".length).trim();
  return token || undefined;
}

function setVantageAuth(req: Request, context: VantageAuthContext): void {
  (req as RequestWithVantageAuth).vantageAuth = context;
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

function normalizeScopedSourceCompany(value: string | undefined): string | null {
  const resolved = resolveSourceCompany(value);
  if (resolved) {
    return resolved;
  }
  return normalizeKey(value) || null;
}

function normalizeKey(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") ?? "";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object");
  }

  return value as Record<string, unknown>;
}
