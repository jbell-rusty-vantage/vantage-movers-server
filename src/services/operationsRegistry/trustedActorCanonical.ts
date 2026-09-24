/**
 * Canonical dashboard actor signing contract shared with the admin proxy (D0).
 *
 * Payload fields are newline-delimited UTF-8 in this order:
 *   admin_id, normalized_email, normalized_role, timestamp, request_id, method, path
 *
 * HMAC-SHA256 with `VANTAGE_ADMIN_PROXY_SIGNING_SECRET`, lowercase hex digest.
 */

export const ADMIN_PROXY_HEADER_NAMES = {
  userId: "x-vantage-admin-user-id",
  email: "x-vantage-admin-email",
  role: "x-vantage-admin-role",
  requestId: "x-vantage-admin-request-id",
  timestamp: "x-vantage-admin-timestamp",
  signature: "x-vantage-admin-signature",
} as const;

export const APPROVED_REGISTRY_READ_ROLES = ["owner", "admin"] as const;

export type ApprovedRegistryReadRole = (typeof APPROVED_REGISTRY_READ_ROLES)[number];

export type CanonicalAdminActorFields = {
  adminId: string;
  email: string;
  role: string;
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
};

export function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeAdminRole(role: string): string {
  return role.trim().toLowerCase();
}

export function normalizeAdminMethod(method: string): string {
  return method.trim().toUpperCase();
}

export function normalizeAdminPath(path: string): string {
  const withoutQuery = path.split("?")[0] ?? "";
  const withLeadingSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/, "")
    : withLeadingSlash;
}

export function buildCanonicalAdminActorPayload(
  fields: CanonicalAdminActorFields,
): string {
  return [
    fields.adminId.trim(),
    normalizeAdminEmail(fields.email),
    normalizeAdminRole(fields.role),
    fields.timestamp.trim(),
    fields.requestId.trim(),
    normalizeAdminMethod(fields.method),
    normalizeAdminPath(fields.path),
  ].join("\n");
}

/**
 * S8-REP (additive): a rep actor's linked Agent id, sent and signed by the admin proxy only when
 * the role is `rep`. The rep payload is the seven lines above plus the lowercase Agent id as an
 * eighth line; Owner and Admin payloads are unchanged, so `buildCanonicalAdminActorPayload` and
 * every registry verification stay byte-identical. The registry never admits `rep`
 * (`APPROVED_REGISTRY_READ_ROLES`); only Sales Intelligence verifies this payload.
 */
export const ADMIN_PROXY_AGENT_HEADER = "x-vantage-admin-agent-id";

export function buildCanonicalRepActorPayload(
  fields: CanonicalAdminActorFields & { agentId: string },
): string {
  return `${buildCanonicalAdminActorPayload(fields)}\n${fields.agentId.trim().toLowerCase()}`;
}
