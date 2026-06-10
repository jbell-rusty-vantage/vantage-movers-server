import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { resolveSourceCompany, type SourceCompany } from "../config/domain";

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

export function requireApiSecret(req: Request, res: Response, next: NextFunction) {
  const expectedSecret = process.env.VANTAGE_API_SECRET?.trim();
  const providedSecret = req.header("x-api-secret")?.trim();

  if (!expectedSecret && !process.env.VANTAGE_SCOPED_API_KEYS?.trim()) {
    return res.status(500).json({
      ok: false,
      error: "VANTAGE_API_SECRET or VANTAGE_SCOPED_API_KEYS is not set",
    });
  }

  if (!providedSecret) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
    });
  }

  if (expectedSecret && secretsEqual(providedSecret, expectedSecret)) {
    return next();
  }

  let scopedKeys: ScopedApiKey[];
  try {
    scopedKeys = parseScopedApiKeys(process.env.VANTAGE_SCOPED_API_KEYS);
  } catch {
    return res.status(500).json({
      ok: false,
      error: "VANTAGE_SCOPED_API_KEYS is invalid",
    });
  }

  const matchingKey = scopedKeys.find((key) => secretsEqual(providedSecret, key.secret));

  if (!matchingKey) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
    });
  }

  if (!isRouteAllowed(req, matchingKey) || !isSourceCompanyAllowed(req, matchingKey)) {
    return res.status(403).json({
      ok: false,
      error: "Forbidden",
    });
  }

  return next();
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
