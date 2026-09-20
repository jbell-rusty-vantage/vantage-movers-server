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
import { CsiError, requireCsiOwner, assertCurrentScope } from "../services/salesIntelligence/auth";
import { csiCommandSchema, csiIdSchema } from "../validation/v1/salesIntelligence";
import { attachmentListQuerySchema, listAttachments } from "../services/salesIntelligence/attachment/reads";
import { commandAttachment } from "../services/salesIntelligence/attachment/commands";
import { commandOutreach } from "../services/salesIntelligence/followups/commands";
import { listReviewItems, readOutreach, readOutreachByLead, reviewItemsQuerySchema } from "../services/salesIntelligence/outreach/reads";
import { attentionQuerySchema, readAttention } from "../services/salesIntelligence/outreach/attention";
import { listRepLinks, readRepLink, repListQuerySchema } from "../services/salesIntelligence/repIdentity/reads";
import { createRepLink, proposeRepLinks, reviewRepLink } from "../services/salesIntelligence/repIdentity/commands";
import { csiRepCreateSchema, csiRepProposeSchema, csiRepCommandSchema } from "../validation/v1/salesIntelligence";
import { previewNudge, sendNudge } from "../services/salesIntelligence/nudges/commands";
import { listNudges, nudgeHistoryQuerySchema } from "../services/salesIntelligence/nudges/reads";
import { csiNudgeCommandSchema } from "../validation/v1/salesIntelligence";
import { streamCsiInvalidations } from "../services/salesIntelligence/live";
import { commandAnalysis } from "../services/salesIntelligence/analysis/ownerCommands";
import { listOwnerRuns, readOwnerRun, readOwnerEvidence } from "../services/salesIntelligence/analysis/ownerReads";

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

export type SalesIntelligenceAdminRouteDeps = {
  connect?: typeof connectMongo;
  flag?: typeof csiFlag;
  owner?: typeof requireCsiOwner;
  search?: typeof searchNumberActivity;
  detail?: typeof getContactNumberDetail;
  timeline?: typeof getNumberTimeline;
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
      guard(req);
      z.object({ scope: z.literal("production").optional() }).strict().parse(req.query);
      await connect();
      (deps.live ?? streamCsiInvalidations)(req, res);
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
    try { guard(req); const query = attentionQuerySchema.parse(req.query); await connect(); return res.json({ ok: true, ...(await readAttention(query)) }); }
    catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/outreach/:id`, async (req, res) => {
    try { guard(req); const id = csiIdSchema.parse(req.params.id); await connect(); const result = await readOutreach(id); if (!result) return notFound(req, res); return res.json({ ok: true, ...result }); } catch (error) { return fail(req, res, error); }
  });
  router.get(`${CSI_ADMIN_PREFIX}/review-items`, async (req, res) => {
    try { guard(req); const query = reviewItemsQuerySchema.parse(req.query); await connect();
      return res.json({ ok: true, ...(await listReviewItems(query)) }); } catch (error) { return fail(req, res, error); }
  });
  for (const [method, path, commands] of [
    ["post", "/outreach/:id/commands", ["mark_worked", "assign", "set_waiting", "close", "reopen", "add_note"]],
    ["post", "/followups", ["create_followup"]], ["patch", "/followups/:id", ["patch_followup"]],
    ["post", "/followups/:id/complete", ["complete_followup"]], ["post", "/followups/:id/snooze", ["snooze_followup"]],
    ["post", "/followups/:id/cancel", ["cancel_followup"]], ["post", "/restrictions/:id/resolve", ["resolve_restriction"]],
    ["post", "/review-items/:id/resolve", ["resolve_review"]], ["post", "/interactions/:id/contact-type", ["set_contact_type"]],
    ["post", "/numbers/:id/open-review", ["open_number_review"]],
  ] as const) router[method](`${CSI_ADMIN_PREFIX}${path}`, async (req, res) => {
    try {
      const actor = guard(req); if (!flag("OUTREACH_ENSURE")) throw new CsiError("FEATURE_DISABLED");
      const command = csiCommandSchema.parse(req.body);
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
