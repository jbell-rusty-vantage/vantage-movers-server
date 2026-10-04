import type { Request } from "express";
import { type VantageAuthContext } from "../../middleware/requireApiSecret";
import { requireRegistryOwnerActor, signAdminActorPayload, verifyAdminActorSignature } from "../operationsRegistry/trustedActor";
import { ADMIN_PROXY_AGENT_HEADER, ADMIN_PROXY_HEADER_NAMES, buildCanonicalRepActorPayload, normalizeAdminPath } from "../operationsRegistry/trustedActorCanonical";
import { getAdminProxySignatureMaxAgeMs, getAdminProxySigningSecret } from "../operationsRegistry/config";
import {
  csiFlag,
  type CsiErrorCode,
} from "../../config/domain/salesIntelligence";
import { csiIdSchema } from "../../validation/v1/salesIntelligence";
const getVantageAuth = (req: Request) =>
  (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
/** Bounded `path` / `code` pairs, never submitted values. Mirrors the sanitized Zod issue shape. */
export type CsiIssue = Readonly<{ path: string; code: string }>;
export class CsiError extends Error {
  constructor(
    readonly code: CsiErrorCode,
    /**
     * Which parts of the request were refused. A definite rejection the caller
     * can act on must say where it failed: without this an evidence-scope
     * refusal reached the model as a bare code, so its one repair allowance
     * could not be spent on anything (22 §4.4).
     */
    readonly issues?: readonly CsiIssue[],
  ) {
    super(code);
  }
}
/** S8-REP (addendum §4.2): the signed dashboard role. `admin` is never admitted to Sales Intelligence. */
export type CsiActorRole = "owner" | "admin" | "rep";
export type CsiActor = Readonly<{
  kind: "owner" | "worker" | "intelligence" | "rep";
  id: string;
  request_id: string;
  run_id: string | null;
  /**
   * S8-REP: the signed dashboard role and, for a rep, its linked Agent (the E11 scope). Both are
   * non-enumerable on a trusted actor, so every existing `{ ...actor }` / `actor: context.actor`
   * write keeps persisting exactly `{ kind, id, request_id, run_id }` (the strict `actor` schema).
   */
  role?: CsiActorRole;
  agent_id?: string | null;
}>;
const trustedActors = new WeakSet<CsiActor>();
function trust(actor: CsiActor, scope?: { role: CsiActorRole; agent_id: string | null }): CsiActor {
  if (scope) {
    Object.defineProperty(actor, "role", { value: scope.role, enumerable: false });
    Object.defineProperty(actor, "agent_id", { value: scope.agent_id, enumerable: false });
  }
  Object.freeze(actor);
  trustedActors.add(actor);
  return actor;
}
export function assertTrustedActor(actor: CsiActor, kind?: CsiActor["kind"]) {
  if (!trustedActors.has(actor) || (kind && actor.kind !== kind))
    throw new CsiError("OWNER_REQUIRED");
}
/** S8-REP: a trusted rep actor with its signed Agent. Everything a rep may do is gated on this. */
export type CsiRepActor = CsiActor & { kind: "rep"; role: "rep"; agent_id: string };
export function isCsiRepActor(actor: CsiActor): actor is CsiRepActor {
  return trustedActors.has(actor) && actor.kind === "rep" && actor.role === "rep" && typeof actor.agent_id === "string" && /^[a-f\d]{24}$/.test(actor.agent_id);
}
export function requireCsiOwner(req: Request): CsiActor {
  const auth = getVantageAuth(req);
  if (!auth || auth.kind === "scoped_key") throw new CsiError("OWNER_REQUIRED");
  try {
    const owner = requireRegistryOwnerActor(req, auth);
    return trust({
      kind: "owner",
      id: owner.actorId,
      request_id: owner.requestId,
      run_id: null,
    }, { role: "owner", agent_id: null });
  } catch {
    throw new CsiError("OWNER_REQUIRED");
  }
}

/**
 * S8-REP (addendum §4.2): a Sales Intelligence reader, the Owner or, with
 * `SALES_INTELLIGENCE_REP_ACCESS` on, a rep. The rep's role and Agent come only from the admin proxy's
 * signed headers (8-line canonical payload, `buildCanonicalRepActorPayload`), never from a query or body.
 * Any request that isn't signed as `rep` takes the Owner path unchanged; with the flag off a rep takes it
 * too, so it's refused exactly as before (`OWNER_REQUIRED`, 403). Only routes that scope the read or the
 * command to the rep call this; every other route keeps `requireCsiOwner`.
 */
export function requireCsiReader(req: Request, now = Date.now()): CsiActor {
  const role = req.header(ADMIN_PROXY_HEADER_NAMES.role)?.trim().toLowerCase();
  if (role !== "rep" || !csiFlag("REP_ACCESS")) return requireCsiOwner(req);
  const auth = getVantageAuth(req);
  if (!auth || auth.kind === "scoped_key") throw new CsiError("OWNER_REQUIRED");
  const rep = verifyCsiRepSignature(req, now);
  if (!rep) throw new CsiError("OWNER_REQUIRED");
  return trust({ kind: "rep", id: rep.adminId, request_id: rep.requestId, run_id: null }, { role: "rep", agent_id: rep.agentId });
}

function verifyCsiRepSignature(req: Request, now: number): { adminId: string; requestId: string; agentId: string } | null {
  const secret = getAdminProxySigningSecret();
  if (!secret) return null;
  const header = (name: string) => req.header(name)?.trim() || null;
  const adminId = header(ADMIN_PROXY_HEADER_NAMES.userId), email = header(ADMIN_PROXY_HEADER_NAMES.email);
  const requestId = header(ADMIN_PROXY_HEADER_NAMES.requestId), timestamp = header(ADMIN_PROXY_HEADER_NAMES.timestamp);
  const signature = header(ADMIN_PROXY_HEADER_NAMES.signature), agentId = header(ADMIN_PROXY_AGENT_HEADER)?.toLowerCase() ?? null;
  if (!adminId || !email || !requestId || !timestamp || !signature || !agentId || !/^[a-f\d]{24}$/.test(agentId)) return null;
  if (!/^\d+$/.test(timestamp) || Math.abs(now - Number(timestamp)) > getAdminProxySignatureMaxAgeMs()) return null;
  const path = normalizeAdminPath((req.originalUrl ?? req.url).split("?")[0] ?? "");
  const expected = signAdminActorPayload(buildCanonicalRepActorPayload({ adminId, email, role: "rep", timestamp, requestId, method: req.method, path, agentId }), secret);
  return verifyAdminActorSignature(signature, expected) ? { adminId, requestId, agentId } : null;
}
export function assertCurrentScope(query: unknown, body: unknown = undefined) {
  for (const scope of [query, body])
    if (scope !== undefined && scope !== "production")
      throw new CsiError("UNSUPPORTED_SCOPE");
}
/** Fixed operator identity for an explicit dev_ops backfill. Never accepted from HTTP. */
export function csiOperatorActor(requestId: string): CsiActor {
  if (!requestId.trim() || requestId.length > 200) throw new CsiError("INVALID_INPUT");
  return trust({
    kind: "owner",
    id: "sales-intelligence-operator",
    request_id: requestId,
    run_id: null,
  });
}
/** Fixed service identity, never accepted from HTTP JSON. */
export function csiWorkerActor(jobId: string): CsiActor {
  csiIdSchema.parse(jobId);
  return trust({
    kind: "worker",
    id: "sales-intelligence-worker",
    request_id: jobId,
    run_id: null,
  });
}
