import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Request } from "express";
import { type VantageAuthContext } from "../../middleware/requireApiSecret";
import { requireRegistryOwnerActor, signAdminActorPayload, verifyAdminActorSignature } from "../operationsRegistry/trustedActor";
import { ADMIN_PROXY_AGENT_HEADER, ADMIN_PROXY_HEADER_NAMES, buildCanonicalRepActorPayload, normalizeAdminPath } from "../operationsRegistry/trustedActorCanonical";
import { getAdminProxySignatureMaxAgeMs, getAdminProxySigningSecret } from "../operationsRegistry/config";
import {
  CSI_TOOLS,
  csiDataset,
  csiFlag,
  type CsiErrorCode,
} from "../../config/domain/salesIntelligence";
import { csiIdSchema } from "../../validation/v1/salesIntelligence";
import { getContactNumberModel } from "../../models/ContactNumber";
import { getIntelligenceRunModel } from "../../models/IntelligenceRun";
import { getSalesIntelligenceJobModel } from "../../models/SalesIntelligenceJob";
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
/** S8-REP: the rep's forced scope, or null for the Owner. */
export function csiRepScope(actor: CsiActor): { agent_id: string } | null {
  return isCsiRepActor(actor) ? { agent_id: actor.agent_id } : null;
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
export const runClaimsSchema = z
  .object({
    version: z.literal("csi-run-token-v1"),
    run_id: csiIdSchema,
    subject_key: z.string().min(1),
    tools: z.array(z.enum(CSI_TOOLS)).min(1),
    deployment: z.string().min(1),
    database: z.string().min(1),
    aud: z.literal("vantage-csi"),
    nonce: z.string().min(16).max(100),
    iat: z.number().int(),
    exp: z.number().int(),
    lease_epoch: z.number().int().positive(),
  })
  .strict();
export type RunClaims = z.infer<typeof runClaimsSchema>;
export type ActiveRunScope = {
  id: string;
  subject_key: string;
  deployment: string;
  database: string;
  status: string;
  token_nonce: string | null;
  permitted_tools: readonly string[];
  lease_epoch: number;
  leased_until: Date | null;
};
function signingKey(): string {
  const key = process.env.SALES_INTELLIGENCE_RUN_TOKEN_SECRET;
  if (!key || Buffer.byteLength(key) < 32)
    throw new CsiError("RUN_SCOPE_DENIED");
  return key;
}
function signature(payload: string, key: string) {
  return createHmac("sha256", key).update(payload).digest("base64url");
}
export function signRunToken(
  claims: RunClaims,
  active: ActiveRunScope,
  now = Date.now(),
): string {
  const parsed = runClaimsSchema.parse(claims);
  validateBounds(parsed, active, now);
  const payload = Buffer.from(JSON.stringify(parsed)).toString("base64url");
  return `${payload}.${signature(payload, signingKey())}`;
}
function validateBounds(
  claims: RunClaims,
  active: ActiveRunScope,
  now: number,
) {
  const dataset = csiDataset();
  if (
    claims.exp <= now / 1000 ||
    claims.iat > now / 1000 ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > 900 ||
    claims.run_id !== active.id ||
    claims.subject_key !== active.subject_key ||
    claims.nonce !== active.token_nonce ||
    claims.deployment !== dataset.deployment ||
    claims.database !== dataset.database ||
    claims.deployment !== active.deployment ||
    claims.database !== active.database ||
    !["running", "submitted"].includes(active.status) ||
    claims.lease_epoch !== active.lease_epoch ||
    !active.leased_until ||
    active.leased_until.getTime() <= now ||
    claims.tools.some((tool) => !active.permitted_tools.includes(tool))
  )
    throw new CsiError("RUN_SCOPE_DENIED");
}
export function verifyRunToken(
  token: string,
  auth: VantageAuthContext | undefined,
  active: ActiveRunScope,
  tool: (typeof CSI_TOOLS)[number],
  now = Date.now(),
): RunClaims {
  const name = process.env.SALES_INTELLIGENCE_SCOPED_KEY_NAME;
  if (
    !name ||
    auth?.kind !== "scoped_key" ||
    auth.scopedKeyName !== name ||
    token.length > 8192
  )
    throw new CsiError("RUN_SCOPE_DENIED");
  try {
    const [payload, sig, extra] = token.split(".");
    if (!payload || !sig || extra !== undefined) throw new Error();
    const expected = Buffer.from(signature(payload, signingKey()));
    const actual = Buffer.from(sig);
    if (expected.length !== actual.length || !timingSafeEqual(actual, expected))
      throw new Error();
    const claims = runClaimsSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    validateBounds(claims, active, now);
    if (!claims.tools.includes(tool)) throw new Error();
    return claims;
  } catch {
    throw new CsiError("RUN_SCOPE_DENIED");
  }
}
export async function requireCsiRun(
  req: Request,
  runId: string,
  tool: (typeof CSI_TOOLS)[number],
) {
  return authorizeStoredRun(runId, req.header("x-vantage-intelligence-run-token") ?? "", tool,
    getVantageAuth(req), req.header("x-request-id") ?? runId);
}

/** First-party worker seam. Still verifies the signed token and stored run/lease. */
export async function authorizeCsiRun(input: { runId: string; token: string; tool: (typeof CSI_TOOLS)[number] }) {
  return authorizeStoredRun(input.runId, input.token, input.tool, {
    kind: "scoped_key", scopedKeyName: process.env.SALES_INTELLIGENCE_SCOPED_KEY_NAME ?? "",
    scopedKeyFingerprint: "in-process-worker",
  }, input.runId);
}

async function authorizeStoredRun(runId: string, token: string, tool: (typeof CSI_TOOLS)[number],
  auth: VantageAuthContext | undefined, requestId: string) {
  csiIdSchema.parse(runId);
  const run = await getIntelligenceRunModel()
    .findOne({ _id: runId, ...csiDataset() })
    .lean();
  if (!run) throw new CsiError("RUN_SCOPE_DENIED");
  const job = await getSalesIntelligenceJobModel()
    .findOne({ _id: run.job_id, subject_key: run.subject_key, ...csiDataset() })
    .lean();
  if (!job || job.status !== "leased") throw new CsiError("RUN_SCOPE_DENIED");
  const claims = verifyRunToken(
    token,
    auth,
    {
      id: String(run._id),
      subject_key: run.subject_key,
      deployment: run.deployment,
      database: run.database,
      status: run.status,
      token_nonce: run.token_nonce ?? null,
      permitted_tools: run.permitted_tools,
      lease_epoch: job.lease_epoch,
      leased_until: job.leased_until ?? null,
    },
    tool,
  );
  return {
    claims,
    actor: trust({
      kind: "intelligence",
      id: `run:${runId}`,
      request_id: requestId,
      run_id: runId,
    }),
  };
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

/** Issue only from an actually leased stored run. The model cannot choose the subject, dataset, or permitted tool set. */
export async function issueCsiRunToken(
  runId: string,
  lease: { job_id: string; owner: string; epoch: number },
  ttlSeconds = 300,
) {
  csiIdSchema.parse(runId);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 900)
    throw new CsiError("RUN_SCOPE_DENIED");
  const run = await getIntelligenceRunModel().findOne({
    _id: runId,
    job_id: lease.job_id,
    status: "running", purged_at: null, purge_started_at: null,
    ...csiDataset(),
  });
  const job = await getSalesIntelligenceJobModel().findOne({
    _id: lease.job_id,
    status: "leased",
    lease_owner: lease.owner,
    lease_epoch: lease.epoch,
    leased_until: { $gt: new Date() },
    ...csiDataset(),
  });
  if (!run || !job || !run.token_nonce) throw new CsiError("RUN_SCOPE_DENIED");
  if (run.contact_number_id && await getContactNumberModel().exists({ _id: run.contact_number_id, $or: [{ content_purge_pending: true }, { purged_at: { $ne: null } }] })) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
  if (job.subject_key !== run.subject_key)
    throw new CsiError("RUN_SCOPE_DENIED");
  const active: ActiveRunScope = {
    id: String(run._id),
    subject_key: run.subject_key,
    ...csiDataset(),
    status: run.status,
    token_nonce: run.token_nonce,
    permitted_tools: run.permitted_tools,
    lease_epoch: job.lease_epoch,
    leased_until: job.leased_until ?? null,
  };
  const now = Math.floor(Date.now() / 1000);
  return signRunToken(
    runClaimsSchema.parse({
      version: "csi-run-token-v1",
      run_id: runId,
      subject_key: run.subject_key,
      ...csiDataset(),
      aud: "vantage-csi",
      nonce: run.token_nonce,
      tools: run.permitted_tools,
      iat: now,
      exp: now + ttlSeconds,
      lease_epoch: job.lease_epoch,
    }),
    active,
  );
}
