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
import { assignSubject } from "../services/salesOutreach/commands/assignment";
import { setGoalDayOverride, type DayOverrideDeps } from "../services/salesOutreach/commands/dayOverride";
import { commandCallback, setQuotedFollowup } from "../services/salesOutreach/commands/plans";
import { addRestriction, confirmRestriction, liftRestriction, listRestrictions } from "../services/salesOutreach/commands/restrictions";
import { patchSalesOutreachConfiguration } from "../services/salesOutreach/config/commands";
import { salesOutreachConfigurationLoader, type ConfigurationLoader } from "../services/salesOutreach/config/load";
import { readSalesOutreachConfiguration } from "../services/salesOutreach/config/reads";
import { OutreachError, sendOutreachError } from "../services/salesOutreach/errors";
import { rolesWithCapability, type OutreachCapability } from "../services/salesOutreach/permissions";
import { readEnrollmentAdmissions, type AdmissionsStore } from "../services/salesOutreach/enrollment/admissions";
import {
  applyEnrollment,
  listEnrollmentCandidates,
  reportEnrollment,
  verifyEnrollment,
  type EnrollmentDeps,
} from "../services/salesOutreach/enrollment/service";
import { readOutreachDetail } from "../services/salesOutreach/reads/detail";
import type { DeskQueueStore } from "../services/salesOutreach/reads/deskStore";
import { readQueue } from "../services/salesOutreach/reads/queue";
import { readDeskCapabilities, readRepDays, readTeam, requireDeskConfiguration } from "../services/salesOutreach/reads/service";
import type { SalesOutreachReadStore } from "../services/salesOutreach/reads/store";
import { negotiateLiveVersion, streamOutreachLive, type OutreachLiveDeps } from "../services/salesOutreach/live/stream";
import {
  salesOutreachAgentIdSchema,
  salesOutreachConfigurationPatchSchema,
  salesOutreachScopeQuerySchema,
} from "../validation/v1/salesOutreach";
import {
  salesOutreachEnrollmentAdmissionsQuerySchema,
  salesOutreachEnrollmentApplySchema,
  salesOutreachEnrollmentCandidatesQuerySchema,
  salesOutreachEnrollmentReportSchema,
  salesOutreachEnrollmentVerifySchema,
} from "../validation/v1/salesOutreachEnrollment";
import {
  salesOutreachAssignmentRequestSchema,
  salesOutreachCallbackRequestSchema,
  salesOutreachDayOverrideRequestSchema,
  salesOutreachQuotedFollowupRequestSchema,
  salesOutreachRestrictionAddRequestSchema,
  salesOutreachRestrictionConfirmRequestSchema,
  salesOutreachRestrictionLiftRequestSchema,
  salesOutreachRestrictionsQuerySchema,
} from "../validation/v1/salesOutreachCommands";
import {
  salesOutreachDetailQuerySchema,
  salesOutreachLiveQuerySchema,
  salesOutreachQueueQuerySchema,
  salesOutreachRepDaysQuerySchema,
  salesOutreachTeamQuerySchema,
} from "../validation/v1/salesOutreachReads";

export type SalesOutreachRouteDeps = {
  connect?: typeof connectMongo;
  loader?: ConfigurationLoader;
  patchConfiguration?: typeof patchSalesOutreachConfiguration;
  auth?: OutreachAuthDeps;
  /** Desk read store (tests inject an in-memory one). */
  readStore?: SalesOutreachReadStore;
  /** Queue / outreach-view / team-cadence store (tests inject an in-memory one). */
  queueStore?: DeskQueueStore;
  /** Queue cursor HMAC secret override (tests); production derives it from the admin proxy signing secret. */
  cursorSecret?: string | null;
  /** Live stream seams (tests inject the change source, clock and lifetime). */
  live?: Omit<OutreachLiveDeps, "revalidate">;
  /** Enrollment stores/ledger (tests inject in-memory ones); loader and clock come from above. */
  enrollment?: Omit<EnrollmentDeps, "loader" | "now">;
  /** olr B8 admissions read store (tests inject an in-memory job ledger). */
  admissions?: AdmissionsStore;
  /** SRV-7 command stores/ledger (tests inject in-memory ones); the loader comes from above. */
  commands?: Omit<DayOverrideDeps, "loader">;
  now?: () => Date;
};

/** Every desk command needs an Idempotency-Key (at most 200 characters). */
function idempotencyKeyOf(req: Request): string {
  const key = req.header("idempotency-key")?.trim();
  if (!key || key.length > 200) throw new OutreachError("IDEMPOTENCY_KEY_REQUIRED");
  return key;
}

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
  const readDeps = () => ({ loader, store: deps.readStore, queueStore: deps.queueStore, now: now() });

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

  // SRV-8: queue, outreach view and the scoped live stream (Owner, Manager, linked Rep; scope enforced in the services).
  router.get(`${SALES_OUTREACH_API_PREFIX}/queue`, anyDeskRole, async (req, res) => {
    try {
      const query = salesOutreachQueueQuerySchema.parse(req.query);
      await connect();
      return res.json({ ok: true, data: await readQueue(outreachActorOf(res), query, { ...readDeps(), cursorSecret: deps.cursorSecret }) });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.get(`${SALES_OUTREACH_API_PREFIX}/outreach/:id`, anyDeskRole, async (req, res) => {
    try {
      salesOutreachDetailQuerySchema.parse(req.query);
      await connect();
      return res.json({ ok: true, data: await readOutreachDetail(outreachActorOf(res), String(req.params.id), readDeps()) });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.get(`${SALES_OUTREACH_API_PREFIX}/live`, anyDeskRole, async (req, res) => {
    try {
      const query = salesOutreachLiveQuerySchema.parse(req.query);
      negotiateLiveVersion(query.version);
      await connect();
      await requireDeskConfiguration(loader);
      const actor = outreachActorOf(res);
      const scope = { role: actor.role, agent_id: actor.agent_id };
      // Re-checked on every clock tick: a muted desk or a Rep whose reviewed link ended closes the stream.
      const revalidate = async () => {
        const loaded = await loader.load();
        if (loaded.state !== "active" || !loaded.value.controls.desk_enabled) return false;
        return actor.role !== "rep" || (await authDeps.hasReviewedSalesRepLink!(actor.agent_id!, now()));
      };
      streamOutreachLive(req, res, scope, { ...deps.live, revalidate });
    } catch (error) {
      fail(req, res, error);
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

  // olr B8: what intake decided on one New York day (admitted / held as review / refused by reason).
  router.get(`${SALES_OUTREACH_API_PREFIX}/enrollment/admissions`, guard("migration"), async (req, res) => {
    try {
      const query = salesOutreachEnrollmentAdmissionsQuerySchema.parse(req.query);
      await connect();
      return res.json({ ok: true, data: await readEnrollmentAdmissions({ business_day: query.business_day }, { store: deps.admissions, now }) });
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

  // SRV-7 commands. Each runs through the CSI command ledger (Idempotency-Key replay, CAS, audit) and
  // authorizes the subject itself (a Rep only on its current assignment; absent/foreign = 404).
  const commandDeps = () => ({ ...deps.commands, loader });
  const command =
    (handler: (req: Request, res: Response) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      try {
        salesOutreachScopeQuerySchema.parse(req.query);
        const data = await handler(req, res);
        return res.json({ ok: true, data });
      } catch (error) {
        return fail(req, res, error);
      }
    };

  router.patch(
    `${SALES_OUTREACH_API_PREFIX}/outreach/:id/quoted-followup`,
    guard("quoted_date_commands"),
    command(async (req, res) => {
      const idempotency_key = idempotencyKeyOf(req);
      const { scope: _scope, ...body } = salesOutreachQuotedFollowupRequestSchema.parse(req.body);
      void _scope;
      await connect();
      return setQuotedFollowup({ actor: outreachActorOf(res), subject_id: String(req.params.id), idempotency_key, ...body }, commandDeps());
    }),
  );

  router.patch(
    `${SALES_OUTREACH_API_PREFIX}/outreach/:id/callback`,
    guard("explicit_callback_commands"),
    command(async (req, res) => {
      const idempotency_key = idempotencyKeyOf(req);
      const { scope: _scope, ...body } = salesOutreachCallbackRequestSchema.parse(req.body);
      void _scope;
      await connect();
      return commandCallback({ actor: outreachActorOf(res), subject_id: String(req.params.id), idempotency_key, ...body }, commandDeps());
    }),
  );

  router.patch(
    `${SALES_OUTREACH_API_PREFIX}/outreach/:id/assignment`,
    guard("assign_reassign"),
    command(async (req, res) => {
      const idempotency_key = idempotencyKeyOf(req);
      const body = salesOutreachAssignmentRequestSchema.parse(req.body);
      await connect();
      return assignSubject(
        { actor: outreachActorOf(res), subject_id: String(req.params.id), idempotency_key, expected_revision: body.expected_revision, agent_id: body.agent_id },
        commandDeps(),
      );
    }),
  );

  router.patch(
    `${SALES_OUTREACH_API_PREFIX}/goals/:agent_id/day-override`,
    guard("prospective_absence_override"),
    command(async (req, res) => {
      const idempotency_key = idempotencyKeyOf(req);
      const agent_id = salesOutreachAgentIdSchema.parse(String(req.params.agent_id).toLowerCase());
      const body = salesOutreachDayOverrideRequestSchema.parse(req.body);
      await connect();
      return setGoalDayOverride(
        {
          actor: outreachActorOf(res),
          agent_id,
          idempotency_key,
          expected_revision: body.expected_revision,
          business_date: body.business_date,
          goal: body.goal,
          reason: body.reason,
        },
        commandDeps(),
      );
    }),
  );

  // P06c restriction review: Owner-only (P09b "lift contact restriction").
  router.get(`${SALES_OUTREACH_API_PREFIX}/restrictions`, guard("lift_contact_restriction"), async (req, res) => {
    try {
      const query = salesOutreachRestrictionsQuerySchema.parse(req.query);
      await connect();
      return res.json({ ok: true, data: await listRestrictions(outreachActorOf(res), query, { ...commandDeps(), now: now() }) });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.post(
    `${SALES_OUTREACH_API_PREFIX}/restrictions`,
    guard("lift_contact_restriction"),
    command(async (req, res) => {
      const idempotency_key = idempotencyKeyOf(req);
      const body = salesOutreachRestrictionAddRequestSchema.parse(req.body);
      await connect();
      return addRestriction(
        { actor: outreachActorOf(res), idempotency_key, contact_number_id: body.contact_number_id, channels: body.channels, until: body.until, reason: body.reason },
        commandDeps(),
      );
    }),
  );

  router.post(
    `${SALES_OUTREACH_API_PREFIX}/restrictions/:id/confirm`,
    guard("lift_contact_restriction"),
    command(async (req, res) => {
      const idempotency_key = idempotencyKeyOf(req);
      const body = salesOutreachRestrictionConfirmRequestSchema.parse(req.body);
      await connect();
      return confirmRestriction(
        { actor: outreachActorOf(res), idempotency_key, restriction_id: String(req.params.id), expected_revision: body.expected_revision },
        commandDeps(),
      );
    }),
  );

  router.post(
    `${SALES_OUTREACH_API_PREFIX}/restrictions/:id/lift`,
    guard("lift_contact_restriction"),
    command(async (req, res) => {
      const idempotency_key = idempotencyKeyOf(req);
      const body = salesOutreachRestrictionLiftRequestSchema.parse(req.body);
      await connect();
      return liftRestriction(
        { actor: outreachActorOf(res), idempotency_key, restriction_id: String(req.params.id), expected_revision: body.expected_revision, reason: body.reason },
        commandDeps(),
      );
    }),
  );

  return router;
}

export default createSalesOutreachRouter();
