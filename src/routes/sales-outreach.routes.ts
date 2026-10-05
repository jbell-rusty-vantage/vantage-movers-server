import { Router, type Request, type Response } from "express";
import { SALES_OUTREACH_API_PREFIX, SALES_OUTREACH_ROLES } from "../config/domain/salesOutreach";
import { connectMongo } from "../db";
import { requireApiSecret } from "../middleware/requireApiSecret";
import { assertCurrentScope } from "../services/salesIntelligence/auth";
import {
  hasReviewedSalesRepLink,
  outreachActorOf,
  requireOutreachActor,
  type OutreachAuthDeps,
} from "../services/salesOutreach/auth";
import { patchSalesOutreachConfiguration } from "../services/salesOutreach/config/commands";
import { salesOutreachConfigurationLoader, type ConfigurationLoader } from "../services/salesOutreach/config/load";
import { readSalesOutreachConfiguration } from "../services/salesOutreach/config/reads";
import { OutreachError, sendOutreachError } from "../services/salesOutreach/errors";
import { rolesWithCapability, type OutreachCapability } from "../services/salesOutreach/permissions";
import {
  applyEnrollment,
  listEnrollmentCandidates,
  reportEnrollment,
  verifyEnrollment,
  type EnrollmentDeps,
} from "../services/salesOutreach/enrollment/service";
import { readDeskCapabilities, readRepDays, readTeam } from "../services/salesOutreach/reads/service";
import type { SalesOutreachReadStore } from "../services/salesOutreach/reads/store";
import {
  salesOutreachConfigurationPatchSchema,
  salesOutreachScopeQuerySchema,
} from "../validation/v1/salesOutreach";
import {
  salesOutreachEnrollmentApplySchema,
  salesOutreachEnrollmentCandidatesQuerySchema,
  salesOutreachEnrollmentReportSchema,
  salesOutreachEnrollmentVerifySchema,
} from "../validation/v1/salesOutreachEnrollment";
import { salesOutreachRepDaysQuerySchema, salesOutreachTeamQuerySchema } from "../validation/v1/salesOutreachReads";

export type SalesOutreachRouteDeps = {
  connect?: typeof connectMongo;
  loader?: ConfigurationLoader;
  patchConfiguration?: typeof patchSalesOutreachConfiguration;
  auth?: OutreachAuthDeps;
  /** Desk read store (tests inject an in-memory one). */
  readStore?: SalesOutreachReadStore;
  /** Enrollment stores/ledger (tests inject in-memory ones); loader and clock come from above. */
  enrollment?: Omit<EnrollmentDeps, "loader" | "now">;
  now?: () => Date;
};

const requestIdOf = (req: Request) =>
  req.header("x-vantage-admin-request-id")?.trim() || req.header("x-request-id")?.trim() || "unavailable";

/**
 * Sales Outreach Desk API (`/api/v1/admin/sales-outreach`, IMPLEMENTATION-PLAN §5).
 *
 * Every route sits behind the API secret, a `scope` that may only be `production`, and
 * `requireOutreachActor` for the capability it serves (permissions.ts). The configuration routes
 * stay available to the Owner even while `controls.desk_enabled` is false, so a disable is
 * reversible (CONTRACTS). No GET initializes configuration or performs provider I/O.
 */
export function createSalesOutreachRouter(deps: SalesOutreachRouteDeps = {}): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  const loader = deps.loader ?? salesOutreachConfigurationLoader;
  const patch = deps.patchConfiguration ?? patchSalesOutreachConfiguration;
  const now = deps.now ?? (() => new Date());
  const fail = (req: Request, res: Response, error: unknown) => {
    if (!res.headersSent) sendOutreachError(res, error, requestIdOf(req), req.path);
  };
  const authDeps: OutreachAuthDeps = {
    ...deps.auth,
    hasReviewedSalesRepLink:
      deps.auth?.hasReviewedSalesRepLink ??
      (async (agentId, at) => {
        await connect();
        return hasReviewedSalesRepLink(agentId, at);
      }),
  };
  const guard = (capability: OutreachCapability) => requireOutreachActor(rolesWithCapability(capability), fail, authDeps);
  /** Owner, Manager and linked Rep; the read itself narrows a Rep to its own scope. */
  const anyDeskRole = requireOutreachActor(SALES_OUTREACH_ROLES, fail, authDeps);
  const readDeps = () => ({ loader, store: deps.readStore, now: now() });

  router.use(SALES_OUTREACH_API_PREFIX, requireApiSecret, (req, res, next) => {
    try {
      assertCurrentScope(req.query.scope, req.body?.scope);
      next();
    } catch (error) {
      fail(req, res, error);
    }
  });

  // M1 reads (FAST-TRACK M1). Configuration and capabilities stay open while the desk is disabled.
  router.get(`${SALES_OUTREACH_API_PREFIX}/capabilities`, anyDeskRole, async (req, res) => {
    try {
      salesOutreachScopeQuerySchema.parse(req.query);
      await connect();
      return res.json({ ok: true, data: await readDeskCapabilities(outreachActorOf(res), readDeps()) });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.get(`${SALES_OUTREACH_API_PREFIX}/rep-days`, anyDeskRole, async (req, res) => {
    try {
      const query = salesOutreachRepDaysQuerySchema.parse(req.query);
      await connect();
      return res.json({ ok: true, data: await readRepDays(outreachActorOf(res), query, readDeps()) });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.get(`${SALES_OUTREACH_API_PREFIX}/team`, guard("team_reads"), async (req, res) => {
    try {
      const query = salesOutreachTeamQuerySchema.parse(req.query);
      await connect();
      return res.json({ ok: true, data: await readTeam(outreachActorOf(res), query, readDeps()) });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.get(`${SALES_OUTREACH_API_PREFIX}/configuration`, guard("configuration_read"), async (req, res) => {
    try {
      salesOutreachScopeQuerySchema.parse(req.query);
      await connect();
      return res.json({ ok: true, data: await readSalesOutreachConfiguration(loader, now()) });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.patch(`${SALES_OUTREACH_API_PREFIX}/configuration`, guard("configuration_edit"), async (req, res) => {
    try {
      salesOutreachScopeQuerySchema.parse(req.query);
      const idempotency_key = req.header("idempotency-key")?.trim();
      if (!idempotency_key || idempotency_key.length > 200) throw new OutreachError("IDEMPOTENCY_KEY_REQUIRED");
      const body = salesOutreachConfigurationPatchSchema.parse(req.body);
      await connect();
      const { response, replayed } = await patch({
        actor: outreachActorOf(res).actor,
        idempotency_key,
        expected_revision: body.expected_revision,
        value: body.value,
      });
      return res.json({ ok: true, data: { contract_version: "sod-v1", ...response, replayed } });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  // Enrollment (P10a/P10b, FAST-01 backfill): Owner-only `migration` capability.
  const enrollmentDeps = () => ({ ...deps.enrollment, loader, now });
  router.get(`${SALES_OUTREACH_API_PREFIX}/enrollment/candidates`, guard("migration"), async (req, res) => {
    try {
      const query = salesOutreachEnrollmentCandidatesQuerySchema.parse(req.query);
      await connect();
      return res.json({ ok: true, data: await listEnrollmentCandidates(query, enrollmentDeps()) });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.post(`${SALES_OUTREACH_API_PREFIX}/enrollment/report`, guard("migration"), async (req, res) => {
    try {
      salesOutreachScopeQuerySchema.parse(req.query);
      const body = salesOutreachEnrollmentReportSchema.parse(req.body);
      await connect();
      return res.json({ ok: true, data: await reportEnrollment(body, enrollmentDeps()) });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.post(`${SALES_OUTREACH_API_PREFIX}/enrollment/apply`, guard("migration"), async (req, res) => {
    try {
      salesOutreachScopeQuerySchema.parse(req.query);
      const run_key = req.header("idempotency-key")?.trim();
      if (!run_key || run_key.length > 120) throw new OutreachError("IDEMPOTENCY_KEY_REQUIRED");
      const body = salesOutreachEnrollmentApplySchema.parse(req.body);
      await connect();
      const data = await applyEnrollment(
        {
          actor: outreachActorOf(res).actor,
          run_key,
          kind: body.kind,
          cohort_id: body.cohort_id,
          lead_refs: body.lead_refs,
          manifest_hash: body.manifest_hash,
          deadline_ms: body.deadline_seconds === undefined ? undefined : body.deadline_seconds * 1000,
        },
        enrollmentDeps(),
      );
      return res.json({ ok: true, data });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.post(`${SALES_OUTREACH_API_PREFIX}/enrollment/verify`, guard("migration"), async (req, res) => {
    try {
      salesOutreachScopeQuerySchema.parse(req.query);
      const body = salesOutreachEnrollmentVerifySchema.parse(req.body);
      await connect();
      return res.json({ ok: true, data: await verifyEnrollment({ actor: outreachActorOf(res).actor, run_key: body.run_key }, enrollmentDeps()) });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  return router;
}

export default createSalesOutreachRouter();
