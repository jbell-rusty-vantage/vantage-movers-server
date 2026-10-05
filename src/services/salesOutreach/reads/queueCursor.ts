import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { stableStringify } from "../engine";
import { OutreachError } from "../errors";
import type { QueueKeyset } from "./queueQuery";

/**
 * The queue's opaque, signed, versioned cursor (CONTRACTS "Queue sort enums"):
 * `base64url(claims) "." base64url(HMAC-SHA256)`. The claims bind the filter/sort/direction hash, the
 * actor scope (role + Agent) and its current-assignment generation, the configuration version, the
 * projection snapshot (resolved policy + exposure), the reference instant and an expiry. Anything that
 * does not verify or no longer matches is 409 `CURSOR_EXPIRED` with a resnapshot action: the client
 * drops the cursor and reloads page one. The HMAC key is derived from the admin proxy signing secret
 * (the secret every desk request is already verified with) under a desk-specific label, so no new
 * environment variable exists.
 */

export const QUEUE_CURSOR_VERSION = 1 as const;
/** A cursor is good for 10 minutes after its first page (engineering bound, not policy). */
export const QUEUE_CURSOR_TTL_MS = 10 * 60_000;

export type QueueCursorClaims = Readonly<{
  v: typeof QUEUE_CURSOR_VERSION;
  /** sha256 of the normalized filters, sort and direction. */
  q: string;
  /** Actor role and Agent (null for Owner/Manager). */
  r: string;
  a: string | null;
  /** Current-assignment generation of the filtered assignment scope. */
  g: string;
  /** Configuration version and projection snapshot (policy fingerprint) at page one. */
  c: string;
  p: string;
  /** Reference instant (ms) every page derives time status at; expiry (ms). */
  t: number;
  e: number;
  /** Keyset after the previous page's last row. */
  k: QueueKeyset;
}>;

export type CursorBinding = Omit<QueueCursorClaims, "v" | "t" | "e" | "k">;

const deriveKey = (secret: string) => createHmac("sha256", secret).update("sod-v1:queue-cursor:v1").digest();
const b64 = (buffer: Buffer) => buffer.toString("base64url");

export function queueQueryHash(normalized: unknown): string {
  return createHash("sha256").update(stableStringify(normalized)).digest("hex");
}

export function encodeQueueCursor(claims: QueueCursorClaims, secret: string): string {
  const payload = b64(Buffer.from(JSON.stringify(claims), "utf8"));
  const signature = b64(createHmac("sha256", deriveKey(secret)).update(payload).digest());
  return `${payload}.${signature}`;
}

const expired = (code: string) => new OutreachError("CURSOR_EXPIRED", [{ path: "cursor", code, message: "resnapshot" }]);

function isClaims(value: unknown): value is QueueCursorClaims {
  const c = value as Record<string, unknown> | null;
  return (
    !!c &&
    c.v === QUEUE_CURSOR_VERSION &&
    typeof c.q === "string" &&
    typeof c.r === "string" &&
    (c.a === null || typeof c.a === "string") &&
    typeof c.g === "string" &&
    typeof c.c === "string" &&
    typeof c.p === "string" &&
    Number.isSafeInteger(c.t) &&
    Number.isSafeInteger(c.e) &&
    Array.isArray(c.k) &&
    c.k.length <= 8 &&
    c.k.every((k) => typeof k === "string" && k.length <= 64)
  );
}

/** Verifies the signature and version; a tampered, foreign or unreadable cursor is `CURSOR_EXPIRED`. */
export function decodeQueueCursor(cursor: string, secret: string): QueueCursorClaims {
  const [payload, signature, extra] = cursor.split(".");
  if (!payload || !signature || extra !== undefined) throw expired("cursor_malformed");
  const expected = createHmac("sha256", deriveKey(secret)).update(payload).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw expired("cursor_signature");
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw expired("cursor_malformed");
  }
  if (!isClaims(claims)) throw expired("cursor_version");
  return claims;
}

/** Every binding must still hold at `now`; the first mismatch names why (never which value it held). */
export function assertCursorCurrent(claims: QueueCursorClaims, binding: CursorBinding, now: Date): void {
  if (+now > claims.e) throw expired("cursor_expired");
  if (claims.r !== binding.r || claims.a !== binding.a) throw expired("scope_changed");
  if (claims.q !== binding.q) throw expired("filters_changed");
  if (claims.c !== binding.c) throw expired("configuration_changed");
  if (claims.p !== binding.p) throw expired("projection_snapshot_changed");
  if (claims.g !== binding.g) throw expired("assignment_changed");
}
