import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { Router, type Request, type Response } from "express";
import { z, ZodError } from "zod";
import { csiFlag } from "../config/domain/salesIntelligence";
import { connectMongo } from "../db";
import { logger } from "../logger";
import { getContactNumberDetail } from "../services/numberActivity/contactNumbers";
import { readOwnerCoverage } from "../services/salesIntelligence/ownerCoverage";
import { commandPlanBackfill } from "../services/salesIntelligence/backfill/plan";
import { csiBackfillCommandSchema } from "../validation/v1/salesIntelligence";
import { commandCsiSettings, readCsiSettings } from "../services/salesIntelligence/settings";
import { csiSettingsCommandSchema } from "../validation/v1/salesIntelligence";
import { enqueueNumberRebuild } from "../services/numberActivity/rebuild";
import { numberSearchQuerySchema, searchNumberActivity } from "../services/numberActivity/search";
import { getNumberTimeline } from "../services/numberActivity/timeline";
import { readNumberTimelineV2, readOutreachTimeline, timelineV2QuerySchema } from "../services/salesIntelligence/outreach/timelineRead";
import { CsiError, requireCsiOwner, requireCsiReader, assertCurrentScope, csiRepScope, type CsiActor } from "../services/salesIntelligence/auth";
import { repScopeChecks, type RepScopeChecks } from "../services/salesIntelligence/repScope";
import { assertRepCommand, REP_OUTREACH_COMMANDS } from "../services/salesIntelligence/followups/commands";
import { REP_LIVE_TOPICS } from "../services/salesIntelligence/live";
import { csiCommandSchema, csiIdSchema } from "../validation/v1/salesIntelligence";
import { attachmentListQuerySchema, listAttachments } from "../services/salesIntelligence/attachment/reads";
import { commandAttachment } from "../services/salesIntelligence/attachment/commands";
import { commandOutreach } from "../services/salesIntelligence/followups/commands";
import { listReviewItems, readOutreach, readOutreachByLead, reviewItemsQuerySchema } from "../services/salesIntelligence/outreach/reads";
import { attentionQuerySchema, readAttention } from "../services/salesIntelligence/outreach/attention";
import { closedHistoryQuerySchema, readClosedHistory } from "../services/salesIntelligence/outreach/closedHistory";
import { overviewQuerySchema, readOverview } from "../services/salesIntelligence/overview/read";
import { commandRebuildOverviewDay } from "../services/salesIntelligence/overview/commands";
import { listRepLinks, readRepLink, repListQuerySchema } from "../services/salesIntelligence/repIdentity/reads";
import { createRepLink, proposeRepLinks, reviewRepLink } from "../services/salesIntelligence/repIdentity/commands";
import { csiRepCreateSchema, csiRepProposeSchema, csiRepCommandSchema } from "../validation/v1/salesIntelligence";
import { previewNudge, sendNudge } from "../services/salesIntelligence/nudges/commands";
import { listNudges, nudgeHistoryQuerySchema } from "../services/salesIntelligence/nudges/reads";
import { csiNudgeCommandSchema } from "../validation/v1/salesIntelligence";
import { streamCsiInvalidations } from "../services/salesIntelligence/live";
import { commandAnalysis } from "../services/salesIntelligence/analysis/ownerCommands";
import { listOwnerRuns, readOwnerRun, readOwnerEvidence } from "../services/salesIntelligence/analysis/ownerReads";
import { readAssessment, readAssessmentEvidence, readAssessmentOutput, readOutreachAssessment, readRunOutput, readRunPresentation } from "../services/salesIntelligence/assessment/reads";
import { currentFindingsQuerySchema, readCurrentFindings } from "../services/salesIntelligence/analysis/currentFindings";
import { ownerConversationsQuerySchema, ownerTranscriptQuerySchema, readOwnerConversations, readOwnerTranscript } from "../services/salesIntelligence/analysis/ownerConversations";
import { openOwnerConversationMedia } from "../services/salesIntelligence/conversations/ownerMedia";

/**
 * CSI-04 Owner routes for Number Activity (04 §0, §1 `/numbers` rows, §3).
 *
 * Mounted in `v1.routes.ts` after `requireApiSecret` and after the CSI
 * boundary router (flag + Owner + scope). Every handler still re-checks the
 * flag and the signed Owner identity so the router is safe if mounted alone.
 * Reads never mutate; the rebuild command only enqueues a durable job through
 * the idempotent command ledger (`Idempotency-Key` required). Full customer
 * numbers appear because these routes are Owner-only.
 */
export const CSI_ADMIN_PREFIX = "/api/v1/admin/sales-intelligence";

/**
 * S8-REP (assignment addendum §4.2): the routes a signed rep may call (with `SALES_INTELLIGENCE_REP_ACCESS` on),
 * as `METHOD path`. Reads are forced to the rep's scope (desk, Closed history, Overview) or answer 404 outside
 * it (record-, Number- and conversation-keyed reads). The command routes accept a rep only for the E9 allowlist
 * (`assertRepCommand`); anything else there is `FORBIDDEN`. Every other route keeps `requireCsiOwner`
 * (403 `OWNER_REQUIRED` for a rep, as for Admin). `sales-intelligence-rep-access.test.ts` enumerates the router.
 */
export const CSI_REP_READ_ROUTES = [
  "GET /live", "GET /attention", "GET /outreach/closed-history", "GET /overview",
  "GET /outreach/:id", "GET /outreach/:id/timeline", "GET /outreach/:id/assessment", "GET /outreach/:id/findings",
  "GET /numbers/:id/conversations", "GET /conversations/:id/transcript", "GET /conversations/:id/media",
] as const;
/** The E9 commands a rep may send, each on its own follow-up with a note. */
export const CSI_REP_COMMAND_ROUTES = ["POST /followups/:id/complete", "POST /followups/:id/snooze", "PATCH /followups/:id"] as const;

export type SalesIntelligenceAdminRouteDeps = {
  connect?: typeof connectMongo;
  flag?: typeof csiFlag;
  owner?: typeof requireCsiOwner;
  /** S8-REP: the Owner, or a signed rep with REP_ACCESS on. */
  reader?: typeof requireCsiReader;
  /** S8-REP: record / Number / conversation scope checks for a rep. */
  repScope?: RepScopeChecks;
  attention?: typeof readAttention;
  outreach?: typeof readOutreach;
  search?: typeof searchNumberActivity;
  detail?: typeof getContactNumberDetail;
  timeline?: typeof getNumberTimeline;
  /** S4-TIMELINE: served only when `SALES_INTELLIGENCE_TIMELINE_V2` is on. */
  timelineV2?: typeof readNumberTimelineV2;
  outreachTimeline?: typeof readOutreachTimeline;
  enqueueRebuild?: typeof enqueueNumberRebuild;
  coverage?: typeof readOwnerCoverage;
  settings?: typeof readCsiSettings;
  updateSettings?: typeof commandCsiSettings;
  planBackfill?: typeof commandPlanBackfill;
  attachments?: typeof listAttachments;
  attachmentCommand?: typeof commandAttachment;
  outreachCommand?: typeof commandOutreach;
  reps?: typeof listRepLinks;
  rep?: typeof readRepLink;
  createRep?: typeof createRepLink;
  proposeReps?: typeof proposeRepLinks;
  reviewRep?: typeof reviewRepLink;
  nudgePreview?: typeof previewNudge;
  nudgeSend?: typeof sendNudge;
  nudges?: typeof listNudges;
  live?: typeof streamCsiInvalidations;
  outreachAssessment?: typeof readOutreachAssessment;
  assessment?: typeof readAssessment;
  assessmentOutput?: typeof readAssessmentOutput;
  assessmentEvidence?: typeof readAssessmentEvidence;
  runPresentation?: typeof readRunPresentation;
  runOutput?: typeof readRunOutput;
  currentFindings?: typeof readCurrentFindings;
  conversations?: typeof readOwnerConversations;
  transcript?: typeof readOwnerTranscript;
  conversationMedia?: typeof openOwnerConversationMedia;
  closedHistory?: typeof readClosedHistory;
  overview?: typeof readOverview;
  rebuildOverviewDay?: typeof commandRebuildOverviewDay;
};

const timelineQuerySchema = z
  .object({
    scope: z.literal("production").optional(),
    cursor: z.string().max(2000).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

const STATUS_BY_CODE: Partial<Record<CsiError["code"], number>> = {
  FEATURE_DISABLED: 404,
  OWNER_REQUIRED: 403,
  UNSUPPORTED_SCOPE: 403,
  INVALID_INPUT: 400,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  ILLEGAL_TRANSITION: 409,
  IDENTITY_BLOCKED: 409,
  CONTACT_RESTRICTED: 409,
  OFFICIAL_STATE_BLOCKS_REOPEN: 409,
  EVIDENCE_SCOPE_INVALID: 400,
  SUBMISSION_CONFLICT: 409,
  ATTENTION_SNAPSHOT_EXPIRED: 409,
  NUDGE_NOT_ACTIONABLE: 409,
  NUDGE_CONFIGURATION_UNAVAILABLE: 409,
  NUDGE_DESTINATION_EVIDENCE_INCOMPLETE: 409,
  NUDGE_DESTINATION_IS_CUSTOMER: 422,
  NUDGE_BODY_INVALID: 422,
  ORIGINAL_EVIDENCE_UNAVAILABLE: 422,
  RUN_SCOPE_DENIED: 403,
  // S8-REP: a rep command outside the E9 allowlist or on another rep's follow-up.
  FORBIDDEN: 403,
};

export function createSalesIntelligenceAdminRouter(deps: SalesIntelligenceAdminRouteDeps = {}): Router {
  const router = Router();
  const connect = deps.connect ?? connectMongo;
  const flag = deps.flag ?? csiFlag;
  const owner = deps.owner ?? requireCsiOwner;
  const search = deps.search ?? searchNumberActivity;
  const detail = deps.detail ?? getContactNumberDetail;
  const timeline = deps.timeline ?? getNumberTimeline;
  const enqueueRebuild = deps.enqueueRebuild ?? enqueueNumberRebuild;

  const guard = (req: Request) => {
    if (!flag("ENABLED")) throw new CsiError("FEATURE_DISABLED");
    const actor = owner(req);
    assertCurrentScope(req.query.scope, req.body?.scope);
    return actor;
  };
  // S8-REP: the rep-readable routes (`CSI_REP_READ_ROUTES`, `CSI_REP_COMMAND_ROUTES`) admit a signed rep too.
  const reader = deps.reader ?? requireCsiReader;
  const scopeChecks = deps.repScope ?? repScopeChecks;
  const readerGuard = (req: Request) => {
    if (!flag("ENABLED")) throw new CsiError("FEATURE_DISABLED");
    const actor = reader(req);
    assertCurrentScope(req.query.scope, req.body?.scope);
    return actor;
  };
  /** True for the Owner; for a rep, whether the record / Number / conversation is in its E11 scope (else the route's own 404). */
  const inScope = async (actor: CsiActor, kind: keyof RepScopeChecks, id: string) => {
    const scope = csiRepScope(actor);
    return scope ? scopeChecks[kind](id, scope.agent_id) : true;
  };
  const fail = (req: Request, res: Response, error: unknown) => {
    const requestId = req.header("x-vantage-admin-request-id") ?? req.header("x-request-id") ?? "unavailable";
    if (error instanceof ZodError) {
      return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "Invalid request", request_id: requestId });
    }
    if (error instanceof CsiError) {
      const status = STATUS_BY_CODE[error.code] ?? 500;
      return res.status(status).json({
        ok: false,
        code: error.code,
        error: error.code === "FEATURE_DISABLED" ? "Sales Intelligence is disabled" : "Sales Intelligence request rejected",
        request_id: requestId,
        // Additive (V-AC S5): which parts were refused, when the service said so (e.g. `policy.<field>` / `requires_attention_evolution`).
        ...(error.issues?.length ? { issues: error.issues } : {}),
      });
    }
    logger.error({
      msg: "sales_intelligence.admin.route_failed",
      path: req.path,
      errorName: error instanceof Error ? error.name : "Error",
    });
    return res.status(500).json({ ok: false, code: "INVALID_INPUT", error: "Sales Intelligence request failed", request_id: requestId });
  };
  const notFound = (req: Request, res: Response, resource = "Number") =>
    res.status(404).json({
      ok: false,
      code: "INVALID_INPUT",
      error: `${resource} not found`,
      request_id: req.header("x-vantage-admin-request-id") ?? req.header("x-request-id") ?? "unavailable",
    });

  router.get(`${CSI_ADMIN_PREFIX}/live`, async (req, res) => {
    try {
      const actor = readerGuard(req);
      z.object({ scope: z.literal("production").optional() }).strict().parse(req.query);
      await connect();
      // S8-REP: frames carry no subject for anyone; a rep's stream is limited to the topics of the surfaces it reads.
      if (csiRepScope(actor)) (deps.live ?? streamCsiInvalidations)(req, res, { topics: REP_LIVE_TOPICS });
      else (deps.live ?? streamCsiInvalidations)(req, res);
    } catch (error) { if (!res.headersSent) fail(req, res, error); else res.end(); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/coverage`, async (req, res) => {
    try {
      guard(req);
      z.object({ scope: z.literal("production").optional() }).strict().parse(req.query);
      await connect();
      const coverage = await (deps.coverage ?? readOwnerCoverage)();
      return res.json({ ok: true, data: { as_of: new Date().toISOString(), coverage } });
    } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/settings`, async (req, res) => {
    try {
      guard(req);
      z.object({ scope: z.literal("production").optional() }).strict().parse(req.query);
      await connect();
      const data = await (deps.settings ?? readCsiSettings)();
      return res.json({ ok: true, as_of: new Date().toISOString(), data });
    } catch (error) { return fail(req, res, error); }
  });
  router.post(`${CSI_ADMIN_PREFIX}/backfill`, async (req, res) => {
    try {
      const actor = guard(req);
      const idempotency_key = req.header("idempotency-key")?.trim();
      if (!idempotency_key) throw new CsiError("INVALID_INPUT");
      const command = csiBackfillCommandSchema.parse(req.body);
      await connect();
      const data = await (deps.planBackfill ?? commandPlanBackfill)({ actor, idempotency_key, command });
      return res.status(202).json({ ok: true, data });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.patch(`${CSI_ADMIN_PREFIX}/settings`, async (req, res) => {
    try {
      const actor = guard(req);
      const idempotency_key = req.header("idempotency-key")?.trim();
      if (!idempotency_key) throw new CsiError("INVALID_INPUT");
      const command = csiSettingsCommandSchema.parse(req.body);
      await connect();
      return res.json({ ok: true, data: await (deps.updateSettings ?? commandCsiSettings)({ actor, idempotency_key, command }) });
    } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/numbers`, async (req, res) => {
    try {
      guard(req);
      const query = numberSearchQuerySchema.parse(req.query);
      await connect();
      return res.json({ ok: true, ...(await search(query)) });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.get(`${CSI_ADMIN_PREFIX}/numbers/:id`, async (req, res) => {
    try {
      guard(req);
      const id = csiIdSchema.parse(req.params.id);
      await connect();
      const row = await detail(id);
      if (!row) return notFound(req, res);
      return res.json({ ok: true, ...row });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.get(`${CSI_ADMIN_PREFIX}/numbers/:id/timeline`, async (req, res) => {
    try {
      guard(req);
      const id = csiIdSchema.parse(req.params.id);
      // Timeline v2 (data spec §5): the story catalog, `kinds[]`, `kind_order` cursor. Off = today's v1 response, byte for byte.
      if (flag("TIMELINE_V2")) {
        const v2 = timelineV2QuerySchema.parse(req.query);
        await connect();
        const page = await (deps.timelineV2 ?? readNumberTimelineV2)(id, v2);
        if (!page) return notFound(req, res);
        return res.json({ ok: true, ...page });
      }
      const query = timelineQuerySchema.parse(req.query);
      await connect();
      const page = await timeline(id, { cursor: query.cursor, limit: query.limit });
      if (!page) return notFound(req, res);
      return res.json({ ok: true, ...page });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.post(`${CSI_ADMIN_PREFIX}/numbers/:id/rebuild`, async (req, res) => {
    try {
      const actor = guard(req);
      const id = csiIdSchema.parse(req.params.id);
      const idempotencyKey = req.header("idempotency-key")?.trim();
      if (!idempotencyKey) throw new CsiError("INVALID_INPUT");
      const command = csiCommandSchema.parse(req.body);
      if (command.command !== "rebuild_number") throw new CsiError("INVALID_INPUT");
      await connect();
      const result = await enqueueRebuild({
        actor,
        number_id: id,
        expected_revision: command.expected_revision,
        reason: command.reason,
        idempotency_key: idempotencyKey,
      });
      return res.status(202).json({ ok: true, data: result });
    } catch (error) {
      return fail(req, res, error);
    }
  });

  router.get(`${CSI_ADMIN_PREFIX}/attachments`, async (req, res) => {
    try {
      guard(req);
      const query = attachmentListQuerySchema.parse(req.query);
      await connect();
      return res.json({ ok: true, data: await (deps.attachments ?? listAttachments)(query) });
    } catch (error) { return fail(req, res, error); }
  });
  for (const [path, action] of [["/attachments/attach", "attach_lead"], ["/attachments/:id/reject", "reject_attachment"],
    ["/attachments/:id/detach", "detach_attachment"]] as const) {
    router.post(`${CSI_ADMIN_PREFIX}${path}`, async (req, res) => {
      try {
        const actor = guard(req);
        if (!flag("ATTACHMENT_REFRESH")) throw new CsiError("FEATURE_DISABLED");
        const command = csiCommandSchema.parse(req.body);
        if (command.command !== action || (command.command !== "attach_lead" && command.command !== "reject_attachment" && command.command !== "detach_attachment")) throw new CsiError("INVALID_INPUT");
        const idempotency_key = req.header("idempotency-key")?.trim();
        if (!idempotency_key) throw new CsiError("INVALID_INPUT");
        const attachment_id = action === "attach_lead" ? undefined : csiIdSchema.parse("id" in req.params ? req.params.id : undefined);
        await connect();
        return res.json({ ok: true, data: await (deps.attachmentCommand ?? commandAttachment)({ actor, idempotency_key, attachment_id, command }) });
      } catch (error) { return fail(req, res, error); }
    });
  }
  router.get(`${CSI_ADMIN_PREFIX}/outreach/by-lead/:model/:id`, async (req, res) => {
    try { guard(req); const model = z.enum(["FormLead", "CallLead"]).parse(req.params.model); const id = csiIdSchema.parse(req.params.id);
      await connect(); const result = await readOutreachByLead(model, id); if (!result) return notFound(req, res); return res.json({ ok: true, ...result }); } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/attention`, async (req, res) => {
    // S8-REP: a rep's desk is forced to `agent_id=[its Agent]` (client `agent_id` / `unassigned` ignored), with its own tiles and chip counts.
    try { const actor = readerGuard(req); const query = attentionQuerySchema.parse(req.query); await connect(); const scope = csiRepScope(actor);
      return res.json({ ok: true, ...(await (deps.attention ?? readAttention)(query, scope ? { scope } : {})) }); }
    catch (error) { return fail(req, res, error); }
  });
  // S7-CLOSED (addendum §2.2a, E27): closed Outreach beyond the snapshot's 90 days. Registered before `/outreach/:id`.
  // S8-REP: a rep's read is forced to `{ agent_id }` and its cursor binds to it; the Owner reads unscoped.
  router.get(`${CSI_ADMIN_PREFIX}/outreach/closed-history`, async (req, res) => {
    try { const actor = readerGuard(req); const query = closedHistoryQuerySchema.parse(req.query); await connect();
      return res.json({ ok: true, ...(await (deps.closedHistory ?? readClosedHistory)(query, { scope: csiRepScope(actor) })) }); }
    catch (error) { return fail(req, res, error); }
  });
  // S9-READS (addendum §6–§7): the Overview tab. 404 FEATURE_DISABLED until `SALES_INTELLIGENCE_OVERVIEW` is on.
  // S8-REP: a rep's Overview is forced to `{ agent_id }`: its own numbers plus anonymous team medians (E23, C11).
  router.get(`${CSI_ADMIN_PREFIX}/overview`, async (req, res) => {
    try { const actor = readerGuard(req); if (!flag("OVERVIEW")) throw new CsiError("FEATURE_DISABLED");
      const query = overviewQuerySchema.parse(req.query); await connect();
      return res.json({ ok: true, data: await (deps.overview ?? readOverview)(query, { scope: csiRepScope(actor) }) }); }
    catch (error) { return fail(req, res, error); }
  });
  router.post(`${CSI_ADMIN_PREFIX}/overview/rebuild-day`, async (req, res) => {
    try { const actor = guard(req); if (!flag("OVERVIEW")) throw new CsiError("FEATURE_DISABLED");
      const idempotency_key = req.header("idempotency-key")?.trim(); if (!idempotency_key) throw new CsiError("INVALID_INPUT");
      await connect(); return res.json({ ok: true, data: await (deps.rebuildOverviewDay ?? commandRebuildOverviewDay)({ actor, idempotency_key, command: req.body }) }); }
    catch (error) { return fail(req, res, error); }
  });
  // Move assessment §8.3–8.4 / MA-01 §10: GET-only presentation reads behind the master flag. No model calls, no writes.
  const scopeOnly = z.object({ scope: z.literal("production").optional() }).strict();
  // S8-REP: every record-keyed read below answers a rep outside its E11 scope with the same 404 as a missing record.
  router.get(`${CSI_ADMIN_PREFIX}/outreach/:id/assessment`, async (req, res) => {
    try { const actor = readerGuard(req); const id = csiIdSchema.parse(req.params.id); scopeOnly.parse(req.query); await connect();
      if (!(await inScope(actor, "record", id))) return notFound(req, res, "Outreach");
      const result = await (deps.outreachAssessment ?? readOutreachAssessment)(id);
      return result ? res.json({ ok: true, ...result }) : notFound(req, res, "Outreach"); } catch (error) { return fail(req, res, error); }
  });
  // Data spec §6.11 A / final spec §11.5: current findings of the record's Number (latest run per conversation). GET-only.
  router.get(`${CSI_ADMIN_PREFIX}/outreach/:id/findings`, async (req, res) => {
    try { const actor = readerGuard(req); const id = csiIdSchema.parse(req.params.id); const query = currentFindingsQuerySchema.parse(req.query); await connect();
      if (!(await inScope(actor, "record", id))) return notFound(req, res, "Outreach");
      const result = await (deps.currentFindings ?? readCurrentFindings)(id, query);
      return result ? res.json({ ok: true, ...result }) : notFound(req, res, "Outreach"); } catch (error) { return fail(req, res, error); }
  });
  for (const [path, read] of [["/assessments/:artifactId", () => deps.assessment ?? readAssessment],
    ["/assessments/:artifactId/output", () => deps.assessmentOutput ?? readAssessmentOutput],
    ["/assessments/:artifactId/evidence", () => deps.assessmentEvidence ?? readAssessmentEvidence]] as const) router.get(`${CSI_ADMIN_PREFIX}${path}`, async (req, res) => {
    try { guard(req); const id = csiIdSchema.parse(req.params.artifactId); scopeOnly.parse(req.query); await connect();
      const result = await read()(id);
      return result ? res.json({ ok: true, ...result }) : notFound(req, res, "Assessment"); } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/analysis-runs/:id/presentation`, async (req, res) => {
    try { guard(req); const id = csiIdSchema.parse(req.params.id); scopeOnly.parse(req.query); await connect();
      const result = await (deps.runPresentation ?? readRunPresentation)(id);
      return result ? res.json({ ok: true, ...result }) : notFound(req, res, "Analysis"); } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/analysis-runs/:id/output/:outputId`, async (req, res) => {
    try { guard(req); const id = csiIdSchema.parse(req.params.id), outputId = csiIdSchema.parse(req.params.outputId); scopeOnly.parse(req.query); await connect();
      const result = await (deps.runOutput ?? readRunOutput)(id, outputId);
      return result ? res.json({ ok: true, ...result }) : notFound(req, res, "Output"); } catch (error) { return fail(req, res, error); }
  });
  // Timeline v2, scope outreach (final spec §10.3). 404 FEATURE_DISABLED until `SALES_INTELLIGENCE_TIMELINE_V2` is on.
  router.get(`${CSI_ADMIN_PREFIX}/outreach/:id/timeline`, async (req, res) => {
    try { const actor = readerGuard(req); if (!flag("TIMELINE_V2")) throw new CsiError("FEATURE_DISABLED");
      const id = csiIdSchema.parse(req.params.id); const query = timelineV2QuerySchema.parse(req.query); await connect();
      if (!(await inScope(actor, "record", id))) return notFound(req, res, "Outreach");
      // V-T3 M8: a rep's timeline drops Owner-only kinds (nudges, Owner notes) in the read, before the page is cut.
      const page = await (deps.outreachTimeline ?? readOutreachTimeline)(id, csiRepScope(actor) ? { ...query, audience: "rep" } : query);
      return page ? res.json({ ok: true, ...page }) : notFound(req, res, "Outreach"); } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/outreach/:id`, async (req, res) => {
    try { const actor = readerGuard(req); const id = csiIdSchema.parse(req.params.id); await connect();
      if (!(await inScope(actor, "record", id))) return notFound(req, res);
      const result = await (deps.outreach ?? readOutreach)(id); if (!result) return notFound(req, res);
      // S8-REP: Owner→rep nudges (Messages) are Owner-only; a rep's detail carries an empty nudge page (same shape).
      if (csiRepScope(actor)) return res.json({ ok: true, ...result, data: { ...result.data, nudges: { items: [], next_cursor: null } } });
      return res.json({ ok: true, ...result }); } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/review-items`, async (req, res) => {
    try { guard(req); const query = reviewItemsQuerySchema.parse(req.query); await connect();
      return res.json({ ok: true, ...(await listReviewItems(query)) }); } catch (error) { return fail(req, res, error); }
  });
  for (const [method, path, commands] of [
    ["post", "/outreach/:id/commands", ["mark_worked", "assign", "set_waiting", "start_call", "end_call", "close", "reopen", "override_disposition", "add_note"]],
    ["post", "/followups", ["create_followup"]], ["patch", "/followups/:id", ["patch_followup"]],
    ["post", "/followups/:id/complete", ["complete_followup"]], ["post", "/followups/:id/snooze", ["snooze_followup"]],
    ["post", "/followups/:id/cancel", ["cancel_followup"]], ["post", "/restrictions/:id/resolve", ["resolve_restriction"]],
    ["post", "/review-items/:id/resolve", ["resolve_review"]], ["post", "/interactions/:id/contact-type", ["set_contact_type"]],
    ["post", "/numbers/:id/open-review", ["open_number_review"]],
  ] as const) router[method](`${CSI_ADMIN_PREFIX}${path}`, async (req, res) => {
    try {
      // S8-REP: every Outreach command route admits a signed rep, and a rep may only send the E9 allowlist
      // (`assertRepCommand`: FORBIDDEN otherwise, a note required); the follow-up's ownership is checked in the transaction.
      const actor = readerGuard(req); if (!flag("OUTREACH_ENSURE")) throw new CsiError("FEATURE_DISABLED");
      const rep = csiRepScope(actor) !== null;
      if (rep && !(REP_OUTREACH_COMMANDS as readonly string[]).includes(String(req.body?.command))) throw new CsiError("FORBIDDEN");
      const command = csiCommandSchema.parse(req.body);
      if (rep) assertRepCommand(command);
      if (!(commands as readonly string[]).includes(command.command)) throw new CsiError("INVALID_INPUT");
      const target_id = command.command === "create_followup" ? command.outreach_record_id : csiIdSchema.parse("id" in req.params ? req.params.id : undefined);
      const idempotency_key = req.header("idempotency-key")?.trim(); if (!idempotency_key) throw new CsiError("INVALID_INPUT");
      await connect(); return res.json({ ok: true, data: await (deps.outreachCommand ?? commandOutreach)({ actor, target_id, idempotency_key, command }) });
    } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/reps`, async (req, res) => {
    try { guard(req); const query = repListQuerySchema.parse(req.query); await connect();
      const { as_of, coverage, ...data } = await (deps.reps ?? listRepLinks)(query);
      return res.json({ ok: true, as_of, coverage, data }); } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/reps/:id`, async (req, res) => {
    try { guard(req); const id = csiIdSchema.parse(req.params.id);
      z.object({ scope: z.literal("production").optional() }).strict().parse(req.query); await connect();
      const result = await (deps.rep ?? readRepLink)(id);
      if (!result) return notFound(req, res, "Rep Identity Link");
      const { as_of, coverage, ...data } = result;
      return res.json({ ok: true, as_of, coverage, data });
    } catch (error) { return fail(req, res, error); }
  });
  for (const path of ["/reps", "/reps/propose", "/reps/:id/review"] as const) router.post(`${CSI_ADMIN_PREFIX}${path}`, async (req, res) => {
    try {
      const actor = guard(req), idempotency_key = req.header("idempotency-key")?.trim();
      if (!idempotency_key) throw new CsiError("INVALID_INPUT");
      const body = (path === "/reps" ? csiRepCreateSchema : path === "/reps/propose" ? csiRepProposeSchema : csiRepCommandSchema).parse(req.body);
      const id = path === "/reps/:id/review" ? csiIdSchema.parse("id" in req.params ? req.params.id : undefined) : null;
      await connect(); const input = { actor, idempotency_key, body };
      const data = path === "/reps" ? await (deps.createRep ?? createRepLink)(input) : path === "/reps/propose" ? await (deps.proposeReps ?? proposeRepLinks)(input) :
        await (deps.reviewRep ?? reviewRepLink)({ ...input, id: id! });
      return res.json({ ok: true, data });
    } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/nudges`, async (req, res) => {
    try { guard(req); const query = nudgeHistoryQuerySchema.parse(req.query); await connect(); return res.json({ ok: true, ...(await (deps.nudges ?? listNudges)(query)) }); }
    catch (error) { return fail(req, res, error); }
  });
  for (const path of ["/nudges/preview", "/nudges"] as const) router.post(`${CSI_ADMIN_PREFIX}${path}`, async (req, res) => {
    try {
      const actor = guard(req); if (!flag("NUDGE_ENABLED")) throw new CsiError("FEATURE_DISABLED");
      const body = csiNudgeCommandSchema.parse(req.body), idempotency_key = req.header("idempotency-key")?.trim();
      if (!idempotency_key || idempotency_key.length > 200) throw new CsiError("INVALID_INPUT");
      await connect(); const input = { actor, body, idempotency_key };
      if (path === "/nudges/preview") return res.json({ ok: true, ...(await (deps.nudgePreview ?? previewNudge)(input)) });
      const data = await (deps.nudgeSend ?? sendNudge)(input);
      return res.status(data.nudge.status === "pending" ? 202 : 200).json({ ok: true, data });
    } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/analysis-runs`, async (req, res) => {
    try { guard(req); await connect(); return res.json({ ok: true, ...(await listOwnerRuns(req.query)) }); }
    catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/analysis-runs/:id`, async (req, res) => {
    try { guard(req); await connect(); const result = await readOwnerRun(csiIdSchema.parse(req.params.id), req.query);
      return result ? res.json({ ok: true, ...result }) : notFound(req, res, "Analysis"); }
    catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/conversations/:id/findings`, async (req, res) => {
    try { guard(req); const query = z.object({ scope: z.literal("production").optional(), run_id: csiIdSchema.optional() }).strict().parse(req.query);
      const id = csiIdSchema.parse(req.params.id); await connect();
      const runs = await listOwnerRuns({ conversation_id: id, limit: 1 });
      const runId = query.run_id ?? runs.data.items[0]?.id;
      const result = runId ? await readOwnerRun(runId) : null;
      if (result && result.data.conversation_id !== id) throw new CsiError("RUN_SCOPE_DENIED");
      return result ? res.json({ ok: true, ...result }) : notFound(req, res, "Analysis"); }
    catch (error) { return fail(req, res, error); }
  });
  // S4-CONV (data spec §6.7–6.9, final spec §11.7): Owner conversation cards, transcript pages and the recording stream. GET-only;
  // the media route writes one `media_played` audit row before the first byte and never exposes the blob URL or pathname.
  // S8-REP: a rep reads these only for a Number (or a conversation's Number) that one of its in-scope records is on; else the same 404.
  router.get(`${CSI_ADMIN_PREFIX}/numbers/:id/conversations`, async (req, res) => {
    try { const actor = readerGuard(req); const id = csiIdSchema.parse(req.params.id); const query = ownerConversationsQuerySchema.parse(req.query); await connect();
      if (!(await inScope(actor, "number", id))) return notFound(req, res);
      const result = await (deps.conversations ?? readOwnerConversations)(id, query);
      return result ? res.json({ ok: true, ...result }) : notFound(req, res); } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/conversations/:id/transcript`, async (req, res) => {
    try { const actor = readerGuard(req); const id = csiIdSchema.parse(req.params.id); const query = ownerTranscriptQuerySchema.parse(req.query); await connect();
      if (!(await inScope(actor, "conversation", id))) return notFound(req, res, "Conversation");
      const result = await (deps.transcript ?? readOwnerTranscript)(id, query);
      return result ? res.json({ ok: true, ...result }) : notFound(req, res, "Conversation"); } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/conversations/:id/media`, async (req, res) => {
    const aborted = new AbortController();
    res.once("close", () => aborted.abort());
    try {
      const actor = readerGuard(req); const id = csiIdSchema.parse(req.params.id); scopeOnly.parse(req.query); await connect();
      // S8-REP: checked before the audit row, so an out-of-scope id writes nothing and answers like a missing recording.
      if (!(await inScope(actor, "conversation", id))) return notFound(req, res, "Recording");
      const outcome = await (deps.conversationMedia ?? openOwnerConversationMedia)({ conversation_id: id, actor, range: req.header("range") ?? null, signal: aborted.signal });
      if (outcome.kind === "not_found") return notFound(req, res, "Recording");
      if (outcome.kind === "range_not_satisfiable") return res.status(416).set(outcome.headers).end();
      res.status(outcome.status).set(outcome.headers);
      await pipeline(Readable.fromWeb(outcome.body as unknown as NodeWebReadableStream<Uint8Array>), res);
    } catch (error) {
      if (!res.headersSent) return fail(req, res, error);
      // Mid-stream failure or client abort: the status is already sent; end the socket without an error body.
      if (!aborted.signal.aborted) logger.error({ msg: "sales_intelligence.admin.media_stream_failed", errorName: error instanceof Error ? error.name : "Error" });
      res.destroy();
    }
  });
  for (const path of ["/analysis-runs/:id/evidence", "/analysis-runs/:id/evidence/:snapshotId"] as const) router.get(`${CSI_ADMIN_PREFIX}${path}`, async (req, res) => {
    try { guard(req); await connect(); const result = await readOwnerEvidence(csiIdSchema.parse(req.params.id),
      "snapshotId" in req.params ? csiIdSchema.parse(req.params.snapshotId) : undefined, req.query);
      return result ? res.json({ ok: true, ...result }) : notFound(req, res, "Evidence"); }
    catch (error) { return fail(req, res, error); }
  });
  for (const [path, action] of [["/analysis-runs/:id/confirm", "confirm_run"], ["/findings/:id/confirm", "confirm_finding"],
    ["/findings/:id/correct", "correct_finding"], ["/findings/:id/retract", "retract_finding"], ["/analysis-runs/:id/apply-suggestion", "apply_suggestion"],
    ["/analysis-runs/:id/reanalyze", "reanalyze"], ["/conversations/:id/reanalyze", "reanalyze"], ["/numbers/:id/reanalyze", "reanalyze"]] as const) router.post(`${CSI_ADMIN_PREFIX}${path}`, async (req, res) => {
    try { const actor = guard(req), target_id = csiIdSchema.parse(req.params.id), command = csiCommandSchema.parse(req.body);
      if (command.command !== action) throw new CsiError("INVALID_INPUT");
      const idempotency_key = req.header("idempotency-key")?.trim(); if (!idempotency_key) throw new CsiError("INVALID_INPUT");
      await connect(); const result = await commandAnalysis({ actor, target_id, command, idempotency_key });
      return res.status(action === "reanalyze" ? 202 : 200).json({ ok: true, data: result }); }
    catch (error) { return fail(req, res, error); }
  });
  return router;
}
