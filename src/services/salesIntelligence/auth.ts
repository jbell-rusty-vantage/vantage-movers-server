import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Request } from "express";
import { type VantageAuthContext } from "../../middleware/requireApiSecret";
import { requireRegistryOwnerActor } from "../operationsRegistry/trustedActor";
import {
  CSI_TOOLS,
  csiDataset,
  type CsiErrorCode,
} from "../../config/domain/salesIntelligence";
import { csiIdSchema } from "../../validation/v1/salesIntelligence";
import { getIntelligenceRunModel } from "../../models/IntelligenceRun";
import { getSalesIntelligenceJobModel } from "../../models/SalesIntelligenceJob";
const getVantageAuth = (req: Request) =>
  (req as Request & { vantageAuth?: VantageAuthContext }).vantageAuth;
export class CsiError extends Error {
  constructor(readonly code: CsiErrorCode) {
    super(code);
  }
}
export type CsiActor = Readonly<{
  kind: "owner" | "worker" | "intelligence";
  id: string;
  request_id: string;
  run_id: string | null;
}>;
const trustedActors = new WeakSet<CsiActor>();
function trust(actor: CsiActor): CsiActor {
  Object.freeze(actor);
  trustedActors.add(actor);
  return actor;
}
export function assertTrustedActor(actor: CsiActor, kind?: CsiActor["kind"]) {
  if (!trustedActors.has(actor) || (kind && actor.kind !== kind))
    throw new CsiError("OWNER_REQUIRED");
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
    });
  } catch {
    throw new CsiError("OWNER_REQUIRED");
  }
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
    req.header("x-vantage-intelligence-run-token") ?? "",
    getVantageAuth(req),
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
      request_id: req.header("x-request-id") ?? runId,
      run_id: runId,
    }),
  };
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
    status: "running",
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
