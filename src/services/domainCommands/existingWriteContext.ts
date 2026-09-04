import { createHash } from "node:crypto";
import type { Request } from "express";
import mongoose from "mongoose";
import { hasExtensionRole } from "../../auth/extension/roles";
import type { VantageAuthContext } from "../../middleware/requireApiSecret";
import type { DurableActor } from "../durableWork/types";
import { DomainCommandContextError, type CanonicalCommandContext } from "./types";
import {
  VANTAGE_API_SECRET_ACTOR_ID,
  VANTAGE_SCOPED_API_KEY_ACTOR_PREFIX,
} from "./types";

export const VANTAGE_API_SECRET_ACTOR_LABEL = "Vantage API secret";
export const VANTAGE_SCOPED_API_KEY_ACTOR_LABEL = "Vantage scoped API key";

type RequestWithAuth = Request & {
  id?: string | number | object;
  vantageAuth?: VantageAuthContext;
};

export function existingWriteContextFromRequest(input: {
  req: Request;
  command_name: string;
  payload: unknown;
  resource_id?: string;
}): CanonicalCommandContext {
  const requestId = readRequestId(input.req);
  const auth = (input.req as RequestWithAuth).vantageAuth;
  const actor = compatibilityActorFromAuth(auth, input.req, requestId);
  const durableKey = durableBusinessKey(input.payload);
  return {
    command_id: String(new mongoose.Types.ObjectId()),
    idempotency_key: durableKey
      ? `existing:${input.command_name}:${durableKey}`
      : `request:${input.command_name}:${requestId}`,
    payload_checksum: hashExistingWritePayload({
      command_name: input.command_name,
      resource_id: input.resource_id ?? null,
      payload: input.payload,
    }),
    actor,
    initiator: actor,
    provenance: {
      origin: "vantage_admin",
      run_id: null,
      source_receipt_id: null,
      source_connection_key: null,
    },
  };
}

export function createVantageApiSecretActor(requestId: string): DurableActor {
  return {
    actor_type: "system",
    actor_id: VANTAGE_API_SECRET_ACTOR_ID,
    actor_label: VANTAGE_API_SECRET_ACTOR_LABEL,
    actor_role: "system",
    request_id: requestId,
    origin: "vantage_admin",
  };
}

export function createVantageScopedApiKeyActor(input: {
  requestId: string;
  fingerprint: string;
}): DurableActor {
  if (!/^[a-f0-9]{16,64}$/i.test(input.fingerprint)) {
    throw new DomainCommandContextError(
      "Scoped API key fingerprint is missing or invalid.",
    );
  }
  return {
    actor_type: "system",
    actor_id: `${VANTAGE_SCOPED_API_KEY_ACTOR_PREFIX}${input.fingerprint.toLowerCase()}`,
    actor_label: VANTAGE_SCOPED_API_KEY_ACTOR_LABEL,
    actor_role: "system",
    request_id: input.requestId,
    origin: "vantage_admin",
  };
}

export function fingerprintScopedApiKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 32);
}

function compatibilityActorFromAuth(
  auth: VantageAuthContext | undefined,
  req: Request,
  requestId: string,
): DurableActor {
  if (auth?.kind === "user") {
    if (!hasExtensionRole(auth.roles, "owner")) {
      throw new DomainCommandContextError(
        "Existing write commands require an owner or admin actor.",
      );
    }
    return {
      actor_type: "owner",
      actor_id: auth.userId,
      actor_label: auth.email,
      actor_role: "owner",
      request_id: requestId,
      origin: "vantage_admin",
    };
  }

  const adminUserId = req.header("x-vantage-admin-user-id")?.trim();
  const adminEmail = req.header("x-vantage-admin-email")?.trim();
  const adminRole = req.header("x-vantage-admin-role")?.trim().toLowerCase();
  if (
    auth?.kind === "secret" &&
    (adminRole === "owner" || adminRole === "admin") &&
    adminUserId &&
    adminEmail
  ) {
    return {
      actor_type: adminRole,
      actor_id: adminUserId,
      actor_label: adminEmail,
      actor_role: adminRole,
      request_id: requestId,
      origin: "vantage_admin",
    };
  }

  if (auth?.kind === "scoped_key") {
    const fingerprint =
      "scopedKeyFingerprint" in auth && typeof auth.scopedKeyFingerprint === "string"
        ? auth.scopedKeyFingerprint
        : "";
    return createVantageScopedApiKeyActor({ requestId, fingerprint });
  }

  if (auth?.kind === "secret") {
    return createVantageApiSecretActor(requestId);
  }

  throw new DomainCommandContextError(
    "Existing write commands require a trusted server-built actor.",
  );
}

function durableBusinessKey(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const submissionId =
    typeof record.submission_id === "string" ? record.submission_id.trim() : "";
  return submissionId || null;
}

function hashExistingWritePayload(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function readRequestId(req: Request): string {
  const raw = (req as RequestWithAuth).id;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  const header = req.header("x-request-id")?.trim();
  if (header) return header;
  return String(new mongoose.Types.ObjectId());
}
