import type { NextFunction, Request, Response } from "express";
import type { SalesOutreachRole } from "../../config/domain/salesOutreach";
import { getRepIdentityLinkModel } from "../../models/RepIdentityLink";
import { ADMIN_PROXY_HEADER_NAMES } from "../operationsRegistry/trustedActorCanonical";
import {
  CsiError,
  requireCsiManager,
  requireCsiOwner,
  requireSignedCsiRep,
  type CsiActor,
} from "../salesIntelligence/auth";
import { OutreachError } from "./errors";

/**
 * The Sales Outreach Desk actor (IMPLEMENTATION-PLAN §5, P09b/P09c, IMPL-03).
 *
 * - `owner`: the signed Owner (P09c "Admin means Owner"), verified exactly as every Owner surface.
 * - `manager`: a signed `manager` (seven-line payload).
 * - `rep`: a signed `rep` whose signed Agent has a `reviewed` `sales_rep` identity link effective at
 *   the request instant; otherwise 403 `REP_NOT_LINKED`.
 * - generic `admin`, unsigned, forged, stale or unknown roles: 403 `FORBIDDEN`.
 *
 * Identity comes only from the admin proxy's signed headers, never from the query or body.
 */
export type OutreachActor = Readonly<{
  role: SalesOutreachRole;
  /** Trusted CSI actor for the command ledger/audit (kind owner | manager | rep). */
  actor: CsiActor;
  /** The rep's linked Agent; null for owner/manager. */
  agent_id: string | null;
}>;

export type OutreachAuthDeps = {
  now?: () => number;
  /** Whether the Agent has a reviewed `sales_rep` link effective at `at`. */
  hasReviewedSalesRepLink?: (agentId: string, at: Date) => Promise<boolean>;
};

export async function hasReviewedSalesRepLink(agentId: string, at: Date): Promise<boolean> {
  const row = await getRepIdentityLinkModel()
    .findOne({
      agent_id: agentId,
      status: "reviewed",
      role_kind: "sales_rep",
      effective_from: { $lte: at },
      $or: [{ effective_to: null }, { effective_to: { $gt: at } }],
    })
    .select({ _id: 1 })
    .lean();
  return row !== null;
}

function signedRole(req: Request): string | null {
  return req.header(ADMIN_PROXY_HEADER_NAMES.role)?.trim().toLowerCase() || null;
}

export async function resolveOutreachActor(req: Request, deps: OutreachAuthDeps = {}): Promise<OutreachActor> {
  const now = (deps.now ?? Date.now)();
  const role = signedRole(req);
  try {
    if (role === "owner") return { role: "owner", actor: requireCsiOwner(req), agent_id: null };
    if (role === "manager") return { role: "manager", actor: requireCsiManager(req, now), agent_id: null };
    if (role === "rep") {
      const rep = requireSignedCsiRep(req, now);
      const linked = await (deps.hasReviewedSalesRepLink ?? hasReviewedSalesRepLink)(rep.agent_id, new Date(now));
      if (!linked) throw new OutreachError("REP_NOT_LINKED");
      return { role: "rep", actor: rep, agent_id: rep.agent_id };
    }
  } catch (error) {
    if (error instanceof CsiError) throw new OutreachError("FORBIDDEN");
    throw error;
  }
  throw new OutreachError("FORBIDDEN");
}

export const OUTREACH_ACTOR_LOCAL = "outreach_actor" as const;

export function outreachActorOf(res: Response): OutreachActor {
  const actor = res.locals[OUTREACH_ACTOR_LOCAL] as OutreachActor | undefined;
  if (!actor) throw new OutreachError("FORBIDDEN");
  return actor;
}

/**
 * Express guard: resolves the desk actor and admits only `roles`. The resolved actor is stored on
 * `res.locals.outreach_actor`. Refusals go to `onError` (the router's envelope).
 */
export function requireOutreachActor(
  roles: readonly SalesOutreachRole[],
  onError: (req: Request, res: Response, error: unknown) => void,
  deps: OutreachAuthDeps = {},
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = await resolveOutreachActor(req, deps);
      if (!roles.includes(actor.role)) throw new OutreachError("FORBIDDEN");
      res.locals[OUTREACH_ACTOR_LOCAL] = actor;
      next();
    } catch (error) {
      onError(req, res, error);
    }
  };
}
