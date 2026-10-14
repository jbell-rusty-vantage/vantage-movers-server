import { createHmac, randomUUID } from "node:crypto";

export const API_BASE = "https://vantage-movers-main-server.vercel.app";
export const RUNS_PATH = "/api/v1/admin/granot-automation/runs";

/** The backfill deliberately uses the deployed canonical API, never direct Lead/database writes. */
export async function ownerApi<T>(method: "GET" | "POST", path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
  const getAllowed = /^\/api\/v1\/admin\/(?:granot-automation\/runs(?:\/(?:[a-f0-9]{24}|freshness))?|(?:form|call)-leads|sales-outreach\/(?:team|configuration|queue))$/.test(path);
  const postAllowed = new RegExp(`^${RUNS_PATH}(?:/worker|/[a-f0-9]{24}/apply-reviewed-estimates)?$`).test(path);
  if (!(method === "GET" ? getAllowed : postAllowed)) throw new Error("Path is outside the Estimates backfill API allowlist.");
  if (method === "GET" && body !== undefined) throw new Error("GET cannot have a body.");
  const required = (key: string) => {
    const value = process.env[key]?.trim();
    if (!value) throw new Error(`Missing runtime binding: ${key}`);
    return value;
  };
  const timestamp = String(Date.now()), requestId = randomUUID();
  const userId = required("VANTAGE_ADMIN_USER_ID"), email = required("VANTAGE_ADMIN_EMAIL").toLowerCase();
  const signature = createHmac("sha256", required("VANTAGE_ADMIN_PROXY_SIGNING_SECRET"))
    .update([userId, email, "owner", timestamp, requestId, method, path].join("\n")).digest("hex");
  const response = await fetch(API_BASE + path + (query ? `?${new URLSearchParams(query)}` : ""), {
    method, redirect: "error", signal: AbortSignal.timeout(330_000),
    headers: {
      "content-type": "application/json", "x-api-secret": required("VANTAGE_API_SECRET"),
      "x-vantage-admin-user-id": userId, "x-vantage-admin-email": email, "x-vantage-admin-role": "owner",
      "x-vantage-admin-timestamp": timestamp, "x-vantage-admin-request-id": requestId, "x-vantage-admin-signature": signature,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const envelope = await response.json() as { ok?: boolean; data?: T; code?: string };
  if (!response.ok || envelope.ok !== true) throw new Error(`API HTTP ${response.status}${envelope.code && /^[A-Z_]+$/.test(envelope.code) ? ` ${envelope.code}` : ""}`);
  return envelope.data as T;
}
