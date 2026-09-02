import { randomUUID } from "node:crypto";
import {
  ADMIN_PROXY_HEADER_NAMES,
  buildCanonicalAdminActorPayload,
} from "../../src/services/operationsRegistry/trustedActorCanonical";
import { signAdminActorPayload } from "../../src/services/operationsRegistry/trustedActor";

export const PRODUCTION_API_HOST = "vantage-movers-main-server.vercel.app";
export const PRODUCTION_API_BASE_URL = `https://${PRODUCTION_API_HOST}`;

export type VantageApiMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type VantageApiAdminConfig = {
  userId: string;
  email: string;
  role: string;
  signingSecret: string;
};

export type VantageApiConfig = {
  baseUrl: string;
  apiSecret: string;
  admin?: VantageApiAdminConfig;
};

export type VantageApiQuery = Record<
  string,
  string | number | boolean | undefined | null
>;

export type VantageApiRequest = {
  method?: VantageApiMethod;
  path: string;
  query?: VantageApiQuery;
  body?: unknown;
  signAdmin?: boolean;
  confirmProductionWrite?: boolean;
  headers?: Record<string, string>;
};

export type VantageApiResponse<T = unknown> = {
  ok: boolean;
  status: number;
  url: string;
  data: T;
};

export function loadVantageApiConfig(
  env: NodeJS.ProcessEnv = process.env,
): VantageApiConfig {
  const apiSecret = env.VANTAGE_API_SECRET?.trim();
  if (!apiSecret) {
    throw new Error(
      "VANTAGE_API_SECRET is not set. Run from vantage-main-server with --env-file=.env",
    );
  }

  const baseUrl = (
    env.VANTAGE_API_BASE_URL?.trim() || PRODUCTION_API_BASE_URL
  ).replace(/\/+$/, "");

  const userId = env.VANTAGE_ADMIN_USER_ID?.trim();
  const email = env.VANTAGE_ADMIN_EMAIL?.trim();
  const role = env.VANTAGE_ADMIN_ROLE?.trim() || "owner";
  const signingSecret = env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET?.trim();

  return {
    baseUrl,
    apiSecret,
    ...(userId && email && signingSecret
      ? { admin: { userId, email, role, signingSecret } }
      : {}),
  };
}

export function isProductionApiBase(baseUrl: string): boolean {
  return new URL(baseUrl).hostname === PRODUCTION_API_HOST;
}

export function assertProductionWriteAllowed(input: {
  method: string;
  baseUrl: string;
  confirmed: boolean;
}): void {
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(
    input.method.toUpperCase(),
  );
  if (mutating && isProductionApiBase(input.baseUrl) && !input.confirmed) {
    throw new Error(
      "Refusing a production write. Confirm with the user, then pass confirmProductionWrite or --i-mean-it.",
    );
  }
}

export function buildVantageApiUrl(
  baseUrl: string,
  path: string,
  query?: VantageApiQuery,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(normalizedPath, `${baseUrl.replace(/\/+$/, "")}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export function buildAdminActorHeaders(
  admin: VantageApiAdminConfig,
  method: string,
  path: string,
): Record<string, string> {
  const timestamp = String(Date.now());
  const requestId = randomUUID();
  const pathname = (path.split("?")[0] ?? path) || "/";
  const payload = buildCanonicalAdminActorPayload({
    adminId: admin.userId,
    email: admin.email,
    role: admin.role,
    timestamp,
    requestId,
    method,
    path: pathname,
  });
  return {
    [ADMIN_PROXY_HEADER_NAMES.userId]: admin.userId,
    [ADMIN_PROXY_HEADER_NAMES.email]: admin.email,
    [ADMIN_PROXY_HEADER_NAMES.role]: admin.role,
    [ADMIN_PROXY_HEADER_NAMES.requestId]: requestId,
    [ADMIN_PROXY_HEADER_NAMES.timestamp]: timestamp,
    [ADMIN_PROXY_HEADER_NAMES.signature]: signAdminActorPayload(
      payload,
      admin.signingSecret,
    ),
  };
}

export async function vantageApi<T = unknown>(
  request: VantageApiRequest,
  config: VantageApiConfig = loadVantageApiConfig(),
): Promise<VantageApiResponse<T>> {
  const method = (request.method ?? "GET").toUpperCase() as VantageApiMethod;
  assertProductionWriteAllowed({
    method,
    baseUrl: config.baseUrl,
    confirmed: request.confirmProductionWrite === true,
  });

  const path = request.path.startsWith("/") ? request.path : `/${request.path}`;
  const url = buildVantageApiUrl(config.baseUrl, path, request.query);
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-api-secret": config.apiSecret,
    ...request.headers,
  };

  if (request.signAdmin) {
    if (!config.admin) {
      throw new Error(
        "Admin signing requested but VANTAGE_ADMIN_USER_ID, VANTAGE_ADMIN_EMAIL, and VANTAGE_ADMIN_PROXY_SIGNING_SECRET are not all set.",
      );
    }
    Object.assign(headers, buildAdminActorHeaders(config.admin, method, path));
  }

  const init: RequestInit = { method, headers };
  if (request.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(request.body);
  }

  const response = await fetch(url, init);
  const text = await response.text();
  let data: T;
  if (!text) {
    data = null as T;
  } else {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = text as T;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    url,
    data,
  };
}
