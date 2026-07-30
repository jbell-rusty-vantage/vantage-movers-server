import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import type { VantageAuthContext } from "../../middleware/requireApiSecret";
import {
  getAdminProxySignatureMaxAgeMs,
  getAdminProxySigningSecret,
  isOperationsRegistryPreviewUnsignedAllowed,
} from "./config";
import { RegistryError } from "./errors";
import { REGISTRY_ERROR_CODES } from "../errors/registryErrorCodes";
import type { RegistryActorContext } from "./types";
import {
  ADMIN_PROXY_HEADER_NAMES,
  APPROVED_REGISTRY_READ_ROLES,
  buildCanonicalAdminActorPayload,
  normalizeAdminEmail,
  normalizeAdminPath,
  normalizeAdminRole,
  type ApprovedRegistryReadRole,
} from "./trustedActorCanonical";

export type AdminActorHeaders = {
  adminUserId?: string | null;
  adminEmail?: string | null;
  adminRole?: string | null;
  requestId?: string | null;
  timestamp?: string | null;
  signature?: string | null;
};

export type VerifyActorInput = {
  method: string;
  path: string;
  headers: AdminActorHeaders;
  auth?: VantageAuthContext;
  requireOwner?: boolean;
  now?: number;
};

const SECRET_KEY_PATTERN = /secret|token|password|authorization|api[_-]?key/i;

export function readAdminActorHeaders(req: Request): AdminActorHeaders {
  return {
    adminUserId: req.header(ADMIN_PROXY_HEADER_NAMES.userId),
    adminEmail: req.header(ADMIN_PROXY_HEADER_NAMES.email),
    adminRole: req.header(ADMIN_PROXY_HEADER_NAMES.role),
    requestId: req.header(ADMIN_PROXY_HEADER_NAMES.requestId),
    timestamp: req.header(ADMIN_PROXY_HEADER_NAMES.timestamp),
    signature: req.header(ADMIN_PROXY_HEADER_NAMES.signature),
  };
}

export function signAdminActorPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function verifyAdminActorSignature(
  provided: string,
  expected: string,
): boolean {
  const providedBuffer = Buffer.from(provided.trim().toLowerCase(), "utf8");
  const expectedBuffer = Buffer.from(expected.trim().toLowerCase(), "utf8");
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function computeAdminActorSignature(
  fields: Parameters<typeof buildCanonicalAdminActorPayload>[0],
  secret: string,
): string {
  const payload = buildCanonicalAdminActorPayload(fields);
  return signAdminActorPayload(payload, secret);
}

function parseTimestampMs(timestamp: string): number | null {
  const trimmed = timestamp.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}

function assertApprovedReadRole(role: string): ApprovedRegistryReadRole {
  const normalized = normalizeAdminRole(role);
  if (!APPROVED_REGISTRY_READ_ROLES.includes(normalized as ApprovedRegistryReadRole)) {
    throw new RegistryError("Registry access is not permitted for this role.", {
      registryCode: REGISTRY_ERROR_CODES.FORBIDDEN,
      remediation: {
        summary: "Use an authenticated Owner or Admin dashboard account.",
      },
    });
  }
  return normalized as ApprovedRegistryReadRole;
}

function verifySignedActor(input: VerifyActorInput): RegistryActorContext {
  const secret = getAdminProxySigningSecret();
  if (!secret) {
    throw new RegistryError("Registry actor signing is not configured.", {
      registryCode: REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_MISSING,
      remediation: {
        summary: "Configure VANTAGE_ADMIN_PROXY_SIGNING_SECRET on the server.",
      },
    });
  }

  const adminId = input.headers.adminUserId?.trim();
  const email = input.headers.adminEmail?.trim();
  const role = input.headers.adminRole?.trim();
  const requestId = input.headers.requestId?.trim();
  const timestamp = input.headers.timestamp?.trim();
  const signature = input.headers.signature?.trim();

  if (!adminId || !email || !role || !requestId || !timestamp || !signature) {
    throw new RegistryError("Signed dashboard actor context is required.", {
      registryCode: REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_MISSING,
      remediation: {
        summary: "Forward signed admin actor headers from the dashboard proxy.",
        fields: Object.values(ADMIN_PROXY_HEADER_NAMES),
      },
    });
  }

  const approvedRole = assertApprovedReadRole(role);
  if (input.requireOwner && approvedRole !== "owner") {
    throw new RegistryError("Registry mutations require an Owner actor.", {
      registryCode: REGISTRY_ERROR_CODES.FORBIDDEN,
      remediation: {
        summary: "Sign in as Owner to mutate registry state.",
      },
    });
  }

  const timestampMs = parseTimestampMs(timestamp);
  if (timestampMs === null) {
    throw new RegistryError("Signed dashboard actor timestamp is invalid.", {
      registryCode: REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_INVALID,
    });
  }

  const now = input.now ?? Date.now();
  const maxAgeMs = getAdminProxySignatureMaxAgeMs();
  if (Math.abs(now - timestampMs) > maxAgeMs) {
    throw new RegistryError("Signed dashboard actor context has expired.", {
      registryCode: REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_EXPIRED,
      remediation: {
        summary: "Retry the request with a fresh timestamp and signature.",
        action: "retry",
      },
      metadata: { max_age_ms: maxAgeMs },
    });
  }

  const payload = buildCanonicalAdminActorPayload({
    adminId,
    email,
    role,
    timestamp,
    requestId,
    method: input.method,
    path: input.path,
  });
  const expectedSignature = signAdminActorPayload(payload, secret);
  if (!verifyAdminActorSignature(signature, expectedSignature)) {
    throw new RegistryError("Signed dashboard actor context is invalid.", {
      registryCode: REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_INVALID,
      remediation: {
        summary: "Verify canonical payload fields and signing secret alignment.",
      },
    });
  }

  return {
    actorType: approvedRole,
    actorId: adminId,
    actorLabel: normalizeAdminEmail(email),
    actorRole: approvedRole,
    requestId,
  };
}

function verifyPreviewUnsignedActor(input: VerifyActorInput): RegistryActorContext {
  const adminId = input.headers.adminUserId?.trim();
  const email = input.headers.adminEmail?.trim();
  const role = input.headers.adminRole?.trim();
  const requestId = input.headers.requestId?.trim();

  if (!adminId || !email || !role || !requestId) {
    throw new RegistryError("Dashboard actor context is required.", {
      registryCode: REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_MISSING,
    });
  }

  const approvedRole = assertApprovedReadRole(role);
  if (input.requireOwner && approvedRole !== "owner") {
    throw new RegistryError("Registry mutations require an Owner actor.", {
      registryCode: REGISTRY_ERROR_CODES.FORBIDDEN,
    });
  }

  if (input.auth?.kind === "user" && input.auth.role === "owner") {
    return {
      actorType: "owner",
      actorId: input.auth.userId,
      actorLabel: normalizeAdminEmail(input.auth.email),
      actorRole: "owner",
      requestId,
    };
  }

  return {
    actorType: approvedRole,
    actorId: adminId,
    actorLabel: normalizeAdminEmail(email),
    actorRole: approvedRole,
    requestId,
  };
}

export function verifyRegistryActor(input: VerifyActorInput): RegistryActorContext {
  const path = normalizeAdminPath(input.path);
  const normalizedInput = { ...input, path };

  // The preview compatibility flag is read-only. Mutations always require a
  // signature, including in local and preview environments.
  if (normalizedInput.requireOwner) {
    return verifySignedActor(normalizedInput);
  }

  const hasSignature = Boolean(normalizedInput.headers.signature?.trim());
  if (hasSignature || !isOperationsRegistryPreviewUnsignedAllowed()) {
    return verifySignedActor(normalizedInput);
  }

  return verifyPreviewUnsignedActor(normalizedInput);
}

export function requireRegistryReadActor(
  req: Request,
  auth?: VantageAuthContext,
): RegistryActorContext {
  return verifyRegistryActor({
    method: req.method,
    path: requestPath(req),
    headers: readAdminActorHeaders(req),
    auth,
    requireOwner: false,
  });
}

export function requireRegistryOwnerActor(
  req: Request,
  auth?: VantageAuthContext,
): RegistryActorContext {
  return verifyRegistryActor({
    method: req.method,
    path: requestPath(req),
    headers: readAdminActorHeaders(req),
    auth,
    requireOwner: true,
  });
}

function requestPath(req: Request): string {
  return normalizeAdminPath((req.originalUrl ?? req.url).split("?")[0] ?? "");
}

export function redactSensitiveActorSnapshot(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = raw;
  }
  return out;
}
